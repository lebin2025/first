<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{ roomId: string }>()

const auth = useAuthStore()
const chat = useChatStore()
const open = ref(false)
const draft = ref('')
const listRef = ref<HTMLElement | null>(null)

const canSend = computed(() => draft.value.trim().length > 0 && !chat.sending)

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const list = listRef.value
  if (list) list.scrollTop = list.scrollHeight
}

async function init(): Promise<void> {
  if (!props.roomId) return
  await chat.load(props.roomId)
  await scrollToBottom()
}

async function send(): Promise<void> {
  if (!canSend.value) return
  const content = draft.value
  draft.value = ''
  const ok = await chat.send(content)
  if (!ok) draft.value = content
  await scrollToBottom()
}

function toggle(): void {
  open.value = !open.value
  if (open.value) void scrollToBottom()
}

watch(
  () => chat.messages.length,
  () => {
    if (open.value) void scrollToBottom()
  },
)

watch(
  () => props.roomId,
  () => void init(),
)

onMounted(init)
onBeforeUnmount(() => {
  // 必须清除 5 秒轮询 timer，避免页面离开后继续请求
  chat.stopPolling()
  chat.reset()
})
</script>

<template>
  <div class="chat-dock">
    <Transition name="chat-panel">
      <aside v-if="open" class="chat-panel" aria-label="房间聊天">
        <header class="chat-panel__head">
          <div>
            <span class="chat-panel__eyebrow">ROOM CHAT</span>
            <strong>房间消息</strong>
          </div>
          <button type="button" class="chat-panel__close" aria-label="收起聊天" @click="open = false">
            <span></span><span></span>
          </button>
        </header>

        <div ref="listRef" class="chat-list" aria-live="polite">
          <p v-if="chat.loading" class="chat-empty">正在读取消息…</p>
          <p v-else-if="chat.messages.length === 0" class="chat-empty">还没有消息，打个招呼吧。</p>

          <div
            v-for="message in chat.messages"
            :key="message.id"
            class="chat-message"
            :class="{ 'is-own': message.userId === auth.userId, 'is-pending': message.pending }"
          >
            <span class="chat-message__name">{{ message.nickname }}</span>
            <span class="chat-message__bubble">{{ message.content }}</span>
            <span class="chat-message__time">{{ dayjs(message.createdAt).format('HH:mm') }}</span>
          </div>
        </div>

        <p v-if="chat.error" class="chat-error" role="alert">{{ chat.error }}</p>

        <form class="chat-form" @submit.prevent="send">
          <input
            v-model="draft"
            class="chat-input"
            type="text"
            maxlength="1000"
            placeholder="说点什么…"
            aria-label="聊天消息"
          />
          <button type="submit" class="chat-send" :disabled="!canSend">发送</button>
        </form>
      </aside>
    </Transition>

    <button
      type="button"
      class="chat-fab"
      :class="{ 'is-open': open }"
      :aria-expanded="open"
      aria-label="打开房间聊天"
      @click="toggle"
    >
      <span class="chat-fab__icon" aria-hidden="true">✦</span>
      <span>聊天</span>
      <span v-if="chat.messages.length" class="chat-fab__count">{{ chat.messages.length }}</span>
    </button>
  </div>
</template>

<style scoped>
.chat-dock {
  position: fixed;
  left: clamp(14px, 2vw, 24px);
  bottom: clamp(14px, 2vw, 24px);
  z-index: 45;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.chat-fab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  color: var(--text-primary);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
  font-size: 11px;
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out);
}

.chat-fab:hover {
  transform: translateY(-2px);
  background: var(--glass-bg-hover);
}

.chat-fab__icon {
  color: var(--accent);
}

.chat-fab__count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 8px;
}

.chat-panel {
  width: min(330px, calc(100vw - 28px));
  height: 50vh;
  min-height: 300px;
  max-height: 50vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 20px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(24px) saturate(145%);
  backdrop-filter: blur(24px) saturate(145%);
}

.chat-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.chat-panel__head > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.chat-panel__eyebrow {
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.chat-panel__head strong {
  font-size: 14px;
  color: var(--text-strong);
}

.chat-panel__close {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  cursor: pointer;
}

.chat-panel__close span {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 1.3px;
  background: var(--text-primary);
}

.chat-panel__close span:first-child {
  transform: translate(-50%, -50%) rotate(45deg);
}

.chat-panel__close span:last-child {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.chat-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 1;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 3px 2px;
  scrollbar-width: none;
}

.chat-list::-webkit-scrollbar {
  display: none;
}

.chat-empty {
  margin: auto;
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: center;
}

.chat-message {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  max-width: 90%;
}

.chat-message.is-own {
  align-self: flex-end;
  align-items: flex-end;
}

.chat-message__name {
  font-size: 8px;
  color: var(--text-tertiary);
}

.chat-message__bubble {
  padding: 7px 10px;
  border-radius: 13px;
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.5;
  word-break: break-word;
}

.chat-message.is-own .chat-message__bubble {
  border-color: var(--accent-soft);
  background: var(--accent-softer);
}

.chat-message.is-pending .chat-message__bubble {
  opacity: 0.55;
}

.chat-message__time {
  font-size: 8px;
  color: var(--text-tertiary);
}

.chat-error {
  font-size: 9px;
  color: var(--danger);
}

.chat-form {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-input {
  flex: 1;
  min-width: 0;
  padding: 7px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
}

.chat-input:focus {
  border-bottom-color: var(--accent);
  box-shadow: 0 1px 0 var(--accent);
}

.chat-send {
  min-height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 10px;
  cursor: pointer;
}

.chat-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-panel-enter-active,
.chat-panel-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.chat-panel-enter-from,
.chat-panel-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .chat-panel-enter-active,
  .chat-panel-leave-active,
  .chat-fab {
    transition: none;
  }
}
</style>
