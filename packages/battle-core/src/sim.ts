/**
 * 战斗内核：纯函数模拟。
 *
 * 铁律（docs/00-overview.md §3）：
 *   L1 零 DOM / 零 Vue / 零 Pixi / 零 Date.now
 *   L2 禁 Math.sin/cos/tan/pow/atan2/random（四则运算与 Math.sqrt 允许）
 *   L4 种子化 PRNG 且种子进快照
 *   L5 一帧一次 step
 *   L6 命中结算同帧完成
 *
 * 这个文件不含任何输入设备代码：键盘/手柄在 client 里实现 InputSource，
 * AI 是同进程的另一个 InputSource —— 三者对 step() 来说完全一样。
 */
import type {
  AttackDir,
  CharDef,
  HazardDef,
  PlatformType,
  SpecialDef,
  SpecialKind,
  StageDef,
} from './types.ts'

export const C = {
  LOGIC_FPS: 60,
  STEP_MS: 1000 / 60,
  GRAVITY: 0.85,
  MAX_FALL: 12,
  FAST_FALL_SPEED: 18,
  AIR_ACCEL: 0.42,
  AIR_DRAG: 0.99,
  GROUND_ACCEL: 0.9,
  SHORT_HOP_VELOCITY: 8.5,
  FULL_JUMP_VELOCITY: 12.5,
  JUMP_SQUAT_FRAMES: 4,
  MAX_WALK: 5.5,
  MAX_RUN: 9.0,
  FRICTION: 0.85,
  STOCKS: 3,
  RESPAWN_DELAY_FRAMES: 100,
  RESPAWN_INVINCIBLE: 60,

  /* ---- 攻击 / 击飞 ---- */
  KB_GROWTH: 100,
  BASE_KB: 30,
  /** 击飞值→速度换算。0.03 是 Melee 单位制，本项目 1 单位 = 1 逻辑像素，实测校准为 0.09 */
  KNOCKBACK_TO_SPEED: 0.09,
  KB_MAX: 2500,
  HITLAG_FRAMES: 4,
  /** 命中顿帧随伤害增长的上限（帧）。重击要停得比轻击久，否则分量一样 */
  HITLAG_MAX: 9,
  /** 跳跃缓冲（帧）。落地前 4 帧内按跳，落地当帧就起跳 */
  JUMP_BUFFER_FRAMES: 6,
  /** 郊狼时间（帧）。刚离开平台边缘 3 帧内仍算站在地上 */
  COYOTE_FRAMES: 3,
  /** 攻击缓冲（帧）。收招最后 3 帧内按攻击，解除硬直当帧就出招 */
  ATTACK_BUFFER_FRAMES: 5,
  /** 落地硬直按落地速度取 2-6 帧 */
  LAND_LAG_MIN: 1,
  LAND_LAG_MAX: 4,
  HITSTUN_RATIO: 0.4,
  HITSTUN_MIN: 6,
  HITSTUN_GRAVITY_MUL: 0.55,

  /* ---- 连击放大 ---- */
  COMBO_KB_PER_HIT: 0.14,
  COMBO_KB_MAX: 1.2,
  COMBO_DMG_GATE: 200,
  COMBO_DMG_PER_100: 0.45,
  COMBO_DMG_MAX: 0.9,
  COMBO_EXPIRE: 90,

  /* ---- 防御（护盾 = 下蹲） ---- */
  SHIELD_MAX: 50,
  SHIELD_DRAIN: 0.08,
  SHIELD_REGEN: 0.42,
  SHIELD_REGEN_DELAY: 22,
  SHIELD_DAMAGE_MUL: 1.1,
  SHIELD_DAMAGE_BASE: 2,
  SHIELD_BREAK_STUN: 150,
  SHIELD_BREAK_RESET: 22,
  SHIELD_KB_MUL: 0.28,
  CROUCH_HEIGHT: 40,
  DROP_THROUGH_FRAMES: 14,
  LAND_LAG_FRAMES: 3,

  /* ---- 击倒（knockdown） ---- */
  /** 触发击倒最少要吃到的连击段数 */
  KNOCKDOWN_MIN_COMBO: 2,
  /** 击倒时额外给的垂直弹起速度，让人真的"被打飞起来" */
  KNOCKDOWN_BOUNCE: 9.5,
  /** 击倒中躺地时水平摩擦 */
  KNOCKDOWN_FRICTION: 0.86,

  /* ---- 冲刺 ---- */
  /** 冲刺初速（像素/帧）。这是"敢不敢赌"的核心资源，比跑步快一倍多 */
  DASH_SPEED: 17,
  /** 冲刺持续帧（速度线性衰减到 DASH_END_SPEED） */
  DASH_FRAMES: 14,
  /** 冲刺末尾残留速度，让冲刺有一个"渐停"而不是硬刹 */
  DASH_END_SPEED: 6.5,
  /** 冲刺冷却帧 */
  DASH_COOLDOWN: 26,
  /** 冲刺结束后的收招硬直，防止冲刺无脑刷 */
  DASH_ENDLAG: 5,
  /** 冲刺中按攻击的窗口：冲刺开始后这么多帧内按 J 才算冲刺攻击 */
  DASH_ATTACK_WINDOW: 11,
  /** 空中冲刺距离倍率（空中比地面短） */
  AIR_DASH_MUL: 0.82,
  /** 冲刺攻击伤害倍率（在角色 dashAttackMul 之上再乘一层） */
  DASH_ATTACK_KB_MUL: 1.15,
  /** 斜向冲刺的速度微调：斜向能同时走两个轴，等价位移更大，给一点抑制 */
  DASH_DIAGONAL_MUL: 0.92,
  /** --- 场外复归冲刺 ---
   * 被打出场外时按"方向 + 冲刺"，冲刺变成复归手段：更快、冷却更短、
   * 不消耗空中冲刺次数。这是容错而不是资源 —— 玩家飞在场外时最需要的
   * 是"有办法回来"，不是"再被扣一次次数"。
   */
  OFFSTAGE_DASH_MUL: 1.9,
  /** 场外冲刺的持续帧数倍率：比普通冲刺飞得更久，所以更远 */
  OFFSTAGE_DASH_FRAMES_MUL: 1.4,
  /** 场外复归冲刺的冷却倍率（一次性资源，冷却本身不重要，留个小值防抖动） */
  OFFSTAGE_DASH_CD_MUL: 0.3,
  /**
   * 每回合（每次落地/抓边/复活刷新）能用的场外复归冲刺次数。
   *
   * 刻意只给 1 次：复归是容错，不是第二条命。如果给无限次，
   * 被打出场地的人可以一路冲回台面，"打出场外"这件事就没有后果了。
   */
  RECOVERY_DASHES: 1,
  /** 判定"在场外"时给平台外沿留的宽容带（像素） */
  OFFSTAGE_MARGIN: 30,
  /** 低于所有平台顶面多少像素算"掉在场外" */
  OFFSTAGE_BELOW: 220,

  /* ---- 抓边与攀爬 ---- */
  /** 可抓边的判定：脚离边缘顶面多高之内 */
  LEDGE_GRAB_Y: 46,
  /** 水平方向距边缘多少之内可以抓 */
  LEDGE_GRAB_X: 26,
  /** 悬挂时不可再次抓边的冷却 */
  LEDGE_COOLDOWN: 40,
  /** 悬挂无敌帧（防止挂着被人白打） */
  LEDGE_INVINCIBLE: 30,
  /** 攀爬上台所需帧数 */
  LEDGE_CLIMB_FRAMES: 16,
  /** 松手后一段时间内不能再抓同一侧边 */
  LEDGE_RELEASE_LOCK: 30,

  /* ---- 投射物与场地 ---- */
  /** 投射物全局上限，防止刷屏（联机时也是快照负担） */
  MAX_PROJECTILES: 24,
  /** 爆炸判定每帧上一次伤害后给受害者的免疫帧，避免站在火里每帧掉血 */
  HAZARD_IFRAMES: 18,
  /** 平台被打时每点伤害扣多少 hp；平台 hp 用同一套单位 */
  PLATFORM_HP_SCALE: 1,
} as const

export type Facing = 1 | -1

/**
 * 冲刺方向单位向量。
 *
 * 八个方向硬编码而不是用 cos/sin 现算 —— 铁律 L2 禁止在模拟层调用三角函数
 * （跨引擎 ulp 差异会在回滚重演里放大成 desync）。斜向用 1/√2 的字面量。
 *
 * 关键：冲刺方向取**世界绝对方向**，不是"朝向相对方向"。玩家被打到场外右侧、
 * 想往左飞回来时按的是"左"；如果按朝向相对解释，背对台面时按左会变成"后"，
 * 反而飞得更远。
 */
export const DASH_UNIT = {
  right: [1, 0],
  left: [-1, 0],
  up: [0, -1],
  down: [0, 1],
  upRight: [0.7071067811865476, -0.7071067811865476],
  upLeft: [-0.7071067811865476, -0.7071067811865476],
  downRight: [0.7071067811865476, 0.7071067811865476],
  downLeft: [-0.7071067811865476, 0.7071067811865476],
} as const satisfies Record<string, readonly [number, number]>

export type DashDirName = keyof typeof DASH_UNIT

/** 从输入取冲刺方向：八方向；没按方向就用朝向 */
export function pickDashDir(inp: InputState, facing: Facing): DashDirName {
  const h = inp.left && !inp.right ? -1 : inp.right && !inp.left ? 1 : 0
  const v = inp.up && !inp.down ? -1 : inp.down && !inp.up ? 1 : 0
  if (h === 0 && v === 0) return facing > 0 ? 'right' : 'left'
  if (v === 0) return h < 0 ? 'left' : 'right'
  if (h === 0) return v < 0 ? 'up' : 'down'
  if (v < 0) return h < 0 ? 'upLeft' : 'upRight'
  return h < 0 ? 'downLeft' : 'downRight'
}

/**
 * 角度 → (cos, sin) 查表。
 *
 * 铁律 L2 禁止在模拟层调用 Math.cos / Math.sin（跨引擎实现可能有 ulp 级差异，
 * 回滚重演时会放大成 desync）。招式角度只有这么几个固定值，直接硬编码常量。
 * 约定：0° = 水平朝前，正角度 = 朝上，负角度 = 朝下。
 */
const ANGLE_TABLE: Record<number, readonly [number, number]> = {
  [-80]: [0.17364818, -0.98480775],
  [-60]: [0.5, -0.8660254],
  0: [1, 0],
  20: [0.93969262, 0.34202014],
  25: [0.90630779, 0.42261826],
  40: [0.76604444, 0.64278761],
  45: [0.70710678, 0.70710678],
  55: [0.57357644, 0.81915204],
  60: [0.5, 0.8660254],
  70: [0.34202014, 0.93969262],
  75: [0.25881905, 0.96592583],
  80: [0.17364818, 0.98480775],
  85: [0.08715574, 0.9961947],
  88: [0.0348995, 0.99939083],
  90: [0, 1],
  105: [-0.25881905, 0.96592583],
  120: [-0.5, 0.8660254],
  130: [-0.64278761, 0.76604444],
  155: [-0.90630779, 0.42261826],
}

/** 每个方向一套帧数据。数值对齐 docs/01-characters.md §6 的招式表规模 */
export interface MoveDef {
  startup: number
  active: number
  recovery: number
  boxW: number
  boxH: number
  /** 判定框中心相对角色中心的水平偏移（再乘面朝方向） */
  fwd: number
  /** 判定框中心相对脚底的竖直偏移（负向上） */
  y: number
  /** 判定框是否开在背后（回身打的招式用） */
  boxBack?: boolean
  damage: number
  /** 击飞角度，见 ANGLE_TABLE */
  angle: number
  kbGrowth: number
  baseKB: number
}

/**
 * 八个方向的招式表（+ 中立共九个）。
 *
 * 所有角色共用这套骨架——这是「基础攻击方式差不多」的落地方式；
 * 角色差异靠属性倍率与下面的 specials，不靠另写一份招式表。
 */
export const MOVES: Record<AttackDir, MoveDef> = {
  neutral: {
    startup: 5,
    active: 4,
    recovery: 9,
    boxW: 44,
    boxH: 28,
    fwd: 34,
    y: -34,
    damage: 10,
    angle: 45,
    kbGrowth: 1.0,
    baseKB: 30,
  },
  forward: {
    startup: 9,
    active: 5,
    recovery: 16,
    boxW: 52,
    boxH: 32,
    fwd: 44,
    y: -32,
    damage: 15,
    angle: 40,
    kbGrowth: 1.15,
    baseKB: 34,
  },
  back: {
    startup: 7,
    active: 4,
    recovery: 13,
    boxW: 46,
    boxH: 30,
    fwd: 26,
    y: -36,
    boxBack: true,
    damage: 12,
    angle: 130,
    kbGrowth: 1.05,
    baseKB: 28,
  },
  up: {
    startup: 4,
    active: 5,
    recovery: 11,
    boxW: 32,
    boxH: 46,
    fwd: 8,
    y: -60,
    damage: 8,
    angle: 85,
    kbGrowth: 1.25,
    baseKB: 26,
  },
  upForward: {
    startup: 6,
    active: 5,
    recovery: 13,
    boxW: 40,
    boxH: 38,
    fwd: 30,
    y: -52,
    damage: 11,
    angle: 60,
    kbGrowth: 1.1,
    baseKB: 28,
  },
  upBack: {
    startup: 6,
    active: 4,
    recovery: 12,
    boxW: 40,
    boxH: 38,
    fwd: 24,
    y: -52,
    boxBack: true,
    damage: 10,
    angle: 120,
    kbGrowth: 1.05,
    baseKB: 26,
  },
  down: {
    startup: 7,
    active: 6,
    recovery: 15,
    boxW: 38,
    boxH: 30,
    fwd: 22,
    y: -8,
    damage: 13,
    angle: -60,
    kbGrowth: 1.05,
    baseKB: 30,
  },
  downForward: {
    startup: 8,
    active: 5,
    recovery: 14,
    boxW: 46,
    boxH: 26,
    fwd: 36,
    y: -14,
    damage: 13,
    angle: 25,
    kbGrowth: 1.1,
    baseKB: 30,
  },
  downBack: {
    startup: 8,
    active: 5,
    recovery: 14,
    boxW: 42,
    boxH: 26,
    fwd: 20,
    y: -14,
    boxBack: true,
    damage: 12,
    angle: 155,
    kbGrowth: 1.05,
    baseKB: 28,
  },
}

/**
 * 冲刺攻击的帧数据。和 MOVES 一一对应九个方向，但每一招都更长、更痛、位移更大——
 * 这是「冲刺攻击方向不同，呈现出来的攻击也不同」的落地：
 *   forward    = 冲拳，直线突进最远
 *   upForward  = 腾空上挑，能当连段起手
 *   downForward= 滑铲，低身位、打蹲防、能穿下
 *   back       = 急停回身鞭腿
 */
export const DASH_MOVES: Record<AttackDir, MoveDef> = {
  neutral: {
    startup: 7, active: 5, recovery: 14,
    boxW: 56, boxH: 34, fwd: 42, y: -34,
    damage: 13, angle: 42, kbGrowth: 1.2, baseKB: 36,
  },
  forward: {
    startup: 9, active: 6, recovery: 20,
    boxW: 70, boxH: 36, fwd: 56, y: -34,
    damage: 17, angle: 38, kbGrowth: 1.35, baseKB: 42,
  },
  back: {
    startup: 8, active: 5, recovery: 17,
    boxW: 60, boxH: 32, fwd: 34, y: -38, boxBack: true,
    damage: 14, angle: 132, kbGrowth: 1.2, baseKB: 34,
  },
  up: {
    startup: 6, active: 6, recovery: 16,
    boxW: 40, boxH: 58, fwd: 12, y: -66,
    damage: 11, angle: 86, kbGrowth: 1.4, baseKB: 30,
  },
  upForward: {
    startup: 8, active: 6, recovery: 18,
    boxW: 52, boxH: 48, fwd: 40, y: -58,
    damage: 15, angle: 58, kbGrowth: 1.3, baseKB: 36,
  },
  upBack: {
    startup: 8, active: 5, recovery: 17,
    boxW: 50, boxH: 46, fwd: 30, y: -58, boxBack: true,
    damage: 13, angle: 118, kbGrowth: 1.2, baseKB: 32,
  },
  down: {
    startup: 8, active: 6, recovery: 16,
    boxW: 46, boxH: 34, fwd: 26, y: -14,
    damage: 14, angle: -62, kbGrowth: 1.15, baseKB: 32,
  },
  downForward: {
    startup: 7, active: 8, recovery: 16,
    boxW: 62, boxH: 26, fwd: 44, y: -12,
    damage: 13, angle: 22, kbGrowth: 1.15, baseKB: 28,
  },
  downBack: {
    startup: 7, active: 6, recovery: 16,
    boxW: 54, boxH: 28, fwd: 26, y: -12, boxBack: true,
    damage: 13, angle: 158, kbGrowth: 1.1, baseKB: 30,
  },
}

/** 冲刺攻击的缓出：整个出招期间水平速度逐步衰减，形成"冲+打"的合成位移 */
const DASH_ATTACK_GLIDE = 0.9

/** 必杀技的出招帧。比基础攻击慢一点，但收益高——这是"敢不敢赌"的取舍 */
export const SPECIAL_FRAMES: Record<SpecialKind, { startup: number; active: number; recovery: number }> = {
  arrow: { startup: 7, active: 2, recovery: 14 },
  bottle: { startup: 9, active: 2, recovery: 18 },
  bomb: { startup: 10, active: 2, recovery: 20 },
  banana: { startup: 8, active: 2, recovery: 16 },
  trap: { startup: 12, active: 2, recovery: 22 },
  grab: { startup: 6, active: 3, recovery: 24 },
}

/* ---------------- 投射物 ---------------- */
export type ProjectileKind = 'arrow' | 'bottle' | 'bomb' | 'banana' | 'trap' | 'explosion'

export interface Projectile {
  id: number
  kind: ProjectileKind
  owner: 0 | 1
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  damage: number
  angle: number
  kbGrowth: number
  baseKB: number
  /** 剩余存活帧 */
  life: number
  /** 受重力影响（抛物线用 true，直线用 false） */
  gravity: boolean
  /** 是否已经落地（落地后行为不同：炸/滑倒/引信） */
  grounded: boolean
  /** 引信帧数（bomb 落地后倒数，explosion 用 0） */
  fuse: number
  /** 已经造成过伤害（爆炸类只打一次） */
  spent: boolean
  /** 陷阱的布防倒计时：>0 时还没生效 */
  arm: number
  facing: Facing
}

/* ---------------- 平台的运行时状态 ---------------- */
export interface PlatState {
  id: number
  type: PlatformType
  x: number
  y: number
  w: number
  h: number
  grabbable: boolean
  hp: number
  maxHp: number
  broken: boolean
  respawnTimer: number
  baseX: number
  baseY: number
  moveAmp: number
  movePeriod: number
  movePhase: number
  /** 受击闪白计时，纯渲染用（但放在这里因为它是平台状态的一部分） */
  flash: number
}

/* ---------------- 场地事件 ---------------- */
export interface HazardState {
  def: HazardDef
  /** 本帧是否激活 */
  active: boolean
  /** 本帧的几何（移动类事件会变） */
  x: number
  y: number
  w: number
  h: number
}

/* ---------------- 角色状态 ---------------- */

/** 抓边记录：挂在哪块平台的哪一侧 */
export interface LedgeRef {
  platId: number
  /** 边缘的世界 x（左边缘或右边缘） */
  x: number
  /** 平台顶面 y */
  y: number
  /** 边缘朝向：1 = 站在平台右侧的边（角色在右边），-1 = 左边 */
  side: Facing
}

export type FighterState =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'hurt'
  | 'attack'
  | 'special'
  | 'dash'
  | 'dashattack'
  | 'ledge'
  | 'crouch'
  | 'land'
  | 'knockdown'
  | 'broken'
  | 'dead'

export interface Fighter {
  index: 0 | 1
  char: CharDef
  x: number
  y: number
  vx: number
  vy: number
  facing: Facing
  onGround: boolean
  /** 剩余跳跃次数（含二段跳） */
  jumpsLeft: number
  /** 起跳蹲计时，>0 时不能动 */
  jumpSquat: number
  fastFalling: boolean
  /** 跳跃缓冲计数 */
  jumpBuffer: number
  /** 郊狼时间计数 */
  coyote: number
  /** 攻击缓冲计数 */
  atkBuffer: number
  /** 伤害百分比，0-999 */
  damage: number
  stocks: number
  /** 无敌帧 */
  invincible: number
  /** 复活倒计时，>0 表示在台下等待 */
  respawnTimer: number
  /** 受击硬直，>0 时不能输入 */
  hitstun: number
  /** 顿帧：命中瞬间双方一起冻结，让打击有"咬合感" */
  hitlag: number
  /** 攻击计时：-1 = 没在出招；>=0 = 本次出招已经过的帧数 */
  attackFrame: number
  /** 本次出招是否已经命中/发出过（防止一帧多次） */
  attackHit: boolean
  /** 出招瞬间锁定朝向，出招后转身不会改判 */
  attackFacing: Facing
  /** 本次出招的方向，起手时锁定 */
  attackDir: AttackDir
  /** 出招种类：基础攻击 or 必杀 */
  attackKind: 'normal' | 'special'
  /** 本次必杀是角色 specials 里的第几个槽（0/1） */
  specialSlot: 0 | 1
  /**
   * 本次出招实际用的必杀定义。
   * 一个槽下可以有多条（靠 dir 区分），所以不能只存槽位号——
   * 出招瞬间锁定，收招前不因输入变化而换招，否则回滚重演会打出不同的招。
   */
  specialDef: SpecialDef | null

  /* ---- 防御（下蹲即防御，见 shieldRadius） ---- */
  crouching: boolean
  shield: number
  shieldRegenDelay: number
  shieldBreakStun: number
  /** 从单向平台穿下后的冷却计时，>0 时不会被同一块平台接住 */
  dropThroughTimer: number

  /* ---- 连击 ---- */
  combo: number
  comboExpire: number
  maxComboTaken: number

  /* ---- 击倒 ---- */
  /** 是否处于击倒倒地状态（透明闪烁 + 无敌虚无） */
  knockedDown: boolean
  /** 倒地剩余帧；归零后起身并进入 getupInvincible 无敌 */
  knockdownTimer: number
  /** 本局累计被击倒次数，结算展示 */
  knockdowns: number

  /* ---- 冲刺 ---- */
  /** 冲刺剩余帧；>0 表示正在冲刺 */
  dashTimer: number
  /** 冲刺冷却 */
  dashCd: number
  /** 冲刺方向（出招瞬间锁定） */
  /**
   * 冲刺方向单位向量。用两个数字而不是枚举名：快照里是标量、
   * 不用像 attackDir 那样为字符串另开一条通道。
   */
  dashVecX: number
  dashVecY: number
  /** 本次冲刺的总帧数（用于线性衰减） */
  dashFramesTotal: number
  /** 本次冲刺的初速 */
  dashSpeedTotal: number
  /** 剩余空中冲刺次数 */
  airDashes: number
  /** 场外复归冲刺剩余次数（落地/抓边/复活时刷新） */
  recoveryDashes: number
  /** 冲刺攻击标记（本次出招是不是冲刺派生的） */
  dashAttack: boolean

  /* ---- 抓边 ---- */
  /** 正在悬挂的边缘信息；null 表示没挂边 */
  ledge: LedgeRef | null
  /** 悬挂后再抓的冷却 */
  ledgeCd: number
  /** 攀爬剩余帧；>0 表示正在爬上台 */
  climbTimer: number
  /** 同一侧边缘的松手锁定 */
  ledgeLock: number

  /* ---- 场地事件免疫 ---- */
  /** 场地伤害免疫帧，避免站在火里每帧掉血 */
  hazardCd: number

  /** 必杀冷却（对应 specials 的两个槽） */
  cooldown: [number, number]

  /** 面向渲染用的状态名 */
  state: FighterState
  /**
   * 当前状态已持续的帧数。渲染层用它做呼吸、跑动起伏、受击抖动等程序化动画。
   * 它是模拟状态的一部分（进快照、进 checksum），所以回滚重演时动画绝不跳。
   */
  stateFramePhase: number
  /** 落地硬直剩余帧 */
  landLag: number
  /** 上一帧位置，供渲染插值 */
  px: number
  py: number
  /** 累计造成伤害，结算用 */
  dealt: number
}

export interface InputState {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  /** 本帧刚按下 */
  jumpPressed: boolean
  /** 按住跳跃键（短跳用：蹲的 4 帧里松手就是短跳） */
  jumpHeld: boolean
  attack: boolean
  /** 下蹲（=防御）。按住方向下即下蹲 */
  shield: boolean
  /** 必杀 1 */
  special: boolean
  /** 必杀 2 */
  special2: boolean
  /** 冲刺（本帧刚按下，上升沿） */
  dashPressed: boolean
  /** 冲刺键是否按住（用于「方向 + 冲刺」判定） */
  dash: boolean
}

export function emptyInput(): InputState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jumpPressed: false,
    jumpHeld: false,
    attack: false,
    shield: false,
    special: false,
    special2: false,
    dashPressed: false,
    dash: false,
  }
}

export interface World {
  frame: number
  stage: StageDef
  /** 平台运行时状态（含破坏/重生/移动），物理只看这个 */
  plats: PlatState[]
  fighters: [Fighter, Fighter]
  projectiles: Projectile[]
  hazards: HazardState[]
  /** 已结束的回合数 */
  round: number
  /** 剩余时间，帧 */
  timeLeft: number
  over: boolean
  /**
   * 对局结束那一帧的 `frame`。`-1` 表示还没结束。
   *
   * 为什么单独存：结束后 `frame` 仍会前进（背景火星、齿轮、迷雾的动画全靠它），
   * 如果「用时」直接取 `frame / 60`，结算页会一直往上涨 —— 这是实测到的 bug。
   * 计时的唯一来源必须是这个冻结值。
   */
  endFrame: number
  winner: 0 | 1 | null
  /** 事件队列，渲染层消费后清空 */
  events: SimEvent[]
  /** 投射物 id 自增 */
  nextProjId: number
}

export interface SimEvent {
  type:
    | 'hit'
    | 'ko'
    | 'land'
    | 'jump'
    | 'shield'
    | 'shieldbreak'
    | 'block'
    | 'dropthrough'
    | 'knockdown'
    | 'trip'
    | 'explode'
    | 'shoot'
    | 'trap'
    | 'grab'
    | 'platformbreak'
    | 'hazard'
    | 'dash'
    | 'ledgegrab'
    | 'climb'
    | 'dashattack'
  who: 0 | 1
  x: number
  y: number
  /** 击飞速度，用于特效强度 */
  power?: number
  /** 命中者，hit 事件用 */
  by?: 0 | 1
  /** 连击段数，渲染层用来决定飘字大小 */
  combo?: number
  /** 文字标签（招式名） */
  label?: string
}

/* ---------------- 攻击与命中 ---------------- */

function aabb(l: number, r: number, t: number, b: number) {
  return { l, r, t, b }
}

export type Box = { l: number; r: number; t: number; b: number }

/**
 * 取出某角色某方向的实际招式帧数据。
 *
 * 全局 MOVES 是所有角色共用的骨架（「基础攻击方式差不多」），
 * 角色的 moveOverrides 只覆盖它想改的字段（「每个角色都有不同的攻击方式」）。
 * 合并后按字段填，不 fold 整个对象——保留骨架的其余部分。
 */
export function moveOf(f: Fighter, dir: AttackDir, dash = false): MoveDef {
  const base = (dash ? DASH_MOVES : MOVES)[dir] as MoveDef
  // 冲刺攻击用独立的 DASH_MOVES 表，不吃角色的基础招式覆盖——
  // 否则「轻角色起招快」会连带把冲刺攻击也削成没有冲击力
  if (dash) return base
  const ov = f.char.moves?.[dir] ?? f.char.moveOverrides?.[dir]
  if (!ov) return base
  return {
    startup: ov.startup ?? base.startup,
    active: ov.active ?? base.active,
    recovery: ov.recovery ?? base.recovery,
    boxW: ov.boxW ?? base.boxW,
    boxH: ov.boxH ?? base.boxH,
    fwd: ov.fwd ?? base.fwd,
    y: ov.y ?? base.y,
    boxBack: ov.boxBack ?? base.boxBack,
    damage: ov.damage ?? base.damage,
    angle: ov.angle ?? base.angle,
    kbGrowth: ov.kbGrowth ?? base.kbGrowth,
    baseKB: ov.baseKB ?? base.baseKB,
  }
}

/**
 * 攻击的判定框（世界坐标）。按面朝方向向前延伸。
 * 这里用 AABB，和 hurtbox 的 swept AABB 同一套坐标。
 */
function attackBox(f: Fighter): Box | null {
  if (f.attackFrame < 0) return null
  if (f.attackKind === 'special') {
    // 必杀里只有投技有近身判定框，其余靠投射物
    const sp = f.specialDef
    if (!sp || sp.kind !== 'grab') return null
    const fr = SPECIAL_FRAMES.grab
    if (f.attackFrame < fr.startup || f.attackFrame >= fr.startup + fr.active) return null
    const reach = sp.speedX
    const cx = f.x + f.attackFacing * (reach * 0.5 + 14)
    const cy = f.y - 34
    return aabb(cx - reach * 0.5 - 14, cx + reach * 0.5 + 14, cy - 24, cy + 24)
  }
  const m = moveOf(f, f.attackDir, f.dashAttack)
  const activeFrom = m.startup
  const activeTo = m.startup + m.active - 1
  if (f.attackFrame < activeFrom || f.attackFrame > activeTo) return null
  // 回身打的招式，判定框开在角色背后（和出招时锁定的朝向相反）
  const sign = m.boxBack ? -f.attackFacing : f.attackFacing
  const cx = f.x + sign * m.fwd
  const cy = f.y + m.y
  return aabb(cx - m.boxW / 2, cx + m.boxW / 2, cy - m.boxH / 2, cy + m.boxH / 2)
}

/**
 * 受击框：以脚底中心为基准，站立时宽 34 高 64（对齐 docs/01-characters.md §2 的标准型）。
 * 下蹲时高度降到 CROUCH_HEIGHT，这既是"蹲下能躲高招式"的机制，
 * 也是变形盾成立的前提——盾体跟着受击框收缩，大盾角色蹲着也会露出头顶。
 * 倒地时受击框压扁成一条，配合无敌虚无。
 */
export function hurtBox(f: Fighter): Box {
  if (f.knockedDown) return aabb(f.x - 22, f.x + 22, f.y - 18, f.y)
  const h = f.crouching ? C.CROUCH_HEIGHT : 64
  return aabb(f.x - 17, f.x + 17, f.y - h, f.y)
}

function overlaps(a: Box, b: Box): boolean {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t
}

/**
 * 击飞公式，取自 docs/01-characters.md / 03：
 *   kb = ((((p/10) + (p*d)/20) * (200/(w+100)) * 1.4) + 18) * kbGrowth + baseKB
 */
function knockback(p: number, d: number, w: number, kbGrowth = 1, baseKB = 0): number {
  const raw = ((((p / 10) + (p * d) / 20) * (200 / (w + 100)) * 1.4) + 18) * kbGrowth + baseKB
  return Math.min(C.KB_MAX, raw)
}

/** 体重档位 → 数值。文档用 middle/light/heavy 三档 */
function weightOf(f: Fighter): number {
  switch (f.char.weightClass) {
    case 'light':
      return 86
    case 'heavy':
      return 112
    default:
      return 98
  }
}

/** 角度查表，缺失就退到 45° */
function angleOf(deg: number): readonly [number, number] {
  return ANGLE_TABLE[deg] ?? ANGLE_TABLE[45]!
}

/* ---------------- 变形盾的几何 ---------------- */

/**
 * 盾体半径：盾满时 34（能挡下从头顶来的上挑），盾空时 20。
 *
 * 曲线是刻意非线性的门槛：半径要 ≥26 才盖得住蹲姿受击框的四角，
 * 也就是盾值掉到约 22（44%）以下才开始漏招。
 */
export function shieldRadius(f: Fighter): number {
  const ratio = Math.max(0, Math.min(1, f.shield / C.SHIELD_MAX))
  return 20 + ratio * 14
}

/** 盾体圆心（相对脚底，向上 30 是站立受击框的中点） */
export function shieldCenter(f: Fighter): { x: number; y: number } {
  const h = f.crouching ? C.CROUCH_HEIGHT : 64
  return { x: f.x, y: f.y - h / 2 }
}

/**
 * 攻击框是否真正被盾挡住。
 *
 * 判据：先取「攻击框 ∩ 受击框」这块重叠区域，再看它的四个角是否都在盾圆内。
 * 只要有一角落到盾圆外，这一下就从盾边漏进去了——直接吃伤害。
 */
function shieldCovers(f: Fighter, hb: Box): boolean {
  const hurt = hurtBox(f)
  const ox1 = Math.max(hb.l, hurt.l)
  const ox2 = Math.min(hb.r, hurt.r)
  const oy1 = Math.max(hb.t, hurt.t)
  const oy2 = Math.min(hb.b, hurt.b)
  if (ox1 >= ox2 || oy1 >= oy2) return false

  const c = shieldCenter(f)
  const r = shieldRadius(f)
  const r2 = r * r
  const corners = [
    { x: ox1, y: oy1 },
    { x: ox2, y: oy1 },
    { x: ox1, y: oy2 },
    { x: ox2, y: oy2 },
  ]
  for (const p of corners) {
    const dx = p.x - c.x
    const dy = p.y - c.y
    if (dx * dx + dy * dy > r2) return false
  }
  return true
}

/* ---------------- 构造 ---------------- */

function makePlats(stage: StageDef): PlatState[] {
  return stage.platforms.map((p) => ({
    id: p.id,
    type: p.type,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    grabbable: p.grabbable,
    hp: p.hp ?? 0,
    maxHp: p.hp ?? 0,
    broken: false,
    respawnTimer: 0,
    baseX: p.x,
    baseY: p.y,
    moveAmp: p.moveAmp ?? 0,
    movePeriod: p.movePeriod ?? 0,
    movePhase: p.movePhase ?? 0,
    flash: 0,
  }))
}

function makeFighter(index: 0 | 1, char: CharDef, stage: StageDef): Fighter {
  const sp = stage.spawnPoints[index === 0 ? 0 : 2]!
  return {
    index,
    char,
    x: sp.x,
    y: sp.y,
    vx: 0,
    vy: 0,
    facing: index === 0 ? 1 : -1,
    onGround: false,
    jumpsLeft: 2,
    jumpSquat: 0,
    fastFalling: false,
    jumpBuffer: 0,
    coyote: 0,
    atkBuffer: 0,
    damage: 0,
    stocks: C.STOCKS,
    invincible: C.RESPAWN_INVINCIBLE,
    respawnTimer: 0,
    hitstun: 0,
    hitlag: 0,
    attackFrame: -1,
    attackHit: false,
    attackFacing: index === 0 ? 1 : -1,
    attackDir: 'neutral',
    attackKind: 'normal',
    specialSlot: 0,
    specialDef: null,
    crouching: false,
    shield: C.SHIELD_MAX,
    shieldRegenDelay: 0,
    shieldBreakStun: 0,
    dropThroughTimer: 0,
    combo: 0,
    comboExpire: 0,
    maxComboTaken: 0,
    knockedDown: false,
    knockdownTimer: 0,
    knockdowns: 0,
    dashTimer: 0,
    dashCd: 0,
    dashVecX: index === 0 ? 1 : -1,
    dashVecY: 0,
    dashFramesTotal: C.DASH_FRAMES,
    dashSpeedTotal: C.DASH_SPEED,
    airDashes: char.airDashes ?? 1,
    recoveryDashes: C.RECOVERY_DASHES,
    dashAttack: false,
    ledge: null,
    ledgeCd: 0,
    climbTimer: 0,
    ledgeLock: 0,
    hazardCd: 0,
    cooldown: [0, 0],
    state: 'idle',
    stateFramePhase: 0,
    landLag: 0,
    px: sp.x,
    py: sp.y,
    dealt: 0,
  }
}

/**
 * 建一局。
 *
 * 刻意接收**已解析的 `CharDef` / `StageDef`**，而不是 id：
 * 内核里不该出现"去哪儿查数据"这件事。查表、校验、哈希在 `loader.ts`，
 * 这样内核可以在没有任何数据源的测试里跑。
 */
export function createWorld(charA: CharDef, charB: CharDef, stage: StageDef): World {
  const plats = makePlats(stage)
  return {
    frame: 0,
    stage,
    plats,
    fighters: [makeFighter(0, charA, stage), makeFighter(1, charB, stage)],
    projectiles: [],
    hazards: stage.hazards.map((def) => ({
      def,
      active: false,
      x: def.x,
      y: def.y,
      w: def.w,
      h: def.h,
    })),
    round: 1,
    timeLeft: 60 * 60 * 6,
    over: false,
  endFrame: -1,
    winner: null,
    events: [],
    nextProjId: 1,
  }
}

/* ---------------- 平台碰撞 ---------------- */

function topOf(p: { y: number }): number {
  return p.y
}

function inX(p: { x: number; w: number }, x: number): boolean {
  return x >= p.x && x <= p.x + p.w
}

/** 单向平台：只在下落且上一帧脚在平台上方时才落上去 */
/** 所有未碎平台的横向外沿与最低顶面 —— 用来判断"人在场外" */
function stageExtent(w: World): { minX: number; maxX: number; bottom: number } {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const p of w.plats) {
    if (p.broken) continue
    if (p.x < minX) minX = p.x
    if (p.x + p.w > maxX) maxX = p.x + p.w
    const t = topOf(p)
    if (t > bottom) bottom = t
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, bottom: 0 }
  return { minX, maxX, bottom }
}

/**
 * 人是否在场外。
 *
 * 只判"横向出沿"或"掉到所有平台之下"，不判高度 —— 跳得高不是罪。
 * 留 30px 宽容带，避免站在台边时被误判（那会让普通冲刺变成复归冲刺）。
 */
/**
 * 这一次冲刺该由什么付费。三种燃料互不通用：
 *
 * - `ground`   站在场地上：免费，只受冷却约束（冲刺是移动方式，不是资源）
 * - `air`      场地内的空中：消耗一次空中冲刺（角色 1–2 次）
 * - `recovery` 场地外：**只能消耗复归次数**（回到场地即补满）
 *
 * `air` 与 `recovery` 必须互斥。第一版写成"场外不消耗空冲次数"，结果是场外
 * 的空冲次数从没被扣过：复归那一次用掉之后，玩家还能靠残留的空冲次数继续
 * 往台面飞 —— 场外冲刺依然是无限的，"谁都掉不下去"的问题压根没解决。
 */
export function dashFuelOf(w: World, f: Fighter): 'ground' | 'air' | 'recovery' | null {
  if (f.onGround) return 'ground'
  if (isOffstage(w, f)) return f.recoveryDashes > 0 ? 'recovery' : null
  return f.airDashes > 0 ? 'air' : null
}

export function isOffstage(w: World, f: Fighter): boolean {
  if (f.onGround) return false
  const e = stageExtent(w)
  return (
    f.x < e.minX - C.OFFSTAGE_MARGIN ||
    f.x > e.maxX + C.OFFSTAGE_MARGIN ||
    f.y > e.bottom + C.OFFSTAGE_BELOW
  )
}

function canLandOn(p: PlatState, f: Fighter, prevY: number): boolean {
  if (p.type === 'solid') return true
  if (p.type === 'ceiling') return false
  return f.vy >= 0 && prevY <= topOf(p) + 1
}

/** 脚下踩着的平台（用于判断能不能穿下去） */
function standingOn(w: World, f: Fighter): PlatState | null {
  for (const p of w.plats) {
    if (p.broken) continue
    if (!inX(p, f.x)) continue
    if (Math.abs(f.y - topOf(p)) < 0.6) return p
  }
  return null
}

/**
 * 移动平台：用三角波代替 sin。
 * 铁律 L2 禁三角函数，而且三角波在模拟层反而更稳（没有浮点超越函数）。
 */
function updateMovingPlatforms(w: World): void {
  for (const p of w.plats) {
    if (p.moveAmp === 0 || p.movePeriod === 0) continue
    const t = (w.frame + p.movePhase) % p.movePeriod
    const half = p.movePeriod / 2
    const k = t < half ? t / half : 2 - t / half
    p.x = p.baseX + (k * 2 - 1) * p.moveAmp
  }
}

/** 平台受伤：hp 归零就碎，若干帧后重生 */
export function damagePlat(w: World, p: PlatState, dmg: number): void {
  if (p.maxHp <= 0 || p.broken) return
  p.hp = Math.max(0, p.hp - dmg * C.PLATFORM_HP_SCALE)
  p.flash = 8
  if (p.hp <= 0) {
    p.broken = true
    p.respawnTimer = 0
    w.events.push({ type: 'platformbreak', who: 0, x: p.x + p.w / 2, y: p.y, label: '平台碎裂' })
  }
}

/* ---------------- 击倒 ---------------- */

/**
 * 触发击倒。
 *
 * 用户的诉求是「一直被连击到最后会有一个击倒效果，击倒之后透明闪烁、无敌虚无」，
 * 所以击倒门槛 = 角色属性（knockdownGate，轻的 100 重的中 115-135）
 * 且必须正在吃连击（>= KNOCKDOWN_MIN_COMBO 段）。
 *
 * 倒地时长与起身无敌帧每个角色不同，这就是「击倒的逻辑每个角色也不太一样」：
 * - 葵（轻）吃得快（100%）但只躺 38 帧，起身 24 帧无敌——滑不留手
 * - 肯（重）要打到 135% 才倒，一躺 58 帧，起身只有 14 帧无敌——倒了就是被打
 */
function applyKnockdown(f: Fighter, w: World, fromCombo: number): void {
  if (f.knockedDown) return
  f.knockedDown = true
  f.knockdownTimer = f.char.knockdownFrames
  f.knockdowns++
  f.hitstun = 0
  f.combo = 0
  f.crouching = false
  f.attackFrame = -1
  f.shieldBreakStun = 0
  // 无敌覆盖整个倒地 + 起身：这就是用户说的"无敌虚无"
  f.invincible = Math.max(f.invincible, f.char.knockdownFrames + f.char.getupInvincible)
  w.events.push({
    type: 'knockdown',
    who: f.index,
    x: f.x,
    y: f.y - 20,
    combo: fromCombo,
    label: `${f.char.displayName} 击倒`,
  })
}

/* ---------------- 投射物 ---------------- */

function spawnProjectile(
  w: World,
  owner: Fighter,
  sp: SpecialDef,
  kind: ProjectileKind,
  x: number,
  y: number,
  vx: number,
  vy: number,
): void {
  if (w.projectiles.length >= C.MAX_PROJECTILES) w.projectiles.shift()
  w.projectiles.push({
    id: w.nextProjId++,
    kind,
    owner: owner.index,
    x,
    y,
    vx,
    vy,
    w: kind === 'arrow' ? 26 : kind === 'explosion' ? 96 : 18,
    h: kind === 'arrow' ? 6 : kind === 'explosion' ? 96 : 18,
    damage: sp.damage,
    angle: sp.angle,
    kbGrowth: sp.kbGrowth,
    baseKB: sp.baseKB,
    life: sp.life,
    gravity: sp.gravity,
    grounded: false,
    fuse: 0,
    spent: false,
    arm: 0,
    facing: owner.facing,
  })
}

/** 发射必杀技（在 startup 帧调用一次） */
function fireSpecial(w: World, f: Fighter, sp: SpecialDef): void {
  const ox = f.x + f.facing * 18
  const oy = f.y - 34
  switch (sp.kind) {
    case 'arrow':
      spawnProjectile(w, f, sp, 'arrow', ox, oy, f.facing * sp.speedX, sp.speedY)
      break
    case 'bottle':
      spawnProjectile(w, f, sp, 'bottle', ox, oy - 12, f.facing * sp.speedX, sp.speedY)
      break
    case 'bomb':
      spawnProjectile(w, f, sp, 'bomb', ox, oy - 12, f.facing * sp.speedX, sp.speedY)
      break
    case 'banana':
      spawnProjectile(w, f, sp, 'banana', ox, oy - 4, f.facing * sp.speedX, sp.speedY)
      break
    case 'trap': {
      // 陷阱直接布在身前的地面，speedX 当作水平距离
      const ground = f.y
      spawnProjectile(w, f, sp, 'trap', f.x + f.facing * sp.speedX, ground, 0, 0)
      const trap = w.projectiles[w.projectiles.length - 1]
      if (trap) {
        trap.grounded = true
        trap.arm = 36
        trap.gravity = false
      }
      break
    }
    case 'grab':
      // 投技不是投射物，直接由 attackBox + 命中结算处理
      break
  }
  w.events.push({
    type: 'shoot',
    who: f.index,
    x: ox,
    y: oy,
    label: sp.name,
  })
}

function updateProjectiles(w: World): void {
  const next: Projectile[] = []
  for (const p of w.projectiles) {
    if (p.life <= 0) continue
    p.life--

    // 引信
    if (p.fuse > 0) {
      p.fuse--
      if (p.fuse === 0) {
        // 变成爆炸
        p.kind = 'explosion'
        p.w = 96
        p.h = 96
        p.life = 14
        p.gravity = false
        p.grounded = false
        p.vx = 0
        p.vy = 0
        w.events.push({ type: 'explode', who: p.owner, x: p.x, y: p.y, label: '爆炸' })
        // 爆炸也会砸碎附近的平台
        for (const pl of w.plats) {
          const cx = Math.max(pl.x, Math.min(p.x, pl.x + pl.w))
          if (Math.abs(cx - p.x) < 70 && Math.abs(pl.y - p.y) < 90) damagePlat(w, pl, p.damage)
        }
      }
    }

    if (p.arm > 0) p.arm--

    if (p.gravity && !p.grounded) {
      p.vy = Math.min(p.vy + C.GRAVITY, C.MAX_FALL)
    }
    if (!p.grounded) {
      p.x += p.vx
      p.y += p.vy
    }

    // 落地
    if (p.gravity && !p.grounded && p.vy >= 0) {
      for (const pl of w.plats) {
        if (pl.broken) continue
        if (p.x < pl.x || p.x > pl.x + pl.w) continue
        if (p.y >= pl.y && p.y <= pl.y + Math.max(pl.h, 24)) {
          p.y = pl.y
          p.grounded = true
          p.vx = 0
          p.vy = 0
          if (p.kind === 'bomb') {
            p.fuse = 46
          } else if (p.kind === 'bottle') {
            // 酒瓶落地即碎，生成一小片火
            p.kind = 'explosion'
            p.w = 64
            p.h = 56
            p.life = 18
            p.gravity = false
            w.events.push({ type: 'explode', who: p.owner, x: p.x, y: p.y - 20, label: '碎瓶' })
          } else if (p.kind === 'banana') {
            p.life = Math.max(p.life, 420)
          }
          break
        }
      }
    }

    // 出界即销毁
    const bz = w.stage.blastZone
    if (p.x < bz.x - 60 || p.x > bz.x + bz.w + 60 || p.y > bz.y + bz.h + 60) continue

    next.push(p)
  }
  w.projectiles = next
}

/** 投射物打人 */
function resolveProjectileHits(w: World): void {
  for (const p of w.projectiles) {
    if (p.spent) continue
    if (p.kind === 'trap' && p.arm > 0) continue
    const box = aabb(p.x - p.w / 2, p.x + p.w / 2, p.y - p.h, p.y)
    for (const f of w.fighters) {
      if (f.index === p.owner) continue
      if (f.respawnTimer > 0 || f.state === 'dead') continue
      if (f.invincible > 0) continue
      if (!overlaps(box, hurtBox(f))) continue

      if (p.kind === 'banana') {
        // 踩到香蕉皮：滑倒（小击倒）+ 一点点伤害，是"连段起手"而不是杀伤
        p.spent = true
        p.life = 0
        f.damage = Math.min(999, f.damage + p.damage)
        f.hitstun = 26
        f.vx = (f.x < p.x ? -1 : 1) * 2.2
        f.vy = -6.4
        f.onGround = false
        w.events.push({ type: 'trip', who: f.index, by: p.owner, x: f.x, y: f.y - 20, label: '滑倒' })
        continue
      }

      if (p.kind === 'trap') {
        p.spent = true
        p.life = 0
        const dmg = p.damage
        f.damage = Math.min(999, f.damage + dmg)
        const attacker = w.fighters[p.owner]!
        attacker.dealt += dmg
        const kb = knockback(f.damage, dmg, weightOf(f), p.kbGrowth, p.baseKB)
        const speed = kb * C.KNOCKBACK_TO_SPEED
        const [cosA, sinA] = angleOf(p.angle)
        f.vx = (f.x < p.x ? -1 : 1) * speed * cosA
        f.vy = -speed * sinA
        f.onGround = false
        f.hitstun = Math.max(C.HITSTUN_MIN, Math.floor(kb * C.HITSTUN_RATIO))
        f.hitlag = C.HITLAG_FRAMES
        if (f.damage >= f.char.knockdownGate) applyKnockdown(f, w, 1)
        w.events.push({
          type: 'trap',
          who: f.index,
          by: p.owner,
          x: f.x,
          y: f.y - 24,
          power: speed,
          label: '捕兽夹',
        })
        continue
      }

      // 爆炸/箭/瓶/雷：命中一次就消耗
      p.spent = true
      p.life = 0
      const attacker = w.fighters[p.owner]!
      const dmg = p.damage
      f.damage = Math.min(999, f.damage + dmg)
      attacker.dealt += dmg
      attacker.combo++
      attacker.comboExpire = C.COMBO_EXPIRE
      f.maxComboTaken = Math.max(f.maxComboTaken, attacker.combo)
      const kb = knockback(f.damage, dmg, weightOf(f), p.kbGrowth, p.baseKB)
      const speed = kb * C.KNOCKBACK_TO_SPEED
      const [cosA, sinA] = angleOf(p.angle)
      const dirX: Facing = f.x < p.x ? -1 : 1
      f.vx = dirX * speed * cosA
      f.vy = -speed * sinA
      f.onGround = false
      f.hitstun = Math.max(C.HITSTUN_MIN, Math.floor(kb * C.HITSTUN_RATIO))
      f.hitlag = C.HITLAG_FRAMES
      if (f.damage >= f.char.knockdownGate && attacker.combo >= C.KNOCKDOWN_MIN_COMBO) {
        f.vy -= C.KNOCKDOWN_BOUNCE
        applyKnockdown(f, w, attacker.combo)
      }
      w.events.push({
        type: 'hit',
        who: f.index,
        by: p.owner,
        x: f.x,
        y: f.y - 28,
        power: speed,
        combo: attacker.combo,
        label: p.kind === 'arrow' ? '箭' : '爆炸',
      })
    }
  }
}

/* ---------------- 抓边与攀爬 ---------------- */

/**
 * 找出角色可以抓住的边缘。
 *
 * 大乱斗最关键的一条「没死成」的机制：被打出场地后，只要还能碰到台边就有救。
 * 判定条件刻意宽松——只要脚在台面下方 LEDGE_GRAB_Y 范围内且横向贴着边缘就算抓住，
 * 因为玩家在被打飞时根本无法精确对位。
 */
export function findLedge(w: World, f: Fighter): LedgeRef | null {
  if (f.onGround || f.knockedDown) return null
  if (f.ledgeCd > 0 || f.ledgeLock > 0) return null
  for (const p of w.plats) {
    if (p.broken || !p.grabbable) continue
    const top = topOf(p)
    // 脚必须低于台面（否则已经在台上了），且不能低太多
    const dy = f.y - top
    if (dy < 4 || dy > C.LEDGE_GRAB_Y) continue
    const leftEdge = p.x
    const rightEdge = p.x + p.w
    if (Math.abs(f.x - leftEdge) <= C.LEDGE_GRAB_X) {
      return { platId: p.id, x: leftEdge, y: top, side: -1 }
    }
    if (Math.abs(f.x - rightEdge) <= C.LEDGE_GRAB_X) {
      return { platId: p.id, x: rightEdge, y: top, side: 1 }
    }
  }
  return null
}

/** 把人挂到边缘上 */
function grabLedge(w: World, f: Fighter, l: LedgeRef): void {
  f.ledge = l
  f.x = l.x + l.side * -10
  f.y = l.y + 40
  f.vx = 0
  f.vy = 0
  f.onGround = false
  f.fastFalling = false
  f.hitstun = 0
  f.crouching = false
  f.attackFrame = -1
  f.dashTimer = 0
  f.jumpsLeft = 2
  f.airDashes = f.char.airDashes ?? 1
    f.recoveryDashes = C.RECOVERY_DASHES
  f.climbTimer = 0
  f.invincible = Math.max(f.invincible, C.LEDGE_INVINCIBLE)
  w.events.push({ type: 'ledgegrab', who: f.index, x: f.x, y: f.y - 30 })
}

/** 松手/爬上之后清掉悬挂状态 */
function releaseLedge(f: Fighter, lock: boolean): void {
  f.ledge = null
  f.climbTimer = 0
  f.ledgeCd = C.LEDGE_COOLDOWN
  if (lock) f.ledgeLock = C.LEDGE_RELEASE_LOCK
}

/* ---------------- 场地事件 ---------------- */

function updateHazards(w: World): void {
  for (const h of w.hazards) {
    const d = h.def
    const t = (w.frame + d.phase) % Math.max(1, d.period)
    h.active = t < d.duration
    h.x = d.x
    h.y = d.y
    h.w = d.w
    h.h = d.h

    if (d.kind === 'gear') {
      // 齿辊沿 x 往返；用三角波，周期内走一个来回
      const half = d.period / 2
      const k = t < half ? t / half : 2 - t / half
      h.x = d.x + k * 900
      h.active = true
      // 齿辊也会砸平台
      if (t % 60 === 0) {
        for (const pl of w.plats) {
          if (pl.broken) continue
          if (Math.abs(pl.x + pl.w / 2 - (h.x + h.w / 2)) < 90 && Math.abs(pl.y - (h.y + h.h)) < 40) {
            damagePlat(w, pl, 6)
          }
        }
      }
    } else if (d.kind === 'rock') {
      // 落石：周期头部生成，之后自由下落
      const fall = t < 10 ? 0 : (t - 10) * (t - 10) * 0.035
      h.y = d.y + fall
      h.active = t >= 10 && h.y < d.y + 700
    } else if (d.kind === 'lava') {
      // 熔岩上涌：从底部往上顶
      h.y = d.y - (h.active ? Math.min(1, t / 40) * 60 : 0)
    }

    if (!h.active) continue
    if (d.damage <= 0 && d.kind !== 'wind') continue

    const box = aabb(h.x, h.x + h.w, h.y, h.y + h.h)

    if (d.kind === 'wind') {
      // 上升气流：托人，不造成伤害
      for (const f of w.fighters) {
        if (f.respawnTimer > 0) continue
        if (f.x + 17 < h.x || f.x - 17 > h.x + h.w) continue
        if (f.y > h.y + h.h) continue
        if (f.vy > -6) f.vy = Math.max(-6, f.vy - 0.55)
      }
      continue
    }

    for (const f of w.fighters) {
      if (f.respawnTimer > 0 || f.state === 'dead') continue
      if (f.invincible > 0 || f.hazardCd > 0) continue
      if (!overlaps(box, hurtBox(f))) continue
      const dmg = d.damage
      f.damage = Math.min(999, f.damage + dmg)
      f.hazardCd = C.HAZARD_IFRAMES
      const kb = knockback(f.damage, dmg, weightOf(f), 1, d.baseKB)
      const speed = kb * C.KNOCKBACK_TO_SPEED
      const [cosA, sinA] = angleOf(d.angle)
      f.vx = (f.x < h.x + h.w / 2 ? -1 : 1) * speed * cosA
      f.vy = -speed * sinA
      f.onGround = false
      f.hitstun = Math.max(C.HITSTUN_MIN, Math.floor(kb * C.HITSTUN_RATIO))
      f.hitlag = 3
      w.events.push({
        type: 'hazard',
        who: f.index,
        x: f.x,
        y: f.y - 26,
        power: speed,
        label: d.label,
      })
      if (f.damage >= f.char.knockdownGate) applyKnockdown(f, w, 1)
    }
  }
}

/* ---------------- 单帧推进 ---------------- */

/**
 * 由八方向输入决定招式方向。这是"八方打击"的核心：
 * 上/下 + 左/右 = 斜向招式，纯粹靠方向键组合，不需要额外按键。
 */
export function pickAttackDir(inp: InputState, facing: Facing): AttackDir {
  const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0)
  const fwd = dx === 0 ? 0 : dx === facing ? 1 : -1
  if (inp.up) {
    if (fwd === 1) return 'upForward'
    if (fwd === -1) return 'upBack'
    return 'up'
  }
  if (inp.down) {
    if (fwd === 1) return 'downForward'
    if (fwd === -1) return 'downBack'
    return 'down'
  }
  if (fwd === 1) return 'forward'
  if (fwd === -1) return 'back'
  return 'neutral'
}

/**
 * 方向 + 技能键 = 不同的技能。
 *
 * 每个角色的 specials 里，同一 slot 下可以有多条，靠 `dir` 区分：
 * 不按方向时用 `dir` 省略的那条；按了方向就找 `dir` 匹配的那条。
 * 这是"方向键加技能键呈现出来的技能攻击也不同"的落地方式，
 * 而且完全数据驱动——加招式只改 mock/data.ts，不改代码。
 */
export function pickSpecial(f: Fighter, slot: 0 | 1, inp: InputState): SpecialDef | null {
  const cands = f.char.specials.filter((s) => (s.slot ?? 0) === slot)
  if (cands.length === 0) return null
  const want = pickAttackDir(inp, f.facing)
  // 精确匹配方向
  const exact = cands.find((s) => s.dir === want)
  if (exact) return exact
  // 否则回落到无方向的默认技
  const fallback = cands.find((s) => s.dir === undefined || s.dir === 'neutral')
  return fallback ?? cands[0] ?? null
}

/** 破盾：眩晕、盾清零、打断一切动作 */
function breakShield(f: Fighter, w: World): void {
  f.crouching = false
  f.shield = 0
  f.shieldBreakStun = C.SHIELD_BREAK_STUN
  f.attackFrame = -1
  f.hitstun = 0
  f.combo = 0
  w.events.push({ type: 'shieldbreak', who: f.index, x: f.x, y: f.y - 40 })
}

/** 结算一次命中（基础攻击与投技共用），返回造成的击飞速度 */
function applyHit(
  w: World,
  atk: Fighter,
  def: Fighter,
  dmg: number,
  angle: number,
  kbGrowth: number,
  baseKB: number,
  label?: string,
): number {
  def.damage = Math.min(999, def.damage + dmg)
  atk.dealt += dmg
  atk.combo++
  atk.comboExpire = C.COMBO_EXPIRE
  def.maxComboTaken = Math.max(def.maxComboTaken, atk.combo)

  const comboMul = Math.min(1 + (atk.combo - 1) * C.COMBO_KB_PER_HIT, C.COMBO_KB_MAX)
  const overDmg = Math.max(0, def.damage - C.COMBO_DMG_GATE)
  const dmgMul = Math.min(1 + (overDmg / 100) * C.COMBO_DMG_PER_100, 1 + C.COMBO_DMG_MAX)

  const kbRaw = knockback(def.damage, dmg, weightOf(def), kbGrowth, baseKB)
  const kb = Math.min(C.KB_MAX, kbRaw * comboMul * dmgMul)
  const speed = kb * C.KNOCKBACK_TO_SPEED

  def.hitstun = Math.max(C.HITSTUN_MIN, Math.floor(kb * C.HITSTUN_RATIO))
  // 顿帧随伤害增长（4 到 9 帧）：打击感的主要来源，
  // 轻击只抖一下、重击像撞墙，不看数字也能分出招式轻重。
  const lag = Math.min(C.HITLAG_MAX, C.HITLAG_FRAMES + Math.floor(dmg / 6))
  def.hitlag = lag
  atk.hitlag = lag
  def.onGround = false
  def.jumpSquat = 0
  def.fastFalling = false
  def.crouching = false
  def.dashTimer = 0
  def.dashAttack = false
  // 挂在边上被打下来：松手并锁边，防止"挂着白嫖无敌"
  if (def.ledge) releaseLedge(def, true)

  const dirX = atk.attackFacing
  const [cosA, sinA] = angleOf(angle)
  // 角度超过 90° 表示"往身后打"，水平分量要翻向
  const horizontalSign: number = angle > 90 ? -dirX : dirX
  def.vx = horizontalSign * speed * cosA
  def.vy = -speed * sinA

  // 击倒：伤害过了角色门槛 + 正在吃连击
  if (def.damage >= def.char.knockdownGate && atk.combo >= C.KNOCKDOWN_MIN_COMBO) {
    def.vy -= C.KNOCKDOWN_BOUNCE
    applyKnockdown(def, w, atk.combo)
  }

  w.events.push({
    type: 'hit',
    who: def.index,
    by: atk.index,
    x: (atk.x + def.x) / 2,
    y: def.y - 32,
    power: speed,
    combo: atk.combo,
    label,
  })
  return speed
}

export function step(w: World, inputs: [InputState, InputState]): void {
  if (w.over) {
    // 对局已结束：只推进 frame（背景/齿轮/火星的动画要用它），
    // 比赛逻辑一概不跑 —— timeLeft 不动、不结算、不复活。
    // 「用时」请读 endFrame，不要读 frame。
    w.frame++
    w.events.length = 0
    return
  }
  w.frame++
  w.events.length = 0

  const dt = 1
  w.timeLeft = Math.max(0, w.timeLeft - 1)

  updateMovingPlatforms(w)
  // 平台重生
  for (const p of w.plats) {
    if (p.flash > 0) p.flash--
    if (!p.broken) continue
    p.respawnTimer++
    const stagePlat = w.stage.platforms.find((sp) => sp.id === p.id)
    if (p.respawnTimer >= (stagePlat?.respawn ?? 400)) {
      p.broken = false
      p.hp = p.maxHp
      p.respawnTimer = 0
    }
  }

  for (const f of w.fighters) {
    f.px = f.x
    f.py = f.y

    if (f.hitlag > 0) {
      // 顿帧期间冻结一切动作，但**输入仍然记账**。
      // 不记账的话，轻击 5 帧 / 重击 9 帧的顿帧里按下的跳与攻击全被吞掉，
      // 玩家体感是"打中了反而按不动"——顿帧是为了打击感，不是为了让输入失效。
      const inpLag = inputs[f.index]!
      if (inpLag.jumpPressed) f.jumpBuffer = C.JUMP_BUFFER_FRAMES
      if (inpLag.attack) f.atkBuffer = C.ATTACK_BUFFER_FRAMES
      f.hitlag--
      continue
    }
    if (f.hazardCd > 0) f.hazardCd--

    if (f.respawnTimer > 0) {
      f.respawnTimer--
      if (f.respawnTimer === 0) {
        const sp = w.stage.spawnPoints[f.index === 0 ? 0 : 2]!
        f.x = sp.x
        f.y = sp.y
        f.vx = 0
        f.vy = 0
        f.damage = 0
        f.invincible = C.RESPAWN_INVINCIBLE
        f.state = 'fall'
      }
      continue
    }

    if (f.invincible > 0) f.invincible--
    if (f.dashCd > 0) f.dashCd--
    // 复归次数：回到战斗场地范围内、且已脱离击飞/倒地，就补满。
    // 不用"落地才重置"——冲回台面上方还在空中时玩家已经回到场地了，那一下就该算数；
    // 也不允许击飞途中横穿场地上空就重置，否则被从左边打飞、飘过场地上空就白拿一发。
    if (f.recoveryDashes < C.RECOVERY_DASHES && f.hitstun <= 0 && !f.knockedDown && !isOffstage(w, f)) {
      f.recoveryDashes = C.RECOVERY_DASHES
    }
    if (f.ledgeCd > 0) f.ledgeCd--
    if (f.ledgeLock > 0) f.ledgeLock--

    // 必杀冷却
    for (let i = 0; i < 2; i++) if (f.cooldown[i]! > 0) f.cooldown[i]!--

    /* ---------- 击倒：倒地期间完全不可控，物理照走 ---------- */
    if (f.knockedDown) {
      f.knockdownTimer--
      if (f.knockdownTimer <= 0) {
        f.knockedDown = false
        // 起身瞬时给一小段"站起硬直"，让无敌帧有可感知的收尾
        f.landLag = C.LAND_LAG_FRAMES
      }
      // 躺地滑行，摩擦更大
      if (f.onGround) {
        f.vx *= C.KNOCKDOWN_FRICTION
        if (Math.abs(f.vx) < 0.1) f.vx = 0
      }
    }

    /* ---------- 悬挂在边缘：完全锁定，只能用跳跃/上爬回场 ---------- */
    if (f.ledge) {
      const inp0 = inputs[f.index]
      f.vx = 0
      f.vy = 0
      f.onGround = false
      f.state = 'ledge'
      f.stateFramePhase++
      // 爬上台：跳跃键 / 上方向，这就是用户说的「按跳跃键+方向键跳回战斗场地」
      if (f.climbTimer > 0) {
        f.climbTimer--
        if (f.climbTimer === 0) {
          const l = f.ledge
          // 重新取"当前"平台：悬挂期间平台可能被击碎、也可能横移了。
          // 用抓取时缓存的 l.x 会让角色落到台面外却仍被置为 onGround ——
          // 那就是"站到空中"。
          const p = w.plats.find((pp) => pp.id === l.platId)
          if (!p || p.broken) {
            releaseLedge(f, true)
          } else {
            const top = topOf(p)
            // 朝场地内侧爬：左沿（side -1）往右移，右沿（side 1）往左移。
            // 之前写成 l.x + side*18 是往外移，正好反了。
            const inset = Math.min(22, Math.max(8, p.w * 0.35))
            f.x = l.side < 0 ? p.x + inset : p.x + p.w - inset
            f.y = top
            f.vx = 0
            f.vy = 0
            f.onGround = true
            f.jumpsLeft = 2
            f.airDashes = f.char.airDashes ?? 1
    f.recoveryDashes = C.RECOVERY_DASHES
            f.coyote = C.COYOTE_FRAMES
            releaseLedge(f, false)
            f.landLag = C.LAND_LAG_FRAMES
            w.events.push({ type: 'climb', who: f.index, x: f.x, y: f.y })
          }
        }
      } else if (inp0.jumpPressed || inp0.up) {
        // 上爬要 16 帧，期间无敌但也不能动——给对手一个"知道你要爬"的窗口
        f.climbTimer = C.LEDGE_CLIMB_FRAMES
        w.events.push({ type: 'climb', who: f.index, x: f.x, y: f.y - 20, label: 'climb' })
      } else if (inp0.down) {
        // 松手：往下掉，同时锁 30 帧不能马上又抓住同一侧
        releaseLedge(f, true)
      }
      // 已经处理完这一帧的角色物理，跳过下面的常规逻辑
      f.x += 0
      continue
    }

    const inp = inputs[f.index]
    // 先递减落地硬直再算 canAct：否则"硬直归零"那一帧仍被判为不能动，
    // 帧末的缓冲衰减又会把刚好等到的输入吃掉 —— 差一帧的手感 bug。
    if (f.landLag > 0) f.landLag--
    const controllable = !f.knockedDown && f.hitstun <= 0 && f.shieldBreakStun <= 0 && f.landLag <= 0
    const canAct = controllable

    // ---- 输入缓冲 ----
    // 把玩家意图与内核允许的时机解耦：没有缓冲时，落地前 1 帧按跳会被
    // 直接丢掉，玩家体感是"按了没反应"。记住 4 帧，能起跳当帧补发。
    // 只在这里"装填"，衰减放到本帧末尾（见「郊狼时间」段之后的 EXPIRY）：
    // 若在这一行就衰减，落地当帧会出现"缓冲刚好归零、动作块看不到它"的错位。
    if (inp.jumpPressed) f.jumpBuffer = C.JUMP_BUFFER_FRAMES
    if (inp.attack) f.atkBuffer = C.ATTACK_BUFFER_FRAMES
    if (f.hitstun > 0) f.hitstun--
    if (f.shieldBreakStun > 0) {
      f.shieldBreakStun--
      if (f.shieldBreakStun === 0) {
        f.shield = C.SHIELD_BREAK_RESET
        f.shieldRegenDelay = C.SHIELD_REGEN_DELAY
      }
    }

    // ---- 出招推进 ----
    if (f.attackFrame >= 0) {
      f.attackFrame++
      if (f.attackKind === 'special') {
        const sp = f.specialDef
        if (sp) {
          const fr = SPECIAL_FRAMES[sp.kind]
          const total = fr.startup + fr.active + fr.recovery
          // 在 startup 帧发射一次
          if (f.attackFrame === fr.startup + 1 && !f.attackHit) {
            if (sp.kind === 'grab') {
              // 投技的"命中"由下面 attackBox 判定，这里只标记已触发
            } else {
              fireSpecial(w, f, sp)
              f.attackHit = true
            }
          }
          if (f.attackFrame >= total) {
            f.attackFrame = -1
            f.attackHit = false
          }
        } else {
          f.attackFrame = -1
        }
      } else {
        const m = moveOf(f, f.attackDir, f.dashAttack)
        const total = m.startup + m.active + m.recovery
        if (f.attackFrame >= total) {
          f.attackFrame = -1
          f.attackHit = false
          if (f.dashAttack) {
            f.dashAttack = false
            f.landLag = C.DASH_ENDLAG
          }
        }
      }
    } else if (canAct && f.jumpSquat === 0 && (inp.attack || inp.special || inp.special2 || f.atkBuffer > 0)) {
      // 起手瞬间锁定朝向与方向：出招后转身不改判定方向。
      // 允许从下蹲直接出招（下段攻击就是按住 S 再按 J），出招时自动起身。
      f.crouching = false
      f.attackFrame = 0
      f.attackHit = false
      f.atkBuffer = 0
      f.attackFacing = f.facing
      /* 冲刺攻击：冲刺中按攻击，出招换成 DASH_MOVES 那一套，伤害与位移都更大 */
      f.specialDef = null
      const inDashWindow = f.dashTimer > 0
      if (inDashWindow && inp.attack && !inp.special && !inp.special2) {
        f.dashAttack = true
        f.attackKind = 'normal'
        f.attackDir = pickAttackDir(inp, f.facing)
        // 冲刺攻击把剩余冲刺速度当"前冲"，形成冲拳的合成位移
        const glide = Math.max(Math.abs(f.vx), C.DASH_SPEED * DASH_ATTACK_GLIDE)
        f.vx = f.dashVecX * glide
        // 只有"朝下冲"的攻击把下坠速度加上去；朝上冲时保留原来的上冲
        if (f.dashVecY > 0) f.vy = Math.max(f.vy, f.dashVecY * glide)
        f.dashTimer = 0
        w.events.push({
          type: 'dashattack',
          who: f.index,
          x: f.x,
          y: f.y - 30,
          label: f.attackDir,
        })
      } else if (inp.special || inp.special2) {
        const slot: 0 | 1 = inp.special ? 0 : 1
        const sp = pickSpecial(f, slot, inp)
        if (sp && sp.slot !== undefined && f.cooldown[sp.slot]! <= 0) {
          f.attackKind = 'special'
          f.specialSlot = sp.slot
          f.specialDef = sp
          f.cooldown[sp.slot] = sp.cooldown
        } else {
          // 没这个必杀或者还在冷却：退回普通攻击
          f.attackKind = 'normal'
          f.attackDir = pickAttackDir(inp, f.facing)
        }
      } else {
        f.attackKind = 'normal'
        f.attackDir = pickAttackDir(inp, f.facing)
      }
    }
    const attacking = f.attackFrame >= 0

    /* ---------- 冲刺：方向 + 冲刺键 ---------- */
    if (f.dashTimer > 0) {
      // 冲刺中速度线性衰减到 DASH_END_SPEED
      const k = f.dashTimer / Math.max(1, f.dashFramesTotal)
      const sp = C.DASH_END_SPEED + (f.dashSpeedTotal - C.DASH_END_SPEED) * k
      f.vx = f.dashVecX * sp
      f.vy = f.dashVecY * sp
      f.dashTimer--
      if (f.dashTimer === 0) f.landLag = C.DASH_ENDLAG
    } else if (
      controllable &&
      f.jumpSquat === 0 &&
      !attacking &&
      f.ledge === null &&
      f.climbTimer === 0 &&
      inp.dashPressed &&
      f.dashCd <= 0 &&
      dashFuelOf(w, f) !== null
    ) {
      // 冲刺方向：按住的方向；没按方向就按朝向
      const dn = pickDashDir(inp, f.facing)
      const vec = DASH_UNIT[dn]
      const fuel = dashFuelOf(w, f) ?? 'ground'
      const offstage = fuel === 'recovery'
      f.dashVecX = vec[0]
      f.dashVecY = vec[1]
      // 只有纯水平冲刺才改朝向：上/下冲刺时角色应当继续面朝对手
      if (vec[0] !== 0) f.facing = vec[0] > 0 ? 1 : -1
      f.crouching = false
      const speedMul = (f.char.dashSpeedMul ?? 1) * (offstage ? C.OFFSTAGE_DASH_MUL : 1)
      const framesMul = f.char.dashFramesMul ?? 1
      const airMul = f.onGround ? 1 : C.AIR_DASH_MUL
      const dirMul = vec[0] !== 0 && vec[1] !== 0 ? C.DASH_DIAGONAL_MUL : 1
      f.dashSpeedTotal = C.DASH_SPEED * speedMul * airMul * dirMul
      f.dashFramesTotal = Math.max(
        4,
        Math.round(C.DASH_FRAMES * framesMul * airMul * (offstage ? C.OFFSTAGE_DASH_FRAMES_MUL : 1)),
      )
      f.dashTimer = f.dashFramesTotal
      const cd0 = f.char.dashCooldown ?? C.DASH_COOLDOWN
      f.dashCd = offstage ? Math.max(4, Math.round(cd0 * C.OFFSTAGE_DASH_CD_MUL)) : cd0
      if (!f.onGround) {
        // 场外只扣复归次数、场内空中只扣空冲次数 —— 两种燃料严格互斥，
        // 否则残留的空冲次数会在场外变成"第二发复归"。
        if (fuel === 'recovery') f.recoveryDashes--
        else if (fuel === 'air') f.airDashes--
        f.fastFalling = false
      }
      w.events.push({
        type: 'dash',
        who: f.index,
        x: f.x,
        y: f.y,
        label: offstage ? 'recovery' : f.onGround ? 'dash' : 'airdash',
      })
      f.dashTimer--
      f.vx = f.dashVecX * f.dashSpeedTotal
      f.vy = f.dashVecY * f.dashSpeedTotal
    }

    // ---- 下蹲 = 防御 ----
    const wantCrouch = canAct && !attacking && inp.shield
    if (wantCrouch && f.onGround) {
      f.crouching = true
      f.shield = Math.max(0, f.shield - C.SHIELD_DRAIN)
      f.shieldRegenDelay = C.SHIELD_REGEN_DELAY
      if (f.shield <= 0) breakShield(f, w)
    } else {
      f.crouching = false
      if (f.shieldRegenDelay > 0) f.shieldRegenDelay--
      else if (f.shield < C.SHIELD_MAX) {
        f.shield = Math.min(C.SHIELD_MAX, f.shield + C.SHIELD_REGEN)
      }
    }
    if (f.dropThroughTimer > 0) f.dropThroughTimer--
    if (f.comboExpire > 0) {
      f.comboExpire--
      if (f.comboExpire === 0) f.combo = 0
    }

    // ---- 起跳蹲 ----
    // 短跳：蹲的这 4 帧里松手就是短跳。这是"轻点跳得矮"的唯一实现方式，
    // 也是平台格斗里上平台、躲招、抢身位的基本功。
    if (f.jumpSquat > 0) {
      f.jumpSquat--
      const shortHop = !inp.jumpHeld
      if (f.jumpSquat === 0 || shortHop) {
        f.vy = -(shortHop ? C.SHORT_HOP_VELOCITY : C.FULL_JUMP_VELOCITY)
        f.jumpSquat = 0
        f.onGround = false
        f.jumpsLeft = Math.max(0, f.jumpsLeft - 1)
        f.coyote = 0
        w.events.push({
          type: 'jump',
          who: f.index,
          x: f.x,
          y: f.y,
          power: shortHop ? 0.5 : 1,
        })
      }
    } else if (canAct && !attacking && f.jumpBuffer > 0) {
      if (f.onGround || f.coyote > 0) {
        const under = standingOn(w, f)
        if (f.crouching && under && under.type === 'passthrough') {
          f.crouching = false
          f.onGround = false
          f.vy = 1
          f.dropThroughTimer = C.DROP_THROUGH_FRAMES
          f.jumpSquat = 0
          // 主动下穿要把郊狼时间与跳跃缓冲清掉：否则刚离地那一帧
          // 缓冲会立刻判成"地面跳"（郊狼时间还在），人又被托回平台上。
          f.coyote = 0
          f.jumpBuffer = 0
          w.events.push({ type: 'dropthrough', who: f.index, x: f.x, y: f.y })
        } else {
          f.jumpSquat = C.JUMP_SQUAT_FRAMES
          f.onGround = false
          f.jumpBuffer = 0
        }
      } else if (f.jumpsLeft > 0) {
        f.vy = -C.FULL_JUMP_VELOCITY * 0.92
        f.jumpsLeft--
        f.fastFalling = false
        f.jumpBuffer = 0
        f.coyote = 0
        w.events.push({ type: 'jump', who: f.index, x: f.x, y: f.y })
      }
    }

    // ---- 水平输入 ----
    const speedScale = f.crouching ? 0 : 1
    const dir = controllable && f.jumpSquat === 0 && !attacking
      ? ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * speedScale
      : 0

    // 冲刺期间不接管水平速度：动作块已经每帧写好了 vx。
    // 若不跳过，下面的 MAX_RUN×1.4 = 12.6 夹取会把冲刺速度（17 甚至 26）
    // 直接削到 12.6 —— 冲刺看起来"有前冲"，实际位移和跑步差不多。
    if (f.dashTimer <= 0) {
      if (f.onGround) {
        if (dir !== 0) {
          f.vx += dir * C.GROUND_ACCEL * dt
          const cap = C.MAX_RUN * (1 + f.damage / 1000)
          f.vx = Math.max(-cap, Math.min(cap, f.vx))
          f.facing = dir > 0 ? 1 : -1
        } else {
          f.vx *= C.FRICTION
          if (Math.abs(f.vx) < 0.05) f.vx = 0
        }
      } else {
        if (dir !== 0) {
          f.vx += dir * C.AIR_ACCEL * dt
          f.facing = dir > 0 ? 1 : -1
        }
        f.vx *= C.AIR_DRAG
        const speedCap = f.hitstun > 0 || f.knockedDown ? C.KB_MAX * C.KNOCKBACK_TO_SPEED : C.MAX_RUN * 1.4
        f.vx = Math.max(-speedCap, Math.min(speedCap, f.vx))
      }
    }

    // ---- 重力 ----
    // 冲刺期间不加重力：否则"上冲"被重力吃掉一半、"平冲"会提前变坠，
    // 八方向冲刺就退化成"四个方向都能冲但都不准"。
    if (!f.onGround && f.dashTimer <= 0) {
      if (controllable && inp.down && f.vy > 0) f.fastFalling = true
      const maxFall = f.fastFalling ? C.FAST_FALL_SPEED : C.MAX_FALL
      const gMul = f.hitstun > 0 || f.knockedDown ? C.HITSTUN_GRAVITY_MUL : 1
      f.vy = Math.min(f.vy + C.GRAVITY * gMul * dt, maxFall)
    }

    // ---- 位移 ----
    const prevY = f.y
    f.x += f.vx * dt
    f.y += f.vy * dt

    // ---- 落地判定 ----
    let landed: PlatState | null = null
    if (f.vy >= 0) {
      for (const p of w.plats) {
        if (p.broken) continue
        if (!inX(p, f.x)) continue
        if (!canLandOn(p, f, prevY)) continue
        if (f.dropThroughTimer > 0 && p.type === 'passthrough') continue
        if (prevY <= topOf(p) + 1 && f.y >= topOf(p)) {
          if (!landed || topOf(p) < topOf(landed)) landed = p
        }
      }
    }

    if (landed) {
      const wasAir = !f.onGround
      const fallSpeed = f.vy
      f.y = topOf(landed)
      f.vy = 0
      f.onGround = true
      f.jumpsLeft = 2
      f.airDashes = f.char.airDashes ?? 1
    f.recoveryDashes = C.RECOVERY_DASHES
      f.fastFalling = false
      if (wasAir) {
        // 硬直与落地速度挂钩：轻落 2 帧、满速硬落 6 帧。固定 3 帧时
        // "从高空砸下来"和"小跳落地"手感完全一样，跳的价值折半。
        f.landLag = Math.max(
          C.LAND_LAG_MIN,
          Math.min(C.LAND_LAG_MAX, Math.round(fallSpeed / 3)),
        )
        w.events.push({
          type: 'land',
          who: f.index,
          x: f.x,
          y: f.y,
          power: Math.min(fallSpeed / C.MAX_FALL, 2),
        })
      }
    } else {
      // 没落到任何平台 = 悬空。
      //
      // 这里曾经写成 `else if (f.y < 0 || f.vy !== 0)`，本意是"只在离地或竖直运动时复查"，
      // 但主台顶面就在 y = 0：站着不动时 `y < 0` 与 `vy !== 0` 都不成立，
      // 于是走出台边那一刻 onGround 一直是 true —— 角色可以直接在空中走。
      // 现在无条件复查支撑点，判据只剩"脚底有没有台面"。
      const support = w.plats.some(
        (p) => !p.broken && inX(p, f.x) && Math.abs(f.y - topOf(p)) < 0.6 && p.type !== 'ceiling',
      )
      if (!support) f.onGround = false
    }

    // ---- 抓边：掉出场地但手还能碰到台边就抓住（大乱斗最重要的"活下来"机制） ----
    //
    // 三条门槛，都是为了让"抓边"变成玩家的**意图**而不是系统的自动行为：
    //   · 正在下降或刚到顶点（vy >= 0）：往上蹿的时候不该粘住台边；
    //   · 没按着下：下方向键的语义就是"放手/下穿"，此时还粘住会让人以为按键失灵；
    //   · 不在击倒/锁定/上爬中。
    // 少了前两条，玩家站在台边按住下（想蹲防或想下穿）就会被系统一把抓住台沿，
    // 抬起手又爬上台面——看起来就像"我按了个下，人自己爬上来了"。
    if (
      !f.onGround &&
      !f.knockedDown &&
      f.ledgeCd <= 0 &&
      f.ledgeLock <= 0 &&
      f.climbTimer === 0 &&
      f.vy >= -0.5 &&
      !inputs[f.index]!.down
    ) {
      const l = findLedge(w, f)
      if (l) {
        grabLedge(w, f, l)
        continue
      }
    }

    // ---- 郊狼时间 ----
    // 站地上充满，离地后逐帧递减。这 3 帧不是无敌，而是补偿
    // 玩家看到自己还在平台上与内核已判定离地之间的感知差。
    if (f.onGround) f.coyote = C.COYOTE_FRAMES
    else if (f.coyote > 0) f.coyote--

    // 输入缓冲衰减（放在帧末，让本帧的动作块先看到缓冲值）。
    // 落地硬直期间不衰减：硬直本身禁止起跳，若还按帧消耗，
    // "落地前按跳"就永远等不到能跳的那一帧 —— 缓冲等于白做。
    if (f.jumpBuffer > 0 && f.landLag <= 0) f.jumpBuffer--
    if (f.atkBuffer > 0 && f.landLag <= 0) f.atkBuffer--

    // ---- 出界 ----
    const bz = w.stage.blastZone
    const out = f.x < bz.x || f.x > bz.x + bz.w || f.y < bz.y || f.y > bz.y + bz.h
    if (out) {
      f.stocks--
      f.damage = 0
      f.vx = 0
      f.vy = 0
      f.onGround = false
      f.crouching = false
      f.hitstun = 0
      f.shieldBreakStun = 0
      f.shield = C.SHIELD_MAX
      f.combo = 0
      f.dropThroughTimer = 0
      f.knockedDown = false
      f.knockdownTimer = 0
      f.dashTimer = 0
      f.dashCd = 0
      f.ledge = null
      f.climbTimer = 0
      f.ledgeLock = 0
      f.ledgeCd = 0
      f.airDashes = f.char.airDashes ?? 1
    f.recoveryDashes = C.RECOVERY_DASHES
      f.dashAttack = false
      w.events.push({ type: 'ko', who: f.index, x: f.x, y: f.y })
      if (f.stocks <= 0) {
        f.state = 'dead'
        w.over = true
        w.endFrame = w.frame
        w.winner = f.index === 0 ? 1 : 0
      } else {
        f.respawnTimer = C.RESPAWN_DELAY_FRAMES
        f.state = 'dead'
      }
      continue
    }

    // ---- 状态名（纯渲染用） ----
    const prevState = f.state
    if (f.knockedDown) f.state = 'knockdown'
    else if (f.shieldBreakStun > 0) f.state = 'broken'
    else if (f.hitstun > 0) f.state = 'hurt'
    else if (attacking) {
      if (f.dashAttack) f.state = 'dashattack'
      else f.state = f.attackKind === 'special' ? 'special' : 'attack'
    } else if (f.crouching) f.state = 'crouch'
    else if (f.landLag > 0) f.state = 'land'
    else if (f.dashTimer > 0) f.state = 'dash'
    else if (!f.onGround) f.state = f.vy < 0 ? 'jump' : 'fall'
    else f.state = Math.abs(f.vx) > 0.6 ? 'run' : 'idle'
    if (f.state === prevState) f.stateFramePhase++
    else f.stateFramePhase = 0
  }

  /* ---- 投射物 ---- */
  updateProjectiles(w)

  /* ---- 场地事件 ---- */
  updateHazards(w)

  /* ---- 命中结算：一帧内完成（铁律 L6） ---- */
  const [a, b] = w.fighters
  for (const [atk, def] of [
    [a, b],
    [b, a],
  ] as const) {
    if (atk.attackFrame < 0 || atk.attackHit) continue
    if (def.respawnTimer > 0 || def.invincible > 0 || def.state === 'dead') continue
    const hb = attackBox(atk)
    if (!hb) continue
    if (!overlaps(hb, hurtBox(def))) continue

    atk.attackHit = true

    /* ---- 必杀：投技 ---- */
    if (atk.attackKind === 'special') {
      const sp = atk.specialDef
      if (sp && sp.kind === 'grab') {
        applyHit(w, atk, def, sp.damage, sp.angle, sp.kbGrowth, sp.baseKB, sp.name)
        w.events.push({
          type: 'grab',
          who: def.index,
          by: atk.index,
          x: def.x,
          y: def.y - 30,
          label: sp.name,
        })
      }
      continue
    }

    const m = MOVES[atk.attackDir]
    const hitX = (atk.x + def.x) / 2
    const hitY = def.y - 32

    /* ---- 防御分支：盾挡住则扣盾值不扣血；盾太小漏过去照常吃伤害 ---- */
    if (def.crouching && shieldCovers(def, hb)) {
      const shieldCost = m.damage * C.SHIELD_DAMAGE_MUL + C.SHIELD_DAMAGE_BASE
      def.shield = Math.max(0, def.shield - shieldCost)
      def.shieldRegenDelay = C.SHIELD_REGEN_DELAY
      const chip = m.damage * C.SHIELD_KB_MUL * 0.6
      def.vx = atk.attackFacing * chip
      def.hitlag = Math.floor(C.HITLAG_FRAMES * 0.7)
      atk.hitlag = Math.floor(C.HITLAG_FRAMES * 0.7)

      if (def.shield <= 0) {
        breakShield(def, w)
      } else {
        w.events.push({
          type: 'block',
          who: def.index,
          by: atk.index,
          x: hitX,
          y: hitY,
          power: chip,
        })
      }
      continue
    }
    const shieldLeaked = def.crouching
    if (shieldLeaked) {
      def.shield = Math.max(0, def.shield - m.damage * 0.5)
      if (def.shield <= 0) breakShield(def, w)
    }

    applyHit(w, atk, def, m.damage, m.angle, m.kbGrowth, m.baseKB)

    // 下砸招式砸到脚下平台会把它打裂（"可破坏地形"的可感知入口）
    if (atk.attackDir === 'down' || atk.attackDir === 'downForward') {
      for (const p of w.plats) {
        if (p.broken || p.maxHp <= 0) continue
        if (Math.abs(p.y - def.y) < 40 || Math.abs(p.y - atk.y) < 40) {
          if (inX(p, atk.x)) damagePlat(w, p, Math.round(m.damage * 0.7))
        }
      }
    }
  }

  /* ---- 投射物打人 ---- */
  resolveProjectileHits(w)

  // 时间到，命多的一方赢
  if (!w.over && w.timeLeft === 0) {
    const [fa, fb] = w.fighters
    w.over = true
    w.endFrame = w.frame
    w.winner = fa.stocks > fb.stocks ? 0 : fb.stocks > fa.stocks ? 1 : 0
  }
}

