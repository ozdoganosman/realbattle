// Dünya üretimi — deterministik (seed'den).
//
// ÖNEMLİ: Arazi tipi ve şehirler tamamen DEKORATİFTİR. Oynanışa hiçbir
// etkileri yoktur — ne fetih maliyetini ne hızı ne geliri değiştirirler.
// Sadece harita gerçek bir ortaçağ haritası gibi dursun diye varlar.
// Oyun kuralları yalnız kara/deniz ayrımını kullanır.

// Kıta 280×172'den büyütüldü: uluslar arasında daha çok yer, daha uzun
// cepheler. S küçültülerek çizim boyutu yaklaşık aynı tutuldu.
export const W = 400, H = 248, S = 3;
// Üretim parametreleri eski ölçeğe göre yazılmıştı; SC ile birlikte büyüyorlar
// ki kıtanın şekli ve şehir sıklığı aynı karakterde kalsın.
const SC = W / 280;
const SC2 = SC * SC;
export const PLAINS = 0, FOREST = 1, MOUNT = 2;

// arazi tipine göre renk parlaklığı — yalnız çizim için
export const TERRAIN_SHADE = [1.0, 0.85, 0.68];

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
  'Bel', 'Dun', 'Ven', 'Rav', 'Ost', 'Wes', 'Cas', 'Nor', 'Alt', 'Sem', 'Kon',
  'Bur', 'Mar', 'Vel', 'Tor', 'Hal'];
const SYL_B = ['ten', 'mar', 'gard', 'burg', 'holm', 'stad', 'vic', 'dor',
  'heim', 'grad', 'ova', 'kale', 'köy', 'port', 'field', 'mont', 'iye', 'hisar',
  'çay', 'yurt'];

function blobField(rnd, nBlobs, rMin, rMax) {
  const f = new Float32Array(W * H);
  const rand = (a, b) => a + rnd() * (b - a);
  for (let b = 0; b < nBlobs; b++) {
    const cx = rand(W * 0.05, W * 0.95), cy = rand(H * 0.05, H * 0.95);
    const r = rand(rMin, rMax), amp = rand(0.5, 1), r2 = r * r * 0.5;
    const x0 = Math.max(0, (cx - r * 2.2) | 0), x1 = Math.min(W - 1, (cx + r * 2.2) | 0);
    const y0 = Math.max(0, (cy - r * 2.2) | 0), y1 = Math.min(H - 1, (cy + r * 2.2) | 0);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      f[idx(x, y)] += amp * Math.exp(-d / r2);
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
  const landFrac = opts.landFrac ?? 0.58;

  const isLand = new Uint8Array(W * H);
  const terrain = new Uint8Array(W * H);
  const elev = blobField(rnd, Math.round(130 * SC2), 8 * SC, 32 * SC);

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ex = clamp(Math.min(x, W - 1 - x) / (W * 0.12), 0, 1);
    const ey = clamp(Math.min(y, H - 1 - y) / (H * 0.12), 0, 1);
    elev[idx(x, y)] *= ex * ey;
  }

  const tLand = quantile(elev, null, landFrac);
  let landCells = 0;
  for (let i = 0; i < W * H; i++) {
    isLand[i] = elev[i] > tLand ? 1 : 0;
    if (isLand[i]) landCells++;
  }

  // --- dekoratif arazi: dağlık sırtlar ve orman kuşakları ---
  const tMnt = quantile(elev, isLand, 0.12);
  const forestF = blobField(rnd, Math.round(85 * SC2), 6 * SC, 21 * SC);
  const tFor = quantile(forestF, isLand, 0.30);
  for (let i = 0; i < W * H; i++) {
    if (!isLand[i]) continue;
    if (elev[i] > tMnt) terrain[i] = MOUNT;
    else if (forestF[i] > tFor) terrain[i] = FOREST;
    else terrain[i] = PLAINS;
  }

  // --- dekoratif şehirler: birbirinden uzak, isimli yerleşimler ---
  const cities = [];
  const MIN_D2 = (8 * SC) * (8 * SC);
  const land = [];
  for (let i = 0; i < W * H; i++) if (isLand[i]) land.push(i);
  const CITY_N = Math.round(210 * SC2);
  for (let tries = 0; tries < 9000 * SC2 && cities.length < CITY_N; tries++) {
    const c = land[(rnd() * land.length) | 0];
    const x = c % W, y = (c / W) | 0;
    if (x < 3 || y < 3 || x > W - 4 || y > H - 4) continue;
    let ok = true;
    for (const o of cities) {
      if ((o.x - x) ** 2 + (o.y - y) ** 2 < MIN_D2) { ok = false; break; }
    }
    if (!ok) continue;
    cities.push({
      x, y,
      name: SYL_A[(rnd() * SYL_A.length) | 0] + SYL_B[(rnd() * SYL_B.length) | 0],
      size: 0.5 + rnd() * rnd() * 2.5,      // çoğu küçük, birkaçı büyük
    });
  }

  // yükseklik gölgesi (0..1) — yalnız çizim için
  const shade = new Float32Array(W * H);
  const hi = quantile(elev, isLand, 0.02);
  for (let i = 0; i < W * H; i++)
    shade[i] = isLand[i] ? clamp((elev[i] - tLand) / Math.max(1e-6, hi - tLand), 0, 1) : 0;

  return { seed, isLand, terrain, shade, cities, landCells };
}
