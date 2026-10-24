<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi, ApiError, type AdminMatch } from '@/api'

const items = ref<AdminMatch[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const error = ref('')

const MODE_LABEL: Record<number, string> = { 0: '本地', 1: '人机', 2: '在线' }

async function load(reset = true): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    if (reset) nextCursor.value = null
    const page = await adminApi.matches(reset ? undefined : (nextCursor.value ?? undefined))
    items.value = reset ? page.items : [...items.value, ...page.items]
    nextCursor.value = page.nextCursor
  } catch (e) {
    error.value = (e as ApiError).message
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))

function dur(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <div class="kicker">MATCHES</div>
        <h1>对局</h1>
      </div>
      <button class="btn" :disabled="loading" @click="load(true)">刷新</button>
    </header>

    <p class="intro">
      联机还没接，所以这里现在应该是空的。等房间与信令打通，每场对局会连同回放一起落库；
      到时候这里点进某一场就是回放审计的入口。
    </p>

    <div v-if="error" class="err">{{ error }}</div>

    <div class="card">
      <table v-if="items.length" class="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>场地</th>
            <th>模式</th>
            <th>胜者</th>
            <th>时长</th>
            <th>玩家</th>
            <th>开始</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in items" :key="m.matchId">
            <td class="mono dim">#{{ m.publicId }}</td>
            <td>{{ m.stageId }}</td>
            <td>
              <span class="tag">{{ MODE_LABEL[m.mode] ?? m.mode }}</span>
            </td>
            <td class="mono">{{ m.winnerSlot === null ? '平' : `P${m.winnerSlot + 1}` }}</td>
            <td class="mono">{{ dur(m.durationMs) }}</td>
            <td class="mono dim">
              <span v-for="p in m.players" :key="p.uid" class="pl">
                {{ p.uid }}({{ p.damageDealt }}%)
              </span>
            </td>
            <td class="dim">{{ new Date(m.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="!loading" class="empty">还没有对局记录</div>
    </div>

    <div class="more">
      <button v-if="nextCursor" class="btn" :disabled="loading" @click="load(false)">加载更多</button>
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
  max-width: 760px;
}

.card table {
  border-radius: 12px;
  overflow: hidden;
}

.dim {
  color: var(--fg-2);
}

.pl {
  margin-right: 8px;
}

.more {
  display: flex;
  justify-content: center;
}
</style>
