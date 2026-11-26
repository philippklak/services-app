// Services, app shell: four pages (Files, Data, Images, Export). Reading is in core.js, values and
// export in data.js, images in pictos.js, the document in doc.js. Only this file touches the DOM.
import * as WebIFC from './vendor/web-ifc-api.js';
import { analyze, fmt } from './core.js?v=f83b579';
import { REQUIRED, OPTIONAL, BUILDING_USE, buildValues, exportRows, toCSV, toJSON, emptyState, display, isEmpty, parse, storeyName } from './data.js?v=f83b579';
import { FIELDS, pictograms } from './pictos.js?v=f83b579';
import { DOC_CSS, pages, documentHTML } from './doc.js?v=f83b579';
import { zipSync, strToU8 } from './vendor/fflate.js';

const $ = (s) => document.querySelector(s);
const PAGES = ['files', 'data', 'images', 'export'];
const S = { files: [], report: null, q: '', qKey: null, zoom: 1, model: null, state: emptyState(), editing: null, out: { csv: true, json: true, images: true, html: true }, pics: null, picsKey: '' };
let api = null;
document.getElementById('doc-css').textContent = DOC_CSS;

async function engine() {
  if (!api) {
    api = new WebIFC.IfcAPI();
    api.SetWasmPath(new URL('./vendor/', import.meta.url).href, true);
    await api.Init();
  }
  return api;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PEN = '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2.5 13.5l.6-3L10.8 2.8a1.2 1.2 0 0 1 1.7 0l.7.7a1.2 1.2 0 0 1 0 1.7L5.5 12.9z"/><path d="M9.6 4l2.4 2.4"/></svg>';
const X = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 3l10 10M13 3L3 13"/></svg>';
const PLUS = '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 2v12M2 8h12"/></svg>';
const chk = (on) => `<svg class="chk" role="img" aria-label="${on ? 'selected' : 'not selected'}" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="1" width="14" height="14"/>${on ? '<path d="M4 8.3l2.7 2.7L12 5.2"/>' : ''}</svg>`;

// ---- storage: inputs and corrections per model, in this browser only
const storeKey = (m) => 'services:' + m.id + ':' + m.elements.length;
function load(m) {
  try { const s = JSON.parse(localStorage.getItem(storeKey(m)) || 'null'); if (s) return { ...emptyState(), ...s, images: { ...emptyState().images, ...(s.images || {}) } }; } catch (e) {}
  return emptyState();
}
function save() { if (!S.model || VIDEO) return; try { localStorage.setItem(storeKey(S.model), JSON.stringify(S.state)); } catch (e) {} }

// ---- files: the IFC with building services is found by its content, not by its name
// ---- recording mode (?video, local only): 26-06 is read in advance, one click on the drop field adds
// the model and the report, the report values are filled in as in the example PDF. Nothing is saved.
const VIDEO = new URLSearchParams(location.search).has('video');
const PRE = new Map();
const VIDEO_INPUTS = { building_use: 'other buildings', energy_be18: '40.9', daylight_sda300: 'met', hours_above_27: '0.1', co2_max: '1219', floor_area: '6134' };
const isMEP = (m) => m.elements.filter((e) => e.seg).length >= 10;
async function addFile(name, size, getBuffer) {
  const f = { name, size, kind: /\.ifc$/i.test(name) ? 'ifc' : /\.pdf$/i.test(name) ? 'pdf' : 'other', status: 'reading' };
  S.files.filter((x) => x.name === name).forEach(drop);
  S.files.push(f);
  render();
  if (f.kind === 'pdf') {
    try {
      const buf = await getBuffer();
      f.url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' })); f.status = 'done';
      readText(f, new Uint8Array(buf.slice(0)));
    } catch (e) { f.status = 'error'; }
    render(); return;
  }
  if (f.kind !== 'ifc') { f.status = 'done'; render(); return; }
  await new Promise((r) => setTimeout(r, 30));
  try {
    const m = PRE.get(name) || analyze(WebIFC, await engine(), new Uint8Array(await getBuffer()), name);
    if (PRE.has(name)) await new Promise((r) => setTimeout(r, 700));
    f.status = 'done';
    if (isMEP(m)) {
      S.files.forEach((x) => { if (x.kind === 'mep') x.kind = 'ifc'; });
      f.kind = 'mep';
      S.model = m; S.state = VIDEO ? { ...emptyState(), inputs: { ...VIDEO_INPUTS } } : load(m); S.editing = null; S.pics = null; S.prev = null;
    }
  } catch (e) {
    console.error(e);
    f.status = 'error';
  }
  render();
}
// ---- report text: read once with pdf.js, searched in the panel. Pages stay in this browser.
let pdfjs = null;
async function readText(f, data) {
  try {
    if (!pdfjs) {
      pdfjs = await import('./vendor/pdf.min.mjs?v=f83b579');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs?v=f83b579', import.meta.url).href;
    }
    const doc = await pdfjs.getDocument({ data }).promise, pages = [];
    f.doc = doc;
    if (S.report === f) view();
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.map((x) => x.str + (x.hasEOL ? ' ' : '')).join(' ').replace(/\s+/g, ' '));
    }
    f.pages = pages;
    try { const { suggestAll } = await import('./suggest.js?v=f83b579'); f.sugg = suggestAll(pages); } catch (e) { console.error(e); }
    if (location.hash.slice(1) === 'data') render();
  } catch (e) { console.error(e); f.pages = []; if (!f.doc) f.doc = false; if (S.report === f) view(); }
  if (S.report === f) hits();
}
// Search terms used when a field gets the focus. Spaces in a term also match no space ("27 °C", "27°C").
const CONTEXT = { building_use: 'BR18', energy_limit: 'BR18', energy_be18: 'BE18', energy_ida: 'IDA', daylight_sda300: 'sDA', heating_load: 'heating load', hours_above_27: '27 °C', time_in_category_2: 'category II', co2_max: 'ppm', floor_area: 'floor area' };
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// pdf.js often splits words and numbers into pieces ("41 , 2", "en ergy"), so spaces are allowed between all characters.
const searchRe = () => { const q = S.q.replace(/\s+/g, ''); return q ? new RegExp([...q].map(reEsc).join('\\s*'), 'gi') : null; };
function hits() {
  const el = $('#hits'), f = S.report;
  if (!el || !f) return;
  const q = S.q.trim();
  if (!q) { el.innerHTML = ''; marks(); return; }
  if (!f.pages) { el.innerHTML = '<p class="dim">Reading the text of the report</p>'; return; }
  if (!f.pages.length || f.pages.every((p) => !p.trim())) { el.innerHTML = '<p class="dim">This PDF has no searchable text</p>'; return; }
  const re = searchRe(), out = [];
  marks();
  let n = 0;
  f.pages.forEach((t, i) => {
    for (const m of t.matchAll(re)) {
      n++;
      if (out.length < 40) out.push(`<button data-page="${i + 1}"><span class="dim">p. ${i + 1}</span><span><span class="dim">${esc(t.slice(Math.max(0, m.index - 50), m.index))}</span>${esc(m[0])}<span class="dim">${esc(t.slice(m.index + m[0].length, m.index + m[0].length + 70))}</span></span></button>`);
    }
  });
  el.innerHTML = n ? `<p class="dim">${n} ${n === 1 ? 'hit' : 'hits'}${n > out.length ? `, first ${out.length} shown` : ''}</p>` + out.join('') : '<p class="dim">No hits</p>';
}
// The report is drawn by pdf.js, page by page when it comes into view, the same in every browser.
const ZOOM = [1, 1.5, 2, 3];
let observer = null;
async function view(keep) {
  const box = $('#pages'), f = S.report;
  if (!box || !f) return;
  if (f.doc === false) { box.innerHTML = `<p class="dim">The report could not be shown here. <a href="${f.url}" target="_blank" rel="noopener">Open it in a new tab</a></p>`; return; }
  if (!f.doc) { box.innerHTML = '<p class="dim">Reading the report</p>'; return; }
  const doc = f.doc, first = (await doc.getPage(1)).getViewport({ scale: 1 });
  if (observer) observer.disconnect();
  box.innerHTML = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const d = document.createElement('div');
    d.className = 'pg'; d.dataset.n = i;
    d.style.width = `${S.zoom * 100}%`; d.style.aspectRatio = `${first.width} / ${first.height}`;
    box.appendChild(d);
  }
  observer = new IntersectionObserver((list) => list.forEach((x) => { if (x.isIntersecting && !x.target.dataset.done) { x.target.dataset.done = 1; draw(doc, x.target); } }), { root: box, rootMargin: '800px 0px' });
  box.querySelectorAll('.pg').forEach((d) => observer.observe(d));
  if (keep) goPage(keep);
}
async function draw(doc, d) {
  const page = await doc.getPage(+d.dataset.n), one = page.getViewport({ scale: 1 });
  d.style.aspectRatio = `${one.width} / ${one.height}`;
  const vp = page.getViewport({ scale: (d.clientWidth / one.width) * (window.devicePixelRatio || 1) });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  d.appendChild(c);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  d._items = (await page.getTextContent()).items; d._vp = one;
  mark(d);
}
// Every hit of the search is marked on the drawn pages, in percent of the page so zoom keeps it in place.
function marks() { document.querySelectorAll('#pages .pg').forEach((d) => { if (d._items) mark(d); }); }
function mark(d) {
  d.querySelectorAll('.hl').forEach((x) => x.remove());
  const re = searchRe();
  if (!re) return;
  const W = d._vp.width, H = d._vp.height;
  // The text items of a page are joined, so a hit may run across several items. Each item gets its own mark.
  const items = d._items.filter((it) => it.str), start = [];
  let all = '';
  for (const it of items) { start.push(all.length); all += it.str; }
  for (const m of all.matchAll(re)) {
    const a = m.index, b = m.index + m[0].length;
    items.forEach((it, k) => {
      const s0 = start[k], s1 = s0 + it.str.length;
      if (s1 <= a || s0 >= b) return;
      const from = Math.max(a, s0) - s0, to = Math.min(b, s1) - s0, len = it.str.length;
      if (!it.str.slice(from, to).trim()) return;
      const t = pdfjs.Util.transform(d._vp.transform, it.transform), fh = Math.hypot(t[2], t[3]);
      const x = t[4] + (it.width * from) / len, w = (it.width * (to - from)) / len;
      const s = document.createElement('span');
      s.className = 'hl';
      s.style.cssText = `left:${(x / W) * 100}%;top:${((t[5] - fh) / H) * 100}%;width:${(w / W) * 100}%;height:${(fh * 1.2 / H) * 100}%`;
      d.appendChild(s);
    });
  }
}
function current() {
  const box = $('#pages'); if (!box) return 1;
  const top = box.getBoundingClientRect().top;
  const pg = [...box.querySelectorAll('.pg')].find((d) => d.getBoundingClientRect().bottom > top + 40);
  return pg ? +pg.dataset.n : 1;
}
// Pages above may change height once drawn, so the jump is repeated until the page stays in place.
// Opens the report of a suggestion next to the fields, searches its words and goes to its page.
function showFind(c) {
  S.report = S.files[c.fi]; S.q = c.match.replace(/\s+/g, ' ').trim().slice(0, 60); S.qKey = null;
  render();
  const q = $('#q'); if (q) q.value = S.q;
  let tries = 0; // wait until the text is read and the pages of the panel exist
  const go = () => {
    if (!S.report.pages || !document.querySelector(`#pages .pg[data-n="${c.page}"]`)) { if (++tries < 50) setTimeout(go, 200); return; }
    hits(); goPage(c.page);
  };
  go();
}
function goPage(n) {
  const box = $('#pages'), d = box && box.querySelector(`.pg[data-n="${n}"]`);
  if (!d) return;
  let tries = 0;
  // to the first mark of the page once it is drawn, otherwise to the top of the page
  const go = () => {
    const h = d.querySelector('.hl'), b = box.getBoundingClientRect();
    if (h) { const r = h.getBoundingClientRect(); box.scrollTop += r.top - b.top - b.height / 3; box.scrollLeft += r.left - b.left - b.width / 3; }
    else box.scrollTop += d.getBoundingClientRect().top - b.top;
    if (++tries < 8) setTimeout(go, 150);
  };
  go();
}

// Removing a file. Removing the MEP model also clears what was read from it.
function drop(f) {
  S.files = S.files.filter((x) => x !== f);
  if (f.url) URL.revokeObjectURL(f.url);
  if (S.report === f) S.report = null;
  if (f.kind === 'mep') { S.model = null; S.state = emptyState(); S.editing = null; S.pics = null; S.prev = null; }
}
async function addFiles(list) { for (const f of list) await addFile(f.name, f.size, () => f.arrayBuffer()); }

function pics() {
  const o = S.state.images, key = o.colour + o.storeys + o.detail;
  if (!S.pics || S.picsKey !== key) { S.pics = pictograms(S.model, o); S.picsKey = key; }
  return S.pics;
}
const svgMap = () => Object.fromEntries(pics().list.map((x) => [x.id, x.svg]));
const docCtx = () => ({ m: S.model, values: buildValues(S.model, S.state), svgs: svgMap(), black: S.state.images.colour === 'black' });

// ---- page parts
const head = (t, p) => `<div class="grid head"><h1>${t}</h1><p>${p}</p></div>`;
const block = (name, sub, body) => `<div class="grid block"><div class="sec"><span>${name}</span><span class="small dim">${sub}</span></div>${body}</div>`;
const row = (l, v, cls = '') => `<div class="row ${cls}"><span class="l">${l}</span><span class="v">${v}</span></div>`;
const stackRow = (l, v, sub, cls = '') => `<div class="row ${cls}"><span class="l">${l}</span><span class="v stack"><span>${v}</span><span class="small dim">${sub}</span></span></div>`;
const noModel = () => block('Model', 'none yet', `<p class="note">Add the MEP model of the project on the page Files first.</p>`);

function pageFiles() {
  const m = S.model;
  const used = S.files.filter((f) => f.kind === 'mep' || (f.kind === 'pdf' && f.url)).length;
  const what = (f) => (f.status === 'reading' ? 'reading' : f.status === 'error' ? 'could not be read' : f.kind === 'mep' ? 'services, all values and images' : f.kind === 'pdf' ? 'report, opens next to the data' : 'nothing needed');
  let h = head('Files', 'The IFC models and PDF reports of the project. They are read on this computer and not uploaded. Only what helps the services is taken.');
  h += block('Files', `${used} of ${S.files.length} used`,
    `<button class="fill drop" data-act="choose"><span class="small dim">Drop the models and reports of the project here or choose them</span><b>${S.files.length} ${S.files.length === 1 ? 'file' : 'files'}</b></button>` +
    S.files.map((f, i) => row(esc(f.name), `<span>${what(f)}</span><button class="edit x" data-rmfile="${i}" title="Remove" aria-label="Remove ${esc(f.name)}">${X}</button>`, f.kind === 'mep' || f.kind === 'pdf' || f.status === 'reading' ? '' : 'off')).join(''));
  if (!m) return h;
  const kinds = m.groups.filter((g) => g.count && g.id !== 'other').length;
  h += block('Content', `read in ${(m.ms / 1000).toFixed(1)} s`,
    row('Schema', esc(m.schema || 'unknown')) + row('Elements', fmt(m.elements.length)) +
    stackRow('Systems', `${fmt(m.systems.length)} in the file`, `sorted into ${kinds} kinds on the page Data`) +
    stackRow('Storeys', fmt(m.storeys.length), esc(m.levels.map((l) => storeyName(l.name)).join(', '))));
  const inSys = m.elements.length - m.unassigned, named = m.systems.filter((s) => s.cat).length;
  const checks = [inSys === m.elements.length, named === m.systems.length && m.systems.length > 0, m.storeys.length > 1];
  h += block('Check for required data', `${checks.filter(Boolean).length} of 3 met`,
    stackRow('Every element belongs to a system', `${fmt(inSys)} of ${fmt(m.elements.length)}`, 'for the kinds, the lengths and the images', checks[0] ? '' : 'off') +
    stackRow('System names can be read', `${fmt(named)} of ${fmt(m.systems.length)}`, 'to sort the systems into kinds', checks[1] ? '' : 'off') +
    stackRow('Storeys are defined', fmt(m.storeys.length), 'for the storeys in the images', checks[2] ? '' : 'off') +
    stackRow('Air terminals are modelled', m.terminals ? fmt(m.terminals) : 'none', 'optional, drawn in the images', m.terminals ? '' : 'off'));
  return h;
}

// A model value: plain text with Edit, or a field with "model <value>, reset" once it is edited.
function modelRow(v, label) {
  const unit = v.unit ? ' ' + esc(v.unit) : '';
  if (S.editing === v.key || v.source === 'manual') {
    const cur = v.source === 'manual' ? display(v) : display({ ...v, value: v.model });
    const was = isEmpty(v.model) ? 'n/a' : display({ ...v, value: v.model });
    return row(label, `<input data-k="edit:${v.key}" data-edit="${v.key}" value="${esc(cur)}"><span class="edit small dim">${v.def.kind === 'calc' ? 'calculated' : 'model'} ${esc(was)},&nbsp;<button data-reset="${v.key}">reset</button></span>`, 'in');
  }
  if (isEmpty(v.value)) {
    // what is missing, as links to the field where it goes
    const go = (k, t) => `<button class="go" data-focus="${k}">${t}</button>`;
    const area = go('floor_area', 'enter floor area');
    if (v.total) return stackRow(label, `${esc(v.total)} in all`, `per m², ${area}`, 'off');
    if (v.def.kind === 'calc') {
      const miss = [];
      if (!S.state.inputs.building_use) miss.push(go('building_use', 'choose building use'));
      if (isEmpty(parse(S.state.inputs.floor_area))) miss.push(area);
      return row(label, `<span>${miss.join(' and ')}</span>`, 'off');
    }
    return row(label, v.def.needs ? area : 'n/a', 'off');
  }
  // under the value: the formula of a calculated value, the kinds of the systems
  let sub = v.formula || '';
  let text = esc(display(v)) + (typeof v.value === 'number' ? unit : '');
  if (v.key === 'system_kinds' && v.source === 'model') sub = v.note;
  return `<div class="row"><span class="l">${label}</span><span class="v${sub ? ' stack' : ''}"><span style="display:flex;width:100%"><span>${text}</span><button class="edit small dim" data-editk="${v.key}">${PEN}Edit</button></span>${sub ? `<span class="small dim">${esc(sub)}</span>` : ''}</span></div>`;
}

// Suggestions from the reports under a field: the values found by suggest.js, best first, with page.
// A click fills the field and shows the place in the report. Nothing is filled in without a click.
function suggestions(key) {
  const all = [];
  S.files.forEach((f, fi) => { if (f.sugg && f.sugg[key]) f.sugg[key].forEach((c) => all.push({ ...c, fi })); });
  return all.sort((a, b) => b.score - a.score).filter((c, i, l) => l.findIndex((x) => x.value === c.value) === i).slice(0, 3);
}
const SUG = new Map();
function sugLine(v, raw, html) {
  const list = suggestions(v.key);
  if (!list.length) return html;
  const same = (c) => (typeof c.value === 'number' ? parse(raw) === c.value : raw === c.value);
  const id = (c) => { const k = SUG.size; SUG.set(String(k), { key: v.key, c }); return k; };
  // short, one line: value and page. Where it was found (a table, the highest value) goes into the tooltip.
  const tip = (c) => `Page ${c.page}` + (c.kind === 'table' ? `, ${v.key === 'time_in_category_2' ? 'lowest' : 'highest'} value in a table` : '');
  const val = (c) => esc(typeof c.value === 'number' ? fmt(c.value, Number.isInteger(c.value) ? 0 : String(c.value).split('.')[1].length) : c.value);
  // the value in the field is marked, with an x to empty the field. The other values stay to swap.
  const hit = list.find(same);
  const shown = hit ? [hit, ...list.filter((c) => c !== hit)].slice(0, 2).sort((a, b) => list.indexOf(a) - list.indexOf(b)) : list.slice(0, 2);
  const body = `<span class="dim">Report</span>` + shown.map((c) => c === hit
    ? `<span class="pick"><button data-sugshow="${id(c)}" title="Show in the report. ${tip(c)}">${val(c)}<span class="dim"> p. ${c.page}</span></button><button class="x" data-sugclear="${v.key}" title="Empty the field" aria-label="Empty the field">${X}</button></span>`
    : `<button data-sug="${id(c)}" title="Fill in and show in the report. ${tip(c)}">${val(c)}<span class="dim"> p. ${c.page}</span></button>`).join('');
  // the label spans the field and the suggestion, so the suggestion sits right under the field
  return html.replace('<span class="l"', '<span class="l withsug"') + `<div class="sug small">${body}</div>`;
}

function pageData() {
  SUG.clear();
  const m = S.model;
  const reports = S.files.filter((f) => f.kind === 'pdf' && f.url);
  const rep = block('Report', reports.length ? 'opens next to the fields' : 'none yet', reports.length
    ? reports.map((f) => row(esc(f.name), `<button class="edit" style="margin-left:0;padding-left:0" data-report="${S.files.indexOf(f)}">${S.report === f ? 'Close' : 'Open next to the fields'}</button>`)).join('')
    : `<p class="note">Add the PDF report of the team on the page Files to read the values next to the fields.</p>`);
  if (!m) return head('Data', 'Values for the course, from the model and from the report of the team.') + rep + noModel();
  const vals = buildValues(m, S.state), by = Object.fromEntries(vals.map((v) => [v.key, v]));
  let h = head('Data', `Project ${esc(m.id)}. Grey fields are yours to fill from the report. Everything else was read from the model and can be corrected.`);
  h += rep;
  const req = REQUIRED.map((d) => by[d.key]);
  const use = S.state.inputs.building_use || '';
  const useRow = row('Building use, for the BR18 limit', `<select data-k="in:building_use" data-in="building_use" class="${use ? '' : 'dim'}"><option value="">choose</option>${BUILDING_USE.map((o) => `<option${o === use ? ' selected' : ''}>${o}</option>`).join('')}</select>`, 'in');
  h += block('Required', `${req.filter((v) => !isEmpty(v.value)).length} of ${req.length} complete`, req.map((v) => {
    if (v.def.kind === 'model') return modelRow(v, esc(v.label));
    if (v.def.kind === 'calc') return useRow + modelRow(v, esc(v.label));
    const raw = S.state.inputs[v.key] || '';
    if (v.def.kind === 'choice') return sugLine(v, raw, row(esc(v.label), `<select data-k="in:${v.key}" data-in="${v.key}" class="${raw ? '' : 'dim'}"><option value="">choose</option>${v.def.options.map((o) => `<option${o === raw ? ' selected' : ''}>${o}</option>`).join('')}</select>`, 'in'));
    return sugLine(v, raw, row(esc(v.label), `<input data-k="in:${v.key}" data-in="${v.key}" inputmode="decimal" value="${esc(raw)}"><span class="u dim">${esc(v.unit)}</span>`, 'in'));
  }).join(''));
  const opt = OPTIONAL.map((d) => by[d.key]), own = vals.filter((v) => v.level === 'own');
  const sub = `${opt.filter((v) => v.selected).length} of ${opt.length} selected, ${opt.filter((v) => v.source === 'manual').length} corrected, ${own.length} own`;
  h += block('Optional', sub, opt.map((v) => {
    const label = `<button data-opt="${v.key}" style="display:flex;gap:14px;align-items:center">${chk(v.selected)}${esc(v.label)}</button>`;
    if (!v.selected) return row(label, esc(display(v)), 'off');
    return modelRow(v, label);
  }).join('') + S.state.own.map((o, i) => `<div class="row in"><span class="l">${chk(true)}<span class="own"><input data-k="own:${i}:label" data-own="${i}" data-f="label" placeholder="Label" value="${esc(o.label || '')}"></span></span><span class="v"><input data-k="own:${i}:value" data-own="${i}" data-f="value" placeholder="value" value="${esc(o.value || '')}"><input class="unit" data-k="own:${i}:unit" data-own="${i}" data-f="unit" placeholder="unit" value="${esc(o.unit || '')}"><span class="edit small dim"><button data-rmown="${i}">remove</button></span></span></div>`).join('') +
    `<div class="row"><span class="l"><span class="plus dim">${PLUS}</span><button class="own dim" data-act="addown">Add your own value</button></span><span class="v"></span></div>`);
  h += `<div class="grid"><p class="note">Inputs and corrections are kept in this browser for this model.</p><button class="btn light" data-act="reset">Reset all</button></div>`;
  return h;
}

function pageImages() {
  const m = S.model;
  if (!m) return head('Images', 'Two images, always with the same view and the same scale, so that projects can be compared.') + noModel();
  const o = S.state.images, pkey = 'p' + o.colour + o.storeys + o.detail;
  // heavier lines for the small previews, the exported images keep their fine lines
  if (!S.prev || S.prevKey !== pkey) { S.prev = [pictograms(S.model, { ...o, weight: 1.8 }).list[0], ...pictograms(S.model, { ...o, weight: 3.2 }).list.slice(1)]; S.prevKey = pkey; }
  const p = S.prev;
  const pic = (x, cls) => `<div class="${cls}"><div class="im" role="img" aria-label="${x.label}">${x.svg}</div><span class="cap small dim">${x.label}</span></div>`;
  let h = head('Images', 'Two images, always with the same view and the same scale, so that projects can be compared.');
  h += block('Preview', `project ${esc(m.id)}`, `<div class="fill imgs">${pic(p[0], 'overview')}<div class="pictos">${p.slice(1).map((x) => pic(x, 'pic')).join('')}</div></div>`);
  const seg = (label, k, a, b) => `<div class="row"><span class="l">${label}</span><div class="seg">${[a, b].map(([v, t]) => `<button data-img="${k}" data-val="${v}" class="${o[k] === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>`;
  h += block('Settings', 'for all images', seg('Colour', 'colour', ['colour', 'Colour'], ['black', 'Black']) + seg('Storeys', 'storeys', ['shown', 'Shown'], ['hidden', 'Hidden']) + seg('Detail', 'detail', ['all', 'All elements'], ['main', 'Main runs']));
  return h;
}

function pageExport() {
  const m = S.model;
  if (!m) return head('Export', 'One download with the data, the images and a document with three pages.') + noModel();
  const vals = buildValues(m, S.state), rows = exportRows(vals);
  const empty = vals.filter((v) => v.level === 'required' && isEmpty(v.value)).length;
  const sel = S.out, n = Object.values(sel).filter(Boolean).length;
  let h = head('Export', 'One download with the data, the images and a document with three pages.');
  h += block('Document', 'services.html, 3 pages', `<div class="fill thumbs">${pages(docCtx()).map((p) => `<div class="thumb doc">${p}</div>`).join('')}</div>`);
  const item = (k, name, what) => `<div class="row"><button class="l" data-out="${k}">${chk(k === 'all' ? n === 4 : sel[k])}${name}</button><span class="v">${what}</span></div>`;
  h += block('Files', `${n} of 4 selected`,
    item('all', 'All files', `services-${esc(m.id)}.zip`) + item('csv', 'data.csv', `${rows.length} values with unit and source`) + item('json', 'data.json', 'the same values for scripts') +
    item('images', 'images/', `${FIELDS.length} images as SVG and PNG`) + item('html', 'services.html', '3 pages, opens in any browser'));
  h += `<div class="grid"><p class="note">${empty ? `${empty} required ${empty === 1 ? 'value is' : 'values are'} still empty. ${empty === 1 ? 'It is' : 'They are'} exported as n/a.` : 'All required values are filled in.'}</p><button class="btn" data-act="download"${n ? '' : ' disabled'}>Download</button></div>`;
  h += `<div class="grid"><p class="note">The document as PDF: choose Save as PDF in the print dialog.</p><button class="btn light" data-act="print">Print PDF</button></div>`;
  return h;
}

// ---- render, keeps the focused field focused
let page = 'files';
function render() {
  const a = document.activeElement, fk = a && a.dataset ? a.dataset.k : null;
  page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'files';
  document.querySelectorAll('header nav a').forEach((x) => x.classList.toggle('on', x.dataset.s === page));
  $('#main').innerHTML = { files: pageFiles, data: pageData, images: pageImages, export: pageExport }[page]();
  if (fk) { const el = document.querySelector(`[data-k="${fk}"]`); if (el) el.focus(); }
  panel();
  scaleThumbs();
}
// The report sits in a fixed panel outside the page, so it is not reloaded when the page changes.
function panel() {
  const f = page === 'data' && S.report && S.files.includes(S.report) ? S.report : null, el = $('#panel');
  document.body.classList.toggle('split', !!f);
  if (!f) { el.hidden = true; return; }
  el.hidden = false;
  if (el.dataset.url !== f.url) {
    el.dataset.url = f.url;
    el.innerHTML = `<div class="bar"><span class="name">${esc(f.name)}</span><span class="tools"><button data-zoom="-1" aria-label="Smaller">−</button><button data-zoom="1" aria-label="Larger">+</button><button class="x" data-act="closereport" aria-label="Close the report">${X}</button></span></div><div class="find"><input id="q" data-search placeholder="Search the report" value="${esc(S.q)}"></div><div id="hits"></div><div id="pages"></div>`;
    hits(); view();
  }
}
function scaleThumbs() {
  document.querySelectorAll('.thumb').forEach((t) => { const s = t.querySelector('.sheet'); if (s) s.style.transform = `scale(${t.clientWidth / 1280})`; });
}
// A change re-renders after the current click, so a button pressed while leaving a field still works.
let pressing = false, dirty = false;
document.addEventListener('pointerdown', () => { pressing = true; }, true);
document.addEventListener('pointerup', () => setTimeout(() => { pressing = false; if (dirty) { dirty = false; render(); } }, 0), true);
const soon = () => setTimeout(() => { if (pressing) dirty = true; else render(); }, 0);

// ---- export
async function png(svg, vb) {
  const w = 2400, h = Math.round((w * vb.h) / vb.w);
  const url = URL.createObjectURL(new Blob([svg.replace('<svg ', `<svg width="${w}" height="${h}" `)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}
async function download() {
  const m = S.model, rows = exportRows(buildValues(m, S.state)), files = {};
  if (S.out.csv) files['data.csv'] = strToU8(toCSV(rows));
  if (S.out.json) files['data.json'] = strToU8(toJSON(rows, m));
  if (S.out.images) {
    const p = pics();
    for (const x of p.list) {
      const name = x.id === 'all' ? 'overview' : x.id;
      files[`images/${name}.svg`] = strToU8(x.svg);
      files[`images/${name}.png`] = await png(x.svg, p.viewBox);
    }
  }
  if (S.out.html) files['services.html'] = strToU8(documentHTML(docCtx()));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([zipSync(files)], { type: 'application/zip' }));
  a.download = `services-${m.id}.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function print() {
  $('#print').innerHTML = pages(docCtx()).join('');
  window.print();
}

// ---- events
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const st = S.state, d = t.dataset;
  if (d.act === 'choose') { if (VIDEO && PRE.size) videoDrop(); else $('#file').click(); }
  else if (d.act === 'addown') st.own.push({ label: '', value: '', unit: '' });
  else if (d.act === 'reset') { if (!confirm('Reset all inputs and corrections of this project?')) return; S.state = emptyState(); S.pics = null; }
  else if (d.act === 'download') { download(); return; }
  else if (d.act === 'print') { print(); return; }
  else if (d.act === 'closereport') { S.report = null; render(); return; }
  else if (d.report) { const f = S.files[+d.report]; S.report = S.report === f ? null : f; render(); return; }
  else if (d.rmfile) { drop(S.files[+d.rmfile]); render(); return; }
  else if (d.page) { goPage(+d.page); return; }
  else if (d.sug || d.sugshow) {
    const it = SUG.get(d.sug || d.sugshow); if (!it) return;
    if (d.sug) { st.inputs[it.key] = typeof it.c.value === 'number' ? String(it.c.value) : it.c.value; save(); }
    showFind(it.c); return;
  }
  else if (d.focus) { const el = document.querySelector(`[data-in="${d.focus}"]`); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); if (el.tagName === 'SELECT' && el.showPicker) try { el.showPicker(); } catch (x) {} } return; }
  else if (d.sugclear) delete st.inputs[d.sugclear];
  else if (d.zoom) { const n = current(), i = ZOOM.indexOf(S.zoom) + +d.zoom; if (i >= 0 && i < ZOOM.length) { S.zoom = ZOOM[i]; view(n); } return; }
  else if (d.editk) S.editing = d.editk;
  else if (d.reset) { delete st.edits[d.reset]; delete st.inputs[d.reset]; S.editing = null; }
  else if (d.opt) st.optional[d.opt] = st.optional[d.opt] === false;
  else if (d.rmown) st.own.splice(+d.rmown, 1);
  else if (d.img) st.images[d.img] = d.val;
  else if (d.out) { if (d.out === 'all') { const on = !Object.values(S.out).every(Boolean); for (const k in S.out) S.out[k] = on; } else S.out[d.out] = !S.out[d.out]; }
  else return;
  save(); render();
  if (d.editk) { const el = document.querySelector(`[data-edit="${d.editk}"]`); if (el) { el.focus(); el.select(); } context(d.editk); }
});
document.addEventListener('change', (e) => {
  const t = e.target, d = t.dataset, st = S.state;
  if (t.id === 'file') { addFiles([...t.files]); t.value = ''; return; }
  if (d.in) st.inputs[d.in] = t.value;
  else if (d.edit) { delete st.inputs[d.edit]; if (t.value.trim()) st.edits[d.edit] = t.value; else delete st.edits[d.edit]; S.editing = null; }
  else if (d.own) st.own[+d.own][d.f] = t.value;
  else return;
  save(); soon();
});
document.addEventListener('input', (e) => { if (e.target.dataset.search !== undefined) { S.q = e.target.value; S.qKey = null; hits(); } });
// Context search: a field of the report gets the focus, the panel searches for its term.
function context(k) {
  if (!k || !S.report || !CONTEXT[k] || S.qKey === k) return;
  S.q = CONTEXT[k]; S.qKey = k;
  const q = $('#q'); if (q) q.value = S.q;
  hits();
  const first = document.querySelector('#hits [data-page]'); // and shows the first hit right away
  if (first) goPage(+first.dataset.page);
}
document.addEventListener('focusin', (e) => context(e.target.dataset && (e.target.dataset.in || e.target.dataset.edit)));
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
let depth = 0;
const dropOn = (on) => { const el = document.querySelector('.drop'); if (el) el.classList.toggle('on', on); };
window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; dropOn(true); });
window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) dropOn(false); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); depth = 0; dropOn(false);
  if (location.hash.slice(1) !== 'files') location.hash = 'files';
  addFiles([...e.dataTransfer.files]);
});
window.addEventListener('hashchange', () => { S.editing = null; render(); window.scrollTo(0, 0); });
window.addEventListener('resize', scaleThumbs);

render();
if (new URLSearchParams(location.search).has('demo')) {
  const name = '26-06-MEP.ifc';
  fetch('./samples/' + name).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((buf) => addFile(name, buf.byteLength, async () => buf))
    .catch(() => { S.files.push({ name, kind: 'other', status: 'error' }); render(); });
}
if (VIDEO) {
  S.zoom = 3; document.body.classList.add('video'); // the report larger, so the marks can be seen in the recording
  CONTEXT.energy_limit = '41,2'; // in the video the search finds the value itself in the report
  const ifc = '26-06-MEP.ifc', pdf = '26-06-D-MEP-Anon.pdf', bufs = {};
  Promise.all([ifc, pdf].map((n) => fetch('./samples/' + n).then((r) => { if (!r.ok) throw new Error(n); return r.arrayBuffer(); }).then((b) => { bufs[n] = b; })))
    .then(async () => { PRE.set(ifc, analyze(WebIFC, await engine(), new Uint8Array(bufs[ifc]), ifc)); document.body.classList.add('ready'); })
    .catch((e) => console.error('video mode', e));
  window.videoDrop = () => {
    location.hash = 'files';
    addFile(ifc, bufs[ifc].byteLength, async () => bufs[ifc]);
    setTimeout(() => addFile(pdf, bufs[pdf].byteLength, async () => bufs[pdf].slice(0)), 250);
  };
  // a soft ring at every click, so the clicks can be followed in the recording
  document.addEventListener('pointerdown', (e) => {
    const r = document.createElement('i'); r.className = 'ring'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 600);
  });
}
window.SERVICES = S;

window.SERVICES_VERSION = 'f83b579';
