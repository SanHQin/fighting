# 数据库设计（MySQL 8）

> 项目：平台格斗游戏（大乱斗式） · 所属：[架构设计总纲](./00-overview.md)
>
> 版本 v0.10.6 ｜ 2026-10-24 ｜ 系列：1 总纲 + 8 专题

MySQL 8.4 + Prisma。这里只有持久化层，业务规则见 [用户账号设计](./06-account.md) 与 [服务端与联机设计](./05-server.md)。

---

## 1. 数据库设计（MySQL 8）

> **v0.10：每个字段都有注释。** 73 个列全部带 `COMMENT`，用 `SHOW FULL COLUMNS FROM users` 或任意 SQL 客户端都能直接读到「这一列是干什么的」。
>
> 三处来源必须同步，改字段时一起改：
> 1. `tools/make-comments.py` —— **唯一来源**，表→列→注释的字典写在里面；
> 2. `tools/ddl.sql` —— 脚本把 `COMMENT` 注入建表语句；
> 3. `packages/server/prisma/schema.prisma` —— 脚本同时注入 `///` 文档注释，编辑器里悬停可见。
>
> 已上线的库用 `tools/migrate-v10-comments.sql` 补齐（只 `MODIFY COLUMN`，不改类型与数据，可重复执行）。
>
> 为什么值这个功夫：三个月后回来看 `rating_dev`、`input_hash`、`revoked_at`，光看列名猜不出语义；而注释是唯一能跟着表结构一起走、不会和代码漂移的文档（`docs/` 会漂，代码注释会随重构消失）。


### 1.1 建表规范

- 引擎 **InnoDB**
- 字符集 `utf8mb4`，排序规则 `utf8mb4_0900_ai_ci`
- 主键用 `BIGINT UNSIGNED AUTO_INCREMENT`（不用 UUID 做主键，InnoDB 聚簇索引会碎片化）
- 所有表带 `created_at` / `updated_at`
- 时间统一 `DATETIME(3)`，**存 UTC**，展示时转本地时区
- **不用 `FOREIGN KEY` 约束**，用应用层保证（高并发下外键会成为锁瓶颈），但**索引必须建**
- 不用 `ENUM` 类型存业务状态（改枚举要 DDL），用 `TINYINT` + 应用层常量

### 1.2 Prisma Schema

> `provider = "mysql"`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id              BigInt    @id @default(autoincrement()) @db.UnsignedBigInt
  uid             String    @unique @db.VarChar(32)       // 对外短 ID
  nickname        String    @unique @db.VarChar(32)       // 大小写敏感，见 [06 第 1.2 节](./06-account.md)
  passwordHash    String?   @map("password_hash") @db.VarChar(255)  // null = 游客
  email           String?   @unique @db.VarChar(255)
  isGuest         Boolean   @default(true) @map("is_guest")
  emailVerifiedAt DateTime? @map("email_verified_at") @db.DateTime(3)
  lastLoginAt     DateTime? @map("last_login_at") @db.DateTime(3)
  rating          Int       @default(1000)
  ratingDev       Int       @default(350)                 // Glicko 的 RD
  wins            Int       @default(0)
  losses          Int       @default(0)
  createdAt       DateTime  @default(now()) @map("created_at") @db.DateTime(3)
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.DateTime(3)

  matches         MatchPlayer[]
  sessions        UserSession[]

  @@index([rating])
  @@map("users")
}

model Match {
  id             BigInt    @id @default(autoincrement()) @db.UnsignedBigInt
  seed           Int
  rulesetHash    Int       @map("ruleset_hash") @db.UnsignedInt
  stageId        Int       @map("stage_id") @db.SmallInt
  mode           Int       @default(0)                 // 0=casual 1=ranked 2=custom
  winnerSlot     Int?      @map("winner_slot") @db.TinyInt   // null=平局
  durationFrames Int       @map("duration_frames")
  playedAt       DateTime  @default(now()) @map("played_at") @db.DateTime(3)

  players        MatchPlayer[]
  rounds         MatchRound[]
  replay         Replay?

  @@index([playedAt])
  @@index([mode, playedAt])
  @@map("matches")
}

/// 每个回合的明细（替代 v0.1 的 Json 字段）
model MatchRound {
  id         BigInt @id @default(autoincrement()) @db.UnsignedBigInt
  matchId    BigInt @map("match_id") @db.UnsignedBigInt
  roundNo    Int    @map("round_no") @db.TinyInt
  winnerSlot Int?   @map("winner_slot") @db.TinyInt
  endFrame   Int    @map("end_frame")

  match      Match @relation(fields: [matchId], references: [id], onDelete: Cascade)
  survivors  MatchRoundSurvivor[]

  @@unique([matchId, roundNo])
  @@map("match_rounds")
}

/// 回合结束时各玩家状态
model MatchRoundSurvivor {
  id         BigInt @id @default(autoincrement()) @db.UnsignedBigInt
  roundId    BigInt @map("round_id") @db.UnsignedBigInt
  slot       Int    @db.TinyInt
  charId     Int    @map("char_id") @db.SmallInt
  stocksLeft Int    @map("stocks_left") @db.TinyInt
  damage     Int    @db.SmallInt                       // 百分比 ×100

  round      MatchRound @relation(fields: [roundId], references: [id], onDelete: Cascade)

  @@unique([roundId, slot])
  @@map("match_round_survivors")
}

model MatchPlayer {
  id          BigInt @id @default(autoincrement()) @db.UnsignedBigInt
  matchId     BigInt @map("match_id") @db.UnsignedBigInt
  userId      BigInt @map("user_id") @db.UnsignedBigInt
  slot        Int    @db.TinyInt                       // 0..3
  charId      Int    @map("char_id") @db.SmallInt
  ratingDelta Int    @map("rating_delta")

  match       Match @relation(fields: [matchId], references: [id], onDelete: Cascade)
  user        User  @relation(fields: [userId], references: [id])

  @@unique([matchId, slot])
  @@index([userId, id])
  @@map("match_players")
}

model Replay {
  matchId    BigInt   @id @map("match_id") @db.UnsignedBigInt
  data       Bytes    @db.LongBlob                     // gzip 后的输入日志
  sizeBytes  Int      @map("size_bytes") @db.UnsignedInt
  checksum   Int      @db.UnsignedInt                  // 终局哈希，校验回放正确性
  createdAt  DateTime @default(now()) @map("created_at") @db.DateTime(3)

  match      Match @relation(fields: [matchId], references: [id], onDelete: Cascade)

  @@map("replays")
}
```

### 1.3 关键索引

| 表 | 索引 | 用途 |
|---|---|---|
| `users` | `unique(uid)` | 对外查询 |
| `users` | `unique(nickname)` | 昵称唯一（**collate `utf8mb4_0900_as_cs`**，见 [06 第 1.2 节](./06-account.md)） |
| `users` | `idx(rating)` | 排行榜 |
| `user_sessions` | `unique(refresh_token_hash)` | 刷新时的查询入口 |
| `user_sessions` | `idx(user_id, revoked_at)` | 「登出所有设备」/ 重放检测的全量作废 |
| `user_sessions` | `idx(expires_at)` | 过期会话清理任务 |
| `match_players` | `idx(user_id, id DESC)` | 「我的对局」分页 |
| `matches` | `idx(played_at)` | 近期对局、统计 |
| `matches` | `idx(mode, played_at)` | 分模式统计 |

**不要过度索引**：每次写入都要维护索引。`match_rounds` / `match_round_survivors` 的 `unique(match_id, round_no)` / `unique(round_id, slot)` 已覆盖查询需求。

### 1.4 为什么 JSON 字段被改成表

v0.1 里 `Match.rounds Json` 在 PostgreSQL（JSONB + GIN 索引）里很方便。**MySQL 的 `JSON` 类型本身不能建索引**，要索引得用生成列：

```sql
ALTER TABLE matches ADD COLUMN winner_slot TINYINT
  GENERATED ALWAYS AS (JSON_EXTRACT(rounds, '$.winner')) VIRTUAL;
```

能跑，但语义混乱、迁移痛苦。既然定了 MySQL，**明细直接规范化成表**，性能更好、查询更直观（"最近 10 局平均存活命数"一条 SQL 就出）。

### 1.5 Redis Key

| Key | 类型 | TTL | 用途 |
|---|---|---|---|
| `online:{userId}` | String | 60s | 在线心跳 |
| `room:{roomId}` | Hash | 30min | 房间状态 |
| `roomcode:{code}` | String | 30min | 邀请码 → roomId |
| `mmq:ranked` | ZSet | — | 匹配队列（score=入队时间） |
| `rl:login:{ip}` | String | 60s | 登录限流（INCR） |
| `rl:register:{ip}` | String | 3600s | 注册限流 |
| `rl:reset:{email}` | String | 900s | 找回密码限流 |
| `ws:conn:{userId}` | Set | — | 该用户的多端 WS 连接（登出所有设备时踢线） |

