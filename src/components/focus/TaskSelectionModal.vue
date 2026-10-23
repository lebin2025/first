<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { formatCN } from '@/lib/date'
import type { Task } from '@/types/models'

/**
 * 任务选择弹窗：只展示 pending，点击任务 -> Pinia 存 taskId -> /focus。
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    tasks: Task[]
    title?: string
    subtitle?: string
  }>(),
  {
    title: '选择这次要专注的任务',
    subtitle: '从非「已完成」任务里挑一个，进入后只保留眼前这一块。',
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'select', task: Task): void
}>()

const panelRef = ref<HTMLElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
let lastActive: HTMLElement | null = null

const pendingTasks = computed(() => props.tasks.filter((task) => task.status !== 'done'))

function close(): void {
  emit('update:modelValue', false)
}

function choose(task: Task): void {
  emit('select', task)
  close()
}

function getFocusable(): HTMLElement[] {
  const panel = panelRef.value
  if (!panel) return []
  return Array.from(
    panel.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ).filter((element) => element.offsetParent !== null)
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.modelValue) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = getFocusable()
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (!first || !last) return
  if (event.shiftKey && (active === first || active === panelRef.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      lastActive = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      closeButtonRef.value?.focus()
    } else {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeydown)
      lastActive?.focus()
      lastActive = null
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
    <Transition name="task-modal">
      <div v-if="modelValue" class="task-modal" role="presentation" @click.self="close">
        <div
          ref="panelRef"
          class="task-modal__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-modal-title"
          tabindex="-1"
        >
          <header class="task-modal__head">
            <div>
              <span class="task-modal__eyebrow">FOCUS / 选择任务</span>
              <h2 id="task-modal-title">{{ title }}</h2>
              <p>{{ subtitle }}</p>
            </div>
            <button ref="closeButtonRef" type="button" class="task-modal__close" aria-label="关闭" @click="close">
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
            </button>
          </header>

          <div v-if="pendingTasks.length === 0" class="task-modal__empty">
            <p>这个分计划暂时没有未完成任务。</p>
            <button type="button" class="btn btn--ghost btn--sm" @click="close">返回分计划</button>
          </div>

          <ul v-else class="task-modal__list">
            <li v-for="task in pendingTasks" :key="task.id">
              <button type="button" class="task-choice" @click="choose(task)">
                <span class="task-choice__dot" aria-hidden="true"></span>
                <span class="task-choice__body">
                  <strong>{{ task.name }}</strong>
                  <small>
                    {{ task.estMinutes }} 分钟 · 每块 {{ task.focusBlock }} 分钟 ·
                    {{ task.scheduledDate ? formatCN(task.scheduledDate) : '未排期' }}
                  </small>
                </span>
                <span class="task-choice__arrow" aria-hidden="true">→</span>
              </button>
            </li>
          </ul>

          <footer class="task-modal__foot">
            <span class="tiny faint">进入后会自动开始倒计时 · 可随时暂停</span>
            <button type="button" class="btn btn--ghost btn--sm" @click="close">取消</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.task-modal {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  overflow: hidden;
  background: color-mix(in srgb, var(--overlay) 58%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.task-modal__panel {
  width: min(560px, 94vw);
  max-height: min(760px, 88vh);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow: hidden;
  padding: clamp(20px, 3vw, 30px);
  border-radius: 24px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(26px) saturate(145%);
  backdrop-filter: blur(26px) saturate(145%);
}

.task-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.task-modal__eyebrow {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.task-modal__head h2 {
  margin-top: 4px;
  font-size: clamp(20px, 3vw, 24px);
}

.task-modal__head p {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.task-modal__close {
  position: relative;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  cursor: pointer;
}

.task-modal__close span {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 12px;
  height: 1.4px;
  border-radius: 2px;
  background: var(--text-primary);
}

.task-modal__close span:first-child {
  transform: translate(-50%, -50%) rotate(45deg);
}

.task-modal__close span:last-child {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.task-modal__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  padding-right: 2px;
}

.task-modal__list::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.task-choice {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.task-choice:hover,
.task-choice:focus-visible {
  outline: none;
  transform: translateX(6px);
  border-color: var(--accent-soft);
  background: var(--glass-bg);
}

.task-choice__dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-softer);
}

.task-choice__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.task-choice__body strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}

.task-choice__body small {
  font-size: 10px;
  color: var(--text-tertiary);
}

.task-choice__arrow {
  color: var(--text-tertiary);
  transition: transform var(--dur-base) var(--ease-spring);
}

.task-choice:hover .task-choice__arrow {
  color: var(--accent);
  transform: translate(3px, -3px);
}

.task-modal__empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.task-modal__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line-soft);
}

.task-modal-enter-active,
.task-modal-leave-active {
  transition: opacity var(--dur-base) var(--ease-out);
}

.task-modal-enter-active .task-modal__panel,
.task-modal-leave-active .task-modal__panel {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.task-modal-enter-from,
.task-modal-leave-to {
  opacity: 0;
}

.task-modal-enter-from .task-modal__panel,
.task-modal-leave-to .task-modal__panel {
  transform: translateY(12px) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .task-modal-enter-active .task-modal__panel,
  .task-modal-leave-active .task-modal__panel {
    transition: none;
  }

  .task-choice:hover,
  .task-choice:focus-visible {
    transform: none;
  }
}
</style>
