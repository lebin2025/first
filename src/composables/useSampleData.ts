import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { addDays, todayISO } from '@/lib/date'
import { buildInitialSchedule, collectAssignments } from '@/engine/schedule'
import { useAuthStore } from '@/stores/auth'
import type { MeasureStandard } from '@/types/models'

/**
 * 「一键示例」：新用户空状态时生成一套可立即体验的数据。
 * 数据写入真实数据库，遵循 RLS（user_id 来自当前登录用户）。
 */

interface SampleTask {
  name: string
  estMinutes: number
  measureStandard: MeasureStandard
  focusBlock: number
}

const VOCAB_TASKS: SampleTask[] = [
  { name: 'N2 核心词汇 Unit 1（120 词）', estMinutes: 45, measureStandard: 'recall', focusBlock: 25 },
  { name: '朗读 Unit 1 例句并录音回听', estMinutes: 25, measureStandard: 'restate', focusBlock: 25 },
  { name: 'N2 核心词汇 Unit 2（120 词）', estMinutes: 45, measureStandard: 'recall', focusBlock: 25 },
  { name: '整理 Unit 1-2 易混词卡片', estMinutes: 25, measureStandard: 'operate', focusBlock: 25 },
  { name: 'N2 核心词汇 Unit 3（120 词）', estMinutes: 45, measureStandard: 'recall', focusBlock: 25 },
  { name: '做一组词汇选择题（20 题）', estMinutes: 30, measureStandard: 'solve', focusBlock: 25 },
  { name: '复习 Unit 1-3 错词', estMinutes: 20, measureStandard: 'recall', focusBlock: 15 },
  { name: '用新词写 5 个句子', estMinutes: 30, measureStandard: 'operate', focusBlock: 25 },
]

const GRAMMAR_TASKS: SampleTask[] = [
  { name: '语法点：被动语态（讲解 + 笔记）', estMinutes: 40, measureStandard: 'restate', focusBlock: 25 },
  { name: '被动语态练习 15 题', estMinutes: 30, measureStandard: 'solve', focusBlock: 25 },
  { name: '语法点：使役表达', estMinutes: 40, measureStandard: 'restate', focusBlock: 25 },
  { name: '使役表达练习 15 题', estMinutes: 30, measureStandard: 'solve', focusBlock: 25 },
]

export function useSampleData() {
  const auth = useAuthStore()
  const creating = ref(false)
  const error = ref('')

  async function insertTasks(
    subPlanId: string,
    tasks: SampleTask[],
    deadline: string,
    weekdayMinutes: number,
    weekendMinutes: number,
  ): Promise<boolean> {
    const today = todayISO()
    const drafts = tasks.map((task, index) => ({
      id: `sample-${subPlanId}-${index}`,
      name: task.name,
      estMinutes: task.estMinutes,
      oldDate: null,
    }))
    const schedule = buildInitialSchedule(drafts, {
      start: today,
      deadline,
      weekdayMinutes,
      weekendMinutes,
      bufferDays: 1,
    })
    const assignments = collectAssignments(schedule.days)

    const payload = tasks.map((task, index) => ({
      sub_plan_id: subPlanId,
      user_id: auth.userId,
      name: task.name,
      est_minutes: task.estMinutes,
      measure_standard: task.measureStandard,
      focus_block: task.focusBlock,
      scheduled_date: assignments.get(`sample-${subPlanId}-${index}`) ?? today,
    }))

    const { error: insertError } = await supabase.from('tasks').insert(payload)
    if (insertError) {
      error.value = describeError(insertError)
      return false
    }
    return true
  }

  async function createSample(): Promise<boolean> {
    if (!auth.userId) {
      error.value = '请先登录'
      return false
    }
    creating.value = true
    error.value = ''
    const today = todayISO()
    const masterDeadline = addDays(today, 90)
    let masterId: string | null = null

    try {
      const { data: master, error: masterError } = await supabase
        .from('master_plans')
        .insert({
          user_id: auth.userId,
          name: '三个月通过 N2',
          deadline: masterDeadline,
          measure_type: 'exam',
          description: '以 N2 合格线为目标，词汇与语法两条线并行推进。',
        })
        .select('*')
        .single()
      if (masterError || !master) {
        error.value = describeError(masterError)
        return false
      }
      masterId = (master as { id: string }).id

      const vocabDeadline = addDays(today, 45)
      const { data: vocab, error: vocabError } = await supabase
        .from('sub_plans')
        .insert({
          master_plan_id: masterId,
          user_id: auth.userId,
          name: 'N2 词汇',
          deadline: vocabDeadline,
          weekday_minutes: 60,
          weekend_minutes: 90,
          buffer_days: 1,
        })
        .select('*')
        .single()
      if (vocabError || !vocab) {
        error.value = describeError(vocabError)
        await supabase.from('master_plans').delete().eq('id', masterId)
        return false
      }

      const grammarDeadline = addDays(today, 60)
      const { data: grammar, error: grammarError } = await supabase
        .from('sub_plans')
        .insert({
          master_plan_id: masterId,
          user_id: auth.userId,
          name: 'N2 语法',
          deadline: grammarDeadline,
          weekday_minutes: 45,
          weekend_minutes: 60,
          buffer_days: 1,
        })
        .select('*')
        .single()
      if (grammarError || !grammar) {
        error.value = describeError(grammarError)
        await supabase.from('master_plans').delete().eq('id', masterId)
        return false
      }

      const vocabId = (vocab as { id: string }).id
      const grammarId = (grammar as { id: string }).id
      const vocabOk = await insertTasks(vocabId, VOCAB_TASKS, vocabDeadline, 60, 90)
      const grammarOk = vocabOk
        ? await insertTasks(grammarId, GRAMMAR_TASKS, grammarDeadline, 45, 60)
        : false

      if (!vocabOk || !grammarOk) {
        // 补偿删除：总计划级联删除分计划与任务
        await supabase.from('master_plans').delete().eq('id', masterId)
        return false
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      if (masterId) await supabase.from('master_plans').delete().eq('id', masterId)
      return false
    } finally {
      creating.value = false
    }
  }

  return { creating, error, createSample }
}
