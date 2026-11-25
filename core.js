// MEP Standard, core: reads one IFC with web-ifc and returns everything the lenses need.
// No drawing in here. Rules and palette are the same as in pipeline/extract.py and render.py.
// Axes: x and z are the plan, y is up, all in metres.

export const RULES = [
  ['INTAKE', ['fresh air', '(indt)', 'indtag', 'outdoor air', 'outside air']],
  ['EXHAUST', ['exhaust', '(afk)', 'afkast']],
  ['SUPPLY', ['supply air', '(vi)', 'indblæs', 'ventilation, supply']],
  ['EXTRACT', ['return air', '(vu)', 'udsug', 'extract', 'ventilation, return']],
  ['COOLING', ['køling', 'koeling', 'cooling', 'chilled']],
  ['DHW', ['brugsvand, varmt', 'brugsvand_(#1)_varmt', 'hot water', 'varmt']],
  ['DCW', ['brugsvand, koldt', 'brugsvand_(#1)_koldt', 'cold water', 'koldt']],
  ['HEATING', ['varme', 'heating', 'gulvvarme', 'hydronic']],
  ['DRAINAGE', ['afløb', 'spildevand', 'sanitar', 'sewage', 'waste', 'vent', 'regnvand', 'drain']],
  ['FIRE', ['sprinkler', 'brand', 'fire']],
];

// One entry per system group shown to people. The order is the reading order everywhere.
export const GROUPS = [
  { id: 'supply', label: 'Supply air', cats: ['SUPPLY'], color: '#2a78d6', air: true },
  { id: 'extract', label: 'Extract air', cats: ['EXTRACT'], color: '#eda100', air: true },
  { id: 'intake', label: 'Intake, exhaust', cats: ['INTAKE', 'EXHAUST'], color: '#4a3aa7', air: true },
  { id: 'heating', label: 'Heating, cooling', cats: ['HEATING', 'COOLING'], color: '#e34948' },
  { id: 'water', label: 'Water', cats: ['DCW', 'DHW'], color: '#008300' },
  { id: 'drainage', label: 'Drainage', cats: ['DRAINAGE'], color: '#9c5a1a' },
  { id: 'fire', label: 'Sprinkler', cats: ['FIRE'], color: '#b0127a' },
  { id: 'other', label: 'Not assigned', cats: ['OTHER'], color: '#9a9d9f' },
];
const GROUP_OF = {};
GROUPS.forEach((g) => g.cats.forEach((c) => (GROUP_OF[c] = g.id)));
const IS_AIR = {};
GROUPS.forEach((g) => (IS_AIR[g.id] = !!g.air));

const MEP_TYPE = /FLOW|DUCT|PIPE|DISTRIBUTION|PROXY|TERMINAL|VALVE|PUMP|FAN|COIL|BOILER|CHILLER|TANK|UNITARY|DAMPER|FILTER|HEATEXCHANGER|HEATRECOVERY|SPACEHEATER|SANITARY|FIRESUPPRESSION|WASTE|INTERCEPTOR|STACK|COOLING|TUBE|HUMIDIFIER|EVAPORAT|CONDENSER|COMPRESSOR|BURNER|ENERGYCONVERSION|CONTROLLER|TREATMENT|STORAGE|MOVINGDEVICE|FITTING|SEGMENT|CHAMBER/;

export function classify(name) {
  const n = (name || '').toLowerCase();
  for (const [cat, keys] of RULES) if (keys.some((k) => n.includes(k))) return cat;
  return null;
}

const val = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const near = (a, b) => Math.abs(a - b) <= 0.02 * Math.max(a, b, 1e-6);

export function analyze(WebIFC, api, bytes, fileName) {
  const t0 = Date.now();
  const id = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  const ids = (type) => {
    const v = api.GetLineIDsWithType(id, type);
    const out = [];
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  };

  // 1. systems: element -> category through IfcRelAssignsToGroup
  const catOf = new Map();
  const systems = new Map();
  for (const rid of ids(WebIFC.IFCRELASSIGNSTOGROUP)) {
    const rel = api.GetLine(id, rid);
    const gid = val(rel.RelatingGroup);
    if (!gid) continue;
    let sys = systems.get(gid);
    if (!sys) {
      let nm = '';
      try { const g = api.GetLine(id, gid); nm = [val(g.Name), val(g.LongName), val(g.ObjectType)].filter(Boolean).join(' '); } catch (e) {}
      sys = { name: nm, cat: classify(nm), n: 0 };
      systems.set(gid, sys);
    }
    for (const o of rel.RelatedObjects || []) {
      sys.n++;
      if (sys.cat && !catOf.has(val(o))) catOf.set(val(o), sys.cat);
    }
  }

  // 2. storeys
  const storeys = ids(WebIFC.IFCBUILDINGSTOREY).map((sid) => {
    const s = api.GetLine(id, sid);
    return { name: String(val(s.Name) || ''), elevation: Number(val(s.Elevation)) || 0 };
  }).sort((a, b) => a.elevation - b.elevation);

  // 3. geometry, once through all meshes
  const typeName = new Map();
  const nameOf = (code) => {
    if (!typeName.has(code)) { let n = String(code); try { n = api.GetNameFromTypeCode(code); } catch (e) {} typeName.set(code, String(n).toUpperCase()); }
    return typeName.get(code);
  };
  const all = [];
  api.StreamAllMeshes(id, (mesh) => {
    const eid = mesh.expressID;
    const type = nameOf(api.GetLineType(id, eid));
    if (!MEP_TYPE.test(type)) return;
    const cat = catOf.get(eid) || 'OTHER';
    const pos = [], idx = [];
    let nV = 0, seg = null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const geoms = mesh.geometries;
    for (let i = 0; i < geoms.size(); i++) {
      const pg = geoms.get(i);
      const geo = api.GetGeometry(id, pg.geometryExpressID);
      const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
      const ix = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
      const m = pg.flatTransformation;
      const lmin = [Infinity, Infinity, Infinity], lmax = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < v.length; k += 6) {
        const x = v[k], y = v[k + 1], z = v[k + 2];
        if (x < lmin[0]) lmin[0] = x; if (x > lmax[0]) lmax[0] = x;
        if (y < lmin[1]) lmin[1] = y; if (y > lmax[1]) lmax[1] = y;
        if (z < lmin[2]) lmin[2] = z; if (z > lmax[2]) lmax[2] = z;
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        pos.push(wx, wy, wz);
        if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
        if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
        if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
      }
      for (let k = 0; k < ix.length; k++) idx.push(nV + ix[k]);
      nV += v.length / 6;
      if (i === 0 && v.length) {
        // length axis of a segment: the odd one out for round sections, else the longest side
        const sc = [Math.hypot(m[0], m[1], m[2]) || 1, Math.hypot(m[4], m[5], m[6]) || 1, Math.hypot(m[8], m[9], m[10]) || 1];
        const e = [(lmax[0] - lmin[0]) * sc[0], (lmax[1] - lmin[1]) * sc[1], (lmax[2] - lmin[2]) * sc[2]];
        let ax = e.indexOf(Math.max(...e)), round = false;
        if (near(e[0], e[1])) { ax = 2; round = true; } else if (near(e[0], e[2])) { ax = 1; round = true; } else if (near(e[1], e[2])) { ax = 0; round = true; }
        const o = [0, 1, 2].filter((a) => a !== ax);
        const c = [(lmin[0] + lmax[0]) / 2, (lmin[1] + lmax[1]) / 2, (lmin[2] + lmax[2]) / 2];
        const cw = [m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12], m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13], m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14]];
        const d = [m[ax * 4] / sc[ax], m[ax * 4 + 1] / sc[ax], m[ax * 4 + 2] / sc[ax]];
        const h = e[ax] / 2;
        seg = { len: e[ax], w: Math.max(e[o[0]], e[o[1]]), area: round ? Math.PI * e[o[0]] * e[o[1]] / 4 : e[o[0]] * e[o[1]],
          a: [cw[0] - d[0] * h, cw[1] - d[1] * h, cw[2] - d[2] * h], b: [cw[0] + d[0] * h, cw[1] + d[1] * h, cw[2] + d[2] * h] };
      }
      geo.delete && geo.delete();
    }
    if (!nV) return;
    const isSeg = type.includes('SEGMENT');
    const group = GROUP_OF[cat];
    const isPipe = isSeg && (type.includes('PIPE') || (type === 'IFCFLOWSEGMENT' && !IS_AIR[group]));
    all.push({ id: eid, type, cat, group, pos, idx, min, max, seg: isSeg ? seg : null, pipe: isPipe, duct: isSeg && !isPipe,
      proxy: type.includes('PROXY'), terminal: type === 'IFCAIRTERMINAL' });
  });
  let schema = '';
  try { schema = String(api.GetModelSchema(id)); } catch (e) {}
  api.CloseModel(id);

  // 4. stray elements far outside the building are counted and left out (as in extract.py)
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(f * arr.length)))];
  const lim = (k) => {
    const c = all.map((e) => (e.min[k] + e.max[k]) / 2).sort((a, b) => a - b);
    const lo = q(c, 0.02), hi = q(c, 0.98), pad = Math.max(10, (hi - lo) * 0.25);
    return [lo - pad, hi + pad];
  };
  const lx = all.length ? lim(0) : [0, 0], lz = all.length ? lim(2) : [0, 0];
  const elements = all.filter((e) => {
    const x = (e.min[0] + e.max[0]) / 2, z = (e.min[2] + e.max[2]) / 2;
    return x >= lx[0] && x <= lx[1] && z >= lz[0] && z <= lz[1];
  });
  const stray = all.length - elements.length;

  // 5. square the plan to the dominant duct direction (smallest rotation), then move to the origin
  let sx = 0, sy = 0;
  for (const e of elements) if (e.seg) {
    const dx = e.seg.b[0] - e.seg.a[0], dz = e.seg.b[2] - e.seg.a[2];
    const L = Math.hypot(dx, dz);
    if (L > 0.3) { const a4 = 4 * Math.atan2(dz, dx); sx += Math.cos(a4) * L; sy += Math.sin(a4) * L; }
  }
  const rot = Math.atan2(sy, sx) / 4;
  const cs = Math.cos(-rot), sn = Math.sin(-rot);
  const R = (p, o) => { const x = p[o], z = p[o + 2]; p[o] = x * cs - z * sn; p[o + 2] = x * sn + z * cs; };
  const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const e of elements) {
    e.min = [Infinity, Infinity, Infinity]; e.max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < e.pos.length; k += 3) {
      R(e.pos, k);
      for (let a = 0; a < 3; a++) { const v = e.pos[k + a]; if (v < e.min[a]) e.min[a] = v; if (v > e.max[a]) e.max[a] = v; }
    }
    if (e.seg) { R(e.seg.a, 0); R(e.seg.b, 0); }
    for (let a = 0; a < 3; a++) { if (e.min[a] < bb.min[a]) bb.min[a] = e.min[a]; if (e.max[a] > bb.max[a]) bb.max[a] = e.max[a]; }
  }
  const o = bb.min.slice();
  const groups = {};
  GROUPS.forEach((g) => (groups[g.id] = { pos: [], idx: [], n: 0, ductLen: 0, pipeLen: 0, volume: 0, count: 0 }));
  for (const e of elements) {
    const g = groups[e.group];
    for (let k = 0; k < e.pos.length; k += 3) g.pos.push(e.pos[k] - o[0], e.pos[k + 1] - o[1], e.pos[k + 2] - o[2]);
    for (let k = 0; k < e.idx.length; k++) g.idx.push(g.n + e.idx[k]);
    g.n += e.pos.length / 3;
    for (let a = 0; a < 3; a++) { e.min[a] -= o[a]; e.max[a] -= o[a]; if (e.seg) { e.seg.a[a] -= o[a]; e.seg.b[a] -= o[a]; } }
    if (e.seg) {
      if (e.duct) g.ductLen += e.seg.len; else g.pipeLen += e.seg.len;
      g.volume += e.seg.len * e.seg.area;
      e.vertical = Math.abs(e.seg.b[1] - e.seg.a[1]) > 0.7 * e.seg.len;
    }
    g.count++;
    delete e.pos; delete e.idx;
  }
  const size = [bb.max[0] - o[0], bb.max[1] - o[1], bb.max[2] - o[2]];

  // 6. levels in metres above the lowest storey. Storey elevations are in file units,
  // the geometry was moved so that its lowest point is 0, so levels are fitted to the elements.
  let levels = [];
  const ys = elements.map((e) => (e.min[1] + e.max[1]) / 2);
  if (storeys.length > 1) {
    const span = storeys[storeys.length - 1].elevation - storeys[0].elevation;
    const f = span > 200 ? 0.001 : 1;
    const raw = storeys.map((s) => ({ name: s.name, z: (s.elevation - storeys[0].elevation) * f }));
    // try offsets and keep the one that puts the most elements just below a storey line (ceiling zone)
    let best = 0, bestScore = -1;
    for (let off = -4; off <= 6; off += 0.05) {
      let score = 0;
      for (const y of ys) for (const s of raw) { const d = s.z + off - y; if (d > 0 && d < 1.2) { score++; break; } }
      if (score > bestScore) { bestScore = score; best = off; }
    }
    for (const s of raw) {
      const z = s.z + best;
      const prev = levels[levels.length - 1];
      if (prev && z - prev.z < 0.5) continue;
      levels.push({ name: s.name, z });
    }
  }
  if (!levels.length) levels = [{ name: 'Level', z: 0 }];
  levels.forEach((l) => (l.n = 0));
  for (const e of elements) {
    const y = (e.min[1] + e.max[1]) / 2;
    let li = 0;
    for (let i = 0; i < levels.length; i++) if (y >= levels[i].z - 0.05) li = i;
    e.level = li; levels[li].n++;
  }

  const out = {
    file: fileName, ms: Date.now() - t0, schema, storeys, elements, levels, stray, size, rotation: rot * 180 / Math.PI,
    systems: [...systems.values()],
    proxies: elements.filter((e) => e.proxy).length,
    unassigned: elements.filter((e) => e.cat === 'OTHER').length,
    terminals: elements.filter((e) => e.terminal).length,
    groups: GROUPS.map((g) => {
      const d = groups[g.id];
      return { ...g, count: d.count, ductLen: d.ductLen, pipeLen: d.pipeLen, len: d.ductLen + d.pipeLen, volume: d.volume,
        positions: new Float32Array(d.pos), indices: new Uint32Array(d.idx) };
    }),
  };
  out.ducts = out.groups.reduce((s, g) => s + g.ductLen, 0);
  out.pipes = out.groups.reduce((s, g) => s + g.pipeLen, 0);
  out.volume = out.groups.reduce((s, g) => s + g.volume, 0);
  const vert = elements.filter((e) => e.seg && e.vertical).reduce((s, e) => s + e.seg.len, 0);
  out.verticalShare = out.ducts + out.pipes > 0 ? vert / (out.ducts + out.pipes) : 0;
  out.id = (fileName.match(/\d\d-\d\d/) || [fileName.replace(/\.ifc$/i, '')])[0];
  return out;
}

export const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
