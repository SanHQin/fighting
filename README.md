# 残灯台 · 平台格斗

浏览器平台格斗游戏（大乱斗式）。前端 Vue 3 + Vite + TypeScript，后端 Node.js + Fastify + Prisma + MySQL，另有独立的 GM 后台（Vue 3，独立部署）。

**当前阶段**：前端界面 + 单机战斗原型（数据仍在 `packages/client/src/mock/data.ts`），
账号系统与 GM 后台已经跑通并接上 MySQL —— 但**战斗还没接联机**，所以后台的对局列表现在是空的。

## 快速开始

```powershell
# 首次
pnpm install
pnpm db:generate

# ① 后端（127.0.0.1:3001）
pnpm dev:server

# ② 游戏前端（127.0.0.1:5173）
pnpm dev
#   沙箱/受限环境用这个，见下方说明
cd packages\client; node ..\..\tools\dev.cjs --port 5173 --host 127.0.0.1

# ③ GM 后台（127.0.0.1:5174）
pnpm dev:admin
```

浏览器打开 <http://127.0.0.1:5173/> 玩游戏，<http://127.0.0.1:5174/> 进后台。

**后台测试账号**：`rootadmin` / `root@fighting.local` / `admin12345`（uid 8，角色=管理员）。

> **第一个管理员只能从命令行给** —— 这是权限系统的鸡生蛋问题，必须留一个只需要服务器权限的入口：
> ```powershell
> pnpm admin:grant 8 2     # uid 8 升为管理员（0 玩家 / 1 审核员 / 2 管理员）
> ```

### 数据库

**每个字段都有注释**（73 个列全覆盖）。`tools/make-comments.py` 是唯一来源，它同时把
`COMMENT` 注入 `tools/ddl.sql`、生成幂等的 `tools/migrate-v10-comments.sql`、
并给 `prisma/schema.prisma` 注入 `///` 文档注释（编辑器悬停可见）。已上线的库用
`tools/migrate-v10-comments.sql` 补齐即可，只 `MODIFY COLUMN`，不动数据。


MySQL 8，库名 `fighting`，账号 `fighting` / `fighting_dev_2026`（见 `packages/server/.env`）。

```powershell
# 建库建号（只需一次）
Get-Content tools\init-db.sql -Raw -Encoding utf8 | & mysql -u root -h 127.0.0.1
# 建表（只需一次；schema.prisma 改动后要同步改这里）
Get-Content tools\ddl.sql -Raw -Encoding utf8 | & mysql -u root -h 127.0.0.1 --default-character-set=utf8mb4 fighting
# v0.8 后台增量（users.role + admin_audit_logs，幂等）
Get-Content tools\migrate-v08-admin.sql -Raw -Encoding utf8 | & mysql -u root -h 127.0.0.1 --default-character-set=utf8mb4 fighting
# 初始化/更新角色设定（幂等 upsert；需先配置 packages/server/.env 并完成上方建表）
pnpm db:generate
pnpm db:seed:characters
```

角色设定保存在 `character_definitions.definition` JSON 中，包含角色基础属性、九方向普通招式和专属技能。前端启动时读取 `/api/characters`；数据库未初始化或不可用时，服务端会回退到内置目录。

> **为什么不 `prisma migrate dev`**：它要 spawn `schema-engine-windows.exe`，
> 而受限沙箱禁止 Node 以管道 stdio 拉起子进程（`spawn EPERM`）。
> `tools/ddl.sql` 是手写的等价 DDL，改 `schema.prisma` 时必须同步改它。
> 不受限的机器上直接用 `pnpm db:migrate` 即可。

> **为什么要 `tools/dev.cjs`**：Vite 8 启动时会 `exec("net use")` 探测网络盘映射。
> 在禁止子进程管道 stdio 的沙箱里这会抛 `spawn EPERM`，导致配置加载失败。
> `dev.cjs` 在 `require` 后把 `child_process.exec/execFile` 换成空实现再加载 Vite。
> 普通本机环境不需要它，`pnpm dev` 即可。

## 界面结构

11 个页面，全部锁在 **1280×720 逻辑像素**里整体缩放（`LogicalViewport`），
所以任何窗口比例下排版都不走样，只是黑边位置不同。

```
boot → login → menu → mode → char → stage → battle → result
                    ↘ settings
                    ↘ profile
```

| 层 | 文件 | 职责 |
|---|---|---|
| 背景 | `components/AppBackdrop.vue` | 渐变 + 两团呼吸光晕 + 32px 网格 + 暗角。三档色调：`neutral` / `brand` / `warm` |
| 画布 | `components/LogicalViewport.vue` | 1280×720 逻辑坐标 + 窗口缩放 + 黑边 |
| 标题 | `components/PageHeader.vue` | 五页共用；`compact` 给选人/选场这种密页面 |
| 控件 | `styles/base.css` | `.ui-btn` / `.ui-panel` / `.ui-input` / `.ui-key` / `.ui-stagger` … 全局唯一来源 |
| 转场 | `App.vue` | 进 300ms 淡入+微缩放+2px 模糊，出 200ms 只淡出 |

**动效档位**（`styles/tokens.css`）：100ms 悬停、200ms 面板与 Toast、300ms 页面转场。
战斗内一律用**帧数**不用时长，且全部由 `(state, stateFramePhase)` 纯推导 —— 见 `docs/04-ui-art.md` 第 8.2.1 节。

**焦点**：不用 DOM `:focus`。`composables/useFocusGrid.ts` 做二维网格寻路
（`score = 主轴距离 + 垂直偏移×3`，找不到就停原地，绝不循环），键盘与手柄走同一套。

## 操作

| | 移动 | 跳跃 / 二段跳 | 下蹲（= 防御） | 普通攻击 | 冲刺 | 必杀 1 / 2 |
|---|---|---|---|---|---|---|
| **1P** | `A` `D` | `K`（备用 `Space`） | `S` | `J`（备用 `F`） | `L`（备用左 `Shift`） | `U` / `I` |
| **2P** | `←` `→` | `Numpad1`（备用 `ShiftRight`） | `↓` | `Numpad0` 或 `.` | `Numpad5` | `Numpad2` / `Numpad3` |

**`S` 下蹲就是防御**，不用单独记防御键。**`S` + `K` 从单向平台穿下去**（站实心台上只是普通跳）。

**`L` 是冲刺，支持八方向**：按住方向再按 `L` 就朝那个方向冲（`↑`/`↓`/斜向都行），
不按方向则朝当前朝向冲。地面冲 14 帧、有明显冷却（砺 26 帧 / 葵 20 帧 / 肯 32 帧）。
方向取世界绝对方向——被打到场外右侧时按「左」就是往左飞回来。
冲刺期间不加重力，所以上冲不会被重力吃掉。
**场外复归冲刺**：被打出场外后，**方向 + `L` 飞回来** —— 速度 ×1.9、时长 ×1.4、冷却缩到 30%、
**不消耗空中冲刺次数**（次数留着回场地用），但**场外只有 1 次**：回到战斗场地范围内即补满，
不必等落地。**场外不能拿空冲次数顶替** —— 没有复归次数时按 `L` 什么都不会发生。
这一冲位移约 330px（场内空冲只有 212px），是专门的复归手段；青色速度尾迹与普通冲刺区分，
出界箭头上还会套一圈青色环提示"这一下还能救"。**为什么只给 1 次**：无限次等于谁都掉不下去，
出界淘汰机制会直接失效 —— 复归是容错，不是第二条命。

**空中也能冲**：场内空中冲刺要占次数（葵 2 次 / 砺和肯 1 次，落地重置）。

**抓边**：被打飞出场地时，只要手能碰到台边就**自动抓住**（平台左右两端画着绿色小三角，
那些就是能抓的边）。挂住期间无敌 30 帧、不下坠、跳和二段跳都回满。
挂住时按 **`K`（或 `W`）上爬**，16 帧后回到台面；按 `S` 松手往下掉（30 帧内不能马上重抓）。

**冲刺攻击**：冲刺中按 `J` = 冲刺攻击，用的是另一套更远更大的帧数据
（判定框 44→56、前伸 34→42、伤害 ×1.2），**八方向各不相同**，而且不吃角色的普通招式微调。
每个角色的冲刺攻击系数不同（肯 ×1.2 最重、葵 ×0.85 最快）。

**九个攻击方向**：按 `J` 的同时按方向就是方向招。斜向 = 同时按两个方向。

| 输入 | 招式 | 起手 | 判定 | 收招 | 伤害 | 角度 | 击飞 |
|---|---|---|---|---|---|---|---|
| `J` | 中段平打 | 5 | 4 | 9 | 10% | 45° | ×1.00 |
| `D` + `J` | 前重击 | 9 | 5 | 16 | 15% | 40° | ×1.15 |
| `A` + `J` | 回身击 | 7 | 4 | 13 | 12% | 130° | ×1.05 |
| `W` + `J` | 上挑 | 4 | 5 | 11 | 8% | 85° | ×1.25 |
| `S` + `J` | 下劈 | 7 | 6 | 15 | 13% | -60° | ×1.05 |
| `W`+`D` + `J` | 斜上挑 | 6 | 5 | 13 | 11% | 60° | ×1.15 |
| `W`+`A` + `J` | 斜上回身 | 6 | 4 | 12 | 10% | 120° | ×1.10 |
| `S`+`D` + `J` | 斜下劈 | 8 | 5 | 14 | 13% | 25° | ×1.05 |
| `S`+`A` + `J` | 斜下回身 | 8 | 5 | 14 | 12% | 155° | ×1.05 |

> 上表是**基准值**。每个角色有自己的 `moveOverrides` 微调（葵起招更快伤害更低、
> 肯起招更慢一发更重），所以同一个"上挑"在三个人手里手感不同。

**变形盾**：盾不是一根条，是一个**跟着盾值缩放的圆球**（半径 34 → 20，画在角色身上，
HUD 上那颗球同步变大小）。判定用「攻击框 ∩ 受击框」这块重叠区的四个角去和盾圆比：
**四个角都在盾圆内才挡得住**，有一角漏出去就吃伤害。所以盾值掉到约 44% 以下时，
侧前方来的平击会先漏进去，而正下方的下砸还能挡住——**能用招式方向惩罚对手的破盾进度**。

盾值 50，挡一下掉 `伤害×1.1+2`，满盾时顺带漏进去的伤害按 `伤害×0.5` 再扣一点盾；
收盾 22 帧后每帧回 0.42（约 1.6 秒回满）。盾值归零 → **破盾眩晕 150 帧**，
期间不能蹲也不能防，挨打照样进伤害，解晕时只有 22 点盾（约四成），**容易被接着打死**。

**下蹲的收益与代价**：受击框从 64 高降到 40，能躲过头顶来的上挑；
代价是完全不能移动（移动速度 ×0），蹲着出招会自动起身。

**连击放大**：同一方连续命中每段 +14% 击飞（封顶 ×1.2）；伤害超过 200% 后
每多 100% 再加 45%（封顶 ×1.9）。两者相乘最高 ×2.28——这就是「打到 200% 后
一套连段能直接送出场外」的机制来源。

**击倒**：伤害过了角色自己的门槛（砺 115% / 葵 100% / 肯 135%）且正处于连击里，
再被击中就**击倒**：角色压扁倒地、**半透明快速闪烁、全程无敌**，倒地时长与起身无敌
各角色不同（砺 46/18、葵 38/24、肯 58/14）——倒地越久，爬起来被压的代价越大。

**角色独有必杀**（`L` 和 `U` 各一个，带冷却）：

| 角色 | 必杀 1（`L`） | 必杀 2（`U`） |
|---|---|---|
| 磨刀匠·砺 | 砸酒瓶（抛物线，12%） | 捕兽夹（布在地面，16%，有布防延迟） |
| 灯守·葵 | 灯芯箭（直线飞行，7%） | 灯油香蕉皮（5%，踩到打滑） |
| 铁皮·肯 | 铁臂投（贴身抓取，18%） | 铁砂雷（抛物线炸弹，20% 带爆炸） |
| 未解锁 | — | — |

**四张场地**，各有不同的平台结构与场地事件：

| 场地 | 危险 | 平台构成 | 场地事件 |
|---|---|---|---|
| 残灯台 | 低 | 1500 主台 + 2 侧副台 + 中副台 | 无 |
| 齿轮工坊 | 中 | 1520 主台 + 2 可破坏木板 + 1 横移台 | 2 个旋转齿轮（12%） |
| 灰烬原 | 高 | 1400 主台 + 2 可破坏木板 | 3 个地火喷口（9%）+ 底部熔岩（14%） |
| 天穹回廊 | 中 | 两条可破坏窄桥 + 1 横移台 | 上升气流 + 2 处落石（11%） |

**可破坏平台**打够伤害会碎（两侧木板通常两三次重击），几秒后自动重生。
**移动平台**按三角波横移，站上去会被带着走。

**手感容错**：轻点 `K` 是短跳（38px），按住是全跳（86px）；落地前 6 帧按跳会在落地硬直
一结束就起跳；刚走出平台边缘 3 帧内仍可起跳；收招末尾按攻击会缓冲 **5 帧**；连打中被顿帧
冻住的那几帧**按下的跳与攻击照样记账**（顿帧是为了打击感，不是为了让输入失效）。
空中横向加速 0.42（空中变向跟手），落地硬直按落地速度在 **1–4 帧**之间，命中顿帧 4–9 帧。

**抓边要你主动抓**：被打飞出场地时，人贴到台边走**不会自己粘上去**——必须在**下降中**
（`vy >= -0.5`）且**没按着 `S`** 才会抓住。按着 `S` 是"松手/下穿"的意思，两套语义不能共用
一个键；按住 `S` 还想抓人会让人以为按键失灵。

菜单里 `↑↓←→` 移动焦点、`Enter` / `Space` 确认、`Esc` 返回、`Q` `E` 切页签。
对战中 `Esc` 暂停，`~`（Backquote）开关调试面板。

## 已实现

**11 个页面**：Boot / Login / 主菜单 / 模式选择 / 选角色 / 选场地 / 对战 / 结算 / 设置 / 个人主页 / 404

**战斗**：60Hz 固定步长、移动惯性、短跳/全跳/二段跳/快降、**九个攻击方向**（各自独立帧数据）、
**角色独有必杀**（投射物 / 抛物线炸弹 / 地面陷阱 / 投技）、AABB 命中、击飞公式 +
受击硬直 + 顿帧、**下蹲防御 + 变形盾 + 破盾眩晕**、**连击击飞放大**、**击倒与无敌虚无**、
**可破坏地形 + 重生**、**移动平台**、**四类场地事件**、**蹲跳穿下单向平台**、落地硬直、
出界扣命、3 命制、复活无敌、时间耗尽判定、AI 对手（四档难度，会按高度选招、会蹲防、会放必杀）。

**对战 HUD（大乱斗式）**：计时器在顶部正中（最后 30 秒变红闪烁）、双方面板贴底部两角
（头像 + 名字 + 40px 伤害数字 + 盾球 + 命数圆点）、底部中央两条必杀冷却条、
开局 8 秒操作提示后自动淡出、连击数飘字（`N HIT`）、命中/格挡/破盾/击倒/场地事件特效。

**镜头**：按「边界 = 空白 = 场地 = 空白 = 边界」设计，**场地永远完整可见**。

- 缩放由两条硬约束联立求出，不是手调：`zoom ≤ 场地铺满视口`（否则场地出画）、
  `zoom ≥ 边界铺满视口`（否则视口越出边界露出场外）。两者区间为空时取"边界铺满"。
- 取景框从**场地**开始，再并入两名角色 → 场地不会因为人跑开而被裁掉。
- 空白带宽度自适应：两人都在场内用窄留白（40/34），有人出界用宽留白（96/86）。
- 死区 44×32 → 超出后按距离插值（近 0.09 → 远 0.43），**取景盒低通 0.16** 先抹掉单帧抖动，
  再算缩放：拉远快（0.34）立即执行，推近慢（0.10）且要连续 **26 帧**才动；
  缩放死区 0.03 抑制"呼哧呼哧"的泵动；带 0.18 秒前视。
- 三条止抖措施（对应"稍微移动一下就疯狂缩放"）：① 缩放看的是**平滑后的取景盒**而不是当帧位置；
  ② 留白在 40→96 之间**按 240px 连续插值**，不再二值切换；③ 推近有迟滞 + 单帧总位移限速 210px。
  实测：小起伏 300 帧累计行程 0.0000、大起伏 600 帧缩放反转 0 次。
- 所有平滑按 `1-(1-k)^步数` 计算，**60Hz 与 144Hz 行为一致**（实测差 1.3px）。
- 有人被击出画面时：屏幕边缘出箭头 + 伤害角标，卡在角落时画角标而非单边箭头。
- 命中/出界/击倒带震屏（纯表现层，不进模拟）。

**角色美术**：先用 **SVG 路径**画（`game/charArt.ts`，`Path2D` 直接吃 `d` 字符串，
零图集、零加载、任意缩放不糊）。每个角色有独立配色、头饰（布巾 / 兜帽 / 全盔）与武器
（斩骨刀 / 提灯 / 铁锤）；描边不用 `stroke` 而用「墨色放大层 + 本色层」双层填充，
非等比缩放下也等宽。

**动画**：程序化绘制，全部由 `state` + `stateFramePhase` + `attackDir` 纯推导
（不进模拟状态、不影响校验和）——**四肢按 9 个方向摆动**（含出拳拖影）、
跑动起伏与躯干摆动、跳跃/下落/落地的 squash & stretch、受击抖动、出招前冲包络
（峰值正好在判定帧）、下蹲压缩、击倒压扁侧躺、影子随跳跃高度缩放。

**调试面板**（对战里按 `~`）：视口/画布/DPR、相机坐标与缩放、投射物数量、FPS、
帧耗时与 16.7ms 预算占用、模拟耗时（CPU）/ 渲染耗时（浏览器不暴露真实 GPU 占用，
用绘制耗时作代理）、掉帧数、逻辑帧、JS 堆，以及双方完整参数（坐标、速度、伤害、命数、
盾值、连击、击倒数、硬直、顿帧、无敌、跳跃余量、朝向、当前招式与帧）。

**基础设施**：1280×720 逻辑视口自适应、自维护二维焦点环、设计 token、Pinia store、hash 路由与守卫。

## 校验

```powershell
pnpm type-check      # battle-core / client / admin / server 四端，0 错误
pnpm check:sim       # 物理模拟：NaN 检查、出界扣命、同输入确定性
pnpm check:render    # 11 个页面 SSR 渲染冒烟
pnpm check:combat    # 战斗链路 36 组断言（含落地判定 / 抓边门槛 / 攀爬落点 / 顿帧记账）
pnpm check:netcode   # 快照往返 / 回滚重演 / 校验和边界 / 规则哈希
pnpm check:backdrop  # 四张场地背景：无异常 / 无 NaN / 指令数
pnpm check:camera    # 镜头：场地恒可见 / 不露边界 / 帧率无关 / 抗抖 / 出界指示
pnpm check:feel      # 手感：跳跃缓冲 / 郊狼时间 / 短跳 / 落地硬直 / 顿帧
pnpm check:api       # 账号接口 29 条断言（需要后端在跑）
pnpm check:admin     # 后台接口 22 条断言（需要后端在跑）
pnpm check:docs      # 9 份文档结构体检
pnpm check           # 类型 + 模拟 + 渲染 + 战斗 + 联机前置 + 背景 + 镜头 + 手感 + 文档
pnpm check:all       # 以上 + 接口 + 后台 + 文档
```

## 目录

```
docs/          9 份架构文档（1 总纲 + 8 专题）
tools/         dev.cjs / smoke-sim.mjs / check-render.mjs / check-combat.mjs
               test-api.mjs / test-admin.mjs / check_docs.py
               init-db.sql / ddl.sql / migrate-v08-admin.sql
packages/battle-core/src/      战斗内核（纯逻辑，Node 与浏览器共用）
  sim.ts       World 结构 + step()：物理、命中、投射物、场地事件
  types.ts     CharDef / StageDef / SpecialDef 等数据契约
  snapshot.ts  快照序列化 + 原地回填（回滚的地基）
  checksum.ts  FNV-1a + toFixed(3)：desync 的唯一硬指标
  loader.ts    校验 + 索引 + rulesetHash（联机握手比对）
  rng.ts       种子化 PRNG（xorshift32，状态进快照）
  ai.ts        SimpleAI —— 一个本地 InputSource，与联机输入同构
packages/client/src/
  views/       11 个页面
  game/        keyboard.ts（键盘输入）/ cameraRig.ts（镜头纯函数）
               protoRuntime.ts 已移除 —— 内核在 battle-core
  mock/        写死的数据（4 角色 / 4 场地）
  components/  AppBackdrop / LogicalViewport / PageHeader / MenuItem / HintBar
               CharSilhouette / DebugPanel / WinOverlay
  composables/ useFocusGrid / useViewport
  stores/      session / match / settings
packages/server/src/
  http/routes/ auth.ts / admin.ts / health.ts
  http/middleware/ requireAuth.ts / requireAdmin.ts
  services/    user.ts / session.ts / admin.ts
  security/    argon2.ts / jwt.ts / refreshToken.ts
  ws/          gateway.ts（首条消息鉴权）
  scripts/     set-role.ts（命令行给管理员）
  generated/   Prisma Client（prisma generate 产出，不进库）
packages/admin/src/
  views/       LoginView / Dashboard / Users / UserDetail / Matches / Audit
  api.ts       fetch 封装 + 单飞 refresh；session.ts 刻意不用 Pinia
```

## 下一步

接联机（房间 + 信令 + 回滚重演）：`battle-core` 的快照 / 校验和 / 规则哈希已就位，
`check-netcode` 已覆盖两个必过测试，M8 可以直接在上面写 `packages/netcode`。
之后：把 `mock/data.ts` 换成 API 返回、渲染换 PixiJS、后台补回放审计（重演器直接用 `battle-core`）。
详见 `docs/`。


