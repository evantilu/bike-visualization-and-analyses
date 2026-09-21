"""Make privacy-trimmed copies of GPX files (like Strava privacy zones).

Removes every track point within RADIUS metres of any start/end point of the given rides,
so screenshots can be published without revealing where the rides begin and end.

usage: python3 tools/privacy_trim.py OUT_DIR RADIUS_M file1.gpx [file2.gpx ...]
"""
import math, re, sys, os

def pts(text):
    return [(float(a), float(b)) for a, b in re.findall(r'<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"', text)]

def dist(a, b):
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * k)

def main():
    out, radius, files = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
    texts = {f: open(f, encoding='utf-8').read() for f in files}
    centers = []
    for t in texts.values():
        p = pts(t); centers += [p[0], p[-1]]
    os.makedirs(out, exist_ok=True)
    for f, t in texts.items():
        kept = removed = 0
        def keep(m):
            nonlocal kept, removed
            lat, lon = float(m.group(1)), float(m.group(2))
            if any(dist((lat, lon), c) < radius for c in centers):
                removed += 1; return ''
            kept += 1; return m.group(0)
        t2 = re.sub(r'<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>[\s\S]*?</trkpt>\s*', keep, t)
        dst = os.path.join(out, os.path.basename(f))
        open(dst, 'w', encoding='utf-8').write(t2)
        print(f'{os.path.basename(f)}: kept {kept}, removed {removed}')

if __name__ == '__main__':
    main()
