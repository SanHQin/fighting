<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminApi, ApiError, type AdminUserDetail } from '@/api'
import { useSession } from '@/session'

const route = useRoute()
const router = useRouter()
const { me } = useSession()

const detail = ref<AdminUserDetail | null>(null)
const loading = ref(true)
const error = ref('')
const toast = ref('')

// 封禁表单
const banHours = ref(24)
const banReason = ref('')
const busy = ref(false)

const uid = computed(() => String(route.params.uid ?? ''))
const isSelf = computed(() => !!detail.value && detail.value.user.uid === me.value?.uid)
const isStaff = computed(() => (me.value?.role ?? 0) >= 1)
const isAdmin = computed(() => (me.value?.role ?? 0) >= 2)
const isBanned = computed(() => {
  const u = detail.value?.user
  return !!u?.bannedUntil && new Date(u.bannedUntil).getTime() > Date.now()
})
const canActOn = computed(() => {
  const u = detail.value?.user
  if (!u || isSelf.value) return false
  if (u.role > (me.value?.role ?? 0)) return false
  return isStaff.value
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    detail.value = await adminApi.user(uid.value)
  } catch (e) {
    error.value = (e as ApiError).message
  } finally {
    loading.value = false
  }
}

onMounted(load)

function flash(msg: string): void {
  toast.value = msg
  window.setTimeout(() => (toast.value = ''), 2600)
}

async function run(fn: () => Promise<string>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    flash(await fn())
    await load()
  } catch (e) {
    error.value = (e as ApiError).message
  } finally {
    busy.value = false
  }
}

function doBan(): void {
  if (!banReason.value.trim()) {
    error.value = '封禁必须写理由 —— 三个月后没人记得为什么封的'
    return
  }
  void run(async () => {
    const r = await adminApi.ban(uid.value, banHours.value, banReason.value.trim())
    banReason.value = ''
    return `已封禁，撤销 ${r.revokedSessions} 个会话`
  })
}

function doUnban(): void {
  void run(async () => {
    await adminApi.unban(uid.value)
    return '已解除封禁'
  })
}

function doKick(): void {
  void run(async () => {
    const r = await adminApi.revokeSessions(uid.value)
    return `已强制下线（撤销 ${r.revoked} 个会话）`
  })
}

function doRole(role: number): void {
  void run(async () => {
    await adminApi.setRole(uid.value, role)
    return `角色已改为 ${role === 2 ? '管理员' : role === 1 ? '审核员' : '玩家'}`
  })
}

const nickname = ref('')
function doRename(): void {
  const n = nickname.value.trim()
  if (!n) return
  void run(async () => {
    await adminApi.setNickname(uid.value, n)
    nickname.value = ''
    return `昵称已改为 ${n}`
  })
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <button class="back" @click="router.push({ name: 'users' })">← 账号列表</button>
        <h1>{{ detail?.user.nickname ?? '账号详情' }}</h1>
        <div v-if="detail" class="subtitle mono">
          UID {{ detail.user.uid }} · {{ detail.user.roleLabel }} · 注册于 {{ fmt(detail.user.createdAt) }}
        </div>
      </div>
      <div v-if="detail" class="badges">
        <span class="tag" :class="detail.user.isGuest ? '' : 'tag-info'">
          {{ detail.user.isGuest ? '游客' : '注册' }}
        </span>
        <span v-if="isBanned" class="tag tag-danger">封禁中</span>
      </div>
    </header>

    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="toast" class="ok">{{ toast }}</div>

    <div v-if="loading" class="empty">加载中…</div>

    <div v-else-if="detail" class="cols">
      <!-- 左：资料 + 操作 -->
      <div class="col">
        <section class="card pad">
          <h2>资料</h2>
          <dl class="kv">
            <dt>邮箱</dt>
            <dd class="mono">{{ detail.user.email ?? '—（游客没有邮箱）' }}</dd>
            <dt>段位分</dt>
            <dd class="mono">{{ detail.user.rating }}</dd>
            <dt>战绩</dt>
            <dd class="mono">{{ detail.user.wins }} 胜 / {{ detail.user.losses }} 负</dd>
            <dt>最近登录</dt>
            <dd>{{ fmt(detail.user.lastLoginAt) }}</dd>
            <template v-if="isBanned">
              <dt>封禁至</dt>
              <dd class="danger">{{ fmt(detail.user.bannedUntil) }}</dd>
              <dt>封禁理由</dt>
              <dd>{{ detail.user.banReason ?? '—' }}</dd>
            </template>
          </dl>
        </section>

        <section class="card pad">
          <h2>处置</h2>

          <p v-if="isSelf" class="note">不能对自己执行处置 —— 这是把后台锁死的最短路径。</p>
          <p v-else-if="!isStaff" class="note">你的账号没有处置权限。</p>
          <p v-else-if="!canActOn" class="note">不能操作权限比你高的账号。</p>

          <div class="acts" :class="{ off: !canActOn }">
            <button class="btn btn-danger" :disabled="!canActOn || busy || isBanned" @click="doKick">
              强制下线
            </button>
            <button class="btn btn-danger" :disabled="!canActOn || busy || !isBanned" @click="doUnban">
              解除封禁
            </button>
          </div>

          <div class="ban" :class="{ off: !canActOn }">
            <div class="banrow">
              <select v-model.number="banHours">
                <option :value="1">1 小时</option>
                <option :value="24">1 天</option>
                <option :value="72">3 天</option>
                <option :value="168">7 天</option>
                <option :value="720">30 天</option>
                <option :value="0">永久</option>
              </select>
              <input v-model="banReason" placeholder="封禁理由（必填）" :disabled="!canActOn" />
              <button class="btn btn-danger" :disabled="!canActOn || busy" @click="doBan">封禁</button>
            </div>
            <p class="tip">封禁会同时撤销该账号的全部会话并踢下线，反应是立刻的。</p>
          </div>

          <div v-if="isAdmin" class="roles" :class="{ off: isSelf }">
            <span class="rl">角色</span>
            <button class="btn" :disabled="busy || detail.user.role === 0" @click="doRole(0)">玩家</button>
            <button class="btn" :disabled="busy || detail.user.role === 1" @click="doRole(1)">审核员</button>
            <button class="btn" :disabled="busy || detail.user.role === 2" @click="doRole(2)">管理员</button>
          </div>

          <div class="rename" :class="{ off: !canActOn }">
            <input v-model="nickname" placeholder="改成新的昵称" :disabled="!canActOn" />
            <button class="btn" :disabled="!canActOn || busy || !nickname.trim()" @click="doRename">改名</button>
          </div>
        </section>
      </div>

      <!-- 右：会话 + 对局 -->
      <div class="col">
        <section class="card pad">
          <h2>登录会话 <small>最近 {{ detail.sessions.length }} 条</small></h2>
          <table v-if="detail.sessions.length" class="grid">
            <thead>
              <tr>
                <th>创建</th>
                <th>IP</th>
                <th>客户端</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in detail.sessions" :key="s.id">
                <td class="dim">{{ fmt(s.createdAt) }}</td>
                <td class="mono">{{ s.ip ?? '—' }}</td>
                <td class="ua">{{ s.userAgent ?? '—' }}</td>
                <td>
                  <span v-if="s.revokedAt" class="tag">已吊销</span>
                  <span v-else class="tag tag-brand">有效</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty">没有会话记录</div>

          <p class="tip" style="margin-top: 10px">
            库里只存 refresh token 的 sha256，拿不到原文；看到「有效」表示这台的 cookie
            还能换出 access。撤销后要等对方下一次刷新才会掉线。
          </p>
        </section>

        <section class="card pad">
          <h2>最近对局 <small>最多 20 条</small></h2>
          <table v-if="detail.recentMatches.length" class="grid">
            <thead>
              <tr>
                <th>对局</th>
                <th>位</th>
                <th>角色</th>
                <th>剩余命</th>
                <th>输出</th>
                <th>最高连</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in detail.recentMatches" :key="m.matchId + '-' + m.slot">
                <td class="mono dim">#{{ m.matchId }}</td>
                <td class="mono">P{{ m.slot + 1 }}</td>
                <td class="mono">{{ m.charId }}</td>
                <td class="mono">{{ m.stocksLeft }}</td>
                <td class="mono">{{ m.damageDealt }}%</td>
                <td class="mono">{{ m.maxCombo }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty">还没有对局记录 —— 联机功能还没接，这是预期的</div>
        </section>
      </div>
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
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-4);
}

.back {
  font-size: 12px;
  color: var(--fg-2);
  padding: 0;
  margin-bottom: 4px;
}

.back:hover {
  color: var(--brand);
}

h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--fg-0);
}

.subtitle {
  font-size: 11px;
  color: var(--fg-2);
  margin-top: 3px;
}

.badges {
  display: flex;
  gap: 6px;
}

.cols {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: var(--s-4);
  align-items: start;
}

.col {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.pad {
  padding: var(--s-4);
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-0);
}

h2 small {
  color: var(--fg-2);
  font-size: 11px;
  font-weight: 400;
  margin-left: 4px;
}

.kv {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 6px 10px;
  margin: 0;
  font-size: 12.5px;
}

.kv dt {
  color: var(--fg-2);
}

.kv dd {
  margin: 0;
  color: var(--fg-0);
  word-break: break-all;
}

.kv .danger {
  color: var(--danger);
}

.acts {
  display: flex;
  gap: var(--s-2);
}

.off {
  opacity: 0.4;
  pointer-events: none;
}

.ban {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: var(--s-2);
  border-top: 1px dashed var(--line);
}

.banrow {
  display: flex;
  gap: 6px;
}

.banrow select {
  width: 92px;
}

.banrow input {
  flex: 1;
  min-width: 0;
}

.roles {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: var(--s-2);
  border-top: 1px dashed var(--line);
}

.rl {
  font-size: 12px;
  color: var(--fg-2);
  margin-right: 2px;
}

.rename {
  display: flex;
  gap: 6px;
}

.rename input {
  flex: 1;
  min-width: 0;
}

.note {
  margin: 0;
  font-size: 12px;
  color: var(--warn);
}

.tip {
  margin: 0;
  font-size: 11px;
  color: var(--fg-2);
  line-height: 1.7;
}

.ua {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-2);
  font-size: 11px;
}

.dim {
  color: var(--fg-2);
}

.ok {
  padding: 8px 12px;
  border-left: 2px solid var(--success);
  background: rgb(52 211 153 / 8%);
  color: var(--success);
  border-radius: 4px;
  font-size: 13px;
}

.card table {
  border-radius: 8px;
  overflow: hidden;
}

@media (max-width: 1060px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
