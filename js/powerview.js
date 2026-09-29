// Power sections of the single-ride and comparison reports.
import { analyzePower, compareClimbs, findClimbs, kinematics, TIERS } from './power.js';
import { loadSettings, settingsFor, riderBikeForm, rideForm, summaryChips, missingLabels } from './settings.js';
import { PanelChart } from './charts.js';
import { interp } from './util.js';
import { tok, el, fmtTime, fmtSigned } from './theme.js';

const TIER = { good: '可信', fair: '參考', none: '不估' };
const pctTxt = (h) => `±${h * 100 < 1 ? (h * 100).toFixed(1) : Math.round(h * 100)}%`;
const WR = (lo, hi) => `${Math.round(lo)}–${Math.round(hi)} W`;
const badge = (tier) => el('span', { class: `tier ${tier}` }, TIER[tier]);
const W = (v) => Math.round(v) + ' W';

function methodNotes() {
  return el('details', { class: 'mnote' }, el('summary', {}, '怎麼算的、有哪些限制'),
    el('ul', {},
      el('li', {}, '沒有功率計時，用 GPS 速度和地圖高度反推：功率 ＝（爬升 ＋ 滾動阻力 ＋ 空氣阻力 ＋ 加減速）÷ 傳動效率。'),
      el('li', {}, '量不到的東西（騎姿的風阻、實際路面的滾阻、風、氣溫、高度誤差、鏈條損耗）用合理範圍各抽幾百次，看結果散開多少：90% 的結果落在範圍內。同一個檔案每次算出來都一樣。'),
      el('li', {}, `範圍在 ±${Math.round(TIERS.good * 100)}% 以內標「可信」，±${Math.round(TIERS.fair * 100)}% 以內標「參考」，更寬的就不給數字。`),
      el('li', {}, '爬坡最準：大部分力氣花在往上爬，只要重量對就算得準。平路和下坡主要是風阻，受騎姿和風影響太大；單方向的平路風抵消不掉，通常不估。'),
      el('li', {}, 'FTP 只在有 15 分鐘以上「可信」的爬坡時才給：20 分鐘功率換算成一小時的係數依程度不同（休閒約 0.88，訓練良好約 0.95），所以 FTP 會是一個範圍。'),
      el('li', {}, '時速 40 公里以上（下坡、衝刺）常會壓低身體，這些地方的風阻範圍會放寬到趴低的姿勢，所以通常不給數字。'),
      el('li', {}, '跟車或團騎時平路的風阻會小很多，這種情況平路不估，只看陡坡。'),
      el('li', {}, '功率是踏板／曲柄端的功率（和大部分功率計量的位置相同），已經把傳動損耗算回去。')));
}

// top hint + bottom action row of a settings form. Results update by themselves; the button just
// folds the form away and jumps to them, and the status line confirms each recalculation.
function formChrome(form, res) {
  const status = el('span', { class: 'fstatus', 'aria-live': 'polite' });
  const btn = el('button', { class: 'btn primary', type: 'button', onclick: () => { form.open = false; res.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, '看估算結果 ↓');
  form.insertBefore(el('p', { class: 'fh fhint' }, '不用按開始：每改一個欄位，下方的結果就會自動重新計算。'), form.children[1] || null);
  form.append(el('div', { class: 'factions' }, status, btn));
  const stamp = () => { const d = new Date(); status.textContent = `已依目前設定更新（${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}）`; };
  return { stamp };
}

// ---------------------------------------------------------------- single ride
export function buildPowerSection(host, ride) {
  const S = loadSettings();
  const sec = el('section', { class: 'rsec', id: 'power' });
  host.append(sec);
  const chips = el('div', { class: 'chips' });
  const form = el('details', { class: 'fbox noprint' }, el('summary', {}, '騎乘設定（只記在這台瀏覽器）'));
  const res = el('div', { class: 'pres' });
  let timer = null;
  let chrome = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { renderResults(); chrome.stamp(); }, 180); };
  form.append(el('div', { class: 'fgrid' }, ...riderBikeForm(S, schedule, { rideForBike: ride }).children, rideForm(S, ride, schedule)));
  chrome = formChrome(form, res);
  sec.append(el('h2', {}, '功率估算'),
    el('p', { class: 'lead' }, '沒有功率計時，用速度、坡度和你的重量反推功率。只有誤差夠小的路段才給數字；設定填得越完整，範圍越窄。'),
    chips, form, res);
  if (!(S.rider.massKit > 0)) form.open = true;

  function renderResults() {
    chips.innerHTML = ''; chips.append(...summaryChips(S, ride).map(c => el('span', { class: 'chip' }, c)));
    res.innerHTML = '';
    const A = analyzePower(ride, settingsFor(S, ride));
    if (!A.ok) { res.append(el('div', { class: 'box' }, '先在上面的「騎乘設定」填入人＋裝備重量，結果就會自動出現在這裡。')); form.open = true; return; }
    const climbs = A.climbs;
    const shown = climbs.filter(c => c.tier !== 'none');
    const bestClimb = shown.slice().sort((a, b) => b.med - a.med)[0];

    // tiles
    const tileP = (k, obj, sub, why) => {
      if (!obj) return ptile(k, '—', '', why || '資料不足', null);
      if (obj.tier === 'none') return ptile(k, '不估', '', why || `範圍 ${WR(obj.lo, obj.hi)} 太寬`, 'none');
      return ptile(k, Math.round(obj.med), 'W', `${WR(obj.lo, obj.hi)}・${(obj.med / A.massKit).toFixed(1)} W/kg${sub ? '・' + sub : ''}`, obj.tier);
    };
    const b20 = A.best[1200];
    const wholeWhy = A.drafting ? '有跟車，平路不估' : A.whole.oneWay > 0.5 ? '大多往同一個方向騎，風抵消不掉' : null;
    const b20Why = !b20 ? '這趟沒有連續 20 分鐘的騎乘' : b20.tier === 'none' ? (b20.oneWay > 0.5 ? '這 20 分鐘大多同一方向，風抵消不掉' : `範圍 ${WR(b20.lo, b20.hi)} 太寬`) : null;
    res.append(el('div', { class: 'tiles' },
      bestClimb ? tileP('坡段最高', bestClimb, `${fmtTime(bestClimb.time)} 的坡`) : ptile('坡段最高', '—', '', climbs.length ? '坡段範圍都太寬' : '這趟沒有夠長的坡', null),
      tileP('全程平均', A.whole, `移動 ${fmtTime(A.whole.time)}`, wholeWhy),
      tileP('最佳 20 分鐘', b20, null, b20Why),
      A.ftp ? ptile('FTP（估）', `${Math.round(A.ftp.lo)}–${Math.round(A.ftp.hi)}`, 'W', `${(A.ftp.lo / A.massKit).toFixed(1)}–${(A.ftp.hi / A.massKit).toFixed(1)} W/kg・來自${A.ftp.source.kind === 'climb' ? ` ${fmtTime(A.ftp.source.time)} 的爬坡` : '最佳 20 分鐘'}（假設是全力騎的）`, A.ftp.source.tier)
        : ptile('FTP（估）', '資料不足', '', '需要一段 15 分鐘以上、可信的爬坡', null)));
    if (A.missing.length) res.append(el('p', { class: 'note' }, `還沒填：${missingLabels(A.missing).join('、')}。這些會用常見範圍代入，填了範圍會更窄。`));

    // climbs
    res.append(el('h3', {}, '各段爬坡'));
    if (!climbs.length) res.append(el('p', { class: 'note' }, '這趟沒有夠長的坡（至少爬升 20 m、平均 2.5% 以上、騎 1 分鐘以上），所以沒有爬坡功率。'));
    else {
      const lo = Math.min(...shown.map(c => c.lo), Infinity), hi = Math.max(...shown.map(c => c.hi), -Infinity);
      const a0 = Number.isFinite(lo) ? Math.floor(lo * 0.9 / 10) * 10 : 0, a1 = Number.isFinite(hi) ? Math.ceil(hi * 1.05 / 10) * 10 : 1;
      const X = (v) => ((v - a0) / (a1 - a0) * 100).toFixed(2) + '%';
      const hasMeasured = climbs.some(c => c.measured != null);
      const head = el('div', { class: 'prow phead' }, el('span', {}, '路段'), el('span', { class: 'axis' }, el('span', {}, a0 + ' W'), el('span', {}, a1 + ' W')), el('span', {}, 'W/kg'), el('span', {}, '可信度'));
      const rows = climbs.map(c => el('div', { class: 'prow' },
        el('div', {}, el('div', {}, `${(c.d0 / 1000).toFixed(2)}–${(c.d1 / 1000).toFixed(2)} km`),
          el('div', { class: 'fh' }, `${(c.len / 1000).toFixed(2)} km・${c.grade.toFixed(1)}%・${fmtTime(c.time)}・${c.speed.toFixed(1)} km/h`)),
        c.tier === 'none' ? el('div', { class: 'fh' }, `範圍 ${WR(c.lo, c.hi)}（${pctTxt(c.half)}），太寬不顯示`)
          : el('div', {}, el('div', { class: 'ptrack' }, el('div', { class: 'pbar ' + c.tier, style: `left:${X(c.lo)};width:calc(${X(c.hi)} - ${X(c.lo)})` }), el('div', { class: 'pmid', style: `left:${X(c.med)}` })),
            el('div', { class: 'fh' }, `${W(c.med)}（${WR(c.lo, c.hi)}，${pctTxt(c.half)}）${c.measured != null ? `・功率計 ${W(c.measured)}` : ''}`)),
        el('div', {}, c.tier === 'none' ? '—' : (c.med / A.massKit).toFixed(2)), badge(c.tier)));
      res.append(el('div', { class: 'plist' }, head, ...rows));
      if (hasMeasured) res.append(el('p', { class: 'note' }, '這個檔案有功率計的數據，可以直接對照估算準不準。'));
    }

    // route chart
    const Rt = A.route, km = Array.from(Rt.x, v => v / 1000);
    if (km.length < 3) { res.append(methodNotes()); return; }
    const show = (i) => Rt.tier[i] !== 'none';
    const med = Float64Array.from(Rt.med, (v, i) => show(i) ? v : NaN);
    const blo = Float64Array.from(Rt.lo, (v, i) => show(i) ? v : NaN), bhi = Float64Array.from(Rt.hi, (v, i) => show(i) ? v : NaN);
    const ele = Float64Array.from(Rt.x, d => interp(d, ride.grid.d, ride.grid.ele));
    const shades = []; let s0 = null;
    Rt.tier.forEach((t, i) => { if (t === 'none' && s0 == null) s0 = i; if ((t !== 'none' || i === Rt.tier.length - 1) && s0 != null) { shades.push([km[s0], km[i]]); s0 = null; } });
    const panels = [
      { h: 90, label: '海拔 m', series: [{ y: ele, color: tok('muted'), area: true, name: '海拔', fmt: v => v.toFixed(0) + ' m' }] },
      { h: 170, label: '功率 W', yMin: 0, series: [{ band: [blo, bhi], y: med, color: tok('blue'), width: 2, name: '估算功率', fmt: v => W(v) }] },
    ];
    const pw = ride.grid.power;
    if (pw) panels[1].series.push({ y: Float64Array.from(Rt.x, d => interp(d, ride.grid.d, pw)), color: tok('up'), width: 1.2, name: '功率計', fmt: v => W(v) });
    const chartEl = el('div', { class: 'chart' });
    res.append(el('h3', {}, '沿路功率'), el('p', { class: 'lead' }, '藍線是最可能值，淺藍帶是 90% 範圍（約 1 分鐘平滑）。灰底是誤差太大、不給數字的地方，例如下坡、單向平路或停車。'), chartEl);
    const noneShare = Rt.tier.filter(t => t === 'none').length / Rt.tier.length;
    if (noneShare > 0.8) res.append(el('p', { class: 'note' }, A.missing.length
      ? `這趟大部分路段都不估：多半是平路或下坡，而且「騎乘設定」還有 ${A.missing.length} 項沒填。填好之後範圍會縮小一些，但平路本來就很難估準，陡坡最準。`
      : '這趟大部分路段都不估：平路和下坡主要是風阻，受騎姿和風影響太大。陡坡最準。'));
    new PanelChart(chartEl, { x: km, xMax: ride.total / 1000, breakGap: 0.4, panels, shades,
      tipExtra: (i) => show(i) ? `範圍 ${WR(Rt.lo[i], Rt.hi[i])}（${TIER[Rt.tier[i]]}）` : '這裡不估（誤差太大）' }).draw();

    // error budget
    if (A.budget) {
      const c = A.budgetClimb, mx = Math.max(...A.budget.map(b => b.half), 0.01);
      res.append(el('h3', {}, '誤差從哪裡來'),
        el('p', { class: 'lead' }, `以 ${(c.d0 / 1000).toFixed(2)}–${(c.d1 / 1000).toFixed(2)} km 這段坡為例：每一項單獨會讓結果散開多少。最長的那幾條，就是再多填資料或換路段最能改善的地方。`),
        el('div', { class: 'budget' }, ...A.budget.map(b => el('div', { class: 'brow2' }, el('span', {}, b.name),
          el('span', { class: 'btrack' }, el('span', { class: 'bfill', style: `width:${(b.half / mx * 100).toFixed(1)}%` })), el('span', { class: 'n' }, pctTxt(b.half))))));
    }
    res.append(methodNotes());
  }
  renderResults();
}

function ptile(k, v, unit, d, tier) {
  const b = tier && tier !== 'none';
  return el('div', { class: 'tile' }, el('div', { class: 'k' }, k, b ? ' ' : null, b ? badge(tier) : null),
    el('div', { class: 'v', html: `${v}<small>${unit}</small>` }), d ? el('div', { class: 'd' }, d) : null);
}

// ---------------------------------------------------------------- comparison
// same climbs (and the whole comparable part) ridden twice; blue vs red in %
export function buildPowerCompare(host, cmp, { blueRole, nameB, nameR }) {
  const S = loadSettings();
  const { R, O } = cmp, rides = { R, O }, blue = rides[blueRole], red = rides[blueRole === 'R' ? 'O' : 'R'];
  const BLUE = tok('blue'), RED = tok('red');
  const sec = el('section', { class: 'rsec', id: 'power-cmp' });
  host.append(sec);
  const form = el('details', { class: 'fbox noprint' }, el('summary', {}, '騎乘設定（只記在這台瀏覽器）'));
  const res = el('div', { class: 'pres' });
  let timer = null;
  let chrome = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { renderResults(); chrome.stamp(); }, 180); };
  const grid = el('div', { class: 'fgrid' }); form.append(grid);
  let rf = [];
  const buildRideForms = () => { rf.forEach(n => n.remove()); rf = [rideForm(S, blue, schedule, `藍（${nameB}）`, { withBike: true }), rideForm(S, red, schedule, `紅（${nameR}）`, { withBike: true })]; grid.append(...rf); };
  grid.append(...riderBikeForm(S, schedule, { onBikesChanged: () => { buildRideForms(); schedule(); } }).children);
  buildRideForms();
  chrome = formChrome(form, res);
  sec.append(el('h2', {}, '功率比較'),
    el('p', { class: 'lead' }, '同一段路騎兩次，比的是「這次比上次多出幾 %」。同一台車、同樣握法時，大部分算不準的因素兩趟一樣，會互相抵消，所以百分比比單看瓦數準得多。'),
    form, res);
  if (!(S.rider.massKit > 0)) form.open = true;

  // map climbs found on R (inside comparable sections) to O's samples
  const KR = kinematics(R);
  const secOf = (d) => cmp.sections.find(([a, b]) => d >= a && d <= b);
  const oIdx = (s, sec2) => { for (let i = 0; i < O.n; i++) { const v = cmp.sO[i]; if (Number.isFinite(v) && v >= s && v >= sec2[0] && v <= sec2[1]) return i; } return -1; };
  const rIdx = (s) => { let i = 0; while (i < R.n - 1 && R.d[i] < s) i++; return i; };
  const pairs = [];
  for (const c of findClimbs(R, KR)) {
    const s1 = secOf(c.d0 + 1), s2 = secOf(c.d1 - 1); if (!s1 || s1 !== s2) continue;
    const o0 = oIdx(c.d0, s1), o1 = oIdx(c.d1, s1); if (o0 < 0 || o1 <= o0) continue;
    pairs.push({ label: `${(c.d0 / 1000).toFixed(2)}–${(c.d1 / 1000).toFixed(2)} km`, sub: `${(c.len / 1000).toFixed(2)} km・${c.grade.toFixed(1)}%`, r: [c.i0, c.i1], o: [o0, o1] });
  }
  const wr = [], wo = [];
  for (const sc of cmp.sections) {
    const a = rIdx(sc[0]), b = rIdx(sc[1]), oa = oIdx(sc[0], sc); let ob = -1;
    for (let i = O.n - 1; i >= 0; i--) { const v = cmp.sO[i]; if (Number.isFinite(v) && v <= sc[1] && v >= sc[0]) { ob = i; break; } }
    if (b > a && oa >= 0 && ob > oa) { wr.push([a, b]); wo.push([oa, ob]); }
  }
  if (wr.length) pairs.push({ label: '全部可比路段', sub: `${(cmp.compLen / 1000).toFixed(2)} km，含平路`, r: wr, o: wo, mode: 'clipped' });

  function renderResults() {
    res.innerHTML = '';
    const setB = settingsFor(S, blue), setR = settingsFor(S, red);
    // A = red (earlier by default), B = blue: diff = blue vs red
    const rolePairs = pairs.map(p => ({ ...p, a: blueRole === 'R' ? p.o : p.r, b: blueRole === 'R' ? p.r : p.o }));
    const C = compareClimbs(red, setR, blue, setB, rolePairs);
    if (!C.ok) { res.append(el('div', { class: 'box' }, '先在上面的「騎乘設定」填入人＋裝備重量，結果就會自動出現在這裡。')); form.open = true; return; }
    const cond = [C.sameBike ? '兩趟同一台車' : '兩趟車輛設定不同（輪胎、傳動的差異抵消不掉）', C.samePos ? '爬坡握法相同' : '爬坡握法不同或未填'];
    res.append(el('p', { class: 'note' }, cond.join('，') + '。'));
    const climbRows = C.rows.filter(r => r.mode !== 'clipped');
    if (!climbRows.length) res.append(el('p', { class: 'note' }, '兩趟共同的路段裡沒有夠長的坡（至少爬升 20 m、平均 2.5% 以上），只能比全部可比路段。'));
    const rowEl = (r) => el('div', { class: 'crow' },
      el('div', {}, el('div', {}, r.label), el('div', { class: 'fh' }, r.sub)),
      el('div', { class: 'n' }, el('span', { style: `color:${RED}` }, r.A.tier === 'none' ? '不估' : W(r.A.med)), el('div', { class: 'fh' }, r.A.tier === 'none' ? '' : `${WR(r.A.lo, r.A.hi)}`)),
      el('div', { class: 'n' }, el('span', { style: `color:${BLUE}` }, r.B.tier === 'none' ? '不估' : W(r.B.med)), el('div', { class: 'fh' }, r.B.tier === 'none' ? '' : `${WR(r.B.lo, r.B.hi)}`)),
      el('div', { class: 'n' }, r.diff.tier === 'none' ? '—' : el('b', {}, fmtSigned(r.diff.med, 1, '%')), el('div', { class: 'fh' }, `${fmtSigned(r.diff.lo, 1, '%')} ～ ${fmtSigned(r.diff.hi, 1, '%')}${r.diff.tier === 'none' ? '，太寬' : ''}`)),
      badge(r.diff.tier));
    res.append(el('div', { class: 'plist' },
      el('div', { class: 'crow phead' }, el('span', {}, '路段'), el('span', { class: 'n' }, `紅 ${nameR}`), el('span', { class: 'n' }, `藍 ${nameB}`), el('span', { class: 'n' }, '藍比紅'), el('span', {}, '可信度')),
      ...C.rows.map(rowEl)));
    res.append(el('p', { class: 'note' }, '「藍比紅」是功率的差（例如 +5% 代表藍那趟出力多 5%）。可信度看這個百分比的範圍：±3 個百分點以內可信，±6 以內參考。'));
    res.append(methodNotes());
  }
  renderResults();
}
