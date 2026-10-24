<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FocusBackground from '@/components/focus/FocusBackground.vue'
import FocusCosmos from '@/components/focus/FocusCosmos.vue'
import FocusThemeSwitcher from '@/components/focus/FocusThemeSwitcher.vue'
import GlobalAudioPlayer from '@/components/audio/GlobalAudioPlayer.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import { useTasks } from '@/composables/useTasks'
import { useSubPlans } from '@/composables/useSubPlans'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useStudyLogs } from '@/composables/useStudyLogs'
import { useTodayTasks } from '@/composables/useTodayTasks'
import { useToast } from '@/composables/useToast'
import { useFocusStore } from '@/stores/focus'
import { useFocusThemeStore } from '@/stores/focusTheme'
import { formatClock } from '@/lib/date'
import {
  MEASURE_STANDARD_LABELS,
  type MasterPlan,
  type SubPlan,
  type Task,
  type TaskStatus,
} from '@/types/models'

/**
 * 沉浸计时页：全屏、无导航、玻璃圆形计时器 + Canvas 微光粒子。
 * - 正计时 / 倒计时可切换；
 * - 结束三选一：完成 / 部分完成 / 放弃；
 * - 中途退出：记录实际时长 / 不记录 / 继续专注。
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()

const taskApi = useTasks()
const subPlanApi = useSubPlans()
const masterPlanApi = useMasterPlans()
const logsApi = useStudyLogs()
const todayApi = useTodayTasks()
const focusStore = useFocusStore()
const focusTheme = useFocusThemeStore()
focusTheme.initialize()

const task = ref<Task | null>(null)
const subPlan = ref<SubPlan | null>(null)
const masterPlan = ref<MasterPlan | null>(null)
const returnTo = ref('/')
const loading = ref(true)
const loadError = ref('')
const saveError = ref('')
const saving = ref(false)

const mode = ref<'countdown' | 'countup'>('countdown')
const elapsed = ref(0)
const running = ref(false)
const completed = ref(false)
const showComplete = ref(false)
const showExit = ref(false)
const partialMinutes = ref(1)

let ticker: number | null = null
let anchorTime = 0
let baseElapsed = 0
let wasRunningBeforeOverlay = false

const targetMinutes = computed(() => task.value?.focusBlock ?? 25)
const targetSeconds = computed(() => targetMinutes.value * 60)
const remainingSeconds = computed(() => Math.max(0, targetSeconds.value - elapsed.value))
const display = computed(() =>
  formatClock(mode.value === 'countdown' ? remainingSeconds.value : elapsed.value),
)
const progress = computed(() => {
  if (targetSeconds.value <= 0) return 1
  return Math.min(1, elapsed.value / targetSeconds.value)
})
const elapsedMinutes = computed(() => Math.max(0, Math.round(elapsed.value / 60)))
const measureLabel = computed(() =>
  task.value ? MEASURE_STANDARD_LABELS[task.value.measureStandard] : '',
)
const totalBlocks = computed(() =>
  task.value ? Math.max(1, Math.ceil(task.value.estMinutes / Math.max(1, task.value.focusBlock))) : 1,
)
const currentBlock = computed(() => {
  if (!task.value) return 1
  const finished = Math.floor(task.value.actualMinutes / Math.max(1, task.value.focusBlock))
  return Math.min(totalBlocks.value, finished + 1)
})

const completePanelRef = ref<HTMLElement | null>(null)
const exitPanelRef = ref<HTMLElement | null>(null)

const backLabel = computed(() => (returnTo.value === '/' ? '回到总计划' : '回到分计划'))

function clearTicker(): void {
  if (ticker !== null) {
    window.clearInterval(ticker)
    ticker = null
  }
}

function tick(): void {
  const now = performance.now()
  elapsed.value = baseElapsed + (now - anchorTime) / 1000
  if (mode.value === 'countdown' && remainingSeconds.value <= 0 && !completed.value) {
    finishCountdown()
  }
}

function startTicker(): void {
  if (ticker !== null || completed.value) return
  anchorTime = performance.now()
  baseElapsed = elapsed.value
  running.value = true
  ticker = window.setInterval(tick, 200)
}

function pauseTicker(): void {
  if (ticker !== null) {
    clearTicker()
    // 把当前秒数固化，避免暂停后继续时时间跳变
    baseElapsed = elapsed.value
  }
  running.value = false
}

function togglePause(): void {
  if (completed.value) return
  if (running.value) pauseTicker()
  else startTicker()
}

function finishCountdown(): void {
  completed.value = true
  pauseTicker()
  elapsed.value = targetSeconds.value
  partialMinutes.value = Math.max(1, Math.round(targetSeconds.value / 60))
  openComplete()
}

function toggleMode(): void {
  if (completed.value) return
  mode.value = mode.value === 'countdown' ? 'countup' : 'countdown'
  if (mode.value === 'countdown' && remainingSeconds.value <= 0) finishCountdown()
}

async function openComplete(): Promise<void> {
  pauseTicker()
  wasRunningBeforeOverlay = false
  showComplete.value = true
  showExit.value = false
  await nextTick()
  completePanelRef.value?.querySelector<HTMLButtonElement>('button')?.focus()
}

function requestFinish(): void {
  if (completed.value) {
    openComplete()
    return
  }
  const wasRunning = running.value
  pauseTicker()
  wasRunningBeforeOverlay = wasRunning
  partialMinutes.value = Math.max(1, elapsedMinutes.value || 1)
  showComplete.value = true
  showExit.value = false
}

function requestExit(): void {
  const wasRunning = running.value
  pauseTicker()
  wasRunningBeforeOverlay = wasRunning
  showComplete.value = false
  showExit.value = true
  nextTick(() => {
    exitPanelRef.value?.querySelector<HTMLButtonElement>('button')?.focus()
  })
}

function continueFocus(): void {
  showExit.value = false
  showComplete.value = false
  if (wasRunningBeforeOverlay) startTicker()
}

function exitWithoutRecord(): void {
  router.replace(returnTo.value)
}

async function saveSession(
  status: Extract<TaskStatus, 'done' | 'partial' | 'skipped'>,
  actualMinutes: number,
): Promise<void> {
  if (!task.value || saving.value) return
  saving.value = true
  saveError.value = ''
  const ok = await logsApi.recordSession({
    task: task.value,
    plannedMinutes: targetMinutes.value,
    actualMinutes,
    status,
  })
  saving.value = false
  if (!ok) {
    saveError.value = logsApi.error.value || '保存失败，请重试。'
    return
  }
  const message =
    status === 'done'
      ? '这一块完成了'
      : status === 'partial'
        ? `已记录 ${Math.round(actualMinutes)} 分钟`
        : '已放弃这次专注'
  toast.success(message)
  await router.replace(returnTo.value)
}

function finishWith(status: 'done' | 'partial' | 'skipped'): void {
  if (status === 'partial') {
    const raw = Number(partialMinutes.value)
    const minutes = Math.min(
      task.value?.estMinutes ?? 999,
      Math.max(1, Number.isFinite(raw) ? Math.round(raw) : 1),
    )
    saveSession('partial', minutes)
    return
  }
  saveSession(status, status === 'done' ? Math.max(1, elapsedMinutes.value) : 0)
}

function recordAndExit(): void {
  const minutes = Math.min(task.value?.estMinutes ?? 999, Math.max(1, elapsedMinutes.value))
  saveSession(minutes >= (task.value?.estMinutes ?? 0) ? 'done' : 'partial', minutes)
}

function pickNextTask(list: Task[]): Task | null {
  const candidates = list
    .filter((item) => item.status === 'pending' || item.status === 'partial')
    .slice()
    .sort((a, b) => {
      const aDate = a.scheduledDate ?? '9999-12-31'
      const bDate = b.scheduledDate ?? '9999-12-31'
      if (aDate !== bDate) return aDate < bDate ? -1 : 1
      return a.createdAt < b.createdAt ? -1 : 1
    })
  return candidates[0] ?? null
}

async function applyTask(loadedTask: Task): Promise<void> {
  task.value = loadedTask
  subPlan.value = await subPlanApi.fetchOne(loadedTask.subPlanId)
  if (subPlan.value) {
    masterPlan.value = await masterPlanApi.fetchOne(subPlan.value.masterPlanId)
    returnTo.value = `/sub-plans/${subPlan.value.id}`
  } else {
    returnTo.value = '/'
  }
}

/**
 * 任务挑选顺序：
 * 1. ?task=xxx  指定任务（每条任务卡片上的深链接仍可用）；
 * 2. ?subPlan=xxx  从该分计划里自动挑「排期最早的未完成任务」；
 * 3. 没有任何参数  从今日任务池（含逾期）里自动挑一个；
 * 4. 挑不到  回到分计划详情（有 subPlan）或总计划列表。
 */
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  const queryTaskId = typeof route.query.task === 'string' ? route.query.task : ''
  const querySubPlanId = typeof route.query.subPlan === 'string' ? route.query.subPlan : ''
  const fromDashboard = route.query.source === 'dashboard'

  try {
    // 首页「快速沉浸」：从当前用户全部 pending 任务里挑截止最近的一个
    if (fromDashboard) {
      const picked = await focusStore.prepareDashboard()
      if (!picked) {
        returnTo.value = '/'
        loadError.value = focusStore.error || '暂时没有可以专注的任务。'
        return
      }
      task.value = picked
      subPlan.value = focusStore.subPlan
      masterPlan.value = focusStore.masterPlan
      returnTo.value = '/'
      return
    }

    // 分计划任务选择弹窗：Pinia 里存 taskId，再进入 /focus
    if (focusStore.selectedTaskId) {
      const selectedId = focusStore.selectedTaskId
      focusStore.clearSelection()
      const loaded = await taskApi.fetchOne(selectedId)
      if (!loaded) {
        loadError.value = taskApi.error.value || '任务不存在，可能已被删除。'
        returnTo.value = '/'
        return
      }
      if (loaded.status === 'done') {
        loadError.value = '这个任务已经完成，去分计划里挑下一个吧。'
        returnTo.value = `/sub-plans/${loaded.subPlanId}`
        return
      }
      await applyTask(loaded)
      return
    }

    if (queryTaskId) {
      const loadedTask = await taskApi.fetchOne(queryTaskId)
      if (!loadedTask) {
        loadError.value = taskApi.error.value || '任务不存在，可能已被删除。'
        return
      }
      if (loadedTask.status === 'done') {
        returnTo.value = `/sub-plans/${loadedTask.subPlanId}`
        loadError.value = '这个任务已经完成，去分计划里挑下一个吧。'
        return
      }
      await applyTask(loadedTask)
      return
    }

    if (querySubPlanId) {
      const plan = await subPlanApi.fetchOne(querySubPlanId)
      if (!plan) {
        loadError.value = subPlanApi.error.value || '分计划不存在，或你没有访问权限。'
        returnTo.value = '/'
        return
      }
      returnTo.value = `/sub-plans/${plan.id}`
      const list = await taskApi.fetchBySubPlan(plan.id)
      if (taskApi.error.value) {
        loadError.value = taskApi.error.value
        return
      }
      const picked = pickNextTask(list)
      if (!picked) {
        toast.push('这个分计划暂时没有待做任务')
        await router.replace(`/sub-plans/${plan.id}`)
        return
      }
      task.value = picked
      subPlan.value = plan
      masterPlan.value = await masterPlanApi.fetchOne(plan.masterPlanId)
      return
    }

    // 没有指定任务：从今日任务池自动挑一个
    await todayApi.load()
    if (todayApi.error.value) {
      loadError.value = todayApi.error.value
      return
    }
    const picked = todayApi.nextTask.value
    if (!picked) {
      toast.push('今天没有待做任务，先去挑一个分计划吧')
      await router.replace('/')
      return
    }
    task.value = picked.task
    subPlan.value = picked.subPlan
    masterPlan.value = picked.masterPlan
    returnTo.value = `/sub-plans/${picked.subPlan.id}`
  } catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : '无法开始专注'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  await nextTick()
  if (task.value) startTicker()
})

onBeforeUnmount(() => {
  clearTicker()
})
</script>

<template>
  <div class="focus">
    <FocusBackground />
    <FocusCosmos :active="running && !completed && !showComplete && !showExit" />


    <div v-if="loading" class="focus__loading">
      <p class="eyebrow">正在进入专注空间</p>
    </div>

    <div v-else-if="loadError" class="focus__error glass">
      <p class="eyebrow">无法开始</p>
      <p class="focus__error-text">{{ loadError }}</p>
      <button type="button" class="focus__ghost" @click="router.replace(returnTo)">
        {{ backLabel }}
      </button>
    </div>

    <template v-else-if="task">
      <header class="focus__top">
        <div class="focus__task">
          <p class="eyebrow">专注中 · {{ subPlan?.name }} / {{ masterPlan?.name }}</p>
          <h1 class="focus__title">{{ task.name }}</h1>
          <p class="focus__measure">衡量标准：{{ measureLabel }}</p>
        </div>
        <p class="focus__blocks numeric">专注块 {{ currentBlock }}/{{ totalBlocks }}</p>
      </header>

      <main class="focus__center">
        <div class="timer-stage" :class="{ 'timer-stage--active': running }">
          <span class="timer-orbit timer-orbit--one" aria-hidden="true"></span>
          <span class="timer-orbit timer-orbit--two" aria-hidden="true"></span>
          <div class="timer" :class="{ 'timer--finished': completed }" :style="{ '--progress': progress }">
            <span class="timer__halo" aria-hidden="true"></span>
            <span class="timer__ring" aria-hidden="true"></span>
            <div class="timer__glass">
              <p class="timer__mode">{{ mode === 'countdown' ? '倒计时' : '正计时' }}</p>
              <p class="timer__digits numeric" :aria-label="`剩余时间 ${display}`">
                <span :key="display" class="timer__digits-inner">{{ display }}</span>
              </p>
              <p class="timer__target">
                {{ mode === 'countdown' ? `目标 ${targetMinutes} 分钟` : `已专注 ${elapsedMinutes} 分钟` }}
              </p>
            </div>
          </div>
        </div>

        <div class="focus__mode">
          <button type="button" class="focus__mode-btn" :aria-pressed="mode === 'countdown'" @click="toggleMode">
            倒计时
          </button>
          <button type="button" class="focus__mode-btn" :aria-pressed="mode === 'countup'" @click="toggleMode">
            正计时
          </button>
        </div>
      </main>

      <footer class="focus__bottom">
        <button type="button" class="focus__ghost" @click="togglePause">
          {{ running ? '暂停' : '继续' }}
        </button>
        <button type="button" class="focus__ghost" @click="requestFinish">提前结束</button>
        <button type="button" class="focus__ghost" @click="requestExit">退出</button>
        <GlobalAudioPlayer tone="focus" class="focus__audio" />
      </footer>

      <!-- 结束三选一 -->
      <Transition name="overlay">
        <div v-if="showComplete" class="overlay" role="presentation">
          <div
            ref="completePanelRef"
            class="glass glass--strong overlay__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="complete-title"
          >
            <p class="eyebrow">这次专注</p>
            <h2 id="complete-title" class="overlay__title">
              {{ completed ? '时间到，感觉如何？' : '要结束这一块了吗？' }}
            </h2>
            <p class="overlay__desc">
              已专注 {{ elapsedMinutes }} 分钟 · 目标 {{ targetMinutes }} 分钟 · 衡量标准：{{ measureLabel }}
            </p>

            <div class="overlay__choices">
              <button type="button" class="choice" :disabled="saving" @click="finishWith('done')">
                <span class="choice__title">完成</span>
                <span class="choice__hint">记录 {{ Math.max(1, elapsedMinutes) }} 分钟</span>
              </button>

              <div class="choice choice--partial">
                <span class="choice__title">部分完成</span>
                <div class="choice__input-row">
                  <input
                    v-model.number="partialMinutes"
                    class="input choice__input numeric"
                    type="number"
                    min="1"
                    :max="task.estMinutes"
                    aria-label="实际专注分钟数"
                  />
                  <span class="tiny faint">分钟</span>
                </div>
                <button
                  type="button"
                  class="choice__confirm"
                  :disabled="saving"
                  @click="finishWith('partial')"
                >
                  记录
                </button>
              </div>

              <button type="button" class="choice choice--muted" :disabled="saving" @click="finishWith('skipped')">
                <span class="choice__title">放弃</span>
                <span class="choice__hint">不计入时长，记录一次跳过</span>
              </button>
            </div>

            <p v-if="saveError" class="error-text" role="alert">{{ saveError }}</p>
            <p v-if="saving" class="tiny faint">正在保存…</p>

            <button
              v-if="!completed"
              type="button"
              class="link-btn overlay__back"
              :disabled="saving"
              @click="continueFocus"
            >
              继续专注
            </button>          </div>
        </div>
      </Transition>

      <!-- 中途退出确认 -->
      <Transition name="overlay">
        <div v-if="showExit" class="overlay" role="presentation">
          <div
            ref="exitPanelRef"
            class="glass glass--strong overlay__panel overlay__panel--compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-title"
          >
            <h2 id="exit-title" class="overlay__title">要离开专注吗？</h2>
            <p class="overlay__desc">已专注 {{ elapsedMinutes }} 分钟。</p>
            <div class="overlay__stack">
              <SpriteButton :disabled="saving || elapsedMinutes < 1" @click="recordAndExit">
                记录 {{ elapsedMinutes }} 分钟并退出
              </SpriteButton>
              <button
                type="button"
                class="btn btn--ghost overlay__exit-ghost"
                :disabled="saving"
                @click="exitWithoutRecord"
              >
                不记录，直接退出
              </button>
              <button type="button" class="link-btn" @click="continueFocus">继续专注</button>
            </div>
            <p v-if="saveError" class="error-text" role="alert">{{ saveError }}</p>
          </div>
        </div>
      </Transition>
    </template>

    <FocusThemeSwitcher />
  </div>
</template>

<style scoped>
.focus {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--focus-text);
  background:
    radial-gradient(80% 60% at 50% 18%, var(--focus-halo), transparent 70%),
    radial-gradient(70% 60% at 50% 100%, var(--focus-glass), transparent 70%),
    var(--focus-bg);
  isolation: isolate;
}

.focus::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E");
  opacity: 0.05;
  pointer-events: none;
}

.focus__loading,
.focus__error {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
}

.focus__error {
  border-radius: var(--radius-lg);
  background: var(--focus-glass);
  border: 1px solid var(--focus-border);
  max-width: 420px;
}

.focus__error-text {
  font-size: 13px;
  color: var(--focus-text-soft);
  line-height: 1.7;
}

.focus .eyebrow {
  color: var(--focus-text-faint);
}

.focus__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-5);
  padding: clamp(20px, 4vw, 40px) clamp(20px, 5vw, 56px) 0;
}

.focus__task {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 640px;
}

.focus__title {
  font-size: clamp(20px, 3.2vw, 28px);
  color: var(--focus-text-strong);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.focus__measure {
  font-size: 12px;
  color: var(--focus-text-soft);
}

.focus__blocks {
  flex: 0 0 auto;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--focus-text-faint);
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--focus-border);
}

.focus__center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(24px, 5vh, 40px);
  padding: var(--space-4);
}

/* 3D 悬浮星环 + 计时器 */
.timer-stage {
  position: relative;
  width: min(66vw, 380px);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  perspective: 900px;
}

.timer {
  position: relative;
  z-index: 2;
  width: 100%;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: 50%;
}

.timer-orbit {
  position: absolute;
  inset: -11%;
  z-index: 1;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, transparent);
  box-shadow:
    0 0 24px var(--accent-soft),
    inset 0 0 18px color-mix(in srgb, var(--accent) 12%, transparent);
  transform: rotateX(66deg) rotateZ(12deg);
  transform-style: preserve-3d;
  animation: orbit-spin 16s linear infinite;
  pointer-events: none;
}

.timer-orbit::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg 62deg,
    color-mix(in srgb, var(--accent) 82%, transparent) 92deg,
    transparent 130deg 360deg
  );
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
}

.timer-orbit--two {
  inset: -20%;
  border-color: color-mix(in srgb, var(--focus-ring) 28%, transparent);
  transform: rotateX(72deg) rotateZ(-24deg);
  animation-duration: 24s;
  animation-direction: reverse;
}

.timer-orbit--two::after {
  background: conic-gradient(
    from 180deg,
    transparent 0deg 110deg,
    color-mix(in srgb, var(--focus-ring) 65%, transparent) 140deg,
    transparent 190deg 360deg
  );
}

.timer-stage--active .timer-orbit {
  animation-play-state: running;
}

.timer-stage:not(.timer-stage--active) .timer-orbit {
  animation-play-state: paused;
}

.timer__halo {
  position: absolute;
  inset: -14%;
  border-radius: 50%;
  background: radial-gradient(circle, var(--focus-halo), transparent 68%);
  filter: blur(12px);
  opacity: 0.8;
  animation: halo-breathe 5.4s ease-in-out infinite;
}

.timer--finished .timer__halo {
  animation: halo-pulse 1.15s var(--ease-out) 2;
}

.timer__ring {
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  background: conic-gradient(
    from -90deg,
    var(--focus-ring) calc(var(--progress) * 1turn),
    color-mix(in srgb, var(--focus-text) 6%, transparent) 0
  );
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
  opacity: 0.9;
}

.timer__glass {
  position: absolute;
  inset: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: 50%;
  background: var(--focus-glass);
  border: 1px solid var(--focus-border);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--focus-text) 22%, transparent),
    inset 0 -20px 60px var(--focus-halo),
    0 30px 80px -40px var(--focus-overlay);
  -webkit-backdrop-filter: blur(28px) saturate(140%);
  backdrop-filter: blur(28px) saturate(140%);
}

.timer__mode {
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--focus-text-faint);
}

.timer__digits {
  font-size: clamp(48px, 10vw, 76px);
  font-weight: 300;
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--focus-text-strong);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 32px var(--focus-halo);
}

.timer__digits-inner {
  display: inline-block;
  animation: digit-in 260ms var(--ease-out);
}

.timer__target {
  font-size: 12px;
  color: var(--focus-text-faint);
}

.focus__mode {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--focus-glass);
  border: 1px solid var(--focus-border);
}

.focus__mode-btn {
  padding: 6px 16px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--focus-text-soft);
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.focus__mode-btn[aria-pressed='true'] {
  background: var(--focus-border);
  color: var(--focus-text-strong);
}

.focus__bottom {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: 0 var(--space-5) clamp(24px, 4vw, 40px);
  flex-wrap: wrap;
}

.focus__ghost {
  padding: 9px 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--focus-border);
  background: var(--focus-glass);
  color: var(--focus-text-soft);
  font-size: 13px;
  cursor: pointer;
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.focus__ghost:hover {
  background: var(--focus-border);
  color: var(--focus-text-strong);
  transform: translateY(-1px);
}

/* 结束 / 退出弹层 */
.overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: var(--focus-overlay);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}

.overlay__panel {
  width: min(520px, 94vw);
  padding: clamp(24px, 4vw, 34px);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  background: var(--focus-panel);
  border-color: var(--focus-border);
}

.overlay__panel--compact {
  width: min(400px, 94vw);
}

.overlay__title {
  font-size: clamp(20px, 3.4vw, 24px);
  color: var(--focus-text-strong);
}

.overlay__desc {
  font-size: 13px;
  color: var(--focus-text-soft);
  line-height: 1.7;
}

.overlay__exit-ghost {
  color: var(--focus-text-color);
  border-color: var(--focus-border);
  background: var(--focus-glass);
}

.overlay__exit-ghost:hover:not(:disabled),
.overlay__exit-ghost:focus-visible {
  color: var(--focus-text-strong);
  background: color-mix(in srgb, var(--focus-text-color) 14%, transparent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.overlay__exit-ghost:disabled {
  opacity: 0.5;
}

.overlay__choices {
  display: grid;
  gap: 10px;
}

.choice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: 14px 18px;
  border-radius: var(--radius-md);
  border: 1px solid var(--focus-border);
  background: var(--focus-glass);
  color: var(--focus-text-strong);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.choice:hover:not(:disabled) {
  background: var(--focus-border);
  transform: translateY(-1px);
}

.choice__title {
  font-size: 15px;
  font-weight: 560;
}

.choice__hint {
  font-size: 12px;
  color: var(--focus-text-faint);
}

.choice--partial {
  align-items: center;
  cursor: default;
}

.choice--muted {
  color: var(--focus-text-soft);
}

.choice__input-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.choice__input {
  width: 80px;
  min-height: 38px;
  padding: 6px 10px;
  background: var(--focus-glass);
  border-color: var(--focus-border);
  color: var(--focus-text-strong);
  text-align: center;
}

.choice__confirm {
  padding: 7px 16px;
  border-radius: var(--radius-pill);
  border: 0;
  background: var(--accent);
  color: var(--focus-bg);
  font-size: 12px;
  font-weight: 560;
  cursor: pointer;
}

.overlay__back {
  align-self: center;
  color: var(--focus-text-soft);
}

.overlay__stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.overlay-enter-active,
.overlay-leave-active {
  transition: opacity var(--dur-base) var(--ease-out);
}

.overlay-enter-active .overlay__panel,
.overlay-leave-active .overlay__panel {
  transition: transform var(--dur-base) var(--ease-spring);
}

.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}

.overlay-enter-from .overlay__panel,
.overlay-leave-to .overlay__panel {
  transform: scale(0.94) translateY(10px);
}

@keyframes halo-breathe {
  0%,
  100% {
    opacity: 0.5;
    transform: scale(1);
  }
  /* 吸气快 */
  28% {
    opacity: 0.92;
    transform: scale(1.05);
  }
  /* 呼气慢 */
  48% {
    opacity: 0.72;
    transform: scale(1.02);
  }
  78% {
    opacity: 0.56;
    transform: scale(0.995);
  }
}

@keyframes orbit-spin {
  from {
    transform: rotateX(66deg) rotateZ(0deg);
  }
  to {
    transform: rotateX(66deg) rotateZ(360deg);
  }
}

@keyframes halo-pulse {
  0% {
    opacity: 0.9;
    transform: scale(1);
  }
  55% {
    opacity: 0.35;
    transform: scale(1.18);
  }
  100% {
    opacity: 0.9;
    transform: scale(1);
  }
}

@keyframes digit-in {
  from {
    opacity: 0.65;
    transform: scale(0.94);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 640px) {
  .timer-stage {
    width: min(82vw, 320px);
  }

  .focus__top {
    flex-direction: column;
    gap: 10px;
  }

  .focus__bottom {
    gap: 8px;
  }

  .focus__ghost {
    padding: 8px 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .timer__halo,
  .timer--finished .timer__halo,
  .timer__digits-inner,
  .timer-orbit {
    animation: none;
  }

  .choice:hover:not(:disabled),
  .focus__ghost:hover {
    transform: none;
  }

  .overlay-enter-from .overlay__panel,
  .overlay-leave-to .overlay__panel {
    transform: none;
  }
}
/* --------------------------------------------------------------------------
   主题桥接：沉浸页保持暗色氛围，但所有层级颜色跟随当前主题
   -------------------------------------------------------------------------- */
.focus {
  color: var(--focus-text);
  background: var(--cosmos-bg);
}

.focus__top,
.focus__center,
.focus__bottom,
.focus__loading,
.focus__error {
  position: relative;
  z-index: 2;
}

.focus__error {
  background: var(--focus-glass);
  border-color: var(--focus-border);
}

.focus__error-text,
.focus .eyebrow,
.focus__measure,
.focus__blocks,
.timer__mode,
.timer__target,
.focus__mode-btn,
.focus__ghost,
.overlay__desc,
.choice__hint,
.choice--muted,
.overlay__back {
  color: var(--focus-text-soft);
}

.focus__title,
.timer__digits,
.overlay__title,
.focus__mode-btn[aria-pressed='true'],
.focus__ghost:hover,
.choice,
.choice:hover:not(:disabled),
.choice__input,
.timer__digits-inner {
  color: var(--focus-text-strong);
}

.timer__halo {
  background: radial-gradient(circle, var(--focus-halo), transparent 68%);
}

.timer__ring {
  background: conic-gradient(
    from -90deg,
    var(--focus-ring) calc(var(--progress) * 1turn),
    color-mix(in srgb, var(--focus-text) 7%, transparent) 0
  );
}

.timer__glass {
  background: var(--focus-glass);
  border-color: var(--focus-border);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--focus-text) 18%, transparent),
    inset 0 -20px 60px var(--focus-halo),
    0 30px 80px -40px var(--focus-overlay);
}

.timer__digits {
  text-shadow: 0 0 32px var(--focus-halo);
}

.focus__mode {
  background: var(--focus-glass);
  border-color: var(--focus-border);
}

.focus__mode-btn[aria-pressed='true'] {
  background: color-mix(in srgb, var(--focus-text) 12%, transparent);
}

.focus__ghost {
  border-color: var(--focus-border);
  background: var(--focus-glass);
}

.focus__ghost:hover {
  background: color-mix(in srgb, var(--focus-text) 10%, transparent);
}

.overlay {
  background: var(--focus-overlay);
}

.overlay__panel {
  background: var(--focus-panel);
  border-color: var(--focus-border);
}

.choice {
  border-color: var(--focus-border);
  background: var(--focus-glass);
}

.choice:hover:not(:disabled) {
  background: color-mix(in srgb, var(--focus-text) 10%, transparent);
}

.choice__input {
  background: var(--focus-glass);
  border-color: var(--focus-border);
}

.choice__confirm {
  background: var(--focus-accent);
  color: var(--focus-bg);
}

/* --------------------------------------------------------------------------
   沉浸主题：背景图之上只保留计时 UI；颜色/发光完全由 CSS 变量驱动
   -------------------------------------------------------------------------- */
.focus {
  background: transparent;
}

.timer__digits {
  color: var(--focus-text-color);
  text-shadow: var(--focus-text-shadow);
}

.timer__ring {
  filter: drop-shadow(0 0 10px var(--ring-glow));
}

.timer__halo {
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--ring-glow) 42%, transparent),
    transparent 68%
  );
}

.focus__top,
.focus__center,
.focus__bottom {
  z-index: 2;
}

.focus__audio {
  margin-left: 4px;
}

@media (max-width: 760px) {
  .focus__audio {
    margin-left: 0;
  }
}

</style>
