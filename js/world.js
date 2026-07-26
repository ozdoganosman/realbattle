// Dünya üretimi — tamamen deterministik (seed'den).
// Sunucu ve istemci aynı seed ile birebir aynı haritayı üretir.

export const W = 260, H = 160, S = 4;
export const PLAINS = 0, FOREST = 1, MOUNT = 2;

// arazi başına ilerleme maliyeti / hız çarpanı
export const TERRAIN = [
  { ad: 'Ova',    cost: 1.00, speed: 1.00 },
  { ad: 'Orman',  cost: 1.55, speed: 0.72 },
  { ad: 'Dağlık', cost: 2.60, speed: 0.48 },
];

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const idx = (x, y) => y * W + x;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const SYL_A = ['Kar', 'Val', 'Bur', 'Mor', 'Sal', 'Ered', 'Tir', 'Gor', 'Ash',
  'Bel', 'Dun', 'Ven', 'Rav', 'Ost', 'Wes', 'Cas', 'Nor', 'Alt', 'Sem', 'Kon'];
const SYL_B = ['ten', 'mar', 'gard', 'burg', 'holm', 'stad', 'vic', 'dor',
  'heim', 'grad', 'ova', 'kale', 'köy', 'port', 'field', 'mont', 'iye', 'hisar'];

function makeName(rnd) {
  return SYL_A[(rnd() * SYL_A.length) | 0] + SYL_B[(rnd() * SYL_B.length) | 0];
}

function blobField(rnd, nBlobs, rMin, rMax) {
  const f = new Float32Array(W * H);
  const rand = (a, b) => a + rnd() * (b - a);
  for (let b = 0; b < nBlobs; b++) {
    const cx = rand(W * 0.06, W * 0.94), cy = rand(H * 0.06, H * 0.94);
    const r = rand(rMin, rMax), amp = rand(0.5, 1), r2 = r * r * 0.5;
    const x0 = Math.max(0, (cx - r * 2.2) | 0), x1 = Math.min(W - 1, (cx + r * 2.2) | 0);
    const y0 = Math.max(0, (cy - r * 2.2) | 0), y1 = Math.min(H - 1, (cy + r * 2.2) | 0);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      f[idx(x, y)] += amp * Math.exp(-d2 / r2);
    }
  }
  return f;
}

function quantile(field, mask, frac) {
  const vals = [];
  for (let i = 0; i < field.length; i++) if (!mask || mask[i]) vals.push(field[i]);
  vals.sort((a, b) => b - a);
  return vals[clamp((vals.length * frac) | 0, 0, vals.length - 1)];
}

export function createWorld(seed, opts = {}) {
  const rnd = mulberry32(seed);
  const landFrac = opts.landFrac ?? 0.55;
  const nRegions = opts.regions ?? 210;

  const isLand = new Uint8Array(W * H);
  const terrain = new Uint8Array(W * H);
  const elev = blobField(rnd, 120, 8, 30);

  // kenarlara doğru yumuşak düşüş → kıta denizle çevrili olsun
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ex = clamp(Math.min(x, W - 1 - x) / (W * 0.13), 0, 1);
    const ey = clamp(Math.min(y, H - 1 - y) / (H * 0.13), 0, 1);
    elev[idx(x, y)] *= ex * ey;
  }
  const tLand = quantile(elev, null, landFrac);
  for (let i = 0; i < W * H; i++) isLand[i] = elev[i] > tLand ? 1 : 0;

  const tMnt = quantile(elev, isLand, 0.11);
  const forestF = blobField(rnd, 80, 6, 20);
  const tFor = quantile(forestF, isLand, 0.30);
  for (let i = 0; i < W * H; i++) {
    if (!isLand[i]) continue;
    if (elev[i] > tMnt) terrain[i] = MOUNT;
    else if (forestF[i] > tFor) terrain[i] = FOREST;
    else terrain[i] = PLAINS;
  }

  // ---- bölgeler (isim, tarafsız direnç ve şehir taşıyıcıları) ----
  const regionOf = new Int16Array(W * H).fill(-1);
  const landCells = [];
  for (let i = 0; i < W * H; i++) if (isLand[i]) landCells.push(i);

  const seeds = [];
  const used = new Set();
  let guard = 0;
  while (seeds.length < nRegions && guard++ < nRegions * 40) {
    const c = landCells[(rnd() * landCells.length) | 0];
    if (!used.has(c)) { used.add(c); seeds.push(c); }
  }

  const frontier = seeds.slice();
  seeds.forEach((c, r) => { regionOf[c] = r; });
  while (frontier.length) {
    const k = (rnd() * frontier.length) | 0;
    const c = frontier[k];
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
    const x = c % W, y = (c / W) | 0, r = regionOf[c];
    if (x > 0) { const n = c - 1; if (isLand[n] && regionOf[n] < 0) { regionOf[n] = r; frontier.push(n); } }
    if (x < W - 1) { const n = c + 1; if (isLand[n] && regionOf[n] < 0) { regionOf[n] = r; frontier.push(n); } }
    if (y > 0) { const n = c - W; if (isLand[n] && regionOf[n] < 0) { regionOf[n] = r; frontier.push(n); } }
    if (y < H - 1) { const n = c + W; if (isLand[n] && regionOf[n] < 0) { regionOf[n] = r; frontier.push(n); } }
  }
  // hiçbir tohuma bağlanmayan kopuk adacıklar denize dönsün
  for (let i = 0; i < W * H; i++) if (isLand[i] && regionOf[i] < 0) { isLand[i] = 0; terrain[i] = 0; }

  const regions = [];
  for (let r = 0; r < seeds.length; r++)
    regions.push({ id: r, n: 0, cx: 0, cy: 0, coastal: false, city: null });

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = idx(x, y), r = regionOf[c];
    if (r < 0) continue;
    const reg = regions[r];
    reg.n++; reg.cx += x; reg.cy += y;
    if ((x > 0 && !isLand[c - 1]) || (x < W - 1 && !isLand[c + 1]) ||
        (y > 0 && !isLand[c - W]) || (y < H - 1 && !isLand[c + W])) reg.coastal = true;
  }

  // ---- şehirler ----
  const cities = [];
  for (const reg of regions) {
    if (!reg.n) continue;
    reg.cx = (reg.cx / reg.n) | 0;
    reg.cy = (reg.cy / reg.n) | 0;
    if (regionOf[idx(reg.cx, reg.cy)] !== reg.id) {
      // ağırlık merkezi bölge dışına düştüyse bölgeden bir hücre seç
      for (let y = 0; y < H && regionOf[idx(reg.cx, reg.cy)] !== reg.id; y++)
        for (let x = 0; x < W; x++)
          if (regionOf[idx(x, y)] === reg.id) { reg.cx = x; reg.cy = y; y = H; break; }
    }
    // her bölgede bir yerleşim; büyüklüğü alana ve kıyı olmasına bağlı
    const size = clamp(reg.n / 45 + (reg.coastal ? 0.8 : 0) + rnd() * 1.2, 0.4, 3.2);
    const city = {
      id: cities.length, name: makeName(rnd), x: reg.cx, y: reg.cy,
      region: reg.id, size,
      pop: 40 + size * 55 * (0.7 + rnd() * 0.6),
      castle: rnd() < 0.22 ? 1 : 0,
      owner: -1,
    };
    reg.city = city.id;
    cities.push(city);
  }

  // tarafsız bölgelerin direnci — bazıları güçlü beylik, bazıları dağınık köy
  for (const reg of regions) reg.def = 0.7 + rnd() * 1.5;

  return { seed, isLand, terrain, regionOf, regions, cities };
}
