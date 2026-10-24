<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi, ApiError, type AdminStats, type AdminUser } from '@/api'

const stats = ref<AdminStats | null>(null)
const recent = ref<AdminUser[]>([])
const error = ref('')
const loading = ref(true)

function pct(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [s, u] = await Promise.all([adminApi.stats(), adminApi.users({ take: 5 })])
    stats.value = s
    recent.value = u.items
  } catch (e) {
    error.value = (e as ApiError).message
  } finally {
    loading.value = false
  }
}

onMounted(load)

function ago(iso: string | null): string {
  if (!iso) return '从未'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return '刚刚'
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} 分钟前`
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} 小时前`
  return `${Math.floor(ms / 86400_000)} 天前`
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <div class="kicker">DASHBOARD</div>
        <h1>概览</h1>
      </div>
      <button class="btn" :disabled="loading" @click="load">刷新</button>
    </header>

    <div v-if="error" class="err">{{ error }}</div>

    <div v-if="stats" class="cards">
      <div class="card stat">
        <div class="sl">总账号</div>
        <div class="sv mono">{{ stats.users.total }}</div>
        <div class="ss">游客 {{ stats.users.guests }} · 注册 {{ stats.users.registered }}</div>
        <div class="bar">
          <i :style="{ width: pct(stats.users.registered, stats.users.total) + '%' }" />
        </div>
      </div>

      <div class="card stat">
        <div class="sl">24 小时新增</div>
        <div class="sv mono">{{ stats.users.new24h }}</div>
        <div class="ss">7 日活跃 {{ stats.users.active7d }}</div>
      </div>

      <div class="card stat">
        <div class="sl">对局总数</div>
        <div class="sv mono">{{ stats.matches.total }}</div>
        <div class="ss">24 小时 {{ stats.matches.last24h }} 场</div>
      </div>

      <div class="card stat">
        <div class="sl">在线 / 封禁</div>
        <div class="sv mono">
          {{ stats.online }}<span class="dim"> / {{ stats.moderation.banned }}</span>
        </div>
        <div class="ss">WebSocket 连接数 / 当前封禁中</div>
      </div>
    </div>

    <section class="block">
      <div class="bh">
        <h2>最近注册</h2>
        <RouterLink class="btn" :to="{ name: 'users' }">全部账号 →</RouterLink>
      </div>

      <div class="card">
        <table v-if="recent.length" class="grid">
          <thead>
            <tr>
              <th>UID</th>
              <th>昵称</th>
              <th>类型</th>
              <th>角色</th>
              <th>最近登录</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in recent" :key="u.uid">
              <td class="mono dim">{{ u.uid }}</td>
              <td>
                <RouterLink :to="{ name: 'user', params: { uid: u.uid } }">{{ u.nickname }}</RouterLink>
              </td>
              <td>
                <span class="tag" :class="u.isGuest ? '' : 'tag-info'">{{ u.isGuest ? '游客' : '注册' }}</span>
              </td>
              <td>
                <span class="tag" :class="u.role === 2 ? 'tag-brand' : u.role === 1 ? 'tag-warn' : ''">
                  {{ u.roleLabel }}
                </span>
              </td>
              <td class="dim">{{ ago(u.lastLoginAt) }}</td>
              <td>
                <span v-if="u.bannedUntil" class="tag tag-danger">封禁中</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">还没有账号</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
  max-width: 1120px;
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
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

h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--fg-0);
}

.cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--s-3);
}

.stat {
  padding: var(--s-4);
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: relative;
  overflow: hidden;
}

.stat::after {
  content: '';
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgb(168 232 92 / 40%), transparent);
}

.sl {
  font-size: 12px;
  color: var(--fg-2);
}

.sv {
  font-size: 26px;
  color: var(--fg-0);
  line-height: 1.25;
}

.sv .dim {
  font-size: 18px;
  color: var(--fg-2);
}

.ss {
  font-size: 11px;
  color: var(--fg-2);
}

.bar {
  margin-top: 6px;
  height: 3px;
  border-radius: 2px;
  background: var(--bg-3);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--brand-dim), var(--brand));
  transition: width var(--t-mid) var(--ease);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.bh {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card table {
  border-radius: 12px;
  overflow: hidden;
}

.dim {
  color: var(--fg-2);
}

@media (max-width: 980px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
