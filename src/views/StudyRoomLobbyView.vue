<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useRoomStore } from '@/stores/room'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const room = useRoomStore()
const toast = useToast()

const roomName = ref('')
const maxMembers = ref(6)
const inviteCode = ref('')
const creating = ref(false)
const joining = ref(false)
const joiningId = ref('')
const matching = ref(false)
let createLockedUntil = 0

async function loadRooms(): Promise<void> {
  await room.fetchRooms()
}

/** 路由懒加载失败时不要让 click handler 抛未处理异常：回退整页打开 */
async function navigateToRoom(nextId: string): Promise<void> {
  try {
    await router.push({ name: 'StudyRoom', params: { id: nextId } })
  } catch (cause) {
    console.error('[study-room] route navigation failed', cause)
    toast.warning('房间已创建，正在重新加载房间页…')
    window.location.assign(`/study-room/${nextId}`)
  }
}

async function createRoom(): Promise<void> {
  // 1.5s 节流 + 进行中锁，防止网络延迟下重复创建
  if (creating.value || Date.now() < createLockedUntil) return
  createLockedUntil = Date.now() + 1500
  creating.value = true

  try {
    const nextId = await room.createRoom(roomName.value, maxMembers.value)
    if (!nextId) {
      toast.warning(room.error || '创建房间失败')
      return
    }
    // 只有 ①rooms ②room_id ③room_members 全部 resolve 后才跳转
    await navigateToRoom(nextId)
    toast.success('房间已创建')
  } catch (cause) {
    console.error('[study-room] create failed', cause)
    toast.warning('创建房间失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

async function joinByCode(code = inviteCode.value): Promise<void> {
  if (joining.value) return
  joining.value = true
  joiningId.value = code
  try {
    const nextId = await room.joinRoom(code)
    if (!nextId) {
      toast.warning(room.error || '加入房间失败')
      return
    }
    await navigateToRoom(nextId)
    toast.success('已加入房间')
  } catch (cause) {
    console.error('[study-room] join failed', cause)
    toast.warning('加入房间失败，请稍后重试')
  } finally {
    joining.value = false
    joiningId.value = ''
  }
}

function roomFull(capacity: number, count: number): boolean {
  return count >= capacity
}

/** 真实随机匹配：从开放房间里选一个还有空位的，不创建硬编码大世界 */
async function randomMatch(): Promise<void> {
  if (matching.value || joining.value) return
  matching.value = true
  const list = await room.fetchRooms()
  const candidate = list.find((item) => item.memberCount < item.maxMembers)
  matching.value = false
  if (!candidate) {
    toast.warning('暂时没有空位，先创建一个房间吧')
    return
  }
  await joinByCode(candidate.inviteCode)
}

onMounted(loadRooms)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">一起专注</p>
          <h1>自习室大厅</h1>
          <p class="muted">创建一张桌子，或凭邀请码加入一个正在专注的房间。</p>
        </div>
        <div class="lobby-refresh">
          <button type="button" class="btn btn--ghost btn--sm" :disabled="matching" @click="randomMatch">
            {{ matching ? '匹配中…' : '随机匹配' }}
          </button>
          <button type="button" class="btn btn--ghost btn--sm" :disabled="room.loading" @click="loadRooms">
            {{ room.loading ? '刷新中…' : '刷新房间' }}
          </button>
        </div>
      </header>

      <div class="lobby-controls">
        <GlassCard class="lobby-card">
          <div class="lobby-card__head">
            <span class="section__title">创建房间</span>
            <span class="tiny faint">最多 10 人</span>
          </div>

          <div class="lobby-field">
            <label class="lobby-label" for="lobby-name">房间名称</label>
            <input id="lobby-name" v-model="roomName" class="lobby-input" maxlength="60" placeholder="例如：雨夜书房" />
          </div>

          <div class="lobby-field">
            <label class="lobby-label" for="lobby-limit">人数上限</label>
            <input id="lobby-limit" v-model.number="maxMembers" class="lobby-input" type="number" min="1" max="10" />
          </div>

          <button type="button" class="lobby-primary" :disabled="creating" @click="createRoom">
            {{ creating ? '创建中…' : '创建并进入' }}
          </button>
        </GlassCard>

        <GlassCard class="lobby-card">
          <div class="lobby-card__head">
            <span class="section__title">邀请码加入</span>
            <span class="tiny faint">6 位代码</span>
          </div>

          <div class="lobby-field">
            <label class="lobby-label" for="lobby-code">邀请码</label>
            <input
              id="lobby-code"
              v-model="inviteCode"
              class="lobby-input lobby-input--code"
              maxlength="12"
              placeholder="例如：A1B2C3"
              @keyup.enter="joinByCode()"
            />
          </div>

          <button type="button" class="lobby-secondary" :disabled="joining" @click="joinByCode()">
            {{ joining && !joiningId ? '加入中…' : '凭邀请码加入' }}
          </button>
        </GlassCard>
      </div>

      <section class="room-list-section">
        <div class="section__head">
          <span class="section__title">正在开放的自习室</span>
          <span class="tiny faint">{{ room.rooms.length }} 间</span>
        </div>

        <GlassCard v-if="room.error" class="state-card">
          <p class="error-text">{{ room.error }}</p>
          <button type="button" class="btn btn--ghost btn--sm" @click="loadRooms">重新加载</button>
        </GlassCard>

        <GlassCard v-else-if="!room.loading && room.rooms.length === 0" class="state-card">
          <EmptyState title="还没有开放的房间" description="创建第一个房间，把朋友们叫来一起专注。">
            <button type="button" class="btn btn--ghost btn--sm" @click="roomName = '拾光自习室'">
              填入默认名称
            </button>
          </EmptyState>
        </GlassCard>

        <div v-else class="room-grid">
          <GlassCard v-for="item in room.rooms" :key="item.id" class="room-card" interactive>
            <div class="room-card__top">
              <span class="room-card__date">{{ dayjs(item.createdAt).format('MM-DD HH:mm') }}</span>
              <span class="room-card__capacity numeric">{{ item.memberCount }}/{{ item.maxMembers }}</span>
            </div>

            <strong class="room-card__name">{{ item.name }}</strong>
            <span class="room-card__meta">
              {{ roomFull(item.maxMembers, item.memberCount) ? '房间已满' : '还有空位' }}
            </span>

            <button
              type="button"
              class="room-card__join"
              :disabled="joining || roomFull(item.maxMembers, item.memberCount)"
              @click="joinByCode(item.inviteCode)"
            >
              {{ joiningId === item.inviteCode ? '加入中…' : '加入房间' }}
            </button>
          </GlassCard>
        </div>
      </section>
    </div>
  </AppShell>
</template>

<style scoped>
.lobby-refresh {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.lobby-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.lobby-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.lobby-card__head,
.room-list-section .section__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.lobby-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lobby-label {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--text-tertiary);
}

.lobby-input {
  width: 100%;
  padding: 8px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.lobby-input:focus {
  border-bottom-color: var(--accent);
  box-shadow: 0 1px 0 var(--accent);
}

.lobby-input--code {
  font-family: var(--font-mono);
  letter-spacing: 0.14em;
}

.lobby-primary,
.lobby-secondary {
  min-height: 40px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  background: linear-gradient(140deg, var(--accent), var(--accent-strong));
  color: var(--accent-contrast);
  font-size: 12px;
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    box-shadow var(--dur-base) var(--ease-out);
}

.lobby-secondary {
  border-color: var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
}

.lobby-primary:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--accent) 18%, var(--glass-bg-strong));
  color: var(--text-primary);
  border-color: var(--accent-soft);
  box-shadow: 0 12px 26px -16px var(--accent-strong);
  transition: all 0.3s ease;
}

.lobby-secondary:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--accent) 18%, var(--glass-bg-strong));
  color: var(--text-primary);
  border-color: var(--accent-soft);
  transition: all 0.3s ease;
}

.room-list-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.room-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--space-4);
}

.room-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 174px;
}

.room-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.room-card__date {
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.room-card__capacity {
  font-size: 10px;
  color: var(--text-tertiary);
}

.room-card__name {
  font-size: 18px;
  font-weight: 620;
  color: var(--text-strong);
}

.room-card__meta {
  font-size: 10px;
  color: var(--text-tertiary);
}

.room-card__join {
  margin-top: auto;
  min-height: 34px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 11px;
  cursor: pointer;
}

.room-card__join:hover:not(:disabled) {
  background: var(--glass-bg);
}

.room-card__join:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

@media (max-width: 760px) {
  .lobby-controls {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
