# 拳皇风格网页格斗游戏 —— 架构设计文档

| 项 | 值 |
|---|---|
| 版本 | v0.1（草案） |
| 日期 | 2026-10-23 |
| 范围 | 前端 Vue3 + 后端 Node.js，浏览器运行，支持 PVP 联机与 vs AI |
| 状态 | 待评审，技术选型已给默认值，可覆盖 |

---

## 0. 阅读指南

这份文档解决四个问题：

1. **代码怎么放** —— 仓库结构、包边界（第 4 章）
2. **每块怎么实现** —— 战斗内核、渲染、网络、服务端、AI 的设计（第 5 章）
3. **双方怎么通信** —— 协议与数据格式（第 6、7 章）
4. **怎么保证不出错** —— 确定性、回滚、测试（第 9、13 章）

如果只看一页，看 **第 3.3 节的五条铁律**。整份文档的所有设计都是为了满足这五条。

---

## 1. 项目定位

### 1.1 目标

| # | 目标 | 验收标准 |
|---|---|---|
| G1 | 单机可玩 | 选角色 → 打 AI → 三局两胜 → 结算，全流程无阻塞 |
| G2 | 手感达标 | 输入到画面反馈 ≤ 1 逻辑帧（16.7ms）；招式帧数据可调 |
| G3 | 联机可打 | 同区域 RTT ≤ 60ms 时，操作无感知延迟（靠回滚） |
| G4 | 可扩展 | 加一个角色只改数据文件，不改引擎代码 |

### 1.2 非目标（明确不做，防止范围爆炸）

- ❌ 2v2 / 3v3 换人制（架构预留，但 v1 不做）
- ❌ 观战 / 回放播放器（录制格式预留）
- ❌ 移动端触屏操作（渲染自适应，但操作不优化）
- ❌ 断线续局（v1 断线即判负）
- ❌ 反作弊的完整方案（v1 只做输入合法性校验）

### 1.3 硬性约束

- 浏览器运行，必须支持 Chrome / Edge / Safari 16+
- 全程 TypeScript，前后端共享类型
- **战斗逻辑必须是确定性的**（第 9 章）—— 这条约束会渗透到每一行模拟代码

---

## 2. 技术选型

### 2.1 定稿表

| 层 | 选型 | 理由 | 备选（何时换） |
|---|---|---|---|
| 构建 | Vite 5 | Vue 官方搭档，HMR 快 | — |
| 前端框架 | Vue 3 + `<script setup>` + TS | 甲方指定 | — |
| 渲染 | **PixiJS 8** | 纯 2D 渲染器，不侵入逻辑；WebGL/WebGPU 自动降级；精灵批处理性能好 | Phaser（想要开箱场景/物理时）；Cocos（有美术用编辑器时） |
| 状态管理 | Pinia | 只管 UI 状态，不进战斗循环 | — |
| UI 组件 | Naive UI | TS 友好、体积可控 | Element Plus |
| 路由 | Vue Router 4 | — | — |
| 后端框架 | **Fastify 4** | 比 Express 快 2-3 倍，Schema 校验内建，TS 友好 | NestJS（团队要 DI/模块化时） |
| WebSocket | **ws** | 无依赖、可控、够用 | uWebSockets.js（单机 1w+ 连接时） |
| 实时传输 | **WebRTC DataChannel** | UDP 语义，正是格斗游戏要的 | WebSocket+TCP（仅作降级） |
| P2P 桥接 | geckos.io 或自写信令 | Node 端做 WebRTC 信令 | 纯 TURN 中继 |
| 缓存/房间 | Redis 7 | 房间态、匹配队列、在线表 | 内存 Map（单机开发期） |
| 持久化 | **PostgreSQL 16** + Prisma | 关系型适合账号/战绩/ELO | SQLite（开发期）；MongoDB（不想写 schema 时） |
| 鉴权 | JWT（access + refresh） | 无状态，横向扩展容易 | Session+Redis |
| 日志 | pino | 结构化、快 | — |
| 测试 | Vitest（单测）+ Playwright（E2E） | — | — |
| Monorepo | pnpm workspace | 包间引用零配置 | Turborepo（构建变慢时） |

### 2.2 三个"别用"

| ❌ 别用 | 原因 |
|---|---|
| **Cocos Creator 的 Vue 集成方案** | 两套渲染循环抢主循环，坑极多 |
| **Box2D / Matter.js 做战斗物理** | 浮点不确定性 + 无法逐帧精确控制 hitbox，格斗游戏必须手写 |
| **Vue 响应式驱动战斗帧** | `reactive` 的 Proxy 开销在 60fps 下是灾难，必须走裸 Canvas |

---

## 3. 总体架构

### 3.1 分层视图

```
┌──────────────────────────────────────────────────────────────┐
│                        浏览器 (Client)                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Vue 3 应用层  （低频：菜单/大厅/房间/结算/HUD）          │  │
│  │  Router · Pinia · Naive UI · API(socket.io? no → fetch) │  │
│  └───────────────┬────────────────────────────────────────┘  │
│                  │ 只通过事件/命令交互，不走响应式热路径        │
│  ┌───────────────▼────────────────────────────────────────┐  │
│  │  Game Runtime （高频：60Hz）                             │  │
│  │  ┌──────────────┐   ┌──────────────┐  ┌─────────────┐  │  │
│  │  │  Loop 固定步长│──▶│  Netcode 回滚 │─▶│ battle-core │  │  │
│  │  │  rAF+累加器   │   │  会话/预测    │  │ 纯函数模拟   │  │  │
│  │  └──────┬───────┘   └──────┬───────┘  └──────┬──────┘  │  │
│  │         │                  │                 │         │  │
│  │         │                  │  SimEvent[]     │ 快照     │  │
│  │  ┌──────▼──────────────────▼─────────────────▼──────┐  │  │
│  │  │ View 层：状态插值 → Pixi 精灵 / 特效 / 相机 / 音效  │  │  │
│  │  └───────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────┬─────────────────────────────────┬──────────────┘
             │ WS (JSON)                       │ WebRTC DataChannel (binary)
             │ 大厅/匹配/信令/结算               │ 输入帧/校验和/心跳
             ▼                                 ▼
┌────────────────────────────┐     ┌───────────────────────────┐
│      Node.js 服务端         │     │      对端浏览器            │
│                            │     │   （P2P，仅传输输入）       │
│  Gateway (HTTP+WS)         │     └───────────────────────────┘
│   ├─ Auth  账号/JWT         │
│   ├─ Lobby 房间/匹配队列     │
│   ├─ Signal WebRTC 信令     │
│   ├─ Match 战绩/ELO         │
│   └─ Replay 输入日志落库     │
│                            │
│  Redis  ← 房间态/在线/队列   │
│  Postgres ← 账号/战绩/回放   │
└────────────────────────────┘
```

### 3.2 关键点：服务端不跑战斗

**这是最重要的一条架构决策。**

格斗游戏业界标准（GGPO 模式）是 **P2P + 回滚**，服务端只做三件事：

1. WebRTC 信令交换
2. 房间 / 匹配 / 结算
3. 保存输入帧日志（用于回放与事后校验）

**为什么不在服务端跑模拟？**

- 帧级判定要求每帧往返，云服务器 RTT 会把操作延迟推到 100ms+，格斗手感直接崩
- 服务端跑模拟只适合"回合制"或"容忍 200ms 延迟"的游戏

**代价**：服务端无法实时反作弊。缓解方案见 9.6。

### 3.3 五条铁律 ★

这五条是整个工程的护城河，违反任何一条都会在后期引发重构级灾难。

| # | 铁律 | 违反的后果 |
|---|---|---|
| **L1** | `battle-core` 零 DOM / 零 Vue / 零 Pixi / 零 `Date.now` 依赖 | 无法在 Node 里跑回归测试，无法服务端校验 |
| **L2** | 模拟层禁止浮点运算，全部用定点整数 | 不同浏览器/平台结果漂移，联机必然 desync |
| **L3** | 渲染层**只读**模拟状态，不允许反向写入 | 回滚重演时状态被污染，无法恢复 |
| **L4** | 所有随机数来自带种子的 PRNG，种子进快照 | 回滚后随机结果不同，desync |
| **L5** | 一个逻辑帧 = 一次 `step()`，与真实时间无关 | 快慢机器上战斗速度不同 |

---

## 4. 仓库结构

```
fighting/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ docs/
│  └─ ARCHITECTURE.md            ← 本文档
│
├─ packages/
│  ├─ shared/                    # 【零运行时依赖】前后端共享
│  │  └─ src/
│  │     ├─ protocol/
│  │     │  ├─ lobby.ts          # 大厅 WS 消息类型（JSON）
│  │     │  ├─ p2p.ts            # 对战二进制消息定义
│  │     │  └─ codec.ts          # 编解码（ArrayBuffer ↔ 结构体）
│  │     ├─ constants.ts         # 帧率、回滚窗口、版本号
│  │     ├─ types.ts             # 角色 ID、输入枚举、战绩结构
│  │     └─ result.ts            # Result<T,E> 工具类型
│  │
│  ├─ battle-core/               # ★ 战斗内核（纯逻辑，可在 Node 跑）
│  │  ├─ src/
│  │  │  ├─ fx.ts                # 定点数运算
│  │  │  ├─ rng.ts               # xorshift32 PRNG
│  │  │  ├─ sim.ts               # World 结构 + step()
│  │  │  ├─ snapshot.ts          # 快照序列化/恢复
│  │  │  ├─ checksum.ts          # 状态哈希
│  │  │  ├─ input.ts             # 输入帧编码/解码、缓冲、指令解析
│  │  │  ├─ fighter/
│  │  │  │  ├─ state.ts          # 状态机（枚举 + 转移表）
│  │  │  │  ├─ stateMachine.ts
│  │  │  │  ├─ motion.ts         # 移动/跳跃/重力/推挤
│  │  │  │  └─ attack.ts         # 招式执行、cancel
│  │  │  ├─ combat/
│  │  │  │  ├─ hitbox.ts         # 包围盒判定
│  │  │  │  ├─ resolve.ts        # 命中结算（伤害/硬直/击退/防御）
│  │  │  │  └─ hitstop.ts        # 顿帧
│  │  │  ├─ camera.ts            # 相机（也进模拟，保证一致）
│  │  │  ├─ event.ts             # SimEvent 定义
│  │  │  └─ loader.ts            # 加载角色帧数据 & 校验
│  │  └─ data/
│  │     ├─ chars/
│  │     │  ├─ aoi.json          # 角色定义
│  │     │  ├─ ken.json
│  │     │  └─ schema.json       # JSON Schema，CI 校验
│  │     └─ stages/
│  │        └─ dojo.json
│  │
│  ├─ netcode/                   # 回滚网络层（依赖 battle-core）
│  │  └─ src/
│  │     ├─ session.ts           # 会话主循环（GGPO 风格）
│  │     ├─ predictor.ts         # 远端输入预测策略
│  │     ├─ rollback.ts          # 回滚重演
│  │     ├─ syncCheck.ts         # 校验和比对
│  │     ├─ clock.ts             # 帧时钟、RTT 估算、自适应延迟
│  │     └─ transport/
│  │        ├─ DataChannel.ts
│  │        └─ WebSocketFallback.ts
│  │
│  ├─ ai/                        # 人机对手（依赖 battle-core）
│  │  └─ src/
│  │     ├─ bot.ts               # 主循环，产出 InputFrame
│  │     ├─ perception.ts        # 带延迟的"看见"
│  │     ├─ planner.ts           # 意图 → 按键序列
│  │     └─ profiles.ts          # 难度档位
│  │
│  ├─ client/                    # Vue3 + Pixi（唯一碰 DOM 的包）
│  │  ├─ index.html
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ App.vue
│  │     ├─ router/
│  │     ├─ views/
│  │     │  ├─ LoginView.vue
│  │     │  ├─ LobbyView.vue     # 匹配/建房/邀请码
│  │     │  ├─ CharSelectView.vue
│  │     │  ├─ BattleView.vue    # ★ 挂载 Pixi 的宿主，空壳
│  │     │  └─ ResultView.vue
│  │     ├─ stores/
│  │     │  ├─ user.ts
│  │     │  ├─ room.ts
│  │     │  └─ settings.ts
│  │     ├─ game/
│  │     │  ├─ GameApp.ts        # 装配：loop + core + net + view
│  │     │  ├─ loop/
│  │     │  │  ├─ FixedStepLoop.ts
│  │     │  │  └─ InputSampler.ts
│  │     │  ├─ render/
│  │     │  │  ├─ Renderer.ts
│  │     │  │  ├─ SpritePool.ts
│  │     │  │  ├─ Camera.ts
│  │     │  │  ├─ StageView.ts
│  │     │  │  ├─ FighterView.ts
│  │     │  │  ├─ FxLayer.ts     # 打击特效
│  │     │  │  └─ HudView.ts
│  │     │  ├─ audio/
│  │     │  └─ input/
│  │     │     ├─ Keyboard.ts
│  │     │     └─ Gamepad.ts
│  │     ├─ api/                 # fetch 封装
│  │     └─ net/
│  │        └─ LobbySocket.ts
│  │
│  └─ server/                    # Node.js
│     └─ src/
│        ├─ index.ts             # 启动、装配
│        ├─ config.ts
│        ├─ http/
│        │  ├─ routes/auth.ts
│        │  ├─ routes/profile.ts
│        │  └─ routes/replay.ts
│        ├─ ws/
│        │  ├─ gateway.ts        # WS 连接管理、心跳、断线
│        │  └─ handlers/
│        │     ├─ lobby.ts
│        │     ├─ room.ts
│        │     └─ signal.ts      # WebRTC SDP/ICE 转发
│        ├─ services/
│        │  ├─ auth.ts           # JWT 签发/校验
│        │  ├─ matchmaking.ts    # ELO 匹配队列
│        │  ├─ room.ts           # 房间生命周期
│        │  └─ record.ts         # 战绩/回放落库
│        ├─ db/
│        │  ├─ schema.prisma
│        │  └─ client.ts
│        └─ redis/
│           └─ keys.ts
│
└─ tools/
   ├─ replay-runner.ts           # CLI：跑回放，输出结果/哈希
   └─ desync-repro.ts            # CLI：随机输入 fuzz，比对哈希
```

### 4.1 包依赖规则（必须用 eslint 强制）

```
shared      ← 无依赖
battle-core ← shared
netcode     ← battle-core, shared
ai          ← battle-core, shared
client      ← 全部
server      ← shared（不依赖 battle-core，除非要做校验）
```

- `battle-core` **禁止** import 任何渲染/网络/DOM 包
- 用 `eslint-plugin-import` 的 `no-restricted-imports` 卡死

---

## 5. 核心模块设计

## 5.1 battle-core：战斗内核

### 5.1.1 世界状态（SoA 布局）

为了快照和回滚，状态必须是**连续的、可 memcpy 的**。不要用 class 实例数组，用扁平数组。

```ts
// sim.ts
export interface World {
  frame: number;
  seed: number;              // PRNG 种子
  rngState: number;          // PRNG 当前状态（xorshift32）
  phase: MatchPhase;         // INTRO | FIGHT | KO | ROUND_END | MATCH_END
  round: number;
  roundTimer: number;        // 逻辑帧计数，不是毫秒
  hitstop: number;           // 全局顿帧剩余帧
  cameraX: number;           // FX
  cameraZoom: number;        // FX
  fighters: FighterState[2]; // 固定 2 个，用数组而非 Map
  projectiles: ProjectileState[]; // 预分配，用 active 标记
  events: SimEvent[];        // 本帧产出，step 结束清空
}

export interface FighterState {
  id: 0 | 1;
  charId: number;
  // 位置
  x: number; y: number;      // FX
  vx: number; vy: number;    // FX
  facing: 1 | -1;
  // 状态机
  state: FighterStateEnum;
  stateFrame: number;        // 当前状态已持续帧数
  moveId: number;            // 当前招式（0 = 无）
  moveFrame: number;         // 招式内的帧
  // 属性
  health: number;
  meter: number;             // 气槽 0..3000
  // 判定
  hitstop: number;
  hitstun: number;
  blockstun: number;
  // 输入
  inputBuffer: number;       // 环形位缓冲，最近 N 帧的按键
  // 连段
  comboCount: number;
  comboScaling: number;      // 伤害衰减
  // 无敌帧
  invuln: number;
  throwInvuln: number;
}
```

**为什么不用 `Map` / `Set` / 对象**：遍历顺序、哈希顺序在不同引擎上不一定一致，且快照要序列化。全部用数组 + 索引。

### 5.1.2 定点数（fx.ts）

**统一格式：Q20.12**，即 12 位小数，`FX_ONE = 4096`。

```ts
export const FX_SHIFT = 12;
export const FX_ONE = 1 << FX_SHIFT;   // 4096

export const fx = (n: number) => (n * FX_ONE) | 0;
export const toNum = (v: number) => v / FX_ONE;

// 加减：直接整数运算
export const fxAdd = (a: number, b: number) => (a + b) | 0;

// 乘：JS 的 double 能精确表示 2^53 内的整数，
// a*b 在 |a|,|b| < 2^26.5 时不会丢精度
export function fxMul(a: number, b: number): number {
  return ((a * b) / FX_ONE) | 0;
}

// 除：先放大再除，同样受 2^53 限制
export function fxDiv(a: number, b: number): number {
  return ((a * FX_ONE) / b) | 0;
}
```

**精度预算**：

| 项 | 值 |
|---|---|
| 分辨率 | 1/4096 逻辑像素（≈0.00024 px） |
| 整数范围 | ±8191 逻辑单位（场地宽 2400，富余） |
| 安全乘除范围 | 操作数绝对值 < 6700 万 |

**禁止清单**（用 eslint 规则 `no-restricted-properties` 拦）：

```ts
Math.sqrt / Math.sin / Math.cos / Math.atan2 / Math.pow
Math.random
Date.now / performance.now
+ - * / 于浮点（除 fx.ts 内部）
```

需要开方/三角函数的地方：**预计算查找表**，或者直接用解析几何的整数近似。

> 例：击退方向 `dx/dy` 用查表，8 方向足够；抛物线跳跃用纯整数积分（每帧 `vy += G`，`y += vy`）。

### 5.1.3 帧循环

```ts
export function step(w: World, inputs: [InputFrame, InputFrame]): void {
  w.frame++;

  // 1. 全局顿帧：命中瞬间双方冻结，但仍推进帧号
  if (w.hitstop > 0) { w.hitstop--; w.events.length = 0; return; }

  // 2. 输入写入缓冲（不直接触发动作，先入 ring buffer）
  for (const f of w.fighters) {
    f.inputBuffer = (f.inputBuffer << 1) | inputs[f.id].bits;
    f.inputBuffer &= 0xffff; // 保留最近 16 帧
  }

  // 3. 状态机推进（顺序固定：0 → 1，绝不依赖遍历顺序）
  updateFighter(w, w.fighters[0], inputs[0]);
  updateFighter(w, w.fighters[1], inputs[1]);

  // 4. 物理
  applyPhysics(w);

  // 5. 推挤（两人重叠时向两侧分离）
  resolvePushbox(w);

  // 6. 命中结算（顺序：先 P0 攻击 P1，再 P1 攻击 P0）
  resolveHits(w);

  // 7. 投射物
  updateProjectiles(w);

  // 8. 相机（也进状态，保证观感一致）
  updateCamera(w);

  // 9. 回合/计时器
  updateMatch(w);
}
```

**关键**：`step` 是**纯函数式**的（输入 World，原地修改），不读任何外部状态。同样的 `(w, inputs)` 永远产出同样的结果。

### 5.1.4 状态机

```ts
export enum FighterStateEnum {
  Idle, WalkF, WalkB, Crouch,
  JumpStart, JumpAir, Land,
  Dash, BackDash,
  Attack,           // 招式执行中（moveId 区分）
  Block, BlockLow,
  Hitstun, Blockstun,
  Knockdown, WakeUp,
  Throw, ThrowVictim,
  GuardBreak,
  KO,
}
```

每个状态有：进入/退出钩子、每帧更新、可转入的状态集合。

```ts
interface StateDef {
  readonly id: FighterStateEnum;
  onEnter?(w: World, f: FighterState): void;
  update(w: World, f: FighterState, input: InputFrame): void;
  canCancelTo?(from: FighterStateEnum): boolean;
  isGrounded: boolean;
  vulnerable: boolean;
}
```

**转向逻辑**：只在 `Idle / WalkX / Crouch` 时允许翻转 `facing`，攻击/受击中锁定。

### 5.1.5 输入系统

#### 采样（客户端）

```ts
const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'],  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],      down: ['ArrowDown', 'KeyS'],
  lp: ['KeyJ'], mp: ['KeyK'], hp: ['KeyL'],
  lk: ['KeyU'], mk: ['KeyI'], hk: ['KeyO'],
};
```

**采样时机**：在逻辑帧开始时取当前按键状态的瞬时快照（**不是事件驱动**）。这样玩家按得再快，也是"这帧按了就算按了"。

#### 编码（1 字节）

```
bit 0: LEFT     bit 4: LP
bit 1: RIGHT    bit 5: MP
bit 2: UP       bit 6: HP
bit 3: DOWN     bit 7: (预留)
```
8 个按键挤 1 字节有点紧，用 **2 字节**更宽松：

```
byte0: [L R U D | LP MP HP | 0]
byte1: [LK MK HK | 0 0 0 0 0]
```
1 帧 = 2 字节，60 帧 = 120 字节/秒/人。极省带宽。

#### 指令解析（波动拳这类）

`InputBuffer` 保留最近 16 帧，用**位掩码匹配**：

```ts
// 236 + P
const MOTIONS = {
  236: [{ fwd: 1, down: 0 }, { fwd: 1, down: 1 }, { fwd: 0, down: 1 }, ...]
};
```

实现思路：维护「方向序列历史」（每帧把当前方向压入，相同时去重），然后用滑动窗口匹配模板，窗口内允许若干帧的"空帧"。

> ⚠️ 这是手感的核心，别一开始就做太严。建议给 3 帧 buffer（前后各留容错）。

#### 联机时的输入确认

玩家本地按的键立即生效（**预测**），但通过 DataChannel 发给对方。对方收到后，如果预测错了，就回滚重来（见 5.4）。

### 5.1.6 碰撞与判定

三套盒子，必须在**逻辑空间**（不是屏幕空间）：

| 盒子 | 用途 | 不参与 |
|---|---|---|
| `pushbox` | 身体碰撞，防止重叠 | 不判命中 |
| `hurtbox` | 被打的判定 | — |
| `hitbox` | 打人的判定 | — |

```ts
interface Box { x: number; y: number; w: number; h: number } // 相对角色原点，FX 单位

// 判定：AABB
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}
```

命中优先级（同一帧多 hitbox 命中时）：

1. 高优先级招式（超必杀 > 必杀 > 普通技）
2. 同优先级取**先出现的 hitbox 索引**
3. 一次攻击对同一目标**只结算一次**（用 `moveId + hitId` 去重）

**判定结果**：

```ts
type HitResult = 'hit' | 'block' | 'whiff' | 'trade';
```

- `hit`：目标处于 non-blocking 状态或站位不匹配（上段打蹲防）
- `block`：目标按住后方向，且姿态匹配
- `trade`：双方同帧命中 → 双方都吃伤害（拳皇特色机制，需要支持）

### 5.1.7 帧数据（数据驱动）

**这是加角色不改代码的关键。** 用 JSON，人类可读，单位是整数逻辑像素。

```json
{
  "id": "aoi_stand_hp",
  "name": "站重拳",
  "cancelInto": ["special", "super"],
  "startup": 9,
  "active": 3,
  "recovery": 18,
  "hitLevel": "mid",
  "damage": 1100,
  "hitstun": 18,
  "blockstun": 12,
  "hitstop": 10,
  "chipDamage": 0,
  "meterGain": { "onHit": 80, "onBlock": 40 },
  "pushback": { "hit": 220, "block": 160 },
  "hitboxes": [
    { "activeFrom": 9, "activeTo": 11, "x": 62, "y": -40, "w": 96, "h": 34, "priority": 1 }
  ],
  "hurtboxes": [
    { "from": 9, "to": 29, "boxes": [{ "x": -14, "y": -96, "w": 52, "h": 96 }] }
  ],
  "sfx": "hit_heavy",
  "anim": "stand_hp"
}
```

**加载时校验**（`loader.ts`）：

- `startup + active + recovery` 必须等于动画总帧数
- `activeTo` 必须落在 actives 区间内
- 所有 `hurtbox` 必须在 `pushbox` 附近（防止出现"永远打不到"的角色）

校验失败**在启动时直接抛错**，不要等到运行时才发现。

### 5.1.8 Cancel 系统

```ts
type CancelCategory = 'normal' | 'command' | 'special' | 'super';

function tryCancel(f: FighterState, move: MoveDef, inputBuf: number): MoveDef | null {
  const inCancelWindow = f.moveFrame >= move.startup;
  if (!inCancelWindow) return null;

  // 只有在命中/被防御后才能取消
  const canCancel = f.connected || move.alwaysCancelable;
  if (!canCancel) return null;

  const next = lookupMove(inputBuf, f.state, move.cancelInto);
  if (!next) return null;

  // 同类不能自我取消，防止无限连
  if (next.category === move.category && move.category !== 'special') return null;
  return next;
}
```

**连段伤害衰减**：

```
damage * max(0.3, 1 - comboCount * 0.1)
```

### 5.1.9 随机数

```ts
// rng.ts
export function nextRand(state: number): [value: number, next: number] {
  let x = state;
  x ^= x << 13; x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;  x >>>= 0;
  return [x, x];
}
```

**种子来源**：房间创建时服务端生成，随 WebRTC 握手消息下发。双方用同一个种子。

**种子进快照**，否则回滚后随机结果不一致。

> 实际战斗中随机数用得很少（几乎只有 AI 和演出效果）。能用确定性逻辑就别用随机。

### 5.1.10 快照

```ts
export interface Snapshot {
  frame: number;
  data: Int32Array;   // 预分配，扁平化所有数值状态
}
```

**设计要点**：

1. **预分配池**：`SnapshotPool(32)`，循环复用，避免 GC
2. **扁平 Int32Array**：一个角色固定占 `FIGHTER_SLOTS` 个槽位
3. **不存的事件**：`events` 数组不入快照（回滚时会重放产出）
4. **`charId` 等常量不存**，只在初始化时设置

```ts
export function save(w: World, s: Snapshot): void {
  const d = s.data;
  d[0] = w.frame; d[1] = w.rngState; d[2] = w.phase;
  d[3] = w.hitstop; d[4] = toFxRaw(w.cameraX);
  let o = HEADER;
  for (const f of w.fighters) { o = writeFighter(f, d, o); }
}

export function load(w: World, s: Snapshot): void { /* 逆操作 */ }
```

**关键**：`save` 和 `load` 必须严格对称，用单元测试保证 `save(load(s)) === s`。

### 5.1.11 状态校验和

```ts
export function checksum(w: World): number {
  let h = 0x811c9dc5;               // FNV-1a 32
  for (const f of w.fighters) {
    h = fnv(h, f.x);   h = fnv(h, f.y);
    h = fnv(h, f.state); h = fnv(h, f.stateFrame);
    h = fnv(h, f.health);
  }
  h = fnv(h, w.rngState);
  return h >>> 0;
}
```

每 30 帧交换一次。不一致 = desync，见 9.4。

---

## 5.2 渲染与表现层

### 5.2.1 循环：固定步长 + 渲染插值

```ts
// FixedStepLoop.ts
const STEP_MS = 1000 / 60;

export class FixedStepLoop {
  private acc = 0;
  private last = 0;
  private rafId = 0;

  start(stepFn: () => void, renderFn: (alpha: number) => void) {
    this.last = performance.now();
    const tick = (now: number) => {
      let delta = now - this.last;
      this.last = now;
      if (delta > 200) delta = 200;   // 切标签页回来，防螺旋
      this.acc += delta;

      let steps = 0;
      while (this.acc >= STEP_MS && steps < 5) {
        stepFn();
        this.acc -= STEP_MS;
        steps++;
      }
      if (steps >= 5) this.acc = 0;   // 追不上就放弃追帧

      renderFn(this.acc / STEP_MS);   // alpha ∈ [0,1)
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
```

**插值**：渲染时用 `prevState` 与 `curState` 按 `alpha` 线性插值：

```ts
const drawX = lerp(prev.x, cur.x, alpha);
```

⚠️ **注意**：插值只用于**画面**，绝不能写回逻辑状态。

### 5.2.2 逻辑与表现的解耦

战斗内核**不碰任何渲染对象**，只产出 `SimEvent`：

```ts
export type SimEvent =
  | { t: 'hit';      attacker: number; victim: number; x: number; y: number; strong: boolean; counter: boolean }
  | { t: 'block';    victim: number; x: number; y: number }
  | { t: 'land';     fighter: number; x: number; y: number }
  | { t: 'moveStart'; fighter: number; moveId: number }
  | { t: 'ko';       victim: number }
  | { t: 'roundEnd'; winner: number };
```

表现层消费事件：

```ts
for (const e of world.events) {
  switch (e.t) {
    case 'hit':   fxLayer.spawnHitSpark(e.x, e.y, e.strong); camera.shake(4); audio.play('hit'); break;
    case 'ko':    camera.freeze(); audio.play('ko'); break;
  }
}
```

**⚠️ 回滚时的坑**：回滚会重放事件，导致特效重复播放。

**解法**：事件带上 `frame`，表现层维护「已处理事件帧集合」，且**只在帧号前进时播特效**：

```ts
if (e.frame <= this.lastFxFrame) continue;  // 重放的旧事件，跳过
```

同时，回滚期间**禁止**触发音效和相机抖动（它们有不可逆的副作用）。

### 5.2.3 渲染层结构

```
Pixi.Application
├─ stage
│  ├─ worldContainer      ← 相机容器（受 cameraX / zoom 影响）
│  │  ├─ bgFar / bgNear   ← 视差
│  │  ├─ floor
│  │  ├─ shadowLayer
│  │  ├─ fighterLayer     ← 精灵 + 骨骼动画
│  │  ├─ projectileLayer
│  │  └─ fxLayer          ← 打击光效、粒子
│  └─ hudContainer        ← 血条/气槽/计时器（屏幕空间，不随相机）
```

**性能要点**：

- 精灵图集一次加载，避免运行时解码
- 使用 `Texture` + `Sprite` 池化，禁止每帧 new
- 阴影用单个半透明椭圆，不要用实时阴影
- 粒子上限 200，超出复用最旧的

### 5.2.4 相机

**相机状态也进 `World`**（因为要保证双方看到同样的画面）。规则：

```
cameraX = clamp(midX(f0, f1), VIEW_W/2, STAGE_W - VIEW_W/2)
cameraZoom = 1.0 → 0.8（两人距离 > 60% 屏宽时拉远）
```

相机变化用**滞后插值**（对数值做四舍五入，避免抖动）。

---

## 5.3 Vue 层职责边界

**原则：Vue 管"页面"，不管"画面"。**

| 归 Vue | 归游戏运行时 |
|---|---|
| 登录/大厅/房间列表 | 战斗渲染 |
| 角色选择界面 | 血条动画（走 Pixi） |
| 设置面板（音量、按键） | 帧同步循环 |
| 结算页、战绩 | 输入采样 |
| Toast、加载进度 | 特效、相机 |

**通信方式**：

```ts
// BattleView.vue —— 一个空壳，只负责挂载和卸载
<template>
  <div ref="hostRef" class="battle-host" />
</template>

<script setup lang="ts">
const hostRef = ref<HTMLDivElement>();
let app: GameApp | null = null;

onMounted(() => {
  app = new GameApp(hostRef.value!, { matchConfig });
  app.start();
});
onBeforeUnmount(() => {
  app?.destroy();   // ★ 必须彻底释放，否则内存泄漏
});
</script>
```

运行时 → Vue 的反向通知只走**事件回调**（结算、血量归零），不走响应式。

---

## 5.4 网络层（netcode）

### 5.4.1 会话状态机

```
IDLE → CONNECTING → HANDSHAKING → SYNCING → PLAYING → FINISHED
                          ↓           ↓
                       FAILED      DESYNC(→ 可尝试恢复)
```

### 5.4.2 握手（HANDSHAKE）

双方必须确认**完全相同的规则**：

```ts
interface HandshakeMsg {
  version: 1;
  rulesetHash: number;   // 所有帧数据的哈希，不一致直接拒绝
  charIds: [number, number];  // 各自的角色（去重排序后比较）
  seed: number;          // 由创建房间方或服务端生成
  inputDelay: number;    // 双方协商的固定延迟（0/2 帧）
}
```

> `rulesetHash` 是救命设计：双方数据版本不一致时**立刻报错**，而不是打 30 秒后莫名 desync。

### 5.4.3 回滚核心流程（GGPO 风格）

```
每帧执行：
┌──────────────────────────────────────────────────┐
│ 1. 采样本地输入 localInput[frame]                │
│ 2. 取远端输入                                    │
│    - 已收到 → 用真实值                            │
│    - 未收到 → 用预测值（默认「重复上一帧」）        │
│ 3. step(world, [local, remote])                  │
│ 4. saveSnapshot(world, frame)                    │
│ 5. frame++                                       │
└──────────────────────────────────────────────────┘

收到远端输入包（含第 F 帧输入）时：
┌──────────────────────────────────────────────────┐
│ if F < currentFrame:                             │
│   if 收到的输入 ≠ 当时预测用的输入:                │
│     ┌─ 回滚 ─────────────────────────────────┐   │
│     │ 1. 记录 latest = currentFrame - 1         │   │
│     │ 2. loadSnapshot(F - 1)                    │   │
│     │ 3. for f = F .. latest:                   │   │
│     │      remote[f] = (f == F) ? 真实 : 预测    │   │
│     │      step(world, [local[f], remote[f]])   │   │
│     │      saveSnapshot(world, f)               │   │
│     └───────────────────────────────────────────┘   │
│                                                  │
│ if F > currentFrame: 缓存到 jitter buffer         │
└──────────────────────────────────────────────────┘
```

### 5.4.4 预测策略

| 策略 | 说明 | 适用 |
|---|---|---|
| `repeatLast` | 复制上一帧输入 | **默认**，最简单也够用 |
| `holdNeutral` | 预测为"无输入" | 保守，回滚率低但会卡 |
| `repeatMotion` | 若正在做波动拳，预测继续 | 手感应更好，实现复杂 |

v1 用 `repeatLast`，从 v2 开始评估 `repeatMotion`。

### 5.4.5 回滚窗口与延迟自适应

```ts
const MAX_ROLLBACK = 7;   // 最多回滚 7 帧（117ms）
const SNAPSHOT_POOL = 16; // 环缓冲，至少 MAX_ROLLBACK + 余量

// 每 60 帧更新一次
function adaptDelay(rtt: number, rollbackRate: number) {
  if (rtt > 90 || rollbackRate > 0.3) return 2;  // 设 2 帧输入延迟
  if (rtt < 50 && rollbackRate < 0.05) return 0; // 取消延迟
  return current;
}
```

**权衡**：加输入延迟能减少回滚（画面更稳），但增加操作延迟（更"重"）。格斗游戏通常 **0-2 帧**。

### 5.4.6 校验和比对

```ts
// 每 30 帧发一次
interface SyncCheckMsg { frame: number; hash: number }

// 收到时
if (msg.frame % 30 === 0 && msg.frame < currentFrame) {
  const local = checksumHistory[msg.frame % HISTORY_SIZE];
  if (local !== msg.hash) onDesyncFound(msg.frame);
}
```

### 5.4.7 传输层

**主路**：`RTCDataChannel`

```ts
const dc = pc.createDataChannel('game', {
  ordered: true,        // 输入必须按序
  maxRetransmits: undefined,  // 可靠（v1 求稳，v2 考虑 unreliable + 自定义重传）
});
dc.binaryType = 'arraybuffer';
```

**降级路**：WebRTC 打洞失败（对称 NAT）→ 自动切到 WebSocket 中继，但延迟会高，需要调整回滚窗口。

**心跳**：每 500ms 一次 ping，计算 RTT，用于自适应延迟。

---

## 5.5 服务端设计

### 5.5.1 进程结构

v1 单进程即可，但**代码按服务拆分**，为将来横向扩展留路：

```
server/src/
  index.ts          → 启动 HTTP + WS
  http/routes/      → REST
  ws/gateway.ts     → WS 生命周期
  ws/handlers/      → 每类消息的处理
  services/         → 业务逻辑（无 IO 依赖，便于测试）
  db/, redis/       → 数据访问
```

### 5.5.2 房间生命周期

```
创建 → 等待 → 就绪 → 对战中 → 结束 → 销毁
 │       │       │        │        │
 │       │       │        │        └─ 落库战绩、写回放
 │       │       │        └─ 双方持续心跳（超时 15s 判负）
 │       │       └─ 双方 ready → 下发 seed + 配对信息
 │       └─ 邀请码 6 位 / 匹配队列命中
 └─ Redis: room:{id} = {state, players, createdAt, ttl}
```

**房间 TTL**：30 分钟自动回收。用 Redis 的 `EXPIRE`。

### 5.5.3 匹配

```
简版（v1）：FIFO 队列 + ELO 差 ≤ 200，10 秒后放宽到 400
复杂版（v2）：Glicko-2 + 区域分桶 + 等待时间惩罚
```

Redis 用 `ZSET` 存队列，score = `enqueueTime`，便于按等待时长取。

### 5.5.4 信令转发

服务端**不解析 SDP**，只做转发：

```ts
// 客户端 A → 服务端 → 客户端 B
{ type: 'signal', to: 'userId', payload: { sdp? } | { candidate? } }
```

TURN 服务器（coturn）作为兜底，配置在 ICE servers 里下发。

### 5.5.5 鉴权

```
POST /api/auth/guest   → { token, refresh }   // 游客登录，v1 够用
POST /api/auth/login   → 账号密码 / OAuth
GET  /api/profile      → 战绩、ELO

WS 连接：query 带 token，握手时校验，失败 close(4001)
```

### 5.5.6 回放存储

**只存输入，不存状态**。这是确定性架构的副产品：

```ts
interface ReplayRecord {
  matchId: string;
  rulesetHash: number;
  seed: number;
  charIds: [number, number];
  inputs: [Uint8Array, Uint8Array];  // 每帧 2 字节
  result: { winner: number; rounds: [] };
  durationFrames: number;
}
```

一场 90 秒的对局 ≈ 90×60×4 = 21.6KB。极其便宜，可以全量存。

回放播放 = 重新跑一遍 `battle-core`，速度任意。

---

## 5.6 AI（人机）

### 5.6.1 核心思想：AI 就是一个"本地玩家"

```ts
interface InputSource {
  sample(frame: number, world: World): InputFrame;
}

class RemoteSource implements InputSource { ... }   // 网络
class LocalSource  implements InputSource { ... }   // 键盘
class FixtureSource implements InputSource { ... }  // 录制回放
class AISource     implements InputSource { ... }   // ★ AI
```

**好处**：AI 与联机走完全相同的代码路径，不需要为 AI 开特例。AI 对战时也是 60Hz 出 2 字节输入。

### 5.6.2 决策管线

```
感知（带延迟） → 局势评估 → 意图选择 → 动作编排 → 按键序列
```

**感知延迟**是难度的核心：

```ts
class Perception {
  private history: World[] = [];   // 环形，保留 60 帧

  see(delayFrames: number): World {
    return this.history[this.history.length - 1 - delayFrames];
  }
}
```

AI 看到的永远是 `delayFrames` 帧前的世界。人类选手的反应时间约 12-16 帧，所以：

| 难度 | 反应延迟 | 决策频率 | 失误率 |
|---|---|---|---|
| 简单 | 24 帧 | 每 12 帧 | 35% |
| 普通 | 16 帧 | 每 8 帧 | 15% |
| 困难 | 10 帧 | 每 5 帧 | 5% |
| 大师 | 6 帧 | 每 3 帧 | 1% |

> ⚠️ **不要用"AI 伤害翻倍"来提升难度**，玩家能立刻感知到作弊，体验极差。

### 5.6.3 动作编排

AI 决定"我要放波动拳"后，需要把意图翻译成按键序列：

```ts
// 236 + HP，分 7 帧发出
const PLAN_236HP = [
  { down: true,  frames: 1 },     // 2
  { down: true, right: true, frames: 2 }, // 3
  { right: true, frames: 1 },     // 6
  { hp: true, frames: 1 },        // P
  { neutral: true, frames: 2 },
];
```

编排器输出 `InputFrame` 队列，与人类输入完全同构。

---

## 6. 协议设计

### 6.1 大厅（WebSocket，JSON）

```ts
// c2s
type ClientMsg =
  | { t: 'auth'; token: string }
  | { t: 'match.join'; mode: 'ranked' | 'casual' }
  | { t: 'match.cancel' }
  | { t: 'room.create'; isPrivate: boolean }
  | { t: 'room.join'; code: string }
  | { t: 'room.ready'; charId: number }
  | { t: 'signal'; to: string; payload: SdpPayload }
  | { t: 'room.leave' };

// s2c
type ServerMsg =
  | { t: 'authed'; user: UserBrief }
  | { t: 'match.found'; roomId: string; opponent: UserBrief; serverSeed: number }
  | { t: 'room.state'; room: RoomState }
  | { t: 'room.start'; config: MatchConfig }
  | { t: 'signal'; from: string; payload: SdpPayload }
  | { t: 'match.result'; result: MatchResult }
  | { t: 'error'; code: string; message: string };
```

**为什么大厅用 JSON 而对战用二进制**：大厅消息低频、字数多、要可读可调试；对战消息高频、字数少、要极致省带宽。两套分开，各取所长。

### 6.2 对战（DataChannel，二进制）

**消息头**：`[u8 type][payload]`

| type | 名称 | 载荷 |
|---|---|---|
| `0x01` | `INPUT` | `u32 frame, u8 count, u8[] bytes` （count × 2 字节） |
| `0x02` | `SYNC` | `u32 frame, u32 hash` |
| `0x03` | `PING` | `u32 seq, u32 timestamp` |
| `0x04` | `PONG` | `u32 seq, u32 timestamp` |
| `0x05` | `HELLO` | JSON 手握手（仅一次） |
| `0x06` | `READY` | — |
| `0x07` | `BYE` | `u8 reason` |

**INPUT 批处理**：每帧发一次太浪费。改为**每 2-3 帧发一次**，攒 2-3 帧的输入一起发，减少包头开销。代价是增加 1 帧延迟，需要权衡。

> 推荐：**每帧发**（16.7ms 一次，包才 8 字节），简单可靠。只有实测带宽吃紧再改批处理。

### 6.3 编解码

```ts
export function encodeInput(frame: number, bits: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 4 + 1 + bits.length * 2);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, 0x01);
  v.setUint32(o, frame); o += 4;
  v.setUint8(o++, bits.length);
  for (const b of bits) { v.setUint16(o, b); o += 2; }
  return buf;
}
```

`DataView` 比手写位运算慢一点，但**可读性 >> 性能**在这里。这条路每秒只走 60 次。

---

## 7. 数据模型

### 7.1 Prisma Schema（核心表）

```prisma
model User {
  id        String   @id @default(cuid())
  nickname  String   @unique
  password  String?          // null = 游客
  elo       Int      @default(1000)
  wins      Int      @default(0)
  losses    Int      @default(0)
  createdAt DateTime @default(now())
  matches   MatchPlayer[]
}

model Match {
  id         String   @id @default(cuid())
  seed       Int
  rulesetHash Int
  charIds    String   // "1,3"
  winner     Int
  rounds     Json     // 每回合的胜负与剩余血量
  durationFrames Int
  replayBlob Bytes?   // 输入日志，gzip
  playedAt   DateTime @default(now())
  players    MatchPlayer[]
}

model MatchPlayer {
  id       String @id @default(cuid())
  matchId  String
  match    Match  @relation(fields: [matchId], references: [id])
  userId   String
  user     User   @relation(fields: [userId], references: [id])
  slot     Int    // 0 | 1
  charId   Int
  eloDelta Int
}
```

### 7.2 Redis Key 设计

| Key | 类型 | TTL | 用途 |
|---|---|---|---|
| `online:{userId}` | String | 60s | 在线心跳 |
| `room:{roomId}` | Hash | 30min | 房间状态 |
| `roomcode:{code}` | String | 30min | 邀请码 → roomId |
| `mmq:ranked` | ZSet | — | 匹配队列（score=入队时间） |
| `mmq:casual` | ZSet | — | 休闲队列 |

---

## 8. 关键流程

### 8.1 完整对战生命周期

```
玩家A                服务端                玩家B
  │                    │                    │
  │── room.create ────▶│                    │
  │◀── room.state ─────│                    │
  │                    │◀─── room.join ─────│
  │── room.ready ─────▶│                    │
  │                    │◀─── room.ready ────│
  │◀── room.start ─────│────room.start ────▶│   (含 seed, charIds)
  │                    │                    │
  │── signal(offer) ──▶│─── signal(offer) ─▶│
  │◀─ signal(answer) ──│◀── signal(answer) ─│
  │──── ICE 交换 ──────│────  ICE 交换 ─────│
  │                    │                    │
  │═══════ DataChannel 直连建立 ════════════│
  │── HELLO ───────────────────────────────▶│
  │◀────────────────────────────── HELLO ──│
  │── READY ───────────────────────────────▶│
  │◀────────────────────────────── READY ──│
  │                    │                    │
  │═════════ 60Hz 回滚同步对战开始 ═════════│
  │── INPUT(f0..f5) ───────────────────────▶│
  │◀───────────────────── INPUT(f0..f5) ───│
  │── SYNC(f30) ───────────────────────────▶│
  │                    │                    │
  │══════════════════ 对局结束 ═════════════│
  │── result ─────────▶│◀─────── result ────│
  │◀── match.result ───│──── match.result ─▶│
```

### 8.2 一次回滚的时序

```
帧号:     100   101   102   103   104   105
本地输入:  ✓     ✓     ✓     ✓     ✓     ✓
远端输入:  ✓     ✗     ✗     ✗     -     -     ← 网络卡了 3 帧
预测值:    ✓     P     P     P
执行:      ✓     P     P     P     ← 画面已经走了

[远端包到达：101 的真实输入 ≠ P]
         ↓
回滚到 100 → 重放 101,102,103 → 恢复
         ↓
视觉效果：画面"跳"了一帧（但比卡住 3 帧好得多）
```

视觉跳动是回滚的固有代价，可以通过**插值平滑**（对 3 帧内的偏移做缓动）掩盖，但会增加显示延迟。v1 先不做。

---

## 9. 确定性与回滚专题 ★

### 9.1 为什么会 desync（按概率排序）

| # | 原因 | 占比 |
|---|---|---|
| 1 | 用了浮点（`/`、`Math.*`） | 45% |
| 2 | 用了 `Math.random` / `Date.now` | 20% |
| 3 | 状态没全部进快照（漏了某个字段） | 15% |
| 4 | 遍历顺序不稳定（`Object.keys`、`Set`、`Map`） | 10% |
| 5 | 帧数据版本不一致 | 10% |

### 9.2 编码层面的防御

**eslint 规则**（`battle-core` 包强制）：

```jsonc
{
  "rules": {
    "no-restricted-properties": ["error",
      { "object": "Math", "property": "random" },
      { "object": "Math", "property": "sqrt" },
      { "object": "Math", "property": "sin" },
      { "object": "Math", "property": "cos" },
      { "object": "Date", "property": "now" }
    ],
    "no-restricted-globals": ["error", "performance", "window", "document"]
  }
}
```

**TypeScript 层面**：给 `battle-core` 单独一个 `tsconfig`，`"lib": ["ES2020"]`（不含 `DOM`），编译期就能挡住 `document` 的使用。

### 9.3 快照完整性自检

写一个**开发期断言**（生产环境关掉）：

```ts
// 在 save/load 之后对比
if (__DEV__) {
  const before = checksum(w);
  const s = pool.acquire();
  save(w, s);
  load(w, s);
  const after = checksum(w);
  assert(before === after, `snapshot roundtrip mismatch at frame ${w.frame}`);
}
```

这一条断言能抓住 90% 的"漏字段"问题。

### 9.4 desync 检测与处理

```
检测到 hash 不一致
  ↓
1. 记录 frame 号，双方 log 出来对比
2. 尝试"用对方快照恢复"（需要平时就交换快照，可选）
3. 若无法恢复 → 判平局 / 判发起方胜（取决于产品策略）
4. 上报 desync 指标（哪个规则导致、哪个角色、哪个招式）
```

**v1 策略**：直接终止对局，提示"网络不同步，请重开"，同时上报埋点。不追求自动恢复。

### 9.5 为什么要这么多约束

因为**回滚的本质**是：把状态倒回去，用新的输入重新跑一遍，期望得到完全相同的中间状态。

只要有任何一处"跑了两次结果不一样"，回滚就会把错误的状态固化下来，并且**错误会随时间指数累积**。所以确定性不是"最好有"，而是"必须有"。

### 9.6 反作弊（v1 范围）

| 风险 | v1 对策 |
|---|---|
| 改帧数据（攻击范围变大） | `rulesetHash` 校验，不匹配直接拒绝连接 |
| 注入非法输入（如同时按 L+R） | 服务端不校验，但**回放可复现**，异常对局可事后审计 |
| 断线逃避 | 心跳超时判负 |

真正的服务端校验（重放整局）留到 v2，成本高但可行。

---

## 10. 性能预算

| 指标 | 目标 | 说明 |
|---|---|---|
| 逻辑 step 耗时 | < 0.5ms | 一帧的全部计算 |
| 渲染耗时 | < 8ms | 留一半余量给 60fps |
| 首屏加载 | < 3s | 图集按需加载 |
| 战斗包大小 | < 2.5MB | 2 角色 + 1 场景 |
| 内存占用 | < 200MB | 快照池 + 图集 |
| 单帧网络包 | < 32B | 输入 + 心跳 |
| 回滚重演 | 7 帧 < 3.5ms | 保证不卡 |

**监控**：开发期在 HUD 角落显示 FPS / step 耗时 / 回滚次数 / RTT。上线时用 `?debug=1` 打开。

---

## 11. 里程碑

| 阶段 | 内容 | 产出 | 预估 |
|---|---|---|---|
| **M0** | 仓库骨架、monorepo、CI、Vite 跑通 | `pnpm dev` 能起前后端 | 0.5 天 |
| **M1** | `battle-core`：fx、循环、状态机、移动跳跃 | 两个方块能走能跳 | 2 天 |
| **M2** | 攻击、hitbox、命中结算、硬直、顿帧 | 两个方块能互殴、有伤害 | 2 天 |
| **M3** | Pixi 渲染 + 插值 + 特效 + 相机 | 视觉上像个游戏了 | 3 天 |
| **M4** | 帧数据系统 + 2 个角色 + cancel | 能打连招 | 3 天 |
| **M5** | AI（感知延迟 + 决策 + 编排） | 单机完整可玩 ✅ | 2 天 |
| **M6** | 服务端：账号、房间、信令 | 能建房、能连上 | 3 天 |
| **M7** | netcode：回滚、预测、校验和 | 两人能打完一整局 ✅ | 5 天 |
| **M8** | 打磨：音效、UI、结算、战绩 | 可发布 demo | 4 天 |

**总计 ≈ 25 个工作日**（单人全职）。M5 结束就是一个可以拿出去给人玩的版本，**建议先做到 M5 再评估**。

---

## 12. 风险清单

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| 回滚实现出 bug 导致 desync | 高 | 致命 | 从 M1 就写「双实例比对」测试，越早越好 |
| 网络环境差（校园网/对称 NAT） | 高 | 联机不可用 | 提前准备 TURN 中继，做降级路径 |
| 美术资源拖进度 | 高 | 延期 | 全程用色块/矩形占位，M7 之后才接真素材 |
| 帧数据平衡性差 | 中 | 可玩性低 | 数据外置，快速迭代，做个"调试模式"直接改数值 |
| 移动端兼容 | 中 | 部分用户流失 | 明确不支持触屏，只做自适应布局 |
| IP 侵权 | 中 | 法律风险 | 角色/招式名/LOGO 全部原创，只借鉴"手感" |

---

## 13. 测试策略

### 13.1 三层测试

| 层 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | fx 运算、PRNG、碰撞、快照往返 |
| 确定性回归 | Vitest + 自定义 | **同一输入序列跑 1000 帧，比对最终 hash** |
| E2E | Playwright | 登录→匹配→对战→结算 |

### 13.2 确定性回归（最重要）

```ts
// __tests__/determinism.test.ts
it('同一输入序列产出相同结果', () => {
  const inputs = generateFuzzInputs(1000, seed);
  const a = runSim(1, inputs);
  const b = runSim(1, inputs);
  expect(a.finalHash).toBe(b.finalHash);
});

it('回滚后状态一致', () => {
  const inputs = generateFuzzInputs(600, seed);
  const w1 = runStraight(inputs);          // 一路跑到底
  const w2 = runWithRollback(inputs, 7);   // 频繁回滚
  expect(checksum(w1)).toBe(checksum(w2));
});
```

第二条测试**是 go/no-go 的门槛**。它过不了，联机一定炸。

### 13.3 网络模拟

- 开发期：代码里注入人为延迟/丢包
  ```ts
  transport.setLatency({ min: 40, max: 90, jitter: 15, loss: 0.02 });
  ```
- 手测：Windows 用 **clumsy**，或用 `tc netem`（Linux）

---

## 14. 部署拓扑

```
                    ┌─────────────┐
    玩家 ──HTTPS───▶│  Nginx/CDN  │──── 静态资源（Vue 打包产物）
                    └──────┬──────┘
                           │ /api /ws
                    ┌──────▼──────┐
                    │  Node 服务   │  ← PM2 / Docker
                    │  (Fastify)  │
                    └──┬───────┬──┘
                       │       │
              ┌────────▼──┐  ┌─▼─────────┐
              │  Redis    │  │ Postgres  │
              └───────────┘  └───────────┘

    玩家A ══════ WebRTC P2P ══════ 玩家B
                    │
              ┌─────▼──────┐
              │  coturn    │  ← NAT 穿透失败的兜底（UDP 3478/5349）
              └────────────┘
```

**部署注意**：

- coturn 必须开放 **UDP 3478 + UDP 49152-65535**
- 云服务器（阿里云/腾讯云）安全组默认只开 TCP，**UDP 要手动加规则**，这是最常见的坑
- HTTPS 是 WebRTC 的硬要求（`getUserMedia` 可以不要，但 DataChannel 在大部分浏览器上需要安全上下文）

---

## 15. 待你确认的决策

| # | 决策点 | 默认值（本文档采用） | 影响 |
|---|---|---|---|
| D1 | 渲染引擎 | PixiJS 8 | 若想更快出效果可用 Phaser |
| D2 | 联机范围 | 先锁步后回滚？**不** —— 直接上回滚 | 回滚工作量大，但绕不开 |
| D3 | 角色数量（v1） | 2 个 | 4 个则帧数据量翻倍 |
| D4 | 回合制 | 三局两胜，99 秒 | — |
| D5 | 美术方案 | 先用色块占位 | 决定 M3 之后能否推进 |
| D6 | 部署 | 本地 + 局域网优先 | 公网需要域名 + 服务器 + TURN |

---

## 附录 A：常用常量

```ts
export const LOGIC_FPS = 60;
export const STEP_MS = 1000 / 60;

export const VIEW_W = 1280;
export const VIEW_H = 720;
export const STAGE_W = 2400;
export const FLOOR_Y = 0;

export const MAX_ROLLBACK_FRAMES = 7;
export const SNAPSHOT_POOL_SIZE = 16;
export const SYNC_CHECK_INTERVAL = 30;

export const INPUT_BUFFER_FRAMES = 16;
export const INPUT_DELAY_DEFAULT = 0;

export const ROUND_TIME_FRAMES = 99 * 60;
export const ROUNDS_TO_WIN = 2;
export const METER_MAX = 3000;
```

## 附录 B：关键术语

| 术语 | 含义 |
|---|---|
| **Rollback** | 回滚网络同步，预测远端输入，错误时倒回重算 |
| **Desync** | 双方模拟状态不一致 |
| **Hitbox / Hurtbox** | 攻击判定框 / 受击判定框 |
| **Startup / Active / Recovery** | 招式的启动帧 / 有效帧 / 收招帧 |
| **Cancel** | 在特定帧取消当前招式转入下一招，连招的基础 |
| **Hitstop / 顿帧** | 命中瞬间双方冻结若干帧，打击感的来源 |
| **Pushbox** | 身体碰撞框，防止两人重叠 |
| **Frame Data** | 帧数据，每个招式的逐帧参数 |
| **Input Buffer** | 输入缓冲，记录最近若干帧的按键 |
