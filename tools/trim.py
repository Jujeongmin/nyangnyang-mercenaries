# -*- coding: utf-8 -*-
"""원화의 불투명 영역(bbox)을 재서 assets/trim.json 에 적는다.

같은 1024 캔버스라도 여백이 제각각이라 같은 size 로 그려도 보이는 크기가 다르다.
실측: B-03/B-04 는 세로를 꽉 채우는데(1.00) B-06 은 0.84, E-04 는 0.52 다.
즉 B-06 은 같은 설정으로도 16% 작게, E-04 는 절반 크기로 보인다.

캔버스가 아니라 **내용** 기준으로 크기를 맞추려면 이 값이 필요하다.
발밑도 캔버스 바닥이 아니라 내용 바닥이어야 지면에 붙는다.

    python tools/trim.py
"""
import io
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 에셋 실물은 Vite 이전(42a129f) 후 game/public/ 아래다. 저장소 루트의
# assets/ 는 더 이상 없다 — vite.config.js > publicDir 참조.
ASSETS = os.path.join('game', 'public', 'assets')

CATS = ('char', 'captain', 'enemy', 'boss')
ALPHA = 12          # 이 값 이하는 배경. 원화 가장자리 안티앨리어싱을 걸러낸다


BODY_RATIO = 0.30   # 최대 행/열 두께의 30% 이상이면 몸통 (autocut.py 와 같은 기준)


def bbox(path):
    im = Image.open(path).convert('RGBA')
    m = np.array(im.getchannel('A')) > ALPHA
    ys, xs = np.where(m)
    if not len(ys):
        return None
    out = {'x': int(xs.min()), 'y': int(ys.min()),
           'w': int(xs.max() - xs.min() + 1), 'h': int(ys.max() - ys.min() + 1),
           'cw': im.width, 'ch': im.height}

    # 몸통 bbox — 귀·활·지팡이처럼 얇게 뻗은 것을 뺀 몸 중심부.
    # 전체 bbox 로 크기를 맞추면 부속물이 큰 캐릭터일수록 몸이 작아진다
    # (R-03 은 귀 때문에 몸이 R-04 의 2/3 로 그려졌다). 렌더 스케일은 이걸 쓴다.
    rows = m.sum(axis=1)
    cols = m.sum(axis=0)
    ry = np.where(rows >= rows.max() * BODY_RATIO)[0]
    rx = np.where(cols >= cols.max() * BODY_RATIO)[0]
    out['body'] = {'x': int(rx.min()), 'y': int(ry.min()),
                   'w': int(rx.max() - rx.min() + 1), 'h': int(ry.max() - ry.min() + 1)}
    out['area'] = int(m.sum())
    return out


def main():
    out = {}
    for cat in CATS:
        d = os.path.join(ROOT, ASSETS, cat)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith('.png'):
                continue
            i = f[:-4]
            if 'face' in i or i.endswith('-v2'):
                continue
            b = bbox(os.path.join(d, f))
            if b:
                out[i] = b

    # eh(등가 높이) — 아군만. 세로 bbox 로 크기를 맞추면 귀·활이 길수록 몸이
    # 작아진다 (R-03 화면 면적이 N-06 의 44% 였다). 시각 질량 = 불투명 면적이므로
    # sqrt(area) 를 높이 단위로 환산해 rig 가 이걸로 스케일한다.
    # 기준은 char 중앙값 — 중앙값 캐릭터는 eh ≈ h 라 기존 크기가 유지된다.
    # enemy/boss 는 안 넣는다: 보스 1.85 배 같은 크기 감각을 흔들지 않는다.
    chars = [v for k, v in out.items() if not k.startswith(('E-', 'B-'))]
    med_h = sorted(v['h'] for v in chars)[len(chars) // 2]
    med_sq = sorted(v['area'] ** .5 for v in chars)[len(chars) // 2]
    k_eh = med_h / med_sq
    for key, v in out.items():
        if not key.startswith(('E-', 'B-')):
            v['eh'] = round((v['area'] ** .5) * k_eh)

    p = os.path.join(ROOT, ASSETS, 'trim.json')
    io.open(p, 'w', encoding='utf-8').write(json.dumps(out, indent=1))

    fills = sorted(((v['body']['h'], k) for k, v in out.items()))
    print('%d개 기록 → assets/trim.json' % len(out))
    print('몸통 세로 최소/최대:')
    for h, k in fills[:3] + fills[-3:]:
        print('  %-8s body.h %d' % (k, h))


if __name__ == '__main__':
    main()
