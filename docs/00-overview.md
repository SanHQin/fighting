# 架构设计总纲

> 项目：平台格斗游戏（大乱斗式） ｜ 前端 Vue 3 + PixiJS，后端 Node.js
>
> 版本 v0.10.5 ｜ 2026-10-24 ｜ 系列：1 总纲 + 8 专题

本文是整套架构的入口。拆分明细见第 1 章，各专题互相引用，但每份都能单独读。

---

## 1. 文档地图

架构设计不再是一份 1700 行的巨型文档，而是拆成**一份总纲 + 八份专题**。总纲只保留跨领域的东西（定位、选型、仓库、工期、风险、部署、常量），每个专题负责一个领域，各自可以独立更新。

### 1.1 清单

| # | 文档 | 回答什么问题 | 谁该读 | 行数 |
|---|---|---|---|---|
| 00 | **本文** | 项目定位、技术选型、整体架构、仓库结构、**进度与原型债务**、工期与风险、**全部常量** | 所有人 | 694 |
| 01 | [角色操作与动画设计](./01-characters.md) | 一个角色由什么构成、需要准备哪些资源、怎么操控、九方向键位、**独有必杀与冲刺**、状态机怎么转、动画怎么和逻辑解耦 | 战斗程序、动画 | 2109 |
| 02 | [战斗地图设计](./02-stage.md) | 平台数据长什么样、**可破坏与移动平台**、**场地事件**、蹲跳怎么穿单向平台、相机怎么跟（含平滑跟随算法） | 战斗程序、关卡 | 1017 |
| 03 | [战斗系统与物理内核](./03-combat-system.md) | `battle-core` 的帧循环、物理公式、击飞、**冲刺/抓边/击倒/连击放大**、下蹲与变形盾、快照 | 战斗程序 | 943 |
| 04 | [页面 UI 与美术设计](./04-ui-art.md) | 美术风格、分辨率、页面流转、**大乱斗式 HUD**、素材规范、占位渲染、`rig.json`/`poses.json`、**九方向肢体动画** | 前端、美术 | 1023 |
| 05 | [服务端与联机设计](./05-server.md) | Node 服务端分层、房间/匹配/信令、回滚联机、确定性红线、**v0.8 实现现状与偏差** | 后端、联机 | 398 |
| 06 | [用户账号设计](./06-account.md) | 游客、注册登录、双 Token、refresh 旋转、WS 鉴权 | 后端、前端 | 369 |
| 07 | [数据库设计](./07-database.md) | MySQL 表结构、Prisma Schema、索引、Redis Key | 后端 | 189 |
| 08 | [后台管理设计](./08-admin.md) | GM 后台的权限、功能模块、回放审计、安全加固、**v0.8 实现现状** | 后端、运营 | 789 |

### 1.2 阅读路线

```
新手 / 甲方
  └─ 00 → 04（能看到什么）→ 01 + 02（怎么玩）

战斗程序员
  └─ 00 第 4 章 → 03（内核）→ 01（角色）→ 02（地图）→ 05 第 3 章（确定性）

后端程序员
  └─ 00 第 4 章 → 05（服务端）→ 06（账号）→ 07（数据库）→ 08（后台）

美术 / UI
  └─ 04 → 02 第 9 节（背景）→ 01 第 1.5 节（角色资源清单）→ 01 第 8 节（动画资源规范）
```

### 1.3 文档之间的硬约定

拆成多份之后，最容易出的问题是**两份文档对同一个数字给了不同的值**。为此定三条规矩：

1. **常量只有一个来源**：所有物理常量、网络参数、超时时间的权威定义在 **_本文件附录 A_**，专题文档里引用时写「见总纲附录 A」，不复制数值。
2. **接口定义只有一个来源**：`World` / `FighterState` / `InputFrame` / `SimEvent` 等核心类型定义在 **[03 战斗系统](./03-combat-system.md)** 与 **[01 角色](./01-characters.md)**，其他文档只引用不重定义。
3. **改文档要改版本号**：每份文档头部有独立版本号。改了字段就升版本，避免「代码按新文档写、另一份文档还是旧的」。

### 1.4 与代码的对应关系

| 文档 | 对应代码包 |
|---|---|
| 00 附录 A 常量表 | `packages/shared/src/constants.ts` |
| 01 角色 | `packages/battle-core/src/fighter/*`、`packages/client/src/game/view/*` |
| 02 地图 | `packages/battle-core/src/stage/*`、`packages/client/src/game/view/camera.ts` |
| 03 战斗内核 | `packages/battle-core/src/{sim,snapshot,checksum}.ts`、`physics/*`、`knockback/*` |
| 04 UI 与美术 | `packages/client/src/{pages,components,game/render}/*` |
| 05 服务端与联机 | `packages/server/src/*`、`packages/netcode/src/*` |
| 06 账号 | `packages/server/src/{security,http/routes/auth}/*` |
| 07 数据库 | `packages/server/prisma/schema.prisma` |
| 08 后台 | `packages/admin/src/*`、`packages/server/src/http/routes/admin/*` |

---

## 2. 项目定位

### 2.1 目标

| # | 目标 | 验收标准 |
|---|---|---|
| G1 | 单机可玩 | 选角色 → 打 AI → 3 命制 → 结算，全流程无阻塞 |
| G2 | **手感达标** | 击飞弧线符合直觉；能打出 3-4 段连段；能复归回场 |
| G3 | 物理稳健 | 高速击飞不穿模、不卡墙、不"粘地" |
| G4 | 联机可打 | 2 人 P2P，RTT ≤ 60ms 时操作无感知延迟 |
| G5 | 可扩展 | 加角色只改数据文件；4 人模式不重构架构 |

### 2.2 非目标（v1 明确不做）

- 4 人以上对战（架构预留，v2 做）
- 道具（箱子、炸弹、球棒）
- 场景破坏 / 关卡机关
- 观战、回放播放器（格式预留）
- 移动端触屏
- **技术动作（wavedash / L-cancel / 冲刺取消）** —— v2 再议，见第 11 章 D3

### 2.3 硬性约束

- 浏览器 Chrome / Edge / Safari 16+
- 全程 TypeScript，前后端共享类型
- **模拟层帧确定性**（见 [服务端与联机](./05-server.md) 第 3 章）—— 这条约束渗透到每一行模拟代码

---

## 3. 技术选型

### 3.1 定稿表

| 层 | 选型 | 理由 | 备选 |
|---|---|---|---|
| 构建 | Vite 5 | Vue 官方搭档 | — |
| 前端框架 | Vue 3 + `<script setup>` + TS | 甲方指定 | — |
| 渲染 | **PixiJS 8** + **自研部件骨骼**（`rig.json` + `poses.json`，无第三方骨骼运行时） | Pixi 只管 2D 批处理；每个部件一个 `Container`，`rotation` 直接由姿势数据驱动；包体 ≈1.0MB / 2 角色、改帧只需改 JSON | Spine（Essential $69/人 + `LicenseRef-LICENSE` 运行时授权）；序列帧（包体超 4 倍） |
| 状态管理 | Pinia | 只管 UI 状态 | — |
| UI 组件 | Naive UI | TS 友好 | Element Plus |
| 后端框架 | **Fastify 4** | 快、Schema 校验内建 | NestJS |
| WebSocket | **ws** | 无依赖、可控 | uWebSockets.js |
| 实时传输 | **WebRTC DataChannel** | UDP 语义 | WebSocket 中继（降级） |
| P2P 信令 | 自写（Node 转发 SDP/ICE） | 简单 | geckos.io |
| 缓存/房间 | Redis 7 | 房间态、队列、在线表 | 内存 Map（开发期） |
| **持久化** | **MySQL 8.4** + Prisma | 关系型，运维熟悉 | PostgreSQL（JSONB 更强，但已定 MySQL） |
| 鉴权 | JWT access（15min）+ 不透明 refresh（7d，httpOnly Cookie） | access 无状态免查库，refresh 可吊销 | Session + Redis |
| 密码哈希 | **argon2id**（`@node-rs/argon2`） | 内存硬，免编译 | bcrypt（72 字节截断） |
| 日志 | pino | 结构化 | — |
| 测试 | Vitest + Playwright | — | — |
| Monorepo | pnpm workspace | 零配置包引用 | Turborepo |

### 3.2 关于 MySQL 的三个注意事项

选了 MySQL 就要接受它和 PostgreSQL 的三处差异，架构上提前处理：

| 差异点 | 影响 | 对策 |
|---|---|---|
| **没有原生 JSONB** | 战绩明细、回合数据想存 JSON 时，MySQL 的 `JSON` 类型本身不能建索引（只能 `JSON_EXTRACT` 生成列后再索引） | **明细表规范化**，不用 JSON 存结构化数据；只有纯展示的大块数据（回放 blob）才用 `LONGBLOB` |
| **没有 `ON CONFLICT DO UPDATE`** | upsert 写法不同（`INSERT ... ON DUPLICATE KEY UPDATE`） | Prisma 的 `upsert` 会自动适配，业务层不用管 |
| **默认排序规则大小写不敏感** | `nickname` 唯一索引会把 `Aoi` 和 `aoi` 判为重复 | 昵称索引用 `utf8mb4_0900_as_cs`，或应用层统一小写 |

**字符集**：统一 `utf8mb4` + `utf8mb4_0900_ai_ci`，InnoDB，`ROW_FORMAT=DYNAMIC`。

**存储引擎**：全 InnoDB。不要用 MyISAM（无事务，会丢战绩）。

### 3.3 三个"别用"

| 别用 | 原因 |
|---|---|
| **Box2D / Matter.js / Rapier** | 平台格斗的物理必须逐帧精确可控（击飞衰减、DI、单向平台、抓边），物理引擎的接触解算器会毁掉手感和确定性 |
| **Vue 响应式驱动战斗帧** | `reactive` 的 Proxy 开销在 60fps 下是灾难 |
| **定点数（fixed point）** | 这是 v0.1 的错误建议，已修正。平台格斗用 `float64` + 禁用三角函数，见 [05 第 3.2 节](./05-server.md) |

---

## 4. 总体架构

### 4.1 分层视图

```
┌──────────────────────────────────────────────────────────────┐
│                        浏览器 (Client)                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Vue 3 应用层（低频：菜单/大厅/房间/选人/结算/HUD）        │  │
│  └───────────────┬────────────────────────────────────────┘  │
│                  │ 事件回调 / 命令，不走响应式热路径           │
│  ┌───────────────▼────────────────────────────────────────┐  │
│  │  Game Runtime（60Hz 固定步长）                            │  │
│  │  ┌──────────┐  ┌───────────┐  ┌────────────────────┐   │  │
│  │  │ Loop     │─▶│ Netcode   │─▶│ battle-core        │   │  │
│  │  │ 累加器    │  │ 回滚/预测  │  │ 世界状态 + step()   │   │  │
│  │  └────┬─────┘  └─────┬─────┘  └─────────┬──────────┘   │  │
│  │       │              │                   │              │  │
│  │       │              │ SimEvent[]        │ Snapshot     │  │
│  │  ┌────▼──────────────▼───────────────────▼──────────┐   │  │
│  │  │ View：插值 → Pixi 精灵 / 部件骨骼 / 特效 / 相机  │   │  │
│  │  │ + 音效 + 物理调试可视化器（开发期）              │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────┬────────────────────────────────┬──────────────────┘
           │ WS(JSON) 大厅/信令/结算          │ DataChannel(二进制) 输入
           ▼                                 ▼
┌────────────────────────────┐      ┌──────────────────┐
│      Node.js 服务端         │      │   对端浏览器      │
│  Gateway → Lobby/Signal/   │      │  （P2P）          │
│  Match/Auth/Replay          │      └──────────────────┘
│  Redis(房间/队列)           │
│  MySQL(账号/战绩/回放)       │
└────────────────────────────┘
```

### 4.2 核心决策：服务端不跑战斗

与拳皇版同理，且**平台格斗更不容忍**：

- 平台格斗的物理比拳皇复杂 4-6 倍，服务端跑一份就等于双倍 CPU 成本 + 双倍 bug
- 帧级判定要求每帧往返，云服务器 RTT（同区域 30-50ms）会把操作延迟推到不可接受
- 所以：**P2P + 回滚**，服务端只做信令、房间、匹配、战绩、输入日志存储

**代价**：无法实时反作弊。缓解方案见 [05 第 3.6 节](./05-server.md)。

### 4.3 七条铁律

| # | 铁律 | 违反的后果 |
|---|---|---|
| **L1** | `battle-core` 零 DOM / 零 Vue / 零 Pixi / 零 `Date.now` | 无法在 Node 跑回归测试，无法服务端校验 |
| **L2** | 模拟层**禁止 `Math.sin/cos/tan/pow/atan2/random`**，四则运算和 `Math.sqrt` 允许 | 三角函数跨浏览器有实现差异 → desync |
| **L3** | 渲染层**只读**模拟状态，禁止写回 | 回滚重演时状态被污染 |
| **L4** | 随机数来自带种子的 PRNG，种子进快照 | 回滚后随机结果不同 |
| **L5** | 一个逻辑帧 = 一次 `step()`，与真实时间无关 | 快慢机器战斗速度不同 |
| **L6** | 所有命中的数值结算在**同一帧内完成**，不跨帧排队 | 跨帧结算会被回滚打乱顺序 |
| **L7** | 状态转移**表驱动**，禁止隐式状态跳转 | 50 个状态会乱成一锅粥 |

---

## 5. 仓库结构

```
fighting/
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ docs/
│  ├─ 00-overview.md                     ← 本文档（总纲）
│  ├─ 01-characters.md                   ← 角色操作与动画
│  ├─ 02-stage.md                        ← 战斗地图
│  ├─ 03-combat-system.md                ← 战斗内核与物理
│  ├─ 04-ui-art.md                       ← 页面 UI 与美术
│  ├─ 05-server.md                       ← 服务端与联机
│  ├─ 06-account.md                      ← 用户账号
│  ├─ 07-database.md                     ← 数据库
│  ├─ 08-admin.md                        ← 后台管理
│  └─ archive/{ARCHITECTURE-kof-v0.1.md, ARCHITECTURE-v0.2.1-full.md}
│
├─ packages/
│  ├─ shared/                            # 零运行时依赖
│  │  └─ src/
│  │     ├─ protocol/{lobby,p2p,codec}.ts
│  │     ├─ constants.ts                 # 帧率、回滚窗口、重力等
│  │     ├─ math/trigTable.ts            # ★ 三角函数查找表（预生成，硬编码）
│  │     ├─ types.ts
│  │     └─ result.ts
│  │
│  ├─ battle-core/                       # ★ 战斗内核（纯逻辑，Node 可跑）
│  │  ├─ src/
│  │  │  ├─ index.ts                     # 唯一出口，re-export 全部
│  │  │  ├─ sim.ts            ✅          # World 结构 + step() + 命中/投射物/场地事件
│  │  │  ├─ types.ts          ✅          # CharDef / StageDef / SpecialDef 等数据契约
│  │  │  ├─ rng.ts            ✅          # xorshift32（种子进快照）
│  │  │  ├─ ai.ts             ✅          # SimpleAI：一个本地 InputSource，种子化
│  │  │  ├─ snapshot.ts       ✅          # 快照序列化 / 原地回填
│  │  │  ├─ checksum.ts       ✅          # FNV-1a + toFixed(3) 定点
│  │  │  ├─ loader.ts         ✅          # 校验 + 索引 + rulesetHash
│  │  │  ├─ input.ts                     # 输入编码、缓冲、指令解析（联机时补）
│  │  │  │
│  │  │  ├─ physics/                     # ★★★ 平台格斗物理
│  │  │  │  ├─ motion.ts                 # 加速度/摩擦/惯性/空中控制
│  │  │  │  ├─ jump.ts                   # 短跳/全跳/二段跳/快速下落
│  │  │  │  ├─ platform.ts               # 单向平台穿行、台壁碰撞
│  │  │  │  ├─ sweptAABB.ts              # 扫掠碰撞（防高速穿透）
│  │  │  │  ├─ ledge.ts                  # 抓边/悬挂/上台/滚上/跳起
│  │  │  │  └─ collide.ts                # 竖直/水平分阶段解算
│  │  │  │
│  │  │  ├─ knockback/                   # ★★★ 击飞系统
│  │  │  │  ├─ formula.ts                # 击飞公式
│  │  │  │  ├─ di.ts                     # DI（方向影响）
│  │  │  │  ├─ launch.ts                 # 击飞状态推进、衰减、反弹
│  │  │  │  └─ hitstun.ts                # 硬直/顿帧计算
│  │  │  │
│  │  │  ├─ fighter/
│  │  │  │  ├─ state.ts                  # 状态枚举（~50）
│  │  │  │  ├─ transitions.ts            # ★ 状态转移表
│  │  │  │  ├─ stateHandlers.ts          # 每个状态的 update
│  │  │  │  └─ attack.ts                 # 招式执行、cancel
│  │  │  │
│  │  │  ├─ combat/
│  │  │  │  ├─ hitbox.ts                 # 命中框判定（含多段/追踪）
│  │  │  │  ├─ resolve.ts                # 命中结算
│  │  │  │  ├─ shield.ts                 # 盾/盾耐久/盾破
│  │  │  │  └─ grab.ts                   # 抓取/挣脱
│  │  │  │
│  │  │  ├─ stage.ts                     # 场地定义：平台、边界、重生点
│  │  │  ├─ respawn.ts                   # 复活平台
│  │  │  ├─ camera.ts
│  │  │  ├─ event.ts
│  │  │  └─ loader.ts                    # 帧数据加载 + 校验
│  │  └─ data/
│  │     ├─ chars/{aoi,ken}.json
│  │     ├─ stages/{dying_beacon}.json
│  │     └─ schema/*.json
│  │
│  ├─ netcode/                           # 回滚网络层
│  │  └─ src/
│  │     ├─ session.ts
│  │     ├─ predictor.ts
│  │     ├─ rollback.ts
│  │     ├─ syncCheck.ts
│  │     ├─ clock.ts
│  │     └─ transport/{DataChannel,WebSocketFallback}.ts
│  │
│  ├─ ai/
│  │  └─ src/{bot,perception,planner,profiles}.ts
│  │
│  ├─ client/
│  │  └─ src/
│  │     ├─ views/{Login,Lobby,CharSelect,Battle,Result}.vue
│  │     ├─ game/
│  │     │  ├─ GameApp.ts
│  │     │  ├─ loop/FixedStepLoop.ts
│  │     │  ├─ render/{Renderer,FighterView,StageView,Camera,FxLayer,HudView}.ts
│  │     │  ├─ debug/PhysicsOverlay.ts   # ★ 物理调试可视化
│  │     │  ├─ audio/
│  │     │  └─ input/{Keyboard,Gamepad}.ts
│  │     ├─ api/, stores/, router/
│  │
│  └─ server/
│     └─ src/
│        ├─ index.ts, config.ts
│        ├─ http/routes/{auth,profile,replay}.ts
│        ├─ http/routes/admin/            # GM 后台 API（见 08）
│        ├─ http/middleware/{requireAuth,requireAdmin,rateLimit,errorHandler}.ts
│        ├─ security/{argon2.ts,jwt.ts,refreshToken.ts,totp.ts}   # 见 06 账号 / 08 后台
│        ├─ ws/{gateway.ts,handlers/{lobby,room,signal}.ts}
│        ├─ services/{auth,session,matchmaking,room,record,moderation}.ts
│        ├─ db/{schema.prisma,migrations/,client.ts}
│        └─ redis/keys.ts
│
├─ packages/admin/                        # GM 后台前端（独立部署，独立端口）
│  └─ src/{views,components,api,router,stores}/
│
└─ tools/
   ├─ replay-runner.ts
   ├─ desync-repro.ts
   └─ gen-trig-table.ts                   # 生成三角函数表
```

### 5.1 包依赖规则（eslint 强制）

```
shared      ← 无依赖
battle-core ← shared
netcode     ← battle-core, shared
ai          ← battle-core, shared
client      ← 全部
admin       ← shared（只共享类型，不碰 battle-core）
server      ← shared
```

`battle-core` 的 `tsconfig` 设 `"lib": ["ES2020"]`（不含 DOM），编译期挡住 `document`/`window`。

---

## 6. 性能预算

| 指标 | 目标 | 说明 |
|---|---|---|
| 逻辑 step | < 1ms | 一帧全部计算（4 人时 < 2.5ms） |
| 渲染 | < 8ms | 60fps 留一半余量 |
| 回滚重演 7 帧 | < 7ms | 保证不卡顿 |
| 首屏加载 | < 3s | 图集按需加载 |
| 战斗包 | < 2.5MB | 2 角色 + 1 场景 |
| 内存 | < 250MB | 快照池 + 图集 |
| 单帧网络包 | < 32B | 2 人输入 |

**开发期必须显示的指标**（`?debug=1`）：FPS / step 耗时 / 回滚次数 / RTT / 当前帧号 / 每个角色的状态名。

---

## 7. 里程碑

| 阶段 | 内容 | 产出 | 天 |
|---|---|---|---|
| **M0** | Monorepo、CI、Vite、Prisma+MySQL 跑通 | `pnpm dev` 起前后端 | 1 |
| **M1** | 物理原型：重力/跳跃/摩擦/平台碰撞 + **调试可视化** | 一个方块能跑能跳能落台 | 3 |
| **M2** | 击飞系统：公式/DI/弧线/落地反弹 | 能把方块打飞出画面 | 3 |
| **M3** | 完整状态机 + 抓边 + 复活 | 角色能复归回场 | 3 |
| **M4** | Pixi 渲染 + 插值 + 特效 + 相机（特效只用 3 个 sprite，视差 2 层）+ **部件骨骼运行时**（`rig.json` 加载 + 角度插值，0.7 天） | 视觉上像个游戏 | 2.7 |
| **M5** | 帧数据系统 + 2 角色（第一角色 60–80 招，第二角色 45 招）+ 盾/翻滚/闪避 + **姿势编辑器**（3～5 天摊掉 2.3，余下由美术在 M7–M9 用） | 能和 AI 打 | 5.3 |
| **M6** | AI（感知延迟 + 决策 + 编排） | **单机完整可玩** | 3 |
| **M7** | **账号系统**（游客/注册/登录/刷新/游客升级/WS 鉴权）+ 房间、信令、MySQL 落库 + 后台审计表与吊销接口（0.7） | 能注册登录、能建房、能连上 | 7.7 |
| **M8** | netcode：回滚、预测、校验和 | **2 人对战打通** | 6 |
| **M9** | 打磨：音效、UI、结算 + **GM 后台主体 2.8 天**（见 [08](./08-admin.md) 第 8 章）+ **两角色正式部件图与 poses**（美术并行，不占总工期） | 可发布 demo | 5.3 |
| | | **合计** | **7531** |

> **这 40 天是怎么凑出来的**：v0.2 的 33 天 → 账号系统并入 M7（M7 由 3 天变 7 天，其中房间/信令压到 2 天）= 37 天；再叠 GM 后台 3.5 天（M7 +0.7、M9 +2.8）与自研部件骨骼 3 天（M4 运行时 0.7、M5 姿势编辑器 2.3），账面到 43.5，靠三处压实回到 40——M4 粒子/视差简化为 3 个 sprite（−1）、M5 第二角色 60-80 招收到 45 招（−1）、M9 排行榜挪 v2 且结算页只修 P0（−1.5）。**代价是明确的**：第二角色招式数、特效丰富度、排行榜都不在第一版里。
>
> **为什么自研骨骼只多 3 天而不用 Spine**：Spine 省的是这 3 天，花的是每人 **$69** + 运行时 `LicenseRef-LICENSE` 商用授权 + 美术必须会 Spine。自研这 3 天是一次性投入，之后每个角色的动画都只是 `poses.json` 里的数字，且**能和 AI 生成的 T-pose 图直接接上**（切 9 张部件图 → 调角度），这是 Spine 做不到的——它要求人工在编辑器里绑定骨骼。

> **建议在 M6 做一次「试玩评审」**：单机版拉三个人来玩，如果手感不过关，此时返工代价最小（还没写联机）。

### 7.1 当前进度：前端原型 + 账号后端 + GM 后台都已跑通

到 v0.8.0 为止，已经**不是纯前端原型**了：账号系统和后台已经接上 MySQL 并跑通测试，
但战斗仍然只跑单机，联机一行没写。

**前端（`packages/client`，M1–M6 全部玩法 + 一部分 M9 界面）**

| 已有 | 位置 | 说明 |
|---|---|---|
| 固定步长循环 + 物理 + 击飞 + 下蹲/变形盾 + 冲刺/抓边/击倒 | `packages/battle-core/src/sim.ts` | 13 个状态、九方向招式、双乘数连击放大 |
| 程序化绘制 + 平滑相机 + 大乱斗式 HUD | `packages/client/src/views/BattleView.vue` | Canvas 2D，不是 Pixi |
| 11 个页面 | `packages/client/src/views/` | 数据全写死在 `mock/data.ts` |
| 4 个角色（含独有必杀）+ 4 张场地（含事件） | `packages/client/src/mock/data.ts` | 纯数据 |
| 共享视觉层（背景/标题/按钮/焦点网格） | `components/{AppBackdrop,PageHeader,MenuItem,HintBar}.vue` + `styles/base.css` | — |
| 战斗内核独立成包（快照 / 校验和 / 内容加载） | `packages/battle-core/src/{sim,snapshot,checksum,loader,rng,ai}.ts` | 零 DOM、零 `Math.random`、可被 Node 与浏览器共用 |

**后端（`packages/server`，M7 的账号部分）**

| 已有 | 位置 | 说明 |
|---|---|---|
| Fastify 5 + Prisma 7（driver adapter）+ MySQL 8 | `src/http/app.ts`、`src/db/client.ts` | 7 张业务表 + 审计表 |
| 账号接口 9 个（游客/注册/登录/刷新/登出/升级/me） | `src/http/routes/auth.ts` | argon2id + JWT + 旋转 refresh |
| 后台接口 9 个（统计/用户/封禁/角色/审计/对局） | `src/http/routes/admin.ts` | RBAC + 先审计再执行 |
| WebSocket 首条消息鉴权 | `src/ws/gateway.ts` | 3 秒超时，4001/4002/4003 |
| 房间 / 匹配 / 信令 / 回滚 / Redis | — | ❌ 未开工 |

**后台（`packages/admin`，M9 的 GM 主体）**

6 个页面（登录/仪表盘/用户列表/用户详情/对局/审计），独立部署在 5174，
`accessToken` 只放内存，风格与游戏端同一套 token。

**七套自动检查 + 两套接口测试**：`smoke-sim`（确定性）、`check-combat`（30 组断言）、
`check-netcode`（快照往返 / 回滚重演 / 校验和边界 / 规则哈希）、`check-render`（11 页 SSR）、
`check-backdrop`（4 张场地）、`check-camera`（10 组镜头断言）、`check-feel`（11 组手感断言）、`vue-tsc`/`tsc` 四端；
`test-api`（29 条）、`test-admin`（22 条）。

**还剩的债务（必须在 M8 之前还清）**：

1. ~~`protoRuntime.ts` 不是 `battle-core`~~ **（v0.9.0 已还清）**：内核搬到 `packages/battle-core/src/`（`sim` / `types` / `rng` / `ai` / `snapshot` / `checksum` / `loader`）。
   客户端只剩 `game/keyboard.ts`（输入设备）与 `game/cameraRig.ts`（镜头）；`createWorld(charA, charB, stage)` 接收**已解析的定义**，
   查表与校验在 `loader.loadContent()`；`snapshotWorld` / `restoreWorld` 原地回填；`checksumHex` 是 FNV-1a + `toFixed(3)` 定点。
   `check-netcode` 覆盖两个必过测试：同输入 1000 帧校验和一致、带快照回填重演与直跑一致。
2. **渲染是 Canvas 2D，不是 PixiJS。** M4 的 Pixi 迁移没做。原型的绘制代码
   （约 1000 行）不能直接搬，但它验证过的**所有视觉规则**（包络峰值落在判定帧、
   镜像用 `Math.PI - deg`、拖影必须在 `scale(facing,1)` 内、插值只用于位置）可以直接用。
3. **`mock/data.ts` 的字段形状已经是最终形状**（`CharDef` / `StageDef` / `SpecialDef`），
   所以转 JSON 是纯搬运，不需要改结构。
4. ~~前端还没连自己的后端~~ **（v0.8.3 已还清）**：`packages/client/src/api/client.ts` 已接
   `POST /api/auth/{login,register,guest,refresh,logout}` 与 `GET /api/auth/me`；
   `stores/session.ts` 的 `bootstrap()` 用 httpOnly Cookie 恢复登录，刷新页面不掉线；
   开发期走 vite 代理（`/api` → 3001）以保持同源，否则 `SameSite=Lax` 的 refresh Cookie
   跨端口根本不发。

> 结论：**玩法验证已完成，账号与后台已工程化，前端已连上真后端**。剩下两件事按顺序是：
> ① `protoRuntime` → `battle-core`（补 snapshot/checksum 往返自检）；② 房间/信令/回滚联机；
> ③ 把 Pixi 换上（可与 ② 并行，但 ② 之前别动渲染层）。


---

## 8. 风险清单

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| **击飞物理调不好** | **高** | **致命** | M1-M2 先做纯物理原型，没有美术也要调到"手感对"再往下走 |
| 高速穿透 / 卡墙 | 高 | 高 | M1 就上扫掠检测，用调试器可视化轨迹 |
| 回滚 desync | 高 | 致命 | M1 起就写「双实例比对」测试 |
| 状态机混乱（角色卡住） | 高 | 高 | 转移表 + 开发期断言（见 [01 第 5 节](./01-characters.md)） |
| 帧数据量爆炸（80 招/角色） | 中 | 高 | 表格驱动 + 编辑器工具，或先做 1 个角色打样 |
| 网络环境差（对称 NAT） | 高 | 中 | 提前备 TURN，做 WebSocket 降级 |
| 美术拖进度 | 高 | 中 | 全程色块占位，M8 后才接素材；**M7 末必须有可动骨架**，卡点未过即降级为色块角色（见 [04](./04-ui-art.md) 第 1.3 节） |
| 自研 rig 的姿势数据量大 | 中 | 中 | 每角色约 70 个动画 × 3–5 组关键姿势 ≈ 250 组数字，靠姿势编辑器（[04](./04-ui-art.md) 第 7.4 节）维护；`poses.json` 是文本，可 diff、可 CI 校验，出问题能手改——这是相对二进制 skeleton 的抗风险优势 |
| IP 侵权 | 中 | 法律 | 角色/招式/LOGO 全原创，只借鉴"手感" |
| **账号安全出漏洞**（撞库/会话泄露） | 中 | **高** | [06](./06-account.md) 第 1.9 节清单 + refresh 旋转重放检测；上线前跑一遍 OWASP ASVS 前 20 项 |
| 游客数据被清理误伤 | 中 | 中 | 清理任务只删 `is_guest=1 且 30 天未登录`；升级后立刻脱离清理范围 |
| **原型代码滞留在 client 里** | **高** | **中** | `protoRuntime.ts` 必须迁到 `battle-core` 并补 snapshot/checksum 往返自检（见 §7.1）；拖到 M8 才做会和 netcode 耦合到无法拆分 |
| 场地事件伤害失衡 | 中 | 中 | 单事件硬上限 15% 且 `HAZARD_IFRAMES = 18`；上线前用「站着不动」脚本跑四张图，算每秒理论承伤 |

---

## 9. 测试策略

### 9.1 三层

| 层 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | 击飞公式、扫掠碰撞、三角函数表、快照往返 |
| 确定性回归 | Vitest | 同输入跑 1000 帧 → hash 一致；带/不带回滚 → hash 一致 |
| E2E | Playwright | 登录 → 匹配 → 对战 → 结算 |

### 9.2 两个必须过的测试

```ts
it('同输入同结果', () => {
  const inputs = fuzz(1000, 42);
  expect(runSim(inputs).hash).toBe(runSim(inputs).hash);
});

it('回滚不改变最终状态', () => {
  const inputs = fuzz(600, 42);
  const straight = runStraight(inputs);
  const rolled = runWithRollback(inputs, 7);
  expect(checksum(rolled)).toBe(checksum(straight));
});
```

**第二条是 go/no-go 门槛。过不了，联机一定炸。**

### 9.3 网络模拟

```ts
transport.setLatency({ min: 40, max: 90, jitter: 15, loss: 0.02 });
```

手测：Windows 用 `clumsy`，Linux 用 `tc netem`。

---

## 10. 部署拓扑

```
                    ┌─────────────┐
    玩家 ──HTTPS───▶│  Nginx/CDN  │──── 静态资源
                    └──────┬──────┘
                           │ /api /ws
                    ┌──────▼──────┐
                    │  Node 服务   │  ← Docker / PM2
                    └──┬───────┬──┘
              ┌────────▼──┐  ┌─▼─────────┐
              │  Redis    │  │  MySQL 8  │
              └───────────┘  └───────────┘

    玩家A ══════ WebRTC P2P ══════ 玩家B
                    │
              ┌─────▼──────┐
              │  coturn    │  ← NAT 穿透兜底
              └────────────┘
```

**部署注意**：

- coturn 需开放 **UDP 3478 + UDP 49152-65535**（云服务器安全组默认只开 TCP，手动加 UDP 规则）
- MySQL 8：`innodb_buffer_pool_size` 至少 1G；开 `binlog` 便于恢复
- HTTPS 是 WebRTC 的硬要求
- 数据库连接池：Prisma 用 `connection_limit` 参数控制（MySQL 没有 PgBouncer 等价物，量大时考虑 ProxySQL）

---

## 11. 待确认的决策

| # | 决策点 | 默认值 | 影响 |
|---|---|---|---|
| D1 | 渲染 | **PixiJS 8 + 自研部件骨骼**（平涂赛璐璐） | 不用 Spine（Essential $69 + `LicenseRef-LICENSE` 运行时授权）；若要 3D 角色，换 three.js，工作量 +80%；详见 [04 UI 与美术](./04-ui-art.md) 第 1 章 |
| D2 | 人数 | **v1 仅 2 人** | 4 人回滚难度是 2 人的数倍 |
| D3 | 技术动作 | **v1 不做**（无 wavedash / L-cancel） | 做了手感天花板更高，但物理系统要求提高一档 |
| D4 | 场地 | **1 张「残灯台」**（终点型：主台 1500 宽 + 2 侧副台 + 1 中副台） | 多平台图需要更复杂的碰撞。详见 [02 地图设计](./02-stage.md) 第 7 章 |
| D5 | 复活机制 | **3 命制，无共享命** | — |
| D6 | 部署 | 本地 + 局域网优先 | 公网需域名 + 服务器 + TURN |

---

## 附录 A：常量表

```ts
// —— 时间 ——
export const LOGIC_FPS = 60;
export const STEP_MS = 1000 / 60;
export const ROUND_TIME_FRAMES = 60 * 60 * 6;   // 6 分钟

// —— 空间 ——
export const VIEW_W = 1280;
export const VIEW_H = 720;
export const STAGE_W = 2400;

// —— 物理 ——
export const GRAVITY = 0.85;
export const MAX_FALL = 12;
export const FAST_FALL_SPEED = 18;
export const AIR_ACCEL = 0.42;
export const AIR_DRAG = 0.99;
export const GROUND_ACCEL = 0.9;
export const SHORT_HOP_VELOCITY = 8.5;
export const FULL_JUMP_VELOCITY = 12.5;
export const JUMP_SQUAT_FRAMES = 4;
export const HITSTUN_DECAY = 1;

// —— 击飞 ——
// v0.4.0 校准：原值 0.03 来自 Melee 单位制（1 单位 ≈ 1/4 角色高），
// 本项目 1 单位 = 1 逻辑像素、角色高 64，尺度差约 3 倍。
// 实测 0.03 时 100% 伤害只飞 46px，打不出场地；0.09 时台边 120% 可 KO、
// 台中央 200% 可 KO，与「高百分比才致命」的设计目标一致（见 01 第 9 章连段表）。
export const KNOCKBACK_TO_SPEED = 0.09;
export const KB_MAX = 2500;
export const DI_MAX_ANGLE = 18;
export const HITSTUN_RATIO = 0.4;
export const HITSTUN_MIN = 6;
export const HITSTUN_GRAVITY_MUL = 0.55;

// —— 网络 ——
export const MAX_ROLLBACK_FRAMES = 7;
export const SNAPSHOT_POOL_SIZE = 16;
export const SYNC_CHECK_INTERVAL = 30;
export const INPUT_DELAY_DEFAULT = 0;

// —— 对局 ——
export const STOCKS = 3;
export const RESPAWN_DELAY_FRAMES = 100;
export const RESPAWN_INVINCIBLE = 60;

// —— 下蹲 / 变形盾（v0.5.0）——
// 防御没有独立键：按住 down 就是下蹲，下蹲就是防御。
// 下蹲把受击框从 64 压到 40（躲头顶来的上挑），但完全不能移动。
export const CROUCH_HEIGHT = 40;
export const DROP_THROUGH_FRAMES = 14;   // 蹲跳穿下单向平台后的免接住帧数
// 落地硬直：按落地速度在 [2, 6] 之间取值，不再是一个常数
export const LAND_LAG_MIN = 1;           // 小跳落地
export const LAND_LAG_MAX = 4;           // 满速硬落
// 手感四件套（详见 01 第 4.4 节）
export const JUMP_BUFFER_FRAMES = 6;     // 跳跃缓冲：落地前按跳，落地硬直一结束就起跳
export const COYOTE_FRAMES = 3;          // 郊狼时间：刚离开平台边缘 3 帧内仍可起跳
export const ATTACK_BUFFER_FRAMES = 5;   // 攻击缓冲：收招末尾按攻击，解除硬直当帧出招
export const HITLAG_MAX = 9;             // 顿帧上限：4 + 伤害/6，重击更"顿"
// 盾是一个半径随盾值缩放的圆球：50 → 半径 34，0 → 20。
// 判定：攻击框与受击框的重叠区四个角都在盾圆内才算挡下。
// 半径要 ≥26 才盖得住蹲姿受击框，即盾值低于 ~44% 才开始漏招——这是刻意的博弈窗口。
export const SHIELD_MAX = 50;
export const SHIELD_RADIUS_MIN = 20;
export const SHIELD_RADIUS_MAX = 34;
export const SHIELD_DRAIN = 0.08;        // 举盾每帧自然消耗
export const SHIELD_REGEN = 0.42;        // 收盾后每帧恢复（约 1.6s 回满）
export const SHIELD_REGEN_DELAY = 22;    // 收盾后多久开始恢复
export const SHIELD_DAMAGE_MUL = 1.1;    // 挡一下扣盾 = 伤害 × 1.1 + 2
export const SHIELD_DAMAGE_BASE = 2;
export const SHIELD_LEAK_DRAIN = 0.5;    // 盾没盖住时额外扣盾倍率
export const SHIELD_KB_MUL = 0.28;       // 格挡的推力只有命中的 28%
export const SHIELD_BREAK_STUN = 150;    // 破盾眩晕帧数
export const SHIELD_BREAK_RESET = 22;    // 解晕时恢复的盾值（约四成，容易被接着打死）

// —— 连击放大 ——
// 同一方连续命中每段 +14% 击飞（封顶 ×1.2）；
// 伤害超 200% 后每多 100% 再加 45%（封顶 ×1.9）。相乘最高 ×2.28。
export const COMBO_KB_PER_HIT = 0.14;
export const COMBO_KB_MAX = 1.2;
export const COMBO_DMG_GATE = 200;
export const COMBO_DMG_PER_100 = 0.45;
export const COMBO_DMG_MAX = 0.9;
export const COMBO_EXPIRE = 90;          // 多久没命中就断连

// —— 冲刺与空中冲刺（v0.7.0）——
// 冲刺是「位移即资源」：既是进攻起手（冲刺中按攻击 = 冲刺攻击），也是唯一的复归手段。
// 空中冲刺的速度与帧数都乘 AIR_DASH_MUL；落地重置 airDashes。
export const DASH_SPEED = 17;            // 起冲速度（≈ MAX_RUN 的 1.9 倍）
export const DASH_FRAMES = 14;
export const DASH_END_SPEED = 6.5;       // 收尾速度，之后交给摩擦
export const DASH_COOLDOWN = 26;         // 角色可覆盖：葵 20 / 砺 26 / 肯 32
export const DASH_ENDLAG = 5;            // 冲完的硬直（比落地硬直 3 帧更重）
export const DASH_ATTACK_GLIDE = 0.9;    // 冲刺攻击保留的前冲速度比例
export const AIR_DASH_MUL = 0.82;        // 空中冲刺的速度与帧数倍率
export const DASH_ATTACK_KB_MUL = 1.15;
export const DASH_DIAGONAL_MUL = 0.92;   // 斜向冲刺微调：斜向能同时走两轴，等价位移更大
// 场外复归冲刺：更快、冷却更短、不消耗空中冲刺次数（容错，不是资源）
export const OFFSTAGE_DASH_MUL = 1.9;      // 场外复归冲刺速度倍率（比场内空冲更强）
export const OFFSTAGE_DASH_FRAMES_MUL = 1.4; // 场外复归冲刺持续帧倍率
export const OFFSTAGE_DASH_CD_MUL = 0.3;
export const RECOVERY_DASHES = 1;           // 场外复归冲刺次数（回到场地范围内即补满；场外只能用这一种燃料）
export const OFFSTAGE_MARGIN = 30;       // 判定"在场外"时给平台外沿的宽容带
export const OFFSTAGE_BELOW = 220;       // 低于所有平台顶面多少算"掉在场外"

// —— 抓边（v0.7.0）——
// 判定刻意宽松：玩家被击飞时无法精确对位，严判等于直接判死。
export const LEDGE_GRAB_Y = 46;          // 台面下方 4–46px 这一带都能抓
export const LEDGE_GRAB_X = 26;          // 左右各 26px 横向容差
export const LEDGE_COOLDOWN = 40;        // 离开边缘后多久不能重抓
export const LEDGE_INVINCIBLE = 30;      // 抓住瞬间的无敌帧
export const LEDGE_CLIMB_FRAMES = 16;    // 上爬耗时
export const LEDGE_RELEASE_LOCK = 30;    // 主动松手后多久不能重抓

// —— 击倒（v0.6.0）——
// 伤害过了角色自己的门槛、且正处于连击里，再被击中就倒地。
// 门槛与帧数是每角色的（见 01 第 6 章）：砺 115/46/18 · 葵 100/38/24 · 肯 135/58/14。
export const KNOCKDOWN_MIN_COMBO = 2;
export const KNOCKDOWN_BOUNCE = 9.5;     // 倒地触地弹一下的初速
export const KNOCKDOWN_FRICTION = 0.86;  // 倒地滑行摩擦

// —— 场地运行时（v0.6.0）——
export const MAX_PROJECTILES = 24;       // 满了丢弃最老那颗（先发的快命中了）
export const HAZARD_IFRAMES = 18;        // 同一事件不能连续多帧命中
export const PLATFORM_HP_SCALE = 1;      // 平台掉血倍率（留作平衡阀）
```

---

## 附录 B：术语表

| 术语 | 含义 |
|---|---|
| **Knockback / KB** | 击飞，受击后获得的速度 |
| **Hitstun** | 硬直，被打后无法行动的时间 |
| **Hitlag / 顿帧** | 命中瞬间双方冻结的帧数 |
| **DI** | Directional Influence，受击时输入方向以偏转击飞角度 |
| **SDI** | Smash DI，顿帧期间连续输入以脱离判定（v2） |
| **Tech** | 受身，落地瞬间按键避免 Knockdown |
| **Ledge** | 台边，可抓取 |
| **Blast Zone** | 出界线，越过即淘汰 |
| **Sakurai Angle** | 樱井角，地面/空中击飞角不同的设计 |
| **Fast Fall** | 快速下落 |
| **Short Hop** | 短跳，按跳后 1-2 帧松开 |
| **Swept AABB** | 扫掠碰撞检测，防止高速穿透 |
| **Rollback** | 回滚网络同步 |
| **Crouch / 下蹲** | 按住下方向；同时是防御动作，受击框从 64 压到 40，完全不能移动 |
| **Deformable Shield / 变形盾** | 盾不是血条而是一个随盾值缩放的圆球（半径 34→20）；盾越小越容易被招式的判定框从边缘漏进去 |



