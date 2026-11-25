// File picking, ride list and routing to the single / comparison reports.
import { parseGPX } from './gpx.js';
import { prepareRide } from './ride.js';
import { compareRides } from './compare.js';
import { buildSingle } from './single.js';
import { buildCompare } from './comparison.js';
import { fmtTime, fmtDate, el } from './theme.js';
import { interp } from './util.js';

const rides = []; // {id, fileName, ride, checked}
const $ = (id) => document.getElementById(id);
let uid = 0;
let disposeReport;

let pending = Promise.resolve();

function sameActivity(a, b) {
  if (Math.abs(a.trackStart - b.trackStart) > 2_000 || Math.abs(a.total - b.total) > Math.max(100, a.total * 0.03)) return false;
  const finish = r => r.trackStart + r.elapsed * 1000;
  if (Math.abs(finish(a) - finish(b)) > 8_000) return false;
  // Both riders on the same road is not enough: spot-check time and position across the track.
  let matches = 0;
  for (let k = 1; k <= 12; k++) {
    const i = Math.round(k / 13 * (a.n - 1));
    const t = a.t[i] + (a.trackStart - b.trackStart) / 1000;
    const lat = interp(t, b.t, b.lat), lon = interp(t, b.t, b.lon);
    const [x, y] = a.proj(lat, lon);
    if (Math.hypot(x - a.x[i], y - a.y[i]) <= 20) matches++;
  }
  return matches >= 11;
}

function addFiles(files) {
  const next = pending.then(() => importFiles(files));
  pending = next.catch(() => {});
  return next;
}

async function importFiles(files) {
  $('err').hidden = true;
  const errs = [], notes = [];
  for (const f of files) {
    try {
      let source;
      if (/\.fit$/i.test(f.name)) {
        const { parseFIT } = await import('./fit.js');
        source = await parseFIT(await f.arrayBuffer());
      } else if (/\.gpx$/i.test(f.name)) {
        source = parseGPX(await f.text());
      } else {
        throw new Error('請使用 FIT 或 GPX 檔案');
      }
      const ride = prepareRide(source, { id: 'r' + (++uid), fileName: f.name });
      const same = rides.find(r => (r.ride.format !== ride.format || r.ride.fileName === ride.fileName)
        && sameActivity(r.ride, ride));
      if (!same) {
        rides.push({ id: ride.id, ride, checked: false });
      } else if (same.ride.format !== ride.format) {
        const fit = ride.format === 'FIT' ? ride : same.ride;
        const gpx = ride.format === 'GPX' ? ride : same.ride;
        const restore = el('button', { class: 'btn', onclick: () => {
          rides.push({ id: gpx.id, ride: gpx, checked: false });
          rides.sort((a, b) => b.ride.start - a.ride.start);
          restore.disabled = true;
          renderList();
        } }, '保留 GPX');
        notes.push(el('span', {}, `疑似同一趟，已使用 ${fit.fileName}。 `, restore));
        if (fit === ride) Object.assign(same, { id: ride.id, ride });
      }
    } catch (e) { errs.push(`${f.name}：${e.message}`); }
  }
  rides.sort((a, b) => b.ride.start - a.ride.start);
  $('importNote').replaceChildren(...notes);
  $('importNote').hidden = !notes.length;
  if (errs.length) { $('err').textContent = '有檔案無法讀取：' + errs.join('；'); $('err').hidden = false; }
  renderList();
}

function renderList() {
  const tb = $('list').querySelector('tbody'); tb.innerHTML = '';
  for (const r of rides) {
    const summary = r.ride.session;
    const cb = el('input', { type: 'checkbox', 'aria-label': '選取 ' + r.ride.name });
    cb.checked = r.checked;
    const tr = el('tr', { class: r.checked ? 'sel' : '' }, el('td', {}, cb), el('td', {}, fmtDate(r.ride.start)), el('td', {}, r.ride.name),
      el('td', { class: 'n' }, ((summary?.distance ?? r.ride.total) / 1000).toFixed(2) + ' km'), el('td', { class: 'n' }, fmtTime(summary?.timer ?? r.ride.moving)),
      el('td', { class: 'n' }, (summary?.speed ?? r.ride.avg).toFixed(1) + ' km/h'), el('td', { class: 'n' }, Math.round(r.ride.gain) + ' m'), el('td', {}, r.ride.fileName));
    const toggle = () => {
      const sel = rides.filter(x => x.checked);
      if (!r.checked && sel.length >= 2) sel[0].checked = false; // keep at most two
      r.checked = !r.checked; renderList();
    };
    tr.addEventListener('click', (e) => { if (e.target !== cb) toggle(); });
    cb.addEventListener('change', () => { r.checked = !cb.checked; toggle(); });
    tb.append(tr);
  }
  $('listWrap').hidden = !rides.length; $('actions').hidden = !rides.length;
  const n = rides.filter(r => r.checked).length;
  $('goBtn').disabled = n < 1;
  $('goBtn').textContent = n === 2 ? '比較這兩趟' : n === 1 ? '分析這一趟' : '分析';
  $('selHint').textContent = n === 0 ? '勾一趟＝單趟分析，勾兩趟＝比較' : n === 1 ? '已選 1 趟（再勾一趟就能比較）' : '已選 2 趟';
}

function run() {
  const sel = rides.filter(r => r.checked).map(r => r.ride);
  disposeReport?.(); disposeReport = undefined;
  const host = $('report'); host.innerHTML = '';
  $('printBtn').hidden = false;
  try {
    if (sel.length === 1) disposeReport = buildSingle(host, sel[0]);
    else if (sel.length === 2) {
      const cmp = compareRides(sel[0], sel[1]);
      if (cmp.error) {
        host.append(el('div', { class: 'card warnbox' }, cmp.error === 'overlap' ? `這兩趟重疊的路段太少（${Math.round(Math.max(cmp.f1, cmp.f2) * 100)}%），沒辦法比較。可以改成分別看單趟分析。` : cmp.error === 'direction' ? '這兩趟走的是同一條路，但方向相反（例如去程和回程），沒有同方向騎過的路段可以比較。可以改成分別看單趟分析。' : '找不到可以比較的路段。'));
      } else {
        let swap = false; const render = () => buildCompare(host, cmp, { swap, onSwap: () => { swap = !swap; render(); } }); render();
      }
    }
  } catch (e) { console.error(e); host.append(el('div', { class: 'card warnbox' }, '分析時發生錯誤：' + e.message)); }
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('pickBtn').onclick = () => $('fileInput').click();
$('fileInput').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { if (!drop.contains(e.target)) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
$('goBtn').onclick = run;
$('printBtn').onclick = () => window.print();
window.__rideApp = { addFiles, rides, run }; // for automated tests
