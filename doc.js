// Services, document: the three 16:9 pages (Overview, Systems, Performance) as HTML strings.
// No DOM in here. The same markup is the print view of the app and services.html in the download.
import { fmt } from './core.js?v=17b7bc1';
import { FIELDS, COLOR } from './pictos.js?v=17b7bc1';
import { display, isEmpty } from './data.js?v=17b7bc1';

// Same rules as pdf-example.html, scoped under .doc so the app can use it next to its own styles.
export const DOC_CSS = `
.doc { --ink: #000; --dim: #8a8a8a; --g: 24px; color: var(--ink); font-family: "DIN 1451 Std", "DIN 1451 Mittelschrift", "DIN Alternate", "Univers LT Std", "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 18px; line-height: 1.25; }
.doc * { box-sizing: border-box; }
.doc .sheet { width: 1280px; height: 720px; background: #fff; padding: 48px; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr) auto; column-gap: var(--g); row-gap: 24px; overflow: hidden; }
.doc .dim { color: var(--dim); }
.doc .small { font-size: 13px; }
.doc .side { grid-column: 1 / span 3; display: flex; flex-direction: column; }
.doc .side h1 { margin: 0; font-size: 44px; line-height: 1; font-weight: 400; }
.doc .foot { grid-column: 4 / span 8; align-self: end; }
.doc .pg { grid-column: 12 / span 1; align-self: end; text-align: right; }
.doc .sidefoot { grid-column: 1 / span 3; align-self: end; }
.doc .im { min-height: 0; min-width: 0; }
.doc .im svg { width: 100%; height: 100%; display: block; }
.doc .cell .im { flex: 1; }
.doc .sw { display: inline-block; width: 18px; height: 4px; vertical-align: middle; margin-right: 10px; }
.doc .legend { margin-top: auto; display: flex; flex-direction: column; gap: 7px; font-size: 15px; }
.doc .big { font-size: 30px; line-height: 1.1; }
.doc .p1img { grid-column: 4 / span 5; }
.doc .p1vals { grid-column: 9 / span 4; display: flex; flex-direction: column; justify-content: space-between; }
.doc .val span { display: block; }
.doc .p2 { grid-column: 4 / span 9; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: var(--g); min-height: 0; }
.doc .cell { display: flex; flex-direction: column; min-height: 0; }
.doc .cell .cap { padding-top: 8px; white-space: nowrap; }
.doc .cell .cap2 { display: flex; justify-content: space-between; align-items: baseline; padding-left: 28px; }
.doc .p3 { grid-column: 4 / span 9; display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); column-gap: var(--g); align-content: space-between; }
.doc .p3 .l { grid-column: 1 / span 5; }
.doc .p3 .a { grid-column: 6 / span 2; }
.doc .p3 .b { grid-column: 8 / span 2; }
.doc .p3 > * { display: flex; flex-direction: column; justify-content: flex-end; }
`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ctx: { m, values (from buildValues), svgs (field id to SVG string), black (true for black images) }
export function pages(ctx) {
  const { m, values, svgs, black } = ctx;
  const v = Object.fromEntries(values.map((x) => [x.key, x]));
  const col = (id) => (black ? '#000' : COLOR[id]);
  const out = (x, unit = '') => (isEmpty(x.value) ? '<span class="dim">n/a</span>' : esc(display(x) + (unit ? ' ' + unit : '')));
  const side = `<div class="sidefoot"><span>Services</span><br><span class="small dim">Project ${esc(m.id)}</span></div>`;
  const fields = FIELDS.filter((f) => f.id !== 'all');
  const legend = fields.map((f) => `<span><i class="sw" style="background:${col(f.id)}"></i>${f.label}</span>`).join('');
  const ris = v.risers_per_storey;
  const risText = ris.source === 'model' ? (ris.value ? esc(String(ris.value).split(', ').map((s) => s.split(' ').pop()).join(', ')) : '<span class="dim">n/a</span>') : out(ris);
  const kinds = v.system_kinds;
  const p1 = `<div class="sheet">
  <div class="side"><h1>Overview</h1><div class="legend">${legend}</div></div>
  <div class="p1img im">${svgs.all}</div>
  <div class="p1vals">
    <div class="val"><span class="small dim">Service systems</span><span class="big">${isEmpty(kinds.value) ? '<span class="dim">n/a</span>' : esc(typeof kinds.value === 'number' ? kinds.value + ' kinds' : kinds.value)}</span></div>
    <div class="val"><span class="small dim">Ducts and pipes per m² floor area</span><span class="big">${out(v.length_per_m2, 'm')}</span></div>
    <div class="val"><span class="small dim">Volume of ducts and pipes per m² floor area</span><span class="big">${out(v.volume_per_m2, 'm³')}</span></div>
    <div class="val"><span class="small dim">Risers per storey, lowest first</span><span class="big">${risText}</span></div>
    <div class="val"><span class="small dim">Floor area</span><span class="big">${out(v.floor_area, 'm²')}</span></div>
  </div>
  ${side}
  <div class="foot small dim">From the MEP model ${esc(m.file)}. Floor area entered by hand.</div>
  <div class="pg small dim">1 of 3</div>
</div>`;
  const cells = fields.map((f) => {
    let a, b;
    if (f.id === 'equipment') { a = fmt(m.proxies) + ' objects'; b = fmt(m.proxies) + ' elements'; }
    else { const g = m.groups.find((x) => x.id === f.id); a = fmt(g.len) + ' m'; b = fmt(g.count) + ' elements'; }
    return `<div class="cell"><div class="im">${svgs[f.id]}</div><div class="cap"><span><i class="sw" style="background:${col(f.id)}"></i>${f.label}</span></div><div class="cap2"><span>${a}</span><span class="small dim">${b}</span></div></div>`;
  }).join('');
  const p2 = `<div class="sheet">
  <div class="side"><h1>Systems</h1></div>
  <div class="p2">${cells}</div>
  ${side}
  <div class="foot small dim">From the MEP model ${esc(m.file)}. Length of ducts and pipes per system. Same view and scale in every field.</div>
  <div class="pg small dim">2 of 3</div>
</div>`;
  const goal = (x) => (x === '' ? '<span class="a big dim"></span>' : `<span class="a big">${x}</span>`);
  const res = (x) => `<span class="b big${isEmpty(x.value) ? ' dim' : ''}">${isEmpty(x.value) ? 'n/a' : esc(display(x))}</span>`;
  const limit = isEmpty(v.energy_limit.value) ? '' : esc(display(v.energy_limit));
  const row = (unit, label, g, r) => `<span class="l"><span class="small dim">${unit}</span>${label}</span>${goal(g)}${res(r)}`;
  const p3 = `<div class="sheet">
  <div class="side"><h1>Performance</h1></div>
  <div class="p3">
    <span class="l"></span><span class="a small dim">Goal</span><span class="b small dim">Result</span>
    ${row('kWh/m² per year', 'Primary energy by regulation, BE18', limit, v.energy_be18)}
    ${row('kWh/m² per year', 'Primary energy simulated, IDA ICE', limit, v.energy_ida)}
    ${row('share of floor area', 'Daylight sDA300', '50 %', v.daylight_sda300)}
    ${row('W/m²', 'Heating load', '', v.heating_load)}
    ${row('hours above 27 °C, worst room', 'Indoor climate', '25', v.hours_above_27)}
    ${row('% of time, worst room', 'Comfort category II', '', v.time_in_category_2)}
    ${row('ppm, worst room', 'CO₂ max', '1,200', v.co2_max)}
  </div>
  ${side}
  <div class="foot small dim">From the team report, entered by hand and not calculated by us.</div>
  <div class="pg small dim">3 of 3</div>
</div>`;
  return [p1, p2, p3];
}

// services.html: the three pages as one file that opens and prints on its own.
export function documentHTML(ctx) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Services, project ${esc(ctx.m.id)}</title>
<style>
html, body { margin: 0; background: #d9d9d6; }
${DOC_CSS}
.doc .sheet { margin: 24px auto; }
@media print { html, body { background: #fff; } .doc .sheet { margin: 0; page-break-after: always; } @page { size: 1280px 720px; margin: 0; } }
</style>
</head>
<body class="doc">
${pages(ctx).join('\n')}
</body>
</html>
`;
}
