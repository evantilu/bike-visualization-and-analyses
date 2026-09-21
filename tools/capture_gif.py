"""Record the virtual race as an animated GIF for the README.

usage: python3 tools/capture_gif.py URL OUT.gif before.gpx after.gpx [frames]
Needs Playwright + Chromium and ffmpeg.
"""
import os, sys, subprocess, tempfile
from playwright.sync_api import sync_playwright

URL, OUT, GB, GA = sys.argv[1:5]
N = int(sys.argv[5]) if len(sys.argv) > 5 else 80
PX = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')

def main():
    tmp = tempfile.mkdtemp()
    args = [f'--proxy-server={PX}', '--proxy-bypass-list=127.0.0.1;localhost'] if PX else []
    with sync_playwright() as p:
        b = p.chromium.launch(args=args)
        pg = b.new_page(viewport={'width': 1200, 'height': 900}, device_scale_factor=1)
        pg.goto(URL); pg.wait_for_timeout(700)
        pg.set_input_files('#fileInput', [GB, GA]); pg.wait_for_timeout(1200)
        rows = pg.locator('#list tbody tr'); rows.nth(0).click(); rows.nth(1).click()
        pg.click('#goBtn'); pg.wait_for_timeout(5000)
        player = pg.locator('.player').first
        player.scroll_into_view_if_needed()
        stage = pg.locator('.player .stage').first
        sc = pg.locator('.player input[type=range]').first
        tmax = float(sc.get_attribute('max'))
        pg.locator('.player .ovmap').first.scroll_into_view_if_needed()
        pg.evaluate("window.scrollBy(0, -12)")
        for i in range(N):
            t = tmax * i / (N - 1)
            sc.evaluate(f"(e)=>{{e.value='{t:.1f}'; e.dispatchEvent(new Event('input'))}}")
            pg.wait_for_timeout(700 if i == 0 else 320)
            stage.screenshot(path=f'{tmp}/f{i:03d}.png')
        b.close()
    # hold first and last frames a little longer
    lst = [f'{tmp}/f000.png'] * 6 + [f'{tmp}/f{i:03d}.png' for i in range(N)] + [f'{tmp}/f{N-1:03d}.png'] * 16
    with open(f'{tmp}/list.txt', 'w') as fh:
        for f in lst: fh.write(f"file '{f}'\nduration 0.125\n")
    vf = 'scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', f'{tmp}/list.txt', '-vf', vf, '-loop', '0', OUT], check=True)
    print(OUT, os.path.getsize(OUT) // 1024, 'KB')

if __name__ == '__main__':
    main()
