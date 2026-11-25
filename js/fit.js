// Decode FIT locally. Keep all timestamped records, including samples without GPS.
import FitParser from './vendor/fit-file-parser.js?v=2.0.3';

const timestamp = (value) => value instanceof Date ? value.getTime() : NaN;
const speed = (value) => Number.isFinite(value) ? value * 3.6 : undefined;

function summary(m) {
  return {
    start: timestamp(m.start_time), end: timestamp(m.timestamp),
    elapsed: m.total_elapsed_time, timer: m.total_timer_time, distance: m.total_distance,
    speed: speed(m.enhanced_avg_speed ?? m.avg_speed),
    maxSpeed: speed(m.enhanced_max_speed ?? m.max_speed), ascent: m.total_ascent,
    power: m.avg_power, hr: m.avg_heart_rate, cad: m.avg_cadence,
  };
}

function timerIntervals(events, session) {
  const intervals = [];
  let start = null;
  for (const e of events) {
    if (e.event !== 'timer') continue;
    const t = timestamp(e.timestamp);
    if (!Number.isFinite(t) || (Number.isFinite(session.start) && t < session.start)
      || (Number.isFinite(session.end) && t > session.end)) continue;
    if (e.event_type === 'start') start ??= t;
    if (['stop', 'stop_all', 'stop_disable', 'stop_disable_all'].includes(e.event_type) && start != null) {
      if (t > start) intervals.push([start, t]);
      start = null;
    }
  }
  if (start != null && session.end > start) intervals.push([start, session.end]);
  const seconds = intervals.reduce((sum, [a, b]) => sum + (b - a) / 1000, 0);
  // Some exporters include only part of the timer history. Use it only when it agrees with the session.
  return seconds > 0 && (!Number.isFinite(session.timer) || Math.abs(seconds - session.timer) <= 2)
    ? intervals : null;
}

export async function parseFIT(bytes) {
  let data;
  try {
    data = await new FitParser({ force: false }).parseAsync(bytes);
  } catch {
    throw new Error('無法解析 FIT 檔，請確認檔案完整並重新匯出');
  }
  const sessions = data.sessions ?? [];
  const cycling = sessions.filter(s => s.sport === 'cycling');
  if (cycling.length > 1) throw new Error('這個 FIT 含多個騎乘活動，請分開匯出');
  if (!cycling.length && (sessions.length > 1 || (sessions[0]?.sport && sessions[0].sport !== 'generic'))) {
    throw new Error('這個 FIT 沒有可分析的騎乘活動');
  }
  const session = summary(cycling[0] ?? sessions[0] ?? {});
  const within = (t) => (!Number.isFinite(session.start) || t >= session.start)
    && (!Number.isFinite(session.end) || t <= session.end);
  const points = [];
  for (const r of data.records ?? []) {
    const t = timestamp(r.timestamp);
    if (!Number.isFinite(t) || !within(t) || (points.length && t <= points.at(-1).t)) continue;
    points.push({
      t, lat: r.position_lat, lon: r.position_long, ele: r.enhanced_altitude ?? r.altitude,
      speed: speed(r.enhanced_speed ?? r.speed), distance: r.distance,
      hr: r.heart_rate, cad: r.cadence, power: r.power, temp: r.temperature,
    });
  }
  if (!points.some(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))) {
    throw new Error('這個 FIT 沒有 GPS 軌跡，無法產生騎乘地圖或對騎');
  }
  const laps = (data.laps ?? []).map(summary)
    .filter(l => Number.isFinite(l.start) && l.end > l.start && within(l.start) && within(l.end))
    .sort((a, b) => a.start - b.start);
  return { format: 'FIT', points, laps, session, timerIntervals: timerIntervals(data.events ?? [], session) };
}
