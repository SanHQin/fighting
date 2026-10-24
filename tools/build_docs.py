# -*- coding: utf-8 -*-
"""把 docs/ARCHITECTURE.md 拆分为多份专题文档。

规则：
  - manifest 里每个 section 要么是 range(a,b)，从原文档抽取行区间；
    要么是 file(path)，读入预先写好的正文片段。
  - 每个 section 会被包成一个二级标题 `## {序号}. {标题}`。
  - range 若是整章（首行为 `## N.`），则内部 `### N.x` 重编号为 `### {序号}.x`。
  - range 若是单节（首行为 `### N.x`），则降级为 `## {序号}.`，内部 `####` 升为 `###`。
  - 代码围栏内的行一律不转换。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_CANDIDATES = [
    os.path.join(ROOT, "docs", "archive", "ARCHITECTURE-v0.2.1-full.md"),
    os.path.join(ROOT, "docs", "ARCHITECTURE.md"),
]
OUTDIR = os.path.join(ROOT, "docs")
MANIFEST = os.path.join(ROOT, "tools", "docs_manifest.json")

SRC = next((p for p in SRC_CANDIDATES if os.path.exists(p)), None)
if SRC is None:
    raise SystemExit("找不到源文档，期望以下任一存在:\n  " + "\n  ".join(SRC_CANDIDATES))

src = io.open(SRC, encoding="utf-8").read().split("\n")


def strip_trailing_blank(block):
    while block and block[-1].strip() == "":
        block.pop()
    # 原文档在章末有 `---` 分隔线，切出来会变成悬空的水平线
    while block and block[-1].strip() == "---":
        block.pop()
        while block and block[-1].strip() == "":
            block.pop()
    return block


def render_range(a, b, counter, title, unnumber=False):
    block = src[a - 1:b - 1]
    first = next(i for i, l in enumerate(block) if l.strip())
    whole_chapter = block[first].startswith("## ")
    head = "## %s" % title if unnumber else "## %d. %s" % (counter, title)

    out = []
    in_fence = False
    for i, line in enumerate(block):
        if line.strip().startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue

        if i == first:
            out.append(head)
            continue

        if in_fence:
            out.append(line)
            continue

        m = re.match(r"^### \d+\.(\d+)\s+(.*)$", line)
        if m:
            out.append("### %d.%s %s" % (counter, m.group(1), m.group(2)) if whole_chapter
                       else "### %s" % m.group(2))
            continue

        m = re.match(r"^#### (\d+\.\d+\.\d+)\s+(.*)$", line)
        if m and whole_chapter:
            out.append("#### %s %s" % (m.group(1), m.group(2)))
            continue

        if not whole_chapter and line.startswith("##### "):
            out.append("#### " + line[6:])
            continue
        if not whole_chapter and line.startswith("#### "):
            out.append("### " + line[5:])
            continue

        out.append(line)

    return strip_trailing_blank(out)


def render_file(path, counter, title):
    text = io.open(os.path.join(ROOT, path), encoding="utf-8").read()
    body = strip_trailing_blank(text.split("\n"))
    head = "## %d. %s" % (counter, title)
    first = next((i for i, l in enumerate(body) if l.strip()), None)
    if first is not None and body[first].startswith("## "):
        body[first] = head
        return body
    return [head, ""] + body


def main():
    manifest = json.load(io.open(MANIFEST, encoding="utf-8"))
    written = []

    for doc in manifest["docs"]:
        chunks = []
        counter = 0
        for sec in doc["sections"]:
            counter += 1
            if sec["type"] == "range":
                chunks.append(render_range(sec["a"], sec["b"], counter, sec["title"],
                                           sec.get("unnumber", False)))
            elif sec["type"] == "file":
                chunks.append(render_file(sec["path"], counter, sec["title"]))
            else:
                raise SystemExit("unknown section type: %r" % sec)

        body = []
        for i, chunk in enumerate(chunks):
            body.extend(chunk)
            body.append("")
            if i != len(chunks) - 1:
                body.append("---")
                body.append("")

        header = doc["header"].rstrip("\n").split("\n")
        text = "\n".join(header + [""] + body)
        if doc.get("footer"):
            text += "\n" + doc["footer"].rstrip("\n") + "\n"

        path = os.path.join(OUTDIR, doc["file"])
        io.open(path, "w", encoding="utf-8", newline="\n").write(text)

        fences = text.count("```")
        warn = "" if fences % 2 == 0 else "  <== 代码围栏未闭合!"
        written.append("  %-26s %5d 行 %7d 字节%s"
                       % (doc["file"], text.count("\n") + 1, len(text.encode("utf-8")), warn))

    print("已生成 %d 份文档：" % len(written))
    print("\n".join(written))


if __name__ == "__main__":
    main()
