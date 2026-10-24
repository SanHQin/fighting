# 角色操作与动画设计

> 项目：平台格斗游戏（大乱斗式） · 所属：[架构设计总纲](./00-overview.md)
>
> 版本 v0.10.5 ｜ 2026-10-24 ｜ 系列：1 总纲 + 8 专题

---

## 1. 角色系统总览

### 1.1 一个角色由五部分组成

角色不是一个类，是五份数据的集合。`battle-core` 只认识前两部分，后三部分只被 `client` 读取。

| # | 组成 | 载体 | 谁消费 | 缺失后果 |
|---|---|---|---|---|
| 1 | **数值（Stats）** | `stats.json` | `physics/*`、`knockback/formula.ts` | 角色无法初始化 |
| 2 | **帧数据（MoveSet）** | `moveset.json` | `combat/hitbox.ts`、`fighter/attack.ts` | 能走路但不能打人 |
| 3 | **动画资源** | 图集 + `anim.json` | `client/render/FighterView.ts` | 能打人但看不见 |
| 4 | **音效** | `sfx.json` + 音频文件 | `client/audio/` | 可玩，但"打中没手感"（见 §10） |
| 5 | **状态机配置** | `states.json` | `fighter/transitions.ts` | 全部角色共用默认转移表 |

第 5 项容易被忽略：转移表本身是代码，但"这个角色允不允许从 `Fall` 直接进 `AttackAir`"是数据。v1 两个角色都用默认表，`states.json` 只写**增量覆盖**（overrides），空对象表示"完全用默认"。

上表是**功能视角**——回答"缺了哪个能力会坏"。**交付视角**的文件清单（20 个文件、逐项格式与验收标准）在 **§1.5**，那份才是"要把一个角色做出来，到底得准备哪些东西"的答案。

### 1.2 数据驱动的边界

"加角色只改数据"这句话有严格边界，写清楚比喊口号有用：

| 改动 | 只改数据？ | 说明 |
|---|---|---|
| 调伤害 / 帧数 / 判定框 | ✅ | `moveset.json` |
| 调体重 / 速度 / 跳跃 | ✅ | `stats.json` |
| 换贴图 / 加招式动作 | ✅ | 图集 + `anim.json` |
| 新增一个**已有类型**的招式 | ✅ | 例：加第 6 个空中招 |
| 新增**机制**（如反击、飞行、召唤） | ❌ | 需要新状态 + 新 `stateHandler` |
| 改击飞公式 | ❌ | 全局，影响所有角色，走评审 |

判断标准：**新招式只用到"判定框 + 帧号 + 位移"三件事，就是纯数据**。一旦需要"读取对方状态并作出反应"（反击、抓取判定、飞行轨迹追踪），就必须进代码。v1 明确不做反击类机制，就是为了守住这条线。

### 1.3 角色数据目录结构

```
packages/battle-core/data/chars/li/          # 逻辑侧：纯 JSON，无图片
├─ char.json          # 元信息：id / 显示名 / 体重档 / 版本 / rulesetHash 输入
├─ stats.json         # 属性表（§2）
├─ moveset.json       # 23 条帧数据（§6.5）
├─ states.json        # 状态机增量覆盖（默认 {}）
├─ anim.json          # StateEnum → 动画 key 映射（§7.2）
└─ sfx.json           # 事件 → 音效 key（纯表现，不进模拟）

packages/client/public/char/li/              # 表现侧：图片与音频
├─ parts/
│  ├─ parts.png       # 14 个部件（9 张图，左右复用）合成的一张图集，≤ 1024×1024
│  └─ parts.json      # Pixi Spritesheet 格式（trim:false，禁旋转打包）
├─ rig.json           # 部件层级、pivot、z-order、静止角（见 04 §7.4）
├─ poses.json         # 每个动画的 3–5 组关键姿势（见 04 §7.4）
├─ portrait.png       # 选人立绘 512×512
├─ icon.png           # 头像/血条图标 128×128
└─ audio/
   ├─ swing.mp3  hit_light.mp3  hit_heavy.mp3
   ├─ ko.mp3  jump.mp3  land.mp3
   └─ voice_intro.mp3  voice_ko.mp3
```

文件数与 **§1.5** 的清单编号一致（A 组 6 个 JSON、B 组 4 个、C 组 2 张图、D 组 8 个音频）。完整清单（`char.json` 的字段、每份文件的验收标准、哪些能砍）见 **§1.5**，两处不要各写一套。

要点：

- `battle-core/data` 里**没有任何图片**。`battle-core` 的 `tsconfig` 不含 DOM，加载器只 `JSON.parse`（Node 下 `readFileSync`，浏览器下构建期内联）。
- `anim.json` 放在 `battle-core/data` 而不是 `client`，因为它要和 `moveset.json` 一起做**校验**：每个 `moveId` 必须有动画，每条动画的帧数必须 ≥ 该招式的逻辑帧数 ÷ `hold`。校验放在 `loader.ts`，构建期跑。
- `rig.json` / `poses.json` 放在 `client`，因为它们是**纯视觉**的——逻辑层不需要知道角色由几个部件组成。但它们的"每帧都要有姿势"由 §1.4 的构建期校验保证。
- `rulesetHash` = 对该角色目录下**全部影响模拟的** `.json` 的文件名 + 内容做 FNV 哈希（`char` / `stats` / `moveset` / `states` / `anim`）。`rig.json`、`poses.json`、`sfx.json` 与图片音频**不进哈希**——改美术不该导致联机拒绝开局。联机握手时比对，不一致直接拒绝（见 [05 服务端](./05-server.md) 第 3.6 节）。

### 1.4 加载与校验

```ts
// packages/battle-core/src/loader.ts
export interface LoadedChar {
  meta: CharMeta; stats: Stats; moves: ReadonlyMap<string, Move>;
  animMap: AnimMap; rulesetHash: number;
}

export function loadChar(raw: RawCharBundle): LoadedChar {
  validateSchema(raw.stats, STATS_SCHEMA);      // 抛错，不修数据
  validateSchema(raw.moveset, MOVESET_SCHEMA);
  const moves = indexMoves(raw.moveset);         // 建 id → Move 的 Map
  assertAllMovesReachable(moves);                // 每个 moveId 有对应输入路径
  assertAnimCoverage(moves, raw.animMap);        // 每个招式有动画且帧数够
  const stats = normalizeStats(raw.stats);       // 倍率 → 实际值，见 §2.1
  return { meta: raw.meta, stats, moves, animMap: raw.animMap,
           rulesetHash: hashBundle(raw) };
}
```

**为什么校验在加载期而不是运行期**：帧数据错误（`active: 0`、`to < from`）如果只在对局中才炸，表现是"某个招偶尔不判定"，极难复现。加载期一次性抛错，把问题前移到 M5 写数据的那一天。

### 1.5 一个角色的完整资源清单

这是**交付清单**，回答"要把一个角色做出来，到底得准备哪些文件"。共 **20 个文件**，分四组：逻辑数据（6 个 JSON）、美术数据（2 个 JSON + 1 张图集 + 1 个描述文件）、图片（2 个）、音频（8 个）。

一句话记忆：**6 个 JSON 让角色"能打"，4 + 2 个文件让它"看得见"，8 个音频让它"有手感"。**

#### A 组：逻辑数据（进 `rulesetHash`，缺一个无法开局）

| # | 文件 | 格式 | 体积量级 | 谁产出 | 缺了会怎样 |
|---|---|---|---|---|---|
| 1 | `char.json` | JSON | < 1KB | 策划 | 加载器不知道角色 id/体重档，直接抛错 |
| 2 | `stats.json` | JSON | ~1KB | 策划/程序 | 无法初始化，见 §2 |
| 3 | `moveset.json` | JSON | 6–12KB | 策划/程序 | 能走能跳不能打人 |
| 4 | `states.json` | JSON | 0–2KB | 程序 | 退化为全局默认转移表（v1 两角色都是 `{}`） |
| 5 | `anim.json` | JSON | 1–2KB | 程序 | 动画层不知道播什么，角色"隐形" |
| 6 | `sfx.json` | JSON（**不进哈希**） | < 1KB | 策划 | 打中了没声音 |

**`char.json` 的完整字段**（这是唯一还没在其他地方定义过的结构）：

```jsonc
// packages/battle-core/data/chars/li/char.json
{
  "id": "li",                    // 唯一键，用于目录名、图集名、存档
  "numId": 3,                    // 数字 id，进输入帧与网络协议（2 字节里省空间）
  "displayName": "磨刀匠·砺",
  "displayNameEn": "Li, the Grinder",
  "weightClass": "middle",       // light / middle / heavy，仅用于 UI 分组，不进公式
  "version": 1,                  // 该角色数据的语义化版本，改帧数据就 +1
  "selectOrder": 30,             // 选人界面排序，留空档便于插入
  "artCredit": "…"               // 美术署名，结算页显示
}
```

`numId` 必须**全局唯一且永不复用**——它进网络协议和回放文件，删角色后空号要留着。`version` 变化会改变 `rulesetHash`，这是"改了帧数据就必须双方同步更新"的机制。

**`moveset.json` 的规模基准**：v1 第一角色 23 条招式（§6.5 有完整清单），第二角色 45 条是中期目标、v1 实收 23 条同量级。每条招式平均 300–500 字节（含 1–4 个 hitbox），所以 6–12KB。

#### B 组：美术数据（不进哈希，纯视觉）

| # | 文件 | 格式 | 体积量级 | 谁产出 | 说明 |
|---|---|---|---|---|---|
| 7 | `rig.json` | JSON | 2–4KB | 美术/程序 | **14 个部件**的层级、pivot、z、静止角（9 张图，左右复用）。结构见 [04 §7.4](./04-ui-art.md) |
| 8 | `poses.json` | JSON | 20–60KB | 美术 | 每个动画 3–5 组关键姿势。**这是最大的一份角色数据** |
| 9 | `parts.png` | PNG/WebP + alpha | 150–260KB | 美术 | **9 张**部件图合成的一张图集，1024×1024，2× 出图 |
| 10 | `parts.json` | Pixi Spritesheet | 2–5KB | 构建脚本 | 由 `free-tex-packer-core` 生成，**`trim: false`、禁旋转打包** |

> **为什么 `poses.json` 是 20–60KB**：约 70 个动画 × 3–5 组关键姿势 ≈ 250 组，每组 6–10 个部件角度 + `f` 字段，序列化后大约 40KB。这是自研骨骼方案的**主要数据量所在**，也是风险表里那条「自研 rig 的姿势数据量大」的量化依据（[00 第 8 节](./00-overview.md)）。它靠 §7.4 的姿势编辑器维护，不手写。

#### C 组：图片（2 个独立文件，不进 `parts.png`）

| # | 文件 | 尺寸 | 体积 | 用途 | 何时加载 |
|---|---|---|---|---|---|
| 11 | `portrait.png` | 512×512 | 60–120KB | 选人页立绘、结算页 | 光标停在该角色时 |
| 12 | `icon.png` | 128×128 | 8–16KB | 血条上方头像、房间列表、战绩页 | 主菜单（`requestIdleCallback`） |

这两张**不能**塞进部件图集：它们的加载时机与部件图完全不同（图标在主菜单就要，部件图在选人确认后才要）。混在一起会让首屏多背 200KB。

#### D 组：音频（8 个文件，全部 MP3）

| # | 文件 | 触发时机 | 时长 | 体积 |
|---|---|---|---|---|
| 13 | `swing.ogg` | 出招 startup 帧，按招式轻重选变体 | 100–200ms | 3–6KB |
| 14 | `hit_light.ogg` | 轻击命中 | 150–250ms | 4–8KB |
| 15 | `hit_heavy.ogg` | 重击命中 / 击杀一击 | 250–400ms | 6–12KB |
| 16 | `ko.ogg` | 出界淘汰 | 600–900ms | 12–20KB |
| 17 | `jump.ogg` | 离地 | 80–150ms | 3–5KB |
| 18 | `land.ogg` | 落地（按 `vy` 分两档音量，不拆两文件） | 100–180ms | 4–7KB |
| 19 | `voice_intro.ogg` | 出场 / 选人确认 | 800–1500ms | 15–25KB |
| 20 | `voice_ko.ogg` | 被淘汰 | 800–1500ms | 15–25KB |

> **格式统一用 MP3 而非 `.ogg`**：文件扩展名只是习惯写法，实际交付必须是 MP3——Safari 不支持 Ogg Vorbis，选它就要维护两套编码 + 运行时探测（见 [04 §9.4](./04-ui-art.md)）。这里改名成本最低的时刻是现在。
>
> **为什么只有 8 个而不是每个招式一个**：音效靠**参数化**产生差异，不靠文件数量。`swing` 按招式轻重变调（`playbackRate` 0.9–1.15）、`hit` 按伤害分两档、`land` 按落地速度调音量。8 个文件覆盖全部 23 个招式，总音频量 ≈100KB。每个招式一个音效的做法会让角色音频涨到 500KB+，且美术根本录不出来。

`sfx.json` 就是这张表的**逻辑侧映射**（事件 → 文件名 + 变体规则）：

```jsonc
{
  "swing": { "file": "swing",   "rateByWeight": [0.92, 1.0, 1.12] },
  "hit":   { "light": "hit_light", "heavy": "hit_heavy",
             "rateByDamage": { "lt20": 1.0, "gte20": 0.94 } },
  "jump":  "jump",  "land": "land",
  "ko":    "ko",    "voiceIntro": "voice_intro", "voiceKo": "voice_ko"
}
```

#### 汇总与工期

| 组 | 文件数 | 体积 | 产出方 | 人日（首角色 / 后续角色） |
|---|---|---|---|---|
| A 逻辑数据 | 6 | ~15KB | 策划 + 程序 | 8 / 5（招式数决定） |
| B 美术数据 + 图 | 4 | ~250KB | 美术 | 6 / 4 |
| C 图片 | 2 | ~130KB | 美术 | 1 / 0.5 |
| D 音频 | 8 | ~100KB | 音频/外包 | 1 / 0.5 |
| **合计** | **20 个文件** | **≈500KB** | — | **16 / 10** |

**为什么首角色比后续角色贵**：`rig.json` 的骨架层级、`poses.json` 的动画命名、`sfx.json` 的事件名都是**一次性的规范工作**。第二个角色直接复制第一份的结构改数值，省下的是"设计规范"的时间而非"填数据"的时间。

#### 可以砍的（按砍掉的痛感排序，越靠后越能砍）

| 砍掉 | 省 | 痛感 |
|---|---|---|
| `voice_intro` / `voice_ko` | 2 文件 + 1 人日 | 低——哑巴角色也能玩，v1 可后补 |
| `portrait.png` | 1 文件 + 0.5 人日 | 低——选人页先用 `icon.png` 放大占位（会糊，但能玩） |
| `jump` / `land` 音效 | 2 文件 | 中——落地没声音，重量感直接掉一半（§10 排查表第一条） |
| `states.json` 的覆盖 | 0（v1 本就是 `{}`） | 无——不砍也是空对象 |
| `poses.json` 减到每动画 2 组 | ~10KB | 中高——动作会变成"两帧之间硬插值"，僵硬但能跑 |
| **`moveset.json` 减招式** | 最大 | **高——这是玩法，不是装饰** |

**永远不能砍的**：`char.json`、`stats.json`、`moveset.json`（哪怕只留 10 招）、`anim.json`、`rig.json`、`poses.json`、`parts.png` + `parts.json`。这 7 项缺任何一项，角色要么加载失败要么看不见。

#### 交付检查表（写完一个角色，逐条勾）

```bash
pnpm validate:char li     # 跑 §1.4 的加载校验 + 下面全部断言
```

- [ ] 6 个逻辑 JSON 存在，`pnpm validate:char` 无报错
- [ ] `moveset.json` 每条招式都能被某个输入路径触发（`assertAllMovesReachable`）
- [ ] `anim.json` 覆盖全部 `StateEnum`，且每个 `moveId` 有动画
- [ ] `rig.json` 的 `parent` 无环、无悬空引用、`pivot` 都是二元数数组
- [ ] `poses.json` 每个动画：首帧 `f=1`、末帧 `f=总帧数`、`f` 严格递增、`startup` 帧有关键姿势
- [ ] 循环动画（`idle`/`walk`/`run`/`fall`/`crouch`/`ledge`）首末角度差 ≤ 2°
- [ ] `parts.json` 里每个子图 `trimmed: false`、无 `rotated: true`
- [ ] 部件图里**没有**文字/logo（镜像会反过来，见 §8.5）
- [ ] `icon.png` 缩到 32×32 仍能认出是谁（剪影测试的轻量版）
- [ ] 8 个音频文件都是 MP3，且 `hit_light` / `hit_heavy` 能被听出区别
- [ ] `rulesetHash` 已记录，与对手握手时不冲突

---

## 2. 角色属性（Stats）

### 2.1 属性表定义与"倍率而非绝对值"原则

物理常量（`GRAVITY=0.85`、`MAX_FALL=12`、`MAX_WALK=5.5`、`MAX_RUN=9.0`、`FRICTION=0.85` 等）**全部集中在 `shared/constants.ts`，任何角色都不得覆盖**。角色数据里出现的是**倍率**，最终值 = 全局常量 × 该角色倍率：

```ts
export interface Stats {
  // —— 质量 ——
  weight: number;              // 70..140，进击飞公式的 w
  gravityScale: number;        // 0.85..1.15，乘 GRAVITY
  fallSpeedScale: number;      // 0.90..1.20，乘 MAX_FALL / FAST_FALL_SPEED
  airAccelScale: number;       // 0.70..1.15，乘 AIR_ACCEL
  airDrag: number;             // 0.96..0.995，直接替换 AIR_DRAG
  friction: number;            // 0.72..0.92，直接替换 FRICTION（越小越黏）
  // —— 移动 ——
  walkMaxScale: number;        // 乘 MAX_WALK
  runMaxScale: number;         // 乘 MAX_RUN
  dashSpeed: number;           // 冲刺首帧速度，4.5..8.0
  dashFrames: number;          // 冲刺持续帧，2..5
  // —— 跳跃 ——
  jumpScale: number;           // 乘 FULL_JUMP_VELOCITY / SHORT_HOP_VELOCITY
  airJumps: number;            // 0..2，空中跳跃次数（= jumpsLeft 初始值）
  airJumpScale: number;        // 二段跳初速倍率，0.9..1.15
  // —— 体型 ——
  hurtboxW: number;            // 28..48
  hurtboxH: number;            // 56..80
  shieldScale: number;         // 0.90..1.15，乘在全局盾半径上（不是绝对半径）
  // —— 抓取 ——
  grabRange: number;           // 45..70（像素，从脚底中心向前）
  grabHoldFrames: number;      // 挣脱所需帧，60..110
}
```

**为什么用倍率**：全局调参时（"整体重力太轻"），只改 `constants.ts` 一个数，全部角色按比例跟着动，不需要逐个改数据。若角色写绝对值，改全局常量对它们无效，调参就变成 2 份数据的维护。代价是单角色微调时要在脑子里做乘法——所以 `loader.ts` 提供 `?debug=1` 打印"倍率 → 实际值"对照表。

### 2.2 标准型 / 重型 属性对比

下面两个是**调参基准样本**（不是可选角色），用于回答"这个数算快还是慢"。

| 属性 | 字段 | 标准型 | 重型 | 取值范围 | 备注 |
|---|---|---|---|---|---|
| 体重 | `weight` | 100 | 130 | 70–140 | 决定击飞抗性，§2.3 |
| 重力缩放 | `gravityScale` | 1.00 | 1.08 | 0.85–1.15 | 重型下落快、复归差 |
| 下落速度缩放 | `fallSpeedScale` | 1.00 | 1.12 | 0.90–1.20 | 影响 `MAX_FALL` 与快落 |
| 空中加速度缩放 | `airAccelScale` | 1.00 | 0.80 | 0.70–1.15 | 重型空中"掰不动" |
| 空中阻力 | `airDrag` | 0.99 | 0.985 | 0.96–0.995 | |
| 地面摩擦 | `friction` | 0.85 | 0.80 | 0.72–0.92 | 越小停得越快 |
| 走速 | `walkMax` | 5.5 | 4.2 | 3.5–6.5 | = 5.5 × 1.00 / 0.76 |
| 跑速 | `runMax` | 9.0 | 7.0 | 6.0–11.0 | = 9.0 × 1.00 / 0.78 |
| 冲刺首帧速度 | `dashSpeed` | 7.5 | 5.8 | 4.5–8.0 | |
| 冲刺帧数 | `dashFrames` | 3 | 4 | 2–5 | |
| 跳跃初速 | `jumpScale` | 1.00 | 0.92 | 0.85–1.10 | 全跳 12.5 / 短跳 8.5 |
| 二段跳次数 | `airJumps` | 1 | 1 | 0–2 | |
| 二段跳倍率 | `airJumpScale` | 1.00 | 1.05 | 0.90–1.15 | |
| hurtbox 宽 | `hurtboxW` | 34 | 42 | 28–48 | |
| hurtbox 高 | `hurtboxH` | 64 | 74 | 56–80 | |
| 盾倍率 | `shieldScale` | 1.00 | 1.08 | 0.90–1.15 | 乘在全局半径（20–34）上，不是绝对值 |
| 抓取范围 | `grabRange` | 58 | 52 | 45–70 | 重型手短 |
| 挣脱所需帧 | `grabHoldFrames` | 90 | 105 | 60–110 | |

**读法**：重型全部指标在"更慢、更大、更重"方向移动 20%–25%，但**跑速只降 22% 而体重升 30%**——这个不对称是刻意的，否则重型会变成"移动缓慢的靶子"。设计上重型用**攻击范围和伤害**补偿，见 §9.5。

### 2.3 weight 如何影响击飞

公式里唯一出现 `weight` 的项是 `(200 / (w + 100))`：

| w | 200/(w+100) | 相对标准型 |
|---|---|---|
| 70 | 1.176 | +17.6% |
| 85 | 1.081 | +8.1% |
| 100 | 1.000 | 基准 |
| 115 | 0.930 | −7.0% |
| 130 | 0.870 | −13.0% |

代入完整体验（`d = 12`，`kbGrowth = 100`，`baseKB = 30`，目标 100%）：

| 体重 | `((p/10)+(p*d)/20)` | × 体重因子 | ×1.4 +18 | ×growth +base | 击飞速度(×0.09) |
|---|---|---|---|---|---|
| 85 | 70.0 | 75.68 | 123.95 | 153.95 | **13.86** |
| 100 | 70.0 | 70.00 | 116.00 | 146.00 | **13.14** |
| 130 | 70.0 | 60.87 | 103.22 | 133.22 | **11.99** |

> **`KNOCKBACK_TO_SPEED` 从 0.03 校准为 0.09（v0.4.0）**：0.03 是从 Melee 单位制抄来的，那边 1 单位 ≈ 1/4 角色高；本项目 1 单位 = 1 逻辑像素、标准型角色高 64，尺度差约 3 倍。用 0.03 实测：100% 伤害被击飞只推进 **46px**，连主台 420px 的台边都够不着，"高百分比才致命"直接失效。改 0.09 后：**在台边 120% 可 KO、在台中央 200% 可 KO**，与下面 §9 连段表的假设一致。改动同时连带两处：① 受击硬直不再是固定值，改为 `hitstun = floor(kb × 0.4)`（下限 6 帧）；② 受击硬直期间重力 ×0.55，否则击飞弧线太陡，重击也会砸在脚下。

**结论（必须写进调参手册）**：体重从 100 拉到 130，一击只让击飞慢 8.8%。想要"重型真的耐打"，单改 `weight` 效率很低，必须**同时**给 `gravityScale` + `fallSpeedScale`（下落快 → 击飞弧线更早触地 → 更早进入 `Tumble` 而不是飞出界）。这就是为什么重型的 `gravityScale` 是 1.08 而不是 1.00。

另：`w` 只出现在分母，**不存在除零风险**（`w ≥ 70`），但 `loader` 仍要断言 `weight > 0`，防止手写 JSON 时漏字段得到 `NaN`——`NaN` 会污染整条击飞链且不抛错，是最难查的 bug 之一。

---

## 3. 角色状态结构（FighterState）

### 3.1 完整接口

以下接口**逐字保留**架构文档 5.2 节定义，不得增删字段（字段顺序即快照布局，改动等于改协议）。

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
  // 盾没有独立的"举盾"状态：crouching 为 true 就是下蹲=防御，
  // 盾体半径由 shield 实时换算（shieldRadius(f)），不是角色常量
  shield: number;             // 盾值 0..50
  crouchStun: number;         // 被盾压制时的硬直
  shieldBreakStun: number;    // 破盾眩晕（150 帧）
  crouchHeight: number;       // 当前受击框高度（蹲 40 / 站 64），派生量，用于调试

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

### 3.2 字段用途与快照归属

`✅` = 必须进快照；`❌` = 常量，初始化时设定，回滚不还原。

| 字段 | 用途 | 快照 | 说明 |
|---|---|---|---|
| `id` | 槽位索引 | ❌ | 常量。所有循环按 `id` 升序 |
| `charId` | 角色类型 | ❌ | 常量 |
| `active` | 是否在场 | ✅ | 出局后 `false`，影响全部结算循环 |
| `x/y` | 位置 | ✅ | **脚底中心**为原点，y 向下为正 |
| `vx/vy` | 速度 | ✅ | 像素/帧 |
| `prevX/prevY` | 上帧位置 | ✅ | **最常被漏掉的字段**，见下 |
| `facing` | 朝向 | ✅ | `1 \| -1`，翻转只影响绘制与 hitbox 镜像 |
| `grounded` | 是否着地 | ✅ | 与 `platformId` 联合判定 |
| `platformId` | 所在平台 | ✅ | `-1` = 空中 |
| `ledgeId` | 抓着的边缘 | ✅ | `-1` = 未抓 |
| `state` | 当前状态 | ✅ | `StateEnum` |
| `stateFrame` | 状态内帧号 | ✅ | 从 0 起，`setState` 置 0 |
| `moveId` | 当前招式 | ✅ | `-1` = 无招式 |
| `moveFrame` | 招式内帧号 | ✅ | 从 1 起，判定用绝对帧号（§6） |
| `damage` | 伤害百分比 | ✅ | 击飞公式的 `p` |
| `jumpsLeft` | 剩余空中跳 | ✅ | 起跳后设为 `airJumps` |
| `airDodgesLeft` | 剩余空中闪避 | ✅ | |
| `shield` | 盾值 | ✅ | 满 50；**盾体半径由它实时换算**（§4.8.3） |
| `crouching` | 是否下蹲（= 防御） | ✅ | 同时决定受击框高度 40/64 |
| `crouchStun` | 盾被压制的硬直 | ✅ | |
| `shieldBreakStun` | 破盾眩晕 | ✅ | 150 帧 |
| `hitlag` | 顿帧剩余 | ✅ | 双方都可能不同（§6.8） |
| `hitstun` | 硬直剩余 | ✅ | |
| `launchAngle` | 击飞角度 | ✅ | 整数度，查表用 |
| `launchSpeed` | 击飞速度 | ✅ | 衰减中 |
| `diAngle` | DI 角度 | ✅ | 受击瞬间锁存 |
| `inputBuffer` | 按键历史位 | ✅ | 缓冲判定读它 |
| `inputHistory` | 方向历史 | ✅ | **变长数组，快照固定写 8 个槽** |
| `ledgeCooldown` | 抓边冷却 | ✅ | 30 帧 |
| `intangibility` | 无敌帧 | ✅ | |
| `respawnTimer` | 复活倒计时 | ✅ | 100 帧 |
| `respawnX/Y` | 复活点 | ✅ | 复活平台位置 |

**`prevX/prevY` 为什么必须进快照**：它同时服务于三个地方——渲染插值、扫掠碰撞的"上一帧位置"、单向平台的 `canLandOn` 判断（`f.prevY + HURTBOX_BOTTOM > p.y`）。回滚后若 `prevX/prevY` 没还原，扫掠检测会从错误的起点积分，直接导致**穿模**，且只在回滚时出现，本地单机永远复现不了。

**`inputHistory` 的快照写法**：它是 `number[]`，但快照是 `Float64Array` 扁平布局。约定固定写 8 个槽（不足补 0），长度恒定。若哪天改成变长，`save/load` 的对称性立刻崩。

### 3.3 反模式：把动画帧号存进模拟状态

```ts
// ❌ 绝对不要出现在 battle-core 里
f.animFrame++;
f.animPlaying = true;
f.isHitFrame = (f.animFrame === 12);
```

三个后果，按严重程度排：

1. **回滚抽搐**。回滚重演时 `loadSnapshot(F-1)` 把 `animFrame` 也退回去，重演 7 帧后再跑到当前帧，`animFrame` 走了两遍 → 视觉上攻击动作播了两次。
2. **污染 checksum**。`checksum()` 若覆盖全部字段，两端的动画帧因掉帧不同而不同 → 每 30 帧一次的校验判定为 desync，**明明模拟是对的，却报错断线**。
3. **违反 L3**。`animFrame` 由渲染层推进却存在模拟对象上，等于渲染层写回了模拟状态。

正确做法：动画帧是 `stateFrame` / `moveFrame` 的**纯函数**（§7.3），一个字段都不新增。同理，`isHitFrame` 这种一次性布尔永远应该写成帧区间判断：

```ts
// ✅ 判定写在 step() 内，用整数帧号
if (f.moveFrame >= mv.startup && f.moveFrame < mv.startup + mv.active) {
  spawnHitboxes(w, f, mv);
}
```

---

## 4. 输入系统

### 4.1 键位映射

```ts
const KEYMAP = {
  left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
  attack: ['KeyJ'], jump: ['KeyK'],
  special: ['KeyU'], special2: ['KeyI'],   // 两个必杀槽
  dash: ['KeyL'],                          // 冲刺（同时是空中复归键）
  // 防御不单独设键：按住 down 即下蹲，下蹲即防御，见 §5.4
};
```

**为什么防御绑在 `down` 上而不是独一个键**：平台格斗里"蹲"和"防"本来就该是同一个动作——
蹲下让受击框从 64 变 40（躲头顶来的上挑），同时撑起变形盾。拆成两个键会让玩家在
"想躲"和"想防"之间犹豫，而这两件事在大乱斗里是同一次输入。代价是完全不能移动，
且蹲着出招会自动起身（`down + attack` 就是下段攻击）。

**为什么必杀要两个槽而不是一个键 + 长按**：两个槽各自独立冷却，玩家在"现在放箭还是留着
捕兽夹"之间做的是**资源决策**；长按/双击那种输入在 60Hz 下容错差，而且回滚重演时
"按了几帧"必须进协议，等于把输入位宽从 2 字节扩出去。一个槽一个键最省。

**为什么冲刺和空中复归是同一个键**：它们本来就是同一个动作的两种情形——地面上按是前冲，
空中按是斜向位移。分成两个键会让"我是从地面被打出去的，现在能按哪个"变成一个要背的知识点；
同键则规则只有一条：**这一趟还没在空里用过冲刺就能飞回来**。

手柄映射走同一套逻辑键名，不新增概念：

| 逻辑键 | 键盘 | 手柄（标准布局） |
|---|---|---|
| `left/right/up/down` | 方向键 / WASD | 左摇杆（8 向数字化）或十字键 |
| `attack` | J | A（南键）/ X |
| `jump` | K | B（东键）/ Y |
| `special` / `special2` | U / I | 右肩 RB / 左肩 LB |
| `dash` | L | 右扳机（`value > 0.5`） |
| `down`（= 下蹲 = 防御） | S | 左摇杆下推 / 十字键下 |

### 4.2 编码（2 字节 / 帧）

```
byte0: [L R U D | ATTACK SPECIAL 0]
byte1: [JUMP GRAB | 0 0 0 0 0 0]
```

60 帧/秒 = 120 字节/秒/人，4 人也就 480 字节/秒，忽略不计。

`InputFrame` 只带 `bits`（`number`，低 9 位有效）。**不带时间戳、不带设备号、不带模拟量**——任何额外字段都会进入网络包与快照，而它们对判定毫无用处。

| bit | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| 含义 | 左 | 右 | 上 | 下 | 攻击 | 必杀 | 跳 | 抓 | 保留 |

**bit 6 原来是 SHIELD，v0.5.0 起删掉了。** 防御不再是一个独立动作——它是 `bit 3 = 下` 的必然结果。
这不是为了省一个 bit（网络包只有 2 字节，省不省无所谓），而是为了**让"单独举盾"在协议层面就无法表达**：
代码里想写 `if (input.shield)` 会直接编译不过，机制就不可能跑偏，回放数据也不可能出现"盾态与蹲态不一致"的历史对局。
删掉一个 bit 同时删掉了一整类 bug。

### 4.3 指令解析

平台格斗招式少（不像拳皇要搓招），主要是**方向 + 按键**的组合：

- 地面：`N/前/后/上/下 + 攻击` = 5 种
- 空中：`N/前/后/上/下 + 攻击` = 5 种
- 必杀：`N/前/后/上/下 + 必杀` = 5 种
- 合计：~15 条普通技 + 4 条必杀 = 约 60-80 条帧数据（含落地变体）

**不需要复杂的 236/623 搓招系统**，这是平台格斗相对简单的部分。

解析函数是纯函数，输入 `bits + facing + grounded`，输出 `moveId`：

```ts
export function resolveMove(bits: number, facing: 1 | -1, grounded: boolean): number {
  const dir = digitalDir(bits);              // -1 后 / 0 中立 / 1 前 / 2 上 / 3 下
  if (bits & B.SPECIAL) return SPECIAL_TABLE[grounded ? 0 : 1][dir];
  if (bits & B.ATTACK)  return ATTACK_TABLE[grounded ? 0 : 1][dir];
  return MOVE_NONE;
}
```

`facing` 参与解析：按"前"是指角色面向的那一侧，不是屏幕右侧。同一个 `bits`，转身后应解析出不同招式——这是新手最容易写错的一行。

### 4.3.1 冲刺是「方向 + 冲刺键」

`L`（2P `Numpad5`）单独按下时朝**当前朝向**冲；按住方向再按就是那个方向，支持八方向（正交 + 斜向）。
方向取**世界绝对方向**，理由见 `03` 第 4.9.1 节（朝向相对会让「被打出场外想飞回来」变成自杀键）。

`CharDef` 的冲刺五参数里只有速度与帧数是倍率，方向不在角色数据里 —— 方向是玩家的意图，不是角色的属性。

### 4.4 缓冲与容错（手感的全部来源）

平台格斗的手感几乎不由"招式数值"决定，而由**输入与内核时机之间的容错**决定。本项目落地了四条：

| 机制 | 帧数/值 | 解决什么 | 代码位置 |
|---|---|---|---|
| 跳跃缓冲 `JUMP_BUFFER_FRAMES` | 6 | 落地前按跳，落地后那一帧补发。没有它，"按了没反应"是新手最常见的挫败 | `sim.ts` 缓冲装填 + 帧末衰减 |
| 郊狼时间 `COYOTE_FRAMES` | 3 | 刚走出平台边缘 3 帧内仍算站在地上，可以起跳 | `sim.ts` 郊狼段 |
| 攻击缓冲 `ATTACK_BUFFER_FRAMES` | **5** | 收招末尾按攻击，解除硬直当帧出招 | `sim.ts` 攻击起手条件 |
| 短跳（松手） | 松手即短跳 | 轻点跳得矮，是上平台/躲招/抢身位的基本功 | `sim.ts` 起跳蹲段 |
| 空中横向加速 `AIR_ACCEL` | **0.42** | 空中跟手程度。0.35 时空中变向"要先飘一下"，抢身位全靠预判 | `sim.ts` 水平控制 |
| 落地硬直 `LAND_LAG_MIN/MAX` | **1 / 4** | 按落地速度给 1–4 帧（原 2–6）。6 帧对重击太重，落地像被粘住 | `sim.ts` 落地判定 |

三条实现细节，都是踩过才写上去的：

1. **缓冲在帧末衰减，不在帧首**。帧首衰减会出现「落地当帧缓冲刚好归零、动作块看不到它」的差一帧错位。
2. **落地硬直期间缓冲不衰减**。硬直本身就禁止起跳，如果还按帧消耗，"落地前按跳"永远等不到能跳的那一帧 —— 缓冲等于白做。
3. **落地硬直要先递减再算 `canAct`**。顺序反了，"硬直归零"那一帧仍被判为不能动，帧末衰减又把输入吃掉。

**顿帧期间也要记账。** 顿帧（hitlag）冻结动作是对的，但它连着冻结输入就错了：

```ts
if (f.hitlag > 0) {
  if (input.jumpPressed) f.jumpBuffer = C.JUMP_BUFFER_FRAMES   // 照常记账
  if (input.attack) f.atkBuffer = C.ATTACK_BUFFER_FRAMES
  f.hitlag--
  continue
}
```

轻击 5 帧、重击 9 帧的顿帧里按下的跳与攻击，如果被吞掉，玩家体感是"打中了反而按不动"。
顿帧是为了打击感，不是为了让输入失效。

另外两条容易被忽略：
- **主动下穿（蹲+跳穿单向平台）必须清空郊狼时间与跳跃缓冲**，否则刚离地那帧会被判成"地面跳"，人又被托回平台（`tools/check-feel.mjs` 第 6 组就在守这条）。
- **`jumpHeld` 必须进 `InputState`**。只有 `jumpPressed` 的话内核无从判断"松手没有"，短跳无法实现。

### 4.4.1 原始缓冲设计（保留作为背景）

```ts
// 跳跃缓冲：落地前 3 帧按跳，落地立即起跳
// 攻击缓冲：硬直结束前 3 帧按攻击，硬直一结束立即出招
const BUFFER_FRAMES = 3;
```

这两个缓冲对手感影响巨大，**M1 就要做**。

实现方式是"查最近 3 帧的位"，不是"存一个待执行的意图队列"：

```ts
function pressedWithin(f: FighterState, mask: number, frames: number): boolean {
  let hist = f.inputBuffer;                  // 每帧左移 8 位拼接
  for (let i = 0; i < frames; i++) {
    if ((hist & 0xff) & mask) return true;
    hist >>>= 8;
  }
  return false;
}
```

**为什么不用意图队列**：队列是有状态的，回滚时要跟着回滚，且"消费一次就该清空"的语义在重演里会重复消费。查历史位是无状态的纯函数，天然可回滚。

### 4.5 为什么不用事件驱动采样

直觉写法是 `keydown` 时直接调 `attack()`。这个写法有三个致命问题：

1. **一帧内可触发任意多次**。OS 按键重复（`event.repeat`）在长按时会以 ~30Hz 触发；玩家快速连点 2 帧内可以产生 5 次 `keydown`。逻辑帧只知道"这一帧是否按下"，事件流里没有"帧"的概念——你无法从 5 个事件推断出这 5 次分别落在哪一帧。
2. **事件到达时间与 `step()` 时间不对齐**。浏览器事件在宏任务里派发，`requestAnimationFrame` 回调里跑累加器；一帧 16.6ms 内可能一次事件都没有（掉帧），也可能有 3 次。用事件驱动，逻辑结果就依赖事件派发时机 → **不可重放**。
3. **无法回滚**。回滚要求"第 N 帧的输入"是一个可从缓冲区读出的确定值。事件流是单向的，回滚到第 N-7 帧时你没法"重放"那 7 帧的按键。

正确做法是**事件更新状态、帧采样状态**：

```ts
const down = new Set<string>();               // 键盘物理状态

addEventListener('keydown', (e) => {
  if (e.repeat) return;                        // 忽略 OS 重复
  down.add(e.code);
  e.preventDefault();                          // 阻止空格滚动页面
});
addEventListener('keyup',   (e) => down.delete(e.code));
addEventListener('blur',    () => down.clear());   // ★ 失焦必须清空

// 每个逻辑帧开头调用一次，纯读
function sampleKeyboard(): number {
  let bits = 0;
  for (const [action, codes] of Object.entries(KEYMAP))
    if (codes.some((c) => down.has(c))) bits |= B[action];
  return bits;
}
```

`blur` 清空是必须的：玩家 Alt+Tab 切走时 `keyup` 收不到，不清空会导致角色一直朝一个方向跑，回来时已经掉出场外。

### 4.6 手柄支持（Gamepad API）

手柄**只能轮询**（没有可靠的按键事件），这反而与帧采样天然契合。

| 事项 | 约定 | 为什么 |
|---|---|---|
| 轮询时机 | 每个**逻辑帧**开头，`sample()` 内调用一次 `navigator.getGamepads()` | 每渲染帧轮询会让采样时刻随刷新率变化；一帧多次轮询拿到的是同一状态，纯浪费 |
| 死区 | 径向死区 **0.25**，出死区后按 `(m-0.25)/(1-0.25)` 归一化 | 轴向死区（各自判断 x/y）会在 45° 方向产生"卡角"，径向死区保证方向连续 |
| 数字化 | 摇杆向量 → 8 向（含中立），阈值 0.5 | 逻辑层只有数字方向（§4.2），不做模拟量 |
| 扳机 | `value > 0.5` 视为按下，带 0.1 回滞 | 无回滞时 0.49/0.51 抖动会连发 |
| 热插拔 | 监听 `gamepadconnected/disconnected` 只用于**更新设备榜单**，不参与每帧逻辑 | 事件驱动设备列表可以，事件驱动输入不行 |
| 断连 | 断连当帧立即把该源置 0 并 `down.clear()` | 同 `blur` |

```ts
function sampleGamepad(pad: Gamepad): number {
  let bits = 0;
  const dz = 0.25;
  let ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
  const m = Math.sqrt(ax * ax + ay * ay);
  if (m > dz) {
    const k = (m - dz) / (1 - dz) / m;
    ax *= k; ay *= k;
    if (ax < -0.5) bits |= B.LEFT;
    if (ax >  0.5) bits |= B.RIGHT;
    if (ay < -0.5) bits |= B.UP;
    if (ay >  0.5) bits |= B.DOWN;
  }
  if (pad.buttons[0]?.pressed) bits |= B.ATTACK;
  if (pad.buttons[1]?.pressed) bits |= B.SPECIAL;
  // 防御不读独立键：B.DOWN 就是下蹲就是防御，见 §4.2
  if (pad.buttons[5]?.pressed) bits |= B.JUMP;
  if ((pad.buttons[6]?.value ?? 0) > 0.5) bits |= B.GRAB;
  return bits;
}
```

注意 `Math.sqrt` 在这里合法（L2 允许），但这段代码在 `client` 层，本来就不受模拟层限制。

### 4.7 统一输入抽象层 `InputSource`

这是整个输入系统的收口。键盘、手柄、AI、远端玩家，四者实现同一个接口：

```ts
export interface InputSource {
  readonly kind: 'keyboard' | 'gamepad' | 'ai' | 'remote';
  /** 每个逻辑帧调用且只调用一次；返回该帧的 9 位按键位 */
  sample(frame: number): number;
  dispose?(): void;
}
```

```ts
export class KeyboardSource implements InputSource {
  readonly kind = 'keyboard';
  sample(): number { return sampleKeyboard(); }
}

export class GamepadSource implements InputSource {
  readonly kind = 'gamepad';
  constructor(private index: number) {}
  sample(): number {
    const pad = navigator.getGamepads()[this.index];
    return pad ? sampleGamepad(pad) : 0;
  }
}

/** ★ AI 与真人同构：读世界、吐 bits，不做任何写操作 */
export class AiSource implements InputSource {
  readonly kind = 'ai';
  constructor(
    private bot: Bot,
    private world: Readonly<World>,
    private slot: number,
  ) {}
  sample(frame: number): number {
    // 感知延迟：看到的是 PERCEPTION_LAG 帧前的世界（模拟"反应时间"）
    return this.bot.decideAt(this.world, this.slot, frame).bits;
  }
}
```

**为什么 AI 必须是同一个接口**（架构上最关键的一条）：

- 回滚重演时，`step()` 用 `inputs[i]` 重算。AI 若直接改 `World`（"看到你就冲刺过去"），重演时它看到的是**重演后的世界**，做出的决策与首次运行不同 → 两端状态分叉。同构接口强制 AI 只能通过"每帧一个 bits"影响世界，回滚才成立。
- AI 与真人在网络层复用同一条路径：远端玩家的输入也是 `InputSource`（`RemoteSource` 从回滚缓冲按 frame 取值），本地 AI 只是把 `RemoteSource` 换成 `AiSource`，`step()` 一行都不用改。
- 由此得到一个约束：**`AiSource` 不得持有隐藏状态**。需要"连续 20 帧保持冲刺"这类决策，要么从世界状态重算，要么把状态存进 `World`（进快照）。M6 的 `Bot` 设计为"每帧从世界状态 + 固定种子重算"，就是为了这个。

```ts
// 组装：一局 4 个槽，来源可任意混搭
const sources: InputSource[] = [
  new KeyboardSource(),
  new AiSource(bot, world, 1),
  new RemoteSource(rollbackBuf, 2),
  new NoneSource(),                      // 空槽
];
// 每帧
const inputs = sources.map((s, i) => ({ bits: s.sample(w.frame) }));
step(w, inputs);
```

### 4.8 输入历史与方向判定

`inputHistory` 存最近 8 帧的**方向码**（3 bit：0 中立 / 1 前 / 2 后 / 3 上 / 4 下 / 5 上前 / 6 上后 / 7 下前 / 8 下后），不是完整 bits——只留方向，省一半内存且够用。

用途：

| 判定 | 规则 | 用在哪 |
|---|---|---|
| 快速拨前 = 冲刺 | 4 帧内 ≥ 2 帧"前" | `Idle → Dash` |
| 转身 | `facing` 与当前方向相反且 `canTurn` | `Walk/Run` |
| 快速下落 | 空中"下"按下沿（上帧不是下） | `Fall → FastFall` |
| 搓招（预留给 v2） | 8 帧内 `前 → 下 → 下+攻击` | 未使用 |
| DI | 受击瞬间的方向码 → `diAngle` | 击飞结算 |

**"快速"必须用帧数判定，不能用时间**。`4 帧` = 66ms，这是手感数字；如果用 `Date.now()` 差值，掉帧时会变松，且回滚后判定结果不同（L5）。

---

## 5. 状态机

### 5.1 StateEnum（~50 状态）

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
  DashAttack,              // 冲刺攻击：独立态，因为它的收招硬直与普通攻击不同
  Special,                 // 必杀：独立态，因为它的帧数来自 SPECIAL_FRAMES 而不是 MoveDef
  // 防御（Crouch 本身就是防御，没有独立的 Shield 站立态——见 §4.1）
  CrouchStun, ShieldBreak, ShieldDrop,
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

**v1 原型实际只落地 13 个态**（`idle / run / jump / fall / hurt / attack / special / dashattack /
crouch / land / dash / ledge / knockdown`，外加 `broken / dead`），
其余的是 v2 的扩展位。这个差额是刻意的：**状态机的价值不在状态多，而在
§5.2 的显式转移表**——先把转移规则跑通，状态可以后加，反过来不行。

### 5.2 StateDef 与转移断言

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

补充两条纪律：

- 断言**只在 `setState` 入口做一次**，`update()` 里不要重复 `if (能转吗)`，否则逻辑分散在两处，改表时漏改。
- 断言必须在 `__DEV__` 下跑，但**转移表本身在生产构建里也要参与逻辑**（决定能不能转）。断言只是"提前暴露"，不是"校验开关"。

### 5.3 状态分组讲解

50 个状态不是拍脑袋列的，每一组解决一类问题。

| 组 | 状态 | 存在理由 | 典型 bug |
|---|---|---|---|
| **地面移动** | `Idle` `Walk` `Crouch` `CrouchStart` `Dash` `Run` `RunStart` `RunStop` `Skid` | 把"加速"和"匀速"分开，惯性才有层次；`Skid` 让急停有 4 帧刹车感 | 冲刺与走切换抖动（`RunStart` 只给 3 帧） |
| **起跳/落地** | `JumpSquat` `Landing` `LandingLag` | `JumpSquat` 4 帧是**可被抓住的前摇**（防御性跳跃的代价）；`LandingLag` 区分普通落地与招式落地 | 短跳判定写在 `Fall` 里，导致预输入跳失效 |
| **空中** | `AirIdle` `AirJumpStart` `AirDodge` `AirDodgeLanding` `Fall` `FastFall` `AirAttack` | `AirIdle` 与 `Fall` 分开是为了表现"起跳最高点悬停"；`FastFall` 独立状态才能锁 `vy` | `AirIdle → Fall` 用速度阈值判，浮点抖动导致来回跳 |
| **攻击** | `AttackGround` `AttackAir` `AttackLanding` | 三个状态吃三套不同的打断规则（地面招可被盾取消一部分，空中招只被落地打断） | 用 `moveId` 反推状态，出现"空中招在落地后还在播" |
| **防御** | `Crouch`（= 防御）`CrouchStun` `ShieldBreak` `ShieldDrop` `Roll` `SpotDodge` `Sidestep` | 防御就是下蹲，**没有独立的举盾态**——少一个状态就少一条转移边，也少一类"忘了同步盾态"的 bug；`ShieldBreak` 必须独立，因为它是 150 帧的大惩罚，要走专属动画与专属眩晕计时器 | 盾破后直接回 `Idle`，玩家无惩罚感；或把蹲与防拆成两个状态，蹲着时盾是"关"的 |
| **受击** | `Hitstun` `HitstunAir` `Tumble` `Reel` `Knockdown` `Getup` `GetupAttack` `TechRoll` | `Tumble` 是"可受身"的下落态，`Knockdown` 是"没受身"的倒地态——两者的选择权是玩家技术 | 把 `Tumble` 和 `Knockdown` 合并，受身机制消失 |
| **抓取** | `Grab` `GrabVictim` `GrabPummel` `Throw` | `GrabVictim` 是**被抓者**的状态，与抓人者分离，才能各自走 `stateFrame` | 被抓者没进 `GrabVictim`，导致其仍能输入 |
| **边缘** | `LedgeHang` `LedgeClimb` `LedgeRoll` `LedgeAttack` `LedgeJump` `LedgeDrop` | 六个出口给复归博弈提供深度（§6.6 架构文档） | 挂边无敌帧写成定值，五种出口无敌时长不同就错了 |
| **淘汰** | `Dead` `Respawn` `RespawnWait` | `Dead` 期间必须**停止一切结算**（不参与命中、不参与相机）；`RespawnWait` 是复活平台上的等待 | `Dead` 时仍参与 `resolveHits`，被打出界的角色还能"吃"一下 |

### 5.4 状态优先级与打断规则

优先级只在**同一帧有多个转移请求**时使用（典型场景：受击帧同时按了攻击）。

| 优先级 | 组 | 数值 | 可被谁打断 |
|---|---|---|---|
| 最高 | 淘汰 | 100 | 不可打断 |
| ↓ | 受击 | 80 | 不可打断（只能等 `hitstun` 归零） |
| ↓ | 抓取 | 70 | 不可打断（除挣脱） |
| ↓ | 边缘 | 60 | 不可打断 |
| ↓ | 防御 | 50 | 受击 > 防御；盾破强制转移 |
| ↓ | 攻击 | 40 | 受击、抓取、盾 |
| ↓ | 移动 | 20 | 攻击、盾、跳 |
| 最低 | 待机 | 10 | 任意 |

打断规则表（`✔` 可打断，`✘` 必须等硬直结束）：

| 当前状态 | 可被 攻击 | 可被 跳 | 可被 盾 | 可被 方向 | 备注 |
|---|---|---|---|---|---|
| `Idle` | ✔ | ✔ | ✔ | ✔ | |
| `Walk` | ✔ | ✔ | ✔ | ✔ | |
| `Run` | ✔（转冲刺攻击） | ✔ | ✔ | ✔ | 反向 = `Skid` |
| `JumpSquat` | ✘ | ✘ | ✔ | ✘ | 4 帧内只能取消为盾（防御性跳） |
| `Fall` | ✔ | ✔（二段跳） | ✔（空中闪避） | ✔ | |
| `FastFall` | ✔ | ✘ | ✘ | ✘ | 快落是承诺 |
| `AttackGround` | ✔（取消窗口内） | ✘ | ✔（窗口内） | ✘ | 见 §7.6 |
| `AttackAir` | ✘ | ✘ | ✘ | ✘ | 只有落地能结束 |
| `Crouch`（= 防御） | ✔（下段招） | ✔（蹲跳/穿台） | ✘ | ✔（起身） | 蹲跳在单向平台上 = 穿下去，见 §4.1 |
| `CrouchStun` | ✘ | ✘ | ✘ | ✘ | 盾被压制，只等硬直结束 |
| `Hitstun` / `HitstunAir` | ✘ | ✘ | ✘ | ✘ | 只有 DI，不改状态 |
| `Tumble` | ✘ | ✔（受身） | ✘ | ✔（DI） | |
| `Knockdown` | ✘ | ✘ | ✘ | ✔（起身方向） | |
| `GrabVictim` | ✘ | ✘ | ✘ | ✘ | 只能挣脱 |
| `LedgeHang` | ✔ | ✔ | ✔ | ✔ | 五种出口 |
| `Dead` | ✘ | ✘ | ✘ | ✘ | |

**为什么用数字优先级而不是 `if` 顺序**：`if` 顺序是隐式的，加一个状态就可能改掉所有旧行为。数字优先级让"谁赢"变成可测试的断言：随机注入两个转移请求，断言结果恒为高优先级者。

### 5.5 转移表片段：Idle

```ts
const IDLE: StateDef = {
  id: StateEnum.Idle,
  isGrounded: true,
  canTurn: true,
  canFastFall: false,
  hasGravity: true,
  transitions: [
    StateEnum.Walk,        // 方向键（轻推）
    StateEnum.Dash,        // 4 帧内 ≥2 帧同向 = 快速拨前
    StateEnum.CrouchStart, // 下 —— 3 帧前摇后进 Crouch，蹲下即防御
    StateEnum.JumpSquat,   // 跳（含 3 帧缓冲）
    StateEnum.AttackGround,// 攻击 + 方向
    StateEnum.Grab,        // 抓
    StateEnum.AirIdle,     // 脚下平台消失（平台被打掉 / 复活平台升起）
  ],
  update(w, f, input) {
    if (pressedWithin(f, B.ATTACK, BUFFER_FRAMES)) {
      f.moveId = resolveMove(input.bits, f.facing, true);
      setState(w, f, StateEnum.AttackGround);
      return;
    }
    // ... 其余分支
  },
};
```

这份表就是"Idle 能去哪"的**完整答案**。新加状态时必须问一句："谁应该能转到它？"，答案写进各来源状态的 `transitions`，写漏了断言当场抛错。

### 5.6 为什么不用行为树 / 不用动画回调驱动状态

**不用行为树**：

- 行为树擅长表达"多目标、可失败、可重试"的 AI 逻辑（`Selector` 里包 `Sequence`）。而格斗状态机的核心语义是**禁止**——从 `Hitstun` 不允许去任何地方。行为树没有"非法转移"概念，缺一条分支就静默落到 `undefined`，表现为"角色卡住"，而且卡在哪完全随机。
- 行为树天然要求"每帧 tick 整棵树"，节点顺序决定结果；这与"一个 `step()` 内严格的 7 段顺序"（输入 → 状态机 → 物理 → 碰撞 → 抓边 → 命中 → 事件）冲突。状态机是"当前状态调一次 `update`"，开销与状态数无关；行为树每帧遍历全树。
- 需要的"优先级"能力，用 §5.4 的数字表就够，不需要引入一棵树。

**不用动画回调驱动状态**：见 §7.5，一句话——回调是"事件驱动"，而回滚要求"每帧一个确定的函数求值"。

> 状态机也**不做**的事情：不播放动画、不发声、不发粒子。它只改 `state`/`stateFrame`，其余由 `SimEvent` 交给渲染层（L3）。

---

## 6. 攻击与帧数据（MoveSet）

### 6.1 类型定义

```ts
/** 一条可判定的攻击体。坐标为相对角色脚底中心、朝向前方为正 */
export interface Hitbox {
  id: number;                 // 同一 Move 内唯一，0 = 最高优先级（§6.7）
  from: number;               // 生效起始 moveFrame（含）
  to: number;                 // 生效结束 moveFrame（含）
  x: number; y: number;       // 圆心相对偏移（已含 facing 前的"向前"语义）
  r: number;                  // 半径
  damage: number;             // 0..40
  angle: number;              // 0..359 整数度（0 = 正前，90 = 正上，270 = 正下）
  baseKB: number;             // 0..120
  kbGrowth: number;           // 0..200（百分比写法，加载时 ÷100，见 §6.2）
  hitlagMul?: number;         // 默认 1.0
  isSakuraiAngle?: boolean;   // 默认 false（§6.6）
  canClank?: boolean;         // 默认 true，能否与对方 hitbox 相消
  group?: number;             // 多段判定的"同一次攻击"分组，同组只结算一次
}

export interface Hurtbox {
  from: number; to: number;
  boxes: { x: number; y: number; w: number; h: number }[];  // AABB
}

export interface Move {
  id: string;                 // 'air_forward'
  startup: number;            // 1..60，判定首帧 = startup
  active: number;             // 1..30
  recovery: number;           // 1..80
  landingLag?: number;        // 2..40，空中招落地硬直
  charge?: { maxFrames: number; dmgPer10: number; kbPer10: number };
  hitboxes: Hitbox[];
  hurtboxes: Hurtbox[];
}

/** 派生量，加载时算一次，不进数据文件 */
export interface MoveFrameData {
  total: number;              // startup + active + recovery - 1
  firstActive: number;        // = startup
  lastActive: number;         // = startup + active - 1
  firstActionable: number;    // = total + 1
  landingLag: number;
}
```

**`total` 的定义是 `startup + active + recovery - 1`**，因为 `startup` 帧就是第一个判定帧，被两侧共享。用架构文档 5.6 的示例验证：`8 + 5 + 14 - 1 = 26`，与该 JSON 里 `hurtboxes.to = 26` 一致。

### 6.2 JSON Schema（关键约束）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Move",
  "type": "object",
  "required": ["id", "startup", "active", "recovery", "hitboxes", "hurtboxes"],
  "additionalProperties": false,
  "properties": {
    "id":        { "type": "string", "pattern": "^[a-z][a-z0-9_]{2,31}$" },
    "startup":   { "type": "integer", "minimum": 1,  "maximum": 60 },
    "active":    { "type": "integer", "minimum": 1,  "maximum": 30 },
    "recovery":  { "type": "integer", "minimum": 1,  "maximum": 80 },
    "landingLag":{ "type": "integer", "minimum": 2,  "maximum": 40 },
    "hitboxes": {
      "type": "array", "minItems": 1, "maxItems": 8,
      "items": {
        "type": "object",
        "required": ["from","to","x","y","r","damage","angle","baseKB","kbGrowth"],
        "properties": {
          "from":     { "type": "integer", "minimum": 1 },
          "to":       { "type": "integer", "minimum": 1 },
          "x":        { "type": "number",  "minimum": -120, "maximum": 120 },
          "y":        { "type": "number",  "minimum": -160, "maximum": 120 },
          "r":        { "type": "number",  "minimum": 4,    "maximum": 80 },
          "damage":   { "type": "number",  "minimum": 0,    "maximum": 40 },
          "angle":    { "type": "integer", "minimum": 0,    "maximum": 359 },
          "baseKB":   { "type": "number",  "minimum": 0,    "maximum": 120 },
          "kbGrowth": { "type": "number",  "minimum": 0,    "maximum": 200 }
        }
      }
    }
  }
}
```

**`kbGrowth` 的单位约定（重要）**：数据文件里写 0–200 的整数（"成长百分比"），`loader` 归一化除以 100 后再进公式。架构文档的公式是

```
kb = ((((p/10) + (p*d)/20) * (200/(w+100)) * 1.4) + 18) * kbGrowth + baseKB
```

公式本身不动，`kbGrowth` 在公式里是 **0–2 的小数**（100 → 1.00）。若直接把 100 代进去，任何招式都会顶到 2500 的上限——这是最容易踩的坑，`loader` 必须做归一化并在 schema 之外再断言一次 `growth normalized ∈ [0, 2]`。

### 6.3 字段清单

| 字段 | 含义 | 范围 | 调大后 | 备注 |
|---|---|---|---|---|
| `startup` | 前摇，判定首帧 | 1–60 | 更难命中、更多反应时间 | 最快的 jab 3，最重的 smash 16 |
| `active` | 判定持续帧 | 1–30 | 更好打中、更容易被反打 | 一般 2–6；多段可到 15 |
| `recovery` | 后摇 | 1–80 | 更安全但更慢，连段变难 | **最主要的平衡旋钮** |
| `landingLag` | 空中招落地硬直 | 2–40 | 落地更易被惩罚 | 缺省 = `recovery` |
| `hitlagMul` | 顿帧倍率 | 0.5–2.0 | 打击感更"重"，但帧窗口被拉长 | 重击 1.15–1.3，轻击 0.9 |
| `baseKB` | 基础击飞 | 0–120 | 低百分比也飞得远 | 连段起手要**小**（30–40） |
| `kbGrowth` | 击飞成长 | 0–200（÷100） | 高百分比才致命 | 终结技 90–110，连段技 20–50 |
| `damage` | 伤害 | 0–40 | 同时抬高后续击飞（`p` 变大） | 亦影响 `hitlag` |
| `angle` | 击飞角度 | 0–359 | 改变连段路线 | 0 前 / 90 上 / 270 下（钉地） |
| `isSakuraiAngle` | 樱井角开关 | bool | 见 §6.6 | 击飞角按目标状态切换 |
| `shieldstunMul` | 盾硬直倍率 | 0.5–2.0 | 压制盾更强 | v1 固定 1.0，预留 |
| `canClank` | 能否相消 | bool | 关闭后不可被对拼打断 | 投射物与重击关掉 |
| `projectile` | 投射物 id | string | — | v1 仅 `磨刃` 的短程刀光用 |
| `id`（hitbox） | 判定优先级 | 0–7 | 越小越优先 | 强判定放前面 |
| `group`（hitbox） | 多段分组 | 0–7 | 同组只结算一次 | 多段招必填 |

### 6.4 hitbox JSON 示例

架构文档 5.6 的原始示例，逐字保留（这是 `li` 的 `air_forward`）：

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

### 6.5 完整招式清单（`li`，23 条）

`li` 是 v1 两个角色之一，设计见 §9。下表就是 `moveset.json` 的全部内容，`total = startup + active + recovery - 1`。

| # | moveId | 招式 | 地面/空中 | startup | active | recovery | total | damage | angle | baseKB | growth | hitlagMul |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `jab` | 正凿 | 地 | 3 | 2 | 8 | 12 | 3 | 80 | 34 | 20 | 1.00 |
| 2 | `tilt_forward` | 横凿 | 地 | 7 | 3 | 12 | 21 | 9 | 35 | 35 | 60 | 1.00 |
| 3 | `tilt_up` | 上撬 | 地 | 6 | 4 | 11 | 20 | 8 | 88 | 40 | 60 | 1.00 |
| 4 | `tilt_down` | 低撬 | 地 | 5 | 3 | 10 | 17 | 6 | 20 | 38 | 45 | 1.00 |
| 5 | `smash_forward` | 铆锤 | 地 | 16 | 4 | 30 | 49 | 17 | 42 | 45 | 100 | 1.15 |
| 6 | `dash_attack` | 推铲 | 地 | 9 | 4 | 22 | 34 | 10 | 50 | 30 | 75 | 1.00 |
| 7 | `air_neutral` | 旋身凿 | 空 | 4 | 3+2 | 13 | 24 | 4+6 | 45 | 25 | 55 | 1.00 |
| 8 | `air_forward` | 前钉 | 空 | 8 | 5 | 14 | 26 | 12 | 40 | 30 | 100 | 1.00 |
| 9 | `air_back` | 回钉 | 空 | 6 | 4 | 14 | 23 | 13 | 35 | 30 | 95 | 1.00 |
| 10 | `air_up` | 顶钉 | 空 | 5 | 4 | 10 | 18 | 10 | 78 | 35 | 80 | 1.00 |
| 11 | `air_down` | 坠钉 | 空 | 12 | 6 | 18 | 35 | 14 | 270 | 25 | 80 | 1.25 |
| 12 | `special_neutral` | 磨刃 | 地/空 | 10 | 4 | 18 | 31 | 8→14 | 30 | 25→40 | 55→78 | 1.15 |
| 13 | `special_side` | 拉砺 | 地/空 | 12 | 6 | 24 | 41 | 15 | 30 | 45 | 70 | 1.00 |
| 14 | `special_up` | 回磨 | 空 | 8 | 9 | 20 | 36 | 9/6 | 88 | 30/25 | 55/50 | 1.00 |
| 15 | `special_down` | 钉桩 | 空 | 14 | 5 | 22 | 40 | 10 | 80 | 30 | 55 | 1.10 |
| 16 | `grab` | 擒握 | 地 | 6 | 2 | 12 | 19 | 0 | — | — | — | — |
| 17 | `pummel` | 敲 | 抓中 | 4 | 1 | 9 | 13 | 2 | — | — | — | — |
| 18 | `throw_forward` | 前抛 | 抓中 | 10 | 2 | 20 | 31 | 8 | 45 | 60 | 45 | 1.00 |
| 19 | `throw_back` | 后抛 | 抓中 | 10 | 2 | 22 | 33 | 10 | 40 | 70 | 40 | 1.00 |
| 20 | `throw_up` | 上抛 | 抓中 | 12 | 2 | 24 | 37 | 7 | 88 | 65 | 50 | 1.00 |
| 21 | `throw_down` | 下抛 | 抓中 | 11 | 2 | 8 | 20 | 6 | 80 | 40 | 25 | 1.00 |
| 22 | `ledge_attack` | 挂边凿 | 边 | 18 | 3 | 18 | 38 | 8 | 60 | 40 | 50 | 1.00 |
| 23 | `getup_attack` | 起身横扫 | 地 | 14 | 4 | 20 | 37 | 7 | 70 | 30 | 40 | 1.00 |

补充说明：

- **#7 `air_neutral` 是两段判定**：f4–6（4%，`group:0`）、f10–11（6%，`group:1`），中间 f7–9 是空档。空档不是设计美学，是为了让"贴脸起手"有 1–2 帧可以被对手翻滚穿过的空间。
- **#12 `special_neutral` 带 `charge`**：`maxFrames: 40`，每蓄 10 帧 `damage +1.5`、`kbGrowth +5.75`。四个档位是离散的（Lv0 8%/55、Lv1 10%/62、Lv2 12%/70、Lv3 14%/78），因为存档和回放里只记录 `moveFrame`，中途松手时按达到的档位取整，避免出现 9.37% 这种数。
- **#14 `special_up` 两段**：f8–12 上升（9%，`group:0`）、f13–16 顶点（6%，`group:1`）。结束后进 `Fall` 且 `jumpsLeft = 0`、`airDodgesLeft = 0`（v1 不单列 `Helpless` 状态，用 `Fall` + 资源清零表达"力竭"，表现层按 `jumpsLeft === 0 && state === Fall` 播对应动画）。
- **#16 `grab` 没有 hitbox**：抓取走 `combat/grab.ts` 的独立判定（`grabRange` 圆 + `facing` 检查），不走 hitbox 表。原因：抓取不产生击飞、不进 `hitlag`，混进 hitbox 会污染命中结算。

### 6.6 樱井角（Sakurai Angle）

`isSakuraiAngle: true` 时，`angle` 字段被忽略，按**目标的着地状态**取两个固定角度：

| 目标状态 | 实际角度 | 表现 |
|---|---|---|
| 地面（`grounded === true`） | **44°** | 贴地滑出，不会立刻起飞 |
| 空中（`grounded === false`） | **88°** | 近乎垂直上抛，好接空中追打 |

**为什么这么设计**：同一招在地面命中时，玩家期待"打退"而不是"打飞"——低角度让伤害能累积而不脱离接触区，横向压制角色因此能持续施压。而目标在空中时，低角度会直接把人推出场外（空中没有摩擦），所以必须换成高角度。一个参数同时解决"地面压制的黏性"和"空中的公平性"。

实现只在一步：`resolveHits` 计算角度时

```ts
const ang = hb.isSakuraiAngle ? (victim.grounded ? 44 : 88) : hb.angle;
```

**坑**：樱井角与 DI 叠加时，先取基准角再加 DI（`±18°`），不是反过来。若先把 `angle` 加上 DI 再判断是否樱井角，地面命中会偶然突破 44°，出现"有时贴地、有时起飞"的诡异手感。

### 6.7 hitbox 的 id 与优先级（多段判定）

架构文档定义的优先级规则逐字保留：

1. 取 **hitbox 数组中的索引最小者**（帧数据里把强判定放前面）
2. 同一攻击对同一目标**只结算一次**（用 `moveId + hitboxId` 去重）
3. 双方同帧互中 → **trade**，两边都吃伤害和击飞

在此基础上，`id` 字段承担两件事：

- **`id` 小 = 优先**：同一帧有 2 个判定框都覆盖目标时，只结算 `id` 小的那个。典型用法是"甜点/酸点"——`id:0` 是刀尖（14%），`id:1` 是刀身（9%），两者几何重叠，靠 id 决定谁赢。
- **`group` 相同 = 同一次攻击**：多段招（如 `air_neutral`）用不同 `group`，才能连续结算两次；若忘了填 `group`，第二段会被"只结算一次"规则吃掉，表现为"这招只出一段"。

```json
"hitboxes": [
  { "id": 0, "group": 0, "from": 4,  "to": 6,  "x": 34, "y": -24, "r": 26,
    "damage": 4, "baseKB": 22, "kbGrowth": 40, "angle": 45 },
  { "id": 0, "group": 1, "from": 10, "to": 11, "x": 30, "y": -40, "r": 34,
    "damage": 6, "baseKB": 30, "kbGrowth": 60, "angle": 45 }
]
```

**排序纪律**：`hitboxes` 数组必须按 `id` 升序。加载期断言，否则"取索引最小者"和"取 id 最小者"会在某次手改 JSON 后悄悄分叉。

### 6.8 hitlagMul（顿帧倍率）

```ts
const hitlag = Math.floor(damage * 0.2 + 1) * hitlagMul;
```

| 伤害 | `hitlagMul = 1.0` | `1.25` | `1.5` |
|---|---|---|---|
| 3 | 1 | 1 | 2 |
| 6 | 2 | 2 | 3 |
| 10 | 3 | 3 | 4 |
| 14 | 3 | 3 | 5 |
| 17 | 4 | 5 | 6 |

**实现补充（工程约定，不改公式）**：结果必须 `Math.round` 成整数。`hitlag` 是每帧 `hitlag--` 递减的计数器，若存 4.6，会经历 4.6 → 3.6 → 2.6 → 1.6 → 0.6 → −0.4，实际冻结 5 帧而计数器写的是 4.6；小数还会在快照的 `Float64Array` 里产生位级差异，是 desync 的常见来源。

**`hitlagMul` 的用法**：`1.15–1.3` 给重击（顿帧更久 → 打击感更"实"），`0.9` 给多段轻击（否则每段都顿 3 帧，连段节奏全乱）。上表可见它有 **1 帧的量化误差**，所以不要用它做 ±5% 的微调——那个粒度不存在，微调应该改 `damage`。

**双方顿帧可以不同**：`hitlag` 由各自吃到的伤害算，所以"发招方按自己的 `hitlagMul`、被击方按自己的"是允许的（架构文档已明确这是连段多样性来源）。实现上 `hitlag` 是 `FighterState` 字段，天然分开。

### 6.9 帧数据怎么调

调帧数据有固定流程，跳过任何一步都会在后期付出十倍代价。

**第一步：从哪个数字开始试**

不要从"感觉"开始，从**同类招式的中位数**开始：

| 招式类型 | startup 起点 | active 起点 | recovery 起点 | 备注 |
|---|---|---|---|---|
| Jab | 3 | 2 | 8 | 最快的确认手段 |
| Tilt | 6–7 | 3 | 10–12 | |
| Smash | 15–16 | 4 | 30 | 前摇必须有代价 |
| 空中技 | 5–8 | 4–5 | 10–14 | |
| 必杀 | 10–14 | 4–6 | 18–26 | |

先填中位数，跑一遍，再按"这招想干什么"上下调 2–3 帧。

**第二步：每次只调一个参数**

一次改 `startup` + `damage` + `baseKB`，你无法知道是哪个起了作用。固定顺序：

```
1. 先定 damage（它同时影响 p、hitlag、kill%——牵一发动全身，先定死）
2. 再定 startup（决定这招"能不能用出来"）
3. 再定 active（决定"好不好打中"）
4. 再定 recovery（决定"打完安不安全"，以及连段可行性）
5. 最后才动 baseKB / kbGrowth / angle（决定"打中之后去哪"）
```

第 5 步放最后，因为前四项变了，击飞的落点全变，先调击飞等于白调。

**第三步：用调试可视化器看 hitbox**

`?debug=1` 下必须能看到的四层：

| 层 | 内容 | 颜色 |
|---|---|---|
| 逻辑层 | hurtbox AABB | 绿框 |
| 逻辑层 | hitbox 圆 + `id` 标号 | 红圈，`id:0` 加粗 |
| 逻辑层 | 本帧 `moveFrame` / `state` / `stateFrame` 文本 | 白字 |
| 表现层 | 动画当前帧 + pivot 十字 | 黄十字 |

判定框是**逐帧**生效的，只在第 `startup` 帧出现 2 帧的招式，肉眼在 60fps 下根本看不清。必须用"帧步进"模式（`F7` 单步一帧）逐帧看圆是否真的盖住对手的绿色 AABB。

**第四步：记录**

每次调整写一行到 `docs/tuning-log.md`（不入库也行，本地留档）：日期 / 招式 / 参数 / 旧值 → 新值 / 现象。**没有记录的调整等于没调**——三天后你会发现自己把同一个参数改回去了。

### 6.10 独有必杀：`SpecialDef` 与被方向派生的变体

普通招式是"骨架 + 角色微调"，**必杀是整个角色唯一不可互换的东西**。所以它不走 `MoveSet`，
而是单独一份 `SpecialDef[]`：

```ts
type SpecialKind = 'arrow' | 'bottle' | 'bomb' | 'banana' | 'trap' | 'grab'

interface SpecialDef {
  kind: SpecialKind
  name: string              // 显示名，进 UI 与回放审计
  slot: 0 | 1               // 绑哪个键：0 = U，1 = I
  dir?: AttackDir           // 可选：按住这个方向才出这一条
  cooldown: number          // 帧
  damage: number
  angle: number
  kbGrowth: number
  baseKB: number
  speedX: number            // 投射物初速，或投技的抓取距离
  speedY: number
  gravity: number           // 0 = 直线飞行
  life: number              // 存活帧数
}
```

**`slot` + `dir` 就是"方向 + 技能键出不同招"的全部实现**：同槽可以有多条，出招时先按
`pickSpecial` 取「同槽 + `dir` 精确匹配」的那条，匹配不到才回落到 `dir` 未定义的那条。

```ts
export function pickSpecial(f: Fighter, slot: 0 | 1, inp: InputState): SpecialDef | null {
  const pool = f.char.specials.filter((s) => s.slot === slot)
  if (pool.length === 0) return null
  const dir = pickAttackDir(inp, f.facing)
  return pool.find((s) => s.dir === dir) ?? pool.find((s) => s.dir === undefined || s.dir === 'neutral') ?? null
}
```

**这个函数必须写在 `battle-core` 而不是 `client`**，因为它是判定的一部分：同样的输入，
回滚重演时必须选出同一招。所以它不能读 `Date.now()`、不能读渲染时钟、不能依赖"当前按住了多久"。

**`specialDef` 必须在出招瞬间锁定并进快照。** 不能只存 `slot` 号：一个槽下有多条，
重演时如果重新按当时的输入再算一遍 `pickSpecial`，输入历史里"方向键在第 3 帧松开"这类
细节一旦有偏差就会打出另一招。存住 `specialDef` 是唯一稳的做法。

**六种 `kind` 的差别只在于 `Projectile` 的生命周期，不在命中判定上**：

| kind | 形态 | 关键参数 | 代表角色 |
|---|---|---|---|
| `arrow` | 直线飞行，`gravity = 0` | `speedX 17`，`life 80` | 葵（灯芯箭） |
| `bottle` | 抛物线，落地炸开 | `speedY -4.5`，落地转 18 帧爆炸 | 砺（砸酒瓶） |
| `bomb` | 抛物线，落地引信 46 帧后炸 | `speedY -5.2` | 肯（铁砂雷） |
| `banana` | 抛物线，落地后**留在场上**当陷阱 | `life 480`，踩到滑倒 26 帧 | 葵（灯油香蕉皮） |
| `trap` | 布置在脚前地面，布防 36 帧后生效 | `speedX` 是布置距离 | 砺（捕兽夹） |
| `grab` | 无投射物，`speedX` 是抓取距离（64px） | 同帧结算 | 肯（铁臂投） |

`grab` 走的是 `attackBox` 的 special 分支而不是投射物队列——投技必须**同帧**结算，
不能有"投出去一个看不见的东西"这种中间态。

**方向变体的设计用途**：不是为了"多几招"，而是让同一个槽在不同距离/高度上都能用。
例：砺的 `bottle` 默认平抛（近身压制），`dir:'up'` 是高抛（越过平台砸），
`trap` 默认布在脚前 44px（自保），`dir:'down'` 是布在 78px 外（封退路）。
**一个槽两条变体，等于让玩家用方向表达"我想现在用还是待会用"。**

### 6.11 冲刺与角色冲刺差异

冲刺是**唯一一个"角色之间手感差异不用改招式表"的地方**——四个参数直接乘在全局常量上：

```ts
interface CharDef {
  // ...
  dashSpeedMul?: number     // 乘 DASH_SPEED = 17
  dashFramesMul?: number    // 乘 DASH_FRAMES = 14
  airDashes?: number        // 空中冲刺次数，默认 1
  dashCooldown?: number     // 覆盖全局 26 帧
  dashAttackMul?: number    // 冲刺攻击伤害倍率（文档用，实际不改伤害而是靠角色 moveOverrides）
}
```

| 角色 | 冲刺速度 | 冲刺帧数 | 冷却 | 空冲次数 | 设计意图 |
|---|---|---|---|---|---|
| 磨刀匠·砺 | ×1.00（标准） | ×1.00 | 26 帧 | 1 | 没有位移天赋，靠道具铺场 |
| 灯守·葵 | ×1.12（快） | ×1.10（长） | **20 帧** | **2** | 复归能力最强，被打出去也回得来 |
| 铁皮·肯 | ×0.90（慢） | ×0.85（短） | **32 帧** | 1 | 走一步是一步，但冲刺攻击最重 |

**为什么用倍率而不是绝对值**：全局 `DASH_SPEED` 一改，三个角色的相对关系自动保持。
如果每个角色写 `17 / 19 / 15`，未来调手感时得改三处、而且很容易改出"快的人变得比慢的人还慢"。
这和 §2.1「倍率而非绝对值」是同一条原则。

**冲刺攻击是另一套帧数据（`DASH_MOVES`），不吃 `moveOverrides`。** 理由很实际：
轻角色（葵）的 `forward` 起手被改到 5 帧、伤害降到 11，如果冲刺攻击也继承这套微调，
她的冲刺重击会变成"又快又软"，冲刺就彻底没有意义了。所以冲刺攻击单独一套基准值，
只乘一个角色系数 `dashAttackMul`（葵 ×0.85 / 砺 ×1.0 / 肯 ×1.2）。

`DASH_MOVES` 的九套基准值：

| 方向 | 起手 | 判定 | 收招 | 判定框 | 伤害 | 角度 | 击飞增长 |
|---|---|---|---|---|---|---|---|
| `neutral` | 7 | 5 | 14 | 44×28 | 13% | 42° | ×1.20 |
| `forward` | 9 | 6 | 20 | 70×36 | 17% | 38° | ×1.35 |
| `back` | 8 | 5 | 17 | 46×30（`boxBack`） | 14% | 132° | ×1.10 |
| `up` | 6 | 6 | 16 | 36×44 | 11% | 86° | ×1.40 |
| `upForward` | 8 | 6 | 18 | 48×38 | 15% | 58° | ×1.25 |
| `upBack` | 8 | 5 | 17 | 46×34（`boxBack`） | 13% | 118° | ×1.15 |
| `down` | 8 | 6 | 16 | 40×30 | 14% | -62° | ×1.15 |
| `downForward` | 7 | 8 | 16 | 62×26 | 13% | 22° | ×1.10 |
| `downBack` | 7 | 6 | 16 | 44×30（`boxBack`） | 13% | 158° | ×1.10 |

`boxBack: true` 表示判定框开在**身后**（用 `-attackFacing`）——回身类招式必须这样，
否则"回身打"打不到背后的人，只有动画在回头。

---

## 7. 动画系统

这一章是本文档相对架构总纲的**主要增量**。架构文档只有"Pixi 渲染 + 插值"一句，没有动画设计；而角色手感的一半来自动画。

### 7.1 动画与逻辑分离的根本原因

先摆两个失败方案，理解它们为什么失败，才能理解正确方案。

**方案 A：动画跟着逻辑状态走，回滚时动画也回退**

```
帧 40: 逻辑在 Fall,  动画播 fall 第 10 帧
帧 41: 收到远端输入 → 回滚到 34，重演 35..41
       重演期间 state 反复变化 → 动画帧数来回横跳
帧 41: 重演完成，逻辑定在 Hitstun
       动画从 fall 第 10 帧 → 中间闪过 3 个状态 → Hitstun
```

表现是**抽搐**：攻击动作重播、受击闪烁、角色像被快进回退。这违反 L3（渲染层写回）的延伸——渲染层不能拥有"逻辑会回退而它不回退"的独立时间轴。

**方案 B：动画按真实时间播放（`deltaTime` 累加）**

```
逻辑：60Hz 固定步长，第 8 帧出判定
渲染：144Hz 显示器，1 秒内渲染 144 次
动画：按 dt 累加 → 1 秒播 1 秒的动画
```

问题：逻辑与动画的时间基准不同。掉一帧（16.6ms）时逻辑可能追 2 步，动画只走 1 步 → **判定已经发生了，动画还在前摇**。玩家看到的现象是"我明明还在抬手，对面就飞了"。

**正确方案：动画是逻辑状态的纯函数投影**

```
动画帧 M = f(state, stateFrame, moveId, moveFrame)
```

- 逻辑帧 N 唯一决定动画帧 M。同样的 `FighterState`，无论何时求值，得到的动画帧相同。
- **只有"当前不处于回滚重演"时才推进动画**——更准确地说：动画根本不"推进"，它每帧被**重新求值**。所谓"推进"只是 `stateFrame` 自增带来的结果。
- 回滚重演期间不渲染（重演 7 帧 < 7ms，在一帧渲染预算内完成，不产生画面），重演结束后按**新的**状态重新求值，动画直接跳到正确的那一帧，不播过渡。

这条规则带来一个必须接受的取舍：**回滚后动画会"跳帧"**。这是对的——宁可跳一帧，也不要抽搐。玩家在 60fps 下对"跳一帧"几乎无感，对"抽搐"极其敏感。

### 7.2 动画状态机（AnimationState）

`AnimationState` 与 `StateEnum` 不是一对一。三种关系都存在：

| 关系 | 例子 | 原因 |
|---|---|---|
| **一对一** | `JumpSquat → jumpsquat` | 状态与动作同构 |
| **一对多** | `AttackGround → atk_jab / atk_ftilt / atk_dtilt…` | 一个状态承载 10 个招式，靠 `moveId` 分 |
| **一对多（条件）** | `Fall → jump_rise / fall / fastfall / helpless` | 同一状态，靠 `vy` / `jumpsLeft` 分 |
| **多对一** | `RunStart` `Run` `RunStop` → `run` | 三段逻辑，一段连续动画 |
| **多对一（共享）** | `Crouch`（含 `CrouchStun`）→ `crouch` | 盾被压制只在原地抖一下，不值得单画 |

映射表直接写在 `anim.json`（纯数据，可热改）：

```jsonc
{
  "Idle":        { "clip": "idle",     "loop": true,  "hold": 2 },
  "Walk":        { "clip": "walk",     "loop": true,  "hold": 1,
                   "speedVariant": [["walk", 3.0]] },
  "Run":         { "clip": "run",      "loop": true,  "hold": 1 },
  "RunStart":    { "clip": "run_start","loop": false, "hold": 1 },
  "RunStop":     { "clip": "run_stop", "loop": false, "hold": 1 },
  "Skid":        { "clip": "skid",     "loop": false, "hold": 1 },
  "JumpSquat":   { "clip": "jumpsquat","loop": false, "hold": 1 },
  "Fall": {
    "clip": "fall", "loop": true, "hold": 1,
    "branches": [
      { "when": "vy < 0",                 "clip": "jump_rise",  "loop": false },
      { "when": "vy >= 0 && fastFall",    "clip": "fastfall",   "loop": true  },
      { "when": "jumpsLeft === 0 && !hasRecovery", "clip": "helpless", "loop": true }
    ]
  },
  "AttackGround": { "clipByMove": true, "loop": false, "hold": 1 },
  "AttackAir":    { "clipByMove": true, "loop": false, "hold": 1 },
  "Crouch":      { "clip": "crouch",   "loop": true,  "hold": 2 },
  "CrouchStun":  { "clip": "crouch",   "loop": true,  "hold": 2, "shakeX": 2 },
  "ShieldBreak": { "clip": "break",    "loop": false, "hold": 1 },
  "Hitstun":     { "clip": "hit",      "loop": false, "hold": 1 },
  "HitstunAir":  { "clip": "hit_air",  "loop": false, "hold": 1 },
  "LedgeHang":   { "clip": "ledge",    "loop": true,  "hold": 2 },
  "Dead":        { "clip": "ko",       "loop": false, "hold": 1 }
}
```

`clipByMove: true` 表示按 `moveId` 查 `li/atk_${moveName}`，这层查表在 `resolve()` 里做，不展开成 23 条 JSON（否则数据文件会膨胀且容易漏）。

**校验**：`loader` 断言每个 `StateEnum` 值在 `anim.json` 里都有条目。新增状态忘了配动画，构建期就报错，而不是等到运行时角色变成"隐形人"。

### 7.3 驱动方式：帧驱动，不是时间驱动

```ts
// ✅ 帧驱动：纯函数，无累加器
function animFrameOf(f: Readonly<FighterState>, clip: AnimationClip): number {
  if (clip.loop) return (f.stateFrame / clip.hold | 0) % clip.frames.length;
  return Math.min((f.stateFrame / clip.hold | 0), clip.frames.length - 1);
}
```

| 对比项 | 帧驱动（采用） | 时间驱动（放弃） |
|---|---|---|
| 时间基准 | 逻辑帧（整数） | `performance.now()` 差值 |
| 掉帧时 | 动画与判定同步缺帧 | 动画继续走，与判定错位 |
| 高刷屏 | 无影响（渲染层插值） | 动画播得更快（144Hz 下 2.4 倍速） |
| 回滚 | 完全可重放 | 不可重放 |
| 暂停 | 不推进即可 | 需要处理时间差 |

**高刷屏怎么不出问题**：渲染层拿 `alpha = accumulator / STEP_MS`（0..1），在**两个逻辑帧的动画之间**插值位置，但**不插值动画帧号**——动画帧是离散的，插值会得到"两个动作的混合"，看起来是重影。所以：位置插值，动画帧取整。

```ts
// 渲染：位置线性插值，动画帧不插值
const px = lerp(f.prevX, f.x, alpha);
const py = lerp(f.prevY, f.y, alpha);
const frame = animFrameOf(f, clip);       // 整数，不插值
```

**唯一允许用真实时间的动画**（都在 `client`，不参与判定）：

| 内容 | 为什么可以用 `dt` |
|---|---|
| 相机缓动 / 屏幕震动 | 纯表现，不影响谁赢 |
| 命中特效 / 粒子 / 残影 | 同上 |
| UI 过渡（选人、结算） | 与对局无关 |
| 血条百分比滚动 | 数字跳变会让玩家误读 |
| 角色动作 | **不可以**——它必须和判定帧严格对应 |

### 7.4 过渡规则

过渡（transition）指"从动画 A 切到动画 B 时是否混合"。混合不是越多越好：受击混合 = 反馈变糊。

| # | from → to | 方式 | 时长（逻辑帧） | 理由 |
|---|---|---|---|---|
| 1 | `idle ↔ walk` | 混合 | 4 | 重心连续移动，硬切会"弹一下" |
| 2 | `walk ↔ run` | 混合 | 4 | 同上 |
| 3 | `run → skid` | 混合 | 2 | 有刹车感但不能糊 |
| 4 | `任意 → jumpsquat` | 混合 | 2 | 起跳要"脆" |
| 5 | `jumpsquat → jump_rise` | 硬切 | 0 | 离地瞬间必须清晰 |
| 6 | `fall → land` | 硬切 | 0 | **落地必须"咔"一下**，这是重量感的主要来源 |
| 7 | `land → idle` | 混合 | 3 | |
| 8 | `任意 → hitstun` | **硬切** | 0 | 受击反馈必须瞬时，混合等于削弱打击感 |
| 9 | `hitstun → idle / fall` | 混合 | 2 | |
| 10 | `任意 → 攻击` | 硬切 | 0 | 出招起手要干脆 |
| 11 | `攻击 → 任意` | 硬切 | 0 | 收招边界要清晰 |
| 12 | `任一下蹲 → crouchstun` | 硬切 | 0 | 盾被压制要立刻反馈 |
| 12b | `crouch → shieldbreak` | **硬切** | 0 | 破盾必须"炸开"，混一点点就失去惩罚感 |
| 12c | `shieldbreak → idle` | 混合 | 6 | 解晕有个回魂过程，但只是视觉，逻辑上仍是硬直 |
| 13 | `任意 → ko` | 硬切 | 0 | |
| 14 | `stateFrame 回退（回滚后）` | **同步** | 0 | 直接设到目标帧，见 §7.8 |

实现上是查一张 `"from>to"` 的表，未登记的组合默认**硬切**（安全默认：宁可硬切也不要乱混）。

```ts
const TRANSITIONS: Record<string, { blend: number }> = {
  'idle>walk':   { blend: 4 },
  'walk>idle':   { blend: 6 },
  'walk>run':    { blend: 4 },
  'run>skid':    { blend: 2 },
  '*=jumpsquat': { blend: 2 },   // 通配前缀
};
function lookupTransition(from: string, to: string) {
  return TRANSITIONS[`${from}>${to}`] ?? TRANSITIONS[`*=${to}`] ?? { blend: 0 };
}
```

**注意通配符合法性**：只在**过渡表**里允许 `*=to`（表现层优化），绝不允许出现在 `StateDef.transitions`（逻辑层）。逻辑转移必须逐条列举，这是 §5.2 的硬规则。

### 7.5 为什么不用"动画事件回调"触发游戏逻辑

这是回滚架构的头号死敌，必须写清楚。

```ts
// ❌ 典型错误：在动画时间轴上挂事件
clip.onFrame(12, () => spawnHitbox(fighter, 'air_forward'));
clip.onFrame(26, () => endAttack(fighter));
```

失败链条：

1. **回调时机不确定**。回调挂在"播放到第 12 帧"上，而"播放到第 12 帧"取决于渲染循环。一次掉帧后 `stateFrame` 从 10 直接跳到 13，第 12 帧**永远不会被播放** → 判定框没生成，这一招空了。
2. **回滚时重复触发**。重演 7 帧会重新播放经过的动画帧，回调被调第二次、第三次 → 生成 3 个 hitbox，或者伤害结算 3 次。
3. **回调里改状态 = 渲染层写回模拟**（违反 L3）。回调由动画系统驱动，动画系统属于 view 层。
4. **顺序不可控**。回调在 `requestAnimationFrame` 里执行，与 `step()` 的 7 段顺序（输入 → 状态机 → 物理 → 碰撞 → 抓边 → 命中 → 事件）毫无关系，可能发生在物理之后、命中之前。

**正确写法**：判定完全由 `moveFrame` 的整数比较决定，写在 `stateHandlers` 里。

```ts
// ✅ 在 step() 内，每帧无条件求值
function updateAttack(w: World, f: FighterState, mv: Move) {
  f.moveFrame++;
  for (const hb of mv.hitboxes) {
    if (f.moveFrame < hb.from || f.moveFrame > hb.to) continue;
    for (const t of w.fighters) {
      if (!t.active || t.id === f.id) continue;
      if (t.intangibility > 0) continue;
      if (hitCircleVsAABB(hb, f, t)) queueHit(w, f, t, hb);   // 同帧结算（L6）
    }
  }
  if (f.moveFrame > frameData(mv).total) endMove(w, f);
}
```

这个写法天然满足：可重放（纯加法）、可回滚（`moveFrame` 在快照里）、顺序确定（在 `step()` 的第 2 段）、同帧结算（L6）。

**音效、特效同理**：不是"在动画第 12 帧播音效"，而是逻辑层在命中时 `w.events.push({t:'hit', ...})`，渲染层消费事件播放。事件**不入快照**（回滚时重放产出），这是架构文档 5.7 的既定结论。

### 7.6 动画取消窗口（cancel window）

取消窗口是"招式还没播完，但可以被别的动作打断"的帧区间。它是**帧数据的属性**，不是动画的属性，但它决定了动画怎么设计（被取消时动画如何中断）。

| 招式 / 状态 | 取消窗口（moveFrame） | 可取消为 | 条件 |
|---|---|---|---|
| `jab` | 6–10 | `jab`（第二段） | 命中或打盾 |
| `jab` | 11–12 | `tilt_forward` / `tilt_down` | 命中 |
| `tilt_forward` | 无 | — | 打空不可取消 |
| `air_neutral` | 无 | — | 落地结束 |
| `special_neutral` 蓄力 | 1–40 | `Crouch` / `JumpSquat` | **随时**（蓄力可取消，这是它的强度来源） |
| `grab`（抓空） | 14–19 | 无 | 抓空后摇是固定的惩罚 |
| 任意空中招 | 落地帧 | `Landing` 或 `LandingLag` | 见下"自动取消" |
| `special_up` | 无 | — | 复归技不可取消 |
| `dash_attack` | 无 | — | |
| `ledge_attack` | 无 | — | |
| `throw_*` | 无 | — | |
| `Hitstun` | 无 | — | 只有 DI |

**自动取消（auto-cancel）**：空中招在 `moveFrame < 3` 或 `moveFrame > total - 3` 时落地，按普通落地处理（4 帧）；落在判定窗口内或刚结束，则吃完整 `landingLag`。

```ts
const fdata = frameData(mv);
const late = f.moveFrame > fdata.total - 3;
const early = f.moveFrame < 3;
const lag = (early || late) ? LANDING_FRAMES : fdata.landingLag;
```

**为什么要有这个机制**：它给了高手一个"用招式边缘帧落地"的技巧（晚出招 = 更安全），而不需要引入 L-cancel 这种额外按键（v1 明确不做，见架构文档 D3）。用 3 帧窗口而不是"整个 recovery"，是为了让技巧有难度但不需要帧完美。

**取消窗口对动画的要求**：被取消时动画要能被"剪断"。所以招式的动画必须**允许在中途停止并切到新动画**，不能依赖"播完才允许切"。这就是为什么 §7.4 里"攻击 → 任意"是硬切（0 帧混合）：一旦取消发生，重影会暴露"这招其实没打完"。

### 7.7 AnimationController 接口与实现

先给**纯函数投影**（推荐，覆盖 90% 场景）：

```ts
export interface AnimationClip {
  key: string;              // 'li/atk_fair'
  frames: number[];         // 图集帧索引序列
  hold: number;             // 每张图停留几个逻辑帧（≥1）
  loop: boolean;
  pivot: { x: number; y: number };  // 相对图像左上角，见 §8.4
  /** ★ 刻意不提供 fps 字段：动画不按时间播放 */
}

/** 纯函数：FighterState → 图集帧索引 */
export function atlasFrameOf(f: Readonly<FighterState>, clip: AnimationClip): number {
  const i = Math.min((f.stateFrame / clip.hold) | 0, clip.frames.length * clip.hold - 1);
  const n = clip.frames.length;
  const idx = clip.loop ? i % n : Math.min(i, n - 1);
  return clip.frames[idx];
}
```

需要混合时才引入有状态的控制器。**注意它的状态必须能从逻辑状态重建**——这是"有状态但仍合规"的关键：

```ts
export interface AnimationController {
  readonly current: string;
  readonly frameIndex: number;
  /** 由逻辑状态投影出"应该播哪个 clip"，纯函数 */
  resolve(f: Readonly<FighterState>): string;
  /** 每"已提交"的逻辑帧调用一次；rewinding 时必须直接返回 */
  advance(f: Readonly<FighterState>, rewinding: boolean): void;
  /** 回滚重演结束后对齐，禁止过渡 */
  reconcile(f: Readonly<FighterState>): void;
  atlasFrame(): number;
  blend(): { from: string | null; t: number };   // t: 0..1
}
```

```ts
const BLEND_FRAMES = 4;

export class FighterAnimController implements AnimationController {
  private cur = 'idle';
  private prev: string | null = null;
  private t = 0;                      // 混合进度 0..1
  private idx = 0;

  constructor(
    private readonly map: AnimMap,
    private readonly clips: ReadonlyMap<string, AnimationClip>,
  ) {}

  get current() { return this.cur; }
  get frameIndex() { return this.idx; }

  resolve(f: Readonly<FighterState>): string {
    const def = this.map[f.state];
    if (def.clipByMove) return `atk_${MOVE_NAMES[f.moveId]}`;
    for (const b of def.branches ?? []) if (evalCond(b.when, f)) return b.clip;
    return def.clip;
  }

  advance(f: Readonly<FighterState>, rewinding: boolean): void {
    if (rewinding) { this.t = 0; this.prev = null; return; }   // ★ 重演期间不动
    const next = this.resolve(f);
    if (next !== this.cur) {
      const blend = lookupTransition(this.cur, next).blend;
      this.prev = blend > 0 ? this.cur : null;
      this.t = blend > 0 ? 1 : 0;
      this.cur = next;
      this.idx = 0;
    }
    const clip = this.clips.get(this.cur)!;
    this.idx = clip.loop
      ? (this.idx + 1) % clip.frames.length
      : Math.min(this.idx + 1, clip.frames.length - 1);
    if (this.t > 0) this.t = Math.max(0, this.t - 1 / BLEND_FRAMES);
  }

  reconcile(f: Readonly<FighterState>): void {
    this.cur = this.resolve(f);        // 直接对齐，不播过渡
    this.prev = null; this.t = 0;
    this.idx = animFrameOf(f, this.clips.get(this.cur)!);
  }

  atlasFrame() { return this.clips.get(this.cur)!.frames[this.idx]; }
  blend() { return { from: this.prev, t: this.t }; }
}
```

三处 `★` 是这个类的全部要点：`rewinding` 时不动、`reconcile` 时不混合、`blend` 只对外暴露进度而不暴露"帧号插值"。

### 7.8 回滚期间的动画处理流程

```ts
function renderFrame() {
  const alpha = accumulator / STEP_MS;

  // 1. 重演中：不渲染、不推进（重演 < 7ms，落在同一渲染帧内）
  if (net.isReplaying) return;

  // 2. 每"已提交"的逻辑帧推进一次动画
  if (net.committedFrame !== lastAnimFrame) {
    lastAnimFrame = net.committedFrame;
    for (const v of views) v.anim.advance(v.fighter, false);
  }

  // 3. 绘制：位置插值，动画帧取整
  for (const v of views) {
    const px = lerp(v.fighter.prevX, v.fighter.x, alpha);
    const py = lerp(v.fighter.prevY, v.fighter.y, alpha);
    v.sprite.texture = v.atlas.texture(v.anim.atlasFrame());
    v.sprite.position.set(px, py);
    v.sprite.scale.x = v.fighter.facing;     // 镜像，见 §8.5
  }
}
```

**重演结束后必须调 `reconcile`**：

```ts
// netcode 完成重演后
onReplayDone() {
  for (const v of views) v.anim.reconcile(v.fighter);
}
```

原因：重演可能改变历史。玩家在第 40 帧预测"对方没打我"，实际对方打了——重演后第 40 帧的真实状态是 `Hitstun`，而本地视觉上刚才正在播 `fall`。此时 `resolve()` 会给出 `hit`，与 `cur` 不同。若走 `advance()` 的正常路径，会播一个 2–4 帧的混合过渡，看起来是"慢慢变成受击"——**错误**。受击必须是瞬时的，所以 `reconcile` 硬切。

**一张表说清动画层的状态归属**：

| 动画层持有 | 是否必须可从模拟状态重建 | 若不能重建会怎样 |
|---|---|---|
| 当前 clip key | ✅ 由 `resolve()` 重建 | 回滚后播错动作 |
| 当前帧索引 | ✅ 由 `stateFrame/held` 重建 | 回滚后动作错位 |
| 混合进度 `t` | ❌ 允许丢失（丢弃即硬切） | 仅视觉瑕疵 |
| 一次性特效队列 | ❌ 允许丢失 | 仅视觉瑕疵 |

**判据**：任何"丢了就会播错动作"的状态都必须可重建；任何"丢了只是这帧不好看"的状态可以随便丢。这条判据比"能不能进快照"更好用，因为动画层根本不该进快照。

---

## 8. 动画资源与制作规范

### 8.1 每个状态需要多少帧

> **先读这条，避免误读整章**：第 7 章与本章的 `clip` / `frames[]` / 图集，是**序列帧后端**的具体形态。项目主选的美术后端是**自研部件骨骼**（`rig.json` + `poses.json`，见 [UI 与美术](./04-ui-art.md) 第 7.4 节），它把"画 N 张图"换成"写 N 组角度"。逻辑侧规则（帧驱动、一跳一帧、取消窗口硬切、回滚重演不渲染）三种后端**完全相同**，差别只在"逻辑第 K 帧"落到美术上是"第 K 张图"还是"第 K 组部件角度"。下表 `绘制帧数` 一列：部件骨骼读作**需要多少个关键姿势**（3–5 个就够，中间靠线性插值），序列帧读作**要画多少张图**。§8.6 的图集规范只对序列帧生效。

帧数 = 逻辑帧数 ÷ `hold`。**攻击动作 `hold` 必须是 1**（逐帧），移动类可以 2。

| 动画 | 逻辑帧数 | hold | 绘制帧数 | 循环 | 备注 |
|---|---|---|---|---|---|
| `idle` | 96 | 2 | 48 | ✅ | 呼吸感，2 秒一轮 |
| `walk` | 16 | 1 | 16 | ✅ | 4 帧一个步态循环 × 4 |
| `run` | 12 | 1 | 12 | ✅ | |
| `run_start` | 3 | 1 | 3 | ❌ | |
| `run_stop` | 6 | 1 | 6 | ❌ | |
| `skid` | 8 | 1 | 8 | ❌ | |
| `jumpsquat` | 4 | 1 | 4 | ❌ | 必须逐帧（4 帧是玩家能感知的） |
| `jump_rise` | 5 | 1 | 5 | ❌ | |
| `fall` | 8 | 1 | 8 | ✅ | |
| `fastfall` | 6 | 1 | 6 | ✅ | |
| `land` | 4 | 1 | 4 | ❌ | |
| `land_heavy` | 6 | 1 | 6 | ❌ | |
| `hit` | 8 | 1 | 8 | ❌ | 受击必须逐帧 |
| `hit_air` | 8 | 1 | 8 | ❌ | |
| `crouch` | 8 | 2 | 4 | ✅ | 下蹲/防御共用，盾在其上单独绘制 |
| `ledge` | 8 | 2 | 4 | ✅ | |
| `jab` | 12 | 1 | 12 | ❌ | 攻击全部逐帧 |
| `tilt_forward` | 21 | 1 | 21 | ❌ | |
| `smash_forward` | 49 | 1 | 49 | ❌ | 最长的单招 |
| `air_forward` | 26 | 1 | 26 | ❌ | |
| `throw_forward` | 31 | 1 | 31 | ❌ | |
| `ko` | 20 | 1 | 20 | ❌ | |

**总预算**：单角色约 **420–520 张**绘制帧。按 256×256 上限开图集，2048×2048 一张能放 64 帧，需要 7–8 张——超标。所以单帧尺寸要压到 **128×128**（角色高 64–74 逻辑像素，在 1280×720 视口里 2 倍放大，128 足够），一张图集放 256 帧，2–3 张搞定。

### 8.2 循环帧与单次播放帧

| | 循环（`loop: true`） | 单次（`loop: false`） |
|---|---|---|
| 用于 | `idle` `walk` `run` `fall` `crouch` `ledge` | 全部攻击、受击、跳跃、落地、投技 |
| 帧索引 | `stateFrame % frames.length` | `min(stateFrame, frames.length - 1)` |
| 首尾帧 | **首尾必须能接上**（第 N 帧接第 1 帧不能跳） | 首帧 = 进入姿势，尾帧 = 可衔接姿势 |
| 状态结束时 | 停在任意帧都合理 | 必须播到尾帧或指定帧 |

**循环动画的首尾衔接是硬要求**。`idle` 的第 48 帧如果和第 1 帧差 3 像素，角色会每 2 秒"抖"一次。检查方法：在动画编辑器里把首尾帧并排放大到 400%，逐像素比对 pivot 与轮廓。

**单次动画的尾帧必须"能接"**：`land` 的最后一帧姿势要接近 `idle` 的第一帧，否则从 `land` 硬切到 `idle` 会有明显的姿态跳变。这条不写在代码里，只能靠规范——所以列在这里，作为美术交付的验收项。

### 8.3 关键帧对齐到逻辑帧

**规则：绘制的第 K 帧 = 逻辑的第 K 帧，一一对应，禁止"时间拉伸"。**

反例（必须拒绝）：

```
逻辑：startup 8，判定在第 8 帧
动画：前摇画了 12 帧，因为"12 帧看起来才有力量"
```

结果：玩家看到手抬到一半判定就出了，感觉"判定比动作快 4 帧"——这是最伤信任感的手感问题，比数值不准严重得多。

**对齐流程**：

1. 先定帧数据（`startup / active / recovery`）。
2. 按下表切成三段，动画帧数**必须**等于逻辑帧数（`hold = 1`）。
3. 第 `startup` 帧 = 判定首帧。**这一帧必须是动作的视觉最高点**（最大伸展 / 最亮 / 最快）。
4. 第 `startup + active - 1` 帧 = 判定末帧，动作开始回收。
5. 第 `total` 帧 = 可行动的姿势。

| 段 | 逻辑帧区间 | 绘制要求 |
|---|---|---|
| 前摇 | `1 .. startup-1` | 蓄力感，逐帧加速（前 30% 帧慢、后 70% 帧快） |
| 判定 | `startup .. startup+active-1` | **最高点必须在首帧**，不能在第 3 帧 |
| 后摇 | `startup+active .. total` | 收招，逐帧减速 |

"前摇加速"是廉价但有效的技巧：7 帧前摇画成 4:3 的帧间距（前 3 帧占 2 帧时间、后 4 帧占 5 帧），看起来比匀速快。但**帧数不能变**，只是把关键姿势往前后挪。

### 8.4 锚点 / pivot：为什么必须在脚底中心

逻辑坐标 `(x, y)` 的定义是**角色脚底中心**，`y` 向下为正，hurtbox 是相对这个点的 AABB（`[-w/2, -h] .. [w/2, 0]`）。动画必须用同一个锚点，否则：

```
pivot 在图像中心 → 角色"半截埋进地里"
pivot 在头顶      → 起跳时整体下移
pivot 每张图不同  → 循环动画原地上下抖动
```

**规范**：

| 项 | 要求 |
|---|---|
| pivot 位置 | 脚底轮廓的**左右中心点**，y 在脚底线的**最低点** |
| 精度 | 整数像素（避免半像素采样糊边） |
| 一致性 | **同一角色的全部动画共用同一个 pivot** |
| 例外 | 无。翻滚、倒地也要把 pivot 放在"假如站起来"的脚底位置 |

最后一条反直觉但必要：`Roll` 时角色是躺着的，如果 pivot 跟着躺下的身体中心走，站起来时会"弹"一下。正确做法是**躺下时身体绕脚底中心旋转**，pivot 不动。代价是美术作画时要把角色画出画布边界（允许越界，图集留 padding 即可）。

```
      ┌─ 画布 128×128 ─┐
      │                │
      │     ╱▔▔╲       │   ← 角色图形
      │    ( o  o )     │
      │     ╲__╱       │
      │      ║║        │
      └──────╫╫────────┘
             ▲
          pivot (64, 120)   ← 脚底中心，离画布底 8px（留描边/阴影）
```

### 8.5 镜像翻转，而不是画两套

角色永远只画**朝右**一套。运行时：

```ts
// 序列帧后端
sprite.scale.x = fighter.facing;   // 1 或 -1
// 部件骨骼后端：翻在根容器上，不是翻每个部件
root.scale.x = fighter.facing;
```

Pixi 的 `scale.x = -1` 以 sprite 的 `pivot` 为轴翻转，所以只要 §8.4 的 pivot 在脚底中心，翻转时角色原地转、不位移。

> **别把两种翻转搞混**：`root.scale.x = facing` 是**朝向翻转**（整角色，运行时）；`rig.json` 里每个部件的 `flipX: true` 是**左右部件复用**（左臂用右臂那张图，构建期就定死）。前者必须翻根，后者只翻贴图、**不翻坐标系**——如果给单个部件加朝向翻转，左右手臂会互换、描边会翻到背面。

三条纪律：

1. **不要镜像 hitbox**。判定框由逻辑层按 `facing` 计算（`x * facing`），动画只管视觉。若两边都镜像，会变成"翻两次 = 没翻"。
2. **不要对称化设计**。武器、披风、发饰尽量不对称——镜像后左右手互换，是"省美术"的代价，接受它。若某角色必须对称（如双手剑），镜像后完全看不出，那是赚的。
3. **文字/logo 不能进角色图**。镜像会把它反过来。

**唯一例外**：投技的受身姿势。`throw_*` 的对方的动画由**被抓者自己的动画控制器**播放（它是 `GrabVictim` 状态），朝向跟随抓人者，不能用抓人者的 `facing` 镜像。实现上抓取时把被抓者的 `facing` 设为朝向抓人者。

### 8.6 图集打包与尺寸

> 本节**只对序列帧后端**生效。若采用自研部件骨骼（[04 UI 与美术](./04-ui-art.md) 第 7.4 节的主选方案），包体预算从「2.5MB / 3 张图集」变成「≈1.0MB / 一张部件图集 + `rig.json` + `poses.json`」，约束改为：每角色 **14 个部件、9 张图**（`arm_upper` / `arm_lower` / `thigh` / `shin` / `foot` 左右共用一张，靠 `flipX` 镜像）、部件图按 **2×** 出图（88px → 176px）、单角色部件图集 ≤ 1 张 1024²、**打包必须 `trim: false` 且禁止旋转打包**。下面的表保留，用于「降级为序列帧」或做部件骨骼失败时的备选方案评估。

| 约束 | 值 | 理由 |
|---|---|---|
| 单图集尺寸 | ≤ 2048×2048 | 移动端 GPU 安全上限，桌面也不该超 |
| 单帧尺寸 | ≤ 128×128（攻击可 192×192） | 角色高 64–74，2 倍余量够 |
| 单角色图集数 | ≤ 3 | 战斗包预算 2.5MB（2 角色 + 1 场景） |
| 单角色图集体积 | ≤ 1.0MB | PNG-8 或 WebP（有损 80） |
| 帧间距 | 2px | 防采样串色 |
| 打包工具 | TexturePacker（`json-hash` 格式） | Pixi 原生支持 |

**图集分组**（不要一股脑全塞）：

| 图集 | 内容 | 加载时机 |
|---|---|---|
| `atlas-0` | `idle` `walk` `run` `jump` `fall` `land` `crouch` 等高频动作 | 选人确认时预载 |
| `atlas-1` | 全部攻击动作 | 进入战斗时后台加载（首帧前完成） |
| `atlas-2` | 受击、倒地、边缘、KO | 同上 |
| `ui` | 头像、招式图标 | 选人界面 |

**为什么按"出现频率"而不是"按状态分组"**：选人界面只需要 `atlas-0` 就能播待机动画（角色选择预览），不必等 1MB 攻击图集。这是首屏 3 秒预算的一部分。

**命名规范**（直接对应 `anim.json` 的 `clip`）：

```
li/atk_air_forward@08    → li 角色的 atk_air_forward 动画第 8 帧
li/atk_air_forward@08 在 atlas-1.json 里的 frame 名就是它
```

`@` 后的数字是**逻辑帧号**（从 1 起），不是"第几张图"。这样美术交稿时说"第 8 帧改一下"，程序能直接定位。

---

## 9. 示例角色：完整设计

### 9.1 角色定位

**「磨刀匠 · 砺」**

> 一句话定位：**中速、横向压制、贴地连段型**。用长钢条与磨石作战，招式短而密，靠低角度击飞把对手按在地面反复消耗，但缺乏上击飞终结手段，必须靠边缘读招取命。

设计约束（自我限定，防止角色变成"什么都会"）：

| 维度 | 取值 | 说明 |
|---|---|---|
| 速度档 | 中（跑速 8.4） | 追得上重型，追不上轻量 |
| 体重 | 94（标准偏轻） | 被击飞略多，容错低 |
| 击杀手段 | 横向为主 | 上击飞只有 `tilt_up` / `air_up`，弱 |
| 复归 | 中（`special_up` 距离 320px） | 够回场，但不安全 |
| 操作难度 | 中低 | 无蓄力以外的复杂输入 |

### 9.2 属性表

| 属性 | 值 | 对比标准型 | 说明 |
|---|---|---|---|
| `weight` | 94 | −6 | 偏轻，高百分比更危险 |
| `gravityScale` | 0.98 | −2% | 滞空略长，便于空中连段 |
| `fallSpeedScale` | 0.97 | −3% | |
| `airAccelScale` | 1.05 | +5% | 空中调整好，补横向 |
| `airDrag` | 0.99 | — | |
| `friction` | 0.86 | +1 | 略滑，急停有滑步感 |
| `walkMaxScale` | 1.00 | — | 走速 5.5 |
| `runMaxScale` | 0.93 | −7% | 跑速 8.37 |
| `dashSpeed` | 7.2 | −0.3 | |
| `dashFrames` | 3 | — | |
| `jumpScale` | 1.02 | +2% | 全跳 12.75 / 短跳 8.67 |
| `airJumps` | 1 | — | |
| `airJumpScale` | 1.00 | — | |
| `hurtboxW` | 32 | −2 | 略窄，难被打中 |
| `hurtboxH` | 64 | — | |
| `shieldScale` | 0.94 | −0.06 | 盾比标准小 6%，漏招来得更早，防御吃亏 |
| `grabRange` | 62 | +4 | 抓投是重要起手 |
| `grabHoldFrames` | 84 | −6 | 容易被挣脱 |

派生值（`loader` 算出，写进调试面板）：走速 5.50 / 跑速 8.37 / 全跳 12.75 / 短跳 8.67 / 重力 0.833 / 最大下落 11.64。

### 9.3 招式用途矩阵

数值见 §6.5，这里只讲**每条为什么存在**。

| 招式 | 用途 | 关键帧 | 使用场景 |
|---|---|---|---|
| `jab` | 最快确认，接 `tilt_down` | 3f 出判定 | 贴身、对手落地硬直 |
| `tilt_forward` | 主力中距离 poke | 7f / 21f 总 | 中距离对峙，安全收招 |
| `tilt_up` | 唯一稳定的对空起手 | 6f，88° | 对手跳入 |
| `tilt_down` | 连段发动机，低角度 | 5f，20° | 压制盾后、连段第一段 |
| `smash_forward` | 横向取命 | 16f 前摇 | 读翻滚、对手硬直长 |
| `dash_attack` | 追上逃跑 | 9f，位移 28px | 横穿场地的追击 |
| `air_neutral` | 落地压制 / 空对空 | f4–6 或 f10–11 | 起跳后不确定高度时 |
| `air_forward` | 主力空中击杀 | 8f，40° | 边缘读招 |
| `air_back` | 反向击杀（不转身） | 6f，最快空中招 | 背对对手时 |
| `air_up` | 连段续接 | 5f，78° | `tilt_up` 之后 |
| `air_down` | 钉地（270°） | 12f 前摇 | 读对手回场路线 |
| `special_neutral` | 蓄力 poke / 破盾 | 蓄力 0–40f | 对手复活间隙、远距离威慑 |
| `special_side` | 横向突进 + 高击飞 | 12f，位移 90px | 中距离惩罚、复归辅助 |
| `special_up` | 复归 | 8f | 只能回场 |
| `special_down` | 快速落地 | 14f | 躲避上击飞、抢落地 |
| `grab` | 起手（对盾） | 6f，62px | 对手举盾 |
| `throw_down` | 连段投 | 21f 总，最快投 | 低百分比起手 |
| `throw_forward` / `throw_back` | 位置投 | 31f / 33f | 把对手推向边缘 |
| `throw_up` | 高空压制 | 37f | 高百分比上抛接 `air_up` |
| `ledge_attack` | 挂边反击 | 18f，8f 无敌 | 复归读招 |
| `getup_attack` | 起身反打 | 14f | 被压倒地后 |

### 9.4 三个招牌连段（按帧数验证）

计算口径（先统一，否则数字对不上）：

```
kb   = ((((p/10) + (p*d)/20) * (200/(w+100)) * 1.4) + 18) * (growth/100) + baseKB
hitstun = floor(kb * 0.4)            // v1 默认系数，见 [战斗系统](./03-combat-system.md)
优势帧 = hitstun - recovery
窗口   = 优势帧 - 下一招 startup（需要跳则再减 JUMP_SQUAT_FRAMES = 4）
```

目标体重 `w = 94`（镜像对局），故 `200/(94+100) = 1.03093`。

**连段一：「贴地三段」Jab → 低撬 → 前钉**

| 步骤 | 招式 | 命中时对方 % | 本次 dmg | kb | hitstun | 我方 recovery | 优势帧 | 下一招 startup | 窗口 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `jab` | 0 → 3 | 3 | 37.82 | 15 | 8 | +7 | 5（低撬） | **+2** |
| 2 | `tilt_down` | 3 → 9 | 6 | 48.44 | 19 | 10 | +9 | 8（前钉） | **+1** |
| 3 | `air_forward` | 9 → 21 | 12 | 63.15 | 25 | — | — | — | 终结 |

逐步验算第 1 步：`((3/10 + 3*3/20) * 1.03093 * 1.4 + 18) * 0.20 + 34 = (1.08247 + 18) * 0.2 + 34 = 37.82`。

**这个连段的意义**：两段窗口都是 1–2 帧，加上 3 帧输入缓冲，玩家实际感受到的窗口是 4–5 帧——**可练、但不能闭眼打**。第三段的 `air_forward` 在 21% 打出 63.15 kb（速度 1.89 px/帧），不致死，但把对手推到场地中段，接下一次压制。

**连段二：「上撬连顶」上撬 → 顶钉 →（跳）顶钉**

| 步骤 | 招式 | 对方 % | dmg | kb | hitstun | recovery | 优势帧 | 需要帧数 | 窗口 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `tilt_up` | 0 → 8 | 8 | 54.26 | 21 | 11 | +10 | 4(跳)+5(顶钉)=9 | **+1** |
| 2 | `air_up` | 8 → 18 | 10 | 60.48 | 24 | 10 | +14 | 4(跳)+5=9 | **+5** |
| 3 | `air_up`（二段跳） | 18 → 28 | 10 | 67.42 | 26 | — | — | — | 距离到极限 |

**为什么第 3 段"帧够但打不到"**：第 2 段后 kb = 60.48（速度 1.81 px/帧），对手在 24 帧硬直里要飘走 ~43px；第 3 段起跳 + 5 帧 startup 后再飘 ~10px，总计 53px，超过 `air_up` 的判定半径（34px）+ 二段跳位移的容差。**帧窗口说的是"来得及"，不是"够得着"**——这是新手调连段时最常见的误判：只看 hitstun，不看位移。

所以这个连段的上限是 **40% 左右**（40% 时 kb 已到 78，位移更快）。40% 之后要靠 `special_side` 或 `smash_forward` 取命。

**连段三：「抓推接钉」下抛 → 顶钉**

| 步骤 | 招式 | 对方 % | dmg | kb | hitstun | recovery | 优势帧 | 需要帧数 | 窗口 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `throw_down` | 0 → 6 | 6 | 45.37 | 18 | 8 | +10 | 4+5=9 | **+1** |

**为什么这是"必须会"的连段**：它是 `砺` 唯一能从盾起手的连段（`grab` → `throw_down` → `air_up`）。窗口 1 帧，但**这是角色对盾的全部答案**——不会这个，对手举盾你就没辙。

**连段可行性复核的三条纪律**：

1. **先算 hitstun，再算位移**。只算 hitstun 会得到"理论上无限连"的假象（连段二）。
2. **`hitlag` 不进入优势帧计算**。顿帧期间双方同时冻结，攻击方和被击方的帧数同时暂停，差值不变。这是初算连段时最容易多减/少减的一项。
3. **缓冲不改变窗口，只降低操作门槛**。`BUFFER_FRAMES = 3` 让 0 帧连段变得可打，但它不会让 -2 帧的连段成立。判定"这招能不能连"永远用原始帧数。

### 9.5 设计意图：克制与被克制

| 关系 | 对象 | 机制原因 |
|---|---|---|
| **克制** | 重型（w=130） | 重型的 `gravityScale` 高、下落快 → 被低角度击飞后更快触地 → `tilt_down` 的压制链对重型更有效。且重型跑速低，逃不出 `special_side` 的 90px 突进 |
| **克制** | 举盾型打法 | `tilt_down` 打盾硬直短、`grab` 范围 62（全角色最远档），盾 → 抓 → 下抛 → 顶钉是完整闭环 |
| **被克制** | 长手角色 | `砺` 最远判定只有 `tilt_forward` 的 78px，对手若有 120px 级 poke，`砺` 必须走进去，而走速 5.5 不够快 |
| **被克制** | 强上击飞角色 | 体重 94 + `gravityScale` 0.98（滞空长）= 被上击飞后停留久，容易被续接连段 |
| **被克制** | 边缘压制 | `special_up` 只有 320px 且无判定（上升段有 9% 的弱判定但不改轨迹），复归路线单一，容易被读 |

**与场地的关系**（详见 [地图设计](./02-stage.md)）：`砺` 的连段全部依赖"对手在地面"，所以**平台高度**对它是关键变量。若主场地是"平地 + 2 个旁台"（架构 D4），`砺` 会把对手往**主台面**打而不是往旁台打——主台面宽 2400，够它把低角度击飞的链子跑完。若换成多平台图，`砺` 需要重新评估 `tilt_down` 的角度（平台边缘会让对手提前离地，20° 的低角度反而变成劣势）。

**与美术的关系**（详见 [UI 与美术](./04-ui-art.md)）：`砺` 的动作设计核心是"短、密、贴地"。所有招式的手臂伸展不超过 1.2 倍身高，避免视觉上"看起来够得到但判定不到"。

---

## 10. 操作手感调参指南

### 10.1 症状 → 参数 → 调整方向

这是 M6 试玩评审时的排查表。**每条症状先确认归属层**（物理 / 帧数据 / 动画 / 音频），再动手改参数——改错层的参数是最常见的浪费时间。

| 症状（玩家原话） | 先查 | 参数 | 调整方向 | 为什么 |
|---|---|---|---|---|
| **"跳起来感觉轻飘飘的"** | 物理 | `gravityScale`（角色）/ `GRAVITY`（全局） | **调大** 0.85 → 0.95 或角色 ×1.10 | 重力小 = 滞空久 = 飘。这是第一顺位，因为其他参数都改不了"滞空时间" |
| 同上 | 物理 | `MAX_FALL` | 调大 12 → 13.5 | 上升不变、下落变快 = 落地更"实"，不改变跳跃高度 |
| 同上 | 物理 | `FULL_JUMP_VELOCITY` | 调大 12.5 → 13.0 | 只加高度不够，要配合重力一起加，否则更飘 |
| 同上 | 帧数据 | `JumpSquat` | 保持 4，不要动 | 它是"起跳有重量"的关键；改成 2 会让起跳变"弹射" |
| **"打中没手感"** | 帧数据 | `hitlagMul` | 调大 1.0 → 1.2（重击 1.3） | 顿帧是打击感的第一来源，比音效重要 |
| 同上 | 帧数据 | `damage` | 小幅上调 | 顿帧 = `floor(damage*0.2+1)`，伤害直接决定顿帧 |
| 同上 | 表现 | 音效 / 屏幕震动 / 命中特效 | 加，不要减 | 三者缺一，"打中"就没有确认感 |
| 同上 | 动画 | `hit` 动画首帧 | 首帧必须是**最大形变**，不是"开始被打" | 玩家看到的第一帧决定 80% 的打击感 |
| **"落地太黏"** | 帧数据 | `LandingLag` / `landingLag` | 调小 12 → 8 | 落地硬直是"黏"的直接来源 |
| 同上 | 物理 | `friction` | 调大 0.85 → 0.90 | 摩擦大 = 停得慢 = 落地后有滑步，反而不黏 |
| 同上 | 动画 | `land` 帧数 | 4 → 3，且允许被 `idle` 立刻打断 | 动画比逻辑长会产生"卡住"的错觉 |
| **"跑起来刹不住"** | 物理 | `friction` | 调小 0.85 → 0.78 | 摩擦小 = 停得快 |
| 同上 | 状态机 | `Skid` 帧数 | 4 → 6 | 急停需要一个可见的刹车动作 |
| **"短跳跳不出来"** | 输入 | `SHORT_HOP_VELOCITY` / 松键判定窗口 | 窗口从 2 帧放宽到 3 帧 | 2 帧窗口对 60Hz 玩家太苛刻 |
| 同上 | 输入 | `BUFFER_FRAMES` | 3 已经够，不要加 | 加大会导致"没按也跳" |
| **"攻击按了没反应"** | 输入 | `BUFFER_FRAMES` | 3 → 4 | 但先确认不是 `startup` 太长 |
| 同上 | 状态机 | 转移表 | 检查 `Hitstun.transitions` 是否漏了 `AttackGround` | 漏一条就永久卡住 |
| **"连段接不上"** | 帧数据 | 起手技的 `recovery` | 调小 2–3 帧 | 优势帧 = hitstun − recovery，减 recovery 最直接 |
| 同上 | 帧数据 | 起手技的 `baseKB` | 调小 | 低百分比时 kb 主要由 base 决定，base 小 = 硬直短 |
| **"打不死人"** | 帧数据 | 击杀技的 `kbGrowth` | 调大 | 高百分比时 growth 主导 |
| 同上 | 物理 | 出界判定 `BLAST_*` | 检查边界是否太远 | 场地问题不要用帧数据补 |
| **"复归回不来"** | 帧数据 | `special_up` 位移 / `airJumps` | 加距离或加跳跃次数 | 先加 `airJumps`（影响全局），再加必杀 |
| 同上 | 物理 | `ledgeCooldown` | 30 → 24 | 冷却长会让"抓不住边"变成"抓了又掉" |
| **"角色看起来滑冰"** | 动画 | `walk`/`run` 的帧数 | 加帧或降 `hold` | 动画帧率跟不上移动速度 = 视觉滑冰 |

### 10.2 三阶段调参流程

调参必须按层走，跳层会导致"调了 A 坏了 B，再调 B 坏了 C"。

```
阶段一：物理（无美术，色块即可）
  └ 目标：跳跃高度、滞空时间、落地手感、"这个方块像个人"
  └ 通过标准：能不看画面、只听操作就判断出"我跳到了多高"

阶段二：帧数据（仍可无美术）
  └ 目标：每招的 startup / recovery、连段可行性、击杀百分比
  └ 通过标准：三个招牌连段能打出来，击杀百分比在 90–140 区间

阶段三：表现（美术 + 音效 + 特效）
  └ 目标：打击感、重量感、可读性
  └ 通过标准：闭眼听声音能分辨轻击/重击/击杀
```

**每个阶段结束都要拉人试玩**，不要让同一个人连续调三个阶段——调参的人会对"飘"产生适应性，试玩的新人不会。

### 10.3 调试可视化器必须显示的内容

`?debug=1` 下，逐帧步进（`F7`）时能看到的：

| 类别 | 内容 | 为什么必须 |
|---|---|---|
| 状态 | `state` 名 / `stateFrame` / `moveId` / `moveFrame` | 卡住时第一眼看这里 |
| 帧数据 | 当前招式 `startup/active/recovery` + 剩余帧 | 判断"还能不能取消" |
| 判定 | hurtbox（绿）/ hitbox（红，含 `id`）/ 本帧是否生效 | 调判定位置的唯一手段 |
| 物理 | `vx/vy`、`grounded`、`platformId`、`ledgeId` | 穿模、卡墙 |
| 击飞 | `kb` / `hitstun` / `hitlag` / `angle` / DI | 连段验证 |
| 动画 | 当前 clip / 帧索引 / pivot 十字 / 混合进度 | 动画与逻辑是否对齐 |
| 网络 | 回滚次数 / 回滚帧数 / 校验和 | 联机阶段 |

**"pivot 十字"是最容易被省略、又最该有的一项**：它一眼就能看出美术的轴心是否对。轴心错了，所有动画都在漂，但单看动画很难发现——只有把十字画出来才明显。

### 10.4 一次只改一个参数

这不是教条，是避免"负负得正"的假象：

```
改动 A：重力 +10%（更实）   →  玩家说"太重"
改动 B：跳跃 -10%（更低）   →  玩家说"跳不动"
同时改：玩家说"刚刚好"     →  但你不知道是哪个起了作用
下次遇到同类问题，你不会调
```

**记录模板**（本地 `tuning-log.md`，每次一行）：

```
2026-10-24 | li/tilt_down | recovery 12 → 10 | 连段一第二步窗口 -2 → +1，通过
2026-10-24 | li/tilt_down | angle 20 → 18     | 低角度更贴地，但对手有时不落地，回滚
```

第二行是典型的"改了又改回去"——**记录下来才知道自己绕了圈**。没有记录的调参，一周后会把同一个参数改回原值。

### 10.5 什么不该调

| 不要动的 | 原因 |
|---|---|
| `GRAVITY` 用于修"某个角色太飘" | 全局量，改它 = 改所有角色。用 `gravityScale` |
| `hitlagMul` 做 ±5% 微调 | 有 1 帧量化误差，±5% 不存在（§6.8） |
| `damage` 用于修"连段接不上" | 伤害会同时改 `p`、`hitlag`、kill%，牵三处。用 `recovery` |
| `BUFFER_FRAMES` 用于修"按不出来" | 先查是不是 `startup` 太长或转移表漏条 |
| 出界边界 `BLAST_*` 用于修"打不死" | 场地问题不要用帧数据补，见 [地图设计](./02-stage.md) |
| 动画帧数用于修"判定太快" | 判定由帧数据决定，动画必须跟随，不能反向（§8.3） |

---

> **相关文档**：[架构设计总纲](./00-overview.md) ｜ [战斗系统](./03-combat-system.md) ｜ [UI 与美术](./04-ui-art.md) ｜ [地图设计](./02-stage.md)

