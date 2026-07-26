// Saf simülasyon katmanı. DOM/canvas erişimi YOK, Math.random YOK, Date YOK.
// Tek girdi: createSim(seed) + step(dt, realDt). 2. aşamada sunucuda
// aynen çalışır; istemci sadece çizer.

import {
  W, H, TERRAIN, MOUNT, createWorld, mulberry32, idx, clamp,
} from './world.js';

export const NATION_DEFS = [
  ['İngiltere', '#c0392b'], ['Fransa', '#2f55c4'], ['Kastilya', '#d8b026'],
  ['Portekiz', '#2e8b57'], ['Aragon', '#e07b2f'], ['Burgonya', '#e8a33d'],
  ['Avusturya', '#b9bec9'], ['Danimarka', '#c95f88'], ['Polonya', '#c74b9c'],
  ['Litvanya', '#7a3b3b'], ['Moskova', '#3fa27a'], ['Macaristan', '#9b5fd0'],
  ['Osmanlı', '#1f7a4d'], ['Bizans', '#6b3fa0'], ['Venedik', '#3fa7c9'],
  ['Novgorod', '#8a9440'],
];

export const MONTH_SECS = 2.2;
export const WIN_FRAC = 0.55;
export const TRUCE_SECS = 70;         // barış sonrası saldırı yasağı (oyun sn)
export const BETRAY_LOCK = 20;        // ihanet cezası — GERÇEK saniye
export const CALL_TIMEOUT = 18;       // savaşa çağrıya cevap süresi (oyun sn)

const ARMY_BASE_SPEED = 7.5;          // hücre / oyun-saniyesi
const SUPPLY_DRAIN = 0.018;           // ordunun kendiliğinden erimesi
const CLASH_RATE = 0.45;              // ordu-ordu çarpışma şiddeti
const CLASH_R = 5.5;                  // çarpışma yarıçapı (hücre)

export function createSim(seed) {
  const world = createWorld(seed);
  const rnd = mulberry32(seed ^ 0x9e3779b9);

  const owner = new Int16Array(W * H).fill(-1);
  const sim = {
    world, rnd, owner,
    t: 0, realT: 0,
    nations: [], armies: [], nextArmyId: 1,
    playerId: -1, over: false, won: false,
    events: [],                       // {tip, metin} — arayüz tüketir
    pendingCalls: [],                 // savaşa çağrılar
    playerOffers: { peace: new Set(), ally: new Set() },
    landCells: 0,
    encTimer: 0,
    dirty: true,                      // harita pikselleri değişti mi
  };

  for (let i = 0; i < W * H; i++) if (world.isLand[i]) sim.landCells++;

  // --- başkentler: birbirinden olabildiğince uzak büyük bölgeler ---
  const cand = world.regions.filter(r => r.n > 30);
  const dist2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
  const caps = [cand[(rnd() * cand.length) | 0]];
  while (caps.length < NATION_DEFS.length && caps.length < cand.length) {
    let best = null, bestD = -1;
    for (const c of cand) {
      if (caps.includes(c)) continue;
      let d = Infinity;
      for (const k of caps) d = Math.min(d, dist2(c, k));
      if (d > bestD) { bestD = d; best = c; }
    }
    caps.push(best);
  }

  NATION_DEFS.forEach(([name, color], i) => {
    const reg = caps[i];
    const nat = {
      id: i, name, color, pool: 260, gold: 150,
      cells: 0, cityCount: 0, capital: reg.city,
      alive: true, ai: true,
      wars: new Set(), allies: new Set(), truce: {},
      lockUntil: 0,                   // ihanet cezası (realT)
      lastThink: rnd() * 3,
      cx: reg.cx, cy: reg.cy,
    };
    sim.nations.push(nat);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = idx(x, y);
      if (world.regionOf[c] === reg.id) { owner[c] = i; nat.cells++; }
    }
    const city = world.cities[reg.city];
    city.owner = i; city.castle = Math.max(city.castle, 2); city.pop *= 1.7;
    nat.cityCount = 1;
  });

  recountAll(sim);
  return sim;
}

// ------------------------------------------------------------------ yardımcı

export function log(sim, metin, tip = 'info') {
  sim.events.push({ tip, metin });
  if (sim.events.length > 200) sim.events.shift();
}

export const natOf = (sim, c) => (sim.owner[c] >= 0 ? sim.nations[sim.owner[c]] : null);
export const atWar = (a, b) => a.wars.has(b.id);
export const allied = (a, b) => a.allies.has(b.id);
export const truced = (sim, a, b) => (a.truce[b.id] || 0) > sim.t;
export const locked = (sim, n) => n.lockUntil > sim.realT;

export function troopCap(sim, nat) {
  return 220 + nat.cells * 1.35 + cityPop(sim, nat) * 0.55;
}
export function cityPop(sim, nat) {
  let s = 0;
  for (const c of sim.world.cities) if (c.owner === nat.id) s += c.pop;
  return s;
}
export function power(sim, nat) {
  let onField = 0;
  for (const a of sim.armies) if (a.nat === nat.id) onField += a.troops;
  return nat.pool + onField + nat.cells * 0.55;
}
export function landFrac(sim, nat) { return nat.cells / sim.landCells; }

function recountAll(sim) {
  for (const n of sim.nations) { n.cells = 0; n.cityCount = 0; }
  for (let i = 0; i < W * H; i++) {
    const o = sim.owner[i];
    if (o >= 0) sim.nations[o].cells++;
  }
  for (const c of sim.world.cities) if (c.owner >= 0) sim.nations[c.owner].cityCount++;
  for (const n of sim.nations) updateCentroid(sim, n);
}

function updateCentroid(sim, nat) {
  // şehirlerden kaba ağırlık merkezi (her hücreyi taramaktan ucuz)
  let sx = 0, sy = 0, n = 0;
  for (const c of sim.world.cities) if (c.owner === nat.id) { sx += c.x; sy += c.y; n++; }
  if (n) { nat.cx = sx / n; nat.cy = sy / n; }
}

// ------------------------------------------------------------------ diplomasi

export function declareWar(sim, a, b) {
  if (a === b || atWar(a, b)) return;
  if (allied(a, b)) breakAlliance(sim, a, b, true);
  a.wars.add(b.id); b.wars.add(a.id);
  log(sim, `⚔️ ${a.name} → ${b.name} savaş ilan etti`, 'war');
  // müttefikleri savaşa çağır
  for (const id of b.allies) {
    const ally = sim.nations[id];
    if (!ally.alive || ally === a || atWar(ally, a)) continue;
    sim.pendingCalls.push({ caller: b.id, target: ally.id, foe: a.id, at: sim.t });
  }
}

export function makePeace(sim, a, b) {
  if (!atWar(a, b)) return;
  a.wars.delete(b.id); b.wars.delete(a.id);
  const until = sim.t + TRUCE_SECS;
  a.truce[b.id] = until; b.truce[a.id] = until;
  log(sim, `🕊️ ${a.name} ile ${b.name} barış imzaladı`, 'peace');
}

export function formAlliance(sim, a, b) {
  if (a === b || allied(a, b) || atWar(a, b)) return false;
  a.allies.add(b.id); b.allies.add(a.id);
  log(sim, `🤝 ${a.name} ve ${b.name} ittifak kurdu`, 'ally');
  return true;
}

// İttifakı bozan taraf 20 GERÇEK saniye hiç saldıramaz.
export function breakAlliance(sim, breaker, other, silent = false) {
  if (!allied(breaker, other)) return;
  breaker.allies.delete(other.id); other.allies.delete(breaker.id);
  breaker.lockUntil = sim.realT + BETRAY_LOCK;
  const until = sim.t + TRUCE_SECS * 0.4;
  if (!atWar(breaker, other)) { breaker.truce[other.id] = 0; other.truce[breaker.id] = 0; }
  if (!silent)
    log(sim, `💔 ${breaker.name} ittifakı bozdu — ${BETRAY_LOCK}sn saldırı yasağı`, 'betray');
  else
    log(sim, `💔 ${breaker.name}, ${other.name} ile ittifakını bozdu — ${BETRAY_LOCK}sn ceza`, 'betray');
  void until;
}

export function answerCall(sim, call, join) {
  const target = sim.nations[call.target];
  const caller = sim.nations[call.caller];
  const foe = sim.nations[call.foe];
  if (!target.alive || !caller.alive || !foe.alive) return;
  if (join) {
    if (!atWar(target, foe)) {
      target.wars.add(foe.id); foe.wars.add(target.id);
      log(sim, `🛡️ ${target.name}, müttefiki ${caller.name} için savaşa katıldı`, 'war');
    }
  } else {
    log(sim, `🚪 ${target.name} çağrıyı reddetti`, 'betray');
    breakAlliance(sim, target, caller);
  }
}

// ------------------------------------------------------------------ ordular

export function canAttack(sim, nat) { return !locked(sim, nat); }

// Ordu fırlat: (x0,y0) çıkış noktası, (dx,dy) birim yön, dist hedef menzil.
export function launchArmy(sim, nat, x0, y0, dx, dy, troops, dist) {
  if (!nat.alive || troops < 20 || locked(sim, nat)) return null;
  troops = Math.min(troops, nat.pool);
  if (troops < 20) return null;
  const len = Math.hypot(dx, dy) || 1;
  nat.pool -= troops;
  const army = {
    id: sim.nextArmyId++, nat: nat.id,
    x: x0, y: y0, dx: dx / len, dy: dy / len,
    troops, start: troops, travelled: 0, maxDist: dist,
    stall: 0,
  };
  sim.armies.push(army);
  return army;
}

function frontRadius(a) { return clamp(1.6 + Math.sqrt(a.troops) / 7, 1.6, 8); }

// Bir hücreyi almanın askere mal olacağı maliyet.
function cellCost(sim, cell, nat) {
  const o = sim.owner[cell];
  let c = TERRAIN[sim.world.terrain[cell]].cost;
  if (o >= 0) {
    const def = sim.nations[o];
    const density = def.pool / Math.max(120, def.cells);
    c *= 1 + density * 1.15;
  } else {
    const reg = sim.world.regions[sim.world.regionOf[cell]];
    c *= reg ? reg.def : 1;
  }
  c *= 1 + castleAt(sim, cell) * 0.85;
  return c * 1.35;
}

// Yakındaki kalelerin savunma katkısı.
function castleAt(sim, cell) {
  const x = cell % W, y = (cell / W) | 0;
  let d = 0;
  for (const city of sim.world.cities) {
    if (!city.castle || city.owner < 0) continue;
    const dx = city.x - x, dy = city.y - y;
    const r = 6 + city.castle * 3;
    const dd = dx * dx + dy * dy;
    if (dd < r * r) d = Math.max(d, city.castle * (1 - Math.sqrt(dd) / r));
  }
  return d;
}

function takeCell(sim, cell, nat) {
  const o = sim.owner[cell];
  if (o >= 0) {
    const def = sim.nations[o];
    def.cells--;
    def.pool = Math.max(0, def.pool - 0.35);      // savunmacı da kan kaybeder
    if (def.cells <= 0) killNation(sim, def);
  }
  sim.owner[cell] = nat.id;
  nat.cells++;
  sim.dirty = true;
}

function claimCities(sim) {
  for (const city of sim.world.cities) {
    const o = sim.owner[idx(city.x, city.y)];
    if (o !== city.owner) {
      if (city.owner >= 0) sim.nations[city.owner].cityCount--;
      city.owner = o;
      if (o >= 0) {
        sim.nations[o].cityCount++;
        city.pop *= 0.9;
        if (city.castle > 0 && sim.rnd() < 0.5) city.castle--;
      }
    }
  }
}

function killNation(sim, nat) {
  if (!nat.alive) return;
  nat.alive = false;
  for (const id of nat.wars) sim.nations[id].wars.delete(nat.id);
  for (const id of nat.allies) sim.nations[id].allies.delete(nat.id);
  nat.wars.clear(); nat.allies.clear();
  for (let i = sim.armies.length - 1; i >= 0; i--)
    if (sim.armies[i].nat === nat.id) sim.armies.splice(i, 1);
  log(sim, `💀 ${nat.name} tarihe karıştı`, 'death');
  if (nat.id === sim.playerId) { sim.over = true; sim.won = false; }
}

// Orduların hareketi, fetih ve çarpışması.
function stepArmies(sim, dt) {
  // --- ordu vs ordu ---
  for (let i = 0; i < sim.armies.length; i++) {
    const a = sim.armies[i];
    for (let j = i + 1; j < sim.armies.length; j++) {
      const b = sim.armies[j];
      if (a.nat === b.nat) continue;
      const na = sim.nations[a.nat], nb = sim.nations[b.nat];
      if (allied(na, nb)) continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      if (dx * dx + dy * dy > CLASH_R * CLASH_R) continue;
      if (!atWar(na, nb)) declareWar(sim, na, nb);
      // birbirlerinin puanını götürürler
      const la = a.troops, lb = b.troops;
      a.troops -= lb * CLASH_RATE * dt;
      b.troops -= la * CLASH_RATE * dt;
      a.clashing = b.clashing = 0.25;
    }
  }

  for (let i = sim.armies.length - 1; i >= 0; i--) {
    const a = sim.armies[i];
    const nat = sim.nations[a.nat];
    if (!nat.alive || a.troops <= 8) { sim.armies.splice(i, 1); continue; }
    if (a.clashing > 0) a.clashing -= dt;

    a.troops -= a.troops * SUPPLY_DRAIN * dt;   // ikmal eriyişi

    // --- hareket (hücre atlamamak için alt adımlar) ---
    const here = idx(clamp(a.x | 0, 0, W - 1), clamp(a.y | 0, 0, H - 1));
    const tSpeed = sim.world.isLand[here] ? TERRAIN[sim.world.terrain[here]].speed : 1;
    let move = ARMY_BASE_SPEED * tSpeed * dt * (a.clashing > 0 ? 0.15 : 1);
    const steps = Math.max(1, Math.ceil(move));
    const stepLen = move / steps;

    for (let s = 0; s < steps && a.troops > 8; s++) {
      const nx = a.x + a.dx * stepLen, ny = a.y + a.dy * stepLen;
      const cx = clamp(nx | 0, 0, W - 1), cy = clamp(ny | 0, 0, H - 1);
      const nc = idx(cx, cy);
      // denize / harita dışına girmesin
      if (nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2 || !sim.world.isLand[nc]) {
        a.maxDist = 0; break;
      }
      a.x = nx; a.y = ny;
      a.travelled += stepLen;
      if (!conquerAround(sim, a, nat)) { a.stall += dt; break; }
      a.stall = 0;
    }

    if (a.travelled >= a.maxDist || a.stall > 1.2 || a.troops <= 8) {
      // kalan asker garnizona döner
      if (a.troops > 8) nat.pool = Math.min(troopCap(sim, nat) * 1.5, nat.pool + a.troops);
      sim.armies.splice(i, 1);
    }
  }
}

// Ordunun etrafındaki hücreleri al. Yeterli asker yoksa false → ordu takılır.
function conquerAround(sim, a, nat) {
  const r = frontRadius(a);
  const r2 = r * r;
  const x0 = clamp((a.x - r) | 0, 0, W - 1), x1 = clamp((a.x + r + 1) | 0, 0, W - 1);
  const y0 = clamp((a.y - r) | 0, 0, H - 1), y1 = clamp((a.y + r + 1) | 0, 0, H - 1);
  let blocked = false;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - a.x, dy = y - a.y;
    if (dx * dx + dy * dy > r2) continue;
    const c = idx(x, y);
    if (!sim.world.isLand[c]) continue;
    const o = sim.owner[c];
    if (o === nat.id) continue;
    if (o >= 0) {
      const def = sim.nations[o];
      if (allied(nat, def) || truced(sim, nat, def)) continue;   // dostun üstünden geç
      if (!atWar(nat, def)) {
        if (locked(sim, nat)) continue;
        declareWar(sim, nat, def);
      }
    }
    const cost = cellCost(sim, c, nat);
    if (a.troops - cost <= 8) { blocked = true; continue; }
    a.troops -= cost;
    takeCell(sim, c, nat);
  }
  return !blocked;
}

// ------------------------------------------------------------------ kuşatma

// Düşman/tarafsız bir kara parçası tamamen tek bir ulusun toprağıyla
// çevrelenmişse o ulus tarafından yutulur.
function absorbPockets(sim) {
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || !sim.world.isLand[start]) continue;
    const mine = sim.owner[start];
    seen[start] = 1;
    stack.length = 0; stack.push(start);
    const comp = [start];
    const neighbours = new Set();
    while (stack.length) {
      const c = stack.pop();
      const x = c % W, y = (c / W) | 0;
      const nb = [];
      if (x > 0) nb.push(c - 1);
      if (x < W - 1) nb.push(c + 1);
      if (y > 0) nb.push(c - W);
      if (y < H - 1) nb.push(c + W);
      for (const n of nb) {
        if (!sim.world.isLand[n]) continue;
        if (sim.owner[n] === mine) {
          if (!seen[n]) { seen[n] = 1; stack.push(n); comp.push(n); }
        } else {
          neighbours.add(sim.owner[n]);
        }
      }
    }
    if (neighbours.size !== 1) continue;
    const encircler = [...neighbours][0];
    if (encircler < 0) continue;                  // tarafsızlık kuşatmaz
    const nat = sim.nations[encircler];
    if (!nat.alive) continue;
    if (mine >= 0) {
      const def = sim.nations[mine];
      if (allied(nat, def) || truced(sim, nat, def) || !atWar(nat, def)) continue;
    }
    if (comp.length > nat.cells * 1.4) continue;  // hazmedemeyeceği lokmayı yutamaz
    for (const c of comp) takeCell(sim, c, nat);
    // sınır düzelten tek hücrelik ceplerle günlüğü boğma
    if (comp.length >= 10)
      log(sim, `🎯 ${nat.name} kuşatılan cebi yuttu — ${comp.length} birim toprak`, 'encircle');
  }
}

// ------------------------------------------------------------------ ekonomi

function stepEconomy(sim, dt) {
  for (const nat of sim.nations) {
    if (!nat.alive) continue;
    const cap = troopCap(sim, nat);
    const growth = (0.17 * nat.pool * (1 - nat.pool / cap) + 7) * dt;
    nat.pool = clamp(nat.pool + growth, 0, cap * 1.5);
    nat.gold += (cityPop(sim, nat) * 0.012 + nat.cells * 0.004) * dt;
  }
  for (const city of sim.world.cities) {
    const cap = 90 + city.size * 110 + (city.owner >= 0 ? 60 : 0);
    city.pop = Math.min(cap, city.pop * (1 + 0.006 * dt));
  }
}

// ------------------------------------------------------------------ yapay zekâ

function borderCells(sim, nat, limit = 900) {
  // ulusun sınır hücrelerini örnekle (tam tarama pahalı olduğu için adımlı)
  const out = [];
  const stride = Math.max(1, ((sim.landCells / 4000) | 0) + 1);
  for (let i = 0, k = 0; i < W * H; i++) {
    if (sim.owner[i] !== nat.id) continue;
    if (k++ % stride) continue;
    const x = i % W, y = (i / W) | 0;
    if ((x > 0 && sim.owner[i - 1] !== nat.id && sim.world.isLand[i - 1]) ||
        (x < W - 1 && sim.owner[i + 1] !== nat.id && sim.world.isLand[i + 1]) ||
        (y > 0 && sim.owner[i - W] !== nat.id && sim.world.isLand[i - W]) ||
        (y < H - 1 && sim.owner[i + W] !== nat.id && sim.world.isLand[i + W])) {
      out.push(i);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function neighbourNations(sim, nat) {
  const set = new Set();
  for (let i = 0; i < W * H; i += 3) {
    if (sim.owner[i] !== nat.id) continue;
    const x = i % W, y = (i / W) | 0;
    const nb = [];
    if (x > 0) nb.push(i - 1);
    if (x < W - 1) nb.push(i + 1);
    if (y > 0) nb.push(i - W);
    if (y < H - 1) nb.push(i + W);
    for (const n of nb)
      if (sim.world.isLand[n] && sim.owner[n] !== nat.id) set.add(sim.owner[n]);
  }
  return set;
}

function aiThink(sim, nat) {
  const nbs = neighbourNations(sim, nat);
  const myPow = power(sim, nat);
  const myArmies = sim.armies.filter(a => a.nat === nat.id).length;

  // --- barış: kaybediyorsan çık ---
  for (const wid of [...nat.wars]) {
    const foe = sim.nations[wid];
    if (!foe.alive) { nat.wars.delete(wid); continue; }
    if (myPow < power(sim, foe) * 0.5) {
      if (foe.id === sim.playerId) sim.playerOffers.peace.add(nat.id);
      else if (sim.rnd() < 0.5) makePeace(sim, nat, foe);
    }
  }

  // --- ittifak: güçlü bir tehdit varsa komşuyla birleş ---
  if (nat.allies.size < 2 && sim.rnd() < 0.35) {
    let threat = null;
    for (const id of nbs) {
      if (id < 0) continue;
      const o = sim.nations[id];
      if (o.alive && power(sim, o) > myPow * 1.6) { threat = o; break; }
    }
    const leader = strongestNation(sim);
    if (!threat && leader && leader !== nat && landFrac(sim, leader) > 0.28) threat = leader;
    if (threat) {
      for (const id of nbs) {
        if (id < 0 || id === threat.id) continue;
        const o = sim.nations[id];
        if (!o.alive || allied(nat, o) || atWar(nat, o)) continue;
        if (o.id === sim.playerId) { sim.playerOffers.ally.add(nat.id); break; }
        if (power(sim, o) < myPow * 2.5) { formAlliance(sim, nat, o); break; }
      }
    }
  }

  if (locked(sim, nat) || myArmies >= 3 || nat.pool < 120) return;

  // --- hedef seçimi: önce tarafsız toprak, sonra savaştaki düşman ---
  const border = borderCells(sim, nat);
  if (!border.length) return;

  const wantWar = [...nat.wars].filter(id => sim.nations[id].alive);
  let picks = [];
  for (const c of border) {
    const x = c % W, y = (c / W) | 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = idx(nx, ny);
      if (!sim.world.isLand[n]) continue;
      const o = sim.owner[n];
      if (o === nat.id) continue;
      if (o < 0) { picks.push({ c, dx: ox, dy: oy, score: 2 }); }
      else if (wantWar.includes(o)) picks.push({ c, dx: ox, dy: oy, score: 1.4 });
    }
  }

  // savaş yoksa ve tarafsız kalmadıysa fırsatçı savaş ilanı
  if (!picks.length) {
    if (nat.pool > troopCap(sim, nat) * 0.75 && nat.wars.size === 0) {
      let weakest = null;
      for (const id of nbs) {
        if (id < 0) continue;
        const o = sim.nations[id];
        if (!o.alive || allied(nat, o) || truced(sim, nat, o)) continue;
        if (!weakest || power(sim, o) < power(sim, weakest)) weakest = o;
      }
      if (weakest && myPow > power(sim, weakest) * 1.45) declareWar(sim, nat, weakest);
    }
    return;
  }

  const p = picks[(sim.rnd() * picks.length) | 0];
  const troops = nat.pool * (0.45 + sim.rnd() * 0.35);
  launchArmy(sim, nat, (p.c % W) + 0.5, ((p.c / W) | 0) + 0.5,
    p.dx, p.dy, troops, 12 + sim.rnd() * 26);
}

function strongestNation(sim) {
  let best = null;
  for (const n of sim.nations)
    if (n.alive && (!best || n.cells > best.cells)) best = n;
  return best;
}

function stepCalls(sim) {
  for (let i = sim.pendingCalls.length - 1; i >= 0; i--) {
    const call = sim.pendingCalls[i];
    const target = sim.nations[call.target];
    if (!target.alive || sim.t - call.at > CALL_TIMEOUT) {
      if (target.alive && sim.t - call.at > CALL_TIMEOUT) answerCall(sim, call, false);
      sim.pendingCalls.splice(i, 1);
      continue;
    }
    if (target.id === sim.playerId) continue;      // oyuncu kendi karar verir
    const foe = sim.nations[call.foe];
    const join = power(sim, target) > power(sim, foe) * 0.6 || sim.rnd() < 0.4;
    answerCall(sim, call, join);
    sim.pendingCalls.splice(i, 1);
  }
}

// ------------------------------------------------------------------ ana adım

export function step(sim, dt, realDt) {
  if (sim.over) return;
  sim.t += dt;
  sim.realT += realDt;

  stepEconomy(sim, dt);
  stepArmies(sim, dt);
  stepCalls(sim);

  sim.encTimer += dt;
  if (sim.encTimer > 1.5) {
    sim.encTimer = 0;
    absorbPockets(sim);
    claimCities(sim);
    for (const n of sim.nations) if (n.alive) updateCentroid(sim, n);
  }

  for (const nat of sim.nations) {
    if (!nat.alive || !nat.ai) continue;
    if (sim.t - nat.lastThink > 2.2) { nat.lastThink = sim.t; aiThink(sim, nat); }
  }

  if (sim.playerId >= 0) {
    const me = sim.nations[sim.playerId];
    if (me.alive && landFrac(sim, me) >= WIN_FRAC) { sim.over = true; sim.won = true; }
  }
}

export function dateLabel(sim) {
  const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const m = Math.floor(sim.t / MONTH_SECS);
  return `${AYLAR[m % 12]} ${1444 + Math.floor(m / 12)}`;
}

export { W, H, S, idx, clamp, TERRAIN, MOUNT } from './world.js';
