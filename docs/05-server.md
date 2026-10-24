# 服务端与联机设计

> 项目：平台格斗游戏（大乱斗式） · 所属：[架构设计总纲](./00-overview.md)
>
> 版本 v0.10.5 ｜ 2026-10-24 ｜ 系列：1 总纲 + 8 专题

本文件回答两个问题：**服务端到底做什么**（第 2 章），**两端浏览器怎么做到逐帧一致**（第 3 章）。账号与会话见 [用户账号设计](./06-account.md)，数据落库见 [数据库设计](./07-database.md)。

---

## 1. 网络架构概览

这一章讲的是「两个浏览器之间怎么打同一局游戏」，以及为什么它能保证两端看到的是**逐帧完全一致**的对局。

先明确一件事：服务端**不跑战斗**（理由见 [架构总纲](./00-overview.md) 第 4.2 节）。真正跑模拟的只有两台玩家机器，服务端只负责让它们连上、记录结果。

### 1.1 三种可选架构

| 架构 | 服务端跑逻辑 | 输入延迟 | 抗作弊 | 成本 |
|---|---|---|---|---|
| **权威服务器**（如大部分 FPS） | ✅ 是 | 高（每帧往返） | ✅ 强 | 高（CPU × 玩家数） |
| **锁步（lockstep）** | ❌ 否 | 极高（等所有人输入） | ❌ | 低 |
| **P2P + 回滚（rollback）** | ❌ 否 | 低（本地立即响应） | ❌ 只能事后审计 | 低 |

我们选**第三种**，这也是所有现代格斗游戏的做法（GGPO 开创，之后几乎所有 2D 格斗都采用）。

**为什么锁步行不通**：锁步要求「所有人的第 N 帧输入都到了才能推进第 N 帧」。网络抖动一下，整个游戏就卡住。格斗游戏对手感的要求是**本地输入必须零延迟**，锁步做不到。

**回滚的核心思想**用一句话概括：

> 本地玩家按下按键，立刻在本机执行，不等对方确认。等对方的输入迟到了，就把之前的帧**回滚重算**一遍，算完再追上当前帧。

代价是「回滚重算的那几帧会发生画面突变」，需要用预测 + 平滑来掩盖。这就是后面 6 节要解决的问题。

### 1.2 模块划分

`packages/netcode` 是一个**独立包**，不依赖 Pixi、不依赖 Vue、不依赖 DOM。它只做三件事：管理会话、调度回滚、检测不同步。

```
packages/netcode/src/
├── session.ts      # 对局会话：持有 World 实例 + 帧调度 + 输入队列
├── predictor.ts    # 远端输入预测（丢包时猜对方按了什么）
├── rollback.ts     # 回滚执行器：保存快照 → 重演 → 追帧
├── syncCheck.ts    # 校验和比对，检测 desync
├── clock.ts        # 本地时间 → 逻辑帧号的换算（含帧率漂移补偿）
└── transport.ts    # 传输抽象：DataChannel / WebSocket 两种实现同一接口
```

**为什么要抽象 transport**：WebRTC 在对称 NAT 环境下可能连不上，必须能降级到 WebSocket 中继。业务代码不应该感知这个差异。

```ts
export interface Transport {
  send(frame: number, payload: Uint8Array): void;
  onReceive(cb: (frame: number, payload: Uint8Array) => void): void;
  readonly rtt: number;        // 平滑后的 RTT（毫秒）
  readonly lossRate: number;   // 近期丢包率 0..1
  close(): void;
}
```

### 1.3 一帧的完整流程

```
             本地输入采样
                   │
                   ▼
   ┌───────────────────────────────┐
   │ 1. 把本地输入写入 inputBuffer  │
   │ 2. 远端输入是否到达？           │
   │    ├─ 是 → 用真实输入          │
   │    └─ 否 → 用 predictor 猜     │
   │ 3. step(world, inputs)        │
   │ 4. 保存快照（环形缓冲，16 帧）   │
   │ 5. 若收到了更早帧的远端输入：    │
   │    回滚到该帧 → 重演到当前帧     │
   └───────────────────────────────┘
                   │
                   ▼
            渲染插值 → 画面
```

这个循环由 `session.ts` 驱动，**每个逻辑帧执行一次**，与渲染帧解耦（渲染可能 144Hz，逻辑固定 60Hz）。

### 1.4 关键参数

| 参数 | 值 | 含义 |
|---|---|---|
| `MAX_ROLLBACK` | 7 | 最多回滚多少帧（超出则接受卡顿，不再回滚） |
| `SNAPSHOT_POOL` | 16 | 快照环形缓冲大小（8 人模式需扩到 32） |
| `SYNC_INTERVAL` | 30 | 每 30 帧比对一次校验和 |
| `INPUT_DELAY` | 0（自适应 0~2） | 本地输入延迟帧数，RTT > 90ms 时升到 2 |
| 输入编码 | 2 字节/帧 | 见 [角色操作与动画设计](./01-characters.md) 第 4 节 |

---

## 2. 服务端设计

### 2.1 分层

```
server/src/
  index.ts                 → 启动 HTTP + WS
  http/routes/             → REST（auth、profile、replay）
  http/middleware/         → requireAuth / rateLimit / errorHandler
  security/                → argon2、JWT 签发验签、refresh 旋转（见 [06 账号](./06-account.md)）
  ws/gateway.ts            → 连接管理、心跳、首消息鉴权（8.8）
  ws/handlers/             → lobby / room / signal
  services/                → 业务逻辑（无 IO，可单测）
  db/                      → Prisma + MySQL
  redis/                   → 房间态、匹配队列、限流计数
```

### 2.2 房间生命周期

```
创建 → 等待 → 就绪 → 对战中 → 结束 → 销毁
 │      │      │       │        │
 │      │      │       │        └─ 落库战绩 + 回放（MySQL）
 │      │      │       └─ 心跳超时 15s 判负
 │      │      └─ 双方 ready → 下发 seed + 配对信息
 │      └─ 邀请码 6 位 / 匹配命中
 └─ Redis: room:{id} = Hash，TTL 30min
```

### 2.3 匹配

- **v1**：FIFO 队列 + 分数差阈值（初始 200，等待 10s 后放宽到 400）
- **v2**：Glicko-2 + 区域分桶

Redis `ZSET` 存队列，`score = enqueueTime`。

### 2.4 信令

服务端**不解析 SDP**，只转发：

```ts
{ type: 'signal', to: userId, payload: { sdp? } | { candidate? } }
```

TURN（coturn）作为对称 NAT 兜底。

### 2.5 回放存储

**只存输入，不存状态**：

```ts
interface ReplayRecord {
  matchId: string;
  rulesetHash: number;
  seed: number;
  charIds: number[];
  stageId: number;
  frames: number;
  inputs: Buffer[];      // 每人一份，每帧 2 字节
  result: { winner: number; stocksLeft: number[] };
}
```

一场 3 分钟对局：`180 × 60 × 2 × 2 = 43KB`（未压缩），`gzip` 后约 10KB。MySQL `LONGBLOB` 毫无压力。

---

## 3. 确定性与回滚专题

### 3.1 desync 成因（按概率）

| # | 原因 | 占比 |
|---|---|---|
| 1 | 用了三角函数 `Math.sin/cos/pow/atan2` | 40% |
| 2 | 状态没全部进快照（漏字段） | 25% |
| 3 | 用了 `Math.random` / `Date.now` | 20% |
| 4 | 帧数据版本不一致 | 10% |
| 5 | 遍历顺序 / `Set` 迭代 | 5% |

> **v0.1 修正**：`Object.keys` / `Map` / `Set` 的遍历顺序在 ES2015 之后**有规范保证**，不会导致 desync。用数组主要是为了性能和快照序列化。它从 10% 降到 5%（只剩 `for...in` 遍历原型链这种真问题）。

### 3.2 允许 / 禁止清单（重要）

| 运算 | 状态 | 说明 |
|---|---|---|
| `+ - * /` | 允许 | IEEE 754 严格保证跨引擎一致 |
| `Math.sqrt` | 允许 | 硬件指令，实测一致 |
| `Math.abs / min / max / floor / ceil / round / trunc` | 允许 | 精确语义 |
| `Math.sin / cos / tan / asin / acos / atan / atan2` | **禁止** | 规范和实现差异 |
| `Math.pow / exp / log` | **禁止** | 同上 |
| `Math.hypot` | **禁止** | 实现差异 |
| `Math.random` | **禁止** | 非确定 |
| `Date.now / performance.now` | **禁止** | 外部状态 |

**替代方案**：

```ts
// 1. 三角函数 → 查表（角度按整数度）
import { SIN_TABLE, COS_TABLE } from '@fighting/shared/math/trigTable';
const vx = speed * COS_TABLE[angle & 0x1ff];  // 512 项，精度 0.7°

// 2. 距离 → 用平方比较，避免开方
const dx = a.x - b.x, dy = a.y - b.y;
if (dx * dx + dy * dy < R * R) { /* 命中 */ }
```

**生成查表**（构建期跑一次，结果硬编码）：

```ts
// tools/gen-trig-table.ts
const SIN = new Float64Array(512);
for (let i = 0; i < 512; i++) SIN[i] = Math.sin((i / 512) * 2 * Math.PI);
// 输出为 TS 字面量 → packages/shared/src/math/trigTable.ts
```

> **关键**：表是用 `Math.sin` 生成的，但**只在构建期算一次，把数值写死进源码**。运行时只读常量，不涉及浮点差异。

### 3.3 eslint 规则

```jsonc
{
  "rules": {
    "no-restricted-properties": ["error",
      { "object": "Math", "property": "sin" },
      { "object": "Math", "property": "cos" },
      { "object": "Math", "property": "tan" },
      { "object": "Math", "property": "atan2" },
      { "object": "Math", "property": "pow" },
      { "object": "Math", "property": "random" },
      { "object": "Date", "property": "now" }
    ],
    "no-restricted-globals": ["error", "performance", "window", "document"]
  }
}
```

### 3.4 快照往返自检

```ts
if (__DEV__) {
  const before = checksum(w);
  const s = pool.acquire();
  save(w, s);
  load(w, s);
  assert(before === checksum(w), `snapshot roundtrip mismatch @ frame ${w.frame}`);
}
```

这条断言能抓住 90% 的"漏字段"问题。

### 3.5 回滚流程

```
每帧：
  1. 采样本地输入 localInput[f]
  2. 取远端输入：已收到 → 真实值；未收到 → 预测（重复上一帧）
  3. step(world, [local, remote])
  4. saveSnapshot(world, f)

收到远端第 F 帧输入且 F < currentFrame：
  if 真实值 ≠ 当时预测值：
    latest = currentFrame - 1
    loadSnapshot(F - 1)
    for f = F .. latest:
      remote[f] = (f === F) ? 真实 : 预测
      step(world, [local[f], remote[f]])
      saveSnapshot(world, f)
```

**参数**：

```ts
const MAX_ROLLBACK = 7;       // 最多回滚 7 帧（117ms）
const SNAPSHOT_POOL = 16;     // 快照池
const SYNC_INTERVAL = 30;     // 每 30 帧校验和比对
const INPUT_DELAY = 0;        // 默认无延迟，RTT > 90ms 时自适应到 2
```

### 3.6 反作弊（v1 范围）

| 风险 | 对策 |
|---|---|
| 改帧数据（判定框变大） | `rulesetHash` 校验，不匹配拒绝连接 |
| 非法输入 | 回放可复现，异常对局事后审计 |
| 断线逃避 | 心跳超时判负 |

## 4. 实现现状（v0.8.0）

本章记录代码与本文设计的**偏差**——文档描述目标状态，代码才是事实。凡本文与代码不一致，以本节为准。

### 4.1 已经跑起来的部分

| 层 | 状态 | 位置 |
|---|---|---|
| HTTP 服务（Fastify 5） | ✅ 跑通 | `packages/server/src/http/app.ts` |
| 账号接口 | ✅ 29 条断言全过 | `packages/server/src/http/routes/auth.ts` |
| 后台接口 | ✅ 22 条断言全过 | `packages/server/src/http/routes/admin.ts` |
| MySQL 落库 | ✅ 7 张业务表 + 审计表 | `tools/ddl.sql` |
| WebSocket 首条消息鉴权 | ✅ 跑通 | `packages/server/src/ws/gateway.ts` |
| 房间 / 匹配 / 信令 / 回滚 | ❌ 未开工 | — |
| Redis | ❌ 未引入 | 连接表暂在进程内存 |

### 4.2 三处技术选型变更

**① Prisma 7 必须走 driver adapter。** Prisma 7 取消了内置连接器，`new PrismaClient()` 不传 `adapter` 直接抛错。用 `@prisma/adapter-mariadb`：

```ts
const adapter = new PrismaMariaDb(poolOptions(config.DATABASE_URL, config.DATABASE_POOL_SIZE))
export const prisma = new PrismaClient({ adapter, log: config.isProd ? ['error'] : ['error', 'warn'] })
```

`poolOptions()` 里有一条**必须显式开启**的选项——不加就是"时好时坏连不上"：

```ts
return {
  host, port, user, password, database,
  connectionLimit,
  acquireTimeout: 10_000,
  idleTimeout: 60,
  allowPublicKeyRetrieval: true,   // ← 缺这行就会 45044 RSA public key is not available
}
```

原因：MySQL 8 默认 `caching_sha2_password`，**非 TLS** 连接做完整认证时服务端要下发 RSA 公钥，mariadb 驱动默认拒收。服务端会缓存认证成功结果，缓存命中的那次是 fast auth 不需要公钥——所以症状是"偶尔能连、偶尔报 45044"，而非稳定失败。生产要么开 TLS，要么固定 `cachingRsaPublicKey`，都不该保留这个开关。

**② 服务端用 Node 原生 TypeScript 跑，不用 tsx。** Node 22.20 的类型擦除已够用，`node src/index.ts` 直接起。代价是两条约束：

- **import 必须写 `.ts` 后缀**（类型擦除只删类型、不改路径），配 `allowImportingTsExtensions: true` + `rewriteRelativeImportExtensions: true`，`tsc` 编译时自动写回 `.js`。
- `src/generated/prisma/index.js` 是唯一例外——它是真实 `.js`，写成 `.ts` 会 `ERR_MODULE_NOT_FOUND`。
- 顺带删掉 `tsx` 依赖，少一层 esbuild。

**③ 建表用等价手写 DDL，不用 `prisma migrate`。** `migrate dev` / `migrate diff` 都要 spawn `schema-engine-windows.exe`。`tools/ddl.sql` 是 `schema.prisma` 的等价物，**改 schema 必须同步改它**。不受限的机器上直接 `pnpm db:migrate` 即可。

### 4.3 一处设计修正：空 body 的 POST 不该 415

`POST /api/auth/refresh` 与 `POST /api/auth/logout` 都不需要请求体，但浏览器 `fetch` 不带 `Content-Type` 时 Fastify 回 `415 Unsupported Media Type`。修法是**只放宽空的请求体**，不要放宽这个类型：

```ts
app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
  const buf = body as Buffer
  if (buf.length === 0) { done(null, {}); return }
  done(err.badRequest('UNSUPPORTED_CONTENT_TYPE', '只接受 application/json'), undefined)
})
```

### 4.4 一个真实的安全漏洞与它的修法

`rotateSession()` 的并发刷新宽限期，第一版写成"`revokedAt` 在 5 秒内就放过"，结果**登出后的旧 refresh cookie 能在 5 秒内重放登录成功**——因为登出也设 `revokedAt`，被当成了并发刷新。

正确的判据不是时间，而是**"这条记录被吊销的同时，账号下确实多了一条更新的会话"**：

```ts
if (withinGrace) {
  const replacement = await prisma.userSession.findFirst({
    where: {
      userId: found.userId,
      createdAt: { gte: new Date(found.revokedAt.getTime() - 1000) },
      id: { not: found.id },
    },
    select: { id: true },
  })
  if (replacement) return { ...(await createSession(found.userId, meta)), uid: found.userId }
}
// 找不到替身 → 一律按被盗：整账号下线
await prisma.userSession.updateMany({
  where: { userId: found.userId, revokedAt: null },
  data: { revokedAt: new Date() },
})
throw err.unauthorized('SESSION_COMPROMISED', '会话已失效，请重新登录')
```

时间窗口只能说明"可能"，会话链才能说明"确实"。多标签页同时刷新时旧 token 一定已经有替身，登出时一定没有——这个区分不需要任何额外状态。

### 4.5 关于 Redis

本文 §2.5 把房间态、匹配队列、限流计数都放在 Redis。**v0.8 只落了内存版**：

- 限流用 `@fastify/rate-limit` 的进程内计数（单实例够用，多实例会各限各的）
- WebSocket 连接表 `byUid: Map<string, Set<Conn>>` 在进程内存里（同一账号连两个实例会各算一份在线数）

这两处都要等"多实例部署"才真正需要 Redis；在那之前引入它只是多一个会挂的依赖。

### 4.6 接口清单（实际实现的）

```
GET  /api/health                          GET  /api/health/deep
POST /api/auth/guest                      POST /api/auth/register
POST /api/auth/login                      POST /api/auth/refresh
POST /api/auth/logout                     POST /api/auth/logout-all
GET  /api/auth/me                         POST /api/auth/upgrade
GET  /api/auth/probe
GET  /api/admin/me                        GET  /api/admin/stats
GET  /api/admin/users                     GET  /api/admin/users/:uid
POST /api/admin/users/:uid/ban            POST /api/admin/users/:uid/unban
POST /api/admin/users/:uid/role           POST /api/admin/users/:uid/revoke-sessions
POST /api/admin/users/:uid/nickname
GET  /api/admin/matches                   GET  /api/admin/audit
WS   /ws                                  （3 秒内首条消息 {t:'auth',token}）
```

统一响应形状：成功 `{ ok: true, data }`，失败 `{ ok: false, error: { code, message, detail? } }`。前端只按 `code` 分支，不解析 `message`——`message` 给人看，`code` 给代码看。


