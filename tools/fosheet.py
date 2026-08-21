# -*- coding: utf-8 -*-
"""제작대 타격 시트(2x2) → 가로 스트립(4x512) 변환 + 모루 정렬.

생성기는 "모루를 픽셀 고정하라"는 지시를 절대 못 지킨다. 시트마다 프레임별로
받침이 수십 px 씩 떠 있거나 좌우로 흔들린다. 받침(아래 34%) bbox 를 재서
1번 프레임 기준으로 **평행이동**만 맞춘다 — 폭 편차가 5% 안이면 스케일은
건드리지 않는다 (독이 104px 라 2% 폭 차이는 0.5px 다).

    python tools/fosheet.py FO-02-SHEET FO-03-SHEET
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, 'assets', 'ui')


def base_box(frame, S):
    a = frame.getchannel('A').point(lambda v: 255 if v > 24 else 0)
    return a.crop((0, int(S * 0.66), S, S)).getbbox()


def convert(name):
    im = Image.open(os.path.join(UI, name + '.png')).convert('RGBA')
    S = im.size[0] // 2
    frames = [im.crop((qx * S, qy * S, (qx + 1) * S, (qy + 1) * S))
              for qx, qy in [(0, 0), (1, 0), (0, 1), (1, 1)]]

    boxes = [base_box(f, S) for f in frames]
    ref = boxes[0]
    rcx, rb = (ref[0] + ref[2]) / 2, ref[3]
    out = []
    for f, b in zip(frames, boxes):
        cx, bt = (b[0] + b[2]) / 2, b[3]
        dx, dy = round(rcx - cx), round(rb - bt)
        if dx or dy:
            c = Image.new('RGBA', (S, S), (0, 0, 0, 0))
            c.alpha_composite(f, (dx, dy))
            f = c
        out.append(f)

    strip = Image.new('RGBA', (512 * 4, 512), (0, 0, 0, 0))
    for i, f in enumerate(out):
        strip.alpha_composite(f.resize((512, 512), Image.LANCZOS), (i * 512, 0))
    dst = name.replace('-SHEET', '-STRIP')
    strip.save(os.path.join(UI, dst + '.png'))

    chk = [base_box(f, S) for f in out]
    print(name, '→', dst, ' 받침', [c and (c[0], c[3]) for c in chk])


if __name__ == '__main__':
    for n in sys.argv[1:] or ['FO-01-SHEET', 'FO-02-SHEET', 'FO-03-SHEET']:
        convert(n)
