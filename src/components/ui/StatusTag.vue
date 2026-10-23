<script setup lang="ts">
import { computed } from 'vue'
import {
  MASTER_PLAN_STATUS_LABELS,
  SUB_PLAN_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type MasterPlanStatus,
  type SubPlanStatus,
  type TaskStatus,
} from '@/types/models'

const props = withDefaults(
  defineProps<{
    kind?: 'task' | 'sub' | 'master'
    status: TaskStatus | SubPlanStatus | MasterPlanStatus
    dot?: boolean
  }>(),
  { kind: 'task', dot: false },
)

const label = computed(() => {
  if (props.kind === 'master') return MASTER_PLAN_STATUS_LABELS[props.status as MasterPlanStatus]
  if (props.kind === 'sub') return SUB_PLAN_STATUS_LABELS[props.status as SubPlanStatus]
  return TASK_STATUS_LABELS[props.status as TaskStatus]
})
</script>

<template>
  <span class="tag" :class="`tag--${status}`">
    <span v-if="dot" class="tag__dot" aria-hidden="true"></span>
    {{ label }}
  </span>
</template>

<style scoped>
.tag__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.8;
}
</style>
