import { ref } from 'vue'
import { adminApi, clearToken, refreshAccess, setToken, type AdminMe } from '@/api'

/**
 * 会话状态。
 *
 * 刻意不用 Pinia：后台只有「我是谁」这一份全局状态，
 * 引入一整个状态库换个 ref 不值得，还多一层心智负担。
 */
const me = ref<AdminMe | null>(null)
const booting = ref(true)

export function useSession() {
  return { me, booting }
}

/** 启动时尝试用 refresh cookie 恢复登录态（页面刷新不该把 GM 踢出去） */
export async function bootstrap(): Promise<void> {
  booting.value = true
  try {
    const ok = await refreshAccess()
    if (ok) {
      me.value = await adminApi.me()
    } else {
      me.value = null
    }
  } catch {
    me.value = null
  } finally {
    booting.value = false
  }
}

export async function login(email: string, password: string): Promise<void> {
  const res = await adminApi.login(email, password)
  setToken(res.accessToken)
  me.value = await adminApi.me()
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  } catch {
    /* 网络失败也要把本地状态清掉 */
  }
  clearToken()
  me.value = null
}
