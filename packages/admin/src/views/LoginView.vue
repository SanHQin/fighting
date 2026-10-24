<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { login } from '@/session'
import { ApiError } from '@/api'

const email = ref('')
const password = ref('')
const busy = ref(false)
const message = ref('')

async function submit(): Promise<void> {
  if (busy.value) return
  message.value = ''
  busy.value = true
  try {
    await login(email.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect.startsWith('/') ? redirect : '/dashboard')
  } catch (e) {
    const err = e as ApiError
    message.value =
      err.code === 'BAD_CREDENTIALS'
        ? '账号或密码错误'
        : err.code === 'BANNED'
          ? '这个账号已被封禁'
          : err.code === 'FORBIDDEN'
            ? '这个账号没有后台权限'
            : err.message || '登录失败'
  } finally {
    busy.value = false
  }
}

const route = useRoute()
const router = useRouter()
</script>

<template>
  <div class="wrap">
    <form class="panel card" @submit.prevent="submit">
      <div class="mark">
        <span class="logo">残</span>
        <div>
          <div class="kicker">FIGHTING · ADMIN</div>
          <h1>运营后台</h1>
        </div>
      </div>

      <p class="hint">
        这个入口只给运营人员用。普通玩家账号能登录进来，但会被挡在接口层（403）。
      </p>

      <label class="field">
        <span>账号邮箱</span>
        <input v-model="email" type="email" autocomplete="username" placeholder="you@example.com" />
      </label>

      <label class="field">
        <span>密码</span>
        <input v-model="password" type="password" autocomplete="current-password" placeholder="••••••••" />
      </label>

      <div v-if="message" class="err">{{ message }}</div>

      <button class="btn btn-primary go" type="submit" :disabled="busy || !email || !password">
        {{ busy ? '登录中…' : '登录' }}
      </button>

      <p class="foot">
        第一个管理员需要用命令行给：<code>node src/scripts/set-role.ts &lt;uid|邮箱&gt; 2</code>
      </p>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  display: grid;
  place-items: center;
  height: 100%;
  padding: var(--s-6);
  background:
    radial-gradient(760px 420px at 50% 0%, rgb(168 232 92 / 9%), transparent 68%),
    var(--bg-0);
}

.panel {
  width: 100%;
  max-width: 380px;
  padding: var(--s-6);
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.mark {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: var(--s-1);
}

.logo {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: linear-gradient(180deg, var(--brand), var(--brand-dim));
  color: var(--brand-ink);
  font-weight: 700;
  font-size: 20px;
}

.kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--fg-2);
}

h1 {
  margin: 2px 0 0;
  font-size: 21px;
  font-weight: 600;
  color: var(--fg-0);
}

.hint {
  margin: 0 0 var(--s-2);
  font-size: 12px;
  color: var(--fg-2);
  line-height: 1.65;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field span {
  font-size: 12px;
  color: var(--fg-1);
}

.go {
  margin-top: var(--s-2);
  height: 40px;
  justify-content: center;
  font-size: 14px;
}

.foot {
  margin: var(--s-2) 0 0;
  font-size: 11px;
  color: var(--fg-2);
  line-height: 1.7;
}

code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--brand);
  background: var(--bg-3);
  padding: 1px 5px;
  border-radius: 4px;
}
</style>
