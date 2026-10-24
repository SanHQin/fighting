/**
 * 战斗内核的内容类型（角色 / 场地 / 招式绑定）。
 *
 * 这些是**数据契约**，不是运行时状态：没有任何 DOM、时间、随机源依赖。
 * 未来的 `char.json` / `stage.json` 只要满足这里的形状就能被 loader 接受。
 */

export type WeightClass = 'light' | 'middle' | 'heavy'

/** 招式方向。八方向 + 中立 */
export type AttackDir =
  | 'neutral'
  | 'forward'
  | 'back'
  | 'up'
  | 'upForward'
  | 'upBack'
  | 'down'
  | 'downForward'
  | 'downBack'

/** 覆盖一套招式帧数据的若干字段（角色定制用） */
export interface MoveOverride {
  /** 招式显示名称；仅表现信息，不参与模拟逻辑 */
  name?: string
  startup?: number
  active?: number
  recovery?: number
  boxW?: number
  boxH?: number
  fwd?: number
  y?: number
  boxBack?: boolean
  damage?: number
  angle?: number
  kbGrowth?: number
  baseKB?: number
}

/**
 * 角色独有必杀技的种类。
 *
 * 九个方向攻击所有角色共用一套帧数据骨架，
 * 只有伤害、判定框、击飞成长按角色微调；真正区分角色的是这里。
 */
export type SpecialKind =
  | 'arrow' // 射弓箭：直线飞行，速度快，判定窄
  | 'bottle' // 扔酒瓶：抛物线，落地碎成火区
  | 'bomb' // 炸弹：抛物线，落地延时引爆，范围伤害
  | 'banana' // 香蕉皮：落地静止，踩到滑倒
  | 'trap' // 陷阱：布置在地面，延时后激活
  | 'grab' // 投技：近身抓取，抓到了丢出去

/** 一个独有必杀的数据绑定，挂在角色定义上 */
export interface SpecialDef {
  kind: SpecialKind
  /** 显示名 */
  name: string
  /**
   * 这个必杀属于哪个技能键槽：0 = 第一个技能键，1 = 第二个。
   * 同一槽下的多个条目靠 `dir` 区分——"方向键 + 技能键 = 不同技能"。
   */
  slot?: 0 | 1
  /** 需要按住的方向；省略 = 无方向时默认触发 */
  dir?: AttackDir
  /** 冷却帧数，防止无脑连发 */
  cooldown: number
  damage: number
  /** 击飞角度（度，0 = 水平朝前，正数朝上） */
  angle: number
  kbGrowth: number
  baseKB: number
  /** 投射物初速（水平 + 垂直），grab 用抓取距离 */
  speedX: number
  speedY: number
  /** 受重力影响（抛物线用 true，直线用 false） */
  gravity: boolean
  /** 存活帧数，超过就消失 */
  life: number
}

/** 角色静态定义，对应 docs/01-characters.md §1.5 的 char.json */
export interface CharDef {
  id: string
  /** 全局唯一且永不复用，进网络协议与回放文件 */
  numId: number
  displayName: string
  displayNameEn: string
  weightClass: WeightClass
  selectOrder: number
  /** 一句话特性，选人页显示 */
  tagline: string
  /** 1-5 星 */
  speed: number
  power: number
  /** 主色，占位期用色块 */
  color: string
  colorDark: string
  locked: boolean
  moveCount: number
  specials: SpecialDef[]
  /** 九方向完整招式配置；未配置方向会使用核心默认值 */
  moves?: Partial<Record<AttackDir, MoveOverride>>
  /** 招式定制：覆盖全局 MOVES 的字段 */
  moveOverrides?: Partial<Record<AttackDir, MoveOverride>>
  /** 冲刺速度倍率 */
  dashSpeedMul?: number
  /** 冲刺持续帧数倍率 */
  dashFramesMul?: number
  /** 空中冲刺次数 */
  airDashes?: number
  /** 冲刺冷却帧 */
  dashCooldown?: number
  /** 冲刺攻击的伤害倍率 */
  dashAttackMul?: number
  /** 击倒门槛：伤害到这个百分比后，被连击就会被打倒在地 */
  knockdownGate: number
  /** 击倒起身帧 */
  knockdownFrames: number
  /** 起身无敌帧 */
  getupInvincible: number
}

export type PlatformType = 'solid' | 'passthrough' | 'ceiling'

export interface Platform {
  id: number
  type: PlatformType
  x: number
  y: number
  w: number
  h: number
  grabbable: boolean
  /** 可破坏平台：被打到扣血，归零就碎，若干帧后重生。0 或省略 = 不可破坏 */
  hp?: number
  respawn?: number
  /** 移动平台：水平往返的振幅与周期（像素 / 帧） */
  moveAmp?: number
  movePeriod?: number
  movePhase?: number
}

/** 场地事件（hazard）：周期性发生的环境危险 */
export type HazardKind =
  | 'flame' // 地面喷火
  | 'gear' // 齿轮辊
  | 'wind' // 上升气流（不造成伤害）
  | 'lava' // 熔岩
  | 'rock' // 落石

export interface HazardDef {
  kind: HazardKind
  /** 触发周期（帧） */
  period: number
  /** 首次触发的相位偏移（帧），让多个 hazard 错开 */
  phase: number
  /** 持续时间（帧），flame/lava 用 */
  duration: number
  damage: number
  angle: number
  baseKB: number
  x: number
  y: number
  w: number
  h: number
  label: string
}

export interface StageDef {
  id: string
  displayName: string
  version: number
  blurb: string
  /** 危险等级 1-3 */
  danger: number
  platforms: Platform[]
  blastZone: { x: number; y: number; w: number; h: number }
  spawnPoints: { x: number; y: number }[]
  hazards: HazardDef[]
  bgTop: string
  bgBottom: string
  accent: string
}
