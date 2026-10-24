import { createRouter, createWebHashHistory } from 'vue-router'
import { useSession, bootstrap } from '@/session'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
  { path: '/users', name: 'users', component: () => import('@/views/UsersView.vue') },
  { path: '/users/:uid', name: 'user', component: () => import('@/views/UserDetailView.vue') },
  { path: '/matches', name: 'matches', component: () => import('@/views/MatchesView.vue') },
  { path: '/audit', name: 'audit', component: () => import('@/views/AuditView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const { me, booting } = useSession()
  // 首次进入先尝试恢复会话，否则刷新一下就跳登录页
  if (booting.value) await bootstrap()
  if (to.meta.public) {
    if (me.value) return { name: 'dashboard' }
    return true
  }
  if (!me.value) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})
