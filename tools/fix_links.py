# -*- coding: utf-8 -*-
"""修正拆分后文档里的相对链接（子代理写作时用了旧的编号）。"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")

FIX = {
    "01-characters.md": [
        ("./02-combat-system.md", "./03-combat-system.md"),
        ("./05-stage.md", "./02-stage.md"),
    ],
    "03-combat-system.md": [
        ("./03-characters.md", "./01-characters.md"),
    ],
    "08-admin.md": [
        ("./04-battlecore.md", "./05-server.md"),
    ],
}

for name, pairs in FIX.items():
    path = os.path.join(DOCS, name)
    text = io.open(path, encoding="utf-8").read()
    for old, new in pairs:
        n = text.count(old)
        if n == 0:
            print("  [未命中] %s :: %s" % (name, old))
            continue
        text = text.replace(old, new)
        print("  %s :: %s -> %s (%d 处)" % (name, old, new, n))
    io.open(path, "w", encoding="utf-8", newline="\n").write(text)
    print("已修正 %s" % name)
