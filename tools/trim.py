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

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATS = ('char', 'captain', 'enemy', 'boss')
ALPHA = 12          # 이 값 이하는 배경. 원화 가장자리 안티앨리어싱을 걸러낸다


def bbox(path):
    im = Image.open(path).convert('RGBA')
    a = im.getchannel('A').point(lambda v: 255 if v > ALPHA else 0)
    bb = a.getbbox()
    if not bb:
        return None
    return {'x': bb[0], 'y': bb[1], 'w': bb[2] - bb[0], 'h': bb[3] - bb[1],
            'cw': im.width, 'ch': im.height}


def main():
    out = {}
    for cat in CATS:
        d = os.path.join(ROOT, 'assets', cat)
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

    p = os.path.join(ROOT, 'assets', 'trim.json')
    io.open(p, 'w', encoding='utf-8').write(json.dumps(out, indent=1))

    fills = sorted(((v['h'] / v['ch'], k) for k, v in out.items()))
    print('%d개 기록 → assets/trim.json' % len(out))
    print('가장 작게 보이던 것:')
    for r, k in fills[:5]:
        print('  %-8s 세로비 %.2f' % (k, r))


if __name__ == '__main__':
    main()
