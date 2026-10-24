/**
 * 前端的类型定义。
 *
 * 内容类型（角色 / 场地 / 招式绑定）现在**由战斗内核定义**——
 * 因为它们是数据契约，内核要消费它们，两边各写一份必然漂移。
 * 这里只保留纯界面类型（模式、用户、结算）。
 */

export type {
  AttackDir,
  CharDef,
  HazardDef,
  HazardKind,
  MoveOverride,
  Platform,
  PlatformType,
  SpecialDef,
  SpecialKind,
  StageDef,
  WeightClass,
} from '@fighting/battle-core'


export type MatchMode = 'local' | 'ai' | 'online'

export interface UserProfile {
  /** 后端是 BIGINT UNSIGNED，跨 JSON 一律用字符串，避免 2^53 精度问题 */
  uid: string
  nickname: string
  isGuest: boolean
  rating: number
  ratingDev: number
  wins: number
  losses: number
  /** 头像用色块 + 首字，占位期不做上传 */
  avatarHue: number
}

/** 结算页要的数据 */
export interface RoundResult {
  round: number
  winner: 0 | 1
  /** 每名玩家的剩余命数 */
  stocks: [number, number]
  /** 该局造成的总伤害 */
  damageDealt: [number, number]
  /** 最大连击 */
  bestCombo: [number, number]
  /** 对局时长，帧 */
  frames: number
}

export interface MatchResult {
  matchId: string
  mode: MatchMode
  charIds: [string, string]
  stageId: string
  winner: 0 | 1
  rounds: RoundResult[]
  /** 段位变化，null 表示不计分（本地/人机） */
  ratingDelta: { before: number; after: number } | null
  playedAt: number
}
