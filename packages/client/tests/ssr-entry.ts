/**
 * SSR 渲染冒烟测试的入口。
 *
 * 目的：类型检查和构建只能证明"能编译"，证明不了"能渲染"。
 * 这里用 vue/server-renderer 把每个页面渲染成 HTML 字符串，
 * 模板里的 undefined 访问、错误的 prop、computed 抛错都会当场暴露。
 *
 * 由 tools/check-render.mjs 用 vite 的 SSR 构建产物驱动。
 *
 * 注意：必须挂真 router，否则 useRoute()/useRouter() 返回 undefined，
 * 页面在 setup 里就抛 `Cannot read properties of undefined (reading 'query')`。
 */
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import BootView from '@/views/BootView.vue'
import LoginView from '@/views/LoginView.vue'
import MainMenuView from '@/views/MainMenuView.vue'
import ModeSelectView from '@/views/ModeSelectView.vue'
import CharSelectView from '@/views/CharSelectView.vue'
import StageSelectView from '@/views/StageSelectView.vue'
import BattleView from '@/views/BattleView.vue'
import ResultView from '@/views/ResultView.vue'
import SettingsView from '@/views/SettingsView.vue'
import ProfileView from '@/views/ProfileView.vue'
import NotFoundView from '@/views/NotFoundView.vue'

const routes = [
  { path: '/boot', name: 'boot', component: BootView },
  { path: '/login', name: 'login', component: LoginView },
  { path: '/menu', name: 'menu', component: MainMenuView },
  { path: '/mode', name: 'mode', component: ModeSelectView },
  { path: '/select/char', name: 'char-select', component: CharSelectView },
  { path: '/select/stage', name: 'stage-select', component: StageSelectView },
  { path: '/battle/:matchId', name: 'battle', component: BattleView },
  { path: '/result/:matchId', name: 'result', component: ResultView },
  { path: '/settings', name: 'settings', component: SettingsView },
  { path: '/profile/:id?', name: 'profile', component: ProfileView },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
]

type Case = {
  label: string
  path: string
  /** 渲染出的文本里必须出现的片段 */
  expect?: string[]
}

const cases: Case[] = [
  { label: 'Boot', path: '/boot', expect: ['残灯台'] },
  { label: 'Login', path: '/login', expect: ['登录'] },
  { label: 'MainMenu', path: '/menu', expect: ['单机战斗', '设置'] },
  { label: 'ModeSelect', path: '/mode', expect: ['本地', '人机'] },
  { label: 'CharSelect', path: '/select/char', expect: ['1P', '磨刀匠', '独有招式'] },
  { label: 'StageSelect', path: '/select/stage', expect: ['残灯台', '齿轮工坊', '出界'] },
  { label: 'Battle', path: '/battle/local-demo', expect: ['P1', 'P2', '蹲防'] },
  { label: 'Result', path: '/result/local-demo', expect: ['VICTORY', '再来'] },
  { label: 'Settings', path: '/settings', expect: ['画面', '音频'] },
  { label: 'Profile', path: '/profile', expect: ['胜率'] },
  { label: 'NotFound', path: '/nope/nothing', expect: ['404'] },
]

const textOf = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export async function run(): Promise<{ results: unknown[]; failures: string[] }> {
  const failures: string[] = []
  const results: unknown[] = []

  for (const c of cases) {
    try {
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push(c.path)
      await router.isReady()

      const app = createSSRApp({ render: () => h(router.currentRoute.value.matched[0].components!.default as never) })
      app.use(createPinia())
      app.use(router)

      const html = await renderToString(app)
      const text = textOf(html)
      results.push({ label: c.label, bytes: html.length, head: text.slice(0, 80) })

      if (html.length < 60) failures.push(`${c.label}: 渲染输出过短 (${html.length} 字节)`)
      for (const needle of c.expect ?? []) {
        if (!text.includes(needle)) failures.push(`${c.label}: 渲染文本里找不到「${needle}」`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`${c.label}: 渲染抛错 ${msg}`)
    }
  }

  return { results, failures }
}
