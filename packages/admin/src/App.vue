<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useSession, logout } from '@/session'

const route = useRoute()
const router = useRouter()
const { me } = useSession()

const isLogin = computed(() => route.name === 'login')

const nav = [
  { name: 'dashboard', label: '概览', glyph: '◈' },
  { name: 'users', label: '账号', glyph: '☰' },
  { name: 'matches', label: '对局', glyph: '⚔' },
  { name: 'audit', label: '审计', glyph: '✎' },
]

async function doLogout(): Promise<void> {
  await logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div v-if="isLogin" class="bare">
    <RouterView />
  </div>

  <div v-else class="shell">
    <aside class="side">
      <div class="brand">
        <span class="logo">残</span>
        <div class="bt">
          <b>残灯台</b>
          <small>运营后台</small>
        </div>
      </div>

      <nav class="nav">
        <RouterLink
          v-for="n in nav"
          :key="n.name"
          :to="{ name: n.name }"
          class="nitem"
          :class="{ on: route.name === n.name || (n.name === 'users' && route.name === 'user') }"
        >
          <span class="glyph">{{ n.glyph }}</span>
          <span>{{ n.label }}</span>
        </RouterLink>
      </nav>

      <div class="who">
        <div class="wl">
          <b>{{ me?.nickname ?? '—' }}</b>
          <span class="tag" :class="me?.role === 2 ? 'tag-brand' : 'tag-info'">
            {{ me?.roleLabel ?? '未登录' }}
          </span>
        </div>
        <div class="uid mono">UID {{ me?.uid ?? '—' }}</div>
        <button class="btn" style="width: 100%; justify-content: center" @click="doLogout">退出</button>
      </div>
    </aside>

    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.bare {
  height: 100%;
}

.shell {
  display: grid;
  grid-template-columns: 212px 1fr;
  height: 100%;
}

.side {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
  padding: var(--s-5) var(--s-3);
  background: linear-gradient(180deg, var(--bg-1), var(--bg-0));
  border-right: 1px solid var(--line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 var(--s-2);
}

.logo {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(180deg, var(--brand), var(--brand-dim));
  color: var(--brand-ink);
  font-weight: 700;
  font-size: 17px;
}

.bt {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.bt b {
  color: var(--fg-0);
  font-size: 14px;
}

.bt small {
  color: var(--fg-2);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nitem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  color: var(--fg-1);
  font-size: 13px;
  transition: all var(--t-fast) var(--ease);
  position: relative;
}

.nitem .glyph {
  width: 16px;
  text-align: center;
  color: var(--fg-2);
  font-size: 13px;
}

.nitem:hover {
  background: var(--bg-2);
  color: var(--fg-0);
}

.nitem.on {
  background: rgb(168 232 92 / 10%);
  color: var(--brand);
}

.nitem.on .glyph {
  color: var(--brand);
}

.nitem.on::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  translate: 0 -50%;
  width: 3px;
  height: 18px;
  border-radius: 2px;
  background: var(--brand);
}

.who {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--s-3);
  border-radius: 10px;
  background: var(--bg-2);
  border: 1px solid var(--line);
}

.wl {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.wl b {
  color: var(--fg-0);
  font-size: 13px;
}

.uid {
  font-size: 11px;
  color: var(--fg-2);
}

.main {
  overflow: auto;
  padding: var(--s-5) var(--s-6);
  background:
    radial-gradient(900px 420px at 78% -8%, rgb(168 232 92 / 6%), transparent 70%),
    var(--bg-0);
}
</style>
