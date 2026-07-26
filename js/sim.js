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

// --- ekonomi (territorial.io modeli) ---
// İki ayrı büyüme: her TICK'te mevcut askerin üstüne BİLEŞİK faiz, ve her
// INCOME_PERIOD'da toprağın kadar düz gelir. Faiz oranı toprak payıyla
// yükselir; yumuşak tavanı geçince doğrusal olarak sıfıra iner.
export const TICK = 0.56;             // faiz periyodu (sn)
export const TICKS_PER_INCOME = 10;   // her 10 tikte bir arazi geliri (5.6 sn)
// Genel hız çarpanı.
export const INCOME_SCALE = 3;
// Arazi geliri toprakla ÜSTEL artar: büyümek kendi kendini besler.
const INCOME_EXP = 1.18;
// Gelir tikinde faiz de toplu (balon) ödeme yapar — tik faizinin bu katı.
const BALLOON = 6;
const INTEREST_MIN = 0.016 * INCOME_SCALE;   // çok az toprakta tik başına faiz
const INTEREST_MAX = 0.040 * INCOME_SCALE;   // bütün haritaya hükmederken
// Tavan toprağın katı. Gelir 5.6 sn'de toprak kadar geldiğinden, faiz ancak
// asker toprağın ~5 katını aştıktan sonra baskın olur; tavan dar tutulursa
// bileşik büyüme hiç hissedilmez. Bu yüzden aralık geniş.
const SOFT_MULT = 40;                 // yumuşak tavan = toprak × bu
const HARD_MULT = 60;                 // sert tavan — faiz burada tam durur
const EARLY_BOOST = 1.9;              // açılışta faiz çarpanı
const EARLY_SECS = 100;               // bu sürede 1'e iner
const START_MULT = 9;                 // başlangıç askeri = toprak × bu

// --- borçlanma ---
// Elindekinden fazlasını sefere sürebilirsin; asker eksiye düşer. Gelen gelir
// önce borcu kapatır, borç da kendi faiziyle büyür — bedava kredi değil.
const DEBT_MULT = 10;                 // en fazla borç = toprak × bu
const DEBT_RATE = 0.012;              // borcun tik başına büyümesi — borçlanmak riskli

// --- saldırı dengesi ---
// Boş toprak ucuz, savunulan toprak pahalı. Açılıştaki kapışma hızlı olmalı;
// asıl zorluk yerleşmiş bir krallıktan toprak koparmak.
const NEUTRAL_COST = 25;              // tarafsız hücrenin bedeli
const BASE_COST = 22;                 // düşman hücresinin taban bedeli
const DEF_K = 1.8;                    // savunanın asker yoğunluğunun ağırlığı
const DEF_LOSS = 0.4;                 // savunan, alınan hücre başına kaybettiği
const ATTACK_SECS = 3.6;              // dalganın hedeflenen süresi
const RATE_MIN = 7;                   // en yavaş yayılma (hücre/sn)

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
    tickAcc: 0, tickNo: 0,            // faiz/gelir döngüsü — gösterge bunu okur
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
      id: i, name, color, pool: 0, cells: 0,
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
    // Başlangıç askeri toprağa oranlı olmalı: sabit bir sayı, bedel ölçeği
    // değiştiğinde açılışı ölü doğurur (140 asker ≈ 5 hücre demekti).
    nat.pool = nat.cells * START_MULT;
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

// Tavanlar toprağa bağlı: büyüdükçe biriktirebileceğin asker de büyür.
export function softCap(sim, nat) { return Math.max(60, nat.cells * SOFT_MULT); }
export function hardCap(sim, nat) { return Math.max(90, nat.cells * HARD_MULT); }
export const troopCap = hardCap;      // arayüzde gösterilen tavan

// Tik başına bileşik faiz oranı. Toprak payıyla yükselir, yumuşak tavandan
// sonra doğrusal olarak sıfıra iner — sonsuz birikim yok ama doygunluk da
// düz bir çizgi değil.
export function interestRate(sim, nat) {
  const frac = nat.cells / sim.landCells;
  let r = INTEREST_MIN + (INTEREST_MAX - INTEREST_MIN) * frac;
  if (sim.t < EARLY_SECS) r *= 1 + (EARLY_BOOST - 1) * (1 - sim.t / EARLY_SECS);
  const soft = softCap(sim, nat), hard = hardCap(sim, nat);
  if (nat.pool > soft) r *= clamp(1 - (nat.pool - soft) / (hard - soft), 0, 1);
  return r;
}

// Borçtayken savunma yoğunluğu negatife düşmesin — bedel tabanın altına inmez.
// Gelir tikinde yatacak toplu ödeme: arazi geliri (toprakla üstel) artı
// faizin balon ödemesi. Arayüz bunu okuyup geri sayımın yanında gösterir.
export function incomePayout(sim, nat) {
  const land = Math.pow(Math.max(0, nat.cells), INCOME_EXP) * INCOME_SCALE;
  const balloon = Math.max(0, nat.pool) * interestRate(sim, nat) * BALLOON;
  return { land, balloon, total: land + balloon };
}

export function density(nat) { return Math.max(0, nat.pool) / Math.max(25, nat.cells); }

export function maxDebt(sim, nat) { return nat.cells * DEBT_MULT; }
export const inDebt = nat => nat.pool < 0;
// Bir seferde sürebileceğin en yüksek asker: elindeki + borçlanabileceğin.
export function maxCommit(sim, nat) { return nat.pool + maxDebt(sim, nat); }
// Havuza yapılan HER ekleme buradan geçmeli. Ekonomi hızlanınca havuz sürekli
// tavanda duruyor; geri dönen sefer askeri kırpılmazsa tavan aşılıyor.
export function deposit(sim, nat, amount) {
  nat.pool = Math.min(nat.pool + amount, hardCap(sim, nat));
}

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
    if (at.from === breaker.id) { deposit(sim, breaker, at.troops); sim.attacks.splice(i, 1); }
  }
  log(sim, `💔 ${breaker.name} ittifakı bozdu — ${BETRAY_LOCK}sn saldıramaz`, 'betray');
  sim.fx.push({ tip: 'betray', nat: breaker.id });
  return true;
}

// ------------------------------------------------------------------ saldırı

export function canAttack(sim, nat, targetId) {
  if (!nat.alive || locked(sim, nat)) return false;
  if (inDebt(nat)) return false;                  // borç kapanmadan yeni sefer yok
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
  troops = Math.min(troops, maxCommit(sim, nat));   // borçlanmaya izin var
  const cost = attackCost(sim, targetId);
  if (troops < cost) return null;                 // tek hücreye bile yetmiyor

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
  // Yayılma hızı, askerin kaç hücreye yeteceğine göre ayarlanır: dalga
  // ölçekten bağımsız olarak hep ~ATTACK_SECS sürer, yani izlenebilir kalır.
  const rate = Math.max(RATE_MIN, (troops / cost) / ATTACK_SECS);
  const atk = {
    id: sim.nextAttackId++, from: nat.id, target: targetId,
    troops, start: troops, q, qi: 0, inQ, acc: 0, rate,
  };
  sim.attacks.push(atk);
  sim.fx.push({ tip: 'attack', nat: nat.id, target: targetId });
  return atk;
}

export function cancelAttack(sim, atk) {
  const i = sim.attacks.indexOf(atk);
  if (i < 0) return;
  deposit(sim, sim.nations[atk.from], atk.troops);   // geri çağrılan asker garnizona döner
  sim.attacks.splice(i, 1);
}

function take(sim, cell, nat) {
  if (!sim.world.isLand[cell]) return;      // deniz sahiplenilemez
  const o = sim.owner[cell];
  if (o >= 0) {
    const def = sim.nations[o];
    def.cells--;
    // Tavan toprağa bağlı: küçülen ulusun askeri de yeni tavana kırpılmalı,
    // yoksa toprak kaybeden bir ulus tavanının üstünde asker taşır.
    if (def.pool > 0) def.pool = Math.min(def.pool, hardCap(sim, def));
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

    a.acc += a.rate * dt;
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
        // Deniz asla cepheye girmez. Tarafsız hedefte deniz de owner === -1
        // olduğu için bu kontrol olmazsa dalga okyanusa akar: görünmez
        // hücreler ele geçer, saldırı bütçesi orada erir ve kıyıda başlayan
        // ulus karaya doğru büyüyemez.
        if (!sim.world.isLand[n]) continue;
        if (sim.owner[n] === a.target && !a.inQ.has(n)) { a.inQ.add(n); a.q.push(n); }
      }
    }
    if (took) a.lastX = (a.q[a.qi - 1] % W), a.lastY = ((a.q[a.qi - 1] / W) | 0);

    if (a.troops <= 0 || a.qi >= a.q.length) {
      if (a.troops > 0) deposit(sim, nat, a.troops); // cephe bitti, kalan geri döner
      sim.attacks.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------------ büyüme

// Ödemeler KESİKLİ: her TICK'te faiz, her 10. tikte arazi geliri. Sürekli
// akıtmak sayıyı yumuşak gösterir ama geri sayılacak bir an bırakmaz —
// territorial.io'daki gibi belirli anlarda yatması hem doğru hem okunaklı.
function stepGrowth(sim, dt) {
  sim.tickAcc += dt;
  while (sim.tickAcc >= TICK) {
    sim.tickAcc -= TICK;
    sim.tickNo++;
    const income = sim.tickNo % TICKS_PER_INCOME === 0;

    for (const nat of sim.nations) {
      if (!nat.alive) continue;
      const borcluydu = nat.pool < 0;
      if (borcluydu) {
        nat.pool *= 1 + DEBT_RATE;      // borç kendi faiziyle büyür
      } else {
        nat.pool *= 1 + interestRate(sim, nat);
      }
      if (income) {
        const p = incomePayout(sim, nat);
        nat.pool += p.total;
      }
      if (nat.pool > 0) nat.pool = Math.min(nat.pool, hardCap(sim, nat));
      if (borcluydu && nat.pool >= 0) log(sim, `💰 ${nat.name} borcunu kapattı`, 'info');
    }
    sim.fx.push({ tip: 'tick', income });
  }
}

// --- gösterge için ---
export const tickProgress = sim => sim.tickAcc / TICK;
export const tickIndex = sim => sim.tickNo % TICKS_PER_INCOME;
export const ticksToIncome = sim => TICKS_PER_INCOME - (sim.tickNo % TICKS_PER_INCOME);
export const secsToIncome = sim => ticksToIncome(sim) * TICK - sim.tickAcc;

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

  if (busy || locked(sim, nat) || nat.pool < softCap(sim, nat) * 0.35) return;

  // hedef: en ucuz komşu. Tarafsız toprak varsa ona öncelik.
  let best = null, bestScore = -Infinity;
  for (const id of nb) {
    if (id >= 0) {
      const o = sim.nations[id];
      if (!o.alive || allied(nat, o)) continue;
      if (power(sim, o) > power(sim, nat) * 1.5) continue;   // kendinden çok güçlüye girme
    }
    // Asker başına kazanılan toprak. Büyük hedefi kırpma isteği ÇARPAN olarak
    // eklenir — toplama olsaydı bedel ölçeği değiştiğinde terimlerden biri
    // diğerini ezerdi (bedeller büyüyünce YZ boş toprağı görmez olmuştu).
    let score = (id < 0 ? 2.5 : 1) / attackCost(sim, id);
    if (id >= 0) score *= 1 + landFrac(sim, sim.nations[id]) * 1.5;
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
