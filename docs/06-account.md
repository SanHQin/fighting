# 用户账号设计

> 项目：平台格斗游戏（大乱斗式） · 所属：[架构设计总纲](./00-overview.md)
>
> 版本 v0.10.6 ｜ 2026-10-24 ｜ 系列：1 总纲 + 8 专题

本文件描述从「打开网页」到「打完一局」这条路上的身份问题：谁在玩、怎么证明是他、凭证过期怎么办、联机时怎么带着身份上 WebSocket。

---

## 1. 账号系统（注册 / 登录 / 会话）

> 本章回答三个问题：**谁能玩**（身份模型）、**怎么证明是他**（凭证）、**凭证过期了怎么办**（会话生命周期）。

### 1.1 身份模型：游客优先

格斗游戏的第一印象是"能不能马上打一局"。强制注册会把大部分人挡在门外。

| 身份 | 获得方式 | 能做什么 | 限制 |
|---|---|---|---|
| **游客** `is_guest=1` | 打开网页自动创建 | 单人打 AI、本地双人、人机房 | 不能排位；战绩只留最近 20 局；昵称带 `#1234` 后缀 |
| **注册用户** `is_guest=0` | 邮箱 + 密码注册 | 全部功能 | — |
| （v2）第三方 | Steam / Discord / Google OAuth | 同上 | — |

**游客怎么实现**：首次进入时 `POST /api/auth/guest`，服务端建一条 `users` 记录（`is_guest=1`、`password_hash=null`），返回 access token，前端存 localStorage。游客想保留战绩 → 走 1.7 的**原地升级**，不换 `user_id`。

**清理**：定时任务删除 30 天未登录且 `is_guest=1` 的账号。

### 1.2 注册规则

| 字段 | 规则 |
|---|---|
| 邮箱 | RFC 5322 宽松校验；唯一；**小写归一化后存储** |
| 昵称 | 2-16 字符，允许中英文数字下划线；**大小写敏感唯一**（`utf8mb4_0900_as_cs`）；敏感词过滤 |
| 密码 | 8-64 字符；**不强制特殊字符**；拒绝 Top-10000 弱密码表 |

> **为什么密码不强制大小写数字符号**：强制复杂规则会让人选 `Password1!` 这种高度可预测的密码。NIST SP 800-63B 的建议是**长度优先 + 弱密码黑名单**，而不是字符类型门槛。

**关于昵称大小写**：这是 2.2 提到的 MySQL 坑的具体落点。表默认排序规则 `utf8mb4_0900_ai_ci` 下，`Aoi` 和 `aoi` 会被判为重复。所以 `nickname` 列单独声明排序规则：

```sql
ALTER TABLE users MODIFY nickname VARCHAR(32)
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL;
```

Prisma 里没有直接的 collate 语法，用 migration SQL 手写这一行。

**邮箱验证**：v1 可以不做，但 `email_verified_at` 字段要预留。未验证账号的降级限制：不能改密码、不能绑定第三方。

### 1.3 密码哈希：argon2id

```ts
import { hash, verify } from '@node-rs/argon2';

// OWASP 2024 推荐参数
const ARGON2_OPTS = {
  memoryCost: 19456,   // 19 MiB
  timeCost: 2,
  parallelism: 1,
  algorithm: 2,        // Argon2id
};

const passwordHash = await hash(plain, ARGON2_OPTS);
const ok = await verify(passwordHash, plain);
```

| 选择 | 结论 |
|---|---|
| ✅ **argon2id** | 内存硬，抗 GPU / ASIC |
| ✅ `@node-rs/argon2` | Rust 实现，`pnpm i` 不需要本机编译工具链（`argon2` 包需要 node-gyp） |
| ❌ bcrypt | 72 字节截断（长密码被静默截断）；参数难调高 |
| ❌ scrypt | Node 原生有，但参数选择容易出错 |
| ❌ MD5 / SHA256 + salt | 完全不能用 |

**绝对禁止**：`passwordHash` 出现在任何 API 响应、日志、错误堆栈里。Prisma 查询默认 `select` 全字段，返回前要显式挑字段。

### 1.4 会话：双 Token

```
登录成功
   ├─▶ accessToken  (JWT, 15min)  → 响应 body，前端放内存
   └─▶ refreshToken (随机串, 7d)  → Set-Cookie: httpOnly; SameSite=Lax; Path=/api/auth

access 过期 → POST /api/auth/refresh（浏览器自动带 cookie）
   ├─ 成功 → 新 access + 旋转出新 refresh（旧的立即作废）
   └─ 失败 → 401 → 前端跳登录
```

**为什么 access 是 JWT，refresh 不是**：

| | access | refresh |
|---|---|---|
| 形态 | JWT（自包含） | 32 字节随机串 |
| 校验 | 本地验签，**不查库** | 必须查库 |
| 时长 | 15 分钟 | 7 天 |
| 吊销 | 做不到（只能等过期） | 立即生效 |

access 短命 + 无状态，所以"不能吊销"可以接受；refresh 长命，必须能吊销，所以用不透明随机串。

**refresh 放哪**：`httpOnly` Cookie，**不放 localStorage**。这样 XSS 拿不到 refresh（只能拿到 15 分钟有效的 access）。

⚠️ **CSRF**：`SameSite=Lax` 已挡住跨站 POST；再叠加"refresh 只接受 POST + 校验 Origin"。**不要用 cookie 传 access**，两套机制混用最容易写错。

**JWT 载荷**：只放 `sub`（userId）、`iat`、`exp`。**不放昵称、段位、是否是游客**——这些会变，塞进 token 就要求每次变更都重新签发。

### 1.5 Refresh 旋转与重放检测

这是 token 方案最容易做错的地方。

```ts
async function refresh(oldToken: string) {
  const tokenHash = sha256(oldToken);
  const session = await prisma.userSession.findUnique({
    where: { refreshTokenHash: tokenHash },
  });

  // 场景 1：查不到 → 伪造或已被清理
  if (!session) return unauthorized();

  // 场景 2：已吊销却还在用 → 说明 token 被偷了
  if (session.revokedAt) {
    // 该用户所有会话立即作废，强制全局重新登录
    await prisma.userSession.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return unauthorized('SESSION_COMPROMISED');
  }

  if (session.expiresAt < new Date()) return unauthorized();

  // 场景 3：正常 → 旋转
  const next = randomToken();
  await prisma.$transaction([
    prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    }),
    prisma.userSession.create({
      data: {
        userId: session.userId,
        refreshTokenHash: sha256(next),
        expiresAt: addDays(7),
      },
    }),
  ]);

  return { accessToken: signAccess(session.userId), refreshToken: next };
}
```

**旋转的意义**：refresh token 一旦泄露，攻击者用一次后真正的用户再用，就触发"旧 token 被重放"，两边同时下线，用户立刻察觉异常。

⚠️ **多标签页打架**：两个标签页同时刷新会互相踢下线。两种解法：

- **宽限期**（v1 推荐）：旧 token 旋转后 5 秒内仍可用
- `BroadcastChannel`：让一个标签页当"刷新主"，其他页排队等结果

### 1.6 数据库表

```prisma
/// 会话表：高频写入，刻意不声明 relation（不建外键，只建索引）
model UserSession {
  id               BigInt    @id @default(autoincrement()) @db.UnsignedBigInt
  userId           BigInt    @map("user_id") @db.UnsignedBigInt
  refreshTokenHash String    @unique @map("refresh_token_hash") @db.Char(64) // sha256 hex
  userAgent        String?   @map("user_agent") @db.VarChar(255)
  ip               String?   @db.VarChar(45)
  expiresAt        DateTime  @map("expires_at") @db.DateTime(3)
  revokedAt        DateTime? @map("revoked_at") @db.DateTime(3)
  lastUsedAt       DateTime? @map("last_used_at") @db.DateTime(3)
  createdAt        DateTime  @default(now()) @map("created_at") @db.DateTime(3)

  @@index([userId, revokedAt])
  @@index([expiresAt])
  @@map("user_sessions")
}
```

`User` 表追加字段：

```prisma
  isGuest         Boolean   @default(true)  @map("is_guest")
  emailVerifiedAt DateTime? @map("email_verified_at") @db.DateTime(3)
  lastLoginAt     DateTime? @map("last_login_at")     @db.DateTime(3)
```

> **不要存 refresh token 原文**，只存 `sha256`。数据库泄露时攻击者拿不到可用 token。这里用 sha256 而非 argon2 是有意的——refresh 本身是 256 位高熵随机串，不存在"用户选弱密码被爆破"的问题，不需要慢哈希（慢哈希只会让每次刷新多花 30ms）。

**索引说明**：`unique(refresh_token_hash)` 是刷新时的查询入口；`idx(user_id, revoked_at)` 支撑"登出所有设备"；`idx(expires_at)` 给清理任务用。

### 1.7 游客原地升级

```
游客 u_7f3a 打了 40 局
  → POST /api/auth/upgrade { email, password, nickname }
  → 同一条 user 记录：is_guest=0，补 password_hash / email / nickname
  → 战绩零迁移
```

⚠️ **坑**：游客昵称是 `玩家#1234`，升级时要重新校验唯一性。若目标昵称被占，返回 `409 NICKNAME_TAKEN`。

### 1.8 WebSocket 鉴权

浏览器的 `new WebSocket(url)` **不能设置自定义 header**。三个方案：

| 方案 | 做法 | 评价 |
|---|---|---|
| ✅ **首条消息鉴权** | 连上后 3 秒内发 `{type:'auth',token}`，否则断开 | 推荐：token 不进 URL，不进访问日志 |
| ⚠️ Query 参数 | `wss://host/ws?token=xxx` | 简单，但 token 会出现在 Nginx access log |
| ❌ Sec-WebSocket-Protocol | 把 token 塞子协议 | hack，部分代理会改写 |

```ts
const unauthed = new Set<WebSocket>();

wss.on('connection', (ws) => {
  unauthed.add(ws);
  const timer = setTimeout(() => {
    if (unauthed.has(ws)) ws.close(4001, 'auth timeout');
  }, 3000);

  ws.once('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type !== 'auth') return ws.close(4002, 'expected auth');

    let claims: Claims;
    try { claims = verifyAccess(msg.token); }
    catch { return ws.close(4003, 'invalid token'); }

    clearTimeout(timer);
    unauthed.delete(ws);
    bindUser(ws, claims.sub);
  });
});
```

**access 过期怎么办**：长连接可能活过 15 分钟。

- **v1 选这条**：连接时校验一次，之后靠 30s 心跳维持，**token 过期不主动断线**
- v2：服务端在快过期时下发 `{type:'reauth-required'}`，前端刷新后重发

理由：对局中途断线的伤害远大于"过期 token 继续用 10 分钟"。

### 1.9 安全清单

| 威胁 | 对策 |
|---|---|
| 暴力破解 | 同 IP 5 次/分钟；同账号连续失败 5 次后指数退避（1s→2s→4s…，上限 5 分钟） |
| 撞库 | 失败信息统一为「账号或密码错误」，不区分账号是否存在 |
| 邮箱枚举 | 注册时"邮箱已存在"仅在**已验证邮箱**时才提示，否则统一返回成功并异步发验证信 |
| 注册刷号 | 同 IP 3 个/小时；异常流量时可挂 hCaptcha |
| Token 泄露 | refresh 旋转 + 重放检测（1.5）；提供「登出所有设备」 |
| XSS 偷 token | access 存内存，refresh 存 httpOnly cookie |
| CSRF | refresh 只接受 POST + `SameSite=Lax` + 校验 `Origin` |
| 会话固定 | 登录成功后签发**全新** token，不复用旧 session |
| 密码重置 | 一次性 token（sha256 存库，30 分钟有效，用后即焚） |

**登录限流实现**（Redis 固定窗口）：

```ts
const key = `rl:login:${ip}`;
const n = await redis.incr(key);
if (n === 1) await redis.expire(key, 60);
if (n > 5) throw new RateLimitError('TOO_MANY_ATTEMPTS');
```

### 1.10 API 一览

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | `/api/auth/guest` | 创建游客 | 否 |
| POST | `/api/auth/register` | 邮箱注册 | 否 |
| POST | `/api/auth/login` | 登录 | 否 |
| POST | `/api/auth/refresh` | 刷新（读 cookie） | cookie |
| POST | `/api/auth/logout` | 登出当前设备 | access |
| POST | `/api/auth/logout-all` | 登出所有设备 | access |
| GET | `/api/auth/me` | 取当前用户 | access |
| POST | `/api/auth/upgrade` | 游客升级 | access |
| POST | `/api/auth/password` | 改密码（需旧密码） | access |
| POST | `/api/auth/forgot` | 发重置邮件 | 否 |
| POST | `/api/auth/reset` | 用重置 token 改密码 | 否 |

**统一响应**：

```ts
{ ok: true,  data: { user: {...}, accessToken: "..." } }
{ ok: false, error: { code: "INVALID_CREDENTIALS", message: "账号或密码错误" } }
```

`code` 是稳定的机器标识，前端按 `code` 分支，**不解析 `message`**（`message` 要国际化）。

### 1.11 前端实现要点

```ts
// stores/auth.ts
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  let accessToken: string | null = null;   // 故意不用 ref：不进 devtools、不落盘
  const expiredAt = ref(0);

  function setToken(t: string) {
    accessToken = t;
    expiredAt.value = Date.now() + 14 * 60 * 1000;  // 提前 1 分钟刷新
  }

  return { user, setToken, getAccessToken: () => accessToken, expiredAt };
});
```

**axios 拦截器（最容易写错的一块）**：

```ts
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(null, async (err) => {
  const cfg = err.config;
  if (err.response?.status !== 401 || cfg._retried) throw err;
  cfg._retried = true;

  // 并发请求共享同一次刷新
  refreshing ??= authApi.refresh()
    .then(r => { auth.setToken(r.accessToken); return r.accessToken; })
    .finally(() => { refreshing = null; });

  cfg.headers.Authorization = `Bearer ${await refreshing}`;
  return api.request(cfg);
});
```

⚠️ **三个坑**：

1. 并发 401 必须用**共享 Promise**，否则 N 次刷新互相把对方的 token 作废
2. 刷新接口本身返回 401 时**不能再走拦截器**（死循环）——用裸 `fetch` 调 `/auth/refresh`
3. 刷新失败要 `logout()` + 跳转，不能无限重试

**路由守卫**：

```ts
router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  if (!auth.user && !(await auth.tryRestore())) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.requireRegistered && auth.user?.isGuest) {
    return { name: 'upgrade' };
  }
  return true;
});
```

`meta.requireRegistered` 用来挡游客：排位、排行榜拦截，单机、房间放行。

### 1.12 里程碑影响

账号系统原本被塞在 M7（3 天）里，实际工作量：

| 子任务 | 天 |
|---|---|
| 表 + Prisma 迁移 + collate | 0.5 |
| guest / register / login / refresh / logout | 1.5 |
| 限流 + 安全检查 + 单测 | 1.0 |
| 前端 store + 拦截器 + 守卫 + 3 个页面 | 1.5 |
| WebSocket 鉴权接入 | 0.5 |
| **合计** | **5.0** |

所以 **M7 从 3 天涨到 7 天**（账号 5 + 房间/信令 2），总工期 **33 → 37 天**（v0.3.0 起计入自研部件骨骼 3 天，总账 **40 天**）。

> 想砍的话：v1 只做「游客 + 注册登录」，去掉邮箱验证、找回密码、多设备管理，能压到 3 天。但**刷新 / 旋转 / 重放检测不能省**——省了等于没有安全设计。

