import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { useSessionStore } from '@/stores'

/**
 * 路由表对齐 docs/04-ui-art.md 第 3 章。
 * 用 hash 模式：静态托管不需要服务端 rewrite，本地 file:// 预览也能跑。
 */
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/boot' },
  {
    path: '/boot',
    name: 'boot',
    component: () => import('@/views/BootView.vue'),
    meta: { public: true, noFocus: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/menu',
    name: 'menu',
    component: () => import('@/views/MainMenuView.vue'),
  },
  {
    path: '/mode',
    name: 'mode',
    component: () => import('@/views/ModeSelectView.vue'),
  },
  {
    path: '/select/char',
    name: 'char-select',
    component: () => import('@/views/CharSelectView.vue'),
  },
  {
    path: '/select/stage',
    name: 'stage-select',
    component: () => import('@/views/StageSelectView.vue'),
  },
  {
    path: '/battle/:matchId',
    name: 'battle',
    component: () => import('@/views/BattleView.vue'),
    meta: { noFocus: true },
  },
  {
    path: '/result/:matchId',
    name: 'result',
    component: () => import('@/views/ResultView.vue'),
    meta: { noFocus: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
  },
  {
    path: '/profile/:id?',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { requireRegistered: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { public: true },
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

/**
 * 守卫只做两件事：
 * 1. 未登录 → /login（/boot 与 /login 除外）
 * 2. 游客访问 requireRegistered 页（排位、个人主页）→ 拦下来
 * 不做数据预取，也不做 loading 遮罩——那属于页面自己的事。
 */
router.beforeEach(async (to) => {
  const session = useSessionStore()

  // 首次进站先问一次"我是谁"。没有这一步，刷新页面会被当成未登录踢回登录页。
  if (!session.ready) await session.bootstrap()

  if (to.meta.public) return true

  if (!session.user) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.meta.requireRegistered && session.isGuest) {
    return { name: 'menu', query: { blocked: 'guest' } }
  }

  return true
})
