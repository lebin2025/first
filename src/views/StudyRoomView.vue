<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import type { RealtimeChannel } from '@supabase/supabase-js'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import ZenTimer from '@/components/focus/ZenTimer.vue'
import RoomChat from '@/components/focus/RoomChat.vue'
import GlobalAudioPlayer from '@/components/audio/GlobalAudioPlayer.vue'
import { supabase } from '@/lib/supabase'
import { useRoomStore, type RoomSeat } from '@/stores/room'
import { useAuthStore } from '@/stores/auth'
import { useAudioStore } from '@/stores/audio'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const auth = useAuthStore()
const room = useRoomStore()
const audio = useAudioStore()
const audioTracks = audio.tracks

const focusMinutes = ref(25)
const timerRunning = ref(false)
const loadingError = ref('')
let seatChannel: RealtimeChannel | null = null
let seatRetryTimer: number | null = null
let seatPollTimer: number | null = null
let seatRetryCount = 0
let membersRefreshing = false

const roomId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

/** 严格按 max_members 生成定长座位槽；有成员渲染卡片，无成员渲染空位 */
const seatSlots = computed<Array<RoomSeat | null>>(() => {
  const total = Math.max(1, room.maxMembers)
  return Array.from({ length: total }, (_, index) => room.members[index] ?? null)
})

function statusLabel(member: RoomSeat): string {
  return member.userId === auth.userId && timerRunning.value ? '正在专注' : '在线'
}

function onTimerRunning(value: boolean): void {
  timerRunning.value = value
  if (auth.userId) room.setFocusing(auth.userId, value)
}

function selectAudioTrack(track: (typeof audioTracks)[number]['id']): void {
  // 自习室只做手动切歌，不跟随 FocusPage 主题联动
  void audio.play(track)
}

async function loadRoom(): Promise<void> {
  loadingError.value = ''
  const loaded = await room.fetchRoom(roomId.value)
  if (!loaded) {
    loadingError.value = room.error || '房间不存在'
    toast.warning(loadingError.value)
    // 清掉 stale active room，避免守卫把它再次重定向回来
    room.reset()
    await router.replace('/study-room')
  }
}

/** 只刷新座位，不触发整页导航或整页刷新 */
async function fetchRoomMembers(): Promise<void> {
  if (!roomId.value || membersRefreshing) return
  membersRefreshing = true
  try {
    await room.fetchRoom(roomId.value)
  } catch (cause) {
    console.warn('[study-room] 座位刷新失败', cause)
  } finally {
    membersRefreshing = false
  }
}

function stopSeatPolling(): void {
  if (seatPollTimer !== null) {
    window.clearInterval(seatPollTimer)
    seatPollTimer = null
  }
}

function startSeatPolling(): void {
  if (seatPollTimer !== null) return
  seatPollTimer = window.setInterval(() => {
    void fetchRoomMembers()
  }, 5000)
}

function disposeSeatChannel(): void {
  if (seatRetryTimer !== null) {
    window.clearTimeout(seatRetryTimer)
    seatRetryTimer = null
  }
  const dead = seatChannel
  seatChannel = null
  if (dead) void supabase.removeChannel(dead)
}

function connectSeatChannel(): void {
  const targetRoomId = roomId.value
  if (!targetRoomId) return

  disposeSeatChannel()
  const nextChannel = supabase
    .channel(`room-seats:${targetRoomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'room_members',
        filter: `room_id=eq.${targetRoomId}`,
      },
      () => {
        void fetchRoomMembers()
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'room_members',
        filter: `room_id=eq.${targetRoomId}`,
      },
      () => {
        void fetchRoomMembers()
      },
    )

  seatChannel = nextChannel
  nextChannel.subscribe((status) => {
    if (seatChannel !== nextChannel) return

    if (status === 'SUBSCRIBED') {
      if (seatRetryTimer !== null) {
        window.clearTimeout(seatRetryTimer)
        seatRetryTimer = null
      }
      seatRetryCount = 0
      stopSeatPolling()
      return
    }

    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      if (seatRetryTimer !== null) return

      if (seatRetryCount >= 3) {
        console.warn('[study-room] 座位实时连接连续失败 3 次，已切换为 5 秒轮询。')
        disposeSeatChannel()
        startSeatPolling()
        return
      }

      seatRetryCount += 1
      seatRetryTimer = window.setTimeout(() => {
        seatRetryTimer = null
        if (roomId.value === targetRoomId) connectSeatChannel()
      }, 3000)
    }
  })
}

function resetSeatRealtime(): void {
  disposeSeatChannel()
  stopSeatPolling()
  seatRetryCount = 0
}

function handleBeforeUnload(): void {
  // 不可靠兜底：浏览器关闭/刷新时尽力退出；数据库触发器仍会兜底清理空房间
  void room.leaveRoom()
}

async function leaveRoom(): Promise<void> {
  await room.leaveRoom()
  await router.push('/study-room')
}

function onComplete(): void {
  toast.success('这一轮专注完成，去喝口水吧')
}

watch(roomId, async () => {
  resetSeatRealtime()
  await loadRoom()
  if (!loadingError.value) connectSeatChannel()
})

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  await loadRoom()
  if (!loadingError.value) connectSeatChannel()
})

// 路由离开：先完成退出事务，再允许导航；失败也重置本地状态
onBeforeRouteLeave(async () => {
  await room.leaveRoom()
  return true
})

// 同一组件切换到另一个房间时，先退出旧房间，避免残留成员记录
onBeforeRouteUpdate(async (to, from) => {
  if (to.params.id !== from.params.id) await room.leaveRoom()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  if (auth.userId) room.setFocusing(auth.userId, false)
})

onUnmounted(() => {
  // 必须先销毁 Realtime 频道和轮询定时器，再兜底退出房间
  resetSeatRealtime()
  void room.leaveRoom()
})
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <GlassCard v-if="loadingError" class="state-card">
        <p class="error-text">{{ loadingError }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/study-room">回到大厅</RouterLink>
      </GlassCard>

      <template v-else>
        <header class="room-head">
          <div>
            <p class="eyebrow">ROOM / {{ room.inviteCode || '--------' }}</p>
            <h1>{{ room.roomName }}</h1>
            <p class="muted">
              {{ room.memberCount }}/{{ room.maxMembers }} 人在座 · 邀请码
              <span class="room-code">{{ room.inviteCode || '--------' }}</span>
            </p>
          </div>

          <div class="room-head__actions">
            <button type="button" class="btn btn--ghost btn--sm" @click="leaveRoom">离开房间</button>
          </div>
        </header>

        <div class="seat-strip" role="list" aria-label="虚拟座位">
          <template v-for="(seat, index) in seatSlots" :key="seat?.userId ?? `empty-${index}`">
            <div
              v-if="seat"
              class="seat"
              :class="{ 'seat--focus': seat.userId === auth.userId && timerRunning }"
              role="listitem"
            >
              <span class="seat__avatar">
                <img v-if="seat.avatarUrl" :src="seat.avatarUrl" alt="" />
                <template v-else>{{ room.initialsOf(seat.nickname) }}</template>
              </span>
              <span class="seat__body">
                <strong>{{ seat.nickname }}</strong>
                <small>{{ statusLabel(seat) }}</small>
              </span>
              <span
                v-if="seat.userId === auth.userId && timerRunning"
                class="seat__lamp"
                aria-hidden="true"
              ></span>
              <span v-if="seat.bio" class="seat__bio">{{ seat.bio }}</span>
            </div>

            <div v-else class="seat seat--empty" role="listitem">
              <span class="seat__avatar seat__avatar--empty">+</span>
              <span class="seat__body">
                <strong>空位</strong>
                <small>等待同学加入</small>
              </span>
            </div>
          </template>
        </div>

        <GlassCard class="stage-panel">
          <div class="stage-panel__head">
            <span class="section__title">专注台</span>
            <span class="tiny faint">ZEN TIMER · {{ focusMinutes }} MIN</span>
          </div>

          <ZenTimer
            v-model:minutes="focusMinutes"
            @update:running="onTimerRunning"
            @complete="onComplete"
          />

          <div class="room-audio">
            <GlobalAudioPlayer tone="page" />

            <div class="room-audio__tracks" role="group" aria-label="手动选择环境音">
              <button
                v-for="track in audioTracks"
                :key="track.id"
                type="button"
                class="room-audio__track"
                :class="{ 'is-active': audio.currentTrack === track.id }"
                :aria-pressed="audio.currentTrack === track.id"
                @click="selectAudioTrack(track.id)"
              >
                {{ track.label }}
              </button>
            </div>
          </div>
        </GlassCard>
      </template>
    </div>

    <RoomChat :room-id="roomId" />
  </AppShell>
</template>

<style scoped>
.room-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.room-head__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.room-code {
  font-family: var(--font-mono);
  letter-spacing: 0.12em;
  color: var(--text-secondary);
}

.seat-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 2px 10px;
  margin-bottom: var(--space-4);
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}

.seat {
  position: relative;
  flex: 0 0 158px;
  min-height: 66px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  scroll-snap-align: start;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out);
}

.seat:hover {
  transform: translateY(-2px);
  background: var(--glass-bg);
}

.seat--focus {
  border-color: var(--accent-soft);
  background: var(--accent-softer);
}

.seat--empty {
  opacity: 0.5;
  border-style: dashed;
}

.seat__avatar {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  font-size: 12px;
  font-weight: 650;
  color: var(--text-strong);
  background: var(--glass-bg-strong);
}

.seat__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.seat__avatar--empty {
  color: var(--text-tertiary);
  font-weight: 400;
}

.seat__body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.seat__body strong {
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-strong);
}

.seat__body small {
  font-size: 8px;
  color: var(--text-tertiary);
}

.seat__lamp {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  animation: seat-lamp 2.4s ease-out infinite;
}

.seat__bio {
  position: absolute;
  left: 10px;
  bottom: 6px;
  max-width: 132px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 7px;
  color: var(--text-tertiary);
}

.stage-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding-bottom: clamp(18px, 3vw, 30px);
}

.stage-panel__head {
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.room-audio {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  margin-top: 2px;
}

.room-audio__tracks {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.room-audio__track {
  min-height: 24px;
  padding: 0 9px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border-soft);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 9px;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.room-audio__track:hover {
  border-color: var(--accent-soft);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
}

.room-audio__track.is-active {
  border-color: var(--accent-soft);
  background: var(--accent-softer);
  color: var(--text-primary);
}

@keyframes seat-lamp {
  0% { box-shadow: 0 0 0 0 var(--success-soft); }
  70% { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

@media (max-width: 860px) {
  .seat {
    flex-basis: 146px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .seat__lamp {
    animation: none;
  }

  .seat:hover {
    transform: none;
  }
}
</style>
