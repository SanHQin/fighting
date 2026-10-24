## 1. 文档地图

架构设计不再是一份 1700 行的巨型文档，而是拆成**一份总纲 + 八份专题**。总纲只保留跨领域的东西（定位、选型、仓库、工期、风险、部署、常量），每个专题负责一个领域，各自可以独立更新。

### 1.1 清单

| # | 文档 | 回答什么问题 | 谁该读 | 行数级 |
|---|---|---|---|---|
| 00 | **本文** | 项目定位、技术选型、整体架构、仓库结构、工期与风险 | 所有人 | ~500 |
| 01 | [角色操作与动画设计](./01-characters.md) | 一个角色由什么构成、怎么操控、状态机怎么转、动画怎么和逻辑解耦 | 战斗程序、动画 | ~800 |
| 02 | [战斗地图设计](./02-stage.md) | 平台数据长什么样、单向平台怎么穿、相机怎么跟、场地怎么画 | 战斗程序、关卡 | ~500 |
| 03 | [战斗系统与物理内核](./03-combat-system.md) | `battle-core` 的帧循环、物理公式、击飞、碰撞、快照 | 战斗程序 | ~600 |
| 04 | [页面 UI 与美术设计](./04-ui-art.md) | 美术风格、分辨率、页面流转、HUD、素材规范、占位渲染 | 前端、美术 | ~600 |
| 05 | [服务端与联机设计](./05-server.md) | Node 服务端分层、房间/匹配/信令、回滚联机、确定性红线 | 后端、联机 | ~400 |
| 06 | [用户账号设计](./06-account.md) | 游客、注册登录、双 Token、refresh 旋转、WS 鉴权 | 后端、前端 | ~360 |
| 07 | [数据库设计](./07-database.md) | MySQL 表结构、Prisma Schema、索引、Redis Key | 后端 | ~170 |
| 08 | [后台管理设计](./08-admin.md) | GM 后台的权限、功能模块、回放审计、安全加固 | 后端、运营 | ~500 |

### 1.2 阅读路线

```
新手 / 甲方
  └─ 00 → 04（能看到什么）→ 01 + 02（怎么玩）

战斗程序员
  └─ 00 第 3 章 → 03（内核）→ 01（角色）→ 02（地图）→ 05 第 3 章（确定性）

后端程序员
  └─ 00 第 3 章 → 05（服务端）→ 06（账号）→ 07（数据库）→ 08（后台）

美术 / UI
  └─ 04 → 02 第 9 节（背景）→ 01 第 8 节（动画资源规范）
```

### 1.3 文档之间的硬约定

拆成多份之后，最容易出的问题是**两份文档对同一个数字给了不同的值**。为此定三条规矩：

1. **常量只有一个来源**：所有物理常量、网络参数、超时时间的权威定义在 **_本文件第 12 章附录 A_**，专题文档里引用时写「见总纲附录 A」，不复制数值。
2. **接口定义只有一个来源**：`World` / `FighterState` / `InputFrame` / `SimEvent` 等核心类型定义在 **[03 战斗系统](./03-combat-system.md)** 与 **[01 角色](./01-characters.md)**，其他文档只引用不重定义。
3. **改文档要改版本号**：每份文档头部有独立版本号。改了字段就升版本，避免「代码按新文档写、另一份文档还是旧的」。

### 1.4 与代码的对应关系

| 文档 | 对应代码包 |
|---|---|
| 00 附录 A 常量表 | `packages/shared/src/constants.ts` |
| 01 角色 | `packages/battle-core/src/fighter/*`、`packages/client/src/game/view/*` |
| 02 地图 | `packages/battle-core/src/stage/*`、`packages/client/src/game/view/camera.ts` |
| 03 战斗内核 | `packages/battle-core/src/{sim,snapshot,checksum}.ts`、`physics/*`、`knockback/*` |
| 04 UI 与美术 | `packages/client/src/{pages,components,game/render}/*` |
| 05 服务端与联机 | `packages/server/src/*`、`packages/netcode/src/*` |
| 06 账号 | `packages/server/src/{security,http/routes/auth}/*` |
| 07 数据库 | `packages/server/prisma/schema.prisma` |
| 08 后台 | `packages/admin/src/*`、`packages/server/src/http/routes/admin/*` |

---

