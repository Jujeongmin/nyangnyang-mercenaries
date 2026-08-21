# 닫힌 배경 영역 제거.
#
#   python tools/fixbg.py [--dry] [--only SR-05]
#
# tools/cutbg.js 는 모서리에서 플러드 필로 배경을 지운다. 그래서 바깥과 이어지지
# 않은 구멍 — 활대와 시위 사이, 후광 링 안쪽 — 은 영원히 흰색으로 남는다.
#
# rembg(u2net) 는 시맨틱 분할이라 닫힌 영역도 배경으로 안다. 하지만 가장자리가
# 물렁해서 그대로 쓰면 캐릭터 외곽에 회색 얼룩이 생긴다.
#
# 그래서 둘을 합친다:
#   · 알파는 기존(cutbg) 것을 그대로 쓴다 — 날카로운 외곽선 유지
#   · rembg 가 배경이라고 했고 + 그 픽셀이 밝은 무채색이면 → 거기만 뚫는다
#
# 즉 rembg 는 "어디를 뚫을지" 만 알려주고, 실제 경계는 기존 알파가 정한다.

import argparse
import os
import sys

import numpy as np
import rembg
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATS = ["char", "enemy", "boss", "captain"]

# 뚫을 후보 조건 — 밝고(LIGHT 이상) 채도가 낮은(SAT 이하) 픽셀만.
# 캐릭터의 흰 옷·크림색 털도 여기 걸리지만, rembg 가 전경이라고 하면 살아남는다.
LIGHT = 195
SAT = 42
REMBG_BG = 40      # rembg 알파가 이 미만이면 배경으로 본다
MIN_BLOB = 60      # 이보다 작은 조각은 노이즈로 보고 건드리지 않는다


def flood_components(mask):
    """4방향 연결 성분. scipy 없이 스택으로 훑는다."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    cur = 0
    out = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or lab[y0, x0]:
                continue
            cur += 1
            stack = [(y0, x0)]
            lab[y0, x0] = cur
            px = []
            while stack:
                y, x = stack.pop()
                px.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur
                        stack.append((ny, nx))
            out.append(px)
    return out


def fix(path, session, dry=False):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    rgb = a[..., :3].astype(np.int16)
    alpha = a[..., 3]

    cut = rembg.remove(im, session=session, alpha_matting=False)
    ra = np.array(cut)[..., 3]

    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    light = (mn >= LIGHT) & ((mx - mn) <= SAT)

    # 지금 불투명 + rembg 는 배경 + 밝은 무채색
    cand = (alpha > 200) & (ra < REMBG_BG) & light
    if not cand.any():
        return 0

    # 잔 노이즈 제거 — 덩어리로만 뚫는다
    removed = 0
    newa = alpha.copy()
    for px in flood_components(cand):
        if len(px) < MIN_BLOB:
            continue
        ys = np.fromiter((p[0] for p in px), np.int32)
        xs = np.fromiter((p[1] for p in px), np.int32)
        newa[ys, xs] = 0
        removed += len(px)

    if removed and not dry:
        a[..., 3] = newa
        Image.fromarray(a).save(path)
    return removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="바꾸지 않고 몇 픽셀인지만 본다")
    ap.add_argument("--only")
    ap.add_argument("--cat", choices=CATS)
    args = ap.parse_args()

    session = rembg.new_session("u2net")
    total = touched = 0

    for cat in ([args.cat] if args.cat else CATS):
        d = os.path.join(ROOT, "assets", cat)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".png"):
                continue
            uid = f[:-4]
            if args.only and uid != args.only:
                continue
            n = fix(os.path.join(d, f), session, args.dry)
            total += 1
            if n:
                touched += 1
                print(f"  {cat}/{uid}  {n:,}px 제거")

    print(f"\n검사 {total}개 / 수정 {touched}개" + ("  (dry-run, 저장 안 함)" if args.dry else ""))


if __name__ == "__main__":
    sys.exit(main())
