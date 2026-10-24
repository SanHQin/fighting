<script setup lang="ts">
/**
 * 登录 / 注册 / 游客入口。
 *
 * 表单字段与 docs/06-account.md §1.10 的 API 对齐，直接打后端：
 * `POST /api/auth/login`、`/register`、`/guest`，accessToken 进内存、
 * refreshToken 走 httpOnly Cookie（所以必须经 vite 代理保持同源）。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import HintBar from '@/components/HintBar.vue'
import { useSessionStore } from '@/stores'
import { ApiFailure } from '@/api/client'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()

const email = ref('')
const password = ref('')
const nickname = ref('')
const error = ref('')
const busy = ref(false)
/** 显示密码，纯前端开关，不参与提交 */
const showPwd = ref(false)
/** false = 登录；true = 注册 */
const mode = ref<'login' | 'register'>('login')

const canSubmit = computed(() => {
  const base = email.value.includes('@') && password.value.length >= 8
  return mode.value === 'register' ? base && nickname.value.trim().length >= 2 : base
})

function nextRoute() {
  const redirect = route.query.redirect
  return typeof redirect === 'string' && redirect.startsWith('/')
    ? redirect
    : { name: 'menu' as const }
}

/** 后端 code → 中文提示。按 code 分支，不解析 message（见 06 §1.10） */
function explain(e: unknown): string {
  if (!(e instanceof ApiFailure)) return '网络异常，请确认后端已启动（pnpm dev:server）'
  switch (e.code) {
    case 'BAD_CREDENTIALS':
      return '账号或密码错误'
    case 'EMAIL_TAKEN':
      return '这个邮箱已经注册过了'
    case 'NICKNAME_TAKEN':
      return '这个昵称被占了，换一个'
    case 'NICK_LENGTH':
      return '昵称要 2–16 个字符'
    case 'NICK_CHARSET':
      return '昵称只能用中文、字母、数字、下划线'
    case 'PASSWORD_LENGTH':
      return '密码要 8–64 个字符'
    case 'EMAIL_INVALID':
      return '邮箱格式不正确'
    case 'BANNED':
      return '这个账号已被封禁'
    default:
      return e.message || '请求失败'
  }
}

async function submit() {
  if (!canSubmit.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (mode.value === 'register') {
      await session.registerWithPassword(email.value, nickname.value.trim(), password.value)
    } else {
      await session.loginWithPassword(email.value, password.value)
    }
    await router.replace(nextRoute())
  } catch (e) {
    error.value = explain(e)
  } finally {
    busy.value = false
  }
}

async function asGuest() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await session.loginAsGuest()
    await router.replace({ name: 'menu' })
  } catch (e) {
    error.value = explain(e)
  } finally {
    busy.value = false
  }
}

function toggleMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  error.value = ''
}
</script>

<template>
  <LogicalViewport tone="brand" scan>
    <div class="login">
      <!-- 左侧品牌区 -->
      <aside class="side">
        <div class="side-top">
          <span class="logo-dot" aria-hidden="true" />
          <span class="logo">残灯台</span>
        </div>

        <div class="side-mid">
          <h1 class="slogan">
            打出去，<br />
            或者被打出去。
          </h1>
          <p class="brief">
            4 名角色 · 4 张场地 · 九方向出招 · 变形盾与抓边。
            一个跑在浏览器里的平台格斗原型。
          </p>
        </div>

        <ul class="facts">
          <li><b>4</b><span>角色</span></li>
          <li><b>4</b><span>场地</span></li>
          <li><b>9</b><span>攻击方向</span></li>
          <li><b>60</b><span>逻辑帧率</span></li>
        </ul>
      </aside>

      <!-- 右侧表单 -->
      <main class="main">
        <div class="panel ui-panel">
          <header class="head">
            <span class="ui-kicker">{{ mode === 'login' ? 'SIGN IN' : 'SIGN UP' }}</span>
            <h2 class="h">{{ mode === 'login' ? '登录' : '注册' }}</h2>
            <p class="hint">
              没有账号可以直接以游客身份试玩 —— 游客能打人机与本地双人，
              只是不进排位、战绩只留最近 20 局。
            </p>
          </header>

          <div v-if="mode === 'register'" class="field">
            <label class="lab" for="nick">
              昵称<span class="req" aria-hidden="true">*</span>
            </label>
            <input
              id="nick"
              v-model="nickname"
              class="ui-input"
              type="text"
              maxlength="16"
              autocomplete="nickname"
              spellcheck="false"
              placeholder="2–16 字，中文 / 字母 / 数字 / 下划线"
              @keydown.enter="submit"
            />
          </div>

          <div class="field">
            <label class="lab" for="email">
              邮箱<span class="req" aria-hidden="true">*</span>
            </label>
            <input
              id="email"
              v-model="email"
              class="ui-input"
              type="email"
              autocomplete="username"
              spellcheck="false"
              placeholder="you@example.com"
              @keydown.enter="submit"
            />
          </div>

          <div class="field">
            <label class="lab" for="pwd">
              密码<span class="req" aria-hidden="true">*</span>
              <button class="peek" type="button" @click="showPwd = !showPwd">
                {{ showPwd ? '隐藏' : '显示' }}
              </button>
            </label>
            <input
              id="pwd"
              v-model="password"
              class="ui-input"
              :type="showPwd ? 'text' : 'password'"
              :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
              placeholder="至少 8 位，不强制特殊字符"
              @keydown.enter="submit"
            />
            <span class="tip" :class="{ ok: password.length >= 8 }">
              <i class="dot" aria-hidden="true" />
              {{ password.length >= 8 ? '长度符合要求' : `还差 ${Math.max(0, 8 - password.length)} 位` }}
            </span>
          </div>

          <p v-if="error" class="err">{{ error }}</p>

          <button class="ui-btn ui-btn-primary wide" :disabled="!canSubmit || busy" @click="submit">
            {{ busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
          </button>

          <div class="divider"><span>或</span></div>

          <button class="ui-btn ui-btn-ghost wide" :disabled="busy" @click="asGuest">
            以游客身份进入
          </button>

          <p class="foot">
            <button class="link" type="button" @click="toggleMode">
              {{ mode === 'login' ? '还没有账号？去注册' : '已有账号？去登录' }}
            </button>
            · 密码用 argon2id 存储，会话见 <b>docs/06-account.md</b>
          </p>
        </div>
      </main>
    </div>
    <HintBar :hints="[{ key: 'Tab', label: '切换输入框' }, { key: 'Enter', label: '登录' }]">
      <span class="mode-tag">离线原型 · 任意邮箱 + 8 位密码即可进入</span>
    </HintBar>
  </LogicalViewport>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  width: 100%;
  height: calc(100% - 40px);
}

/* ---------- 左侧 ---------- */
.side {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: var(--s-7) var(--s-7) var(--s-6);
  border-right: 1px solid var(--line);
  background:
    radial-gradient(80% 70% at 18% 16%, color-mix(in srgb, var(--brand) 12%, transparent) 0%, transparent 62%),
    linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--bg-0) 46%, transparent) 100%);
}

.side-top {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.logo-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 14px var(--brand);
}

.logo {
  font-size: var(--fs-small);
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--fg-0);
}

.side-mid {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  max-width: 440px;
}

.slogan {
  margin: 0;
  font-size: 52px;
  font-weight: 800;
  line-height: 1.16;
  letter-spacing: 0.01em;
  color: var(--fg-0);
  text-shadow: 0 8px 40px rgba(0, 0, 0, 0.7);
}

.brief {
  margin: 0;
  font-size: var(--fs-small);
  line-height: 1.85;
  color: var(--fg-1);
}

.facts {
  display: flex;
  gap: var(--s-6);
  margin: 0;
  padding: var(--s-4) 0 0;
  list-style: none;
  border-top: 1px solid var(--line);
}

.facts li {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.facts b {
  font-family: var(--font-num);
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  color: var(--brand);
}

.facts span {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--fg-2);
}

/* ---------- 右侧 ---------- */
.main {
  display: grid;
  place-items: center;
  padding: var(--s-6);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  width: 412px;
  padding: var(--s-6);
  border-radius: var(--r-3);
  box-shadow: 0 28px 72px -28px rgba(0, 0, 0, 0.9);
}

.head {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  margin-bottom: var(--s-1);
}

.h {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--fg-0);
}

.hint {
  margin: 0;
  font-size: var(--fs-tiny);
  line-height: 1.75;
  color: var(--fg-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lab {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-tiny);
  letter-spacing: 0.06em;
  color: var(--fg-1);
}

.req {
  color: var(--danger);
}

.peek {
  margin-left: auto;
  font-size: 10px;
  color: var(--fg-2);
  transition: color var(--t-fast) var(--ease-standard);
}

.peek:hover {
  color: var(--brand);
}

/* 密码长度提示：不到 8 位灰，够了变绿 */
.tip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--fg-2);
  transition: color var(--t-fast) var(--ease-standard);
}

.tip .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.tip.ok {
  color: var(--success);
}

.err {
  margin: 0;
  padding: var(--s-2) var(--s-3);
  font-size: var(--fs-tiny);
  color: color-mix(in srgb, var(--danger) 88%, #fff);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-left: 2px solid var(--danger);
  border-radius: var(--r-1);
}

.wide {
  width: 100%;
  height: 44px;
  min-width: 0;
}

.divider {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--fg-2);
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}

.foot {
  margin: var(--s-1) 0 0;
  font-size: 10px;
  line-height: 1.75;
  color: var(--fg-2);
  text-align: center;
}

.foot b {
  color: var(--fg-1);
  font-weight: 600;
}

/* 登录/注册切换：做成文字按钮而不是链接，避免出现下划线的浏览器默认样式 */
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand);
  font: inherit;
  cursor: pointer;
}

.link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.mode-tag {
  color: var(--fg-2);
}
</style>
