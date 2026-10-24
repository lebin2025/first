import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth'

export interface ChatMessage {
  id: string
  roomId: string
  userId: string
  nickname: string
  content: string
  createdAt: string
  pending?: boolean
  failed?: boolean
}

interface MessageRow {
  id: string
  room_id: string
  user_id: string
  content: string
  created_at: string
}

interface ProfileRow {
  user_id: string
  nickname: string | null
}

const POLL_INTERVAL_MS = 5000
const REALTIME_RETRY_MS = 3000
const MAX_REALTIME_RETRIES = 3

/**
 * 房间聊天：WebSocket 主链路 + HTTP 轮询兜底。
 *
 * - messages INSERT 实时推送；
 * - 每 5 秒 HTTP 增量拉取，防止断连漏消息；
 * - Realtime 失败最多延迟重试 3 次，绝不递归调用；
 * - stopPolling / reset 负责清理 channel 与 interval。
 */
export const useChatStore = defineStore('chat', () => {
  const auth = useAuthStore()

  const roomId = ref('')
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const sending = ref(false)
  const polling = ref(false)
  const realtimeState = ref<'idle' | 'connecting' | 'connected' | 'fallback'>('idle')
  const error = ref('')
  const lastSyncedAt = ref('')

  let pollTimer: number | null = null
  let pollingNow = false
  let loadGeneration = 0
  let messageChannel: RealtimeChannel | null = null
  let realtimeRetryTimer: number | null = null
  let realtimeRetryCount = 0
  let channelGeneration = 0
  const nicknameCache = new Map<string, string>()

  function fallbackNickname(userId: string): string {
    if (userId === auth.userId) {
      return auth.profile?.nickname?.trim() || auth.email.split('@')[0] || '我'
    }
    return `同学 ${userId.slice(0, 4)}`
  }

  async function resolveNickname(userId: string): Promise<string> {
    const cached = nicknameCache.get(userId)
    if (cached) return cached

    if (userId === auth.userId) {
      const own = fallbackNickname(userId)
      nicknameCache.set(userId, own)
      return own
    }

    try {
      const { data } = await supabase
        .from('profiles')
        .select('nickname')
        .eq('user_id', userId)
        .maybeSingle()
      const nickname =
        (data as ProfileRow | null)?.nickname?.trim() || fallbackNickname(userId)
      nicknameCache.set(userId, nickname)
      return nickname
    } catch {
      const fallback = fallbackNickname(userId)
      nicknameCache.set(userId, fallback)
      return fallback
    }
  }

  function toMessage(row: MessageRow, nickname: string): ChatMessage {
    return {
      id: row.id,
      roomId: row.room_id,
      userId: row.user_id,
      nickname,
      content: row.content,
      createdAt: row.created_at,
    }
  }

  /** 拉取历史消息；任何失败返回空数组 */
  async function fetchMessages(targetRoomId: string): Promise<ChatMessage[]> {
    try {
      const { data, error: loadError } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', targetRoomId)
        .order('created_at', { ascending: true })
        .limit(100)

      if (loadError) {
        error.value = describeError(loadError)
        return []
      }

      const rows = (data ?? []) as unknown as MessageRow[]
      if (rows.length === 0) return []

      const userIds = [...new Set(rows.map((row) => row.user_id))]
      const names = new Map<string, string>()

      try {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, nickname')
          .in('user_id', userIds)
        for (const profile of (profiles ?? []) as ProfileRow[]) {
          names.set(profile.user_id, profile.nickname?.trim() || '')
        }
      } catch {
        // 昵称失败不阻塞消息展示
      }

      return rows.map((row) =>
        toMessage(row, names.get(row.user_id) || fallbackNickname(row.user_id)),
      )
    } catch (cause) {
      error.value = describeError(cause)
      return []
    }
  }

  /** 只把新增消息合并进列表，避免整列表重渲染 */
  async function pollLatest(): Promise<void> {
    if (!roomId.value || pollingNow) return

    pollingNow = true
    const targetRoomId = roomId.value
    try {
      const last = messages.value
        .filter((message) => !message.pending)
        .at(-1)?.createdAt

      let query = supabase
        .from('messages')
        .select('*')
        .eq('room_id', targetRoomId)
        .order('created_at', { ascending: true })
        .limit(100)

      if (last) query = query.gte('created_at', last)

      const { data, error: pollError } = await query
      if (pollError) {
        error.value = describeError(pollError)
        return
      }
      if (roomId.value !== targetRoomId) return

      const rows = (data ?? []) as unknown as MessageRow[]
      const fresh = rows.filter(
        (row) => !messages.value.some((message) => message.id === row.id),
      )
      if (fresh.length === 0) {
        lastSyncedAt.value = new Date().toISOString()
        return
      }

      const names = new Map<string, string>()
      const userIds = [...new Set(fresh.map((row) => row.user_id))]
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, nickname')
          .in('user_id', userIds)
        for (const profile of (profiles ?? []) as ProfileRow[]) {
          names.set(profile.user_id, profile.nickname?.trim() || '')
        }
      }

      messages.value = [
        ...messages.value,
        ...fresh.map((row) =>
          toMessage(row, names.get(row.user_id) || fallbackNickname(row.user_id)),
        ),
      ]
      lastSyncedAt.value = new Date().toISOString()
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      pollingNow = false
    }
  }

  function stopPolling(): void {
    // 使尚未完成的 load 失效，避免卸载后又重新创建 interval
    loadGeneration += 1
    if (pollTimer !== null) {
      window.clearInterval(pollTimer)
      pollTimer = null
    }
    disposeMessageChannel()
    polling.value = false
    loading.value = false
    realtimeState.value = 'idle'
  }

  function startPolling(): void {
    if (pollTimer !== null) return
    polling.value = true
    pollTimer = window.setInterval(() => {
      void pollLatest()
    }, POLL_INTERVAL_MS)
  }

  function disposeMessageChannel(): void {
    channelGeneration += 1
    if (realtimeRetryTimer !== null) {
      window.clearTimeout(realtimeRetryTimer)
      realtimeRetryTimer = null
    }
    const dead = messageChannel
    messageChannel = null
    if (dead) void supabase.removeChannel(dead)
  }

  function handleMessageRealtimeFailure(targetRoomId: string, ownerGeneration: number): void {
    if (ownerGeneration !== channelGeneration || realtimeRetryTimer !== null) return

    if (realtimeRetryCount >= MAX_REALTIME_RETRIES) {
      realtimeState.value = 'fallback'
      console.warn('[chat] Realtime 连续失败 3 次，已静默切换为 5 秒 HTTP 轮询。')
      disposeMessageChannel()
      return
    }

    realtimeRetryCount += 1
    realtimeRetryTimer = window.setTimeout(() => {
      realtimeRetryTimer = null
      if (roomId.value === targetRoomId) connectMessageRealtime(targetRoomId)
    }, REALTIME_RETRY_MS)
  }

  function connectMessageRealtime(targetRoomId: string): void {
    disposeMessageChannel()
    const ownerGeneration = channelGeneration
    realtimeState.value = 'connecting'

    const nextChannel = supabase
      .channel(`room-messages:${targetRoomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${targetRoomId}`,
        },
        async (payload) => {
          if (ownerGeneration !== channelGeneration) return
          const row = payload.new as MessageRow
          if (!row?.id || messages.value.some((message) => message.id === row.id)) return
          const nickname = await resolveNickname(row.user_id)
          messages.value = [...messages.value, toMessage(row, nickname)]
          lastSyncedAt.value = new Date().toISOString()
        },
      )

    messageChannel = nextChannel
    nextChannel.subscribe((status) => {
      if (ownerGeneration !== channelGeneration) return

      if (status === 'SUBSCRIBED') {
        if (realtimeRetryTimer !== null) {
          window.clearTimeout(realtimeRetryTimer)
          realtimeRetryTimer = null
        }
        realtimeRetryCount = 0
        realtimeState.value = 'connected'
        return
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        handleMessageRealtimeFailure(targetRoomId, ownerGeneration)
      }
    })
  }

  async function load(targetRoomId: string): Promise<void> {
    stopPolling()
    const generation = loadGeneration
    roomId.value = targetRoomId
    messages.value = []
    error.value = ''
    lastSyncedAt.value = ''
    loading.value = true

    try {
      const loaded = await fetchMessages(targetRoomId)
      if (generation !== loadGeneration) return
      messages.value = loaded
      lastSyncedAt.value = new Date().toISOString()
      startPolling()
      realtimeRetryCount = 0
      connectMessageRealtime(targetRoomId)
    } finally {
      if (generation === loadGeneration) loading.value = false
    }
  }

  async function send(content: string): Promise<boolean> {
    const text = content.trim().slice(0, 1000)
    if (!text || !roomId.value || !auth.userId) return false
    if (sending.value) return false

    sending.value = true
    error.value = ''
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: ChatMessage = {
      id: tempId,
      roomId: roomId.value,
      userId: auth.userId,
      nickname: fallbackNickname(auth.userId),
      content: text,
      createdAt: new Date().toISOString(),
      pending: true,
    }
    messages.value = [...messages.value, optimistic]

    try {
      const { data, error: sendError } = await supabase
        .from('messages')
        .insert({
          room_id: roomId.value,
          user_id: auth.userId,
          content: text,
        })
        .select()
        .single()

      if (sendError) {
        messages.value = messages.value.filter((message) => message.id !== tempId)
        error.value = describeError(sendError)
        return false
      }

      const saved = data as unknown as MessageRow
      messages.value = messages.value.filter((message) => message.id !== tempId)
      if (!messages.value.some((message) => message.id === saved.id)) {
        messages.value = [
          ...messages.value,
          toMessage(saved, fallbackNickname(auth.userId)),
        ]
      }
      lastSyncedAt.value = new Date().toISOString()
      return true
    } catch (cause) {
      messages.value = messages.value.filter((message) => message.id !== tempId)
      error.value = describeError(cause)
      return false
    } finally {
      sending.value = false
    }
  }

  function reset(): void {
    stopPolling()
    roomId.value = ''
    messages.value = []
    error.value = ''
    lastSyncedAt.value = ''
    nicknameCache.clear()
  }

  /** 兼容旧调用；现在等价于 stopPolling */
  function disconnect(): void {
    stopPolling()
  }

  return {
    roomId,
    messages,
    loading,
    sending,
    polling,
    realtimeState,
    error,
    lastSyncedAt,
    load,
    fetchMessages,
    pollLatest,
    startPolling,
    stopPolling,
    disconnect,
    send,
    reset,
  }
})
