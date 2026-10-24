type MoveOverride = {
  name?: string;
  startup?: number; active?: number; recovery?: number; boxW?: number; boxH?: number;
  fwd?: number; y?: number; boxBack?: boolean; damage?: number; angle?: number;
  kbGrowth?: number; baseKB?: number
}
type AttackDir = 'neutral' | 'forward' | 'back' | 'up' | 'upForward' | 'upBack' | 'down' | 'downForward' | 'downBack'
type CharDef = {
  id: string; numId: number; displayName: string; displayNameEn: string; weightClass: 'light' | 'middle' | 'heavy';
  selectOrder: number; tagline: string; speed: number; power: number; color: string; colorDark: string;
  locked: boolean; moveCount: number; knockdownGate: number; knockdownFrames: number; getupInvincible: number;
  dashSpeedMul?: number; dashFramesMul?: number; airDashes?: number; dashCooldown?: number; dashAttackMul?: number;
  specials: Array<{ kind: 'arrow' | 'bottle' | 'bomb' | 'banana' | 'trap' | 'grab'; name: string; slot?: 0 | 1; dir?: AttackDir;
    cooldown: number; damage: number; angle: number; kbGrowth: number; baseKB: number; speedX: number; speedY: number; gravity: boolean; life: number }>;
  moves?: Partial<Record<AttackDir, MoveOverride>>
}

/** Server fallback used before the character catalog has been seeded. */
export const CHARS: CharDef[] = [
  {
    id: 'li', numId: 3, displayName: '磨刀匠·砺', displayNameEn: 'Li, the Grinder',
    weightClass: 'middle', selectOrder: 30, tagline: '中速横向压制，贴地连段型。',
    speed: 3, power: 4, color: '#7c8fa6', colorDark: '#3d4756', locked: false, moveCount: 23,
    knockdownGate: 115, knockdownFrames: 46, getupInvincible: 18, dashSpeedMul: 1, dashFramesMul: 1,
    airDashes: 1, dashCooldown: 26, dashAttackMul: 1,
    specials: [
      { kind: 'bottle', name: '砸酒瓶', slot: 0, cooldown: 70, damage: 12, angle: 55, kbGrowth: 1, baseKB: 26, speedX: 7.5, speedY: -4.5, gravity: true, life: 200 },
      { kind: 'bottle', name: '高抛酒瓶', slot: 0, dir: 'up', cooldown: 70, damage: 14, angle: 78, kbGrowth: 1.1, baseKB: 30, speedX: 4.2, speedY: -8.6, gravity: true, life: 260 },
      { kind: 'trap', name: '捕兽夹', slot: 1, cooldown: 150, damage: 16, angle: 80, kbGrowth: 1.35, baseKB: 40, speedX: 44, speedY: 0, gravity: true, life: 600 },
      { kind: 'trap', name: '远端捕兽夹', slot: 1, dir: 'down', cooldown: 150, damage: 20, angle: 84, kbGrowth: 1.4, baseKB: 44, speedX: 78, speedY: 0, gravity: true, life: 600 },
    ],
    moves: Object.fromEntries(['neutral', 'forward', 'back', 'up', 'upForward', 'upBack', 'down', 'downForward', 'downBack'].map((dir) => [dir, { name: ({ neutral: '磨刀快斩', forward: '踏步重斩', back: '回身反切', up: '挑灯斩', upForward: '跃步斜斩', upBack: '回身挑斩', down: '扫堂斩', downForward: '贴地突刺', downBack: '退步扫斩' } as Record<string, string>)[dir], damage: dir === 'forward' ? 16 : 11, startup: dir === 'forward' ? 7 : 5, recovery: 13, kbGrowth: 1.05, baseKB: 31 }])) as CharDef['moves'],
  },
  {
    id: 'aoi', numId: 1, displayName: '灯守·葵', displayNameEn: 'Aoi, the Lamplighter',
    weightClass: 'light', selectOrder: 10, tagline: '高速游击，灯芯箭远程牵制，香蕉皮创造追击机会。',
    speed: 5, power: 2, color: '#5f8fd4', colorDark: '#2b4372', locked: false, moveCount: 24,
    knockdownGate: 100, knockdownFrames: 38, getupInvincible: 24, dashSpeedMul: 1.12, dashFramesMul: 1.1,
    airDashes: 2, dashCooldown: 20, dashAttackMul: 0.85,
    specials: [
      { kind: 'arrow', name: '灯芯箭', slot: 0, cooldown: 45, damage: 7, angle: 20, kbGrowth: 0.85, baseKB: 16, speedX: 17, speedY: 0, gravity: false, life: 80 },
      { kind: 'arrow', name: '上弦箭', slot: 0, dir: 'up', cooldown: 45, damage: 8, angle: 45, kbGrowth: 0.9, baseKB: 18, speedX: 12, speedY: -12, gravity: false, life: 70 },
      { kind: 'banana', name: '灯油香蕉皮', slot: 1, cooldown: 110, damage: 5, angle: 0, kbGrowth: 0.8, baseKB: 10, speedX: 5, speedY: -3, gravity: true, life: 480 },
    ],
    moves: Object.fromEntries(['neutral', 'forward', 'back', 'up', 'upForward', 'upBack', 'down', 'downForward', 'downBack'].map((dir) => [dir, { name: ({ neutral: '灯芯点刺', forward: '疾风箭步', back: '燕返踢', up: '挑灯踢', upForward: '跃灯踢', upBack: '回身踢', down: '滑步扫踢', downForward: '俯身突袭', downBack: '撤步反踢' } as Record<string, string>)[dir], damage: dir === 'forward' ? 10 : 8, startup: dir === 'up' ? 3 : 4, recovery: 10, fwd: 34, kbGrowth: 0.92, baseKB: 24 }])) as CharDef['moves'],
  },
  {
    id: 'ken', numId: 2, displayName: '铁皮·肯', displayNameEn: 'Ken, the Tin Man',
    weightClass: 'heavy', selectOrder: 20, tagline: '重装强攻，铁臂投破防，铁砂雷封锁空间。',
    speed: 2, power: 5, color: '#c1703a', colorDark: '#6b3a1a', locked: false, moveCount: 21,
    knockdownGate: 135, knockdownFrames: 58, getupInvincible: 14, dashSpeedMul: 0.9, dashFramesMul: 0.85,
    airDashes: 1, dashCooldown: 32, dashAttackMul: 1.2,
    specials: [
      { kind: 'grab', name: '铁臂投', slot: 0, cooldown: 90, damage: 18, angle: 70, kbGrowth: 1.5, baseKB: 46, speedX: 64, speedY: 0, gravity: false, life: 1 },
      { kind: 'bomb', name: '铁砂雷', slot: 1, cooldown: 120, damage: 20, angle: 60, kbGrowth: 1.4, baseKB: 44, speedX: 6.2, speedY: -5.2, gravity: true, life: 200 },
      { kind: 'bomb', name: '滚地雷', slot: 1, dir: 'down', cooldown: 120, damage: 23, angle: 74, kbGrowth: 1.5, baseKB: 50, speedX: 4, speedY: -1.2, gravity: true, life: 240 },
    ],
    moves: Object.fromEntries(['neutral', 'forward', 'back', 'up', 'upForward', 'upBack', 'down', 'downForward', 'downBack'].map((dir) => [dir, { name: ({ neutral: '铁拳', forward: '重装冲拳', back: '铁肘回击', up: '擎天拳', upForward: '破阵上勾', upBack: '回身铁肘', down: '震地重踏', downForward: '铁掌突进', downBack: '撤步横扫' } as Record<string, string>)[dir], damage: dir === 'forward' ? 19 : 14, startup: dir === 'forward' ? 10 : 7, recovery: 18, boxW: 54, boxH: 34, fwd: 28, kbGrowth: 1.2, baseKB: 39 }])) as CharDef['moves'],
  },
]
