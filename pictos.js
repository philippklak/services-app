// Services, pictograms: isometric line drawings as SVG strings from the result of core.analyze.
// No DOM in here, runs in the browser and in Node. Same view and scale in every image of a project.
import { GROUPS } from './core.js?v=dea7d92';

// The overview and the eight fields of the grid, in reading order.
export const FIELDS = [
  { id: 'all', label: 'Overview' },
  { id: 'supply', label: 'Supply air' },
  { id: 'extract', label: 'Extract air' },
  { id: 'intake', label: 'Intake and exhaust' },
  { id: 'heating', label: 'Heating and cooling' },
  { id: 'water', label: 'Water' },
  { id: 'drainage', label: 'Drainage' },
  { id: 'fire', label: 'Sprinkler' },
  { id: 'equipment', label: 'Equipment' },
];
export const COLOR = { equipment: '#4a4f57' };
GROUPS.forEach((g) => (COLOR[g.id] = g.color));
const TRACE = '#d6d6d2', PLATE = '#c9c9c5';
// "main runs" keeps segments from this width
export const MAIN_WIDTH = 0.3;

const W = (w, on, all) => (on ? Math.min(0.3, Math.max(all ? 0.07 : 0.13, w * 0.34)) : Math.min(0.07, Math.max(0.05, w * 0.2)));
// Storeys are pulled apart (VY) so that the stacking of the levels reads clearly.
export const VY = 1.7;
const P = (p) => [(p[0] - p[2]) * 0.866, (p[0] + p[2]) * 0.5 - p[1] * VY];
const f = (n) => n.toFixed(2);
const line = (a, b, col, w) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${col}" stroke-width="${f(w)}" stroke-linecap="round"/>`;

// Fittings (bends, tees, reducers) carry no axis. They are drawn as short joints from every
// segment end that lies inside the fitting to its centre, so runs are closed without gaps.
const JOINTS = new WeakMap();
function joints(m) {
  if (JOINTS.has(m)) return JOINTS.get(m);
  const ends = [];
  for (const e of m.elements) if (e.seg) { ends.push({ p: e.seg.a, w: e.seg.w, g: e.group }); ends.push({ p: e.seg.b, w: e.seg.w, g: e.group }); }
  const out = new Map();
  for (const e of m.elements) {
    if (e.seg || e.proxy) continue;
    const pad = 0.2, c = [(e.min[0] + e.max[0]) / 2, (e.min[1] + e.max[1]) / 2, (e.min[2] + e.max[2]) / 2];
    const hit = ends.filter((q) => q.g === e.group && q.p[0] >= e.min[0] - pad && q.p[0] <= e.max[0] + pad && q.p[1] >= e.min[1] - pad && q.p[1] <= e.max[1] + pad && q.p[2] >= e.min[2] - pad && q.p[2] <= e.max[2] + pad);
    out.set(e, hit.map((q) => ({ a: q.p, b: c, w: q.w })));
  }
  JOINTS.set(m, out);
  return out;
}

// The view box depends only on the size of the model, never on the settings.
export function viewBox(m) {
  const S = m.size, c = [];
  for (const x of [0, S[0]]) for (const y of [0, S[1]]) for (const z of [0, S[2]]) c.push(P([x, y, z]));
  const minU = Math.min(...c.map((p) => p[0])) - 1, maxU = Math.max(...c.map((p) => p[0])) + 1;
  const minV = Math.min(...c.map((p) => p[1])) - 1, maxV = Math.max(...c.map((p) => p[1])) + 1;
  return { x: minU, y: minV, w: maxU - minU, h: maxV - minV, text: `${f(minU)} ${f(minV)} ${f(maxU - minU)} ${f(maxV - minV)}` };
}

function box(e, col, on) {
  const a = e.min, b = e.max, c = (x, y, z) => P([x, y, z]).map(f).join(',');
  const top = [c(a[0], b[1], a[2]), c(b[0], b[1], a[2]), c(b[0], b[1], b[2]), c(a[0], b[1], b[2])].join(' ');
  const front = [c(a[0], b[1], b[2]), c(b[0], b[1], b[2]), c(b[0], a[1], b[2]), c(a[0], a[1], b[2])].join(' ');
  const side = [c(b[0], b[1], a[2]), c(b[0], b[1], b[2]), c(b[0], a[1], b[2]), c(b[0], a[1], a[2])].join(' ');
  return [top, front, side].map((p) => `<polygon points="${p}" fill="#fff" stroke="${col}" stroke-width="${on ? 0.12 : 0.05}" stroke-linejoin="round"/>`).join('');
}

// One SVG. sel is a field id. opt: colour (colour, black), storeys (shown, hidden), detail (all, main).
export function draw(m, sel, opt = {}) {
  const black = opt.colour === 'black', main = opt.detail === 'main', all = sel === 'all';
  // weight makes the lines heavier for small previews on screen. Exports and the document use 1.
  const K = opt.weight || 1, KG = 1 + (K - 1) * 0.3;
  const J = joints(m), vb = viewBox(m), S = m.size;
  // Painter's order: level by level from the bottom, each with a translucent plate under its
  // elements, so an upper storey covers what lies below it.
  const plate = (l) => {
    const q = [[0, l.z, 0], [S[0], l.z, 0], [S[0], l.z, S[2]], [0, l.z, S[2]]].map(P).map((c) => f(c[0]) + ',' + f(c[1])).join(' ');
    return `<polygon points="${q}" fill="#e9e9e6" fill-opacity="0.12" stroke="${PLATE}" stroke-width="0.08"/>`;
  };
  const layers = m.levels.map(() => ({ grey: '', front: '' }));
  for (const e of m.elements) {
    const on = all || (sel === 'equipment' ? e.proxy : e.group === sel && !e.proxy);
    if (!on && all) continue;
    const col = on ? (black ? '#000' : COLOR[e.proxy ? 'equipment' : e.group] || '#000') : TRACE;
    let s = '';
    if (e.seg) {
      if (main && e.seg.w < MAIN_WIDTH) continue;
      s = line(P(e.seg.a), P(e.seg.b), col, W(e.seg.w, on, all) * (on ? K : KG));
    } else if (e.proxy) s = box(e, col, on && !all);
    else {
      for (const j of J.get(e) || []) if (!main || j.w >= MAIN_WIDTH) s += line(P(j.a), P(j.b), col, W(j.w, on, all) * (on ? K : KG));
      if (e.terminal && !main) {
        const a = e.min, b = e.max, y = b[1], c = (x, z) => P([x, y, z]).map(f).join(',');
        s += `<polygon points="${[c(a[0], a[2]), c(b[0], a[2]), c(b[0], b[2]), c(a[0], b[2])].join(' ')}" fill="${on ? col : '#fff'}" stroke="${col}" stroke-width="${on ? 0.06 : 0.04}"/>`;
      }
      if (!s) continue;
    }
    const L = layers[Math.min(layers.length - 1, e.level || 0)];
    if (on) L.front += s; else L.grey += s;
  }
  const body = m.levels.map((l, i) => (opt.storeys !== 'hidden' ? plate(l) : '') + layers[i].grey + layers[i].front).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.text}">${body}</svg>`;
}

// All nine images of a project with the same settings.
export function pictograms(m, opt = {}) {
  return { viewBox: viewBox(m), list: FIELDS.map((x) => ({ id: x.id, label: x.label, svg: draw(m, x.id, opt) })) };
}
