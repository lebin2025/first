<script setup lang="ts">
import { computed, onMounted } from 'vue'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useStats } from '@/composables/useStats'
import { formatCN } from '@/lib/date'

/** 统计页：只读、轻量、无复杂筛选 */
const stats = useStats()

const data = computed(() => stats.data.value)
const maxWeekMinutes = computed(() => {
  if (!data.value) return 1
  return Math.max(1, ...data.value.week.map((day) => Math.max(day.planned, day.actual)))
})

const planBarHeight = (minutes: number): string => `${Math.round((minutes / maxWeekMinutes.value) * 100)}%`
const actualBarHeight = (minutes: number): string => `${Math.round((minutes / maxWeekMinutes.value) * 100)}%`

const donutStyle = computed(() => {
  if (!data.value) return {}
  const total = data.value.totals.allTasks || 1
  const done = (data.value.completion.done / total) * 100
  const partial = (data.value.completion.partial / total) * 100
  const skipped = (data.value.completion.skipped / total) * 100
  return {
    background: `conic-gradient(var(--success) 0% ${done}%, var(--warning) ${done}% ${done + partial}%, var(--text-faint) ${done + partial}% ${done + partial + skipped}%, var(--line) ${done + partial + skipped}% 100%)`,
  }
})

const maxTrend = computed(() => {
  if (!data.value) return 1.5
  return Math.max(1.2, ...data.value.efficiencyTrend.map((point) => point.coefficient ?? 0))
})

function trendHeight(value: number | null): string {
  if (!value) return '4px'
  return `${Math.max(6, Math.round((value / maxTrend.value) * 100))}%`
}

function statusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'overdue') return '已逾期'
  return '进行中'
}

function masteryTone(progress: number): 'success' | 'warning' | 'accent' {
  if (progress >= 1) return 'success'
  if (progress >= 0.6) return 'accent'
  return 'warning'
}

onMounted(stats.load)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">支撑页</p>
          <h1>统计</h1>
          <p class="muted">只读展示。效率系数会直接参与下次重新排期的计算。</p>
        </div>
      </header>

      <GlassCard v-if="stats.loading.value" class="state-card">
        <p class="muted">正在汇总…</p>
      </GlassCard>

      <GlassCard v-else-if="stats.error.value" class="state-card">
        <p class="error-text">{{ stats.error.value }}</p>
        <button type="button" class="btn btn--ghost btn--sm" @click="stats.load">重新加载</button>
      </GlassCard>

      <GlassCard v-else-if="!data || data.totals.allTasks === 0" class="state-card">
        <EmptyState
          title="还没有可统计的数据"
          description="完成一次专注后，这里会出现计划与实际时长的对比、连续打卡和个人效率系数。"
        >
          <SpriteButton size="sm" @click="$router.push('/')">回到首页</SpriteButton>
        </EmptyState>
      </GlassCard>

      <template v-else>
        <section class="stat-grid">
          <GlassCard class="stat-card">
            <p class="section__title">本周计划 vs 实际</p>
            <p class="stat-card__value numeric">
              {{ data.totals.weekActual }}<small>/ {{ data.totals.weekPlanned }} 分钟</small>
            </p>
            <p class="tiny faint">
              实际完成率
              {{ data.totals.weekPlanned > 0 ? Math.round((data.totals.weekActual / data.totals.weekPlanned) * 100) : 0 }}%
            </p>
          </GlassCard>
          <GlassCard class="stat-card">
            <p class="section__title">连续打卡</p>
            <p class="stat-card__value numeric">{{ data.streakDays }}<small>天</small></p>
            <p class="tiny faint">今天记录过就不会断档</p>
          </GlassCard>
          <GlassCard class="stat-card stat-card--eff">
            <p class="section__title">个人效率系数</p>
            <p class="stat-card__value numeric">{{ data.efficiency.coefficient.toFixed(2) }}</p>
            <p class="tiny faint">
              {{ data.efficiency.isDefault ? '样本不足 3 条，按 1.0 计算' : `近 7 天 ${data.efficiency.sampleCount} 条记录` }}
            </p>
          </GlassCard>
          <GlassCard class="stat-card">
            <p class="section__title">任务完成率</p>
            <p class="stat-card__value numeric">{{ Math.round(data.completionRate * 100) }}<small>%</small></p>
            <p class="tiny faint">{{ data.completion.done }}/{{ data.totals.allTasks }} 个任务完成</p>
          </GlassCard>
        </section>

        <div class="chart-grid">
          <GlassCard class="chart-card">
            <div class="section__head">
              <span class="section__title">近 7 天：计划 vs 实际</span>
              <span class="tiny faint">分钟</span>
            </div>
            <div class="bars" role="img" aria-label="近 7 天计划与实际时长对比柱状图">
              <div v-for="day in data.week" :key="day.date" class="bar-day">
                <div class="bar-day__bars">
                  <span
                    class="bar bar--planned"
                    :style="{ height: planBarHeight(day.planned) }"
                    :title="`计划 ${day.planned} 分钟`"
                  ></span>
                  <span
                    class="bar bar--actual"
                    :style="{ height: actualBarHeight(day.actual) }"
                    :title="`实际 ${day.actual} 分钟`"
                  ></span>
                </div>
                <span class="bar-day__label">{{ day.label }}</span>
                <span class="bar-day__value numeric">{{ day.actual }}</span>
              </div>
            </div>
            <div class="bar-legend">
              <span><i class="swatch swatch--planned"></i>计划</span>
              <span><i class="swatch swatch--actual"></i>实际</span>
            </div>
          </GlassCard>

          <GlassCard class="chart-card">
            <div class="section__head">
              <span class="section__title">任务完成分布</span>
            </div>
            <div class="donut-row">
              <div class="donut" :style="donutStyle" role="img" aria-label="任务完成分布环形图">
                <div class="donut__hole">
                  <span class="numeric">{{ data.totals.allTasks }}</span>
                  <small>任务</small>
                </div>
              </div>
              <ul class="donut-legend">
                <li><i class="swatch swatch--done"></i>完成 <span class="numeric">{{ data.completion.done }}</span></li>
                <li><i class="swatch swatch--partial"></i>部分完成 <span class="numeric">{{ data.completion.partial }}</span></li>
                <li><i class="swatch swatch--skipped"></i>跳过 <span class="numeric">{{ data.completion.skipped }}</span></li>
                <li><i class="swatch swatch--pending"></i>待做 <span class="numeric">{{ data.completion.pending }}</span></li>
              </ul>
            </div>
          </GlassCard>
        </div>

        <div class="chart-grid">
          <GlassCard class="chart-card">
            <div class="section__head">
              <span class="section__title">效率系数趋势</span>
              <span class="tiny faint">实际 ÷ 计划</span>
            </div>
            <div class="trend" role="img" aria-label="近 7 天效率系数趋势">
              <div v-for="point in data.efficiencyTrend" :key="point.date" class="trend__col">
                <div class="trend__track">
                  <span
                    v-if="point.coefficient !== null"
                    class="trend__bar"
                    :style="{ height: trendHeight(point.coefficient) }"
                    :title="`${point.coefficient}`"
                  ></span>
                  <span v-else class="trend__empty">—</span>
                </div>
                <span class="trend__label">{{ point.label }}</span>
                <span class="trend__value numeric">{{ point.coefficient ?? '—' }}</span>
              </div>
            </div>
          </GlassCard>

          <GlassCard class="chart-card">
            <div class="section__head">
              <span class="section__title">缓冲日消耗</span>
              <span class="tiny faint">按逾期任务估算</span>
            </div>
            <ul v-if="data.bufferRecords.length" class="buffer-list">
              <li v-for="record in data.bufferRecords" :key="record.subPlanId">
                <div class="buffer-list__main">
                  <span class="buffer-list__name">{{ record.subPlanName }}</span>
                  <span class="tiny faint">每周 {{ record.bufferDays }} 天缓冲</span>
                </div>
                <div class="buffer-list__value">
                  <span v-if="record.overdueTasks > 0" class="tag tag--partial">
                    逾期 {{ record.overdueTasks }} 个 · {{ record.overdueMinutes }} 分钟
                  </span>
                  <span v-else class="tag tag--completed">没有逾期</span>
                </div>
              </li>
            </ul>
            <p v-else class="tiny faint">还没有分计划。</p>
          </GlassCard>
        </div>

        <section class="section">
          <div class="section__head">
            <span class="section__title">按总计划维度的进度</span>
          </div>
          <GlassCard class="master-list">
            <RouterLink
              v-for="master in data.masterProgress"
              :key="master.id"
              :to="`/master-plans/${master.id}`"
              class="master-row"
            >
              <div class="master-row__main">
                <span class="master-row__name">{{ master.name }}</span>
                <span class="tiny faint">{{ formatCN(master.deadline) }} 截止 · {{ statusLabel(master.status) }}</span>
              </div>
              <div class="master-row__bar">
                <span class="master-row__fill" :style="{ width: `${Math.round(master.progress * 100)}%` }" :class="`master-row__fill--${masteryTone(master.progress)}`"></span>
              </div>
              <span class="master-row__value numeric">{{ Math.round(master.progress * 100) }}%</span>
            </RouterLink>
            <p v-if="data.masterProgress.length === 0" class="tiny faint">还没有总计划。</p>
          </GlassCard>
        </section>
      </template>
    </div>
  </AppShell>
</template>

<style scoped>
.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--space-3);
}

.stat-card {
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-card__value {
  font-size: 30px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.stat-card__value small {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-faint);
  margin-left: 4px;
}

.chart-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.chart-card {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

/* 柱状图 */
.bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  height: 180px;
}

.bar-day {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
  justify-content: flex-end;
}

.bar-day__bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 140px;
  width: 100%;
  justify-content: center;
}

.bar {
  display: block;
  width: 11px;
  min-height: 2px;
  border-radius: var(--radius-pill);
  transition: height var(--dur-slow) var(--ease-out);
}

.bar--planned {
  background: color-mix(in srgb, var(--chart-2) 48%, transparent);
}

.bar--actual {
  background: linear-gradient(180deg, var(--chart-1) 0%, var(--chart-2) 100%);
}

.bar-day__label {
  font-size: 11px;
  color: var(--text-faint);
}

.bar-day__value {
  font-size: 10px;
  color: var(--text-muted);
}

.bar-legend {
  display: flex;
  gap: var(--space-4);
  font-size: 11px;
  color: var(--text-muted);
}

.bar-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--line);
}

.swatch--actual {
  background: var(--chart-1);
}

.swatch--done {
  background: var(--success);
}

.swatch--partial {
  background: var(--warning);
}

.swatch--skipped {
  background: var(--text-faint);
}

.swatch--pending {
  background: var(--line);
}

/* 环形图 */
.donut-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-wrap: wrap;
}

.donut {
  --size: 148px;
  width: var(--size);
  height: var(--size);
  border-radius: 50%;
  display: grid;
  place-items: center;
  position: relative;
  flex: 0 0 auto;
}

.donut__hole {
  width: 68%;
  height: 68%;
  border-radius: 50%;
  background: var(--glass-bg-strong);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}

.donut__hole span {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-strong);
}

.donut__hole small {
  font-size: 10px;
  color: var(--text-faint);
}

.donut-legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.donut-legend li {
  display: flex;
  align-items: center;
  gap: 8px;
}

.donut-legend li span {
  margin-left: auto;
  color: var(--text-strong);
}

/* 趋势 */
.trend {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  height: 150px;
}

.trend__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 100%;
  justify-content: flex-end;
}

.trend__track {
  height: 100px;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.trend__bar {
  width: 14px;
  border-radius: var(--radius-pill);
  background: linear-gradient(180deg, var(--success) 0%, var(--accent) 100%);
  min-height: 4px;
}

.trend__empty {
  font-size: 12px;
  color: var(--text-faint);
}

.trend__label {
  font-size: 10px;
  color: var(--text-faint);
}

.trend__value {
  font-size: 10px;
  color: var(--text-muted);
}

/* 缓冲 */
.buffer-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.buffer-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--glass-bg-soft);
  border: 1px solid var(--line-soft);
  flex-wrap: wrap;
}

.buffer-list__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.buffer-list__name {
  font-size: 13px;
  font-weight: 560;
  color: var(--text-strong);
}

/* 总计划进度 */
.master-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3);
}

.master-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.3fr) minmax(120px, 1fr) 48px;
  align-items: center;
  gap: var(--space-4);
  padding: 12px 14px;
  border-radius: var(--radius-md);
  color: var(--text);
  text-decoration: none;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.master-row:hover {
  background: var(--glass-bg-soft);
}

.master-row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.master-row__name {
  font-size: 14px;
  font-weight: 560;
  color: var(--text-strong);
}

.master-row__bar {
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--line-soft);
  overflow: hidden;
}

.master-row__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}

.master-row__fill--success {
  background: var(--success);
}

.master-row__fill--warning {
  background: var(--warning);
}

.master-row__value {
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
}

@media (max-width: 900px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .master-row {
    grid-template-columns: 1fr 60px;
  }

  .master-row__bar {
    display: none;
  }
}
</style>
