# 战斗系统与物理内核

> 项目：平台格斗游戏（大乱斗式） · 所属：[架构设计总纲](./00-overview.md)
>
> 版本 v0.10.5 ｜ 2026-10-24 ｜ 系列：1 总纲 + 8 专题

本文件描述 `packages/battle-core`：一个纯逻辑、帧确定、Node 可跑的模拟内核。角色如何运动由物理决定（第 4 章），角色如何行动由状态机决定（见 [角色操作与动画设计](./01-characters.md)）。

---

## 1. 战斗系统的边界

这一份文档描述的是 `packages/battle-core` —— **一个纯粹的、确定性的、可以在 Node 里跑的模拟内核**。

它不知道浏览器存在，不知道 Pixi 存在，不知道 Vue 存在。给定「初始世界状态 + 一串输入」，它永远产出同一串世界状态。这条性质是联机回滚、AI 训练、回放重演、单元测试全部成立的前提。

### 1.1 输入输出

```ts
// 唯一的入口
export function step(w: World, inputs: InputFrame[]): void;

// 唯一的出口（渲染层消费）
export interface SimEvent {
  type: 'hit' | 'block' | 'shieldbreak' | 'dropthrough' | 'ko' | 'land' | 'jump' | 'ledge' | 'respawn';
  frame: number;
  a?: number;        // 涉及的角色槽位（0..3）
  b?: number;
  value?: number;    // 伤害、击飞强度等
  x?: number; y?: number;
}
```

`SimEvent` 是**只读的表现层事件**，渲染层拿它播特效、放音效。事件在每帧末尾被清空（见 3 节帧循环第 7 步），所以渲染层必须在当帧消费完。

### 1.2 一帧之内不许有"以后"

这是最容易违反、也最难查的一条：**所有结算必须在当帧完成**。

反例：某招式命中后设置 `pendingKnockback = 300`，下一帧再应用。看起来无害，但回滚重演时这一帧可能被重算两次，`pendingKnockback` 就会累积。所有跨帧的中间状态都会被回滚放大成 bug。

正例：命中当帧直接改 `f.vx / f.vy / f.hitstun`，不留任何"待处理队列"。

### 1.3 本章结构

| 节 | 内容 |
|---|---|
| 2 | 世界状态的数据结构（含投射物 / 可破坏平台 / 场地事件三类运行时状态） |
| 3 | 帧循环的执行顺序（顺序本身是设计的一部分） |
| 4 | 物理：单位、运动、跳跃、击飞、碰撞、抓边、出界复活、**下蹲与变形盾**、**冲刺与空中冲刺**、**冲刺攻击**、**连击放大与击倒** |
| 5 | 快照 |
| 6 | 校验和 |

角色状态结构（`FighterState`）、输入系统、状态机、攻击帧数据见 [角色操作与动画设计](./01-characters.md)。确定性规则（哪些 `Math` 函数禁用）见 [服务端与联机](./05-server.md) 第 3 章。

---

## 2. 世界状态

```ts
export interface World {
  frame: number;
  rngState: number;
  phase: MatchPhase;          // INTRO | FIGHT | RESPAWN | GAME_END
  stage: StageDef;            // 只读数据（平台/出界/事件定义）
  plats: PlatState[];         // ★ 平台运行时状态：破坏/重生/移动。物理只看这个
  stocks: number[];
  activeCount: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  fighters: FighterState[];   // 预留 4 个槽位，用 active 标记
  projectiles: ProjectileState[];
  hazards: HazardState[];     // ★ 场地事件的运行时状态（周期/相位/是否激活）
  events: SimEvent[];
  nextProjId: number;         // ★ 投射物 id 自增，进快照
}
```

**为什么要 `plats` 而不能直接读 `stage.platforms`**：可破坏平台会被打碎再重生，
位置还会被 `moveAmp` 带动横移。这些都是**模拟状态**，必须进快照、进校验和。
把 `StageDef` 当只读模板、`PlatState` 当运行时实例，是这一层唯一的正确切法——
如果物理去读 `stage.platforms`，联机时两边会出现"我这边平台碎了你还站在上面"。

`ProjectileState` 的关键字段：

```ts
export interface ProjectileState {
  id: number; kind: SpecialKind; owner: 0 | 1;
  x: number; y: number; vx: number; vy: number;
  w: number; h: number; damage: number; angle: number;
  kbGrowth: number; baseKB: number;
  life: number;        // 剩余存活帧，归零即销毁
  gravity: number;     // 0 = 直线（箭），>0 = 抛物线
  grounded: boolean;   // 已落地（香蕉皮/陷阱用）
  fuse: number;        // 引信：>0 时倒数，归零爆炸（炸弹用）
  spent: boolean;      // 已用掉（命中或爆炸后置位，同帧不再重复命中）
  arm: number;         // 布防倒计时（陷阱用，>0 时不可触发）
  facing: 1 | -1;
}
```

`MAX_PROJECTILES = 24` 是硬上限：超了就**丢弃最老的那颗**而不是拒绝新的。
理由是先发出的箭已经飞了 1 秒、快要打中人了，丢掉它比让玩家按不出来更糟。

**为什么快照用 `Float64Array`**：可以直接 `set()` 批量拷贝，无需逐字段序列化；且 JS 的 double 是确定的。

---

## 3. 帧循环

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
  // 命中与格挡在同一次遍历里判完（铁律 L6：一帧一次 step，命中同帧结算），
  // 不再有独立的 resolveShields——盾是命中结算的一个分支，见 §4.8.4
  resolveHits(w);             // 内部：先 P0 打 P1，再 P1 打 P0，顺序写死

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

### 3.1 对局结束后：世界冻结，但表现帧继续

真实实现里 `step()` 的第一句不是 `w.frame++`，而是先判结束：

```ts
export function step(w: World, inputs: [InputState, InputState]): void {
  if (w.over) {
    w.frame++          // 只为背景火星、齿轮转速、迷雾这些动画
    w.events.length = 0
    return             // 比赛逻辑一概不跑
  }
  w.frame++
  ...
```

两个字段分工，不能混：

| 字段 | 结束后是否前进 | 用途 |
|---|---|---|
| `w.frame` | **是** | 背景/特效的动画相位；调试面板的"逻辑帧" |
| `w.endFrame` | **否**（停在结束那一帧，`-1` 表示未结束） | **一切计时**：结算用时、对局时长、回放长度 |

**为什么必须分开**（这是一次真实 bug）：结算页的"用时"原本写的是 `w.frame / 60`，而 `w.frame` 在结束后仍在涨，
于是胜利浮层上的计时一直往上跳 —— 玩家看到的是"打完了还在计时"。修法不是让 `frame` 停
（那样背景会僵住），而是把"比赛时钟"单独冻在 `endFrame` 上：两个结束点（KO 与时间耗尽）都在置
`over = true` 的同时写 `w.endFrame = w.frame`。

同一条规则适用于所有"对局结束还要继续播"的东西：**表现可以借 `frame`，计时只能读 `endFrame`。**

---

## 4. 物理系统（平台格斗的核心）

> 这一章是 v0.2 相对 v0.1 的最大增量。**80% 的项目风险集中在这里。**

### 4.1 单位约定

| 量 | 单位 | 说明 |
|---|---|---|
| 位置 | 逻辑像素 | 舞台宽 2400，视口 1280×720 |
| 速度 | 像素/帧（60fps） | `vy = 8` 表示每秒 480 像素 |
| 时间 | 帧 | 所有帧数都是整数 |
| 角度 | 整数度 | 查表转换，不用 `Math.sin` |

### 4.2 运动模型

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

### 4.3 跳跃

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

### 4.4 击飞系统

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

  // 击飞值 → 速度。v0.4.0 由 0.03 校准为 0.09：0.03 是 Melee 单位制下的系数，
  // 本项目 1 单位 = 1 逻辑像素、角色高 64，尺度差约 3 倍。
  // 实测 0.03 时 100% 伤害只飞 46px（打不出 420px 的台边），
  // 0.09 时台边 120% 可 KO、台中央 200% 可 KO。
  return kb * KNOCKBACK_TO_SPEED;
}

/** 受击硬直：与击飞值挂钩，不是固定值。见 01 第 9 章连段表 */
export function calcHitstun(kb: number): number {
  return Math.max(HITSTUN_MIN, Math.floor(kb * HITSTUN_RATIO));
}
```

`calcKnockback` 返回的是**基础击飞值**。真正灌进速度的是 §4.11 的双乘数：

```ts
const kb = Math.min(KB_MAX, calcKnockback(...) * comboMul * dmgMul)
const speed = kb * KNOCKBACK_TO_SPEED
```

`dmgMul` 就是文档参数 `damageMul`（1v1 为 1.0）在本项目的落地——只是它不是常驻 1.0，
而是随受击方伤害百分比在 200% 之后爬升。这样"1v1 倍率"这个槽位就没浪费。

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

### 4.5 碰撞：扫掠 AABB

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
function canLandOn(p: Platform, f: FighterState, sy: number, dropTimer: number): boolean {
  if (p.type !== 'passthrough') return true;
  if (dropTimer > 0) return false;                    // 刚蹲跳穿下来，14 帧内不再被同一块接住
  if (sy <= 0) return false;                          // 上升中，穿过
  if (f.prevY + HURTBOX_BOTTOM > p.y) return false;   // 已在平台下方
  return true;
}
```

**穿下平台 = 蹲 + 跳**（不是"按住下就走下去"）。这样设计有三个理由：

1. **按住下已经用来防御了**，如果同时又是"掉下去"，防守时会误掉。
2. 蹲跳是一个明确的、有前摇的动作（`jumpSquat` 4 帧），对手能预判并惩罚——掉平台是风险不是福利。
3. `DROP_THROUGH_FRAMES = 14` 的免接住窗口，保证不会"刚穿下去又被同一块平台接住"这种抖动。
   14 帧内如果落到了下层平台，正常接住；14 帧后回到普通判定。

实心台（`solid`）上蹲跳只是普通跳——判定只对 `passthrough` 生效。

### 4.6 抓边（Ledge）

抓边是平台格斗的**复归命门**：被打出去之后唯一能自救的窗口。所以它的判定要**刻意宽松**——
玩家在被击飞的混乱里无法精确对位，严判等于直接判死。

```ts
interface LedgeRef { platId: number; x: number; y: number; side: Facing }

export function findLedge(w: World, f: Fighter): LedgeRef | null {
  if (f.onGround || f.knockedDown) return null
  if (f.ledgeCd > 0 || f.ledgeLock > 0) return null
  for (const p of w.plats) {
    if (p.broken || !p.grabbable) continue
    const top = p.y
    const dy = f.y - top
    if (dy < 4 || dy > C.LEDGE_GRAB_Y) continue          // 太低/太高都抓不到
    if (Math.abs(f.x - p.x) <= C.LEDGE_GRAB_X) return { platId: p.id, x: p.x, y: top, side: -1 }
    if (Math.abs(f.x - (p.x + p.w)) <= C.LEDGE_GRAB_X) return { platId: p.id, x: p.x + p.w, y: top, side: 1 }
  }
  return null
}
```

参数：`LEDGE_GRAB_Y = 46`（台面下方 4–46px 这一带都能抓）、`LEDGE_GRAB_X = 26`
（左右各 26px 横向容差）、`LEDGE_COOLDOWN = 40`、`LEDGE_INVINCIBLE = 30`、`LEDGE_CLIMB_FRAMES = 16`、
> **v0.10.1 修了一个 bug：上爬会站到空中。** 原实现 `f.x = l.x + l.side * 18` 是**往外**移
> （左沿 side=-1 → 再往左 18px），人落在台面外却仍被置 `onGround = true`，于是悬在空中。
> 现在两处修正：① 朝**内侧**移 `l.side < 0 ? p.x + inset : p.x + p.w - inset`（`inset` 取
> `min(22, max(8, w*0.35))`，窄台也不会穿到对侧）；② 用**当前**平台而不是抓取时缓存的坐标——
> 悬挂期间平台可能被击碎或横移，用旧坐标同样会落到台外。台没了就松手往下掉，绝不置 `onGround`。
`LEDGE_RELEASE_LOCK = 30`。

**抓住之后的状态**：

| 行为 | 输入 | 结果 |
|---|---|---|
| 上爬 | `jump`（或 `up`） | 16 帧后 `x = l.x + side*18, y = l.y, onGround = true`，产出 `climb` 事件 |
| 松手 | `down` | `releaseLedge(f, lock=true)`，30 帧内不能重抓 |
| 悬挂 | 无输入 | 位置锁死不下坠，无敌 30 帧 |

**抓住瞬间要做四件事**：清速度、**补满跳跃与空中冲刺**、给 `invincible = 30`、产出 `ledgegrab` 事件。
补满跳跃这点容易被漏掉——不补的话玩家抓住了也爬不上来（没跳），等于白抓。

**被打中必须掉边**：`applyHit` 在受击方 `f.ledge !== null` 时调用 `releaseLedge(def, true)`。
不这么写的话，挂在边上会一直带着 30 帧无敌白嫖，形成"挂边无敌流"。

**为什么不用「必须朝向台边」这条限制**：原型里刻意去掉了朝向要求。
玩家被打飞时 `facing` 由最后一次输入决定，加朝向条件会让"明明抓到了却没抓住"变成常发抱怨。
宽松的代价是偶尔"背对着也抓上了"——这个代价远小于严判带来的挫败感。

#### 4.6.1 抓边必须由玩家发起，而不是系统自动完成

第一版只判"位置对得上"，结果玩家报了一个非常典型的 bug：

> 「我站在边缘按下会触发攀爬，起来后还会有空中行走的 bug」

「按下」= 按下方向键 `down`，也就是**下蹲/下穿**的输入。而 `down` 在悬挂态里的语义是"松手"。
两套语义撞在一起，玩家体验到的就是"我按了个下，人自己抓住台沿又爬上来了"。

现在抓边有三条门槛：

```ts
if (
  !f.onGround &&
  !f.knockedDown &&
  f.ledgeCd <= 0 &&
  f.ledgeLock <= 0 &&
  f.climbTimer === 0 &&
  f.vy >= -0.5 &&            // ← 正在下降或刚到顶点
  !inputs[f.index]!.down     // ← 没按着"下"
) { ... }
```

| 门槛 | 拦住什么 |
|---|---|
| `vy >= -0.5` | 往上蹿时不该粘住台边（否则上挑打成"贴边滑行"） |
| `!down` | 按着下还想抓人，会让人以为按键失灵；下方向的语义专属"下穿/松手" |
| `ledgeCd / ledgeLock / climbTimer` | 松手后的 30 帧锁定、上爬过程中不得重抓 |

#### 4.6.2 一个隐蔽的 `onGround` 漏洞（"空中行走"）

同一个反馈里的"空中行走"是另一个独立 bug，根因在落地判定的 `else` 分支：

```ts
// 错误写法
} else if (f.y < 0 || f.vy !== 0) {
  const support = ...   // 有台面就保持 onGround
  if (!support) f.onGround = false
}
```

主台的顶面就在 `y = 0`。站着不动时 `y < 0` 不成立、`vy !== 0` 也不成立，
于是整个分支被跳过，`onGround` 永远是 `true`——**走出台边那一刻不会离地**，
角色可以直接在空中走、在空中蹲。

正确写法是无条件复查支撑点，判据只剩"脚底有没有台面"：

```ts
} else {
  const support = w.plats.some(
    (p) => !p.broken && inX(p, f.x) && Math.abs(f.y - topOf(p)) < 0.6 && p.type !== 'ceiling',
  )
  if (!support) f.onGround = false
}
```

这条同时解释了为什么"攀爬之后"特别容易复现：上爬把角色送到 `y = 0`（正好是那个失效点），
玩家接着往回走，就必然踩中这个漏洞。

**回归断言**（`tools/check-combat.mjs` 第 32–34 组）：

```
✓ 走出台边后离地                 离地帧数=27
✓ 离地后确实在下坠               y=233.3
✓ 按着下不会抓边                 ledge=null
✓ 不按下时仍会自动抓边           ledge=ok
✓ 攀爬结束站在台面上             onGround=true
✓ 落在台面横向范围内             x=728.0
✓ 站得住（不飘在空中）           y=0.0
```

### 4.7 出界与复活

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

### 4.8 下蹲与变形盾

防御不是一个独立动作，是**下蹲的副产品**：按住下方向就蹲下，蹲下就撑起盾。
这一节讲清楚三件事——盾的几何、判定怎么写、以及为什么它必须几何化。

#### 4.8.1 下蹲先改的是受击框

```ts
function hurtBox(f: FighterState) {
  const h = f.crouching ? CROUCH_HEIGHT : 64;   // 40 vs 64
  return { l: f.x - 17, r: f.x + 17, t: f.y - h, b: f.y };
}
```

受击框从 64 高压到 40，等价于**头顶那 24 像素不该被打中**。这是下蹲最原始的收益：
对手的上挑（判定框中心在 `y-60`）会直接从你头顶划过去。

代价固定且唯一：**完全不能移动**（`speedScale = 0`）。不加"蹲着能慢慢挪"，
否则蹲防就没有成本，整局会退化成两个蹲着的角色对峙。
蹲着按攻击会自动起身出招——`down + attack` 就是下段攻击，这是"从防御转进攻"的唯一出口。

#### 4.8.2 盾是一个圆，不是一个数

```ts
function shieldRadius(f: FighterState): number {
  const ratio = clamp01(f.shield / SHIELD_MAX);
  return SHIELD_RADIUS_MIN + ratio * (SHIELD_RADIUS_MAX - SHIELD_RADIUS_MIN);  // 20 → 34
}
function shieldCenter(f: FighterState): { x: number; y: number } {
  const h = f.crouching ? CROUCH_HEIGHT : 64;
  return { x: f.x, y: f.y - h / 2 };   // 受击框的中心
}
```

盾满时半径 34，盾空时 20。**这个圆是真的参与判定的**，不是画着好看的装饰。

#### 4.8.3 判定：重叠区的四个角都在圆内才挡住

```ts
function shieldCovers(f: FighterState, hb: Box): boolean {
  const hurt = hurtBox(f);
  // 1. 先求「攻击框 ∩ 受击框」
  const ox1 = Math.max(hb.l, hurt.l), ox2 = Math.min(hb.r, hurt.r);
  const oy1 = Math.max(hb.t, hurt.t), oy2 = Math.min(hb.b, hurt.b);
  if (ox1 >= ox2 || oy1 >= oy2) return false;

  // 2. 重叠区的四个角，是否都在盾圆内
  const c = shieldCenter(f), r = shieldRadius(f), r2 = r * r;
  for (const p of [{x:ox1,y:oy1},{x:ox2,y:oy1},{x:ox1,y:oy2},{x:ox2,y:oy2}]) {
    const dx = p.x - c.x, dy = p.y - c.y;
    if (dx * dx + dy * dy > r2) return false;
  }
  return true;
}
```

**为什么不用"攻击框和盾圆相交就算挡住"**——那是这一节唯一需要想明白的地方。
用相交判定的话，盾圆哪怕缩到 8 像素也永远挡得住（只要攻击框边缘擦到圆边就算），
盾值就退化回一根血条，几何化白做。用**重叠区的四个角**去比，效果是：

| 盾值 | 半径 | 结果 |
|---|---|---|
| 50（满） | 34 | 盖得住蹲姿受击框四角（对角距约 25.7），全部招式挡下 |
| 约 30 | 28 | 仍然挡得住大部分，但从正上方来的上挑开始漏 |
| 约 22 | 26 | **临界点**——侧前方来的平击（重叠区最远角在盾圆侧缘）开始漏 |
| 10 | 23 | 只剩正下方的下砸和贴身短招还能挡 |
| 0 | 20 | 什么都挡不住 |

临界点约在盾值 44%（22/50），这是刻意的：**盾值高时防御是绝对安全的，低时才开始漏**，
而漏的顺序由招式方向决定 —— 侧前平击先漏、正下下砸后漏，
于是"用哪个方向的招去拆盾"变成一个有答案的问题。玩家看 HUD 那颗球就知道还剩多少安全余量。

#### 4.8.4 命中结算的三个分支

```ts
if (def.crouching && shieldCovers(def, hb)) {
  // A. 完全挡下：不扣血，只扣盾
  def.shield -= m.damage * SHIELD_DAMAGE_MUL + SHIELD_DAMAGE_BASE;
  kb *= SHIELD_KB_MUL;              // 推力只有命中的 28%——贴盾压制
  hitlag = Math.floor(hitlag * 0.7); // 顿帧也短
  if (def.shield <= 0) breakShield(def, w);
  push({ type: 'block', ... });
} else if (def.crouching) {
  // B. 蹲着但盾没盖住：漏招，额外扣一点盾再照常吃伤害
  def.shield -= m.damage * SHIELD_LEAK_DRAIN;
  if (def.shield <= 0) breakShield(def, w);
  /* 落到 C 分支 */
} else {
  // C. 正常命中
}
```

分支 B 是关键设计：它让"盾太小"的惩罚是**渐进的**——漏招时既掉血又掉盾，
比"要么全挡要么全吃"更有压迫感，也让残盾状态变成真正的危险区。

#### 4.8.5 破盾

```ts
function breakShield(f: FighterState, w: World) {
  f.crouching = false;
  f.shield = 0;
  f.shieldBreakStun = SHIELD_BREAK_STUN;   // 150 帧 = 2.5 秒
  f.attackFrame = -1;
  f.hitstun = 0;
  f.combo = 0;
  w.events.push({ type: 'shieldbreak', ... });
}
```

眩晕 150 帧，期间**不能蹲、不能防、不能动**，挨打照样进伤害百分比。
解晕时只恢复 `SHIELD_BREAK_RESET = 22` 点盾（约四成）——**如果此时被继续压制，
再来两下就会第二次破盾**。这是"盾值管理"的最后一环：连续破盾是可以被杀死的。

#### 4.8.6 恢复

| 参数 | 值 | 含义 |
|---|---|---|
| `SHIELD_MAX` | 50 | 满盾 |
| `SHIELD_DRAIN` | 0.08/帧 | 举盾的自然消耗（约 10 秒撑满一整管） |
| `SHIELD_REGEN_DELAY` | 22 帧 | 收盾后多久开始恢复 |
| `SHIELD_REGEN` | 0.42/帧 | **约 1.6 秒从空回满** |
| `SHIELD_DAMAGE_MUL` + `BASE` | ×1.1 + 2 | 挡一下扣多少盾 |

恢复速度定在"1.6 秒回满"是权衡的结果：太慢（旧值 0.18/帧 ≈ 4.6 秒）会让一次破盾
直接决定整条命，太快（<1 秒）会让压制毫无意义。1.6 秒大约是一次完整追击的时长——
**撑得住一次压制，撑不住两次**。

---

### 4.9 冲刺与空中冲刺

冲刺是**位移即资源**：它既是进攻起手（冲刺中按攻击变成冲刺攻击），也是唯一的复归手段。

```ts
/* 冲刺推进：速度从 DASH_SPEED 线性衰减到 DASH_END_SPEED */
if (f.dashTimer > 0) {
  const k = f.dashTimer / Math.max(1, f.dashFramesTotal)
  f.vx = f.dashDir * (C.DASH_END_SPEED + (f.dashSpeedTotal - C.DASH_END_SPEED) * k)
  f.dashTimer--
  if (f.dashTimer === 0) f.landLag = C.DASH_ENDLAG
} else if (
  controllable && f.jumpSquat === 0 && !attacking && f.ledge === null &&
  f.climbTimer === 0 && inp.dashPressed && f.dashCd <= 0 &&
  (f.onGround || f.airDashes > 0)
) {
  const hdir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0)
  const ddir = hdir !== 0 ? (hdir > 0 ? 1 : -1) : f.facing
  f.dashDir = ddir
  f.facing = ddir
  f.crouching = false
  const airMul = f.onGround ? 1 : C.AIR_DASH_MUL      // 空中冲刺弱 18%
  f.dashSpeedTotal = C.DASH_SPEED * (f.char.dashSpeedMul ?? 1) * airMul
  f.dashFramesTotal = Math.max(4, Math.round(C.DASH_FRAMES * (f.char.dashFramesMul ?? 1) * airMul))
  f.dashTimer = f.dashFramesTotal
  f.dashCd = f.char.dashCooldown ?? C.DASH_COOLDOWN   // 起手立刻上冷却
  if (!f.onGround) {
    f.airDashes--
    f.vy = Math.min(f.vy, 0)      // ★ 抹掉下坠速度
    f.fastFalling = false
  }
}
```

| 参数 | 值 | 说明 |
|---|---|---|
| `DASH_SPEED` | 17 | 起冲速度（≈ MAX_RUN 的 1.9 倍） |
| `DASH_FRAMES` | 14 | 持续帧数 |
| `DASH_END_SPEED` | 6.5 | 收尾速度（衰减到这个值再交给摩擦） |
| `DASH_COOLDOWN` | 26 | 地面冷却（角色可覆盖：20/26/32） |
| `DASH_ENDLAG` | 5 | 冲完的硬直帧 |
| `AIR_DASH_MUL` | 0.82 | 空中冲刺的速度与帧数都乘这个 |
| `DASH_ATTACK_GLIDE` | 0.9 | 冲刺攻击保留的前冲速度比例 |

**`f.vy = Math.min(f.vy, 0)` 这一行是"飞回擂台"能不能成立的关键。** 玩家被打到屏幕下方时
`vy` 是正的（在下落），如果只改 `vx`，重力会在几帧内把冲刺变成"横向飘一下然后继续掉"。
把 `vy` 抬到 0（不是负数——不该变成额外跳跃）配合 0.82 的空中系数，才有"斜着飞回去"的手感。

**冷却必须起手即扣**：写成"冲刺结束后开始计冷却"会导致连按重复起冲——
因为结束那一帧 `dashTimer` 归零，下一帧就满足条件了。这是原型第一版实测出来的 bug。

**落地重置 `airDashes`**：`f.airDashes = f.char.airDashes ?? 1`，写在落地判定里。
所以"被打出去 → 空中冲刺一次 → 落地 → 可以再冲"是允许的，惩罚来自**出界扣命**而不是次数耗尽。

### 4.9.1 八方向冲刺（v0.10.1）

冲刺方向取**世界绝对方向**，不是朝向相对方向：

```ts
export const DASH_UNIT = {
  right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1],
  upRight: [0.7071, -0.7071], upLeft: [-0.7071, -0.7071],
  downRight: [0.7071, 0.7071], downLeft: [-0.7071, 0.7071],
} as const

export function pickDashDir(inp: InputState, facing: Facing): DashDirName {
  const h = inp.left && !inp.right ? -1 : inp.right && !inp.left ? 1 : 0
  const v = inp.up && !inp.down ? -1 : inp.down && !inp.up ? 1 : 0
  if (h === 0 && v === 0) return facing > 0 ? 'right' : 'left'
  if (v === 0) return h < 0 ? 'left' : 'right'
  if (h === 0) return v < 0 ? 'up' : 'down'
  if (v < 0) return h < 0 ? 'upLeft' : 'upRight'
  return h < 0 ? 'downLeft' : 'downRight'
}
```

三条设计要点：

1. **为什么是绝对方向而不是"前/后"**：玩家被打到场外右侧、想往左飞回来时按的是「左」。如果按朝向相对解释，「左」在背对台面时会变成「后」，人反而飞得更远 —— 复归手段变成了自杀键。
2. **八个方向的单位向量硬编码**，不调 cos/sin（铁律 L2）。斜向用 `0.7071` 字面量，长度天然为 1，所以斜冲的总速度与正交冲刺一致，不再额外乘一次 √2。
3. **冲刺期间不加重力**：否则上冲被重力吃掉一半、平冲提前变坠，八方向就退化成「四个方向都能冲但都不准」。上冲实测 6 帧上升 83px。

`Fighter` 里存的是 `dashVecX` / `dashVecY` 两个数字，不是枚举名 —— 快照里就是两个标量，不用像 `attackDir` 那样为字符串另开一条通道。

### 4.9.2 场外复归冲刺（v0.10.3：三种燃料互斥）

被击出场外后，冲刺变成**复归手段**，规则有三条不同：

| 项 | 场内 | 场外 |
|---|---|---|
| 速度 | `DASH_SPEED × 角色系数 × AIR_DASH_MUL` | 再 × `OFFSTAGE_DASH_MUL 1.9` |
| 持续帧 | `DASH_FRAMES × 角色系数 × AIR_DASH_MUL` | 再 × `OFFSTAGE_DASH_FRAMES_MUL 1.4` |
| 冷却 | 角色系数（砺 26 / 葵 20 / 肯 32 帧） | × `OFFSTAGE_DASH_CD_MUL 0.3`（8 帧量级） |
| 可用次数 | 消耗 1 次空中冲刺（角色 1–2 次） | **只能消耗复归次数**（`RECOVERY_DASHES = 1`） |
| 空中次数 | 消耗 1 次 | **不消耗**，但也不允许"用空冲次数代替"——见下面的三种燃料 |
| 何时恢复 | 落地 | **回到战斗场地范围内即补满**（不必等落地，但必须在非击飞、非倒地状态） |

一次场外复归的实际位移：场外 **330px**、场内空冲 212px（同一角色同一方向，差 1.56 倍）。

**三种燃料互斥（`dashFuelOf`）**：冲刺花的是哪一种资源，由"人站在哪"唯一决定。

```ts
export function dashFuelOf(w: World, f: Fighter): 'ground' | 'air' | 'recovery' | null {
  if (f.onGround) return 'ground'                    // 场地地面：免费，只受冷却约束
  if (isOffstage(w, f)) return f.recoveryDashes > 0 ? 'recovery' : null  // 场外：只认复归次数
  return f.airDashes > 0 ? 'air' : null              // 场内空中：只认空冲次数
}
```

这条函数是"冲刺不能无限"的唯一保证。**第一版写的是「场外不消耗空冲次数」，看似大方，实际留下了后门**：
场外的空冲次数从没被扣过，复归那一次用掉之后，玩家还能靠残留的 1–2 次空冲继续往台面飞 ——
场外冲刺依然是无限的，"谁都掉不下去"根本没解决。测试也没抓到，因为测试里把 `airDashes` 手动设成了 0，
正好绕开了这个后门。现在两种燃料严格互斥：场外若没有复归次数，**返回 `null`，按冲刺键什么都不会发生**。

**为什么必须是「一次性」（v0.10.2 起）**：第一版场外冲刺可以一直冲，结果是**谁都掉不下去** ——
玩家被击飞出场后只要按住方向+冲刺就能无限次往台面方向挪，出界淘汰机制直接失效，整局变成
"谁先失误不重要，反正都回得来"。复归是容错，不是第二条命。

**恢复时机为什么是「回到场地」而不是「落地」**：冲刺回来的时候人往往还在台面上方几帧才落地，
如果非要等落地才回满，玩家会觉得"我已经回来了却还在罚我"。判据因此是
`!isOffstage(w,f) && hitstun <= 0 && !knockedDown`。反过来，**击飞途中横穿场地上空不算回到场地**
（`hitstun > 0` 不恢复），否则被从左边打飞、飘过场地上空就白拿一发复归。

**一次够不够**：够。`1.9 × 17 × 1.4` 帧的速度与时长，从主台外沿到最远复归点约 330px 一冲即回；
如果一冲还不够，说明这一击的击飞值本来就该终局 —— 那正是想要的结果。

「在场外」的判据（`isOffstage`）刻意宽松：

```ts
export function isOffstage(w: World, f: Fighter): boolean {
  if (f.onGround) return false
  const e = stageExtent(w)  // 所有未碎平台的横向外沿与最低顶面
  return f.x < e.minX - 30 || f.x > e.maxX + 30 || f.y > e.bottom + 220
}
```

- 只看「横向出了平台外沿」或「掉到所有平台之下」，**不看高度**——跳得高不是罪。
- 留 30px 宽容带，避免站在台边时被误判成「场外」（那会让普通冲刺白送 1.9 倍速度）。
- `onGround` 直接返回 false，省掉一次遍历。

**为什么单次却更强**：场外这一冲的速度 ×1.9、时长 ×1.4、冷却缩到 30%，且不占空中冲刺次数 ——
它比任何普通冲刺都强，但一生只有一次。这样「还有办法回来」和「回不来就是回不来」同时成立：
进攻方打出高质量击飞时，对手能不能活取决于这一冲的角度与时机，而不是能不能一直按。
若这一冲还回不来，说明击飞值已经足够，那正是淘汰该发生的时候。

### 4.10 冲刺攻击

冲刺中按攻击，出招换成 `DASH_MOVES` 那一套（见 [01 角色 §6.11](./01-characters.md)），
并把剩余冲刺速度的 0.9 倍当"前冲"灌进 `vx`，形成"冲拳"的合成位移。

```ts
if (inDashWindow && inp.attack && !inp.special && !inp.special2) {
  f.dashAttack = true
  f.attackKind = 'normal'
  f.attackDir = pickAttackDir(inp, f.facing)
  f.vx = f.dashDir * Math.max(Math.abs(f.vx), C.DASH_SPEED * DASH_ATTACK_GLIDE)
  f.dashTimer = 0                       // 冲刺立即终止，交给攻击的帧数据接管
  w.events.push({ type: 'dashattack', ... })
}
```

**为什么 `dashTimer = 0`**：不归零的话冲刺推进与攻击位移会同时写 `vx`，
后执行的那个覆盖前一个，招式位移变成"看代码顺序"的偶然行为。

**冲刺收招的硬直更重**（`DASH_ENDLAG = 5` vs 普通 `LAND_LAG_FRAMES = 3`），
因为冲刺攻击的伤害与判定框都更大（中性 10%→13%、boxW 44→56、前伸 34→42），
必须有一个可被惩罚的窗口，否则"冲上去无脑 A"就是最优解。

### 4.10.1 顿帧与落地硬直：两个"非数值"的手感参数

这两条不是平衡参数，是**打击感**参数。它们的取值不影响谁赢，只影响"赢起来爽不爽"。

```ts
// 命中顿帧：轻击 4 帧、重击最多 9 帧
const lag = Math.min(HITLAG_MAX, HITLAG_FRAMES + Math.floor(dmg / 6))
def.hitlag = lag
atk.hitlag = lag

// 落地硬直：按落地速度取 2–6 帧
f.landLag = Math.max(LAND_LAG_MIN, Math.min(LAND_LAG_MAX, Math.round(fallSpeed / 3)))
```

- **顿帧随伤害增长**：固定 4 帧时，15% 的重击和 8% 的轻击"停"的时间一样，玩家不看伤害数字分不出轻重。顿帧是格斗游戏里最便宜的打击感来源 —— 它不改任何数值，只改时间。
- **落地硬直随落地速度**：固定 3 帧时"从高空砸下来"和"小跳落地"手感完全一样，跳的价值折半。

### 4.11 连击放大与击倒

这两个机制是"高百分比必须被打死"的技术实现。

**连击放大（同一方连续命中）**：

```ts
atk.combo++                      // 命中即累加
atk.comboExpire = C.COMBO_EXPIRE // 90 帧内没有新命中就清零
const comboMul = Math.min(1 + (atk.combo - 1) * C.COMBO_KB_PER_HIT, C.COMBO_KB_MAX)  // 1 + 0.14n，封顶 1.2

def.maxComboTaken = Math.max(def.maxComboTaken, atk.combo)
```

**高伤加成（受击方伤害百分比过高）**：

```ts
const overDmg = Math.max(0, def.damage - C.COMBO_DMG_GATE)          // 超过 200% 的部分
const dmgMul = Math.min(1 + (overDmg / 100) * C.COMBO_DMG_PER_100, 1 + C.COMBO_DMG_MAX)  // 封顶 1.9
```

**两者相乘**：`kb = min(KB_MAX, kbRaw * comboMul * dmgMul)`，最大 `1.2 × 1.9 = 2.28`。

这叫**双乘数而非加法**，是刻意的：加法（+0.2+0.9=×2.1）会让两个机制互相稀释，
乘法让"高伤 + 连段"这个组合特别致命、而单独一个都不至于秒杀。这就是
"200% 之后如果被多次连击，会被快速击飞到场外"的精确实现——不是一条特殊规则，
是两个乘数在 200% 以上的自然结果。

| 参数 | 值 | 说明 |
|---|---|---|
| `COMBO_KB_PER_HIT` | 0.14 | 每段连击加 14% 击飞 |
| `COMBO_KB_MAX` | 1.2 | 连击加成封顶（约 3 段就到） |
| `COMBO_DMG_GATE` | 200 | 超过这个伤害百分比才开始加成 |
| `COMBO_DMG_PER_100` | 0.45 | 每超 100% 加 45% |
| `COMBO_DMG_MAX` | 0.9 | 高伤加成封顶 |
| `COMBO_EXPIRE` | 90 | 连击判定窗口（1.5 秒） |

**击倒（Knockdown）**：伤害过了角色自己的门槛、且正处于连击里，再被击中就倒地。

```ts
function applyKnockdown(f: Fighter, w: World, fromCombo: number) {
  f.knockedDown = true
  f.knockdownTimer = f.char.knockdownFrames
  f.knockdowns++
  // 无敌覆盖"倒地 + 起身"，但用 max 而不是赋值——避免缩短已有的无敌（如复活无敌）
  f.invincible = Math.max(f.invincible, f.char.knockdownFrames + f.char.getupInvincible)
  w.events.push({ type: 'knockdown', who: f.index, x: f.x, y: f.y })
}
```

| 角色 | `knockdownGate` | `knockdownFrames` | `getupInvincible` | 行为解读 |
|---|---|---|---|---|
| 磨刀匠·砺 | 115% | 46 | 18 | 中规中矩 |
| 灯守·葵 | 100% | 38 | 24 | **抗压型**：倒得早但起得快、无敌长 |
| 铁皮·肯 | 135% | 58 | 14 | **高风险**：倒得少但倒地极久，被压的代价最大 |

**倒地期间的表现**：`invincible > 0` 时渲染层让角色**半透明快速闪烁**（`alpha = 0.25 + 0.45*|sin(phase*0.42)|`），
受击框压扁成 `y-18..y`（`hurtBox` 里按 `knockedDown` 分支），物理上仍在滑行
（`KNOCKDOWN_BOUNCE 9.5` 弹一下、`KNOCKDOWN_FRICTION 0.86` 触地摩擦）。

**为什么门槛各角色不同而不统一**：这是"重量级角色更难被击倒"的最轻量实现——
不新增任何属性和公式，只换一个数字。轻角色倒得早但恢复快，重角色倒得少但一旦倒了
就要挨完整的追击。**这两种恐惧感是不同的**，比"所有人 120%"有表达力。

**`Math.max` 而不是赋值**：如果赋值，被击倒时如果身上还有更长的无敌（比如刚复活的 60 帧），
会被缩短成 `knockdownFrames + getupInvincible`，出现"复活无敌被击倒吃掉了"的怪异现象。

---

## 5. 快照

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

---

## 6. 校验和

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

