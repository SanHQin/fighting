"""把 src/ 下本地相对 import 的 .js 后缀改成 .ts。

原因：Node 22 的 type stripping 直接跑 .ts 时不做路径重写，
import 必须指向真实文件（.ts）；而 tsc 编译时靠
`rewriteRelativeImportExtensions` 再把 .ts 写回 .js。

`src/generated/prisma/**` 是真实 .js，必须跳过。
"""
import re
import sys
from pathlib import Path

ROOT = Path('packages/server/src')
PATTERN = re.compile(r"(from\s+'|\bimport\(')(\.[^']*?)\.js'")

changed = []
for p in sorted(ROOT.rglob('*.ts')):
    if 'generated' in p.parts:
        continue
    text = p.read_text(encoding='utf-8')
    new = PATTERN.sub(lambda m: f"{m.group(1)}{m.group(2)}.ts'", text)
    if new != text:
        p.write_text(new, encoding='utf-8')
        changed.append(str(p))

sys.stdout.reconfigure(encoding='utf-8')
print(f'changed {len(changed)} files')
for c in changed:
    print('  ' + c)
