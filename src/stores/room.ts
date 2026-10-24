import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth'

export interface Room {
  id: string
  hostId: string
  name: string
  inviteCode: string
  maxMembers: number
  createdAt: string
  memberCount: number
}

export interface RoomSeat {
  userId: string
  nickname: string
  bio: string
  avatarUrl: string | null
  joinedAt: string
  status: 'focus' | 'idle'
}

interface RoomRow {
  id: string
  host_id: string
  name: string
  invite_code: string
  max_members: number
  created_at: string
}

interface MemberRow {
  room_id: string
  user_id: string
  joined_at: string
}

interface ProfileRow {
  user_id: string
  nickname: string | null
  bio: string | null
  avatar_url: string | null
}

const DEFAULT_ROOM_NAME = '拾光自习室'

function mapRoom(row: RoomRow, memberCount = 0): Room {
  return {
    id: row.id,
    hostId: row.host_id,
    name: row.name,
    inviteCode: row.invite_code,
    maxMembers: row.max_members,
    createdAt: row.created_at,
    memberCount,
  }
}

function fallbackName(profile: ProfileRow | undefined, userId: string): string {
  return profile?.nickname?.trim() || `同学 ${userId.slice(0, 4)}`
}

function initialsOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '·'
}

/**
 * 真实自习室大厅 + 房间状态。
 * 所有写操作都在 Promise resolve 后才返回 roomId，页面只在成功后再导航。
 */
export const useRoomStore = defineStore('room', () => {
  const auth = useAuthStore()

  const rooms = ref<Room[]>([])
  const roomId = ref('')
  const roomName = ref(DEFAULT_ROOM_NAME)
  const hostId = ref('')
  const inviteCode = ref('')
  const maxMembers = ref(6)
  const members = ref<RoomSeat[]>([])
  const loading = ref(false)
  const error = ref('')
  const focusingIds = ref<Set<string>>(new Set())

  const joined = computed(() => Boolean(roomId.value && members.value.some((m) => m.userId === auth.userId)))
  const hasActiveRoom = computed(() => Boolean(roomId.value))
  const memberCount = computed(() => members.value.length)
  const onlineCount = computed(() => members.value.length)
  const focusingCount = computed(() => members.value.filter((m) => m.status === 'focus').length)
  let leavingPromise: Promise<void> | null = null

  function setCurrentRoom(room: Room): void {
    roomId.value = room.id
    roomName.value = room.name
    hostId.value = room.hostId
    inviteCode.value = room.inviteCode
    maxMembers.value = room.maxMembers
    error.value = ''
  }

  function clearError(): void {
    error.value = ''
  }

  function reset(): void {
    roomId.value = ''
    roomName.value = DEFAULT_ROOM_NAME
    hostId.value = ''
    inviteCode.value = ''
    maxMembers.value = 6
    members.value = []
    focusingIds.value = new Set()
  }

  async function fetchRooms(): Promise<Room[]> {
    loading.value = true
    error.value = ''
    try {
      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(40)
      if (roomError) {
        error.value = describeError(roomError)
        return []
      }

      const rows = (roomRows ?? []) as unknown as RoomRow[]
      if (rows.length === 0) {
        rooms.value = []
        return []
      }

      const ids = rows.map((row) => row.id)
      const { data: memberRows, error: memberError } = await supabase
        .from('room_members')
        .select('room_id, user_id')
        .in('room_id', ids)
      if (memberError) {
        error.value = describeError(memberError)
        return []
      }

      const counts = ((memberRows ?? []) as Array<{ room_id: string }>).reduce<Record<string, number>>(
        (acc, row) => {
          acc[row.room_id] = (acc[row.room_id] ?? 0) + 1
          return acc
        },
        {},
      )

      rooms.value = rows.map((row) => mapRoom(row, counts[row.id] ?? 0))
      return rooms.value
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchRoom(nextRoomId: string): Promise<Room | null> {
    loading.value = true
    error.value = ''
    try {
      const { data: roomRow, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', nextRoomId)
        .maybeSingle()
      if (roomError) {
        error.value = describeError(roomError)
        return null
      }
      if (!roomRow) {
        error.value = '房间不存在，或已被房主删除。'
        return null
      }

      const room = mapRoom(roomRow as unknown as RoomRow)
      const { data: memberRows, error: memberError } = await supabase
        .from('room_members')
        .select('room_id, user_id, joined_at')
        .eq('room_id', nextRoomId)
        .order('joined_at', { ascending: true })
      if (memberError) {
        error.value = describeError(memberError)
        return null
      }

      const rows = (memberRows ?? []) as unknown as MemberRow[]
      const userIds = rows.map((row) => row.user_id)
      let profileRows: ProfileRow[] = []
      if (userIds.length > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('user_id, nickname, bio, avatar_url')
          .in('user_id', userIds)
        if (profileError) {
          error.value = describeError(profileError)
          return null
        }
        profileRows = (profileData ?? []) as unknown as ProfileRow[]
      }
      const profileMap = new Map(profileRows.map((profile) => [profile.user_id, profile]))

      const seats = rows.map<RoomSeat>((row) => {
        const profile = profileMap.get(row.user_id)
        return {
          userId: row.user_id,
          nickname: fallbackName(profile, row.user_id),
          bio: profile?.bio?.trim() ?? '',
          avatarUrl: profile?.avatar_url ?? null,
          joinedAt: row.joined_at,
          status: focusingIds.value.has(row.user_id) ? 'focus' : 'idle',
        }
      })

      setCurrentRoom(room)
      members.value = seats
      return { ...room, memberCount: seats.length }
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function createRoom(name: string, limit: number): Promise<string | null> {
    error.value = ''
    if (!auth.userId) {
      error.value = '请先登录'
      return null
    }
    const safeName = name.trim().slice(0, 60) || DEFAULT_ROOM_NAME
    const safeLimit = Math.min(10, Math.max(1, Math.round(limit) || 6))
    loading.value = true
    let created: Room | null = null

    try {
      // ① 插入 rooms
      const { data: roomRow, error: createError } = await supabase
        .from('rooms')
        .insert({
          host_id: auth.userId,
          name: safeName,
          max_members: safeLimit,
        })
        .select()
        .single()

      if (createError) {
        error.value = describeError(createError)
        return null
      }
      if (!roomRow) {
        error.value = '创建房间失败：数据库没有返回房间记录。'
        return null
      }

      // ② 获取 room_id
      created = mapRoom(roomRow as unknown as RoomRow, 1)

      // ③ 插入 room_members，当前用户绑定为房主
      const { error: joinError } = await supabase.from('room_members').insert({
        room_id: created.id,
        user_id: auth.userId,
      })

      if (joinError) {
        // 入座失败则回收刚创建的房间，避免留下幽灵房间
        await supabase.from('rooms').delete().eq('id', created.id)
        await cleanupIfEmpty(created.id)
        error.value = describeError(joinError)
        return null
      }

      // ④ 同步 Pinia 当前房间状态；路由只能在本次 Promise resolve 后跳转
      setCurrentRoom(created)
      members.value = []
      focusingIds.value = new Set()
      return created.id
    } catch (cause) {
      if (created) await cleanupIfEmpty(created.id)
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function joinRoom(code: string): Promise<string | null> {
    error.value = ''
    if (!auth.userId) {
      error.value = '请先登录'
      return null
    }
    const normalized = code.trim().toUpperCase()
    if (!normalized) {
      error.value = '请输入邀请码'
      return null
    }
    loading.value = true

    try {
      const { data: roomRow, error: findError } = await supabase
        .from('rooms')
        .select('*')
        .eq('invite_code', normalized)
        .maybeSingle()
      if (findError) {
        error.value = describeError(findError)
        return null
      }
      if (!roomRow) {
        error.value = '邀请码无效，或房间已关闭。'
        return null
      }

      const room = mapRoom(roomRow as unknown as RoomRow)
      const { error: joinError } = await supabase.from('room_members').insert({
        room_id: room.id,
        user_id: auth.userId,
      })
      // 23505 = 已在房间，按成功处理；23514 = 容量触发器拒绝
      if (joinError && joinError.code !== '23505') {
        error.value =
          joinError.code === '23514'
            ? '房间已满，无法加入'
            : describeError(joinError)
        return null
      }

      const loaded = await fetchRoom(room.id)
      if (!loaded) return null
      return room.id
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function leaveRoom(): Promise<void> {
    if (!roomId.value || !auth.userId) {
      reset()
      return
    }
    if (leavingPromise) return leavingPromise

    const leavingId = roomId.value
    leavingPromise = (async () => {
      try {
        const { error: deleteError } = await supabase
          .from('room_members')
          .delete()
          .eq('room_id', leavingId)
          .eq('user_id', auth.userId)
        if (deleteError) {
          error.value = describeError(deleteError)
          return
        }
        // 关键判定：删除当前成员后，若房间已经没有成员，立刻删除房间
        await cleanupIfEmpty(leavingId)
      } catch (cause) {
        error.value = describeError(cause)
      } finally {
        leavingPromise = null
        reset()
      }
    })()

    return leavingPromise
  }

  /**
   * 生命周期 GC：房间人数为 0 时删除 rooms 行。
   * 由 leaveRoom 和 StudyRoomView 的 onUnmounted 共同调用。
   */
  async function cleanupIfEmpty(targetRoomId: string): Promise<boolean> {
    if (!targetRoomId) return false
    try {
      const { count, error: countError } = await supabase
        .from('room_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('room_id', targetRoomId)
      if (countError) {
        error.value = describeError(countError)
        return false
      }
      if ((count ?? 0) > 0) return false

      const { error: deleteError } = await supabase
        .from('rooms')
        .delete()
        .eq('id', targetRoomId)
      if (deleteError) {
        error.value = describeError(deleteError)
        return false
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    }
  }

  /** 当前页计时器状态只影响自己的座位灯，不伪造其他用户状态 */
  function setFocusing(userId: string, active: boolean): void {
    const next = new Set(focusingIds.value)
    if (active) next.add(userId)
    else next.delete(userId)
    focusingIds.value = next
    members.value = members.value.map((member) =>
      member.userId === userId ? { ...member, status: active ? 'focus' : 'idle' } : member,
    )
  }

  return {
    rooms,
    roomId,
    roomName,
    hostId,
    inviteCode,
    maxMembers,
    members,
    loading,
    error,
    joined,
    hasActiveRoom,
    memberCount,
    onlineCount,
    focusingCount,
    initialsOf,
    clearError,
    reset,
    setCurrentRoom,
    fetchRooms,
    fetchRoom,
    createRoom,
    joinRoom,
    leaveRoom,
    cleanupIfEmpty,
    setFocusing,
  }
})
