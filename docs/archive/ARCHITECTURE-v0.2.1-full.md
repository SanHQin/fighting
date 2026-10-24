# 平台格斗游戏 —— 架构设计文档

> 类型：大乱斗式（Smash 风格）平台格斗 · 浏览器运行 · Vue3 前端 + Node.js 后端
>
> 版本 v0.2.1 ｜ 日期 2026-10-23 ｜ 取代 v0.1（拳皇式，已归档至 `docs/archive/ARCHITECTURE-kof-v0.1.md`）
>
> v0.2.1 变更：新增第 8 章「账号系统（注册 / 登录 / 会话）」

| 项 | 值 |
|---|---|
| 胜负条件 | 打出场地边界（出界淘汰），非血条清空 |
| 核心资源 | 伤害百分比 + 击飞值 + 复归资源（二段跳 / 上必杀） |
| 场地 | 多平台、单向平台、台壁、边缘抓取 |
| v1 人数 | 1v1（架构为 4 人预留） |
| 账号 | 游客自动创建 + 邮箱密码注册；argon2id；JWT + 旋转 refresh |
| 数据库 | **MySQL 8** |
| 状态 | 待评审 |

---

## 0. 阅读指南

本文档与 v0.1 的差异集中在 **物理系统（第 6 章）、状态机（第 5.5 节）、击飞系统（第 6.4 节）、账号系统（第 8 章，v0.2 新增）、数据库（第 9 章）**。仓库结构（第 4 章）、Vue 边界（第 5.3 节）、服务端（第 7 章）与 v0.1 基本一致。

**v0.2.1 增补**：新增第 8 章「账号系统」，原第 8–15 章整体后移为 9–16 章；里程碑 M7 由 3 天调整为 7 天，总工期 33 → **37 天**。

如果只看一页，看 **第 3.3 节的七条铁律**。

---

## 1. 项目定位

### 1.1 目标

| # | 目标 | 验收标准 |
|---|---|---|
| G1 | 单机可玩 | 选角色 → 打 AI → 3 命制 → 结算，全流程无阻塞 |
| G2 | **手感达标** | 击飞弧线符合直觉；能打出 3-4 段连段；能复归回场 |
| G3 | 物理稳健 | 高速击飞不穿模、不卡墙、不"粘地" |
| G4 | 联机可打 | 2 人 P2P，RTT ≤ 60ms 时操作无感知延迟 |
| G5 | 可扩展 | 加角色只改数据文件；4 人模式不重构架构 |

### 1.2 非目标（v1 明确不做）

- 4 人以上对战（架构预留，v2 做）
- 道具（箱子、炸弹、球棒）
- 场景破坏 / 关卡机关
- 观战、回放播放器（格式预留）
- 移动端触屏
- **技术动作（wavedash / L-cancel / 冲刺取消）** —— v2 再议，见第 16 章 D3

### 1.3 硬性约束

- 浏览器 Chrome / Edge / Safari 16+
- 全程 TypeScript，前后端共享类型
- **模拟层帧确定性**（第 10 章）—— 这条约束渗透到每一行模拟代码

---

## 2. 技术选型

### 2.1 定稿表

| 层 | 选型 | 理由 | 备选 |
|---|---|---|---|
| 构建 | Vite 5 | Vue 官方搭档 | — |
| 前端框架 | Vue 3 + `<script setup>` + TS | 甲方指定 | — |
| 渲染 | **PixiJS 8** | 纯 2D 渲染器，不侵入逻辑；批处理性能好 | three.js（要 3D 角色时） |
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

### 2.2 关于 MySQL 的三个注意事项

选了 MySQL 就要接受它和 PostgreSQL 的三处差异，架构上提前处理：

| 差异点 | 影响 | 对策 |
|---|---|---|
| **没有原生 JSONB** | 战绩明细、回合数据想存 JSON 时，MySQL 的 `JSON` 类型本身不能建索引（只能 `JSON_EXTRACT` 生成列后再索引） | **明细表规范化**，不用 JSON 存结构化数据；只有纯展示的大块数据（回放 blob）才用 `LONGBLOB` |
| **没有 `ON CONFLICT DO UPDATE`** | upsert 写法不同（`INSERT ... ON DUPLICATE KEY UPDATE`） | Prisma 的 `upsert` 会自动适配，业务层不用管 |
| **默认排序规则大小写不敏感** | `nickname` 唯一索引会把 `Aoi` 和 `aoi` 判为重复 | 昵称索引用 `utf8mb4_0900_as_cs`，或应用层统一小写 |

**字符集**：统一 `utf8mb4` + `utf8mb4_0900_ai_ci`，InnoDB，`ROW_FORMAT=DYNAMIC`。

**存储引擎**：全 InnoDB。不要用 MyISAM（无事务，会丢战绩）。

### 2.3 三个"别用"

| 别用 | 原因 |
|---|---|
| **Box2D / Matter.js / Rapier** | 平台格斗的物理必须逐帧精确可控（击飞衰减、DI、单向平台、抓边），物理引擎的接触解算器会毁掉手感和确定性 |
| **Vue 响应式驱动战斗帧** | `reactive` 的 Proxy 开销在 60fps 下是灾难 |
| **定点数（fixed point）** | 这是 v0.1 的错误建议，已修正。平台格斗用 `float64` + 禁用三角函数，见 10.2 |

---

## 3. 总体架构

### 3.1 分层视图

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
│  │  │ View：插值 → Pixi 精灵 / 特效 / 相机 / 音效        │   │  │
│  │  │      + 物理调试可视化器（开发期）                   │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
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

### 3.2 核心决策：服务端不跑战斗

与拳皇版同理，且**平台格斗更不容忍**：

- 平台格斗的物理比拳皇复杂 4-6 倍，服务端跑一份就等于双倍 CPU 成本 + 双倍 bug
- 帧级判定要求每帧往返，云服务器 RTT（同区域 30-50ms）会把操作延迟推到不可接受
- 所以：**P2P + 回滚**，服务端只做信令、房间、匹配、战绩、输入日志存储

**代价**：无法实时反作弊。缓解方案见 10.6。

### 3.3 七条铁律

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

## 4. 仓库结构

```
fighting/
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ docs/
│  ├─ ARCHITECTURE.md                    ← 本文档
│  └─ archive/ARCHITECTURE-kof-v0.1.md
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
│  │  │  ├─ sim.ts                       # World 结构 + step()
│  │  │  ├─ rng.ts                       # xorshift32
│  │  │  ├─ snapshot.ts                  # Float64Array 快照 序列化/恢复
│  │  │  ├─ checksum.ts
│  │  │  ├─ input.ts                     # 输入编码、缓冲、指令解析
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
│  │     ├─ stages/{final_destination}.json
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
│        ├─ http/middleware/{requireAuth,rateLimit,errorHandler}.ts
│        ├─ security/{argon2.ts,jwt.ts,refreshToken.ts}   # 见第 8 章
│        ├─ ws/{gateway.ts,handlers/{lobby,room,signal}.ts}
│        ├─ services/{auth,session,matchmaking,room,record}.ts
│        ├─ db/{schema.prisma,migrations/,client.ts}
│        └─ redis/keys.ts
│
└─ tools/
   ├─ replay-runner.ts
   ├─ desync-repro.ts
   └─ gen-trig-table.ts                   # 生成三角函数表
```

### 4.1 包依赖规则（eslint 强制）

```
shared      ← 无依赖
battle-core ← shared
netcode     ← battle-core, shared
ai          ← battle-core, shared
client      ← 全部
server      ← shared
```

`battle-core` 的 `tsconfig` 设 `"lib": ["ES2020"]`（不含 DOM），编译期挡住 `document`/`window`。

---

## 5. 战斗内核设计

### 5.1 世界状态

```ts
export interface World {
  frame: number;
  rngState: number;
  phase: MatchPhase;          // INTRO | FIGHT | RESPAWN | GAME_END
  stocks: number[];           // 各玩家剩余命数（v1 长度 2，为 4 人预留）
  activeCount: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  fighters: FighterState[];   // 预留 4 个槽位，用 active 标记
  projectiles: ProjectileState[];
  events: SimEvent[];
}
```

**为什么快照用 `Float64Array`**：可以直接 `set()` 批量拷贝，无需逐字段序列化；且 JS 的 double 是确定的。

### 5.2 角色状态（FighterState）

```ts
export interface FighterState {
  id: number;                 // 0..3
  charId: number;
  active: boolean;            // 是否在场（出局后用 false）

  // —— 位置与速度（单位：逻辑像素/帧）——
  x: number; y: number;
  vx: number; vy: number;
  prevX: number; prevY: number;   // 渲染插值 + 扫掠检测用

  // —— 朝向与地面 ——
  facing: 1 | -1;
  grounded: boolean;
  platformId: number;         // 站在哪块平台上（-1 = 空中）
  ledgeId: number;            // 抓着哪个边缘（-1 = 没抓）

  // —— 状态机 ——
  state: StateEnum;
  stateFrame: number;
  moveId: number;
  moveFrame: number;

  // —— 伤害与资源 ——
  damage: number;             // 伤害百分比 0..999
  jumpsLeft: number;          // 剩余跳跃次数
  airDodgesLeft: number;
  shieldHP: number;           // 盾耐久（满 50）
  shieldstun: number;

  // —— 击飞状态 ——
  hitlag: number;             // 顿帧
  hitstun: number;            // 硬直
  launchAngle: number;        // 击飞角度（整数度）
  launchSpeed: number;        // 当前击飞速度
  diAngle: number;            // DI 输入角度（整数度）

  // —— 输入 ——
  inputBuffer: number;        // 最近帧的按键位（拼接）
  inputHistory: number[];     // 最近 8 帧方向（用于招式方向判定）

  // —— 抓边 ——
  ledgeCooldown: number;      // 抓边冷却
  intangibility: number;      // 无敌帧

  // —— 复活 ——
  respawnTimer: number;
  respawnX: number; respawnY: number;
}
```

### 5.3 帧循环

```ts
export function step(w: World, inputs: InputFrame[]): void {
  w.frame++;

  // 1. 输入入缓冲（顺序：id 升序）
  for (let i = 0; i < w.fighters.length; i++) {
    const f = w.fighters[i];
    if (!f.active) continue;
    f.inputBuffer = ((f.inputBuffer << 8) | inputs[i].bits) >>> 0;
  }

  // 2. 状态机推进（顿帧期间冻结，但仍消耗 hitlag）
  for (let i = 0; i < w.fighters.length; i++) {
    const f = w.fighters[i];
    if (!f.active) continue;
    if (f.hitlag > 0) { f.hitlag--; continue; }
    updateFighter(w, f, inputs[i]);
  }

  // 3. 物理（重力、摩擦、惯性）+ 碰撞
  applyPhysics(w);            // 内部按 id 顺序处理
  resolveCollisions(w);       // 扫掠检测，平台/台壁

  // 4. 抓边检测
  resolveLedges(w);

  // 5. 命中结算（必须在物理之后，用最新坐标）
  resolveHits(w);             // 内部：先 P0 打 P1，再 P1 打 P0，顺序写死
  resolveShields(w);

  // 6. 投射物、复活、相机、对局状态
  updateProjectiles(w);
  updateRespawn(w);
  updateCamera(w);
  updateMatch(w);

  // 7. 清空事件（表现层已消费）
  w.events.length = 0;
}
```

**关键**：所有多对象循环**按 id 升序**，绝不依赖 `Map`/`Set`/`Object` 的遍历。`resolveHits` 必须在**物理之后**，因为命中位置要用最新坐标。

### 5.4 输入系统

#### 采样

```ts
const KEYMAP = {
  left: ['ArrowLeft','KeyA'], right: ['ArrowRight','KeyD'],
  up: ['ArrowUp','KeyW'], down: ['ArrowDown','KeyS'],
  attack: ['KeyJ'], special: ['KeyK'], shield: ['KeyL'],
  jump: ['Space'], grab: ['KeyU'],
};
```

**采样时机**：逻辑帧开始时取瞬时快照，不事件驱动。

#### 编码（2 字节 / 帧）

```
byte0: [L R U D | ATTACK SPECIAL SHIELD]
byte1: [JUMP GRAB | 0 0 0 0 0 0]
```

60 帧/秒 = 120 字节/秒/人，4 人也就 480 字节/秒，忽略不计。

#### 指令解析

平台格斗招式少（不像拳皇要搓招），主要是**方向 + 按键**的组合：

- 地面：`N/前/后/上/下 + 攻击` = 5 种
- 空中：`N/前/后/上/下 + 攻击` = 5 种
- 必杀：`N/前/后/上/下 + 必杀` = 5 种
- 合计：~15 条普通技 + 4 条必杀 = 约 60-80 条帧数据（含落地变体）

**不需要复杂的 236/623 搓招系统**，这是平台格斗相对简单的部分。

#### 缓冲（手感关键）

```ts
// 跳跃缓冲：落地前 3 帧按跳，落地立即起跳
// 攻击缓冲：硬直结束前 3 帧按攻击，硬直一结束立即出招
const BUFFER_FRAMES = 3;
```

这两个缓冲对手感影响巨大，**M1 就要做**。

### 5.5 状态机（~50 状态，表驱动）

```ts
export enum StateEnum {
  // 地面
  Idle = 0, Walk, Crouch, CrouchStart,
  Dash, Run, RunStart, RunStop, Skid,
  JumpSquat, Landing, LandingLag,
  // 空中
  AirIdle, AirJumpStart, AirDodge, AirDodgeLanding,
  Fall, FastFall, AirAttack,
  // 攻击
  AttackGround, AttackAir, AttackLanding,
  // 防御
  Shield, ShieldStun, ShieldBreak, ShieldDrop,
  Roll, SpotDodge, Sidestep,
  // 受击
  Hitstun, HitstunAir, Tumble, Reel,
  Knockdown, Getup, GetupAttack, TechRoll,
  // 抓取
  Grab, GrabVictim, GrabPummel, Throw,
  // 特殊
  LedgeHang, LedgeClimb, LedgeRoll, LedgeAttack, LedgeJump, LedgeDrop,
  // 淘汰
  Dead, Respawn, RespawnWait,
}
```

**每种状态显式声明**：

```ts
interface StateDef {
  id: StateEnum;
  isGrounded: boolean;
  canTurn: boolean;
  canFastFall: boolean;
  hasGravity: boolean;
  /** 允许从此状态转入的状态集合 —— 显式列举，禁止通配 */
  transitions: StateEnum[];
  onEnter?(w: World, f: FighterState): void;
  update(w: World, f: FighterState, input: InputFrame): void;
  onExit?(w: World, f: FighterState): void;
}
```

**转移表检查（开发期断言）**：任何 `setState()` 调用都要先检查目标是否在 `transitions` 里，不在就抛错。这条断言能抓住 90% 的"角色卡住不能动"bug。

```ts
function setState(w: World, f: FighterState, next: StateEnum) {
  const def = STATE_DEFS[f.state];
  if (__DEV__ && !def.transitions.includes(next)) {
    throw new Error(`非法状态转移: ${StateEnum[f.state]} → ${StateEnum[next]}`);
  }
  // ...
}
```

### 5.6 攻击与命中

#### 命中框（Hitbox）

```json
{
  "id": "air_forward",
  "startup": 8, "active": 5, "recovery": 14,
  "landingLag": 12,
  "hitboxes": [
    { "from": 8, "to": 10, "x": 40, "y": -20, "r": 32, "damage": 12,
      "baseKB": 30, "kbGrowth": 100, "angle": 40, "hitlagMul": 1.0,
      "id": 0, "isSakuraiAngle": false }
  ],
  "hurtboxes": [ { "from": 8, "to": 26, "boxes": [ /* ... */ ] } ]
}
```

字段含义见第 6.4 节公式。`isSakuraiAngle`（樱井角）是地面/空中击飞角不同的经典设计。

#### 命中优先级

同帧多 hitbox 命中同一目标时：

1. 取 **hitbox 数组中的索引最小者**（帧数据里把强判定放前面）
2. 同一攻击对同一目标**只结算一次**（用 `moveId + hitboxId` 去重）
3. 双方同帧互中 → **trade**，两边都吃伤害和击飞

#### 顿帧（Hitlag）

```ts
// 命中瞬间双方冻结，帧数由伤害和击飞决定
const hitlag = Math.floor(damage * 0.2 + 1) * hitlagMul;
```

**注意**：顿帧时**发招方和被击方都要冻结**，但冻结帧数可能不同（这会让双方解除时间错开，是连段多样性的来源）。

### 5.7 快照

```ts
export interface Snapshot {
  frame: number;
  data: Float64Array;   // 所有数值状态扁平化
}

const POOL_SIZE = 16;   // ≥ MAX_ROLLBACK + 余量
```

**关键**：

- `save`/`load` 严格对称，用单测保证 `save(load(s)) === s`
- 事件数组**不入快照**（回滚时重放产出）
- 常量（`charId`、`id`）不入快照，初始化时设定

```ts
if (__DEV__) {
  const before = checksum(w);
  const s = pool.acquire(); save(w, s); load(w, s);
  assert(before === checksum(w), 'snapshot roundtrip mismatch');
}
```

### 5.8 校验和

```ts
export function checksum(w: World): number {
  let h = 0x811c9dc5;
  for (const f of w.fighters) {
    if (!f.active) continue;
    h = fnv(h, Math.round(f.x * 1000));   // 量化，过滤无意义尾数
    h = fnv(h, Math.round(f.y * 1000));
    h = fnv(h, Math.round(f.vx * 1000));
    h = fnv(h, Math.round(f.vy * 1000));
    h = fnv(h, f.state);
    h = fnv(h, f.stateFrame);
    h = fnv(h, f.damage);
    h = fnv(h, f.hitstun);
  }
  return h >>> 0;
}
```

**为什么量化**：浮点在不同运算顺序下最后一位可能不同。量化到 1/1000 像素，过滤掉无意义的尾数差异（业界常用做法）。

---

## 6. 物理系统（平台格斗的核心）

> 这一章是 v0.2 相对 v0.1 的最大增量。**80% 的项目风险集中在这里。**

### 6.1 单位约定

| 量 | 单位 | 说明 |
|---|---|---|
| 位置 | 逻辑像素 | 舞台宽 2400，视口 1280×720 |
| 速度 | 像素/帧（60fps） | `vy = 8` 表示每秒 480 像素 |
| 时间 | 帧 | 所有帧数都是整数 |
| 角度 | 整数度 | 查表转换，不用 `Math.sin` |

### 6.2 运动模型

**每帧顺序（严格）**：

```
1. 读输入 → 修改 vx/vy（加速度、摩擦）
2. 应用重力（仅空中）
3. 位置 += 速度  ← 离散积分，会产生穿透风险
4. 碰撞解算（扫掠检测）
5. 落地/平台判定
```

```ts
const GROUND_ACCEL = 0.9;   // 地面加速度
const MAX_WALK = 5.5;       // 步行最大速度
const MAX_RUN = 9.0;        // 奔跑最大速度
const FRICTION = 0.85;      // 无输入时摩擦系数
const AIR_ACCEL = 0.35;     // 空中加速度（空中控制弱）
const AIR_DRAG = 0.99;      // 空中阻力
const GRAVITY = 0.85;       // 重力
const MAX_FALL = 12;        // 最大下落速度
const FAST_FALL_SPEED = 18; // 快速下落速度
```

**惯性（手感来源）**：起跳前的地面速度会保留：

```ts
// 起跳时
f.vy = -FULL_JUMP_VELOCITY;
f.vx = f.vx * 0.9 + inputDir * 2.5;   // 保留 90% 惯性 + 少量空中控制
```

### 6.3 跳跃

| 类型 | 触发 | 特性 |
|---|---|---|
| **短跳** | 按跳 1-2 帧就松开 | 高度 ≈ 全跳的 55% |
| **全跳** | 按跳 > 3 帧 | 标准高度 |
| **二段跳** | 空中再按跳 | `jumpsLeft--`，可改变方向 |
| **快速下落** | 空中按下方向 | `vy = max(vy, FAST_FALL)`，落地有 4 帧硬直 |
| **跳跃硬直** | `JumpSquat` 4 帧 | 帧内不能动，可用来防御 |

```ts
// JumpSquat 阶段检测松键
if (f.state === StateEnum.JumpSquat && !input.jump) {
  f.vy = -SHORT_HOP_VELOCITY;
  setState(w, f, StateEnum.Fall);
}
```

### 6.4 击飞系统

**这是平台格斗的灵魂**，公式来自 Melee 社区逆向成果，作为起点：

```ts
/**
 * @param damage      受击后（含本次伤害）的百分比 0..999
 * @param moveDamage  本次招式伤害
 * @param weight      角色重量（越重越难击飞）
 * @param kbGrowth    击飞成长系数
 * @param baseKB      基础击飞
 * @param damageMul   伤害倍率（1v1 为 1.0）
 * @returns 初始击飞速度（像素/帧）
 */
export function calcKnockback(
  damage: number, moveDamage: number, weight: number,
  kbGrowth: number, baseKB: number, damageMul = 1,
): number {
  const p = damage;
  const d = moveDamage;
  const w = weight;

  let kb = ((((p / 10) + (p * d) / 20) * (200 / (w + 100)) * 1.4) + 18) * kbGrowth + baseKB;
  kb *= damageMul;
  if (kb > 2500) kb = 2500;      // 上限，防止无限连

  return kb * 0.03;               // 击飞值 → 速度
}
```

**击飞角度与衰减**：

```ts
// 角度查表（避免 Math.sin/cos）
f.vx = speed * COS_TABLE[angle];
f.vy = -speed * SIN_TABLE[angle];

// 每帧衰减
f.vx *= 0.051;   // Melee 系衰减近似
f.vy += GRAVITY; // 仍受重力
```

> **衰减系数的实际含义**：`vx *= 0.051` 是每帧乘以 0.051（衰减到 5.1%），不是减 5.1%。这个数是手感调优的主战场，先用能跑的值，再用调试器观察弧线反复调。

**DI（Directional Influence，方向影响）**：

```ts
// 受击瞬间的输入可以偏转击飞角度
const diPerp = inputDir;             // -1 .. 1，垂直击飞方向的分量
const diAngleDelta = diPerp * 18;    // 最多偏转 ±18°

// 将原击飞速度旋转 diAngleDelta 度（查表）
const [nvx, nvy] = rotateByTable(f.vx, f.vy, diAngleDelta);
```

**必须支持 DI**，否则高手会觉得"没法挣扎"，手感很"死"。

### 6.5 碰撞：扫掠 AABB

**最容易出 bug 的地方**。高速击飞时（`vy = 20` 像素/帧），只做"移动后再检测"会**直接穿过 16px 厚的地板**。

解法：**分步推进**。

```ts
export function moveWithCollision(w: World, f: FighterState, dx: number, dy: number) {
  const maxStep = 4;   // 平台厚 16，半厚 8，取 4 保险
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
  const sx = dx / steps, sy = dy / steps;

  for (let i = 0; i < steps; i++) {
    // 先水平后竖直（顺序固定，保证确定性）
    if (!tryMoveX(w, f, sx)) f.vx = 0;
    if (!tryMoveY(w, f, sy)) {
      if (sy > 0) { f.grounded = true; f.platformId = currentPlatform(f); }
      f.vy = 0;
    }
  }
}
```

**平台类型**：

| 类型 | 碰撞行为 |
|---|---|
| `solid` | 四面都挡（台柱、边界墙） |
| `passthrough` | **只在"从上方落下且下落中"时挡住**（单向平台） |
| `ceiling` | 只在上升时挡住（天花板） |

```ts
// 单向平台判定
function canLandOn(p: Platform, f: FighterState, sy: number): boolean {
  if (p.type !== 'passthrough') return true;
  if (sy <= 0) return false;                          // 上升中，穿过
  if (f.prevY + HURTBOX_BOTTOM > p.y) return false;   // 已在平台下方
  if (f.inputDown) return false;                      // 按住下 = 主动穿过
  return true;
}
```

### 6.6 抓边（Ledge）

```ts
function tryGrabLedge(w: World, f: FighterState, ledges: Ledge[]): void {
  if (f.grounded) return;
  if (f.state === StateEnum.HitstunAir) return;   // 硬直中不能抓
  if (f.vy > 0) return;                            // 必须上升或悬停
  if (f.ledgeCooldown > 0) return;                 // 冷却中

  for (const l of ledges) {
    if (distSq(f, l) < GRAB_RADIUS * GRAB_RADIUS && f.facing === l.dir) {
      f.ledgeId = l.id;
      setState(w, f, StateEnum.LedgeHang);
      f.vx = 0; f.vy = 0;
      f.intangibility = 20;      // 无敌帧
      return;
    }
  }
}
```

**抓边后的选择（必须都实现，否则复归毫无深度）**：

| 动作 | 输入 | 说明 |
|---|---|---|
| 上台 | 上 或 盾 | 慢但安全 |
| 滚上 | 向内 + 盾 | 中速，有无敌 |
| 跳起 | 跳 | 快，但暴露 |
| 攻击 | 攻击 | 边缘攻击 |
| 放下 | 下 或 外 | 回到空中 |

**抓边冷却**：离开边缘后 30 帧内不能重抓（防无限挂边）。

### 6.7 出界与复活

```ts
// 出界判定
if (f.x < BLAST_LEFT || f.x > BLAST_RIGHT || f.y > BLAST_BOTTOM || f.y < BLAST_TOP) {
  w.stocks[f.id]--;
  f.active = false;
  w.events.push({ t: 'ko', fighter: f.id });
  f.respawnTimer = RESPAWN_DELAY_FRAMES;   // 100 帧
}
```

复活时站在**复活平台**（可上下移动），有 60 帧无敌，可直接下落开始战斗。

---

## 7. 服务端设计

### 7.1 分层

```
server/src/
  index.ts                 → 启动 HTTP + WS
  http/routes/             → REST（auth、profile、replay）
  http/middleware/         → requireAuth / rateLimit / errorHandler
  security/                → argon2、JWT 签发验签、refresh 旋转（第 8 章）
  ws/gateway.ts            → 连接管理、心跳、首消息鉴权（8.8）
  ws/handlers/             → lobby / room / signal
  services/                → 业务逻辑（无 IO，可单测）
  db/                      → Prisma + MySQL
  redis/                   → 房间态、匹配队列、限流计数
```

### 7.2 房间生命周期

```
创建 → 等待 → 就绪 → 对战中 → 结束 → 销毁
 │      │      │       │        │
 │      │      │       │        └─ 落库战绩 + 回放（MySQL）
 │      │      │       └─ 心跳超时 15s 判负
 │      │      └─ 双方 ready → 下发 seed + 配对信息
 │      └─ 邀请码 6 位 / 匹配命中
 └─ Redis: room:{id} = Hash，TTL 30min
```

### 7.3 匹配

- **v1**：FIFO 队列 + 分数差阈值（初始 200，等待 10s 后放宽到 400）
- **v2**：Glicko-2 + 区域分桶

Redis `ZSET` 存队列，`score = enqueueTime`。

### 7.4 信令

服务端**不解析 SDP**，只转发：

```ts
{ type: 'signal', to: userId, payload: { sdp? } | { candidate? } }
```

TURN（coturn）作为对称 NAT 兜底。

### 7.5 回放存储

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

## 8. 账号系统（注册 / 登录 / 会话）

> 本章回答三个问题：**谁能玩**（身份模型）、**怎么证明是他**（凭证）、**凭证过期了怎么办**（会话生命周期）。

### 8.1 身份模型：游客优先

格斗游戏的第一印象是"能不能马上打一局"。强制注册会把大部分人挡在门外。

| 身份 | 获得方式 | 能做什么 | 限制 |
|---|---|---|---|
| **游客** `is_guest=1` | 打开网页自动创建 | 单人打 AI、本地双人、人机房 | 不能排位；战绩只留最近 20 局；昵称带 `#1234` 后缀 |
| **注册用户** `is_guest=0` | 邮箱 + 密码注册 | 全部功能 | — |
| （v2）第三方 | Steam / Discord / Google OAuth | 同上 | — |

**游客怎么实现**：首次进入时 `POST /api/auth/guest`，服务端建一条 `users` 记录（`is_guest=1`、`password_hash=null`），返回 access token，前端存 localStorage。游客想保留战绩 → 走 8.7 的**原地升级**，不换 `user_id`。

**清理**：定时任务删除 30 天未登录且 `is_guest=1` 的账号。

### 8.2 注册规则

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

### 8.3 密码哈希：argon2id

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

### 8.4 会话：双 Token

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

### 8.5 Refresh 旋转与重放检测

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

### 8.6 数据库表

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

### 8.7 游客原地升级

```
游客 u_7f3a 打了 40 局
  → POST /api/auth/upgrade { email, password, nickname }
  → 同一条 user 记录：is_guest=0，补 password_hash / email / nickname
  → 战绩零迁移
```

⚠️ **坑**：游客昵称是 `玩家#1234`，升级时要重新校验唯一性。若目标昵称被占，返回 `409 NICKNAME_TAKEN`。

### 8.8 WebSocket 鉴权

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

### 8.9 安全清单

| 威胁 | 对策 |
|---|---|
| 暴力破解 | 同 IP 5 次/分钟；同账号连续失败 5 次后指数退避（1s→2s→4s…，上限 5 分钟） |
| 撞库 | 失败信息统一为「账号或密码错误」，不区分账号是否存在 |
| 邮箱枚举 | 注册时"邮箱已存在"仅在**已验证邮箱**时才提示，否则统一返回成功并异步发验证信 |
| 注册刷号 | 同 IP 3 个/小时；异常流量时可挂 hCaptcha |
| Token 泄露 | refresh 旋转 + 重放检测（8.5）；提供「登出所有设备」 |
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

### 8.10 API 一览

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

### 8.11 前端实现要点

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

### 8.12 里程碑影响

账号系统原本被塞在 M7（3 天）里，实际工作量：

| 子任务 | 天 |
|---|---|
| 表 + Prisma 迁移 + collate | 0.5 |
| guest / register / login / refresh / logout | 1.5 |
| 限流 + 安全检查 + 单测 | 1.0 |
| 前端 store + 拦截器 + 守卫 + 3 个页面 | 1.5 |
| WebSocket 鉴权接入 | 0.5 |
| **合计** | **5.0** |

所以 **M7 从 3 天涨到 7 天**（账号 5 + 房间/信令 2），总工期 **33 → 37 天**。

> 想砍的话：v1 只做「游客 + 注册登录」，去掉邮箱验证、找回密码、多设备管理，能压到 3 天。但**刷新 / 旋转 / 重放检测不能省**——省了等于没有安全设计。

---

## 9. 数据库设计（MySQL 8）

### 9.1 建表规范

- 引擎 **InnoDB**
- 字符集 `utf8mb4`，排序规则 `utf8mb4_0900_ai_ci`
- 主键用 `BIGINT UNSIGNED AUTO_INCREMENT`（不用 UUID 做主键，InnoDB 聚簇索引会碎片化）
- 所有表带 `created_at` / `updated_at`
- 时间统一 `DATETIME(3)`，**存 UTC**，展示时转本地时区
- **不用 `FOREIGN KEY` 约束**，用应用层保证（高并发下外键会成为锁瓶颈），但**索引必须建**
- 不用 `ENUM` 类型存业务状态（改枚举要 DDL），用 `TINYINT` + 应用层常量

### 9.2 Prisma Schema

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
  nickname        String    @unique @db.VarChar(32)       // 大小写敏感，见 8.2
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

### 9.3 关键索引

| 表 | 索引 | 用途 |
|---|---|---|
| `users` | `unique(uid)` | 对外查询 |
| `users` | `unique(nickname)` | 昵称唯一（**collate `utf8mb4_0900_as_cs`**，见 8.2） |
| `users` | `idx(rating)` | 排行榜 |
| `user_sessions` | `unique(refresh_token_hash)` | 刷新时的查询入口 |
| `user_sessions` | `idx(user_id, revoked_at)` | 「登出所有设备」/ 重放检测的全量作废 |
| `user_sessions` | `idx(expires_at)` | 过期会话清理任务 |
| `match_players` | `idx(user_id, id DESC)` | 「我的对局」分页 |
| `matches` | `idx(played_at)` | 近期对局、统计 |
| `matches` | `idx(mode, played_at)` | 分模式统计 |

**不要过度索引**：每次写入都要维护索引。`match_rounds` / `match_round_survivors` 的 `unique(match_id, round_no)` / `unique(round_id, slot)` 已覆盖查询需求。

### 9.4 为什么 JSON 字段被改成表

v0.1 里 `Match.rounds Json` 在 PostgreSQL（JSONB + GIN 索引）里很方便。**MySQL 的 `JSON` 类型本身不能建索引**，要索引得用生成列：

```sql
ALTER TABLE matches ADD COLUMN winner_slot TINYINT
  GENERATED ALWAYS AS (JSON_EXTRACT(rounds, '$.winner')) VIRTUAL;
```

能跑，但语义混乱、迁移痛苦。既然定了 MySQL，**明细直接规范化成表**，性能更好、查询更直观（"最近 10 局平均存活命数"一条 SQL 就出）。

### 9.5 Redis Key

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

---

## 10. 确定性与回滚专题

### 10.1 desync 成因（按概率）

| # | 原因 | 占比 |
|---|---|---|
| 1 | 用了三角函数 `Math.sin/cos/pow/atan2` | 40% |
| 2 | 状态没全部进快照（漏字段） | 25% |
| 3 | 用了 `Math.random` / `Date.now` | 20% |
| 4 | 帧数据版本不一致 | 10% |
| 5 | 遍历顺序 / `Set` 迭代 | 5% |

> **v0.1 修正**：`Object.keys` / `Map` / `Set` 的遍历顺序在 ES2015 之后**有规范保证**，不会导致 desync。用数组主要是为了性能和快照序列化。它从 10% 降到 5%（只剩 `for...in` 遍历原型链这种真问题）。

### 10.2 允许 / 禁止清单（重要）

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

### 10.3 eslint 规则

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

### 10.4 快照往返自检

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

### 10.5 回滚流程

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

### 10.6 反作弊（v1 范围）

| 风险 | 对策 |
|---|---|
| 改帧数据（判定框变大） | `rulesetHash` 校验，不匹配拒绝连接 |
| 非法输入 | 回放可复现，异常对局事后审计 |
| 断线逃避 | 心跳超时判负 |

---

## 11. 性能预算

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

## 12. 里程碑

| 阶段 | 内容 | 产出 | 天 |
|---|---|---|---|
| **M0** | Monorepo、CI、Vite、Prisma+MySQL 跑通 | `pnpm dev` 起前后端 | 1 |
| **M1** | 物理原型：重力/跳跃/摩擦/平台碰撞 + **调试可视化** | 一个方块能跑能跳能落台 | 3 |
| **M2** | 击飞系统：公式/DI/弧线/落地反弹 | 能把方块打飞出画面 | 3 |
| **M3** | 完整状态机 + 抓边 + 复活 | 角色能复归回场 | 3 |
| **M4** | Pixi 渲染 + 插值 + 特效 + 相机 | 视觉上像个游戏 | 3 |
| **M5** | 帧数据系统 + 2 角色（各 60-80 招）+ 盾/翻滚/闪避 | 能和 AI 打 | 4 |
| **M6** | AI（感知延迟 + 决策 + 编排） | **单机完整可玩** | 3 |
| **M7** | **账号系统**（游客/注册/登录/刷新/游客升级/WS 鉴权）+ 房间、信令、MySQL 落库 | 能注册登录、能建房、能连上 | 7 |
| **M8** | netcode：回滚、预测、校验和 | **2 人对战打通** | 6 |
| **M9** | 打磨：音效、UI、结算、排行榜 | 可发布 demo | 4 |
| | | **合计** | **37** |

> **建议在 M6 做一次「试玩评审」**：单机版拉三个人来玩，如果手感不过关，此时返工代价最小（还没写联机）。

---

## 13. 风险清单

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| **击飞物理调不好** | **高** | **致命** | M1-M2 先做纯物理原型，没有美术也要调到"手感对"再往下走 |
| 高速穿透 / 卡墙 | 高 | 高 | M1 就上扫掠检测，用调试器可视化轨迹 |
| 回滚 desync | 高 | 致命 | M1 起就写「双实例比对」测试 |
| 状态机混乱（角色卡住） | 高 | 高 | 转移表 + 开发期断言（5.5 节） |
| 帧数据量爆炸（80 招/角色） | 中 | 高 | 表格驱动 + 编辑器工具，或先做 1 个角色打样 |
| 网络环境差（对称 NAT） | 高 | 中 | 提前备 TURN，做 WebSocket 降级 |
| 美术拖进度 | 高 | 中 | 全程色块占位，M8 后才接素材 |
| IP 侵权 | 中 | 法律 | 角色/招式/LOGO 全原创，只借鉴"手感" |
| **账号安全出漏洞**（撞库/会话泄露） | 中 | **高** | 8.9 清单 + refresh 旋转重放检测；上线前跑一遍 OWASP ASVS 前 20 项 |
| 游客数据被清理误伤 | 中 | 中 | 清理任务只删 `is_guest=1 且 30 天未登录`；升级后立刻脱离清理范围 |

---

## 14. 测试策略

### 14.1 三层

| 层 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | 击飞公式、扫掠碰撞、三角函数表、快照往返 |
| 确定性回归 | Vitest | 同输入跑 1000 帧 → hash 一致；带/不带回滚 → hash 一致 |
| E2E | Playwright | 登录 → 匹配 → 对战 → 结算 |

### 14.2 两个必须过的测试

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

### 14.3 网络模拟

```ts
transport.setLatency({ min: 40, max: 90, jitter: 15, loss: 0.02 });
```

手测：Windows 用 `clumsy`，Linux 用 `tc netem`。

---

## 15. 部署拓扑

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

## 16. 待确认的决策

| # | 决策点 | 默认值 | 影响 |
|---|---|---|---|
| D1 | 渲染 | **2D 精灵 + PixiJS** | 若要 3D 角色，换 three.js，工作量 +80% |
| D2 | 人数 | **v1 仅 2 人** | 4 人回滚难度是 2 人的数倍 |
| D3 | 技术动作 | **v1 不做**（无 wavedash / L-cancel） | 做了手感天花板更高，但物理系统要求提高一档 |
| D4 | 场地 | **1 张「终点」（平地 + 2 个旁台）** | 多平台图需要更复杂的碰撞 |
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
export const AIR_ACCEL = 0.35;
export const AIR_DRAG = 0.99;
export const GROUND_ACCEL = 0.9;
export const SHORT_HOP_VELOCITY = 8.5;
export const FULL_JUMP_VELOCITY = 12.5;
export const JUMP_SQUAT_FRAMES = 4;
export const HITSTUN_DECAY = 1;

// —— 击飞 ——
export const KNOCKBACK_TO_SPEED = 0.03;
export const KB_MAX = 2500;
export const DI_MAX_ANGLE = 18;

// —— 网络 ——
export const MAX_ROLLBACK_FRAMES = 7;
export const SNAPSHOT_POOL_SIZE = 16;
export const SYNC_CHECK_INTERVAL = 30;
export const INPUT_DELAY_DEFAULT = 0;

// —— 对局 ——
export const STOCKS = 3;
export const RESPAWN_DELAY_FRAMES = 100;
export const RESPAWN_INVINCIBLE = 60;
```

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
| **Desync** | 双方状态不一致 |
