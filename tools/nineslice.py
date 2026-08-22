# -*- coding: utf-8 -*-
"""UI 킷을 9-slice 로 쓸 수 있게 다듬는다.

생성기가 전부 1024x1024 정사각으로 뽑아 놓았다. 그대로 `border-image` 에 물리면
두 가지가 깨진다.

1. 도형 바깥의 투명 여백이 테두리 폭으로 계산돼 실제보다 두껍게 잘린다.
2. `border-image-slice` 를 눈대중으로 넣으면 모서리 장식이 가운데로 번지거나
   반대로 잘려 나간다.

그래서 여기서 (a) 불투명 영역으로 크롭하고 (b) 가운데 평평한 면이 시작되는 지점을
픽셀로 찾아 slice 값을 계산한다. 결과는 `assets/ui/9s/*.png` 와 `assets/ui/9slice.json`.

    python tools/nineslice.py
"""
import io
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 에셋 실물은 Vite 이전(42a129f) 후 game/public/ 아래다. 저장소 루트의
# assets/ 는 더 이상 없다 — vite.config.js > publicDir 참조.
ASSETS = os.path.join('game', 'public', 'assets')

SRC = os.path.join(ROOT, ASSETS, 'ui')
OUT = os.path.join(SRC, '9s')
ALPHA = 24

# 9-slice 로 늘려 쓰는 것들. 나머지(LOCK/DIV/GEAR/CORNER/NAV-ON)는 통짜로 쓴다.
NINE = ['UI-PANEL', 'UI-CARD', 'UI-HEADER', 'UI-BTN', 'UI-BTN-GO', 'UI-BTN-OFF',
        'UI-NAV', 'UI-SLOT', 'UI-GAUGE', 'UI-GAUGE-FILL', 'UI-PILL', 'UI-TOAST',
        'UI-STAGE', 'UI-BOSSBTN']
FLAT = ['UI-NAV-ON', 'UI-LOCK', 'UI-DIV', 'UI-GEAR', 'UI-CORNER']

# 가운데를 얼마나 남길지의 하한. 이보다 얇게 자르면 늘렸을 때 장식이 반복돼 보인다.
MIN_CENTER = 0.18


def opaque_box(im):
    a = im.getchannel('A').point(lambda v: 255 if v > ALPHA else 0)
    return a.getbbox()


def corner_arc(im):
    """모서리 둥근 정도를 잰다. 9-slice 가 반드시 보존해야 하는 값이다.

    색 변화로 테두리 두께를 재려 했더니 안 됐다 — 테두리가 부드러운 그라디언트라
    "평평해지는 지점"이 바로 앞에서 걸려 slice 가 1~2px 로 나왔다. 대신 실루엣을 본다.
    각 행의 첫 불투명 x 를 모으면 모서리 구간에서만 값이 줄어들고, 직선 변에 들어서면
    멈춘다. 그 멈추는 지점이 곧 모서리 반지름이다.
    """
    w, h = im.size
    a = im.getchannel('A').point(lambda v: 255 if v > ALPHA else 0).load()

    def first_x(y):
        for x in range(w):
            if a[x, y]:
                return x
        return w

    def first_y(x):
        for y in range(h):
            if a[x, y]:
                return y
        return h

    base = min(first_x(y) for y in range(h // 3, h - h // 3))   # 직선 변의 x
    ry = 0
    for y in range(h // 2):
        if first_x(y) <= base + 1:
            ry = y
            break
    else:
        ry = h // 2
    base2 = min(first_y(x) for x in range(w // 3, w - w // 3))
    rx = 0
    for x in range(w // 2):
        if first_y(x) <= base2 + 1:
            rx = x
            break
    else:
        rx = w // 2
    return max(rx, ry)


def slice_of(im):
    w, h = im.size
    # 모서리 반지름 + 테두리 두께 여유. 반지름만큼만 자르면 림이 딱 걸쳐서
    # 늘렸을 때 테두리가 한 픽셀씩 흘러내린 것처럼 보인다.
    r = int(corner_arc(im) * 1.35) + 4
    cap_x = int(w * (1 - MIN_CENTER) / 2)
    cap_y = int(h * (1 - MIN_CENTER) / 2)
    s = [min(r, cap_y), min(r, cap_x), min(r, cap_y), min(r, cap_x)]
    return s


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for name in NINE + FLAT:
        p = os.path.join(SRC, name + '.png')
        if not os.path.exists(p):
            print('  없음', name)
            continue
        im = Image.open(p).convert('RGBA')
        box = opaque_box(im)
        if not box:
            print('  비어 있음', name)
            continue
        im = im.crop(box)
        im.save(os.path.join(OUT, name + '.png'))
        if name in NINE:
            s = slice_of(im)
            meta[name] = {'size': list(im.size), 'slice': s}
            print('  %-14s %sx%s  slice %s' % (name, im.size[0], im.size[1], s))
        else:
            meta[name] = {'size': list(im.size)}
            print('  %-14s %sx%s  (통짜)' % (name, im.size[0], im.size[1]))

    io.open(os.path.join(SRC, '9slice.json'), 'w', encoding='utf-8').write(
        json.dumps(meta, ensure_ascii=False, indent=2))
    print('\n%d개 → assets/ui/9s/ , assets/ui/9slice.json' % len(meta))


if __name__ == '__main__':
    main()
