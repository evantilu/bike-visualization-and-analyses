// Rider / bike / per-ride settings for the power estimate, remembered in this browser only.
// Nothing about the rides themselves is stored — just these few numbers and choices.
import { POSITIONS, TIRES, TUBES, CHAINS, WINDS } from './power.js';
import { el } from './theme.js';

const KEY = 'bva.settings.v1';
const blank = () => ({ rider: { massKit: null }, bikes: [], rides: {} });

export function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') return { ...blank(), ...s }; } catch (e) { /* private mode etc. */ }
  return blank();
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* not fatal */ } }

export const rideKey = (ride) => String(ride.start);
export function rideState(S, ride) {
  const k = rideKey(ride);
  if (!S.rides[k]) S.rides[k] = { bikeId: S.bikes[0]?.id ?? null };
  return S.rides[k];
}
// settings object in the shape power.js expects
export function settingsFor(S, ride) {
  const rs = rideState(S, ride);
  const bike = S.bikes.find(b => b.id === rs.bikeId) || S.bikes[0] || {};
  return { rider: S.rider, bike, ride: rs };
}

const FIELD_LABELS = {
  massKit: '人＋裝備重量', bikeMass: '車重', tire: '輪胎種類', tube: '內胎', psi: '胎壓', chain: '鏈條狀況',
  climbPos: '爬坡握把', flatPos: '平路握把', wind: '風', tempC: '氣溫', drafting: '有沒有跟車',
};
export const missingLabels = (missing) => missing.map(k => FIELD_LABELS[k] || k);

function opts(map, value, withBlank = true) {
  const o = [];
  if (withBlank) o.push(el('option', { value: '' }, '（未填）'));
  for (const [k, v] of Object.entries(map)) if (k !== 'unknown') o.push(el('option', { value: k, selected: value === k }, v.label));
  if (map.unknown) o.push(el('option', { value: 'unknown', selected: value === 'unknown' }, map.unknown.label));
  return o;
}
// empty number fields say （未填） like the selects do; examples live in the hint below, so an
// empty field never looks already filled in
function num(value, attrs) { return el('input', { type: 'number', inputmode: 'decimal', value: value ?? '', placeholder: '（未填）', ...attrs }); }
function row(label, control, hint) { return el('label', { class: 'fld' }, el('span', { class: 'fl' }, label), control, hint ? el('span', { class: 'fh' }, hint) : null); }

// Rider + bike editor. onChange() is called after every edit (settings already saved).
export function riderBikeForm(S, onChange, { rideForBike = null, onBikesChanged = null } = {}) {
  const box = el('div', { class: 'fgrid' });
  const massIn = num(S.rider.massKit, { min: 30, max: 200, step: 0.1, 'data-req': 'massKit' });
  massIn.addEventListener('input', () => { S.rider.massKit = massIn.value === '' ? null : +massIn.value; saveSettings(S); onChange(); });
  box.append(el('div', { class: 'fcol' }, el('h4', {}, '騎士'),
    row(['人＋裝備重量（kg）', el('span', { class: 'req' }, '必填')], massIn, '例如 70。穿著車衣褲、車鞋、安全帽，帶著手機和補給一起量')));

  const bikeCol = el('div', { class: 'fcol' }); box.append(bikeCol);
  if (!S.bikes.length) { S.bikes.push({ id: 'b' + Date.now().toString(36), name: '我的車' }); saveSettings(S); }
  let editId = null; // which bike is being edited when the form is not tied to one ride
  const renderBike = () => {
    bikeCol.innerHTML = '';
    const rs = rideForBike ? rideState(S, rideForBike) : null;
    const bike = S.bikes.find(b => b.id === (rs ? rs.bikeId : editId)) || S.bikes[0];
    const sel = el('select', {}, ...S.bikes.map(b => el('option', { value: b.id, selected: b === bike }, b.name || '未命名')),
      el('option', { value: '__new' }, '＋ 新增一台車'));
    sel.addEventListener('change', () => {
      let added = false;
      if (sel.value === '__new') { const nb = { id: 'b' + Date.now().toString(36), name: `車 ${S.bikes.length + 1}` }; S.bikes.push(nb); editId = nb.id; if (rs) rs.bikeId = nb.id; added = true; }
      else { editId = sel.value; if (rs) rs.bikeId = sel.value; }
      saveSettings(S); renderBike(); onChange(); if (added) onBikesChanged?.();
    });
    bikeCol.append(el('h4', {}, '車輛'), row(rideForBike ? '這趟騎的車' : '編輯哪一台車', sel));
    const set = (k, v) => { bike[k] = v; saveSettings(S); onChange(); };
    const name = el('input', { type: 'text', value: bike.name || '' }); name.addEventListener('change', () => { set('name', name.value); renderBike(); onBikesChanged?.(); });
    const mass = num(bike.mass, { min: 3, max: 30, step: 0.01 }); mass.addEventListener('input', () => set('mass', mass.value === '' ? null : +mass.value));
    const tire = el('select', {}, ...opts(TIRES, bike.tire)); tire.addEventListener('change', () => set('tire', tire.value || null));
    const tube = el('select', {}, ...opts(TUBES, bike.tube)); tube.addEventListener('change', () => set('tube', tube.value || null));
    const psi = num(bike.psi, { min: 40, max: 140, step: 1 }); psi.addEventListener('input', () => set('psi', psi.value === '' ? null : +psi.value));
    const chain = el('select', {}, ...opts(CHAINS, bike.chain)); chain.addEventListener('change', () => set('chain', chain.value || null));
    bikeCol.append(row('名稱', name), row('車重（kg）', mass, '例如 8。含水壺、水壺架、碼表座；踏板有裝就含'), row('輪胎', tire), row('內胎', tube), row('胎壓（psi）', psi, '例如 90'), row('鏈條狀況', chain));
  };
  renderBike();
  return box;
}

// Per-ride conditions. title: e.g. '這一趟' or '藍（2026-09-21）'
export function rideForm(S, ride, onChange, title = '這一趟', { withBike = false } = {}) {
  const rs = rideState(S, ride);
  const set = (k, v) => { rs[k] = v; saveSettings(S); onChange(); };
  let bikeSel = null;
  if (withBike) {
    bikeSel = el('select', {}, ...S.bikes.map(b => el('option', { value: b.id, selected: b.id === (rs.bikeId || S.bikes[0]?.id) }, b.name || '未命名')));
    bikeSel.addEventListener('change', () => set('bikeId', bikeSel.value));
  }
  const sel = (k, map) => { const s = el('select', {}, ...opts(map, rs[k])); s.addEventListener('change', () => set(k, s.value || null)); return s; };
  const temp = num(rs.tempC, { min: -10, max: 45, step: 1 }); temp.addEventListener('input', () => set('tempC', temp.value === '' ? null : +temp.value));
  const draft = el('select', {}, el('option', { value: '' }, '（未填）'), el('option', { value: 'no', selected: rs.drafting === 'no' }, '沒有，自己騎'),
    el('option', { value: 'yes', selected: rs.drafting === 'yes' }, '有跟車／團騎'));
  draft.addEventListener('change', () => set('drafting', draft.value || null));
  const mk = num(rs.massKit, { min: 30, max: 200, step: 0.1, placeholder: '同上' }); mk.addEventListener('input', () => set('massKit', mk.value === '' ? null : +mk.value));
  return el('div', { class: 'fcol' }, el('h4', {}, title), bikeSel ? row('這趟騎的車', bikeSel) : null,
    row('爬坡時主要握', sel('climbPos', POSITIONS)), row('平路時主要握', sel('flatPos', POSITIONS)),
    row('風', sel('wind', WINDS)), row('氣溫（°C）', temp, '例如 25'), row('有沒有跟車', draft, '跟在別人後面時平路的風阻會小很多，平路就不估'),
    row('這趟的人＋裝備重量（選填）', mk, '跟平常不同時才填'));
}

// short one-line summary chips
export function summaryChips(S, ride) {
  const st = settingsFor(S, ride), b = st.bike, r = st.ride;
  const chips = [];
  const mk = +r.massKit > 0 ? r.massKit : S.rider.massKit;
  chips.push(mk ? `人＋裝備 ${mk} kg` : '人＋裝備重量未填');
  if (b.name || b.mass) chips.push(`${b.name || '車'} ${b.mass ? b.mass + ' kg' : '車重未填'}`);
  if (b.tire) chips.push(TIRES[b.tire]?.label.replace(/（.*）/, '') + (b.psi ? `・${b.psi} psi` : '・胎壓未填'));
  if (r.climbPos) chips.push(`爬坡握${POSITIONS[r.climbPos]?.label.replace(/（.*）/, '')}`);
  if (r.wind) chips.push(WINDS[r.wind]?.label);
  if (Number.isFinite(+r.tempC) && r.tempC !== null && r.tempC !== '') chips.push(`${r.tempC}°C`);
  if (r.drafting === 'yes') chips.push('有跟車');
  return chips;
}
