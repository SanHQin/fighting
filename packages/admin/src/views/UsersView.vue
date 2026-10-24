<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi, ApiError, type AdminUser } from '@/api'

const items = ref<AdminUser[]>([])
const nextCursor = ref<string | null>(null)
const keyword = ref('')
const filter = ref('all')
const loading = ref(false)
const error = ref('')

const FILTERS = [
  { v: 'all', label: '全部' },
  { v: 'registered', label: '注册' },
  { v: 'guest', label: '游客' },
  { v: 'banned', label: '封禁中' },
  { v: 'staff', label: '后台' },
]

async function load(reset = true): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    if (reset) nextCursor.value = null
    const page = await adminApi.users({
      take: 20,
      keyword: keyword.value.trim() || undefined,
      filter: filter.value === 'all' ? undefined : filter.value,
      cursor: reset ? undefined : (nextCursor.value ?? undefined),
    })
    items.value = reset ? page.items : [...items.value, ...page.items]
    nextCursor.value = page.nextCursor
  } catch (e) {
    error.value = (e as ApiError).message
  } finally {
    loading.value = false
  }
}

function setFilter(v: string): void {
  filter.value = v
  void load(true)
}

onMounted(() => load(true))

function ago(iso: string | null): string {
  if (!iso) return '从未'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return '刚刚'
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} 分钟前`
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} 小时前`
  return `${Math.floor(ms / 86400_000)} 天前`
}

function banned(u: AdminUser): boolean {
  return !!u.bannedUntil && new Date(u.bannedUntil).getTime() > Date.now()
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <div class="kicker">ACCOUNTS</div>
        <h1>账号</h1>
      </div>
      <form class="search" @submit.prevent="load(true)">
        <input v-model="keyword" placeholder="昵称 / 邮箱 / UID" />
        <button class="btn" type="submit" :disabled="loading">搜索</button>
      </form>
    </header>

    <div class="tabs">
      <button
        v-for="f in FILTERS"
        :key="f.v"
        class="tab"
        :class="{ on: filter === f.v }"
        @click="setFilter(f.v)"
      >
        {{ f.label }}
      </button>
    </div>

    <div v-if="error" class="err">{{ error }}</div>

    <div class="card">
      <table v-if="items.length" class="grid">
        <thead>
          <tr>
            <th>UID</th>
            <th>昵称</th>
            <th>类型</th>
            <th>角色</th>
            <th>段位分</th>
            <th>战绩</th>
            <th>最近登录</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in items" :key="u.uid">
            <td class="mono dim">{{ u.uid }}</td>
            <td>
              <RouterLink :to="{ name: 'user', params: { uid: u.uid } }">{{ u.nickname }}</RouterLink>
              <div v-if="u.email" class="sub mono">{{ u.email }}</div>
            </td>
            <td>
              <span class="tag" :class="u.isGuest ? '' : 'tag-info'">{{ u.isGuest ? '游客' : '注册' }}</span>
            </td>
            <td>
              <span class="tag" :class="u.role === 2 ? 'tag-brand' : u.role === 1 ? 'tag-warn' : ''">
                {{ u.roleLabel }}
              </span>
            </td>
            <td class="mono">{{ u.rating }}</td>
            <td class="mono dim">{{ u.wins }}–{{ u.losses }}</td>
            <td class="dim">{{ ago(u.lastLoginAt) }}</td>
            <td>
              <span v-if="banned(u)" class="tag tag-danger">封禁中</span>
              <span v-else class="tag">正常</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="!loading" class="empty">没有匹配的账号</div>
    </div>

    <div class="more">
      <button v-if="nextCursor" class="btn" :disabled="loading" @click="load(false)">
        {{ loading ? '加载中…' : '加载更多' }}
      </button>
      <span v-else-if="items.length" class="dim">— 到底了 —</span>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  max-width: 1180px;
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--s-4);
}

.kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--fg-2);
}

h1 {
  margin: 2px 0 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--fg-0);
}

.search {
  display: flex;
  gap: var(--s-2);
}

.search input {
  width: 240px;
}

.tabs {
  display: flex;
  gap: 6px;
}

.tab {
  padding: 5px 13px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--fg-1);
  border: 1px solid var(--line);
  transition: all var(--t-fast) var(--ease);
}

.tab:hover {
  border-color: var(--line-strong);
  color: var(--fg-0);
}

.tab.on {
  background: rgb(168 232 92 / 12%);
  border-color: rgb(168 232 92 / 50%);
  color: var(--brand);
}

.card table {
  border-radius: 12px;
  overflow: hidden;
}

.sub {
  font-size: 11px;
  color: var(--fg-2);
}

.dim {
  color: var(--fg-2);
}

.more {
  display: flex;
  justify-content: center;
  padding: var(--s-3) 0;
}
</style>
