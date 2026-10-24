# -*- coding: utf-8 -*-
"""统一九份文档的版本头，并回填 00-overview 的行数表。"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")

ORDER = [
    "00-overview.md", "01-characters.md", "02-stage.md", "03-combat-system.md",
    "04-ui-art.md", "05-server.md", "06-account.md", "07-database.md", "08-admin.md",
]

counts = {}
for name in ORDER:
    p = os.path.join(DOCS, name)
    t = io.open(p, encoding="utf-8").read()
    counts[name] = t.count("\n") + (0 if t.endswith("\n") else 1)

for name in ORDER:
    p = os.path.join(DOCS, name)
    t = io.open(p, encoding="utf-8").read()
    # 版本行统一
    t2 = re.sub(r"^> 版本 v[\d.]+\s*｜\s*2026-10-23.*$",
                "> 版本 v0.2.2 ｜ 2026-10-23 ｜ 系列：1 总纲 + 8 专题",
                t, count=1, flags=re.M)
    if t2 == t:
        print("  [版本行未命中] %s" % name)
    io.open(p, "w", encoding="utf-8", newline="\n").write(t2)

# 回填行数表
p = os.path.join(DOCS, "00-overview.md")
t = io.open(p, encoding="utf-8").read()
for name, n in counts.items():
    num = name[:2]
    # 表格里该文档那一行的 `| ~123 |` 换成真实数字
    t = re.sub(r"(\|\s*\[[^\]]*\]\(\./%s[^)]*\)[^|]*\|[^|]*\|[^|]*\|)\s*~\d+\s*\|" % re.escape(name),
               lambda m: m.group(1) + " %d |" % n, t)
io.open(p, "w", encoding="utf-8", newline="\n").write(t)

print("行数：")
for name in ORDER:
    print("  %-22s %5d" % (name, counts[name]))
print("  %-22s %5d" % ("合计", sum(counts.values())))
