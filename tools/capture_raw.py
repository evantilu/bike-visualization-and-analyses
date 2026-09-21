"""Capture raw README screenshots from a locally served copy of the app.

Needs Playwright + Chromium, the app served at URL, and demo GPX files (privacy-trimmed).
usage: python3 tools/capture_raw.py URL OUT_DIR before.gpx after.gpx
Writes <name>.png (device scale 2) and boxes.json (element boxes in CSS px, relative to each shot).
"""
import json, os, sys
from playwright.sync_api import sync_playwright

URL, OUT, GB, GA = sys.argv[1:5]
PX = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
W = 1200
JS_BOX = """(q) => { const [sel, idx] = q; const els = document.querySelectorAll(sel); const e = els[idx < 0 ? els.length + idx : idx];
  if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.width, r.height]; }"""

def main():
    os.makedirs(OUT, exist_ok=True)
    boxes = {}
    args = [f'--proxy-server={PX}', '--proxy-bypass-list=127.0.0.1;localhost'] if PX else []
    with sync_playwright() as p:
        b = p.chromium.launch(args=args)
        pg = b.new_page(viewport={'width': W, 'height': 1000}, device_scale_factor=2)
        def box(sel, idx=0): return pg.evaluate(JS_BOX, [sel, idx])
        def shot(name, top, bottom, marks, pad=10):
            t, bt = box(*top), box(*bottom)
            y0, y1 = t[1] - pad, bt[1] + bt[3] + pad
            clip = {'x': 0, 'y': y0, 'width': W, 'height': y1 - y0}
            pg.screenshot(path=f'{OUT}/{name}.png', clip=clip, full_page=True)
            rel = {}
            for key, q in marks.items():
                r = box(*q)
                if r: rel[key] = [r[0], r[1] - y0, r[2], r[3]]
            boxes[name] = {'size': [W, y1 - y0], 'marks': rel}
            print('shot', name, W, round(y1 - y0))
        def hover(sel, fx, y):
            loc = pg.locator(sel).first; loc.scroll_into_view_if_needed(); bb = loc.bounding_box()
            loc.hover(position={'x': 50 + (bb['width'] - 64) * fx, 'y': y}); pg.wait_for_timeout(600)
        def load(select):
            pg.goto(URL); pg.wait_for_timeout(700)
            pg.set_input_files('#fileInput', [GB, GA]); pg.wait_for_timeout(1200)
            rows = pg.locator('#list tbody tr')
            for i in select: rows.nth(i).click()
        # ---- picker
        load([0, 1])
        shot('01_picker', ('header.top', 0), ('#picker', 0), {
            'pick': ('#pickBtn', 0), 'drop': ('#drop', 0), 'list': ('#list', 0), 'go': ('#goBtn', 0), 'hint': ('#selHint', 0), 'print': ('header.top', 0)})
        # ---- single ride (row 0 = newest = after)
        load([0]); pg.click('#goBtn'); pg.wait_for_timeout(4500)
        sec = lambda i: ('#report section.rsec', i)
        shot('10_single_summary_map', sec(0), sec(1), {'tiles': ('#report .tiles', 0), 'map': ('#report .map', 0), 'legend1': ('#report section.rsec:nth-of-type(2) .legend', 0), 'legend2': ('#report section.rsec:nth-of-type(2) .legend', 1)})
        hover('#report .chart canvas', 0.43, 200)
        shot('11_single_profile', sec(1), sec(2), {'map': ('#report .map', 0), 'chart': ('#report .chart', 0), 'tip': ('#report .chart .tip', 0)})
        pg.mouse.move(5, 5)
        shot('12_single_segments', sec(3), sec(3), {'bars': ('#report section.rsec:nth-of-type(4) .bars', 0), 'table': ('#report .segtable', 0)})
        shot('13_single_splits_grade', sec(4), sec(5), {'splits': ('#report section.rsec:nth-of-type(5) .bars', 0), 'grade': ('#report section.rsec:nth-of-type(6) .bars', 0)})
        sc = pg.locator('.player input[type=range]').first
        mx = float(sc.get_attribute('max'))
        sc.evaluate(f"(e)=>{{e.value='{mx*0.42:.1f}'; e.dispatchEvent(new Event('input'))}}"); pg.wait_for_timeout(2500)
        shot('14_single_replay', sec(-1), sec(-1), {'ov': ('.player .ovmap', 0), 'board': ('.player .board', 0), 'fc': ('.player .fcmap', 0), 'controls': ('.player .controls', 0), 'pf': ('.player .pf', 0)})
        # ---- comparison
        load([0, 1]); pg.click('#goBtn'); pg.wait_for_timeout(5000)
        pg.locator('#report details summary').click(); pg.wait_for_timeout(300)
        shot('20_cmp_summary', sec(0), sec(0), {'swap': ('#report section.rsec button', 0), 'box': ('#report .box', 0), 'tiles': ('#report .tiles', 0), 'details': ('#report details', 0)})
        shot('21_cmp_align', sec(1), sec(1), {'map': ('#report .map', 0)})
        hover('#report .chart canvas', 0.30, 330)
        shot('22_cmp_chart', sec(2), sec(2), {'chart': ('#report .chart', 0), 'tip': ('#report .chart .tip', 0)})
        pg.mouse.move(5, 5)
        shot('23_cmp_diffmap', sec(3), sec(3), {'map': ('#report section.rsec:nth-of-type(4) .map', 0)})
        shot('24_cmp_segments', sec(4), sec(4), {'bars': ('#report section.rsec:nth-of-type(5) .bars', 0), 'table': ('#report .segtable', 0)})
        shot('25_cmp_grade', sec(5), sec(5), {'bars': ('#report section.rsec:nth-of-type(6) .bars', 0)})
        sc = pg.locator('.player input[type=range]').first
        mx = float(sc.get_attribute('max'))
        sc.evaluate(f"(e)=>{{e.value='{mx*0.47:.1f}'; e.dispatchEvent(new Event('input'))}}"); pg.wait_for_timeout(3000)
        shot('26_cmp_race', sec(6), sec(6), {'ov': ('.player .ovmap', 0), 'board': ('.player .board', 0), 'fc': ('.player .fcmap', 0), 'controls': ('.player .controls', 0), 'pf': ('.player .pf', 0),
            'play': ('.player .controls button', 0), 'scrub': ('.player .scrub', 0), 'speed': ('.player .seg', 0), 'start': ('.player select', 0), 'adj': ('.player label.chk', 0), 'diff': ('.player label.chk', -1)})
        b.close()
    json.dump(boxes, open(f'{OUT}/boxes.json', 'w'), indent=1)

if __name__ == '__main__':
    main()
