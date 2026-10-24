# -*- coding: utf-8 -*-
"""修正拆分后文档里的交叉引用（原文档的「第 N 章 / N.M 节」在新结构里已失效）。"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")

# 每个文件的替换列表：(旧串, 新串)
FIX = {
    "00-overview.md": [
        ("00 第 3 章 → 05（服务端）", "00 第 4 章 → 05（服务端）"),
        ("00 第 3 章 → 03（内核）", "00 第 4 章 → 03（内核）"),
        ("本文件第 12 章附录 A", "本文件附录 A"),
        ("v2 再议，见第 16 章 D3", "v2 再议，见第 11 章 D3"),
        ("- **模拟层帧确定性**（第 10 章）—— 这条约束渗透到每一行模拟代码",
         "- **模拟层帧确定性**（见 [服务端与联机](./05-server.md) 第 3 章）—— 这条约束渗透到每一行模拟代码"),
        ("平台格斗用 `float64` + 禁用三角函数，见 10.2",
         "平台格斗用 `float64` + 禁用三角函数，见 [05 第 3.2 节](./05-server.md)"),
        ("**代价**：无法实时反作弊。缓解方案见 10.6。",
         "**代价**：无法实时反作弊。缓解方案见 [05 第 3.6 节](./05-server.md)。"),
        ("refreshToken.ts}   # 见第 8 章", "refreshToken.ts}   # 见 06 账号"),
        ("转移表 + 开发期断言（5.5 节）", "转移表 + 开发期断言（见 [01 第 5 节](./01-characters.md)）"),
        ("""│  └─ archive/ARCHITECTURE-kof-v0.1.md
│""", """│  ├─ 00-overview.md                     ← 本文档
│  ├─ 01-characters.md                   ← 角色操作与动画
│  ├─ 02-stage.md                        ← 战斗地图
│  ├─ 03-combat-system.md                ← 战斗内核与物理
│  ├─ 04-ui-art.md                       ← 页面 UI 与美术
│  ├─ 05-server.md                       ← 服务端与联机
│  ├─ 06-account.md                      ← 用户账号
│  ├─ 07-database.md                     ← 数据库
│  ├─ 08-admin.md                        ← 后台管理
│  └─ archive/ARCHITECTURE-kof-v0.1.md
│"""),
    ],
    "03-combat-system.md": [
        ("见 [联机与确定性](./01-netcode.md)", "见 [服务端与联机](./05-server.md) 第 3 章"),
    ],
    "05-server.md": [
        ("理由见 [架构设计总纲](./00-overview.md) 第 3.2 节", "理由见 [架构总纲](./00-overview.md) 第 4.2 节"),
        ("理由见 [架构总纲](./00-overview.md) 第 3.2 节", "理由见 [架构总纲](./00-overview.md) 第 4.2 节"),
        ("2 字节/帧 | 见 [角色与操作](./03-characters.md) 第 4 节", "2 字节/帧 | 见 [角色操作与动画设计](./01-characters.md) 第 4 节"),
        ("refresh 旋转（第 8 章）", "refresh 旋转（见 [06 账号](./06-account.md)）"),
    ],
    "06-account.md": [
        ("走 8.7 的**原地升级**", "走 1.7 的**原地升级**"),
        ("refresh 旋转 + 重放检测（8.5）", "refresh 旋转 + 重放检测（1.5）"),
        ("本文件描述从「打开网页」到「打完一局」", "本文件描述从「打开网页」到「打完一局」"),
    ],
    "07-database.md": [
        ("// 大小写敏感，见 8.2", "// 大小写敏感，见 [06 第 1.2 节](./06-account.md)"),
        ("（**collate `utf8mb4_0900_as_cs`**，见 8.2）",
         "（**collate `utf8mb4_0900_as_cs`**，见 [06 第 1.2 节](./06-account.md)）"),
    ],
}

for name, pairs in FIX.items():
    path = os.path.join(DOCS, name)
    text = io.open(path, encoding="utf-8").read()
    for old, new in pairs:
        if old not in text:
            print("  [未命中] %s :: %s" % (name, old[:40]))
            continue
        text = text.replace(old, new)
    io.open(path, "w", encoding="utf-8", newline="\n").write(text)
    print("已修正 %s" % name)
