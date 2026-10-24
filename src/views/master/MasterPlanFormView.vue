<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useSubPlans } from '@/composables/useSubPlans'
import { useToast } from '@/composables/useToast'
import { diagnoseMasterPlan } from '@/engine/diagnostics'
import { isValidISODate, todayISO } from '@/lib/date'
import {
  MEASURE_SELECT_OPTIONS,
  type MeasureSelection,
  type SubPlan,
} from '@/types/models'

/** 总计划创建 / 编辑（轻量表单，只诊断 2 条规则） */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const masterApi = useMasterPlans()
const subApi = useSubPlans()

const today = todayISO()
const isEdit = computed(() => route.name === 'master-plan-edit')
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notFound = ref(false)
const subPlans = ref<SubPlan[]>([])

const form = reactive({
  name: '',
  deadline: '',
  measureType: 'exam' as MeasureSelection,
  measureDetail: '',
  description: '',
})

const report = computed(() =>
  diagnoseMasterPlan({
    deadline: form.deadline,
    subPlans: subPlans.value.map((sub) => ({
      id: sub.id,
      name: sub.name,
      deadline: sub.deadline,
    })),
    today,
  }),
)

/** 与已有分计划冲突时，数据库触发器也会拒绝，因此提前禁用保存 */
const hasDateConflict = computed(() =>
  report.value.items.some((item) => item.id === 'master-subplan-conflict' && item.level === 'warn'),
)

const nameError = computed(() => (form.name.trim().length === 0 ? '总计划名称不能为空' : ''))
const canSave = computed(
  () =>
    !report.value.hasBlocking &&
    !hasDateConflict.value &&
    form.name.trim().length > 0 &&
    isValidISODate(form.deadline) &&
    (form.measureType !== 'custom' || form.measureDetail.trim().length > 0) &&
    !saving.value,
)

async function load(): Promise<void> {
  loading.value = true
  if (!isEdit.value) {
    form.deadline = ''
    form.name = ''
    loading.value = false
    return
  }
  const plan = await masterApi.fetchOne(id.value)
  if (!plan) {
    notFound.value = true
    error.value = masterApi.error.value
    loading.value = false
    return
  }
  form.name = plan.name
  form.deadline = plan.deadline
  form.measureType = plan.measureDetail ? 'custom' : plan.measureType
  form.measureDetail = plan.measureDetail
  form.description = plan.description
  subPlans.value = await subApi.fetchByMaster(plan.id)
  loading.value = false
}

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  error.value = ''
  const input = {
    name: form.name.trim(),
    deadline: form.deadline,
    measureType: form.measureType === 'custom' ? ('other' as const) : form.measureType,
    measureDetail: form.measureType === 'custom' ? form.measureDetail.trim() : '',
    description: form.description.trim(),
  }
  const saved = isEdit.value
    ? await masterApi.update(id.value, input)
    : await masterApi.create(input)
  saving.value = false
  if (!saved) {
    error.value = masterApi.error.value || '保存失败'
    return
  }
  toast.success(isEdit.value ? '总计划已更新' : '总计划已创建')
  await router.replace(`/master-plans/${saved.id}`)
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap page-wrap--narrow">
      <nav class="crumb" aria-label="面包屑">
        <RouterLink to="/">我的总计划</RouterLink>
        <span aria-hidden="true">/</span>
        <span>{{ isEdit ? '编辑' : '新建' }}</span>
      </nav>

      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">最终成果</p>
          <h1>{{ isEdit ? '编辑总计划' : '新建总计划' }}</h1>
          <p class="muted">只需要写清结果与日期；任务拆解、每日可用时间、缓冲日都在分计划里设置。</p>
        </div>
      </header>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在读取…</p>
      </GlassCard>

      <GlassCard v-else-if="notFound" class="state-card">
        <p class="error-text">{{ error || '总计划不存在' }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/">返回列表</RouterLink>
      </GlassCard>

      <form v-else class="editor" novalidate @submit.prevent="save">
        <div class="editor__main">
          <GlassCard class="editor__card">
            <div class="form-grid">
              <div class="field form-grid--full">
                <label class="field__label" for="master-name">总计划名称</label>
                <input
                  id="master-name"
                  v-model="form.name"
                  class="input"
                  type="text"
                  maxlength="120"
                  placeholder="例如：三个月通过 N2"
                  :aria-invalid="Boolean(nameError)"
                  required
                />
                <span class="field__hint">写成最终成果，而不是每天的动作。</span>
              </div>

              <div class="field">
                <label class="field__label" for="master-deadline">截止日期</label>
                <input
                  id="master-deadline"
                  v-model="form.deadline"
                  class="input"
                  type="date"
                  :min="today"
                  required
                />
                <span class="field__hint">分计划的截止日期不能晚于这一天。</span>
              </div>

              <div class="field">
                <label class="field__label" for="master-measure">目标衡量标准</label>
                <select id="master-measure" v-model="form.measureType" class="select">
                  <option v-for="option in MEASURE_SELECT_OPTIONS" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </div>

              <div v-if="form.measureType === 'custom'" class="field form-grid--full">
                <label class="field__label" for="master-measure-custom">自定义衡量标准</label>
                <input
                  id="master-measure-custom"
                  v-model="form.measureDetail"
                  class="input"
                  type="text"
                  maxlength="120"
                  placeholder="例如：能独立完成一场 30 分钟演讲"
                  required
                />
                <span class="field__hint">最多 120 字，会随总计划一起保存。</span>
              </div>

              <div class="field form-grid--full">
                <label class="field__label" for="master-desc">一句话成果描述（可选）</label>
                <textarea
                  id="master-desc"
                  v-model="form.description"
                  class="textarea"
                  maxlength="300"
                  placeholder="怎样才算达成？例如：N2 考试 90 分以上，能读懂新闻标题。"
                ></textarea>
              </div>
            </div>

            <p v-if="error" class="error-text" role="alert">{{ error }}</p>

            <div class="editor__actions">
              <SpriteButton type="submit" :disabled="!canSave" :loading="saving">
                {{ isEdit ? '保存修改' : '创建总计划' }}
              </SpriteButton>
              <RouterLink
                class="btn btn--ghost"
                :to="isEdit && id ? `/master-plans/${id}` : '/'"
              >
                取消
              </RouterLink>
              <span v-if="report.hasBlocking" class="tiny faint">存在阻断项，保存已禁用。</span>
              <span v-else-if="hasDateConflict" class="tiny faint">与分计划日期冲突，请先处理。</span>
            </div>
          </GlassCard>
        </div>
      </form>
    </div>
  </AppShell>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: var(--space-4);
}

.crumb a {
  color: var(--text-muted);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.editor__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.editor__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-top: var(--space-4);
  border-top: 1px solid var(--line-soft);
}

@media (max-width: 900px) {
  .editor {
    grid-template-columns: 1fr;
  }
}
</style>
