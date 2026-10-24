/**
 * 后端 HTTP 接口冒烟测试。
 *
 * 为什么用 Node 而不是 PowerShell：中文昵称经过 PowerShell 的命令行与
 * ConvertTo-Json 会被 GBK 往返污染，测出来的 NICK_CHARSET 是测试工具的问题
 * 不是服务的问题。Node 里字符串是天然的 UTF-8，能测出真实行为。
 *
 * 跑法（服务端要先起在 3001）：
 *   node tools/test-api.mjs
 */

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3001/api'
const results = []

function ok(name, extra = '') {
  results.push({ name, pass: true, extra })
  console.log(`  \u2713 ${name}${extra ? `  ${extra}` : ''}`)
}
function bad(name, extra = '') {
  results.push({ name, pass: false, extra })
  console.log(`  \u2717 ${name}${extra ? `  ${extra}` : ''}`)
}
function head(t) {
  console.log(`\n${t}`)
}

/** 极简 cookie jar：只需要拿到 rt/at 并回送 */
function makeJar() {
  const jar = new Map()
  return {
    absorb(res) {
      const raw = res.headers.getSetCookie?.() ?? []
      for (const line of raw) {
        const [pair] = line.split(';')
        const i = pair.indexOf('=')
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    clear() {
      jar.clear()
    },
    get size() {
      return jar.size
    },
  }
}

async function call(path, { method = 'GET', body, token, jar, contentType = 'application/json' } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = contentType
  if (token) headers.authorization = `Bearer ${token}`
  if (jar && jar.size > 0) headers.cookie = jar.header()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (jar) jar.absorb(res)
  let json = null
  const text = await res.text()
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json }
}

const rand = () => Math.floor(Math.random() * 90000 + 10000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('后端接口冒烟测试')
  console.log(`目标: ${BASE}`)

  // ---------------------------------------------------------- 健康检查
  head('1. 健康检查')
  {
    const { status, json } = await call('/health/deep')
    status === 200 && json?.data?.db === 'up'
      ? ok('健康检查 db=up', `latency=${json.data.dbLatencyMs}ms`)
      : bad('健康检查', `status=${status} ${JSON.stringify(json)}`)
  }

  // -------------------------------------------------------------- 游客
  head('2. 游客登录')
  const jar = makeJar()
  let guestToken = ''
  let guestUid = ''
  {
    const { status, json } = await call('/auth/guest', { method: 'POST', body: {}, jar })
    if (status === 200 && json?.data?.user?.isGuest === true) {
      guestToken = json.data.accessToken
      guestUid = json.data.user.uid
      ok('创建游客', `uid=${guestUid} nick=${json.data.user.nickname} rt=${jar.size > 0 ? 'set' : 'MISSING'}`)
      jar.size > 0 ? ok('refresh cookie 已下发') : bad('refresh cookie 缺失')
    } else {
      bad('创建游客', `status=${status} ${JSON.stringify(json)}`)
    }
  }

  // -------------------------------------------------------------- /me
  head('3. 令牌鉴权')
  {
    const { status, json } = await call('/auth/me', { token: guestToken })
    status === 200 && json?.data?.user?.isGuest === true
      ? ok('/me 返回当前用户')
      : bad('/me', `status=${status} ${JSON.stringify(json)}`)

    const noTok = await call('/auth/me')
    noTok.status === 401 && noTok.json?.error?.code === 'UNAUTHENTICATED'
      ? ok('无令牌 → 401 UNAUTHENTICATED')
      : bad('无令牌鉴权', `status=${noTok.status} ${JSON.stringify(noTok.json)}`)

    const badTok = await call('/auth/me', { token: 'not.a.token' })
    badTok.status === 401 && badTok.json?.error?.code === 'TOKEN_INVALID'
      ? ok('坏令牌 → 401 TOKEN_INVALID')
      : bad('坏令牌', `status=${badTok.status} ${JSON.stringify(badTok.json)}`)
  }

  // -------------------------------------------------------------- 注册
  head('4. 账号注册')
  const email = `p${rand()}@test.local`
  const nickname = `铁匠${rand()}`
  const password = 'abcd1234'
  let userToken = ''
  {
    const { status, json } = await call('/auth/register', {
      method: 'POST',
      body: { email, nickname, password },
    })
    if (status === 200 && json?.data?.user?.isGuest === false) {
      userToken = json.data.accessToken
      ok('注册成功', `uid=${json.data.user.uid} nick=${json.data.user.nickname}`)
    } else {
      bad('注册', `status=${status} ${JSON.stringify(json)}`)
    }

    const dup = await call('/auth/register', { method: 'POST', body: { email, nickname: `另一个${rand()}`, password } })
    dup.status === 409 && dup.json?.error?.code === 'EMAIL_TAKEN'
      ? ok('重复邮箱 → 409 EMAIL_TAKEN')
      : bad('重复邮箱', `status=${dup.status} ${JSON.stringify(dup.json)}`)

    const dupNick = await call('/auth/register', {
      method: 'POST',
      body: { email: `p${rand()}@test.local`, nickname, password },
    })
    dupNick.status === 409 && dupNick.json?.error?.code === 'NICKNAME_TAKEN'
      ? ok('重复昵称 → 409 NICKNAME_TAKEN')
      : bad('重复昵称', `status=${dupNick.status} ${JSON.stringify(dupNick.json)}`)

    const shortPwd = await call('/auth/register', {
      method: 'POST',
      body: { email: `p${rand()}@test.local`, nickname: `短${rand()}`, password: 'abc' },
    })
    shortPwd.status === 400 && shortPwd.json?.error?.code === 'PASSWORD_LENGTH'
      ? ok('弱密码 → 400 PASSWORD_LENGTH')
      : bad('弱密码', `status=${shortPwd.status} ${JSON.stringify(shortPwd.json)}`)

    const badNick = await call('/auth/register', {
      method: 'POST',
      body: { email: `p${rand()}@test.local`, nickname: 'has space', password },
    })
    badNick.status === 400 && badNick.json?.error?.code === 'NICK_CHARSET'
      ? ok('昵称含空格 → 400 NICK_CHARSET')
      : bad('昵称字符集', `status=${badNick.status} ${JSON.stringify(badNick.json)}`)
  }

  // -------------------------------------------------------------- 登录
  head('5. 密码登录')
  {
    const j = makeJar()
    const good = await call('/auth/login', { method: 'POST', body: { email, password }, jar: j })
    good.status === 200 && good.json?.data?.user?.isGuest === false
      ? ok('登录成功', `rt=${j.size > 0 ? 'set' : 'MISSING'}`)
      : bad('登录', `status=${good.status} ${JSON.stringify(good.json)}`)

    const bad1 = await call('/auth/login', { method: 'POST', body: { email, password: 'wrongpass1' } })
    bad1.status === 401 && bad1.json?.error?.code === 'BAD_CREDENTIALS'
      ? ok('错密码 → 401 BAD_CREDENTIALS')
      : bad('错密码', `status=${bad1.status} ${JSON.stringify(bad1.json)}`)

    const ghost = await call('/auth/login', {
      method: 'POST',
      body: { email: `nobody${rand()}@test.local`, password },
    })
    ghost.status === 401 && ghost.json?.error?.code === 'BAD_CREDENTIALS'
      ? ok('不存在的账号 → 同样的 401（不泄露账号是否存在）')
      : bad('不存在的账号', `status=${ghost.status} ${JSON.stringify(ghost.json)}`)

    // ------------------------------------------------------ 刷新与轮换
    head('6. refresh 轮换')
    const before = j.header()
    const r1 = await call('/auth/refresh', { method: 'POST', jar: j })
    const after1 = j.header()
    r1.status === 200 && after1 !== before
      ? ok('refresh 换到新令牌')
      : bad('refresh', `status=${r1.status} ${JSON.stringify(r1.json)}`)

    // 不带任何 content-type 的 POST —— 浏览器 fetch 的真实形态
    const r2 = await call('/auth/refresh', { method: 'POST', hash: 1, jar: j })
    r2.status === 200
      ? ok('refresh 允许空 body 且无 content-type')
      : bad('refresh 空 body', `status=${r2.status} ${JSON.stringify(r2.json)}`)

    // 旧 token 立刻重放：宽限期内 + 账号下确实有一条更新的会话 → 判为并发刷新，放行。
    // 这正是多标签页同时刷新不会互相踢下线的机制。
    const replayNow = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: before, 'content-type': 'application/json' },
      body: '{}',
    })
    const replayNowJson = await replayNow.json()
    replayNow.status === 200
      ? ok('宽限期内旧令牌重放 → 判为并发刷新，放行')
      : bad('并发刷新容忍', `status=${replayNow.status} ${JSON.stringify(replayNowJson)}`)

    // 过了宽限期再重放：判为泄露，整账号强制下线。
    await sleep((Number(process.env.GRACE_SEC ?? 5) + 2) * 1000)
    const replayLate = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: before, 'content-type': 'application/json' },
      body: '{}',
    })
    const replayLateJson = await replayLate.json()
    replayLateJson?.error?.code === 'SESSION_COMPROMISED'
      ? ok('超过宽限期重放 → SESSION_COMPROMISED')
      : bad('超期重放', `status=${replayLate.status} ${JSON.stringify(replayLateJson)}`)

    // 全部会话已被吊销；access 是无状态 JWT，吊销 refresh 不影响它（15 分钟自然过期）
    const dead = await call('/auth/me', { token: r2.json?.data?.accessToken })
    dead.status === 200
      ? ok('access 无状态：吊销会话不影响已签发的 access（设计如此）')
      : bad('access 语义', `status=${dead.status}`)
  }

  // ---------------------------------------------------------- 游客升级
  head('7. 游客原地升级')
  {
    const upEmail = `up${rand()}@test.local`
    const upNick = `老赌鬼${rand()}`
    const { status, json } = await call('/auth/upgrade', {
      method: 'POST',
      token: guestToken,
      body: { email: upEmail, nickname: upNick, password: 'abcd1234' },
    })
    status === 200 && json?.data?.user?.isGuest === false && json?.data?.user?.uid === guestUid
      ? ok('升级后 uid 不变', `uid=${json.data.user.uid}`)
      : bad('游客升级', `status=${status} ${JSON.stringify(json)}`)

    const relogin = await call('/auth/login', { method: 'POST', body: { email: upEmail, password: 'abcd1234' } })
    relogin.status === 200
      ? ok('升级后可用新邮箱密码登录')
      : bad('升级后登录', `status=${relogin.status} ${JSON.stringify(relogin.json)}`)

    const upgradeAgain = await call('/auth/upgrade', {
      method: 'POST',
      token: relogin.json?.data?.accessToken,
      body: { email: `x${rand()}@test.local`, nickname: `再改${rand()}`, password: 'abcd1234' },
    })
    upgradeAgain.status === 403 || upgradeAgain.status === 409
      ? ok('已注册用户不能再升级')
      : bad('重复升级', `status=${upgradeAgain.status} ${JSON.stringify(upgradeAgain.json)}`)
  }

  // ---------------------------------------------------------- 登出
  head('8. 登出')
  {
    const j = makeJar()
    const lg = await call('/auth/login', { method: 'POST', body: { email, password }, jar: j })
    const rt = j.header()
    const out = await call('/auth/logout', { method: 'POST', jar: j })
    out.status === 200 ? ok('登出成功') : bad('登出', `status=${out.status}`)

    const reuse = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: rt, 'content-type': 'application/json' },
      body: '{}',
    })
    const reuseJson = await reuse.json()
    // 登出不产生"替身会话"，所以哪怕在宽限期内也必须判定失效——
    // 否则登出就有了一个 5 秒的撤销窗口（zod/宽限期逻辑里踩过这个坑）
    reuse.status === 401 && reuseJson?.error?.code === 'SESSION_COMPROMISED'
      ? ok('登出后立刻重放旧 refresh → 401（不留撤销窗口）')
      : bad('登出后重放', `status=${reuse.status} ${JSON.stringify(reuseJson)}`)

    void lg
  }

  // ---------------------------------------------------------- WebSocket
  head('9. WebSocket 首条消息鉴权')
  {
    const wsUrl = `${BASE.replace(/^http/, 'ws').replace(/\/api$/, '')}/ws`

    // 9.1 不鉴权：应在 ~3 秒后被服务端以 4001 关闭
    const r1 = await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl)
      const msgs = []
      const t0 = Date.now()
      ws.addEventListener('message', (e) => msgs.push(JSON.parse(e.data)))
      ws.addEventListener('close', (e) => resolve({ code: e.code, msgs, ms: Date.now() - t0 }))
      ws.addEventListener('error', () => resolve({ code: -1, msgs, ms: Date.now() - t0 }))
    })
    r1.code === 4001
      ? ok('未鉴权 → close 4001 鉴权超时', `${r1.ms}ms`)
      : bad('鉴权超时', `code=${r1.code} ms=${r1.ms}`)
    r1.msgs[0]?.t === 'hello' ? ok('连接后先收到 hello') : bad('hello 未收到')

    // 9.2 坏令牌 → 4003
    const r2 = await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl)
      ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'auth', token: 'bad.token.here' })))
      ws.addEventListener('close', (e) => resolve({ code: e.code }))
      ws.addEventListener('error', () => resolve({ code: -1 }))
    })
    r2.code === 4003 ? ok('坏令牌 → close 4003') : bad('坏令牌关闭码', `code=${r2.code}`)

    // 9.3 正确令牌 → ready + echo
    const r3 = await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl)
      let ready = null
      let echoed = null
      const done = () => resolve({ ready, echoed })
      ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'auth', token: guestToken })))
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data)
        if (m.t === 'ready') {
          ready = m
          ws.send(JSON.stringify({ t: 'echo', v: 42 }))
        } else if (m.t === 'echo') {
          echoed = m
          ws.close()
        }
      })
      ws.addEventListener('close', done)
      setTimeout(() => {
        ws.close()
        done()
      }, 4000)
    })
    r3.ready?.t === 'ready'
      ? ok('正确令牌 → ready', `uid=${r3.ready.uid} online=${r3.ready.online}`)
      : bad('WS 鉴权成功', JSON.stringify(r3))
    r3.echoed?.data?.v === 42 ? ok('鉴权后可收发消息') : bad('WS echo', JSON.stringify(r3.echoed))
  }

  // ---------------------------------------------------------- 结果
  const pass = results.filter((r) => r.pass).length
  const fail = results.length - pass
  console.log(`\n${'='.repeat(48)}`)
  console.log(`通过 ${pass} / ${results.length}${fail ? `，失败 ${fail}` : '，全部通过'}`)
  if (fail) {
    for (const r of results.filter((x) => !x.pass)) console.log(`  失败: ${r.name} ${r.extra}`)
  }
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('测试脚本异常:', e)
  process.exit(1)
})
