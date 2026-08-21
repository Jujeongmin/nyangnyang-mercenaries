# 닫힌 배경 잔여물 제거 — 2단계.
#
#   python tools/fixbg_flat.py [--dry] [--only SR-06]
#
# tools/fixbg.py(rembg) 가 뚫고 남은 것들이 있다. 캐릭터에 딱 붙은 영역은
# u2net 이 전경으로 판단하기 때문이다 (활대 안쪽, 후광 안쪽 등).
#
# 이 단계는 rembg 를 안 쓴다. 대신 두 가지를 본다:
#   1. 원본(assets_raw)의 테두리에서 배경색을 실측한다
#   2. 그 색과 정확히 같고 **완전히 평평한** 덩어리만 지운다
#
# 캐릭터의 흰 털·흰 갑옷은 음영과 안티에일리어싱이 있어 분산이 0 이 아니다.
# 배경은 단색이라 분산이 0 에 가깝다. 이게 유일하게 믿을 만한 구분점이다.

import argparse
import os
from collections import Counter

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATS = ["char", "enemy", "boss", "captain"]

# 원본 배경은 단색이 아니다 — 254/253/248 이 섞인 압축 노이즈다.
# 그래서 정확 일치가 아니라 중앙값 ± 허용오차로 본다.
TOL = 8          # 배경 중앙값과의 채널별 허용 오차
NEUTRAL = 4      # 채널 간 차이가 이 이하여야 무채색으로 본다 (털은 따뜻해서 걸러진다)
MIN_BLOB = 200   # 이보다 작으면 건드리지 않는다


def bg_color(raw_path):
    """원본 테두리에서 배경색을 실측한다. 노이즈가 있으므로 중앙값을 쓴다."""
    a = np.array(Image.open(raw_path).convert("RGB"))
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]).astype(np.int16)
    med = np.median(edge, axis=0).astype(np.int16)
    # 테두리 대부분이 그 색 근처가 아니면 단색 배경이 아니다 — 건드리지 않는다
    near = (np.abs(edge - med).max(axis=1) <= TOL).mean()
    return med if near > 0.7 else None


def components(mask):
    h, w = mask.shape
    seen = np.zeros((h, w), bool)
    out = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        px = []
        touches_border = False
        while stack:
            y, x = stack.pop()
            px.append((y, x))
            if y in (0, h - 1) or x in (0, w - 1):
                touches_border = True
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        out.append((px, touches_border))
    return out


def fix(cat, uid, dry=False):
    p = os.path.join(ROOT, "assets", cat, uid + ".png")
    raw = os.path.join(ROOT, "assets_raw", cat, uid + ".png")
    if not os.path.exists(raw):
        return 0
    col = bg_color(raw)
    if col is None:
        return 0

    im = Image.open(p).convert("RGBA")
    a = np.array(im)
    rgb = a[..., :3].astype(np.int16)
    alpha = a[..., 3]

    spread = rgb.max(axis=2) - rgb.min(axis=2)
    close = (np.abs(rgb - col).max(axis=2) <= TOL) & (spread <= NEUTRAL) & (alpha > 200)
    if not close.any():
        return 0

    newa = alpha.copy()
    removed = 0
    for px, border in components(close):
        if border or len(px) < MIN_BLOB:
            continue
        ys = np.fromiter((q[0] for q in px), np.int32)
        xs = np.fromiter((q[1] for q in px), np.int32)
        # 덩어리 평균도 무채색이어야 한다 — 크림색 털은 여기서 걸러진다
        mean = rgb[ys, xs].mean(axis=0)
        if mean.max() - mean.min() > NEUTRAL:
            continue
        newa[ys, xs] = 0
        removed += len(px)

    if removed and not dry:
        a[..., 3] = newa
        Image.fromarray(a).save(p)
    return removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--only")
    args = ap.parse_args()

    total = touched = 0
    for cat in CATS:
        d = os.path.join(ROOT, "assets", cat)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".png"):
                continue
            uid = f[:-4]
            if args.only and uid != args.only:
                continue
            n = fix(cat, uid, args.dry)
            total += 1
            if n:
                touched += 1
                print(f"  {cat}/{uid}  {n:,}px 제거")

    print(f"\n검사 {total}개 / 수정 {touched}개" + ("  (dry-run)" if args.dry else ""))


if __name__ == "__main__":
    main()
