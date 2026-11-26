// File picking, ride list and routing to the single / comparison reports.
import { parseGPX } from './gpx.js?v=2.0.7';
import { prepareRide } from './ride.js?v=2.0.7';
import { compareRides } from './compare.js?v=2.0.7';
import { buildSingle } from './single.js?v=2.0.7';
import { buildCompare } from './comparison.js?v=2.0.7';
import { fmtTime, fmtDate, el } from './theme.js?v=2.0.7';
import { interp } from './util.js?v=2.0.7';

const rides = []; // {id, fileName, ride, checked}
const $ = (id) => document.getElementById(id);
let uid = 0;
let disposeReport;

let pending = Promise.resolve();
const historyFolder = 'training-history';
const repository = 'evantilu/bike-visualization-and-analyses';
let historyBusy = false;
const historyMetrics = new Map();
const historyNameOrder = new Intl.Collator('zh-Hant', { numeric: true });
const checkedHistory = () => $('historyOptions').querySelectorAll('input:checked');

function setHistoryBusy(busy) {
  historyBusy = $('historyChoices').disabled = busy;
  $('historyImport').disabled = busy || !checkedHistory().length;
}

function rideMetrics(ride) {
  return {
    start: ride.start,
    distance: ride.session?.distance ?? ride.total,
    duration: ride.session?.timer ?? ride.moving,
  };
}

async function sortHistory() {
  const options = $('historyOptions');
  const status = $('historyStatus');
  const [key, direction] = $('historySort').value.split('-');
  const order = direction === 'asc' ? 1 : -1;
  const rows = [...options.children].map(label => ({ label, input: label.querySelector('input') }));
  const metrics = row => historyMetrics.get(row.input.dataset.sha);
  if (key !== 'name') {
    const missing = rows.filter(row => !metrics(row));
    if (missing.length) status.textContent = '正在讀取騎乘資料以取得排序資訊…';
    for (let i = 0; i < missing.length; i += 6) {
      await Promise.all(missing.slice(i, i + 6).map(async ({ input }) => {
        const file = historyFile(input);
        try {
          const ride = prepareRide(await readRideSource(file));
          historyMetrics.set(file.historySha, rideMetrics(ride));
        } catch {
          // Leave this entry available for import or a later retry.
        }
      }));
    }
  }
  rows.sort((a, b) => {
    const byName = historyNameOrder.compare(a.input.value, b.input.value);
    if (key === 'name') return order * byName;
    const first = metrics(a)?.[key], second = metrics(b)?.[key];
    if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : byName;
    if (!Number.isFinite(second)) return -1;
    return order * (first - second) || byName;
  });
  for (const row of rows) {
    const data = metrics(row);
    row.label.querySelector('small').textContent = data
      ? `${fmtDate(data.start)} · ${(data.distance / 1000).toFixed(2)} km · ${fmtTime(data.duration)}` : '';
  }
  const incomplete = key === 'name' ? 0 : rows.filter(row => !Number.isFinite(metrics(row)?.[key])).length;
  status.textContent = incomplete ? `有 ${incomplete} 趟無法讀取排序資訊，已排在清單最後。` : '';
  options.replaceChildren(...rows.map(row => row.label));
  options.scrollTop = 0;
}

async function listHistory() {
  const status = $('historyStatus');
  const choices = $('historyChoices');
  const options = $('historyOptions');
  const importButton = $('historyImport');
  const retry = $('historyRetry');
  setHistoryBusy(true);
  retry.hidden = choices.hidden = importButton.hidden = importButton.disabled = true;
  options.replaceChildren();
  status.textContent = '正在讀取歷史紀錄…';
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/contents/${historyFolder}?ref=main`, { cache: 'no-cache' });
    if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
    const entries = response.ok ? await response.json() : [];
    const files = entries.filter(entry => entry.type === 'file' && /\.(fit|gpx)$/i.test(entry.name));
    options.append(...files.map(({ name, sha }) => el('label', {},
      el('input', { type: 'checkbox', value: name, 'data-sha': sha }),
      el('span', {}, el('span', {}, name), el('small', { 'aria-hidden': 'true' })))));
    choices.hidden = importButton.hidden = !files.length;
    if (files.length) await sortHistory();
    else status.textContent = '目前沒有可匯入的 FIT 或 GPX 紀錄。';
  } catch {
    status.textContent = '暫時無法從 GitHub 讀取歷史紀錄，請稍後重試。';
    retry.hidden = false;
  } finally {
    setHistoryBusy(false);
  }
}

function historyFile(input) {
  const name = input.value;
  const url = `https://raw.githubusercontent.com/${repository}/main/${historyFolder}/${encodeURIComponent(name)}?v=${encodeURIComponent(input.dataset.sha)}`;
  async function read() {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`無法從 GitHub 下載（HTTP ${response.status}）`);
    return response;
  }
  return {
    name, historySha: input.dataset.sha,
    text: async () => (await read()).text(),
    arrayBuffer: async () => (await read()).arrayBuffer(),
  };
}

async function readRideSource(file) {
  if (/\.fit$/i.test(file.name)) {
    const { parseFIT } = await import('./fit.js?v=2.0.7');
    return parseFIT(await file.arrayBuffer());
  }
  if (/\.gpx$/i.test(file.name)) return parseGPX(await file.text());
  throw new Error('請使用 FIT 或 GPX 檔案');
}

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
      const source = await readRideSource(f);
      const ride = prepareRide(source, { id: 'r' + (++uid), fileName: f.name });
      if (f.historySha) historyMetrics.set(f.historySha, rideMetrics(ride));
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
  return !errs.length;
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
$('historyBtn').onclick = () => {
  const panel = $('history');
  panel.hidden = !panel.hidden;
  $('historyBtn').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden && !historyBusy) listHistory();
};
$('historyRetry').onclick = listHistory;
$('historySort').onchange = async () => {
  setHistoryBusy(true);
  try {
    await sortHistory();
  } finally {
    setHistoryBusy(false);
  }
};
$('historyOptions').onchange = () => { $('historyImport').disabled = !checkedHistory().length; };
$('historyImport').onclick = async () => {
  const selected = [...checkedHistory()];
  const previousStatus = $('historyStatus').textContent;
  setHistoryBusy(true);
  $('historyStatus').textContent = `正在匯入 ${selected.length} 趟騎乘…`;
  try {
    if (await addFiles(selected.map(historyFile))) {
      for (const input of selected) input.checked = false;
    }
  } finally {
    $('historyStatus').textContent = previousStatus;
    setHistoryBusy(false);
  }
};
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
