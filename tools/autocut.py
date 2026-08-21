# -*- coding: utf-8 -*-
"""무기 팔 컷아웃 자동 생성.

용병 원화는 전부 **왼손잡이**로 그려진다 — 무기가 이미지 오른쪽에 온다.
몹은 반대(오른손잡이, 무기가 왼쪽)다. 그래서 "몸통이 끝나는 지점" 바깥을
무기 영역으로 잡으면 손으로 다각형을 찍지 않아도 된다.

몸통 판정: 열마다 불투명 픽셀 수를 세면 몸통은 두껍고 무기는 얇다.
최대 두께의 일정 비율을 넘는 마지막 열이 몸통의 끝이다.

회전축은 손목 근처(몸통 끝 안쪽)에 둔다. 단장에서 확인했듯 어깨를 축으로 하면
팔 전체가 돌아 어색하고, 손목이면 무기만 돈다.

    python tools/autocut.py char           # assets/char/*.png 전부
    python tools/autocut.py char SR-01     # 하나만
    python tools/autocut.py char --sheet   # 확인용 시트도 같이
"""
import io
import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALPHA = 40          # 이 값 이하는 배경으로 본다
BODY_RATIO = 0.30   # 최대 열두께의 30% 이상이면 몸통
PAD = 26            # 다각형 여유

# 무기가 어느 쪽인가. 용병·단장은 왼손잡이(오른쪽), 몹·보스는 오른손잡이(왼쪽).
SIDE = {'char': 'right', 'captain': 'right', 'enemy': 'left', 'boss': 'left'}


def col_counts(px, w, h):
    out = [0] * w
    for x in range(w):
        c = 0
        for y in range(0, h, 2):          # 2픽셀 간격이면 충분하고 4배 빠르다
            if px[x, y][3] > ALPHA:
                c += 1
        out[x] = c
    return out


def analyze(path, side):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()
    cc = col_counts(px, w, h)
    mx = max(cc) or 1
    # 굵은 열들을 **연속 구간**으로 묶는다. 활의 세로 팔처럼 두꺼운 무기가 있으면
    # 단순히 "굵은 열의 최댓값"을 쓰면 무기 안쪽이 몸통 끝으로 잡혀 조각만 떨어진다.
    thick = [cc[x] >= mx * BODY_RATIO for x in range(w)]
    runs, st = [], None
    for x in range(w):
        if thick[x] and st is None:
            st = x
        elif not thick[x] and st is not None:
            runs.append((st, x - 1)); st = None
    if st is not None:
        runs.append((st, w - 1))
    if not runs:
        return None

    # 몸통 = 픽셀이 가장 많이 몰린 구간
    body = max(runs, key=lambda r: sum(cc[r[0]:r[1] + 1]))
    if side == 'right':
        edge = body[1]                           # 몸통 오른쪽 끝
        cols = range(edge, w)
    else:
        edge = body[0]
        cols = range(0, edge + 1)

    # 무기 영역의 실제 경계
    xs, ys = [], []
    for x in cols:
        for y in range(0, h, 2):
            if px[x, y][3] > ALPHA:
                xs.append(x)
                ys.append(y)
    if len(xs) < 40:                             # 무기라 할 만한 게 없다
        return None

    # 품질 검사. 무기가 몸통을 가로지르면 몸통 구간이 무기까지 삼켜서
    # 끝자락만 떨어진다. 그런 컷은 회전시키면 파편이 떠다녀 보이므로 버린다.
    total = sum(cc)
    part = sum(cc[min(cols):max(cols) + 1])
    if part < total * 0.045:
        return {'_reject': '무기 영역이 너무 작다 (%.1f%%)' % (part / total * 100)}

    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)

    # 회전축 = 몸통 경계 안쪽. 손목 언저리다.
    pvx = edge - 14 if side == 'right' else edge + 14
    band = [y for y in range(0, h, 2)
            if any(px[cx, y][3] > ALPHA
                   for cx in range(max(0, pvx - 6), min(w, pvx + 7), 3))]
    pvy = (min(band) + max(band)) // 2 if band else (y0 + y1) // 2

    # 무기 끝 = 회전축에서 가장 먼 점
    best, bd = (x1, y0), -1
    for x in cols:
        for y in range(0, h, 2):
            if px[x, y][3] > ALPHA:
                d = (x - pvx) ** 2 + (y - pvy) ** 2
                if d > bd:
                    bd, best = d, (x, y)

    # 다각형은 사각형이면 충분하다. 관절 구멍은 buildParts 의 원이 덮는다.
    if side == 'right':
        poly = [(pvx, max(0, y0 - PAD)), (min(w, x1 + PAD), max(0, y0 - PAD)),
                (min(w, x1 + PAD), min(h, y1 + PAD)), (pvx, min(h, y1 + PAD))]
    else:
        poly = [(max(0, x0 - PAD), max(0, y0 - PAD)), (pvx, max(0, y0 - PAD)),
                (pvx, min(h, y1 + PAD)), (max(0, x0 - PAD), min(h, y1 + PAD))]

    return {
        'size': {'w': w, 'h': h},
        'polygon': [{'x': int(a), 'y': int(b)} for a, b in poly],
        'pivot': {'x': int(pvx), 'y': int(pvy)},
        'mirror': False,
        'tip': {'x': int(best[0]), 'y': int(best[1])},
        'auto': True,
    }


def sheet(path, meta, out):
    """buildParts 를 그대로 재현해 몸통/팔 분리 결과를 눈으로 본다."""
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    r = max(w, h) * 0.055
    pv = meta['pivot']
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.polygon([(p['x'], p['y']) for p in meta['polygon']], fill=255)
    d.ellipse([pv['x'] - r, pv['y'] - r, pv['x'] + r, pv['y'] + r], fill=255)
    arm = Image.new('RGBA', (w, h), (0, 0, 0, 0)); arm.paste(im, (0, 0), mask)
    body = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    body.paste(im, (0, 0), mask.point(lambda v: 255 - v))

    def flat(x, bg):
        b = Image.new('RGBA', x.size, bg)
        return Image.alpha_composite(b, x)

    s = Image.new('RGB', (w * 2, h), (255, 255, 255))
    s.paste(flat(body, (210, 225, 240, 255)).convert('RGB'), (0, 0))
    s.paste(flat(arm, (240, 220, 210, 255)).convert('RGB'), (w, 0))
    s.resize((w // 2, h // 4), Image.LANCZOS).save(out)


def main():
    cat = sys.argv[1] if len(sys.argv) > 1 else 'char'
    args = [a for a in sys.argv[2:] if not a.startswith('--')]
    want_sheet = '--sheet' in sys.argv
    side = SIDE.get(cat, 'right')

    src_dir = os.path.join(ROOT, 'assets', cat)
    out_dir = os.path.join(ROOT, 'assets', 'cutout')
    os.makedirs(out_dir, exist_ok=True)
    sheets = []

    ids = args or sorted(f[:-4] for f in os.listdir(src_dir) if f.endswith('.png'))
    ok = skip = 0
    manual = []
    for i in ids:
        p = os.path.join(src_dir, i + '.png')
        if not os.path.exists(p):
            print('  없음', i); continue
        m = analyze(p, side)
        if not m:
            print('  건너뜀(무기 못 찾음)', i); skip += 1; continue
        if m.get('_reject'):
            print('  수동 필요 %-8s %s' % (i, m['_reject']))
            manual.append(i); skip += 1; continue
        m['id'] = i
        m['cat'] = cat
        rest = math.degrees(math.atan2(m['tip']['y'] - m['pivot']['y'],
                                       m['tip']['x'] - m['pivot']['x']))
        io.open(os.path.join(out_dir, i + '.json'), 'w', encoding='utf-8').write(
            json.dumps(m, ensure_ascii=False, indent=2))
        print('  %-8s pivot(%4d,%4d) tip(%4d,%4d) rest %6.1f°'
              % (i, m['pivot']['x'], m['pivot']['y'], m['tip']['x'], m['tip']['y'], rest))
        ok += 1
        if want_sheet:
            sp = os.path.join(out_dir, '_sheet_%s.png' % i)
            sheet(p, m, sp)
            sheets.append(sp)

    print('\n%s: %d개 생성, %d개 건너뜀' % (cat, ok, skip))
    if sheets:
        print('확인 시트', len(sheets), '장')


if __name__ == '__main__':
    main()
