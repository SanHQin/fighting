/**
 * 后台接口冒烟测试。
 *
 * 前置：需要一个管理员账号（用 src/scripts/set-role.ts 提权）。
 * 默认用 root@fighting.local / admin12345，可用环境变量覆盖：
 *   ADMIN_EMAIL / ADMIN_PASSWORD / API_BASE
 */

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3001/api'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'root@fighting.local'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin12345'

const results = []
const ok = (n, e = '') => {
  results.push({ n, pass: true })
  console.log(`  \u2713 ${n}${e ? `  ${e}` : ''}`)
}
const bad = (n, e = '') => {
  results.push({ n, pass: false, e })
  console.log(`  \u2717 ${n}${e ? `  ${e}` : ''}`)
}
const head = (t) => console.log(`\n${t}`)

function jar() {
  const m = new Map()
  return {
    absorb(res) {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';')
        const i = pair.indexOf('=')
        if (i > 0) m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
    },
    header: () => [...m.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    get size() {
      return m.size
    },
  }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json }
}

async function main() {
  console.log('后台接口冒烟测试')

  // ------------------------------------------------------ 权限门禁
  head('1. 权限门禁')
  let adminToken = ''
  let plainToken = ''
  {
    const anon = await call('/admin/stats')
    anon.status === 401
      ? ok('未登录访问 /admin → 401')
      : bad('未登录门禁', `status=${anon.status} ${JSON.stringify(anon.json)}`)

    // 普通玩家
    const suffix = Math.floor(Math.random() * 90000 + 10000)
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { email: `plain${suffix}@test.local`, nickname: `平民${suffix}`, password: 'abcd1234' },
    })
    plainToken = reg.json?.data?.accessToken ?? ''
    plainToken ? ok('准备普通玩家账号') : bad('普通玩家注册', JSON.stringify(reg.json))

    const deny = await call('/admin/stats', { token: plainToken })
    deny.status === 403 && deny.json?.error?.code === 'FORBIDDEN'
      ? ok('普通玩家访问 /admin → 403 FORBIDDEN')
      : bad('普通玩家门禁', `status=${deny.status} ${JSON.stringify(deny.json)}`)

    // 管理员
    const lg = await call('/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    adminToken = lg.json?.data?.accessToken ?? ''
    adminToken ? ok('管理员登录') : bad('管理员登录', JSON.stringify(lg.json))

    const me = await call('/admin/me', { token: adminToken })
    me.json?.data?.role === 2
      ? ok('/admin/me', `nick=${me.json.data.nickname} role=${me.json.data.roleLabel}`)
      : bad('/admin/me', JSON.stringify(me.json))
  }

  // ---------------------------------------------------------- 概览
  head('2. 概览指标')
  {
    const s = await call('/admin/stats', { token: adminToken })
    const d = s.json?.data
    d?.users?.total > 0
      ? ok('/admin/stats', `用户 ${d.users.total}（游客 ${d.users.guests} / 注册 ${d.users.registered}）· 在线 ${d.online} · 封禁 ${d.moderation.banned}`)
      : bad('/admin/stats', JSON.stringify(s.json))
  }

  // -------------------------------------------------------- 用户列表
  head('3. 用户列表与筛选')
  let targetUid = ''
  {
    const list = await call('/admin/users?take=5', { token: adminToken })
    const items = list.json?.data?.items ?? []
    items.length > 0
      ? ok('/admin/users 分页', `${items.length} 条，nextCursor=${list.json.data.nextCursor ?? 'null'}`)
      : bad('/admin/users', JSON.stringify(list.json))

    const pw = items.find((u) => u.nickname === '平民' + '')
    void pw

    const guestList = await call('/admin/users?filter=guest&take=3', { token: adminToken })
    ;(guestList.json?.data?.items ?? []).every((u) => u.isGuest)
      ? ok('filter=guest 只返回游客')
      : bad('filter=guest', JSON.stringify(guestList.json))

    const staff = await call('/admin/users?filter=staff&take=5', { token: adminToken })
    const staffItems = staff.json?.data?.items ?? []
    staffItems.length > 0 && staffItems.every((u) => u.role > 0)
      ? ok('filter=staff 只返回后台账号', `${staffItems.length} 人`)
      : bad('filter=staff', JSON.stringify(staff.json))

    // 详情
    targetUid = items[0]?.uid ?? ''
    const detail = await call(`/admin/users/${targetUid}`, { token: adminToken })
    detail.json?.data?.user?.uid === targetUid
      ? ok('用户详情含会话与战绩', `sessions=${detail.json.data.sessions.length} matches=${detail.json.data.recentMatches.length}`)
      : bad('用户详情', JSON.stringify(detail.json))

    const missing = await call('/admin/users/99999999', { token: adminToken })
    missing.status === 404
      ? ok('不存在的用户 → 404')
      : bad('不存在用户', `status=${missing.status}`)
  }

  // ------------------------------------------------------------ 封禁
  head('4. 封禁 / 解封 / 审计')
  {
    const ban = await call(`/admin/users/${targetUid}/ban`, {
      method: 'POST',
      token: adminToken,
      body: { hours: 24, reason: '冒烟测试：封 24 小时', kick: true },
    })
    ban.status === 200
      ? ok('封禁成功', `until=${ban.json.data.bannedUntil.slice(0, 19)} 撤销会话=${ban.json.data.revokedSessions}`)
      : bad('封禁', `status=${ban.status} ${JSON.stringify(ban.json)}`)

    const detail = await call(`/admin/users/${targetUid}`, { token: adminToken })
    detail.json?.data?.user?.bannedUntil
      ? ok('封禁已落库', detail.json.data.user.banReason)
      : bad('封禁落库', JSON.stringify(detail.json?.data?.user))

    const bannedList = await call('/admin/users?filter=banned&take=5', { token: adminToken })
    ;(bannedList.json?.data?.items ?? []).some((u) => u.uid === targetUid)
      ? ok('filter=banned 能查到刚封的账号')
      : bad('filter=banned', JSON.stringify(bannedList.json))

    const unban = await call(`/admin/users/${targetUid}/unban`, { method: 'POST', token: adminToken })
    unban.status === 200 ? ok('解封成功') : bad('解封', `status=${unban.status}`)

    // 审核员不能封管理员；这里用「自己封自己」验证同级拦截
    const self = await call('/admin/me', { token: adminToken })
    const selfUid = self.json?.data?.uid
    const selfBan = await call(`/admin/users/${selfUid}/ban`, {
      method: 'POST',
      token: adminToken,
      body: { hours: 1, reason: '自己封自己', kick: false },
    })
    selfBan.status === 400 && selfBan.json?.error?.code === 'CANNOT_ACT_ON_SELF'
      ? ok('不能对自己执行封禁 → 400（防止把后台锁死）', selfBan.json?.error?.code)
      : bad('自封拦截', `status=${selfBan.status} ${JSON.stringify(selfBan.json)}`)

    const selfRevoke = await call(`/admin/users/${selfUid}/revoke-sessions`, {
      method: 'POST',
      token: adminToken,
    })
    selfRevoke.status === 400
      ? ok('不能撤自己的会话 → 400')
      : bad('自撤拦截', `status=${selfRevoke.status}`)

    const audit = await call('/admin/audit?take=10', { token: adminToken })
    const items = audit.json?.data?.items ?? []
    const actions = items.map((a) => a.action)
    actions.includes('user.ban') && actions.includes('user.unban')
      ? ok('审计日志记录了封禁与解封', `${items.length} 条`)
      : bad('审计日志', JSON.stringify(actions))

    const withActor = items.every((a) => a.actorNickname && a.actorNickname !== '')
    withActor ? ok('审计日志带操作人昵称') : bad('审计操作人', JSON.stringify(items[0]))
  }

  // ---------------------------------------------------------- 改昵称
  head('5. 运营改名')
  {
    const r = await call(`/admin/users/${targetUid}/nickname`, {
      method: 'POST',
      token: adminToken,
      body: { nickname: `改过的${Math.floor(Math.random() * 9000 + 1000)}` },
    })
    r.status === 200 ? ok('改昵称成功', r.json.data.nickname) : bad('改昵称', `status=${r.status} ${JSON.stringify(r.json)}`)

    const badNick = await call(`/admin/users/${targetUid}/nickname`, {
      method: 'POST',
      token: adminToken,
      body: { nickname: '有 空格' },
    })
    badNick.status === 400 ? ok('非法昵称被拒 → 400') : bad('非法昵称', `status=${badNick.status}`)
  }

  // ---------------------------------------------------------- 对局列表
  head('6. 对局列表')
  {
    const m = await call('/admin/matches?take=5', { token: adminToken })
    m.status === 200
      ? ok('/admin/matches', `${(m.json.data.items ?? []).length} 条`)
      : bad('/admin/matches', `status=${m.status} ${JSON.stringify(m.json)}`)
  }

  // ---------------------------------------------------------- 收尾
  const pass = results.filter((r) => r.pass).length
  const fail = results.length - pass
  console.log(`\n${'='.repeat(48)}`)
  console.log(`通过 ${pass} / ${results.length}${fail ? `，失败 ${fail}` : '，全部通过'}`)
  for (const r of results.filter((x) => !x.pass)) console.log(`  失败: ${r.n} ${r.e}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('测试脚本异常:', e)
  process.exit(1)
})
