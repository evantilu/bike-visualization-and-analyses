"""Draw lettered call-outs on the raw README screenshots.

usage: python3 tools/annotate.py RAW_DIR OUT_DIR
Coordinates are CSS pixels of the 1200-px-wide capture (raw PNGs are at device scale 2).
Each call-out: target = rect [x, y, w, h] or point (x, y); optional `at` = label position
(left-middle of the label); without `at`, a rect's label sits on its top-left edge.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

S = 2                      # device scale of the raw captures
OUT_W = 1600               # published width (px)
VIOLET = (124, 58, 237)
FONT_B = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'

def font(px): return ImageFont.truetype(FONT_B, px * S, index=2)  # index 2 = TC

SPEC = {
 '01_picker': [
  dict(k='A', rect='drop', label='選擇 GPX 檔案，或直接拖進這個框（可一次多選）', at=(262, 160)),
  dict(k='B', rect='list', label='讀進來的騎乘清單，點一列就能勾選', at=(40, 334)),
  dict(k='C', rect='go', label='勾一趟＝單趟分析，勾兩趟＝比較', at=(600, 340)),
 ],
 '10_single_summary_map': [
  dict(k='A', rect='tiles', label='整趟摘要', at=(1030, 76)),
  dict(k='B', rect=[360, 400, 490, 430], label='路線依速度上色：越深越快', at=(862, 430)),
  dict(k='C', pt=(650, 631), label='圓圈＝公里數', at=(360, 700)),
  dict(k='D', pt=(757, 675), label='方框＝分段編號', at=(870, 640)),
  dict(k='E', pt=(480, 467), label='紅方塊＝停車', at=(160, 520)),
  dict(k='F', rect=[16, 880, 560, 60], label='顏色刻度與圖例', at=(600, 912)),
 ],
 '11_single_profile': [
  dict(k='A', rect='tip', label='滑鼠移到圖上，顯示這一點的數值', at=(90, 890)),
  dict(k='B', pt=(458, 207), label='地圖同步標出同一個位置', at=(560, 150)),
  dict(k='C', rect=[44, 795, 1136, 20], label='分段編號（對應分段表）', at=(880, 772)),
  dict(k='D', rect=[829, 808, 32, 322], label='灰底＝GPS 飄移，這段速度不可信', at=(880, 1080)),
 ],
 '12_single_segments': [
  dict(k='A', rect='bars', label='每段平均速度；顏色＝坡度類型（橘上坡、綠下坡、灰平路）'),
  dict(k='B', rect='table', label='每段的範圍、坡度、用時、均速、爬升率'),
 ],
 '13_single_splits_grade': [
  dict(k='A', rect='splits', label='每公里用時（上方數字）與均速（長條高度）'),
  dict(k='B', rect='grade', label='不同坡度下的平均速度＝你在這條路的速度指紋'),
 ],
 '14_single_replay': [
  dict(k='A', rect='ov', label='全覽地圖：點＝目前位置，後面拖著軌跡', at=(40, 612)),
  
  dict(k='B', rect='board', label='移動時間、距離、分段、速度', at=(760, 72)),
  dict(k='C', rect='fc', label='跟隨鏡頭'),
  dict(k='D', rect='controls', label='播放／暫停、時間軸、播放速度、路線上色'),
  dict(k='E', rect='pf', label='海拔剖面：點一下就跳到那個位置'),
 ],
 '20_cmp_summary': [
  dict(k='A', rect='box', label='結論：可比路段誰快、快幾秒', at=(930, 92)),
  dict(k='B', rect='tiles', label='兩趟資料與時間差', at=(420, 183)),
  dict(k='C', rect='details', label='點開看自動剔除了哪些路段、為什麼', at=(640, 300)),
  dict(k='D', rect='swap', label='對調藍紅', at=(880, 31)),
 ],
 '21_cmp_align': [
  dict(k='A', rect=[430, 128, 312, 250], label='灰底粗線＝兩趟都騎過、可以比較的路段', at=(770, 150)),
  dict(k='B', rect=[716, 362, 50, 124], label='只有紅那趟騎的支線 → 自動剔除', at=(800, 430)),
 ],
 '22_cmp_chart': [
  dict(k='A', rect='tip', label='滑鼠移入：同一位置兩趟的數值', at=(640, 196)),
  dict(k='B', rect=[607, 128, 16, 548], label='灰底＝不比較的路段', at=(640, 262)),
  dict(k='C', pt=(519, 583), label='停車造成的跳升', at=(250, 620)),
  dict(k='D', pt=(900, 638), label='虛線＝扣除停車影響', at=(930, 690)),
 ],
 '23_cmp_diffmap': [
  dict(k='A', rect=[360, 180, 490, 420], label='顏色＝同一點的速度差：藍＝藍那趟快、紅＝紅那趟快', at=(360, 158)),
  dict(k='B', rect=[466, 206, 66, 26], label='分段編號與該段時間差', at=(650, 200)),
  dict(k='C', pt=(477, 241), label='方塊＝停車位置', at=(170, 280)),
 ],
 '24_cmp_segments': [
  dict(k='A', rect='bars', label='每段兩趟的均速；上方＝藍比紅快（−）或慢（+）幾秒'),
  dict(k='B', rect='table', label='差＝這一段的時間差，累計＝從起點加總'),
 ],
 '25_cmp_grade': [
  dict(k='A', rect='bars', label='各種坡度下兩趟的均速；上方＝藍比紅快多少 km/h'),
 ],
 '26_cmp_race': [
  dict(k='A', rect='ov', label='兩個點在同一條路線上同時出發', at=(40, 612)),
  dict(k='B', rect='board', label='誰領先、差幾秒、相距幾公尺', at=(700, 72)),
  dict(k='C', rect='fc', label='跟隨鏡頭：兩點之間用領先者的顏色標出'),
  dict(k='D', rect='scrub', label='播放與拖曳時間軸', at=(210, 772)),
  dict(k='E', rect='speed', label='播放速度', at=(540, 772)),
  dict(k='F', rect='start', label='起算點：從任一分段開始比', at=(700, 772)),
  dict(k='G', rect='adj', label='扣除停車影響', at=(1000, 740)),
  dict(k='H', rect='pf', label='上：兩人在海拔上的位置　下：累計時間差，點一下跳轉'),
 ],
}

def draw_label(d, x, y, k, text):
    f, fk = font(15), font(14)
    h = 30 * S
    tw = d.textlength(text, font=f)
    w = h + 8 * S + tw + 12 * S
    x0, y0 = x * S, y * S - h / 2
    d.rounded_rectangle([x0 - 2 * S, y0 - 2 * S, x0 + w + 2 * S, y0 + h + 2 * S], radius=h / 2 + 2 * S, fill=(255, 255, 255, 255))
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=h / 2, fill=VIOLET + (255,))
    r = h / 2 - 4 * S
    cx, cy = x0 + h / 2, y0 + h / 2
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    d.text((cx, cy), k, font=fk, fill=VIOLET + (255,), anchor='mm')
    d.text((x0 + h + 6 * S, cy), text, font=f, fill=(255, 255, 255, 255), anchor='lm')
    return (x0, y0, x0 + w, y0 + h)

def nearest_on_rect(px, py, r):
    x0, y0, x1, y1 = r
    return min(max(px, x0), x1), min(max(py, y0), y1)

def annotate(raw, spec, marks):
    im = Image.open(raw).convert('RGBA')
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for c in spec:
        tgt = None
        if 'rect' in c:
            r = marks[c['rect']] if isinstance(c['rect'], str) else c['rect']
            x, y, w, h = [v * S for v in r]
            box = (x - 4 * S, y - 4 * S, x + w + 4 * S, y + h + 4 * S)
            d.rounded_rectangle(box, radius=10 * S, outline=(255, 255, 255, 230), width=6 * S)
            d.rounded_rectangle(box, radius=10 * S, outline=VIOLET + (255,), width=3 * S)
            tgt = ('rect', box)
            at = c.get('at') or (r[0] + 10, r[1] - 4)
        else:
            px_, py_ = c['pt'][0] * S, c['pt'][1] * S
            rr = 15 * S
            d.ellipse([px_ - rr, py_ - rr, px_ + rr, py_ + rr], outline=(255, 255, 255, 230), width=6 * S)
            d.ellipse([px_ - rr, py_ - rr, px_ + rr, py_ + rr], outline=VIOLET + (255,), width=3 * S)
            tgt = ('pt', (px_, py_, rr))
            at = c['at']
        # leader line (only when the label was moved away from the target)
        if c.get('at'):
            lb = draw_label(ImageDraw.Draw(Image.new('RGBA', (1, 1))), at[0], at[1], c['k'], c['label'])  # measure
            lx, ly = (lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2
            inside = tgt[0] == 'rect' and tgt[1][0] < lx < tgt[1][2] and tgt[1][1] < ly < tgt[1][3]
            if inside:
                tx, ty = lx, ly
            elif tgt[0] == 'rect':
                tx, ty = nearest_on_rect(lx, ly, tgt[1])
            else:
                cx, cy, rr = tgt[1]; import math
                a = math.atan2(ly - cy, lx - cx); tx, ty = cx + rr * math.cos(a), cy + rr * math.sin(a)
            sx, sy = nearest_on_rect(tx, ty, lb)
            if abs(sx - tx) + abs(sy - ty) > 6 * S:
                d.line([sx, sy, tx, ty], fill=(255, 255, 255, 230), width=6 * S)
                d.line([sx, sy, tx, ty], fill=VIOLET + (255,), width=3 * S)
        draw_label(d, at[0], at[1], c['k'], c['label'])
    out = Image.alpha_composite(im, ov).convert('RGB')
    return out.resize((OUT_W, round(out.size[1] * OUT_W / out.size[0])), Image.LANCZOS)

def main():
    raw, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    boxes = json.load(open(os.path.join(raw, 'boxes.json')))
    for name, spec in SPEC.items():
        img = annotate(os.path.join(raw, name + '.png'), spec, boxes[name]['marks'])
        mapish = any(k in name for k in ('map', 'align', 'race', 'replay', 'profile'))
        dst = os.path.join(out, name + ('.jpg' if mapish else '.png'))
        if mapish: img.save(dst, quality=86, optimize=True, progressive=True)
        else: img.save(dst, optimize=True)
        print(name, img.size, os.path.getsize(dst) // 1024, 'KB')

if __name__ == '__main__':
    main()
