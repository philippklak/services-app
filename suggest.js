// Services, suggestions: values of the report found by rules, never by guessing. No DOM in here.
// Three readers work on the text of every page:
// 1. Sentences: numbers with the right unit get points for keywords near them and lose points for
//    words of a requirement ("below 41", "max. 1200 ppm"), because a report names the goal next to the result.
// 2. Tables: rows of a room name and the same count of numbers. The column is found by the order of the
//    column titles in the head. If the titles do not match the columns exactly, the table is not used.
//    The worst room is the highest value (CO₂, hours above 27 °C) or the lowest (time in category II).
// 3. Daylight: sentences that say whether the sDA300 requirement is met.
// The person always picks: every suggestion carries page and context, and nothing is filled in by itself.

// pdf.js splits numbers and units into pieces ("41 , 2", "pp m", "kW h/m 2"). They are joined first,
// all positions refer to this text.
export const clean = (t) => t
  .replace(/(\d)\s+([.,])\s*(\d)/g, '$1$2$3').replace(/(\d)([.,])\s+(\d)/g, '$1$2$3')
  .replace(/◦/g, '°').replace(/°\s+C\b/g, '°C').replace(/\bpp\s+m\b/g, 'ppm').replace(/\bkW\s+h\b/g, 'kWh')
  .replace(/\bCO\s+([2₂])/g, 'CO$1').replace(/\bm\s+([²2])(?![\d.,])/g, 'm$1');

const NUM = String.raw`(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)`;
// "1,219" can be 1219 or 1.219: the reading inside the range of the field wins, a decimal first.
export function readNum(s, min = -Infinity, max = Infinity) {
  const t = s.replace(/ /g, ''), opts = [];
  if (/^\d+[.,]\d+$/.test(t)) opts.push(Number(t.replace(',', '.')));
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) opts.push(Number(t.replace(/[.,]/g, '')));
  if (/^\d{1,3}([.,]\d{3})+[.,]\d+$/.test(t)) { const d = t.match(/[.,]\d+$/)[0]; opts.push(Number(t.slice(0, -d.length).replace(/[.,]/g, '') + '.' + d.slice(1))); }
  if (/^\d+$/.test(t)) opts.push(Number(t));
  return opts.find((n) => n >= min && n <= max) ?? null;
}

// Words of a requirement right before a number: the number is a goal, not a result.
const GOAL = /(below|under|less\s+than|lower\s+than|more\s+than|max(imum)?\.?|min(imum)?\.?|at\s+least|at\s+most|not\s+exceed\w*|exceed|limit(ed)?(\s+to)?|requirement\w*|required|must|should|shall|need\w*(\s+to)?(\s+be)?|target\w*|goal|criteri\w+|≤|<|>|≥|allowed|maks\.?|krav|grænse|up\s+to)\s*(of|is|be|to|:|=)?\s*$/i;

// A requirement a little further before, in the same sentence: "exceed the maximum CO₂ concentration of".
const GOAL2 = /\b(exceed\w*|limit\w*|requirement\w*|threshold|criteri\w*|target\w*|below|under|less\s+than|not\s+exceed)\b[^.]{0,40}$/i;

// Sentence rules. unit: the unit right after the number, scale: factor for the unit found.
const F = {
  energy_be18: {
    unit: String.raw`kWh\s*\/?\s*m\s*[²2]`, min: 3, max: 250,
    label: /(energy\s*frame|energiramme|\bbe\s*-?\s*18\b)/i,
    keys: [[/energy\s*frame|energiramme/i, 5], [/\bbe\s*-?\s*18\b/i, 4], [/primary\s*energy/i, 1.5], [/\bbr\s*-?\s*18\b/i, 1], [/calculated|result|achiev|total/i, 1]],
    minus: [[/district|electricity|lighting|cooling|heating|ventilation|fans|dhw|hot\s*water|equipment|pv|solar|existing|before|delivered|tenant/i, 2.5]],
  },
  energy_ida: {
    unit: String.raw`kWh\s*\/?\s*m\s*[²2]`, min: 3, max: 250,
    label: /(primary\s*energy[^\d]{0,6}\(?\s*simulat\w*\s*\)?)/i,
    keys: [[/\bida\b|ida\s*ice/i, 3], [/simulat/i, 3], [/primary\s*energy/i, 2]],
    minus: [[/district|electricity|lighting|cooling|heating|ventilation|fans|dhw|hot\s*water|equipment|pv|solar|existing|delivered|tenant|energy\s*frame/i, 2.5]],
  },
  heating_load: {
    unit: String.raw`(k?)W\s*\/\s*m\s*[²2](?!\s*·?\s*K)`, min: 3, max: 200, scale: (m) => (m[2] ? 1000 : 1),
    keys: [[/heat(ing)?\s*(load|capacity|demand|loss)|design\s*heat|varmetab|dimensioning/i, 5], [/peak|required|total|building/i, 1]],
    minus: [[/cool|lighting|light|equipment|people|occupant|solar|internal|fan|sfp|pump|radiator|room\s*unit|desk|zone|range/i, 4]],
  },
  co2_max: {
    unit: String.raw`ppm`, min: 350, max: 6000,
    keys: [[/co[2₂]/i, 3], [/max(imum)?|highest|peak|maks/i, 2], [/concentration|level/i, 1]],
    minus: [[/outdoor|outside|ambient|average|mean/i, 4]],
  },
  floor_area: {
    unit: String.raw`m[²2](?![\s·]*K)(?!\s*(per|\/))`, min: 300, max: 300000,
    keys: [[/heated\s*(gross\s*)?(floor\s*)?area|opvarmet|heated\s*area/i, 6], [/gross\s*(floor\s*)?area|\bgfa\b|\bbta\b|etageareal|floor\s*area|total\s*of|in\s*total|total\s*area/i, 3], [/building|floors/i, 1]],
    minus: [[/room|zone|office|meeting|toilet|roof|facade|façade|window|glazing|wall|plot|site|pv|solar|panel|occupied|basement|technical|typical/i, 3]],
  },
};

// Table columns: a title in the head of a table. Every title in the head must be one of these.
const COLS = [
  ['tmin', /min(imum)?\.?\s*(op(erative)?\.?\s*)?temp/i],
  ['tmax', /(max(imum)?|maks)\.?\s*(op(erative)?\.?\s*)?temp/i],
  ['tavg', /(avg|average|mean)\.?\s*(op(erative)?\.?\s*)?temp/i],
  ['h26', /(hours?|h|timer)(\s*of\s*t_?op)?\s*(≥|>|above|over)\s*26(\s*°?C)?|(hours?|h|timer)\s*26\s*°?C/i],
  ['h27', /(hours?|h|timer)(\s*of\s*t_?op)?\s*(≥|>|above|over)\s*27(\s*°?C)?|(hours?|h|timer)\s*27\s*°?C/i],
  ['h28', /(hours?|h|timer)(\s*of\s*t_?op)?\s*(≥|>|above|over)\s*28(\s*°?C)?|(hours?|h|timer)\s*28\s*°?C/i],
  ['co2', /((max|maks|average|avg|mean)\.?\s*)?CO[2₂]/i],
  ['cat2', /(time|share)?\s*(≥|in|within)?\s*cat(egory)?\.?\s*(ii|2)\b/i],
];
const TABLE = { hours_above_27: ['h27', 'max', 0, 8760], co2_max: ['co2', 'max', 350, 6000], time_in_category_2: ['cat2', 'min', 0, 100] };

export function tables(txt, debug) {
  // tokens with their position; numbers are tokens that are only a number
  const toks = [...txt.matchAll(/\S+/g)].map((m) => ({ s: m[0], at: m.index, n: /^\d+(?:[.,]\d+)?$/.test(m[0]) ? m[0] : null }));
  const runs = [];
  for (let i = 0; i < toks.length;) {
    if (!toks[i].n) { i++; continue; }
    let j = i; while (j < toks.length && toks[j].n) j++;
    runs.push({ from: i, to: j, k: j - i });
    i = j;
  }
  const out = [];
  for (let r = 0; r < runs.length; r++) {
    const k = runs[r].k;
    if (k < 2) continue;
    // rows: runs of the same length, names of 1 to 10 tokens in between (short runs belong to names)
    const rows = [runs[r]];
    let last = runs[r];
    for (let q = r + 1; q < runs.length; q++) {
      const gap = runs[q].from - last.to;
      if (runs[q].k === k && gap >= 1 && gap <= 10) { rows.push(runs[q]); last = runs[q]; continue; }
      if (runs[q].k < k && runs[q].k <= 2 && runs[q].from - last.to <= 10) continue; // a number inside a name ("Office x 3")
      break;
    }
    if (rows.length < 3) continue;
    // head: from the last "Zone" or "Room" (or the end of the sentence) to the first row, without the first row name
    const nameStart = Math.max(r > 0 ? runs[r - 1].to : 0, rows[0].from - 10);
    const headTo = toks[rows[0].from].at;
    const head0 = txt.slice(Math.max(0, headTo - 420), headTo);
    // the head starts after the last column word "Zone" or "Room" (capital, room names are small),
    // else after the end of a sentence (not after "Min." or "Op."), else 220 characters before
    const word = [...head0.matchAll(/\b(Zones?|Rooms?|Spaces?|Rum|Lokale)\b/g)].pop();
    const stop = [...head0.matchAll(/(?<!\b(Min|Max|Maks|Op|Cat|Temp|No|Nr|approx|Fig|Tab|Avg|vol))[.:]\s+(?=[A-Z])/g)].pop();
    const z = word ? word.index + word[0].length : stop ? stop.index + stop[0].length : Math.max(0, head0.length - 220);
    const head = head0.slice(z);
    // titles in order of their place in the head
    const found = [];
    for (const [id, re] of COLS) for (const m of head.matchAll(new RegExp(re.source, 'gi'))) found.push({ id, at: m.index, end: m.index + m[0].length });
    found.sort((a, b) => a.at - b.at || b.end - a.end);
    const titles = [];
    for (const f of found) if (!titles.length || f.at >= titles[titles.length - 1].end) titles.push(f);
    // the name of the first row may sit at the end of the head
    if (debug) debug.push({ k, rows: rows.length, head, titles: titles.map((t) => t.id) });
    if (titles.length !== k) { r = r + rows.length - 1; continue; }
    out.push({ cols: titles.map((t) => t.id), rows: rows.map((w) => ({ name: toks.slice(Math.max(w.from - 6, 0), w.from).map((t) => t.s).join(' '), cells: toks.slice(w.from, w.to) })) });
    r = r + rows.length - 1;
  }
  return out;
}

function fromTables(pages, key) {
  const t = TABLE[key];
  if (!t) return [];
  const [col, pick, min, max] = t, out = [];
  pages.forEach((raw, pi) => {
    const txt = clean(raw);
    for (const tb of tables(txt)) {
      const c = tb.cols.indexOf(col);
      if (c < 0) continue;
      const vals = tb.rows.map((r) => ({ v: readNum(r.cells[c].n, min, max), cell: r.cells[c], name: r.name })).filter((x) => x.v !== null);
      if (vals.length < 3) continue;
      const best = vals.reduce((a, b) => ((pick === 'max' ? b.v > a.v : b.v < a.v) ? b : a));
      out.push({ value: best.v, page: pi + 1, score: 7 + Math.min(tb.rows.length, 30) / 10, goal: false, at: best.cell.at, len: best.cell.s.length, text: txt, kind: 'table', rows: vals.length });
    }
  });
  return out;
}

const before = (t, i, n) => t.slice(Math.max(0, i - n), i);
const after = (t, i, n) => t.slice(i, i + n);
// Points for a keyword: more when it is close before the number, less after it.
function points(txt, i, end, rules, near) {
  let p = 0;
  const b = before(txt, i, near), a = after(txt, end, 40);
  for (const [re, w] of rules) {
    const g = new RegExp(re.source, 'gi');
    let best = 0;
    for (const m of b.matchAll(g)) best = Math.max(best, w * (0.4 + 0.6 * (m.index + m[0].length) / b.length));
    for (const m of a.matchAll(g)) best = Math.max(best, w * 0.5 * (1 - m.index / a.length));
    p += best;
  }
  return p;
}

function fromText(pages, key) {
  const f = F[key];
  if (!f) return [];
  const out = [];
  pages.forEach((raw, pi) => {
    const txt = clean(raw);
    for (const m of txt.matchAll(new RegExp(NUM + String.raw`\s*` + f.unit, 'gi'))) {
      const sc = f.scale ? f.scale(m) : 1;
      let v = readNum(m[1], f.min / sc, f.max / sc);
      if (v === null) continue;
      v = Math.round(v * sc * 1000) / 1000;
      const i = m.index, end = i + m[0].length;
      if (/[\d.,:\-]$/.test(before(txt, i, 1))) continue; // part of a longer number or a norm ("16798-1:2019")
      let score = points(txt, i, end, f.keys, 140) - points(txt, i, end, f.minus || [], 50);
      const goal = GOAL.test(before(txt, i, 40)) || GOAL2.test(before(txt, i, 45));
      if (goal) score -= 6;
      if (/(\/|per)\s*$/i.test(before(txt, i, 5))) score -= 4;
      out.push({ value: v, page: pi + 1, score, goal, at: i, len: m[0].length, text: txt, kind: 'text' });
    }
    // a row of a table: the label, then the number, the unit only in the head ("Value (kWh/m2)")
    if (f.label) for (const m of txt.matchAll(new RegExp(f.label.source + String.raw`\)?\s*:?\s*` + NUM + String.raw`(?!\s*[%\d]|\s*k?W)`, 'gi'))) {
      const num = m[m.length - 1], i = m.index + m[0].lastIndexOf(num);
      if (!new RegExp(f.unit, 'i').test(before(txt, m.index, 250))) continue;
      const v = readNum(num, f.min, f.max);
      if (v === null || GOAL.test(before(txt, m.index, 30))) continue;
      out.push({ value: v, page: pi + 1, score: 5.5, goal: false, at: i, len: num.length, text: txt, kind: 'row' });
    }
  });
  return out;
}

const view = (c) => ({
  value: c.value, page: c.page, score: Math.round(c.score * 10) / 10, kind: c.kind, goal: c.goal,
  before: c.text.slice(Math.max(0, c.at - 80), c.at), match: c.text.slice(c.at, c.at + c.len), after: c.text.slice(c.at + c.len, c.at + c.len + 60),
});
function rank(list) {
  const by = new Map();
  for (const c of list) { const o = by.get(c.value); if (!o || c.score > o.score) by.set(c.value, c); }
  return [...by.values()].sort((a, b) => b.score - a.score).map(view);
}

export function suggest(pages, key) {
  if (key === 'daylight_sda300') return daylight(pages);
  return rank([...fromText(pages, key), ...fromTables(pages, key)]);
}

// Sentences with their start: a stop is a . ! or ? followed by a space and a capital letter or a digit
// heading, so "63.3 %", "Max. CO2" and "sDA300/50%." stay inside the sentence.
function sentences(txt) {
  const out = [];
  let from = 0;
  for (const m of txt.matchAll(/[.!?]\s+(?=[A-Z])/g)) {
    if (/\b(Min|Max|Maks|Op|Cat|No|Nr|Fig|Tab|approx|e\.g|i\.e|vol)$/i.test(txt.slice(Math.max(0, m.index - 6), m.index))) continue;
    out.push(Object.assign([txt.slice(from, m.index + 1)], { index: from }));
    from = m.index + m[0].length;
  }
  out.push(Object.assign([txt.slice(from)], { index: from }));
  return out;
}

// Daylight: only statements, not intentions. A sentence counts when it says that the sDA300 or daylight
// requirement is met or not, or when it gives an average sDA in percent (50 % or more is met).
// Sentences that only aim, ensure or assess, and flattened tables (long "sentences"), do not count.
export function daylight(pages) {
  const out = [];
  pages.forEach((raw, pi) => {
    const txt = clean(raw);
    for (const m of txt.matchAll(new RegExp(String.raw`\b(average|overall|mean)\b[^!?]{0,80}?\b(is|of|=|:|reaches|achieves)\s*` + NUM + String.raw`\s*%`, 'gi'))) {
      if (!/sda|spatial\s*daylight/i.test(m[0])) continue;
      const v = readNum(m[m.length - 1], 0, 100);
      if (v === null) continue;
      out.push({ value: v >= 50 ? 'met' : 'not met', page: pi + 1, score: 7, goal: false, at: m.index, len: m[0].length, text: txt, kind: 'text' });
    }
    for (const s of sentences(txt)) {
      const t = s[0].trim();
      if (t.length > 300 || !/sda|daylight\w*\s*(requirement|target|availability|autonomy|criteri|level)|300\s*lux/i.test(t)) continue;
      if (/\b(should|must|shall|has\s+to|needs?\s+to|aims?|ensure|assess(es)?|in\s+order\s+to|to\s+(meet|achieve|ensure|fulfil)|goal|purpose|if\b|would)\b/i.test(t)) continue;
      const yes = /\b(meets?|met|satisf\w*|compl(y|ies|ied|iance)|fulfil\w*|exceeds?)\b/i.test(t) && /requirement|target|criteri|50\s*%|sda/i.test(t);
      const no = /\b(not|fails?|failed|unable|n't|insufficient)\b|below\s+50\s*%|less\s+than\s+50\s*%/i.test(t);
      if (!yes && !no) continue;
      let score = 4 + (/\b(all|every|average|overall|whole|entire)\b/i.test(t) ? 3 : 0);
      if (/\b(zone|room|level|floor|area)\b/i.test(t) && !/\b(all|every)\b/i.test(t)) score -= 1.5;
      out.push({ value: no ? 'not met' : 'met', page: pi + 1, score, goal: false, at: s.index + (s[0].length - s[0].trimStart().length), len: t.length, text: txt, kind: 'text' });
    }
  });
  out.sort((a, b) => b.score - a.score);
  return out.map((c) => ({ ...view(c), before: '', after: '' }));
}

export const SUGGEST_KEYS = ['energy_be18', 'energy_ida', 'daylight_sda300', 'heating_load', 'hours_above_27', 'time_in_category_2', 'co2_max', 'floor_area'];
const MIN = { daylight_sda300: 4 };

// At most three suggestions per field, without goals and without weak finds. The daylight suggestion
// is only offered when the best sentences agree. IDA is dropped when its best number is the result by
// regulation, because then the report names only one figure.
export function suggestAll(pages) {
  const res = {};
  for (const k of SUGGEST_KEYS) {
    let list = suggest(pages, k).filter((c) => !c.goal && c.score >= (MIN[k] || 3));
    if (k === 'daylight_sda300' && list.length) {
      const top = list[0].score, rival = list.find((c) => c.value !== list[0].value);
      if (rival && rival.score >= top - 1) list = [];
      else list = list.filter((c) => c.value === list[0].value);
    }
    res[k] = list.slice(0, 3);
  }
  const b = res.energy_be18[0];
  if (b) res.energy_ida = res.energy_ida.filter((c) => c.value !== b.value);
  return res;
}
