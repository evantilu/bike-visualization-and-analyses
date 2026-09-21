// GPX parser (regex based so it runs both in the browser and in Node tests).
// Reads lat/lon/ele/time plus optional heart rate, cadence, power and temperature extensions.

const num = (s) => (s == null ? NaN : parseFloat(s));

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`));
  return m ? m[1] : null;
}

function inner(block, localName) {
  // matches <ele>, <gpxtpx:hr>, <ns3:hr>, <power> ...
  const m = block.match(new RegExp(`<(?:[\\w-]+:)?${localName}\\b[^>]*>([^<]*)</(?:[\\w-]+:)?${localName}>`));
  return m ? m[1].trim() : null;
}

export function parseGPX(text) {
  const nameM = text.match(/<trk\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/);
  const typeM = text.match(/<trk\b[^>]*>[\s\S]*?<type>([\s\S]*?)<\/type>/);
  const metaTime = text.match(/<metadata>[\s\S]*?<time>([^<]+)<\/time>/);
  const points = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/g;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[1] ?? m[3] ?? '';
    const body = m[2] ?? '';
    const lat = num(attr(tag, 'lat')), lon = num(attr(tag, 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const timeS = inner(body, 'time');
    const t = timeS ? Date.parse(timeS) : NaN;
    points.push({
      lat, lon,
      ele: num(inner(body, 'ele')),
      t,
      hr: num(inner(body, 'hr')),
      cad: num(inner(body, 'cad')),
      power: num(inner(body, 'power') ?? inner(body, 'PowerInWatts')),
      temp: num(inner(body, 'atemp') ?? inner(body, 'temp')),
    });
  }
  const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  return {
    name: nameM ? unescape(nameM[1]) : '',
    type: typeM ? typeM[1].trim() : '',
    startTime: metaTime ? Date.parse(metaTime[1]) : (points[0] ? points[0].t : NaN),
    points,
  };
}
