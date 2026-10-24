<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi, ApiError, type AuditRow } from '@/api'

const items = ref<AuditRow[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const error = ref('')

const ACTION_LABEL: Record<string, string> = {
  'user.ban': '封禁',
  'user.unban': '解封',
  'user.setRole': '改角色',
  'user.revokeSessions': '强制下线',
  'user.setNickname': '改昵称',
}

async function load(reset = true): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    if (reset) nextCursor.value = null
    const page = await adminApi.audit(reset ? undefined : (nextCursor.value ?? undefined))
    items.value = reset ? page.items : [...items.value, ...page.items]
    nextCursor.value = page.nextCursor
  } catch (e) {
    error.value = (e as ApiError).message
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <div class="kicker">AUDIT LOG</div>
        <h1>审计</h1>
      </div>
      <button class="btn" :disabled="loading" @click="load(true)">刷新</button>
    </header>

    <p class="intro">
      只增不改不删。每一次封禁、改名、提权都会先写一条记录再执行 —— 审计写不进去，那件事就不会发生。
    </p>

    <div v-if="error" class="err">{{ error }}</div>

    <div class="card">
      <table v-if="items.length" class="grid">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>动作</th>
            <th>目标</th>
            <th>说明</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td class="mono dim">{{ fmt(r.createdAt) }}</td>
            <td>
              {{ r.actorNickname }}
              <span class="mono dim">({{ r.actorUid }})</span>
            </td>
            <td>
              <span class="tag" :class="r.action.includes('ban') ? 'tag-danger' : 'tag-info'">
                {{ ACTION_LABEL[r.action] ?? r.action }}
              </span>
            </td>
            <td>
              <RouterLink
                v-if="r.targetType === 'user'"
                :to="{ name: 'user', params: { uid: r.targetId } }"
                class="mono"
              >
                #{{ r.targetId }}
              </RouterLink>
              <span v-else class="mono dim">{{ r.targetType }}:{{ r.targetId }}</span>
            </td>
            <td class="detail">{{ r.detail ?? '—' }}</td>
            <td class="mono dim">{{ r.ip ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="!loading" class="empty">还没有审计记录</div>
    </div>

    <div class="more">
      <button v-if="nextCursor" class="btn" :disabled="loading" @click="load(false)">加载更多</button>
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

.intro {
  margin: 0;
  font-size: 12px;
  color: var(--fg-2);
  line-height: 1.75;
  max-width: 780px;
}

.card table {
  border-radius: 12px;
  overflow: hidden;
}

.dim {
  color: var(--fg-2);
}

.detail {
  max-width: 320px;
  color: var(--fg-1);
}

.more {
  display: flex;
  justify-content: center;
}
</style>
