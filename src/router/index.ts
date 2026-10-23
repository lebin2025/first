// 👈 1. 将 createWebHistory 改为 createWebHashHistory
import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import StudyRoomView from '@/views/StudyRoomView.vue'
import { useAuthStore } from '@/stores/auth'
import { useRoomStore } from '@/stores/room'

/**
 * 路由表（页面流转）：
 *
 *   /                     总计划列表（登录落地页）
 *   /master-plans/:id     总计划详情 → 分计划列表
 *   /sub-plans/:id        分计划详情 → 任务列表 + 开始专注
 *   /focus                沉浸计时（全屏、无导航，自动挑选任务）
 *
 * - 受保护路由未登录统一跳 /login；
 * - 登录成功统一跳 /（总计划列表），不绕过登录页；
 * - /master-plans 保留为重定向，兼容旧链接与旧面包屑；
 * - /focus 使用 meta.bare，不带全局外壳；
 * - 全部使用懒加载。
 */
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    /** 不需要登录 */
    publicPage?: boolean
    /** 沉浸页：无全局外壳 */
    bare?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', publicPage: true },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/master/MasterPlanListView.vue'),
    meta: { title: '总计划', requiresAuth: true },
  },
  {
    path: '/focus',
    name: 'focus',
    component: () => import('@/views/FocusPage.vue'),
    meta: { title: '专注', requiresAuth: true, bare: true },
  },
  {
    path: '/study-room',
    name: 'study-room',
    component: () => import('@/views/StudyRoomLobbyView.vue'),
    meta: { title: '自习室大厅', requiresAuth: true },
  },
  {
    path: '/study-room/:id',
    name: 'StudyRoom',
    // 静态导入：避免开发态 HMR / 部署后旧 chunk 导致的 dynamic import 失败
    component: StudyRoomView,
    meta: { title: '自习室', requiresAuth: true },
  },
  {
    path: '/sub-plans/new',
    name: 'sub-plan-new-picker',
    component: () => import('@/views/sub/SubPlanPickerView.vue'),
    meta: { title: '新建分计划', requiresAuth: true },
  },
  {
    // 旧链接兼容：总计划列表现在是落地页 /
    path: '/master-plans',
    name: 'master-plans',
    redirect: { name: 'home' },
    meta: { title: '总计划', requiresAuth: true },
  },
  {
    path: '/master-plans/new',
    name: 'master-plan-new',
    component: () => import('@/views/master/MasterPlanFormView.vue'),
    meta: { title: '新建总计划', requiresAuth: true },
  },
  {
    path: '/master-plans/:id',
    name: 'master-plan-detail',
    component: () => import('@/views/master/MasterPlanDetailView.vue'),
    meta: { title: '总计划详情', requiresAuth: true },
  },
  {
    path: '/master-plans/:id/edit',
    name: 'master-plan-edit',
    component: () => import('@/views/master/MasterPlanFormView.vue'),
    meta: { title: '编辑总计划', requiresAuth: true },
  },
  {
    path: '/master-plans/:masterId/sub-plans/new',
    name: 'sub-plan-new',
    component: () => import('@/views/sub/SubPlanFormView.vue'),
    meta: { title: '新建分计划', requiresAuth: true },
  },
  {
    path: '/sub-plans/:id',
    name: 'sub-plan-detail',
    component: () => import('@/views/sub/SubPlanDetailView.vue'),
    meta: { title: '分计划详情', requiresAuth: true },
  },
  {
    path: '/sub-plans/:id/calendar',
    name: 'sub-plan-calendar',
    component: () => import('@/views/sub/SubPlanCalendar.vue'),
    meta: { title: '日历视图', requiresAuth: true },
  },
  {
    path: '/sub-plans/:id/edit',
    name: 'sub-plan-edit',
    component: () => import('@/views/sub/SubPlanFormView.vue'),
    meta: { title: '编辑分计划', requiresAuth: true },
  },
  {
    path: '/sub-plans/:id/reschedule',
    name: 'sub-plan-reschedule',
    component: () => import('@/views/sub/ReschedulePreviewView.vue'),
    meta: { title: '重新排期', requiresAuth: true },
  },
  {
    path: '/stats',
    name: 'stats',
    component: () => import('@/views/StatsView.vue'),
    meta: { title: '统计', requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: '设置', requiresAuth: true },
  },
  {
    path: '/privacy',
    name: 'privacy',
    component: () => import('@/views/legal/PrivacyView.vue'),
    meta: { title: '隐私政策', publicPage: true },
  },
  {
    path: '/terms',
    name: 'terms',
    component: () => import('@/views/legal/TermsView.vue'),
    meta: { title: '用户协议', publicPage: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面不存在', publicPage: true },
  },
]

const router = createRouter({
  // 👈 2. 改用 hash 模式，这样在 GitHub Pages 刷新任何子页面都不会 404
  history: createWebHashHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.initialize()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'home' }
  }

  // 已在房间内时，菜单「自习室」直接回到当前房间，不再展示大厅
  if (to.name === 'study-room') {
    const room = useRoomStore()
    if (room.roomId) {
      return { name: 'StudyRoom', params: { id: room.roomId }, replace: true }
    }
  }

  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 拾光` : '拾光 · Picked Light'
})

export default router