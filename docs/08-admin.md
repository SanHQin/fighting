# 后台管理设计（GM 系统）

> 项目：平台格斗游戏（大乱斗式） · 所属：[架构设计总纲](./00-overview.md)
>
> 版本 v0.10.5 ｜ 2026-10-24 ｜ 系列：1 总纲 + 8 专题

---

## 1. 定位与边界

### 1.1 它不是什么

| 误解 | 事实 | 后果 |
|---|---|---|
| 「第二个玩家界面」 | 玩家永远看不到后台，没有美术、没有动效 | 别在上面花 UI 时间 |
| 「v1 做运营大屏」 | DAU < 5000、一天几百局，折线图拉不出趋势 | 大屏 v2 再说，v1 给表格 |
| 「实时看 / 控战斗」 | **服务端不跑战斗**（[总纲 §4.2](./00-overview.md)）：两端浏览器 P2P 直连，服务端手里没有帧、没有状态 | 没有实时观战，没有暂停对局 |

第三条是硬约束。服务端只有房间元数据、seed、双方输入日志、终局 checksum；断 WS 信令也拦不住已建立的 DataChannel，**「立刻断掉开挂的人」技术上做不到**，只能事后看回放、事后处置账号。

### 1.2 它是什么

一句话：**问题响应工具 + 数据查询工具，不是运营平台**。两个场景：① 客服收到反馈（「这人开挂」「我战绩丢了」）→ 查用户 → 查对局 → 看回放 → 结论 → 处置；② 开发排障（「昨晚那批对局为什么 rating 没变」）→ 查数据、查日志。共同点是低频、深链路、要看原始数据：不需要仪表盘，需要「输入 uid，五秒内看到该看到的一切」。

### 1.3 v1 功能范围

| 做 | 不做（v1 明确砍掉） |
|---|---|
| 登录（密码 + TOTP）、RBAC、操作审计 | 数据大屏、图表报表、BI 工具 |
| 用户搜索/详情/封禁/强制下线/重置密码/标记 | 批量操作、导入导出、CSV 下载 |
| 对局查询/详情/回合明细、回放审计 | 实时对局监控、在线房间列表、自动封号 |
| 核心指标 SQL、公告、功能开关、维护模式 | 预聚合宽表、埋点体系、A/B 实验、推送管理 |
| 错误日志检索、慢查询 TOP 20 | 日志平台（ELK/Loki）、告警配置 |

### 1.4 v1 必做 / v2 再说

| # | 模块 | v1 | v2 | 理由 |
|---|---|---|---|---|
| 1 | 密码登录 + TOTP 2FA | **必做** | — | 无 2FA 等于把库挂公网 |
| 2 | RBAC 5 角色 + 服务端校验 | **必做** | — | 后改牵连全站 |
| 3 | 操作审计日志 | **必做** | — | 封错人无法追责，客服不敢用 |
| 4 | 用户搜索 + 详情 | **必做** | — | 80% 工单从「查这个人」开始 |
| 5 | 封禁 / 解封（账号级） | **必做** | — | 不能处置等于只读后台 |
| 6 | 强制下线（吊销全部会话） | **必做** | — | 盗号应急的唯一手段 |
| 7 | 对局查询 + 回合明细 | **必做** | — | 回放审计的入口 |
| 8 | 回放重演 + 人工判定 | **必做** | — | 唯一反作弊手段 |
| 9 | 核心指标 SQL（DAU/新增/对局/时长/留存） | **必做** | — | 半天都用不到 |
| 10 | 公告 + 开关 + 维护模式 | **必做** | — | 出事故时唯一的止血阀 |
| 11 | 错误日志 / 慢查询检索 | **必做** | — | 排障刚需，实现就是流式 grep |
| 12 | 举报工单 | 极简 | 完整版 | v1 只有一张表 + 结算页一个按钮 |
| 13 | IP 级封禁 / CSV 导出 / 自动封号 | 不做 | v2 | NAT 误伤高；导出即 PII 外流；误封代价大于漏封 |
| 14 | 操作回滚 | 不做 | v2 | 靠审计日志人工回补 |
| 15 | 实时观战 / 在线房间 | **不可能** | **不可能** | 服务端不跑战斗（§1.1） |

---

## 2. 技术选型与工程结构

### 2.1 Vue 3 + Naive UI 自建，不用 admin 模板

**结论：沿用现有 Vue 3 + TS + Vite 5 + Naive UI 自建，不引入 Ant Design Pro / vben-admin。**

| 方案 | 判断 | 理由 |
|---|---|---|
| admin 模板 | 否 | 自带 mock/权限/多语言一整套世界观，与已有 Pinia store、请求拦截器对不上，**改造成本 ≥ 自建** |
| Naive UI 自建 | **是** | 与主前端共用 TS 配置与请求封装，学习成本 0；`n-data-table` + `n-form` 覆盖全部需求 |
| SQL 客户端 + 命令行 | 否 | 无权限、无审计、脱敏靠自觉 |

模板的价值只在「有 50 个页面要写」时兑现，而 v1 只有 **7 个页面**（登录、用户列表、用户详情、对局列表、对局详情、回放审计、系统设置），引入脚手架约等于用 3 天换 0.5 天。真正要白拿的只是 `n-data-table` 的远程分页与 `n-form` 校验；不装 echarts（不画图）。

### 2.2 独立应用，不进主前端

**结论：`packages/admin` 独立应用、独立子域 `admin.example.com`、独立构建产物。** 三条理由：**攻击面隔离**——玩家端匿名可访问且加载第三方资源，打包在一起时玩家端任何 XSS 或依赖投毒都能同源打到后台；**不需要那 2.5MB**——玩家端战斗包 2.5MB，同包运营每天先等 PixiJS 下载完，独立后首屏 < 200KB；**能加 IP 白名单**——Nginx 对后台域名直接 `allow/deny`，同域名下做不到（玩家端必须对全网开放）。附带好处是发版解耦。代价是多一份 `vite.config`、一个 CI 产物、一个 Nginx server 块，约 0.2 天，**必须花**。

```text
packages/admin/src/
├─ api/{client,users,matches,replay,system}.ts
├─ views/{Login, users/UserList, matches/MatchDetail, replay/ReplayAudit, system/SystemPanel}.vue
└─ components/{BanDialog, ConfirmByUid}.vue
```

依赖规则（eslint `no-restricted-imports`）：`admin ← shared`、`admin ← battle-core`（只 import `sim/input/checksum`；该包 tsconfig 无 DOM，可在浏览器里重演）、`admin ✗ client`、`admin ✗ pixi.js`。前端约定：accessToken 只存内存，refresh 走 `Path=/api/admin/auth` 的 httpOnly Cookie；列表统一 `useTable()`；界面时区 `Asia/Shanghai`、接口传 UTC ISO8601；**所有 id 当 `String`**（`BIGINT UNSIGNED` 超 `Number.MAX_SAFE_INTEGER`）。

---

## 3. 权限模型

### 3.1 角色

管理员是**独立账号体系**（`admin_users`），不复用 `users`：玩家表百万行、游客占多数，把 `role` 塞进去意味着一次误 UPDATE 就批量提权，且任何玩家表注入直接变后台提权。

| 角色 | 值 | 谁 | 日常 |
|---|---|---|---|
| `VIEWER` | 0 | 制作人、外部观察者 | 只看统计 |
| `AUDITOR` | 1 | 安全 / 风控（可兼职） | 只读全量 + 看审计日志，**不能改任何东西** |
| `SUPPORT` | 2 | 客服 | 查用户、强制下线、触发重置；**不能封禁** |
| `OPERATOR` | 3 | 运营 | 以上 + 封禁/解封 + 公告 + 开关 + 回放判定 |
| `SUPER_ADMIN` | 4 | 开发者（1-2 人） | 全部 + 管理员管理 + 明文解锁 |

**不做权限点（permission string）细粒度**：5 角色 × 15 模块只有 75 格，20 行枚举代码就能覆盖；权限点要 3 张表 + 管理界面，v1 不值。**SUPPORT 不能封禁**是刻意的——封禁最易误伤，客服也最易被玩家情绪影响，只能提交「封禁建议」。

### 3.2 权限矩阵

`R` 只读 / `W` 可写 / `—` 无权（接口 403，前端不渲染入口）。

| 功能模块 | SUPER_ADMIN | OPERATOR | SUPPORT | AUDITOR | VIEWER |
|---|:--:|:--:|:--:|:--:|:--:|
| 用户搜索 / 详情 | W | W | W | R | R |
| 用户备注 / 游客异常标记 | W | W | W | — | — |
| 封禁 / 解封（账号级） | W | W | — | — | — |
| 强制下线 / 吊销单会话 | W | W | W | — | — |
| 重置密码（发重置邮件） | W | — | W | — | — |
| 邮箱 / IP 明文解锁 | W | — | — | — | — |
| 对局查询 / 回合明细 | R | R | R | R | R |
| 回放播放（重演） | R | R | R | R | R |
| 回放判定 / 可疑标记 | W | W | — | R | — |
| 核心指标统计 | R | R | — | R | R |
| 公告发布 / 下线 | W | W | — | R | — |
| 功能开关 / 维护模式 | W | W | — | R | — |
| 错误日志 / 慢查询 | R | — | — | R | R |
| 操作审计日志 | R | R | — | R | — |
| 管理员账号管理 | W | — | — | — | — |

### 3.3 校验在哪一层

**必须服务端校验；前端隐藏按钮只是体验优化。** 四道，缺一不可：Nginx（内网 IP）→ `requireAdmin`（JWT `aud=admin` + `admin_users.status` + Redis 会话存活）→ `allow([roles])`（路由显式声明）→ Service 业务断言（「不能封禁自己」）。注意 `AUDITOR` 的秩低于 `SUPPORT` 却能看日志，所以**只读接口不能按角色秩判断，必须显式列角色**：

```ts
export function allow(roles: AdminRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const c = req.admin;                      // requireAdmin 注入 { sub, role, aud:'admin', sid }
    if (!c) return reply.code(401).send(err('ADMIN_UNAUTHORIZED'));
    if (!roles.includes(c.role)) return reply.code(403).send(err('ADMIN_FORBIDDEN'));
    if (!(await redis.expire(`admin:sess:${c.sid}`, 3600)))   // 1 小时无操作即失效
      return reply.code(401).send(err('ADMIN_SESSION_EXPIRED'));
  };
}
fastify.post('/api/admin/users/:uid/ban', { preHandler: [allow(['SUPER_ADMIN', 'OPERATOR'])] }, h);
```

### 3.4 操作审计日志

**为什么必须有**：① 封错人/误发公告要能回答「谁、何时、基于什么理由」，否则团队互相怀疑，最后没人敢用后台；② v1 没有回滚（§1.4），但 `detail` 存了变更前后值，可人工回补；③ 管理员账号被盗时，异常操作序列（深夜连封 50 人）是唯一早期信号；④ 处理邮箱、IP 等 PII 多数地区要求可审计。

```prisma
model AdminAuditLog {
  id        BigInt   @id @default(autoincrement()) @db.UnsignedBigInt
  adminId   BigInt   @map("admin_id")   @db.UnsignedBigInt
  adminName String   @map("admin_name") @db.VarChar(32)   // 冗余快照：改名/删号后仍可追溯
  adminRole String   @map("admin_role") @db.VarChar(16)
  action    String   @db.VarChar(64)                      // user.ban / session.revoke / replay.judge
  targetType String  @map("target_type") @db.VarChar(32)
  targetId  String   @map("target_id")   @db.VarChar(64)
  detail    Json?                                         // { before, after }
  reason    String   @db.VarChar(255)                     // 必填，来自表单
  ip        String   @db.VarChar(45)
  createdAt DateTime @default(now()) @map("created_at") @db.DateTime(3)
  @@index([adminId, createdAt])
  @@index([targetType, targetId, createdAt])
  @@map("admin_audit_logs")
}
```

**写在哪一层**：不写进业务 handler（会漏），用 `onResponse` hook + 路由声明式配置，只有 2xx 落库：

```ts
fastify.addHook('onResponse', async (req, reply) => {
  const a = req.routeOptions.config?.audit;
  if (!a || reply.statusCode >= 300) return;
  await prisma.adminAuditLog.create({ data: {
    adminId: BigInt(req.admin!.sub), adminName: req.adminName, adminRole: req.admin!.role,
    action: a.action, targetType: a.targetType, targetId: a.targetId(req),
    detail: req.auditDetail ?? null, reason: req.body?.reason ?? '', ip: req.ip,
  }});
});
```

**不可篡改的三条硬约束**：应用层 DB 账号对该表**只有 `INSERT`/`SELECT`**（`GRANT INSERT, SELECT ON fighting.admin_audit_logs TO 'app'@'%';`）；清理走独立账号，保留 180 天，清理本身也写一条（`audit.purge`）；**后台界面不提供任何删除入口，包括超管**。

---

## 4. 功能模块逐个设计

### 4.1 用户管理

**搜索**：一个输入框，服务端按格式判字段——`u_` 开头查 `uid`、含 `@` 查 `email`、其余 `nickname` 前缀匹配。只允许前缀 `LIKE`：`%kw%` 会全表扫（M8 后可能 10 万行），也等于给了运营「模糊捞人」的能力。

```sql
SELECT id, uid, nickname, is_guest, rating, wins, losses, last_login_at
FROM users WHERE nickname LIKE CONCAT(?, '%') ORDER BY id DESC LIMIT 20;
```

**详情**一屏四块，全部来自已有表：基础（uid / 昵称 / 是否游客 / 邮箱打码 / 注册时间 / 最后登录）、战绩（rating、RD、胜负、最近 20 局走 `idx(user_id, id)`）、会话（有效会话数、最近 IP 打码、UA）、处置（封禁状态与历史、标记、举报）。

**封禁：账号级，v1 不做 IP 级**。理由：共享 IP（校园网/网吧/NAT）必然误伤；IP 封禁能挡的「批量注册小号」已由 `rl:register:{ip}`（3 次/小时）覆盖；IP 是动态的，封了明天就换；且 IP 封禁要另一套申诉流程，v1 没人力。

| 项 | 规则 |
|---|---|
| 时长 | `1h` / `24h` / `7d` / `30d` / `永久`，默认 7d |
| 理由 | **必填 ≥ 10 字**，写入 `user_bans.reason` 与审计日志 |
| 证据 | 可选 `evidence_match_id`；从回放审计发起的封禁必填 |
| 生效 | 写 `user_bans` + 吊销全部会话 + `ban:{userId}` 缓存 60s + 踢 WS |

`user_bans` 字段：`userId`、`reason VarChar(255)`、`evidenceMatchId?`、`expiresAt?`（null = 永久）、`revokedAt?`（提前解封）、`createdBy`；索引 `(userId, revokedAt)`、`(expiresAt)`。解封是 `SET revoked_at = UTC_TIMESTAMP(3)`，**不删记录**。判定在登录 / WS 握手 / 匹配入队三处共用，带 60 秒缓存：

```ts
async function isBanned(userId: bigint): Promise<boolean> {
  const hit = await redis.get(`ban:${userId}`);
  if (hit) return hit === '1';
  const b = await prisma.userBan.findFirst({
    where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { id: 'desc' },
  });
  await redis.set(`ban:${userId}`, b ? '1' : '0', 'EX', 60);
  return !!b;
}
```

封禁对已签发的 access token 有 ≤15 分钟延迟（JWT 无状态），但 `isBanned()` 在 WS 握手与入队都查，实际效果是「还能挂在大厅，但进不了对局」。**强制下线**（盗号/违规应急）：

```ts
await prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
for (const c of await redis.smembers(`ws:conn:${userId}`)) gateway.close(c, 4003, 'KICKED_BY_ADMIN');
await redis.set(`revoked:user:${userId}`, '1', 'EX', 900);   // ★ 让未过期的 access 立即失效
```

`revoked:user:{id}` 是「access token 不可吊销」的唯一补丁，成本是一次 Redis GET（命中率 < 1%）。**没有它，强制下线要等 15 分钟才真生效**，玩家会被踢了又复活。

**重置密码**：后台不生成新密码、不看哈希，复用「忘记密码」流程签发一次性 token（sha256 存库、30 分钟、用后即焚，详见 [账号设计 §1.9](./06-account.md)），链接由客服人工交付玩家。**游客标记异常**：游客没绑邮箱，封了等于逼他清 cookie 重开，所以用标记（`user_flags`：1=疑似作弊 2=脚本挂机 3=多开 4=昵称违规，默认 7 天）。语义写死：**不阻断登录，只阻断排位奖励**（`POST /api/match/queue` 返回 `ACCOUNT_RESTRICTED`，战绩入库但不计 rating）；同一游客累计 3 次 → 后台提示「建议转为封禁」，仍由人决定。

### 4.2 对局查询

筛选：用户（uid）、时间范围、模式（0/1/2）、场地、是否含回放。

```sql
SELECT m.id, m.mode, m.stage_id, m.winner_slot, m.duration_frames, m.played_at, m.ruleset_hash,
       GROUP_CONCAT(CONCAT(mp.slot, ':', u.nickname, ':', mp.char_id) ORDER BY mp.slot) AS players,
       (r.match_id IS NOT NULL) AS has_replay
FROM matches m
JOIN match_players mp ON mp.match_id = m.id JOIN users u ON u.id = mp.user_id
LEFT JOIN replays r ON r.match_id = m.id
WHERE m.played_at >= ? AND m.played_at < ? AND (? IS NULL OR m.mode = ?)
ORDER BY m.id DESC LIMIT ? OFFSET ?;
```

详情三块：**概览**（seed、ruleset_hash、场地、模式、总帧数 ÷60、终局 checksum）、**玩家**（双方 uid / 昵称 / 角色 / rating 变化，可跳用户详情）、**回合**（`match_rounds` 每回合胜者与 `end_frame` + `match_round_survivors` 的存活命数与伤害）。⚠️ `damage` 是**百分比 ×100**（`SmallInt`），展示要除以 100——忘了除会看到「一命 12340%」。

### 4.3 回放审计（核心）

#### 4.3.1 技术前提与三个断点

唯一的作弊证据链：**服务端下发的 seed（双方相同且不可预测）+ 双方上报的输入流 + 当时那份帧数据 → 在 battle-core 里重演 → 终局 checksum 与落库值比对**。

| 断点 | 表现 | 后台处理 |
|---|---|---|
| 帧数据版本不符 | 客户端改判定框/伤害，重演与落库 checksum 不符 | `CHECKSUM_MISMATCH`，**强判据** |
| 内核版本不符 | 三个月前改过物理公式，今天内核跑不了老回放 | 归档内核（§4.3.4），跑不了标 `UNREPRODUCIBLE`，**不冤枉人** |
| 输入被截断 | 崩溃 / 上报失败 | `TRUNCATED`，只看前缀，不构成判据 |

**连接时的 `rulesetHash` 校验不能替代重演**——那只比对双方「声称」的 hash，客户端完全可以上报正确 hash 而实际跑改过的数据。只有重演能把输入跑出终局状态。

#### 4.3.2 审计工作流

```text
举报（结算页按钮 / 客服工单）→ player_reports(status=0)
  → 运营在「举报队列」领取（按 被举报次数 × 对局 rating 总量 排序，非 FIFO）
  → GET /api/admin/replays/:matchId 拉回放
        ├─ 无回放 / 解压失败 → 退回，标「无法审计」
        └─ 正常 → runner 重演（worker，≤5s）
              ├─ OK                → 事件流 + 关键帧 + 统计
              ├─ CHECKSUM_MISMATCH → 已可疑，仍可播放
              └─ UNREPRODUCIBLE    → 只给元数据，禁止定罪
  → 后台内嵌播放器（前端用 battle-core 逐帧跑，Canvas 2D 画色块 + 判定框）
  → 时间轴拖拽 / 判定框开关 / 伤害曲线 / KO 标记 → 人工判定
  → 处置：打标记 → 重复违规 → 封禁（理由 + evidenceMatchId）→ 更新 status
```

防刷：同账号举报 1 小时 ≤ 3 条、同 `matchId` 最多被举报 5 次。

#### 4.3.3 `replay-runner` 输入输出

放在 `packages/server/src/admin/replay-runner.ts`，由 `worker_threads` 加载（`tools/replay-runner.ts` 是同逻辑 CLI，供本地复现工单）。

```ts
export interface ReplayRunInput {
  matchId: string; seed: number;               // seed 由服务端下发，双方相同且不可预测
  rulesetHash: number;                         // 回放使用的帧数据版本
  stageId: number; charIds: [number, number];
  durationFrames: number;                      // 上限 21600 = 6 分钟
  inputs: [Uint8Array, Uint8Array];             // 每人 durationFrames × 2 字节，已解压
  expectedChecksum: number;                    // replays.checksum
  collect: { everyNFrames?: number; events?: boolean };    // 默认 6 帧一个关键帧
}

export type ReplayStatus =
  | 'OK' | 'CHECKSUM_MISMATCH'                 // 重演成功，终局一致 / 不一致
  | 'RULESET_MISSING' | 'CORE_MISSING'         // 版本归档缺失，无法重演
  | 'TRUNCATED' | 'OVERSIZE'                   // 输入不足 / 超限（>21600 帧、>512KB）
  | 'ERROR';                                   // 内核抛异常（记 stack，不对外）

export interface ReplayRunOutput {
  status: ReplayStatus; coreVersion: string;
  rulesetHash: number;                         // 实际加载到的 hash，与入参不同即视为缺失
  finalChecksum: number; expectedChecksum: number; frames: number;
  events: BattleEvent[];      // { frame, type:'hit'|'ko'|'ledge'|'grab'|'respawn', slot, target?, moveId?, damage?, kb? }
  keyframes: Keyframe[];      // { f, p:[{ slot,x,y,state,damage,facing,stocks,active }] }，前端直接喂给 Canvas
  stats: ReplayStats; elapsedMs: number;
  error?: { message: string; stack?: string };
}
interface ReplayStats {       // 检测规则的唯一输入，全部由重演过程顺带算出，不额外跑
  attacks: [number, number];        // 进入 Attack* 状态的次数
  hitsLanded: [number, number];     // 命中对手次数
  reactionFrames: number[];         // 对方出招首帧 → 本方防御/闪避首帧的间隔
  inputChangeRate: [number, number];// 每帧输入位变化均值
  windowRepeat: [number, number];   // 8 帧输入窗口重复率 0..1
}
```

CLI：`node dist/tools/replay-runner.js --match 10231 --out tmp.json --frames 600,720,900`。

**有界执行**（没有这层，一条坏回放能打死 Node）：`maxFrames=21600`、`maxInputBytes=512KB`、`timeoutMs=5000`、**全局并发 1**、排队 >10 直接 429。跑在 `worker_threads`，超时 `terminate()`。**不要在主线程跑**：21600 帧 × 0.3ms ≈ 6.5 秒同步阻塞，期间所有 WS 心跳超时。

#### 4.3.4 帧数据与内核版本归档

回放能重演的前提是「当时那份帧数据 + 当时那个内核」，两者都得归档，否则三个月后所有老回放都不可审计。

```prisma
model RulesetVersion {
  rulesetHash Int      @id @map("ruleset_hash") @db.UnsignedInt
  version     String   @db.VarChar(32)                        // 2026.10.23-a
  coreVersion String   @map("core_version") @db.VarChar(32)   // 0.4.2
  bundle      Bytes    @db.LongBlob                           // gzip: chars/*.json + stages + constants
  createdAt   DateTime @default(now()) @map("created_at") @db.DateTime(3)
  @@map("ruleset_versions")
}
```

帧数据（几百 KB gzip）直接进 MySQL，与回放同库风险最低；**内核不进库**——`battle-core-{ver}.tgz` 落 `var/cores/`，DB 只存版本号，runner 用 `createRequire` 加载。`rulesetHash` 对规范化后的 JSON 做 FNV-1a（与 `checksum` 同算法），构建期算、CI 落库——**改一个字节 hash 就变**。找不到版本必须明确：`RULESET_MISSING` / `CORE_MISSING` → 展示「该对局使用 2026.09.14-a，归档缺失，无法重演」，并**禁止给出「确认作弊」判定**，防止「工具跑不起来就判人有罪」。

#### 4.3.5 启发式检测规则

三条规则全基于 runner 算好的 `ReplayStats`，离线批跑，只产出**可疑分**，不产出处置。

```ts
// R1 命中率异常：人类高手 55%–70%（含空挥、被盾、被闪）；≥85% 且出招 ≥60 次几乎无人能稳定做到
function r1(s: ReplayStats): Flag | null {
  for (const i of [0, 1] as const) {
    if (s.attacks[i] < 60) continue;                                   // 样本不足跳过
    const acc = s.hitsLanded[i] / s.attacks[i];
    if (acc >= 0.85) return { rule: 'HIGH_ACCURACY', slot: i, score: Math.min(1, (acc - 0.7) / 0.3) };
  }
  return null;
}

// R2 机械重复：连招会重复，但整局 8 帧窗口重复率人类通常 <20%，>45% 基本是宏/脚本
function r2(s: ReplayStats): Flag | null {
  for (const i of [0, 1] as const) {
    if (s.windowRepeat[i] >= 0.45) return { rule: 'INPUT_REPETITION', slot: i, score: s.windowRepeat[i] };
    if (s.inputChangeRate[i] < 0.05) return { rule: 'IDLE_INPUT', slot: i, score: 0.6 };   // 挂机
  }
  return null;
}

// R3 读帧防御：人类反应 12–20 帧（200–330ms）且方差大；机器特征是「快且稳」（<100ms、波动 <25ms）
function r3(s: ReplayStats): Flag | null {
  const r = s.reactionFrames;
  if (r.length < 20) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
  if (mean < 6 && sd < 1.5) return { rule: 'INHUMAN_REACTION', slot: -1, score: Math.min(1, (6 - mean) / 4) };
  return null;
}
```

批跑：每天 02:00 跑过去 24h 的 ranked（< 2000 局，单核约 20 分钟），命中即写 `cheat_flags(match_id, flags, score)`。阈值必须上线后用真实数据校准，**任何规则都不自动封号**——它的作用是把 2000 局缩到 20 局。

#### 4.3.6 判定与处置

| 判定 | 触发 | 处置 |
|---|---|---|
| **无异常** | checksum 一致且人工看无异常 | 关单，留判定理由供复查 |
| **疑似** | checksum 一致但规则命中，或行为别扭 | 打 `UserFlag(1)` 7 天，不提示玩家 |
| **确认作弊** | `CHECKSUM_MISMATCH` 且版本齐全；或人工逐帧确认（无限连、无敌帧滥用、瞬移） | 重复违规累计 → 封禁，`evidence_match_id` 必填 |

`CHECKSUM_MISMATCH` 的解读要写进界面：**单方不一致、另一方一致 → 高度可疑**；双方都不一致 → 先怀疑 desync 或内核 bug；历史对局在版本升级后重跑仍不一致 → 大概率是代码 bug，走 [确定性专题](./05-server.md)，**不是作弊**。

### 4.4 数据统计

**v1 直查 SQL，不做预聚合表**，唯一例外是 DAU：直查 `user_sessions` 会随数据增长变慢，且「一次 refresh = 一行新会话」，跨天会话会漏算。`stat_daily` 表 8 个字段（day / dau / newUsers / newGuests / matches / rankedMatches / avgDurationSec / peakOnline），每天 03:00 一条 `INSERT ... SELECT`。

```sql
-- ① 近 14 天对局数 / 平均时长 / 排位占比（matches 只含联机，不含 AI 局）
SELECT DATE(played_at) d, COUNT(*) matches, ROUND(AVG(duration_frames) / 60, 1) avg_seconds, SUM(mode = 1) ranked
FROM matches WHERE played_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY GROUP BY d ORDER BY d DESC;

-- ② 新增（区分游客 / 注册）
SELECT DATE(created_at) d, SUM(is_guest = 1) guests, SUM(is_guest = 0) registered
FROM users WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY GROUP BY d ORDER BY d DESC;

-- ③ D1 留存（只统计注册用户，用「次日仍有新会话」作为活动信号）
SELECT DATE(u.created_at) cohort, COUNT(*) size,
       SUM(EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id = u.id
                   AND s.created_at >= DATE_ADD(DATE(u.created_at), INTERVAL 1 DAY)
                   AND s.created_at <  DATE_ADD(DATE(u.created_at), INTERVAL 2 DAY))) d1
FROM users u WHERE u.is_guest = 0 AND u.created_at >= UTC_DATE() - INTERVAL 7 DAY AND u.created_at < UTC_DATE()
GROUP BY cohort ORDER BY cohort;

-- ④ DAU 兜底口径（跨天未刷新会话不计）：正常读 stat_daily.dau，下列 SQL 仅用于回填
SELECT DATE(created_at) d, COUNT(DISTINCT user_id) dau
FROM user_sessions WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY GROUP BY d ORDER BY d DESC;
```

口径必须写进页面 tooltip，否则每个运营会得出不同结论：对局数**不含 AI 局**；平均时长 = `duration_frames / 60`；留存用 `user_sessions.created_at` 作活动信号，误差来自「只登录不刷新」的人，v2 换埋点。

### 4.5 公告 / 配置

用 `k/v` 表（`app_configs(k VarChar(64) PK, v Json, updatedBy, updatedAt)`），而不是每加一个开关就加一列：

| key | 语义 |
|---|---|
| `feature.ranked` | 关闭后 `/api/match/queue` 返回 `RANKED_CLOSED`，大厅按钮置灰 |
| `feature.register` | 关闭后只允许游客登录（刷号攻击期用） |
| `maintenance` | 开启后除 `/api/auth/me`、`/api/config` 外全部 503 |
| `announcement` | `{ id, title, body, level, startsAt, endsAt }`，大厅顶部条幅，纯文本 |

读取走 Redis（TTL 30s）+ 写后 `DEL`，**生效延迟 ≤ 30 秒**。维护模式要克制：**只拦写接口和新连接**，不打断已在对局的玩家（P2P 已连上，服务端也断不了，硬拦只会让结算落库失败丢战绩）。

### 4.6 日志查询

v1 **不引入 ELK / Loki**：单机峰值 200 QPS、日均几万条，`pino` 写 NDJSON + 按天轮转 + 保留 7 天，检索就是流式 grep（只读白名单目录、禁止路径参数、单次限流 10 次/分钟、3s 超时、从新到旧命中即收）。慢查询不开表（写表加剧 IO），直接读 `performance_schema`：

```sql
SELECT DIGEST_TEXT, COUNT_STAR calls, ROUND(SUM_TIMER_WAIT / 1e12, 2) total_sec,
       ROUND(AVG_TIMER_WAIT / 1e9, 1) avg_ms, SUM_ROWS_EXAMINED rows_examined
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC LIMIT 20;
```

只读展示这 20 条，**不给「一键加索引」按钮**——没有比这更危险的功能。

---

## 5. 数据脱敏与隐私

### 5.1 可见性矩阵

| 字段 | 默认展示 | 谁能解锁 | 说明 |
|---|---|---|---|
| `password_hash` | **永不展示，API 不返回** | 无人 | 拿到哈希就能离线爆破弱密码 |
| `email` | `a***@example.com` | SUPER_ADMIN（限时） | 判断「是否同一人换邮箱」，打码够用 |
| `ip` | `1.2.*.*` / `2408:****` | SUPER_ADMIN（限时） | 打码到 /16，够判断地区，不足以定位到人 |
| `user_agent` | 原样 | — | 不含 PII，排查多端必需 |
| `refresh_token_hash` | 原样（sha256） | — | 不是凭证只是索引，便于判断会话是否被盗 |
| 对局输入流 | 仅后台内部重演 | 无人 | v1 不提供回放文件下载/导出 |
| 玩家私聊 | **v1 无此功能** | — | 没有聊天系统；v2 若加语音/文字，须单独设计留存与举报 |

### 5.2 API 层脱敏，不是前端隐藏

**硬规则：任何返回给浏览器的 JSON 都不能出现未脱敏 PII。** 前端隐藏字段等于把数据发给了浏览器，开 DevTools 就能看，审计上等同于泄露。

```ts
const maskEmail = (e?: string | null) => (e ? e.replace(/^(.)[^@]*@/, '$1***@') : null);
const maskIp = (ip?: string | null) => {
  if (!ip) return null;
  if (ip.includes(':')) return ip.split(':').slice(0, 2).join(':') + ':****';
  const [a, b] = ip.split('.'); return `${a}.${b}.*.*`;
};

export function toAdminUser(u: User, v: { role: AdminRole; privilegedUntil: number }) {
  const reveal = v.role === 'SUPER_ADMIN' && Date.now() < v.privilegedUntil;
  return { uid: u.uid, nickname: u.nickname, isGuest: u.isGuest,
           email: reveal ? u.email : maskEmail(u.email),
           rating: u.rating, ratingDev: u.ratingDev, wins: u.wins, losses: u.losses,
           createdAt: u.createdAt, lastLoginAt: u.lastLoginAt };   // passwordHash 字段根本不存在
}
```

**为什么用 `privilegedUntil` 限时解锁而不是「超管永远看明文」**：超管账号是最高价值目标，永久明文意味着它一被盗就全站邮箱泄露。解锁走独立接口 `POST /api/admin/users/:uid/reveal { field, reason }`，二次确认 + 审计，有效期 **10 分钟**后自动回到打码视图；每个超管 **20 次/天**，超限需人工申请——这条限流比什么都管用。

### 5.3 几条不写下来就会忘的约定

- 不提供「按邮箱后缀搜索」（`LIKE '%@qq.com'` 是社工第一步）；不提供 CSV 导出。
- 截图/录屏时 uid、邮箱默认保持打码，只有点了「解锁」才明文——演示不会误露。
- 所有写操作都要求 `reason`：脱敏只能保护「看」，`reason` 才能约束「改」。

---

## 6. API 契约

### 6.1 鉴权：独立的管理员 JWT

**结论：独立签发，`aud: "admin"`，独立 secret（`ADMIN_JWT_SECRET`），独立 Cookie 路径。** 复用玩家 JWT + `role` claim 不行：同一签名域，玩家系统任何签名/校验 bug 都直接变后台越权，且 `sub` 是 `users.id`，与 `admin_users.id` 撞号。独立 token 让 `aud` 不符直接失败（物理隔离），secret 可独立轮换，过期时间可独立调短：access `30m`（比玩家 15m 长，但 Redis 会话 1 小时闲置即失效）、refresh `8h`（只覆盖一个工作日）、`Path=/api/admin/auth`、`SameSite=Strict`。**2FA 是签发 token 的前置条件**：`login` 只返回 `{ needTotp: true, challenge }`，`totp` 校验通过才发 token；两步之间用 Redis 存 `admin:challenge:{id}`（5 分钟），**不存在「只凭密码拿到 token」的路径**。

### 6.2 通用规范

- **前缀**：`/api/admin/*`，独立 Fastify 插件（`fastify.register(adminPlugin, { prefix: '/api/admin' })`），插件内独立 `onRequest`、独立限流桶、独立错误处理。
- **信封**：`{ ok: true, data, meta?: { page, pageSize, total } }` / `{ ok: false, error: { code, message, requestId } }`，与 [账号设计 §1.10](./06-account.md) 一致。
- **分页**：`page`（从 1）+ `pageSize`（≤100，默认 20）。`page * pageSize > 10000` 返回 `PAGINATION_TOO_DEEP`，要求加筛选——防止翻到第 500 页扫库。
- **写操作**：校验 `Origin`；同 `reason` 60 秒内不产生第二条封禁（幂等）；响应带 `requestId`（= 日志 `reqId`，工单贴它即可定位）。

| code | HTTP | 含义 |
|---|---|---|
| `ADMIN_UNAUTHORIZED` | 401 | 无 token / 验签失败 / `aud` 不是 admin |
| `ADMIN_2FA_REQUIRED` | 401 | 未完成 TOTP |
| `ADMIN_SESSION_EXPIRED` | 401 | Redis 会话过期或已被踢 |
| `ADMIN_FORBIDDEN` | 403 | 角色不足 |
| `ADMIN_IP_NOT_ALLOWED` | 403 | 不在白名单（Nginx 通常已挡，双保险） |
| `ADMIN_RATE_LIMITED` / `RUNNER_BUSY` | 429 | 后台限流 / runner 排队 >10 |
| `ADMIN_REASON_REQUIRED` / `ADMIN_CONFIRM_MISMATCH` | 400 | 缺理由（<10 字）/ 二次确认 uid 不匹配 |
| `PAGINATION_TOO_DEEP` | 400 | 见上 |
| `RESOURCE_NOT_FOUND` / `REPLAY_NOT_FOUND` | 404 | 用户 / 对局 / 回放不存在 |
| `REPLAY_UNREPRODUCIBLE` / `RULESET_MISSING` | 409 | 版本缺失或截断，不可重演 |

### 6.3 接口清单

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | `/api/admin/auth/login` · `/totp` | 密码登录 → TOTP challenge；校验后发 token | 公开（3 次/10 分钟） |
| POST | `/api/admin/auth/refresh` · `/logout` | 刷新 / 登出 | cookie / 已登录 |
| GET | `/api/admin/auth/me` | 当前管理员 + 角色 | 已登录 |
| GET | `/api/admin/users` · `/users/:uid` | 搜索 / 详情 | VIEWER+ |
| POST | `/api/admin/users/:uid/ban` · `/unban` | 封禁 / 解封 | OPERATOR+ |
| POST | `/api/admin/users/:uid/force-logout` | 吊销全部会话 + 踢线 | SUPPORT+ |
| GET·DELETE | `/api/admin/users/:uid/sessions` | 会话列表 / 吊销单个 | SUPPORT+ / AUDITOR |
| POST | `/api/admin/users/:uid/reset-password` · `/flags` | 触发重置 / 打标记 | SUPPORT+ |
| POST | `/api/admin/users/:uid/reveal` | 明文解锁邮箱 / IP | SUPER_ADMIN |
| GET | `/api/admin/matches` · `/matches/:id` | 对局列表 / 详情 | VIEWER+ |
| GET·POST | `/api/admin/reports` · `/reports/:id/claim` | 举报队列 / 领取 | SUPPORT+ / AUDITOR |
| GET | `/api/admin/replays/:matchId` | 回放元数据 + 输入流（base64） | VIEWER+ |
| POST | `/api/admin/replays/:matchId/run` · `/judgement` | 服务端重演 / 提交判定 | AUDITOR+ / OPERATOR+ |
| GET | `/api/admin/stats/daily` · `/stats/query` | 每日快照 / 预置 SQL 模板 | VIEWER+ |
| GET·PUT | `/api/admin/config` · `/config/:k` | 读 / 改配置 | VIEWER+ / OPERATOR+（maintenance 仅超管） |
| GET | `/api/admin/logs/errors` · `/logs/slow-queries` | 错误日志 / 慢查询 TOP 20 | SUPER_ADMIN / AUDITOR / VIEWER |
| GET | `/api/admin/audit-logs` | 操作审计 | SUPER_ADMIN / OPERATOR / AUDITOR |
| GET·POST | `/api/admin/admins` | 管理员列表 / 新建（含 TOTP 绑定） | SUPER_ADMIN |

> **没有** `/api/admin/sql`、`/db/query`、`/export`。理由见 §7.3、§5.1。

### 6.4 关键接口示例

```ts
// ① 登录（两步）
POST /api/admin/auth/login   { username: "ops_lin", password: "…" }
200 { ok: true, data: { needTotp: true, challenge: "c_9f1e…", expiresIn: 300 } }

POST /api/admin/auth/totp    { challenge: "c_9f1e…", code: "492813" }
200 Set-Cookie: admin_rt=…; HttpOnly; Secure; SameSite=Strict; Path=/api/admin/auth
    { ok: true, data: { accessToken: "eyJ…", expiresIn: 1800,
                        admin: { id: "3", name: "ops_lin", role: "OPERATOR" } } }

// ② 封禁（危险操作，二次确认 + 理由）
POST /api/admin/users/u_7f3a9c21/ban
{ duration: "7d", reason: "回放审计确认帧数据被修改，判定框异常扩大",
  evidenceMatchId: "10231", confirmUid: "u_7f3a9c21" }   // 与路径不符 → ADMIN_CONFIRM_MISMATCH
200 { ok: true, data: { banId: "88", revokedSessions: 2, wsClosed: 1,
                        expiresAt: "2026-10-30T07:44:12.000Z" } }
400 { ok: false, error: { code: "ADMIN_REASON_REQUIRED", message: "理由至少 10 个字", requestId: "01J…" } }

// ③ 回放重演
POST /api/admin/replays/10231/run   { everyNFrames: 6, collectEvents: true }
200 { ok: true, data: {
      status: "CHECKSUM_MISMATCH", coreVersion: "0.4.2", rulesetHash: 3319208411,
      finalChecksum: 2718493210, expectedChecksum: 1083774122, frames: 6480, elapsedMs: 812,
      stats: { attacks: [142, 96], hitsLanded: [127, 21], windowRepeat: [0.12, 0.31] },
      eventsPreview: [{ frame: 1834, type: "hit", slot: 0, target: 1, damage: 22, kb: 148 }],
      keyframeCount: 1080 } }
```

> 列表响应形如 `{ uid, nickname, isGuest, email: "k***@example.com", rating, ratingDev, wins, losses, createdAt, lastLoginAt, ban, flags, activeSessions }` + `meta`。重演失败时仍是 `ok: true` 但 `status` ≠ `OK`——**不用 HTTP 错误码表达审计结论**，`UNREPRODUCIBLE` 这种「业务正常、结论不确定」的状态用 409 会让前端到处写特判。

---

## 7. 安全加固

### 7.1 威胁模型与网络层

| 攻击者 | 手段 | 主防线 |
|---|---|---|
| 公网扫描器 | 扫 `/admin`、`/api/admin`、爆破登录 | 独立子域 + IP 白名单（Nginx 直接 403） |
| 拿到弱密码的外部人 | 撞库、密码喷洒 | 强制 TOTP + 3 次/10 分钟 + 独立账号体系 |
| 被盗的管理员会话 | 钓鱼、Cookie 窃取 | `SameSite=Strict` + 1 小时闲置过期 + 审计 |
| 有账号的内部人 | 越权、批量捞数据 | RBAC + 接口限流 + 全量审计 + 解锁限次 |
| 玩家端 XSS 的连带 | 同源脚本打后台接口 | 独立子域（跨源，Cookie 不共享） |

```nginx
server {
  server_name admin.example.com;
  allow 203.0.113.0/28;   # 公司出口 IP
  allow 198.51.100.7;     # 固定家宽
  deny  all;              # v1 后台只对 3 个人开放，命中率 100%
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Frame-Options DENY always;
  location / { root /srv/admin; try_files $uri /index.html; }
  location /api/admin/ { proxy_pass http://127.0.0.1:3000; }
}
```

**不要**为了「出差能登」开全网——出差走 VPN。应用层再按 `ADMIN_IP_ALLOWLIST` 校验一次，防止绕过 Nginx 直连 3000（部署时 3000 只监听 `127.0.0.1`）。

### 7.2 认证层

| 措施 | 参数 | 理由 |
|---|---|---|
| 强制 TOTP | `otplib`，30s 步长，±1 窗口；绑定二维码**只展示一次** | 后台唯一「泄露密码也进不来」的手段 |
| 登录限流 | **3 次 / 10 分钟**（`rl:admin:{username}:{ip}`，与玩家端 `rl:*` 隔离） | 比玩家端（5 次/分钟）严得多：后台只有 3 个人，没有「大量正常用户」 |
| 会话时长 | access 30min，Redis 会话 **1 小时无操作过期** | 「开个会回来还在」与「电脑忘锁不至于挂一天」的折中 |
| 密码 | 用户名 + ≥12 位，argon2id（复用 `security/argon2.ts`） | 不做 3 个月强制更换（只会得到 `Qwer1234!` 循环），泄露时强制重置 |
| 失败锁定 | 连续 10 次 → 锁 30 分钟 + 通知超管 | 防慢速爆破 |
| 恢复码 | 每人 8 个一次性码，argon2 存库 | 手机丢了不能把人锁在外面 |

### 7.3 禁止在后台页面内直接执行任意 SQL

**为什么会有这个诱惑**：运营问「这个用户昨天为什么掉分」，最直觉的解法就是给个 SQL 输入框——三秒出结果，比让开发写接口快一百倍，几乎每个后台都被提过这个需求。

**为什么必须禁止**（每条都足以否掉它）：① **它就是 SQL 注入的正式版本**，参数化查询的防线被自己拆掉，任何前端 XSS 都能直接读全库；② **绕过脱敏**，脱敏在序列化层，SQL 直出会跳过它，`SELECT email, ip FROM users` 一行拿到全站 PII；③ **绕过审计**，审计记的是 `action + target`，一条 `SELECT` 无法归因，误 `UPDATE` 连 before 值都没留；④ **绕过权限**，SQL 没有角色概念，SUPPORT 与 SUPER_ADMIN 看到同一张库，RBAC 失效。

**替代方案**：预置**模板查询**，SQL 写在代码里、参数化、只读账号、白名单字段，v1 只做 6 个真被问过的模板：

```ts
const TEMPLATES = {
  user_daily_matches: {
    sql: `SELECT DATE(m.played_at) d, COUNT(*) n FROM match_players mp
          JOIN matches m ON m.id = mp.match_id
          WHERE mp.user_id = ? AND m.played_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
          GROUP BY d ORDER BY d`,
    params: (q: Query) => [BigInt(q.uid), clamp(q.days, 1, 30)],
  },
} as const;
```

再上一道保险：**应用连接池用只读账号**（`GRANT SELECT`），`UPDATE` / `DELETE` 只能走写接口——即使将来出现注入点，也只能读到脱敏后的数据。

### 7.4 CSRF / XSS / 二次确认

| 风险 | 措施 |
|---|---|
| CSRF | admin cookie `SameSite=Strict` + `Path=/api/admin/auth`（只有刷新接口带 cookie，业务接口用 `Authorization: Bearer`）；写接口校验 `Origin === https://admin.example.com`；**拒绝 `Content-Type: text/plain` 的写请求**（简单请求绕过预检的老路） |
| XSS | 不用 `v-html`；公告纯文本渲染；CSP `default-src 'self'; script-src 'self'`；`X-Content-Type-Options: nosniff` |
| 点击劫持 | `X-Frame-Options: DENY` |
| PII 进 URL | 敏感参数走 body（URL 会进日志）；pino `redact` 抹掉 `email` / `ip` |
| 依赖投毒 | admin 锁死版本，CI 只允许 `pnpm install --frozen-lockfile` |

危险操作二次确认三档：**强制下线 / 重置密码 / 打标记** → `n-popconfirm`；**封禁 / 解封 / 关闭排位** → 弹窗 + **输入目标 uid** 才能点确定（`ConfirmByUid`，不一致按钮禁用）；**永久封禁 / 开维护模式 / 新建管理员** → 上一档 + 理由 ≥ 20 字 + 结果页展示审计编号。输入 uid 而不是 `yes`，是因为 uid 必须从页面上抄——这把误操作从「手滑」变成「看错」，概率低一个数量级。

### 7.5 上线前检查清单

```text
[ ] admin.example.com 只对白名单 IP 返回 200，其余 403；/api/admin/* 也在 Nginx 层限制
[ ] 无 token → 401；SUPPORT 调封禁接口 → 403；玩家 token 调 /api/admin/users → 401（aud 生效）
[ ] 用户详情响应 grep 不到 password_hash；非超管 grep 不到完整邮箱 / 完整 IP
[ ] 执行一次封禁 + 一次解封，admin_audit_logs 有两条且 reason 完整
[ ] 封禁后 1 分钟内：WS 断开、无法进排位、access token 失效
[ ] 登录连错 3 次 → 第 4 次 429；1 小时不操作 → 任意接口 401
[ ] 应用账号对 admin_audit_logs 无 UPDATE / DELETE 权限
```

---

## 8. 部署与工期

### 8.1 拓扑：同一 Node 服务，独立前缀 + 独立子域

**结论：静态资源独立部署在 `admin.example.com`，API 挂在同一个 Node 服务的 `/api/admin` 前缀下，不拆独立服务。**

```text
admin.example.com            example.com
      │                           │
   Nginx(白名单)               Nginx
      │ /api/admin/*               │ /api/*  /ws
      └──────────┬────────────────┘
                 ▼
        Node 服务（同一进程）: /api/* 玩家端 | /api/admin/* 后台 | /ws 信令
                 │
           MySQL 8 / Redis 7
```

**为什么不拆**：拆分要多一套 Dockerfile、健康检查、配置、部署，约 0.5 天，而 v1 后台一天只有几十个请求；同进程还能直接复用 Prisma client、`isBanned()`、`issuePasswordReset()`，不用抽 service 包。**但必须做三件「防拖累」的事**：① **独立连接池**（后台 `?connection_limit=3`，玩家端 10；MySQL 默认 `max_connections=151` 够用）；② **独立限流桶**（`rl:admin:*` 与 `rl:*` 隔开）；③ **重活进 worker**（runner 并发 1、5s 强杀，绝不占事件循环）。v2 再拆独立服务，触发条件写死：**后台 QPS > 20 或 runner 日均 > 500 次**。

### 8.2 部署清单

```text
1. admin.example.com → 同机 A 记录（套 CDN 时 CDN 必须支持 IP 白名单）+ 独立证书 + 独立 server 块
2. 静态产物 pnpm --filter @fg/admin build → /srv/admin/（~200KB gzip）
3. 新增环境变量 4 个：ADMIN_JWT_SECRET（与 JWT_SECRET 不同，32 字节随机）、ADMIN_IP_ALLOWLIST、
   ADMIN_TOTP_ISSUER、ADMIN_BOOTSTRAP=1（首次建超管，建完置 0）
4. 迁移新增 9 张表（admin_users / admin_audit_logs / user_bans / user_flags / player_reports /
   cheat_flags / ruleset_versions / app_configs / stat_daily）；全是 CREATE TABLE，不改已有表
   → 回滚只需 DROP，风险可控
5. 定时任务 3 个（同进程 setInterval + Redis 锁）：
   02:00 cheat 批跑   03:00 stat_daily 快照   04:00 清理过期 ban / 90 天前 flag / 180 天前审计
```

### 8.3 工期拆分：v1 3.5 天

| # | 子任务 | 产出 | 天 | 落点 |
|---|---|---|---|---|
| 1 | 9 张表 + Prisma 迁移 + `admin_users` 种子 | 库就绪 | 0.3 | M7 |
| 2 | `requireAdmin` / `allow()` + TOTP + 限流 + IP 双校验 | 认证层 | 0.4 | M7→M9 |
| 3 | 登录页 + 布局 + 路由守卫 + 请求封装 | 能登进去 | 0.4 | M9 |
| 4 | 用户搜索 / 详情 / 封禁 / 强制下线 / 标记 | 用户管理 | 0.5 | M9 |
| 5 | 对局列表 / 详情（回合明细 + 伤害 ÷100） | 对局查询 | 0.4 | M9 |
| 6 | `replay-runner`（worker + 版本归档 + 限额） | 重演能力 | 0.4 | M9 |
| 7 | 审计页（Canvas 播放器 + 时间轴 + 判定表单） | **核心交付** | 0.6 | M9 |
| 8 | 统计页（4 条 SQL + stat_daily）+ 公告 / 开关 | 运营工具 | 0.3 | M9 |
| 9 | 部署（子域 / 白名单 / 检查清单逐项过） | 上线 | 0.2 | M9 |
| | **合计** | | **3.5** | |

砍掉的边界（再压就兜不住）：不画图表（省 0.2）；举报工单只做「领取 / 关闭」两态（省 0.3）；播放器只画色块 + 判定框、复用快照不接美术（省 0.5）。v2 估算（不进 40 天）：IP 级封禁 0.5、CSV 导出 0.5、图表看板 1、操作回滚 1.5、拆独立服务 0.5。

### 8.4 怎么塞进 40 天

40 天里**没有 3.5 天空档**，诚实的做法是从别处换，而不是假装加班能补上。

| 从哪挪 | 让出 | 影响 |
|---|---|---|
| M9 排行榜 | 0.5 | 挪 v2（本来也需要更多对局数据才有意义） |
| M9 结算页动画 + UI 精修 | 1.0 | 只做数字滚动 + 胜负大字，只修 P0（按钮错位、文字溢出） |
| M4 粒子 / 视差特效 | 1.0 | 用 3 个 sprite 特效代替粒子系统，视差只做 2 层 |
| M5 第二角色招式 | 1.0 | 60-80 招收收到 45 招（先保证 1 个角色手感完整） |
| **合计** | **3.5** | 后台这 3.5 天从别处换出，总工期不变 |

排期落点：#1 与 #2 的 0.7 天放进 **M7**——此时正在写 `user_sessions` 和 `requireAuth`，顺手加审计表与吊销接口，边际成本最低；#3~#9 的 2.8 天放进 **M9 后段**，紧跟账号系统回归测试之后（后台依赖的封禁 / 下线 / 重置接口这时才稳定）。M9 因此从 4 天变 **5.3 天**（4 + 2.8 后台 − 1.5 让出）；再叠加 M4 / M5 让出的 2 天，后台的 3.5 天全额换出。**当前总账 40 天**（v0.3.0 起，含自研部件骨骼 3 天）。


**M9 验收标准**（不能只看「做完了」）：拿一条真实举报走完整链路——举报 → 领取 → 拉回放 → 重演 → 播放 → 判定 → 封禁 → 玩家被踢下线 → 审计日志可查。走通一次，后台即算交付。

## 9. 实现现状（v0.8.0）

本章记录代码与上文设计的偏差。**后台主体已经跑起来并通过 22 条接口断言**，但回放审计整条链还没接（它依赖 `battle-core` 的重演器，而重演器随联机一起做）。

### 9.1 已经跑起来的部分

| 交付项 | 状态 | 位置 |
|---|---|---|
| 密码登录 | ✅ | `packages/admin/src/views/LoginView.vue` |
| RBAC 三角色 + 服务端校验 | ✅ | `packages/server/src/http/middleware/requireAdmin.ts` |
| 操作审计日志 | ✅ | 表 `admin_audit_logs` + `services/admin.ts` 的 `audit()` |
| 用户搜索 + 详情 | ✅ | `GET /api/admin/users`、`/users/:uid` |
| 封禁 / 解封 | ✅ | `POST /users/:uid/ban`、`/unban` |
| 强制下线 | ✅ | `POST /users/:uid/revoke-sessions`（吊销全部 + `kickUser`） |
| 改昵称 / 改角色 | ✅ | `POST /users/:uid/nickname`、`/role` |
| 对局列表 | ⚠️ 接口完成，但表是空的 | `GET /api/admin/matches` |
| 回放审计 | ❌ 未做 | 需 `battle-core` 重演器 |
| TOTP 2FA | ❌ 未做 | 后台目前只有密码 |
| 公告 / 开关 / 维护模式 | ❌ 未做 | — |

### 9.2 权限模型落地时的两处修正

**① 角色不放进 JWT。** 每次请求查一次 `users.role`。理由：撤销一个 GM 的权限如果等他手上的 access 过期，最长有 15 分钟的**权限真空**；多一次主键查询（走索引，微秒级）换掉这个真空是划算的。

**② 只防"自己"，不防"同级"。** 第一版写成 `targetRole >= actorRole` 就拒绝，结果管理员无法处理任何一个同级账号——两个管理员互为镜像时谁都动不了谁，只能去服务器改库。真正的红线是"不能把自己锁死"：

```ts
export function assertCanActOn(actorUid: bigint, actorRole: number, targetUid: bigint, targetRole: number): void {
  if (actorUid === targetUid) throw err.badRequest('CANNOT_ACT_ON_SELF', '不能对自己执行这个操作')
  if (targetRole > actorRole) throw err.forbidden('CANNOT_ACT_ON_PEER', '不能操作权限更高的账号')
}
```

> 这条规则是**被自己踩出来的**：冒烟测试第一轮管理员把自己封了，之后整轮 401。修完再测才过。

### 9.3 一个必须留在命令行上的入口

第一个管理员不能从后台产生（鸡生蛋），所以留了 `packages/server/src/scripts/set-role.ts`：

```powershell
pnpm admin:grant 8 2     # 0 玩家 / 1 审核员 / 2 管理员
```

需要服务器权限才能执行——这正是它该有的门槛。后台 UI 里刻意不提供"把自己升成管理员"的按钮。

### 9.4 实现时补的两条硬约定

- **先审计再执行。** 封禁接口的顺序是 `audit()` → `update()` → `kickUser()`。审计写不进去，这次封禁就不该发生——反过来（先封后记）会出现"人被封了但查不到谁封的"。
- **`passwordHash` 永不出库。** 用户查询用显式的 `userSelect` 列字段，不用 `include: true` 之类的宽查询；后台任何接口的响应类型里都没有这个字段。

### 9.5 前端的两处刻意选择

- **`accessToken` 只放内存，不进 localStorage。** 后台是共用电脑概率最高的界面；刷新页面靠 refresh cookie 恢复（`session.ts` 的 `bootstrap()`），代价是刷新多一次请求，收益是 token 不落盘。
- **不用 Pinia。** 后台只有"我是谁"一份全局状态，一个 `reactive` 对象 + 两个函数就够。引入状态库会让"这个值什么时候被谁改的"变得更难追，而后台最需要的正是可追。

### 9.6 冒烟测试

`tools/test-admin.mjs`，22 条断言，覆盖：未登录 401 / 普通玩家 403 / 管理员登录 / 分页与筛选（`filter=guest`、`filter=staff`、`filter=banned`）/ 用户详情含会话与战绩 / 不存在用户 404 / 封禁落库 / 解封 / 不能自封 / 不能撤自己会话 / 审计记录带操作人 / 改昵称 / 非法昵称 400 / 对局列表。

---

> 相关文档：[架构设计总纲](./00-overview.md) · [账号设计](./06-account.md) · [数据库设计](./07-database.md) · [服务端与联机](./05-server.md)

