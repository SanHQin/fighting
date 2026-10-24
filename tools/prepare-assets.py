# -*- coding: utf-8 -*-
"""把 Gemini 生成的角色原图处理成游戏可用素材。

输入  public/assets/characters/<id>/source/*.jpg   （原始生成图，不动）
输出  public/assets/characters/<id>/reference/     （整幅参考图，给美术/设计看，压低体积）
      public/assets/characters/<id>/portrait/      （去背立绘 + 头像，给 UI 用）
      public/assets/characters/<id>/game/          （游戏尺度的道具图，给战斗用）

为什么不再手写裁切坐标：上一版 8 张里 5 张切到了内容。脚本改成
「先按内容自动找包围盒、再留 4% 边距」，坐标不再需要人工试。

用法：
    python tools/prepare-assets.py li
    python tools/prepare-assets.py li --only portrait
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "packages", "client", "public", "assets", "characters")

# 每张原图的语义。key 是源文件名，值是 (用途, 输出名)。
# 用途决定进入哪个目录、以及怎么缩放。
SOURCES: dict[str, list[tuple[str, str]]] = {
    "li": [
        ("Gemini_Generated_Image_te2krete2krete2k.jpg", "turnaround"),
        ("Gemini_Generated_Image_te2krete2krete2k (1).jpg", "idle"),
        ("Gemini_Generated_Image_te2krete2krete2k (2).jpg", "attack_forward"),
        ("Gemini_Generated_Image_te2krete2krete2k (4).jpg", "special_trap_place"),
        ("Gemini_Generated_Image_te2krete2krete2k (5).jpg", "special_trap_throw"),
        ("Gemini_Generated_Image_te2krete2krete2k (6).jpg", "special_bottle_throw"),
        ("Gemini_Generated_Image_te2krete2krete2k (8).jpg", "prop_bottle"),
    ],
}

# 立绘用哪张：idle 是站姿全身像，最适合选人页。
PORTRAIT_SOURCE = "idle"

BG_TOLERANCE = 30
PAD_RATIO = 0.04


def _flood_bg(im: Image.Image) -> Image.Image:
    """把与画面四边连通的背景抠成透明。

    只抠「从边缘连进去的」像素，所以角色身上的白色高光（被深色轮廓包住）
    不会被误抠。这是纯色背景立绘最稳的做法，不需要 AI 抠图。
    """
    rgb = im.convert("RGB")
    w, h = rgb.size
    work = rgb.copy()
    draw = ImageDraw.Draw(work)
    sentinel = (255, 0, 255)
    for seed in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        try:
            ImageDraw.floodfill(work, seed, sentinel, thresh=BG_TOLERANCE)
        except Exception:
            pass
    arr = np.asarray(work)
    keyed = (arr[:, :, 0] == 255) & (arr[:, :, 1] == 0) & (arr[:, :, 2] == 255)
    alpha = np.where(keyed, 0, 255).astype(np.uint8)
    out = im.convert("RGBA")
    out.putalpha(Image.fromarray(alpha))
    return out


def _content_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    """按 alpha 找内容包围盒；全透明时退回整幅。"""
    alpha = np.asarray(im.getchannel("A"))
    ys, xs = np.where(alpha > 12)
    if len(xs) == 0:
        return (0, 0, im.width, im.height)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def _trim(im: Image.Image, pad: float = PAD_RATIO) -> Image.Image:
    x0, y0, x1, y1 = _content_bbox(im)
    px = int((x1 - x0) * pad)
    py = int((y1 - y0) * pad)
    box = (max(0, x0 - px), max(0, y0 - py), min(im.width, x1 + px), min(im.height, y1 + py))
    return im.crop(box)


def _fit(im: Image.Image, max_w: int, max_h: int) -> Image.Image:
    """等比缩到框内，不放大。"""
    scale = min(max_w / im.width, max_h / im.height, 1.0)
    if scale >= 1.0:
        return im
    return im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)


def _save(im: Image.Image, path: str, quality: int = 88) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "WEBP", quality=quality, method=6)
    return os.path.getsize(path)


def build(char_id: str, only: str | None) -> None:
    base = os.path.join(ASSETS, char_id)
    src_dir = os.path.join(base, "source")
    ref_dir = os.path.join(base, "reference")
    por_dir = os.path.join(base, "portrait")
    game_dir = os.path.join(base, "game")

    table = SOURCES.get(char_id)
    if not table:
        raise SystemExit("没有登记该角色的素材来源：" + char_id)

    portrait_done = False
    for fname, tag in table:
        path = os.path.join(src_dir, fname)
        if not os.path.exists(path):
            print("  跳过（源文件不存在）：%s" % fname)
            continue

        im = Image.open(path).convert("RGBA")
        cut = _flood_bg(im)
        trimmed = _trim(cut)

        # 参考图：保留原构图（不裁），只压体积
        if only in (None, "reference"):
            ref = im.convert("RGB")
            ref = _fit(ref, 1400, 1400)
            n = _save(ref, os.path.join(ref_dir, "%s_%s.webp" % (char_id, tag)), 82)
            print("  reference/%-24s %4dx%-4d %6.1fKB" % (tag, ref.width, ref.height, n / 1024))

        # 道具：游戏尺度，去背
        if tag.startswith("prop_") and only in (None, "game"):
            prop = _fit(trimmed, 192, 192)
            n = _save(prop, os.path.join(game_dir, "%s.webp" % tag), 90)
            print("  game/%-29s %4dx%-4d %6.1fKB" % (tag, prop.width, prop.height, n / 1024))

        # 立绘与头像：只从 idle 出
        if tag == PORTRAIT_SOURCE and only in (None, "portrait") and not portrait_done:
            portrait = _fit(trimmed, 512, 768)
            n = _save(portrait, os.path.join(por_dir, "%s_portrait.webp" % char_id), 90)
            print("  portrait/%-27s %4dx%-4d %6.1fKB" % ("portrait", portrait.width, portrait.height, n / 1024))

            # 头像取上部（头部区域），居中裁正方形
            head_h = int(portrait.height * 0.42)
            head = portrait.crop((0, 0, portrait.width, head_h))
            side = min(head.width, head.height)
            left = (head.width - side) // 2
            head = head.crop((left, 0, left + side, min(head.height, side)))
            icon = _fit(head, 128, 128)
            n = _save(icon, os.path.join(por_dir, "%s_icon.webp" % char_id), 90)
            print("  portrait/%-27s %4dx%-4d %6.1fKB" % ("icon", icon.width, icon.height, n / 1024))
            portrait_done = True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("char", nargs="*", default=list(SOURCES))
    ap.add_argument("--only", choices=["reference", "portrait", "game"], default=None)
    args = ap.parse_args()
    for cid in args.char:
        print("== " + cid)
        build(cid, args.only)


if __name__ == "__main__":
    main()
