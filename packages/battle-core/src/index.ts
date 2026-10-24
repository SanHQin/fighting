/**
 * `@fighting/battle-core` —— 平台格斗的战斗内核
 *
 * 这个包是**纯模拟**：给它一帧输入，它算出下一帧世界。
 * 没有 DOM、没有 Vue、没有 Pixi、没有 `Date.now()`、没有 `Math.random()`。
 *
 * 正因为这样，同一份代码可以同时跑在：
 *   - 浏览器里（本地对局 / 预测帧）
 *   - 回滚时（重演过去的帧）
 *   - Node 里（服务端校验、回放重演、desync 复现）
 *
 * 见 `docs/00-overview.md` §3 的七条铁律。
 */
export * from './types.ts'
export * from './rng.ts'
export * from './sim.ts'
export * from './ai.ts'
export * from './snapshot.ts'
export * from './checksum.ts'
export * from './loader.ts'
