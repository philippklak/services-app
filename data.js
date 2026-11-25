// Services, data: the values of one project and their export as CSV and JSON. No DOM in here.
// Every value has key, label, value, unit, level (required, optional, own), source (model, report, manual)
// and model_value when a model value was corrected. Empty values are exported as n/a, never estimated.
import { fmt } from './core.js?v=2d095b3';
import { FIELDS } from './pictos.js?v=2d095b3';

export const LABEL = Object.fromEntries(FIELDS.map((f) => [f.id, f.label]));

// kind: input (typed in), choice (one of options), model (read from the model, can be corrected)
export const REQUIRED = [
  { key: 'energy_limit', label: 'Primary energy, BR18 limit', unit: 'kWh/m² a', kind: 'input' },
  { key: 'energy_be18', label: 'Result by regulation, BE18', unit: 'kWh/m² a', kind: 'input' },
  { key: 'energy_ida', label: 'Simulated, IDA ICE', unit: 'kWh/m² a', kind: 'input' },
  { key: 'daylight_sda300', label: 'Daylight sDA300 above 50 %', unit: '', kind: 'choice', options: ['met', 'not met'] },
  { key: 'heating_load', label: 'Heating load', unit: 'W/m²', kind: 'input' },
  { key: 'hours_above_27', label: 'Indoor climate, hours above 27 °C, worst room', unit: 'h', kind: 'input' },
  { key: 'time_in_category_2', label: 'Indoor climate, time in comfort category II, worst room', unit: '%', kind: 'input' },
  { key: 'co2_max', label: 'CO₂ max, worst room', unit: 'ppm', kind: 'input' },
  { key: 'floor_area', label: 'Floor area', unit: 'm²', kind: 'input' },
  { key: 'system_kinds', label: 'Service systems', unit: 'kinds', kind: 'model' },
  { key: 'length_per_m2', label: 'Ducts and pipes per m²', unit: 'm/m²', kind: 'model', dec: 3, needs: 'floor_area' },
  { key: 'volume_per_m2', label: 'Volume of ducts and pipes per m²', unit: 'm³/m²', kind: 'model', dec: 4, needs: 'floor_area' },
  { key: 'risers_per_storey', label: 'Risers per storey', unit: 'count per storey', kind: 'model' },
];
export const OPTIONAL = [
  { key: 'component_count', label: 'Number of components', unit: 'elements', kind: 'model' },
  { key: 'volume_total', label: 'Volume of ducts and pipes', unit: 'm³', kind: 'model', dec: 1 },
  { key: 'length_per_system', label: 'Length of ducts and pipes, all systems', unit: 'm', kind: 'model' },
];
export const RISER_NOTE = 'Approximation: vertical segments from 2.5 m, counted on every storey level they cross, the same position rounded to 1 m counts once.';

export const emptyState = () => ({ inputs: {}, edits: {}, optional: {}, own: [], images: { colour: 'colour', storeys: 'shown', detail: 'all' } });

// "41,2" and "41.2" both become 41.2. Anything that is not a plain number stays text.
export function parse(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t) return null;
  const n = t.replace(/\s/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : t;
}
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Storeys shown in the images and counted for risers: levels with at least 10 elements.
export const usedLevels = (m) => m.levels.filter((l) => l.n >= 10);

// Risers: vertical segments from 2.5 m. A riser counts on a storey when it crosses the plane
// 1 m above that storey level. Segments at the same plan position (1 m grid) count once.
export function risers(m) {
  const ris = m.elements.filter((e) => e.seg && e.vertical && e.seg.len >= 2.5);
  return usedLevels(m).map((l) => {
    const seen = new Set(), y = l.z + 1;
    for (const e of ris) {
      const lo = Math.min(e.seg.a[1], e.seg.b[1]), hi = Math.max(e.seg.a[1], e.seg.b[1]);
      if (lo <= y && hi >= y) seen.add(Math.round((e.seg.a[0] + e.seg.b[0]) / 2) + '/' + Math.round((e.seg.a[2] + e.seg.b[2]) / 2));
    }
    return { storey: l.name, count: seen.size };
  });
}

// What the model says, before any correction. floor is the floor area in m² or null.
function fromModel(m, key, floor) {
  const used = m.groups.filter((g) => g.count && g.id !== 'other');
  const len = m.ducts + m.pipes;
  switch (key) {
    case 'system_kinds': return { value: used.length, note: used.map((g) => LABEL[g.id]).join(', ') };
    case 'length_per_m2': return { value: floor ? round(len / floor, 3) : null };
    case 'volume_per_m2': return { value: floor ? round(m.volume / floor, 4) : null };
    case 'risers_per_storey': { const r = risers(m); return { value: r.map((x) => x.count).join(', '), note: RISER_NOTE + ' Storeys from the lowest: ' + r.map((x) => x.storey).join(', ') + '.' }; }
    case 'component_count': {
      const el = m.elements, segs = el.filter((e) => e.seg);
      const fit = el.filter((e) => !e.seg && !e.proxy && !e.terminal).length;
      return { value: el.length, note: `duct segments ${segs.filter((e) => e.duct).length}, pipe segments ${segs.filter((e) => e.pipe).length}, fittings ${fit}, air terminals ${m.terminals}, equipment ${m.proxies}` };
    }
    case 'volume_total': return { value: round(m.volume, 1) };
    case 'length_per_system': return { value: round(len, 1), note: used.map((g) => LABEL[g.id] + ' ' + round(g.len, 1) + ' m').join(', ') };
  }
  return { value: null };
}

// All values of the project for the page Data and the export. state holds what was typed in.
export function buildValues(m, state) {
  const st = { ...emptyState(), ...state };
  const floor = parse(st.inputs.floor_area);
  const area = typeof floor === 'number' && floor > 0 ? floor : null;
  const make = (d, level) => {
    const v = { key: d.key, label: d.label, value: null, unit: d.unit, level, source: 'manual', model_value: null, note: '', def: d };
    if (d.kind === 'model') {
      const mv = fromModel(m, d.key, area);
      v.note = mv.note || '';
      v.model = mv.value;
      const ed = st.edits[d.key];
      if (ed !== undefined && ed !== null && String(ed).trim() !== '') { v.value = parse(ed); v.source = 'manual'; v.model_value = mv.value; }
      else { v.value = mv.value; v.source = 'model'; }
    } else v.value = parse(st.inputs[d.key]);
    if (level === 'optional') v.selected = st.optional[d.key] !== false;
    return v;
  };
  const out = [...REQUIRED.map((d) => make(d, 'required')), ...OPTIONAL.map((d) => make(d, 'optional'))];
  st.own.forEach((o, i) => {
    const slug = String(o.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    out.push({ key: 'own_' + (slug || i + 1), label: o.label || '', value: parse(o.value), unit: o.unit || '', level: 'own', source: 'manual', model_value: null, note: '', index: i });
  });
  return out;
}

export const isEmpty = (v) => v === null || v === undefined || v === '';

// Text shown on the pages, numbers with thousands separator.
export function display(v) {
  if (isEmpty(v.value)) return '';
  if (typeof v.value === 'number') return fmt(v.value, v.def && v.def.dec !== undefined ? v.def.dec : (Number.isInteger(v.value) ? 0 : 1));
  return String(v.value);
}

// Values that go into the export: required, selected optional, own. Only the eight export fields.
export function exportRows(values) {
  return values.filter((v) => v.level !== 'optional' || v.selected).map((v) => ({
    key: v.key, label: v.label, value: isEmpty(v.value) ? 'n/a' : v.value, unit: v.unit, level: v.level, source: v.source,
    model_value: v.source === 'manual' && !isEmpty(v.model_value) ? v.model_value : '', note: v.note || '',
  }));
}

const COLS = ['key', 'label', 'value', 'unit', 'level', 'source', 'model_value', 'note'];
const cell = (x) => { const s = String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toCSV = (rows) => [COLS.join(','), ...rows.map((r) => COLS.map((c) => cell(r[c])).join(','))].join('\n') + '\n';

export function toJSON(rows, m) {
  return JSON.stringify({ project: m.id, file: m.file, values: rows.map((r) => ({ ...r, model_value: r.model_value === '' ? undefined : r.model_value, note: r.note || undefined })) }, null, 2);
}
