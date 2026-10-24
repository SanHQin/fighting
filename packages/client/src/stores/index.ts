import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { MatchMode, UserProfile } from '@/types'
import { authApi, type ApiUser } from '@/api/client'
import { ME } from '@/mock/data'

function toProfile(u: ApiUser): UserProfile {
  return {
    uid: u.uid,
    nickname: u.nickname,
    isGuest: u.isGuest,
    rating: u.rating,
    ratingDev: u.ratingDev,
    wins: u.wins,
    losses: u.losses,
    avatarHue: u.avatarHue,
  }
}

/**
 * 会话 / 选人 / 设置的全局状态。
 *
 * 硬边界（见 docs/04-ui-art.md）：
 * 这里只放**低频**状态。World、输入缓冲、相机、特效队列一律留在
 * GameRuntime 普通对象里，任何 reactive() 都不能出现在 step() 调用链上。
 */
export const useSessionStore = defineStore('session', () => {
  const user = ref<UserProfile | null>(null)
  /** 认证状态是否已知：false 时路由守卫不该急着把人踢去登录页 */
  const ready = ref(false)

  const isGuest = computed(() => user.value?.isGuest ?? true)

  let booting: Promise<void> | null = null

  /**
   * 启动时恢复登录：用 httpOnly 里的 refresh cookie 换一张 access。
   *
   * SSR（没有 window）直接跳过：服务端渲染不该发网络请求，
   * 也不该因为"家里没网"就让构建失败。
   */
  function bootstrap(): Promise<void> {
    if (ready.value) return Promise.resolve()
    if (typeof window === 'undefined') {
      ready.value = true
      return Promise.resolve()
    }
    if (booting) return booting
    booting = (async () => {
      try {
        const u = await authApi.restore()
        user.value = u ? toProfile(u) : null
      } catch {
        user.value = null
      } finally {
        ready.value = true
        booting = null
      }
    })()
    return booting
  }

  /** 离线演示：不联网也能看界面（后端没起时用） */
  function loginAsDemo() {
    user.value = { ...ME }
  }

  async function loginWithPassword(email: string, password: string): Promise<void> {
    const r = await authApi.login(email, password)
    user.value = toProfile(r.user)
  }

  async function registerWithPassword(
    email: string,
    nickname: string,
    password: string,
  ): Promise<void> {
    const r = await authApi.register(email, nickname, password)
    user.value = toProfile(r.user)
  }

  async function loginAsGuest(): Promise<void> {
    const r = await authApi.guest()
    user.value = toProfile(r.user)
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout()
    } catch {
      // 网络失败也要把本地状态清掉：留着半登录的状态比登不出去更糟
    }
    user.value = null
    ready.value = true
  }

  function markReady() {
    ready.value = true
  }

  return {
    user,
    ready,
    isGuest,
    bootstrap,
    loginAsDemo,
    loginWithPassword,
    registerWithPassword,
    loginAsGuest,
    logout,
    markReady,
  }
})

/** 一局对战的配置，从选人页一路传到战斗页与结算页 */
export const useMatchStore = defineStore('match', () => {
  const mode = ref<MatchMode>('ai')
  const charIds = ref<[string, string]>(['li', 'aoi'])
  const stageId = ref('dying_beacon')
  const aiLevel = ref<'easy' | 'normal' | 'hard' | 'master'>('normal')
  /** 3 命制，见附录 A STOCKS=3 */
  const stocks = ref(3)

  function reset() {
    mode.value = 'ai'
    charIds.value = ['li', 'aoi']
    stageId.value = 'dying_beacon'
    aiLevel.value = 'normal'
  }

  return { mode, charIds, stageId, aiLevel, stocks, reset }
})

export const useSettingsStore = defineStore('settings', () => {
  const masterVolume = ref(0.8)
  const bgmVolume = ref(0.6)
  const sfxVolume = ref(0.9)
  const showFps = ref(false)
  const showHitbox = ref(false)
  const fullscreen = ref(false)
  /** 低画质：关粒子与多层视差，见 04 第 3 章 WebGL 降级 */
  const lowQuality = ref(false)

  return {
    masterVolume,
    bgmVolume,
    sfxVolume,
    showFps,
    showHitbox,
    fullscreen,
    lowQuality,
  }
})
