// Saf simülasyon. DOM yok, Math.random yok, Date yok.
// territorial.io çekirdeği: tıkladığın tarafa sınırın dalga gibi yayılır.
// Ordu birimi, arazi, ekonomi yok — sadece toprak, asker ve ittifak.

import { W, H, createWorld, mulberry32, idx, clamp } from './world.js';

export const NATION_DEFS = [
  ['İngiltere', '#d94141'], ['Fransa', '#3a63d8'], ['Kastilya', '#e8c33a'],
  ['Portekiz', '#2fa05e'], ['Aragon', '#ef8a2f'], ['Burgonya', '#f0b03f'],
  ['Avusturya', '#c8cdd8'], ['Danimarka', '#e0729b'], ['Polonya', '#d955ab'],
  ['Litvanya', '#8f4444'], ['Moskova', '#3fbb8a'], ['Macaristan', '#a86fe0'],
  ['Osmanlı', '#1f9159'], ['Bizans', '#7b48b8'], ['Venedik', '#42b8dc'],
  ['Novgorod', '#9aa844'],
];

export const WIN_FRAC = 0.60;
export const BETRAY_LOCK = 20;        // ihanet cezası — GERÇEK saniye

// --- saldırı dengesi ---
const NEUTRAL_COST = 1.5;             // tarafsız hücrenin bedeli
const BASE_COST = 1.0;                // düşman hücresinin taban bedeli
const DEF_K = 1.7;                    // savunanın asker yoğunluğunun ağırlığı
const DEF_LOSS = 0.55;                // savunan, alınan hücre başına kaybettiği
const RATE_BASE = 26;                 // hücre/sn taban yayılma hızı
const RATE_K = 3.1;                   // askerle artan hız

export function createSim(seed) {
  const world = createWorld(seed);
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const owner = new Int16Array(W * H).fill(-1);

  const sim = {
    world, rnd, owner,
    lastCapture: new Float32Array(W * H).fill(-99),  // hücre ne zaman el değiştirdi
    t: 0, realT: 0,
    nations: [], attacks: [], nextAttackId: 1,
    playerId: -1, over: false, won: false,
    events: [], fx: [],                              // fx: arayüzün tükettiği anlık olaylar
    playerOffers: new Set(),
    landCells: world.landCells,
    dirty: true,
  };

  // başlangıç yurtları: birbirinden olabildiğince uzak
  const spots = [];
  const cand = [];
  for (let y = 4; y < H - 4; y += 3) for (let x = 4; x < W - 4; x += 3) {
    const c = idx(x, y);
    if (!world.isLand[c]) continue;
    // kıyıya çok yakın olmasın ki başlangıç yurdu sıkışmasın
    let land = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const n = idx(clamp(x + dx, 0, W - 1), clamp(y + dy, 0, H - 1));
      if (world.isLand[n]) land++;
    }
    if (land > 40) cand.push({ x, y });
  }
  spots.push(cand[(rnd() * cand.length) | 0]);
  while (spots.length < NATION_DEFS.length && spots.length < cand.length) {
    let best = null, bestD = -1;
    for (const c of cand) {
      let d = Infinity;
      for (const k of spots) d = Math.min(d, (c.x - k.x) ** 2 + (c.y - k.y) ** 2);
      if (d > bestD) { bestD = d; best = c; }
    }
    spots.push(best);
  }

  NATION_DEFS.forEach(([name, color], i) => {
    const nat = {
      id: i, name, color, pool: 140, cells: 0,
      alive: true, ai: true,
      allies: new Set(), lockUntil: 0,
      lastThink: rnd() * 2.5,
      cx: spots[i].x, cy: spots[i].y,
    };
    sim.nations.push(nat);
    // 4 hücre yarıçapında yuvarlak bir başlangıç yurdu
    const { x, y } = spots[i];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dy * dy > 18) continue;
      const cx = clamp(x + dx, 0, W - 1), cy = clamp(y + dy, 0, H - 1);
      const c = idx(cx, cy);
      if (world.isLand[c] && owner[c] === -1) { owner[c] = i; nat.cells++; }
    }
  });

  return sim;
}

// ------------------------------------------------------------------ yardımcı

export function log(sim, metin, tip = 'info') {
  sim.events.push({ tip, metin });
  if (sim.events.length > 120) sim.events.shift();
}

export const allied = (a, b) => a.allies.has(b.id);
export const locked = (sim, n) => n.lockUntil > sim.realT;
export const landFrac = (sim, nat) => nat.cells / sim.landCells;

export function troopCap(sim, nat) { return 140 + nat.cells * 2.6; }
export function density(nat) { return nat.pool / Math.max(30, nat.cells); }
export function power(sim, nat) {
  let onFront = 0;
  for (const a of sim.attacks) if (a.from === nat.id) onFront += a.troops;
  return nat.pool + onFront + nat.cells * 0.5;
}

const nbs = (c, out) => {
  const x = c % W;
  out.length = 0;
  if (x > 0) out.push(c - 1);
  if (x < W - 1) out.push(c + 1);
  if (c >= W) out.push(c - W);
  if (c < W * (H - 1)) out.push(c + W);
  return out;
};

// ------------------------------------------------------------------ ittifak

export function formAlliance(sim, a, b) {
  if (a === b || allied(a, b)) return false;
  a.allies.add(b.id); b.allies.add(a.id);
  log(sim, `🤝 ${a.name} ve ${b.name} ittifak kurdu`, 'ally');
  return true;
}

// İttifakı bozan taraf 20 GERÇEK saniye hiçbir yere saldıramaz.
export function breakAlliance(sim, breaker, other) {
  if (!allied(breaker, other)) return false;
  breaker.allies.delete(other.id); other.allies.delete(breaker.id);
  breaker.lockUntil = sim.realT + BETRAY_LOCK;
  // bozanın o tarafa süren saldırıları da durur
  for (let i = sim.attacks.length - 1; i >= 0; i--) {
    const at = sim.attacks[i];
    if (at.from === breaker.id) { breaker.pool += at.troops; sim.attacks.splice(i, 1); }
  }
  log(sim, `💔 ${breaker.name} ittifakı bozdu — ${BETRAY_LOCK}sn saldıramaz`, 'betray');
  sim.fx.push({ tip: 'betray', nat: breaker.id });
  return true;
}

// ------------------------------------------------------------------ saldırı

export function canAttack(sim, nat, targetId) {
  if (!nat.alive || locked(sim, nat)) return false;
  if (targetId === nat.id) return false;
  if (targetId >= 0 && allied(nat, sim.nations[targetId])) return false;
  return true;
}

// Bir hücreyi almanın bedeli. Savunanın asker yoğunluğu arttıkça pahalanır —
// oyunun tek gerilim kaynağı bu: büyük ordu iyi savunur.
export function attackCost(sim, targetId) {
  if (targetId < 0) return NEUTRAL_COST;
  return BASE_COST + density(sim.nations[targetId]) * DEF_K;
}

// Saldırı başlat: hedefin bize komşu bütün hücreleri cepheye girer,
// sınır o yöne doğru düzgün bir dalga hâlinde ilerler.
export function startAttack(sim, nat, targetId, troops) {
  if (!canAttack(sim, nat, targetId)) return null;
  troops = Math.min(troops, nat.pool);
  if (troops < attackCost(sim, targetId) * 2) return null;

  const q = [];
  const inQ = new Set();
  const tmp = [];
  for (let c = 0; c < W * H; c++) {
    if (sim.owner[c] !== targetId) continue;
    if (targetId < 0 && !sim.world.isLand[c]) continue;
    for (const n of nbs(c, tmp)) {
      if (sim.owner[n] === nat.id) { q.push(c); inQ.add(c); break; }
    }
  }
  if (!q.length) return null;

  nat.pool -= troops;
  const atk = {
    id: sim.nextAttackId++, from: nat.id, target: targetId,
    troops, start: troops, q, qi: 0, inQ, acc: 0,
  };
  sim.attacks.push(atk);
  sim.fx.push({ tip: 'attack', nat: nat.id, target: targetId });
  return atk;
}

export function cancelAttack(sim, atk) {
  const i = sim.attacks.indexOf(atk);
  if (i < 0) return;
  sim.nations[atk.from].pool += atk.troops;   // geri çağrılan asker garnizona döner
  sim.attacks.splice(i, 1);
}

function take(sim, cell, nat) {
  const o = sim.owner[cell];
  if (o >= 0) {
    const def = sim.nations[o];
    def.cells--;
    if (def.cells <= 0) kill(sim, def);
  }
  sim.owner[cell] = nat.id;
  sim.lastCapture[cell] = sim.t;
  nat.cells++;
  sim.dirty = true;
}

function kill(sim, nat) {
  if (!nat.alive) return;
  nat.alive = false;
  for (const id of nat.allies) sim.nations[id].allies.delete(nat.id);
  nat.allies.clear();
  for (let i = sim.attacks.length - 1; i >= 0; i--)
    if (sim.attacks[i].from === nat.id) sim.attacks.splice(i, 1);
  log(sim, `💀 ${nat.name} tarihe karıştı`, 'death');
  sim.fx.push({ tip: 'death', nat: nat.id, x: nat.cx, y: nat.cy });
  if (nat.id === sim.playerId) { sim.over = true; sim.won = false; }
}

function stepAttacks(sim, dt) {
  const tmp = [];
  for (let i = sim.attacks.length - 1; i >= 0; i--) {
    const a = sim.attacks[i];
    const nat = sim.nations[a.from];
    if (!nat.alive) { sim.attacks.splice(i, 1); continue; }

    a.acc += (RATE_BASE + Math.sqrt(a.troops) * RATE_K) * dt;
    let budget = Math.floor(a.acc);
    if (budget <= 0) continue;
    a.acc -= budget;

    let took = 0;
    while (budget-- > 0) {
      if (a.qi >= a.q.length) break;                 // cephe tükendi
      const c = a.q[a.qi++];
      if (sim.owner[c] !== a.target) continue;       // başkası kapmış
      const cost = attackCost(sim, a.target);
      if (a.troops < cost) { a.troops = 0; break; }
      a.troops -= cost;
      if (a.target >= 0) {
        const def = sim.nations[a.target];
        def.pool = Math.max(0, def.pool - cost * DEF_LOSS);
      }
      take(sim, c, nat);
      took++;
      for (const n of nbs(c, tmp)) {
        if (sim.owner[n] === a.target && !a.inQ.has(n)) { a.inQ.add(n); a.q.push(n); }
      }
    }
    if (took) a.lastX = (a.q[a.qi - 1] % W), a.lastY = ((a.q[a.qi - 1] / W) | 0);

    if (a.troops <= 0 || a.qi >= a.q.length) {
      if (a.troops > 0) nat.pool += a.troops;        // cephe bitti, kalan geri döner
      sim.attacks.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------------ büyüme

function stepGrowth(sim, dt) {
  for (const nat of sim.nations) {
    if (!nat.alive) continue;
    const cap = troopCap(sim, nat);
    const g = (0.09 * nat.pool * (1 - nat.pool / cap) + nat.cells * 0.05 + 3) * dt;
    nat.pool = clamp(nat.pool + g, 0, cap);
  }
}

// ------------------------------------------------------------------ yapay zekâ

// Komşuları ve tarafsız sınırı örnekle.
function neighbours(sim, nat) {
  const set = new Set();
  const tmp = [];
  for (let c = 0; c < W * H; c += 2) {
    if (sim.owner[c] !== nat.id) continue;
    for (const n of nbs(c, tmp)) {
      if (!sim.world.isLand[n]) continue;
      const o = sim.owner[n];
      if (o !== nat.id) set.add(o);
    }
  }
  return set;
}

function aiThink(sim, nat) {
  const busy = sim.attacks.some(a => a.from === nat.id);
  const nb = neighbours(sim, nat);

  // ittifak: güçlü bir komşuyla anlaş
  if (nat.allies.size < 2 && sim.rnd() < 0.25) {
    for (const id of nb) {
      if (id < 0) continue;
      const o = sim.nations[id];
      if (!o.alive || allied(nat, o)) continue;
      if (power(sim, o) > power(sim, nat) * 1.3) {
        if (o.id === sim.playerId) sim.playerOffers.add(nat.id);
        else formAlliance(sim, nat, o);
        break;
      }
    }
  }

  if (busy || locked(sim, nat) || nat.pool < troopCap(sim, nat) * 0.35) return;

  // hedef: en ucuz komşu. Tarafsız toprak varsa ona öncelik.
  let best = null, bestScore = -Infinity;
  for (const id of nb) {
    if (id >= 0) {
      const o = sim.nations[id];
      if (!o.alive || allied(nat, o)) continue;
      if (power(sim, o) > power(sim, nat) * 1.5) continue;   // kendinden çok güçlüye girme
    }
    // ucuzluk + büyük hedefi kırpma isteği
    const score = (id < 0 ? 3 : 1) / attackCost(sim, id)
      + (id >= 0 ? landFrac(sim, sim.nations[id]) * 2.5 : 0);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  if (best === null) return;
  startAttack(sim, nat, best, nat.pool * (0.5 + sim.rnd() * 0.35));
}

// ------------------------------------------------------------------ ana adım

export function step(sim, dt, realDt) {
  if (sim.over) return;
  sim.t += dt;
  sim.realT += realDt;

  stepGrowth(sim, dt);
  stepAttacks(sim, dt);

  for (const nat of sim.nations) {
    if (!nat.alive || !nat.ai) continue;
    if (sim.t - nat.lastThink > 1.8) { nat.lastThink = sim.t; aiThink(sim, nat); }
  }

  if (sim.playerId >= 0) {
    const me = sim.nations[sim.playerId];
    if (me.alive && landFrac(sim, me) >= WIN_FRAC) { sim.over = true; sim.won = true; }
  }
}

export { W, H, S, idx, clamp } from './world.js';
