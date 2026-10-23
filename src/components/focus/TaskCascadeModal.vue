<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatCN } from '@/lib/date'
import { useFocusStore } from '@/stores/focus'
import { useCascadeStore } from '@/stores/cascade'
import type { Task } from '@/types/models'

/**
 * 首页「快速沉浸」的级联选择器：
 * 级联状态在 useCascadeStore；本组件只负责弹窗、渲染与最终跳转。
 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()

const router = useRouter()
const focusStore = useFocusStore()
const cascade = useCascadeStore()
const panelRef = ref<HTMLElement | null>(null)

const stageTitle = computed(() => {
  if (cascade.stage === 1) return '先选一个总计划'
  if (cascade.stage === 2) return '再选一个分计划'
  return '最后选这次要做的任务'
})

function close(): void {
  emit('update:modelValue', false)
}

function open(): void {
  cascade.reset()
  void cascade.loadMasters()
}

async function chooseTask(task: Task): Promise<void> {
  focusStore.selectTask(task.id)
  close()
  await router.push('/focus')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

watch(
  () => props.modelValue,
  async (openState) => {
    if (openState) {
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      panelRef.value?.focus()
      open()
    } else {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeydown)
    }
  },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="cascade">
      <div v-if="modelValue" class="cascade-modal" @click.self="close">
        <div ref="panelRef" class="cascade-panel" role="dialog" aria-modal="true" tabindex="-1">
          <header class="cascade-head">
            <div>
              <span class="cascade-eyebrow">QUICK FOCUS / 快速沉浸</span>
              <h2>{{ stageTitle }}</h2>
              <p>{{ cascade.selectedMaster?.name || '总计划' }} <template v-if="cascade.selectedSub">/ {{ cascade.selectedSub.name }}</template></p>
            </div>
            <button type="button" class="cascade-close" aria-label="关闭" @click="close">×</button>
          </header>

          <div class="cascade-steps" aria-label="选择进度">
            <span :class="{ 'is-active': cascade.stage >= 1 }">01 总计划</span>
            <span :class="{ 'is-active': cascade.stage >= 2 }">02 分计划</span>
            <span :class="{ 'is-active': cascade.stage >= 3 }">03 任务</span>
          </div>

          <p v-if="cascade.error" class="cascade-error" role="alert">{{ cascade.error }}</p>
          <p v-if="cascade.loading" class="cascade-loading">正在读取…</p>

          <div v-else class="cascade-list">
            <template v-if="cascade.stage === 1">
              <button
                v-for="master in cascade.masters"
                :key="master.id"
                type="button"
                class="cascade-item"
                @click="cascade.chooseMaster(master)"
              >
                <span class="cascade-item__body">
                  <strong>{{ master.name }}</strong>
                  <small>{{ formatCN(master.deadline) }} 截止</small>
                </span>
                <span class="cascade-item__arrow">→</span>
              </button>
              <p v-if="cascade.masters.length === 0" class="cascade-empty">还没有未完成的总计划。</p>
            </template>

            <template v-else-if="cascade.stage === 2">
              <button
                v-for="sub in cascade.subPlans"
                :key="sub.id"
                type="button"
                class="cascade-item"
                @click="cascade.chooseSub(sub)"
              >
                <span class="cascade-item__body">
                  <strong>{{ sub.name }}</strong>
                  <small>{{ formatCN(sub.deadline) }} 截止 · 每周 {{ sub.bufferDays }} 天缓冲</small>
                </span>
                <span class="cascade-item__arrow">→</span>
              </button>
              <p v-if="cascade.subPlans.length === 0" class="cascade-empty">这个总计划下还没有分计划。</p>
            </template>

            <template v-else>
              <button
                v-for="task in cascade.tasks"
                :key="task.id"
                type="button"
                class="cascade-item"
                @click="chooseTask(task)"
              >
                <span class="cascade-item__body">
                  <strong>{{ task.name }}</strong>
                  <small>
                    {{ task.estMinutes }} 分钟 · {{ task.scheduledDate ? formatCN(task.scheduledDate) : '未排期' }}
                  </small>
                </span>
                <span class="cascade-item__arrow">→</span>
              </button>
              <p v-if="cascade.tasks.length === 0" class="cascade-empty">这个分计划下没有可专注的任务。</p>
            </template>
          </div>

          <footer class="cascade-foot">
            <button v-if="cascade.stage > 1" type="button" class="cascade-back" @click="cascade.back">← 上一步</button>
            <span class="tiny faint">只显示未完成（status !== done）的实体</span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cascade-modal {
  position: fixed;
  inset: 0;
  z-index: 1150;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: color-mix(in srgb, var(--overlay) 58%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.cascade-panel {
  width: min(520px, 94vw);
  max-height: min(720px, 88vh);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: clamp(20px, 3vw, 28px);
  border-radius: 24px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(26px) saturate(145%);
  backdrop-filter: blur(26px) saturate(145%);
}

.cascade-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.cascade-eyebrow {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.cascade-head h2 {
  margin-top: 4px;
  font-size: 22px;
}

.cascade-head p {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-secondary);
}

.cascade-close {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 17px;
  cursor: pointer;
}

.cascade-steps {
  display: flex;
  gap: 6px;
  font-size: 9px;
  color: var(--text-tertiary);
}

.cascade-steps span {
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line-soft);
}

.cascade-steps span.is-active {
  border-color: var(--accent-soft);
  background: var(--accent-softer);
  color: var(--accent-strong);
}

.cascade-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 120px;
  max-height: 390px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

.cascade-list::-webkit-scrollbar {
  display: none;
}

.cascade-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out);
}

.cascade-item:hover {
  transform: translateX(5px);
  background: var(--glass-bg);
}

.cascade-item__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cascade-item__body strong {
  font-size: 14px;
  color: var(--text-strong);
}

.cascade-item__body small {
  font-size: 10px;
  color: var(--text-tertiary);
}

.cascade-item__arrow {
  color: var(--accent);
}

.cascade-empty,
.cascade-loading,
.cascade-error {
  margin: auto;
  padding: var(--space-4);
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
}

.cascade-error {
  color: var(--danger);
}

.cascade-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line-soft);
}

.cascade-back {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.cascade-enter-active,
.cascade-leave-active {
  transition: opacity var(--dur-base) var(--ease-out);
}

.cascade-enter-active .cascade-panel,
.cascade-leave-active .cascade-panel {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.cascade-enter-from,
.cascade-leave-to {
  opacity: 0;
}

.cascade-enter-from .cascade-panel,
.cascade-leave-to .cascade-panel {
  transform: translateY(12px) scale(0.96);
}
</style>
