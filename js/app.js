// File picking, ride list and routing to the single / comparison reports.
import { parseGPX } from './gpx.js';
import { prepareRide } from './ride.js';
import { compareRides } from './compare.js';
import { buildSingle } from './single.js';
import { buildCompare } from './comparison.js';
import { fmtTime, fmtDate, el } from './theme.js';

const rides = []; // {id, fileName, ride, checked}
const $ = (id) => document.getElementById(id);
let uid = 0;

async function addFiles(files) {
  $('err').hidden = true;
  const errs = [];
  for (const f of files) {
    if (!/\.gpx$/i.test(f.name)) { errs.push(`${f.name}：不是 GPX 檔`); continue; }
    try {
      const text = await f.text();
      const ride = prepareRide(parseGPX(text), { id: 'r' + (++uid), fileName: f.name });
      if (rides.some(r => r.ride.start === ride.start && Math.abs(r.ride.total - ride.total) < 1)) continue; // same ride twice
      rides.push({ id: ride.id, ride, checked: false });
    } catch (e) { errs.push(`${f.name}：${e.message}`); }
  }
  rides.sort((a, b) => b.ride.start - a.ride.start);
  if (errs.length) { $('err').textContent = '有檔案無法讀取：' + errs.join('；'); $('err').hidden = false; }
  renderList();
}

function renderList() {
  const tb = $('list').querySelector('tbody'); tb.innerHTML = '';
  for (const r of rides) {
    const cb = el('input', { type: 'checkbox', 'aria-label': '選取 ' + r.ride.name });
    cb.checked = r.checked;
    const tr = el('tr', { class: r.checked ? 'sel' : '' }, el('td', {}, cb), el('td', {}, fmtDate(r.ride.start)), el('td', {}, r.ride.name),
      el('td', { class: 'n' }, (r.ride.total / 1000).toFixed(2) + ' km'), el('td', { class: 'n' }, fmtTime(r.ride.moving)),
      el('td', { class: 'n' }, r.ride.avg.toFixed(1) + ' km/h'), el('td', { class: 'n' }, Math.round(r.ride.gain) + ' m'), el('td', {}, r.ride.fileName));
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
  const host = $('report'); host.innerHTML = '';
  $('printBtn').hidden = false;
  try {
    if (sel.length === 1) buildSingle(host, sel[0]);
    else if (sel.length === 2) {
      const cmp = compareRides(sel[0], sel[1]);
      if (cmp.error) {
        host.append(el('div', { class: 'card warnbox' }, cmp.error === 'overlap' ? `這兩趟重疊的路段太少（${Math.round(Math.max(cmp.f1, cmp.f2) * 100)}%），沒辦法比較。可以改成分別看單趟分析。` : '找不到可以比較的路段。'));
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
