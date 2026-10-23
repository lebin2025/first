<script setup lang="ts">
import { computed } from 'vue'
import type { DiagnosticPatch, DiagnosticReport } from '@/engine/diagnostics'

/** 规则诊断展示：阻断 > 警告 > 通过（折叠），每条附「采纳建议」 */
const props = defineProps<{
  report: DiagnosticReport
  applying?: boolean
}>()

const emit = defineEmits<{ (event: 'apply', patch: DiagnosticPatch): void }>()

const active = computed(() =>
  props.report.items
    .filter((item) => item.level !== 'pass')
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'block' ? -1 : 1)),
)
const passed = computed(() => props.report.items.filter((item) => item.level === 'pass'))
</script>

<template>
  <section class="diagnostics" aria-label="规则诊断结果">
    <header class="diagnostics__head">
      <div>
        <p class="section__title">规则诊断</p>
        <p class="diagnostics__hint">
          {{ report.hasBlocking ? '存在阻断项，处理后才能保存' : report.hasWarning ? '有可优化的警告，也可以直接保存' : '全部通过，可以保存' }}
        </p>
      </div>
      <div class="diagnostics__counts" role="status">
        <span class="count count--block">{{ report.blockCount }} 阻断</span>
        <span class="count count--warn">{{ report.warnCount }} 警告</span>
        <span class="count count--pass">{{ report.passCount }} 通过</span>
      </div>
    </header>

    <ul v-if="active.length" class="diagnostics__list">
      <li v-for="item in active" :key="item.id" class="diag" :class="`diag--${item.level}`">
        <span class="diag__mark" aria-hidden="true">{{ item.level === 'block' ? '⛔' : '⚠️' }}</span>
        <div class="diag__body">
          <div class="diag__title">
            {{ item.title }}
            <span class="diag__rule">{{ item.rule }}</span>
          </div>
          <p class="diag__message">{{ item.message }}</p>
          <button
            v-if="item.suggestion"
            type="button"
            class="diag__apply"
            :disabled="applying"
            @click="emit('apply', item.suggestion.patch)"
          >
            {{ item.suggestion.label }} →
          </button>
        </div>
      </li>
    </ul>

    <p v-else class="diagnostics__all-pass">✅ 没有警告或阻断项。</p>

    <details v-if="passed.length" class="diagnostics__pass">
      <summary>通过项 {{ passed.length }} 条</summary>
      <ul>
        <li v-for="item in passed" :key="item.id">
          <span class="pass-check" aria-hidden="true">✓</span>
          <span><strong>{{ item.title }}</strong>：{{ item.message }}</span>
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.diagnostics {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.diagnostics__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.diagnostics__hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.diagnostics__counts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.count {
  padding: 2px 9px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.count--block {
  color: var(--danger);
  background: var(--danger-soft);
}

.count--warn {
  color: var(--warning);
  background: var(--warning-soft);
}

.count--pass {
  color: var(--success);
  background: var(--success-soft);
}

.diagnostics__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.diag {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: var(--glass-bg-soft);
  animation: diag-in var(--dur-base) var(--ease-spring-soft) both;
}

.diag--warn {
  border-color: color-mix(in srgb, var(--warning) 28%, transparent);
  background: color-mix(in srgb, var(--warning-soft) 60%, var(--glass-bg-soft));
}

.diag--block {
  border-color: color-mix(in srgb, var(--danger) 32%, transparent);
  background: color-mix(in srgb, var(--danger-soft) 60%, var(--glass-bg-soft));
}

.diag__mark {
  font-size: 15px;
  line-height: 1.5;
}

.diag__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.diag__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}

.diag__rule {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}

.diag__message {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
}

.diag__apply {
  align-self: flex-start;
  margin-top: 4px;
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line);
  background: var(--glass-bg);
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 560;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-spring);
}

.diag__apply:hover:not(:disabled) {
  background: var(--accent-soft);
  transform: translateY(-1px);
}

.diag__apply:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.diagnostics__all-pass {
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--success-soft);
  color: var(--success);
  font-size: 13px;
}

.diagnostics__pass {
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: var(--glass-bg-soft);
  padding: 10px 14px;
}

.diagnostics__pass summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
  list-style: none;
}

.diagnostics__pass summary::-webkit-details-marker {
  display: none;
}

.diagnostics__pass summary::before {
  content: '展开 ';
  color: var(--text-faint);
}

.diagnostics__pass[open] summary::before {
  content: '收起 ';
}

.diagnostics__pass ul {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.diagnostics__pass li {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}

.pass-check {
  color: var(--success);
  font-weight: 700;
}

@keyframes diag-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
