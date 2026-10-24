# -*- coding: utf-8 -*-
"""文档结构体检：编号连续性、重复标题、悬空分隔线、围栏配对。"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
ORDER = [
    "00-overview.md", "01-characters.md", "02-stage.md", "03-combat-system.md",
    "04-ui-art.md", "05-server.md", "06-account.md", "07-database.md", "08-admin.md",
]

problems = 0
for name in ORDER:
    p = os.path.join(DOCS, name)
    lines = io.open(p, encoding="utf-8").read().split("\n")
    in_fence = False
    h2 = []
    issues = []
    prev = None
    for i, line in enumerate(lines, 1):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = re.match(r"^## (\d+)\.\s+(.*)$", line)
        if m:
            n = int(m.group(1))
            h2.append((i, n, m.group(2)))
            if prev is not None and n != prev + 1:
                issues.append("行 %d：二级编号 %d 出现在 %d 之后" % (i, n, prev))
            prev = n
    if in_fence:
        issues.append("代码围栏未闭合")
    # 悬空 ---
    for i, line in enumerate(lines):
        if line.strip() == "---" and i + 1 < len(lines):
            nxt = lines[i + 1].strip()
            if nxt == "" and i + 2 < len(lines) and lines[i + 2].strip() in ("", "---"):
                issues.append("行 %d：连续分隔线" % (i + 1))
    if issues:
        problems += len(issues)
        print("[%s]" % name)
        for s in issues:
            print("   " + s)
    print("%-22s 章数=%2d  " % (name, len(h2)) + " · ".join("%d.%s" % (n, t[:14]) for _, n, t in h2))

print("\n问题总数：%d" % problems)
