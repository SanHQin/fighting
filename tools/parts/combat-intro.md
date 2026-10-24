## 1. 战斗系统的边界

这一份文档描述的是 `packages/battle-core` —— **一个纯粹的、确定性的、可以在 Node 里跑的模拟内核**。

它不知道浏览器存在，不知道 Pixi 存在，不知道 Vue 存在。给定「初始世界状态 + 一串输入」，它永远产出同一串世界状态。这条性质是联机回滚、AI 训练、回放重演、单元测试全部成立的前提。

### 1.1 输入输出

```ts
// 唯一的入口
export function step(w: World, inputs: InputFrame[]): void;

// 唯一的出口（渲染层消费）
export interface SimEvent {
  type: 'hit' | 'shield' | 'ko' | 'land' | 'jump' | 'ledge' | 'respawn';
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
| 2 | 世界状态的数据结构 |
| 3 | 帧循环的执行顺序（顺序本身是设计的一部分） |
| 4 | 快照与校验和 |
| 5–11 | 物理：单位、运动、跳跃、击飞、碰撞、抓边、出界复活 |

角色状态结构（`FighterState`）、输入系统、状态机、攻击帧数据见 [角色操作与动画设计](./03-characters.md)。确定性规则（哪些 `Math` 函数禁用）见 [联机与确定性](./01-netcode.md)。

---

