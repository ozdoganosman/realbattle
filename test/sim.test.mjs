// Başsız simülasyon testi. sim.js hiçbir tarayıcı API'sine dokunmaz.

import assert from 'node:assert';
import {
  createSim, step, startAttack, cancelAttack, canAttack, attackCost,
  formAlliance, breakAlliance, allied, locked, landFrac, troopCap,
  density, power, BETRAY_LOCK, WIN_FRAC,
  interestRate, softCap, hardCap, maxDebt, maxCommit, inDebt,
  TICK, TICKS_PER_INCOME, tickProgress, tickIndex, ticksToIncome, secsToIncome,
  incomePayout, INCOME_SCALE,
} from '../js/sim.js';
import { W, H, idx } from '../js/world.js';

let pass = 0, fail = 0;
function t(ad, fn) {
  try { fn(); console.log(`  ✓ ${ad}`); pass++; }
  catch (e) { console.log(`  ✗ ${ad}\n      ${e.message}`); fail++; }
}

const fresh = (seed = 4242) => {
  const s = createSim(seed);
  s.playerId = 0; s.nations[0].ai = false;
  return s;
};

// hedefe komşu bir hücre bul
function findBorder(s, natId, targetId) {
  for (let c = 0; c < W * H; c++) {
    if (s.owner[c] !== natId) continue;
    const x = c % W;
    const nb = [];
    if (x > 0) nb.push(c - 1);
    if (x < W - 1) nb.push(c + 1);
    if (c >= W) nb.push(c - W);
    if (c < W * (H - 1)) nb.push(c + W);
    for (const n of nb)
      if (s.world.isLand[n] && s.owner[n] === targetId) return n;
  }
  return -1;
}

// ---------------------------------------------------------------- dünya

console.log('\nDünya');
const s0 = createSim(12345);

t('kara ve deniz makul oranda bölünmüş', () => {
  const f = s0.landCells / (W * H);
  assert(f > 0.3 && f < 0.8, `kara oranı ${f.toFixed(2)}`);
});

t('16 krallık kuruldu, hepsinin toprağı var', () => {
  assert.equal(s0.nations.length, 16);
  for (const n of s0.nations) assert(n.cells > 0, `${n.name} topraksız`);
});

t('başlangıç yurtları birbirinden ayrı', () => {
  for (const n of s0.nations) {
    const c = idx(n.cx, n.cy);
    assert.equal(s0.owner[c], n.id, `${n.name} kendi merkezine sahip değil`);
  }
});

t('aynı seed aynı haritayı üretir', () => {
  const a = createSim(777), b = createSim(777);
  assert.equal(a.landCells, b.landCells);
  for (let i = 0; i < W * H; i += 89) assert.equal(a.owner[i], b.owner[i]);
});

t('farklı seed farklı harita üretir', () => {
  const a = createSim(1), b = createSim(2);
  let diff = 0;
  for (let i = 0; i < W * H; i++) if (a.world.isLand[i] !== b.world.isLand[i]) diff++;
  assert(diff > W * H * 0.05);
});

t('oyun kurulunca hiç ordu birimi yok (sadeleştirme)', () => {
  assert.equal(s0.attacks.length, 0);
  assert.equal(s0.armies, undefined, 'ordu birimi kalıntısı var');
});

// ---------------------------------------------------------------- saldırı

console.log('\nSaldırı — sınır dalgası');

t('tarafsız toprağa saldırı başlatılabilir', () => {
  const s = fresh();
  const nat = s.nations[0];
  assert(findBorder(s, 0, -1) >= 0, 'tarafsız sınır yok');
  const a = startAttack(s, nat, -1, nat.pool * 0.5);
  assert(a, 'saldırı başlamadı');
  assert.equal(s.attacks.length, 1);
});

t('saldırı havuzdan asker düşürür', () => {
  const s = fresh();
  const nat = s.nations[0];
  const before = nat.pool;
  startAttack(s, nat, -1, before * 0.5);
  assert(Math.abs(nat.pool - before * 0.5) < 1e-6, `havuz ${nat.pool}, beklenen ${before * 0.5}`);
});

t('sınır dalgası toprak kazandırır', () => {
  const s = fresh();
  const nat = s.nations[0];
  const before = nat.cells;
  startAttack(s, nat, -1, nat.pool * 0.9);
  for (let i = 0; i < 120; i++) step(s, 1 / 30, 1 / 30);
  assert(nat.cells > before, `toprak artmadı (${before} → ${nat.cells})`);
});

t('yayılma sınırdan başlar — kopuk toprak oluşmaz', () => {
  const s = fresh();
  const nat = s.nations[0];
  startAttack(s, nat, -1, nat.pool * 0.9);
  for (let i = 0; i < 150; i++) step(s, 1 / 30, 1 / 30);
  // ulusun bütün hücreleri tek parça olmalı
  const own = [];
  for (let c = 0; c < W * H; c++) if (s.owner[c] === nat.id) own.push(c);
  const seen = new Set([own[0]]);
  const stack = [own[0]];
  while (stack.length) {
    const c = stack.pop(), x = c % W;
    const nb = [];
    if (x > 0) nb.push(c - 1);
    if (x < W - 1) nb.push(c + 1);
    if (c >= W) nb.push(c - W);
    if (c < W * (H - 1)) nb.push(c + W);
    for (const n of nb)
      if (s.owner[n] === nat.id && !seen.has(n)) { seen.add(n); stack.push(n); }
  }
  assert.equal(seen.size, own.length, `${own.length - seen.size} hücre kopuk`);
});

t('asker bitince saldırı durur', () => {
  const s = fresh();
  const nat = s.nations[0];
  const a = startAttack(s, nat, -1, attackCost(s, -1) * 3);   // 3 hücrelik asker
  assert(a, 'saldırı başlamadı');
  // not: s.attacks bütün ulusları kapsar, bu yüzden yalnız oyuncununkine bak
  for (let i = 0; i < 400; i++) step(s, 1 / 30, 1 / 30);
  assert.equal(s.attacks.filter(x => x.from === nat.id).length, 0,
    'oyuncunun saldırısı hâlâ sürüyor');
  assert(!s.attacks.includes(a), 'biten saldırı listeden çıkmadı');
});

t('sınırı değmeyen hedefe saldırılamaz', () => {
  const s = fresh();
  const nat = s.nations[0];
  // komşu olmayan bir ulus bul
  let uzak = null;
  for (let i = 1; i < s.nations.length; i++)
    if (findBorder(s, 0, i) < 0) { uzak = s.nations[i]; break; }
  if (!uzak) return;
  assert.equal(startAttack(s, nat, uzak.id, nat.pool * 0.5), null);
});

t('geri çağrılan seferin askeri garnizona döner', () => {
  const s = fresh();
  const nat = s.nations[0];
  const a = startAttack(s, nat, -1, nat.pool * 0.6);
  const dusuk = nat.pool, kalan = a.troops;
  cancelAttack(s, a);
  assert.equal(s.attacks.length, 0);
  assert(Math.abs(nat.pool - (dusuk + kalan)) < 1e-6, 'asker dönmedi');
});

t('kalabalık ordu daha pahalıya saldırılır', () => {
  const s = fresh();
  const zayif = s.nations[1], guclu = s.nations[2];
  // aynı toprak, biri neredeyse boş biri tavanına yakın dolu
  zayif.cells = 400; zayif.pool = 400;                  // yoğunluk 1
  guclu.cells = 400; guclu.pool = hardCap(s, guclu);    // yoğunluk 60
  assert(attackCost(s, guclu.id) > attackCost(s, zayif.id) * 2,
    `${attackCost(s, zayif.id).toFixed(1)} vs ${attackCost(s, guclu.id).toFixed(1)}`);
});

t('savunan da hücre başına asker kaybeder', () => {
  const s = fresh();
  const A = s.nations[0];
  let hedef = -1;
  for (let i = 1; i < s.nations.length; i++) if (findBorder(s, 0, i) >= 0) { hedef = i; break; }
  if (hedef < 0) return;
  const B = s.nations[hedef];
  B.pool = 800;
  const once = B.pool;
  startAttack(s, A, hedef, A.pool * 0.95);
  for (let i = 0; i < 60; i++) step(s, 1 / 30, 1 / 30);
  assert(B.pool < once, 'savunan asker kaybetmedi');
});

t('ele geçen hücrenin zamanı damgalanır (parlama için)', () => {
  const s = fresh();
  const nat = s.nations[0];
  startAttack(s, nat, -1, nat.pool * 0.8);
  for (let i = 0; i < 60; i++) step(s, 1 / 30, 1 / 30);
  let yeni = 0;
  for (let c = 0; c < W * H; c++)
    if (s.owner[c] === nat.id && s.lastCapture[c] > 0) yeni++;
  assert(yeni > 0, 'hiç hücre damgalanmadı');
});

// Saldırı, hedefin bütün sınırından değil dokunulan noktadan girmeli —
// oyunun tek yön kontrolü bu. Başlangıç yurdunun sınırı giriş yarıçapından
// dar olduğu için ölçüm uzun ve düz bir sınır üzerinde yapılır.
function genisSinirliSim() {
  const s = fresh();
  const nat = s.nations[0];
  // 60 hücre boyunda, 6 hücre kalınlığında bir şerit boya
  let bas = -1;
  outer:
  for (let y = 20; y < H - 20; y++) {
    for (let x = 20; x < W - 80; x++) {
      let ok = true;
      for (let dy = 0; dy < 10 && ok; dy++)
        for (let dx = 0; dx < 60; dx++)
          if (!s.world.isLand[idx(x + dx, y + dy)]) { ok = false; break; }
      if (ok) { bas = idx(x, y); break outer; }
    }
  }
  if (bas < 0) return null;
  const bx = bas % W, by = (bas / W) | 0;
  for (const n of s.nations) n.cells = 0;
  s.owner.fill(-1);
  for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 60; dx++) {
    s.owner[idx(bx + dx, by + dy)] = nat.id; nat.cells++;
  }
  nat.pool = hardCap(s, nat);
  return { s, nat, bx, by };
}

t('saldırı verilen giriş noktasından başlar', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat, bx, by } = g;
  // şeridin sol ucundan gir
  const atk = startAttack(s, nat, -1, nat.pool, bx + 2, by - 1);
  assert(atk, 'saldırı başlamadı');
  const enSag = Math.max(...atk.q.map(c => c % W));
  assert(enSag < bx + 30,
    `cephe şeridin sağ yarısına kadar uzanmış (x=${enSag}, giriş x=${bx + 2})`);
});

t('giriş noktası verilmezse bütün sınır cepheye girer', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat, bx, by } = g;
  const hepsi = startAttack(s, nat, -1, nat.pool);
  const n1 = hepsi.q.length;
  cancelAttack(s, hepsi);
  const nokta = startAttack(s, nat, -1, nat.pool, bx + 2, by - 1);
  assert(nokta.q.length < n1,
    `noktasal cephe daralmadı (${nokta.q.length} / ${n1})`);
});

t('farklı noktalara vurmak farklı cepheler açar', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat, bx, by } = g;
  const A = startAttack(s, nat, -1, nat.pool * 0.3, bx + 2, by - 1);
  cancelAttack(s, A);
  const B = startAttack(s, nat, -1, nat.pool * 0.3, bx + 57, by - 1);
  const setA = new Set(A.q);
  const ortak = B.q.filter(c => setA.has(c)).length;
  assert.equal(ortak, 0, `iki uçtan açılan cepheler ${ortak} hücrede örtüşüyor`);
});

// ---------------------------------------------------------------- deniz

console.log('\nDeniz sınırı');

// Tarafsız hedefte deniz de owner === -1 olduğu için, cephe kuyruğu karayı
// kontrol etmezse dalga okyanusa akıyordu: görünmez hücreler ele geçiyor,
// saldırı bütçesi orada eriyor ve kıyıda başlayan ulus karaya büyüyemiyordu.
t('tek bir deniz hücresi bile sahiplenilemez', () => {
  const s = createSim(7);
  for (let i = 0; i < 8000; i++) step(s, 0.05, 0.05);
  let deniz = 0;
  for (let i = 0; i < W * H; i++)
    if (!s.world.isLand[i] && s.owner[i] >= 0) deniz++;
  assert.equal(deniz, 0, `${deniz} deniz hücresi ele geçirilmiş`);
});

t('toprak oranı hiçbir zaman %100ü aşmaz', () => {
  const s = createSim(11);
  for (let i = 0; i < 12000; i++) {
    step(s, 0.05, 0.05);
    if (i % 900) continue;
    for (const n of s.nations)
      assert(landFrac(s, n) <= 1.0001, `${n.name} %${(landFrac(s, n) * 100).toFixed(1)}`);
  }
});

t('kıyıda başlayan ulus karaya doğru büyüyor, kıyı şeridinde kalmıyor', () => {
  // denize komşu bir yurt bul
  const s = createSim(3);
  s.playerId = 0;
  for (const n of s.nations) n.ai = false;
  let kiyili = null;
  for (const nat of s.nations) {
    for (let c = 0; c < W * H; c++) {
      if (s.owner[c] !== nat.id) continue;
      const x = c % W;
      const nb = [];
      if (x > 0) nb.push(c - 1);
      if (x < W - 1) nb.push(c + 1);
      if (c >= W) nb.push(c - W);
      if (c < W * (H - 1)) nb.push(c + W);
      if (nb.some(n => !s.world.isLand[n])) { kiyili = nat; break; }
    }
    if (kiyili) break;
  }
  if (!kiyili) return;                      // bu haritada kıyı yurdu yok

  const denizeKomsu = c => {
    const x = c % W;
    const nb = [];
    if (x > 0) nb.push(c - 1);
    if (x < W - 1) nb.push(c + 1);
    if (c >= W) nb.push(c - W);
    if (c < W * (H - 1)) nb.push(c + W);
    return nb.some(n => !s.world.isLand[n]);
  };

  kiyili.pool = hardCap(s, kiyili);
  const once = kiyili.cells;
  startAttack(s, kiyili, -1, kiyili.pool);
  for (let i = 0; i < 400; i++) step(s, 1 / 30, 1 / 30);
  assert(kiyili.cells > once, 'hiç büyümedi');

  // yeni alınan hücrelerin çoğu denize komşu OLMAMALI — yani iç kesime girdi
  let ic = 0, sahil = 0;
  for (let c = 0; c < W * H; c++) {
    if (s.owner[c] !== kiyili.id || s.lastCapture[c] <= 0) continue;
    denizeKomsu(c) ? sahil++ : ic++;
  }
  assert(ic > sahil, `iç kesim ${ic}, sahil ${sahil} — dalga kıyıda takılıyor`);
});

// ---------------------------------------------------------------- ekonomi

console.log('\nEkonomi — bileşik büyüme');

t('faiz bileşik: eşit aralıklarda artış hızlanıyor', () => {
  const s = createSim(1);
  for (const n of s.nations) n.ai = false;   // saldırı olmasın
  const nat = s.nations[0];
  // Yumuşak tavana yaklaşınca faiz kısılır; hızlanmayı görmek için ölçümü
  // tavanın altında yap. Ayrıca gelir tikleri toplu ödeme yaptığından
  // ölçüm penceresine denk gelmemeli — gelir tikinin hemen ardından başla
  // ve yalnız faiz tiklerini ölç.
  nat.pool = softCap(s, nat) * 0.05;
  while (tickIndex(s) !== 0) step(s, 0.02, 0.02);
  const artislar = [];
  let prev = nat.pool;
  for (let d = 0; d < 3; d++) {
    const hedef = s.tickNo + 1;
    while (s.tickNo < hedef) step(s, 0.02, 0.02);
    artislar.push(nat.pool - prev);
    prev = nat.pool;
  }
  assert(nat.pool < softCap(s, nat),
    `ölçüm yumuşak tavanı aştı (${Math.round(nat.pool)} / ${Math.round(softCap(s, nat))})`);
  // bileşik faizin tanımı: eşit aralıklarda artış büyür
  assert(artislar[1] > artislar[0] && artislar[2] > artislar[1],
    `artışlar hızlanmıyor: ${artislar.map(a => a.toFixed(1)).join(' → ')}`);
});

t('faiz oranı toprak payıyla yükseliyor', () => {
  const s = createSim(1);
  const kucuk = s.nations[0], buyuk = s.nations[1];
  s.t = 200;                                  // açılış çarpanı bitsin
  kucuk.cells = 100; kucuk.pool = 10;
  buyuk.cells = Math.round(s.landCells * 0.8); buyuk.pool = 10;
  assert(interestRate(s, buyuk) > interestRate(s, kucuk) * 1.5,
    `${(interestRate(s, kucuk) * 100).toFixed(2)}% vs ${(interestRate(s, buyuk) * 100).toFixed(2)}%`);
});

t('açılışta faiz daha yüksek, sonra iniyor', () => {
  const s = createSim(1);
  const nat = s.nations[0];
  nat.pool = 10;
  s.t = 0;
  const acilis = interestRate(s, nat);
  s.t = 500;
  assert(acilis > interestRate(s, nat) * 1.3,
    `açılış %${(acilis * 100).toFixed(2)}, sonrası %${(interestRate(s, nat) * 100).toFixed(2)}`);
});

t('yumuşak tavanı geçince faiz azalıyor, sert tavanda sıfır', () => {
  const s = createSim(1);
  const nat = s.nations[0];
  s.t = 500;
  nat.cells = 500;
  const soft = softCap(s, nat), hard = hardCap(s, nat);
  nat.pool = soft * 0.5;
  const normal = interestRate(s, nat);
  nat.pool = (soft + hard) / 2;
  const orta = interestRate(s, nat);
  nat.pool = hard;
  const bitti = interestRate(s, nat);
  assert(normal > 0, 'normalde faiz yok');
  assert(orta > 0 && orta < normal, `arada azalmıyor: ${orta} vs ${normal}`);
  assert(bitti === 0, `sert tavanda faiz ${bitti}`);
});

t('tavanlar toprakla büyüyor', () => {
  const s = createSim(1);
  const nat = s.nations[0];
  nat.cells = 100;
  const a = softCap(s, nat), ah = hardCap(s, nat);
  nat.cells = 1000;
  assert(softCap(s, nat) > a * 5 && hardCap(s, nat) > ah * 5, 'tavan toprakla artmıyor');
  assert(hardCap(s, nat) > softCap(s, nat), 'sert tavan yumuşaktan küçük');
});

t('arsa ödemesi toprakla ÜSTEL artıyor', () => {
  const s = createSim(1);
  const nat = s.nations[0];
  nat.pool = 0;                              // balonu devre dışı bırak
  nat.cells = 100;
  const az = incomePayout(s, nat).land;
  nat.cells = 200;
  const cok = incomePayout(s, nat).land;
  // toprak iki katına çıkınca ödeme ikiden FAZLA katına çıkmalı
  assert(cok > az * 2.1, `${az.toFixed(0)} → ${cok.toFixed(0)} (yalnız ${(cok/az).toFixed(2)} kat)`);
});

t('gelir tikinde faizin balon ödemesi de yatıyor', () => {
  const s = createSim(1);
  const nat = s.nations[0];
  nat.cells = 300;
  nat.pool = 0;
  assert.equal(incomePayout(s, nat).balloon, 0, 'asker yokken balon var');
  nat.pool = softCap(s, nat) * 0.5;
  const p = incomePayout(s, nat);
  assert(p.balloon > 0, 'balon ödemesi yok');
  // balon, tek tik faizinden belirgin biçimde büyük olmalı
  const tekTik = nat.pool * interestRate(s, nat);
  assert(p.balloon > tekTik * 3, `balon ${p.balloon.toFixed(0)}, tek tik ${tekTik.toFixed(0)}`);
  assert(Math.abs(p.total - (p.land + p.balloon)) < 1e-6);
});

t('borçtayken balon ödemesi işlemez', () => {
  const s = createSim(1);
  const nat = s.nations[0];
  nat.cells = 300; nat.pool = -500;
  assert.equal(incomePayout(s, nat).balloon, 0, 'borçluyken balon ödeniyor');
  assert(incomePayout(s, nat).land > 0, 'borçluyken arsa ödemesi de kesilmiş');
});

t('arazi geliri toprakla orantılı', () => {
  const mk = (cells) => {
    const s = createSim(1);
    for (const n of s.nations) n.ai = false;
    const nat = s.nations[0];
    nat.cells = cells; nat.pool = 0;         // faiz 0 üzerinden çalışmaz
    for (let i = 0; i < 130; i++) step(s, 0.05, 0.05);   // bir gelir döngüsünü aşar
    return nat.pool;
  };
  const az = mk(100), cok = mk(400);
  assert(az > 0, 'hiç gelir yatmadı');
  assert(cok > az * 3, `100 toprak ${az.toFixed(0)}, 400 toprak ${cok.toFixed(0)}`);
});

t('ödemeler kesikli: gelir tam onuncu tikte yatıyor', () => {
  const s = createSim(1);
  for (const n of s.nations) n.ai = false;
  const nat = s.nations[0];
  nat.cells = 200; nat.pool = 0;             // faizi devre dışı bırak
  const yatan = [];
  let prev = 0;
  for (let tik = 1; tik <= TICKS_PER_INCOME; tik++) {
    while (s.tickNo < tik) step(s, 0.02, 0.02);
    yatan.push(Math.round(nat.pool - prev));
    prev = nat.pool;
  }
  // ilk dokuz tikte hiçbir şey yatmamalı, onuncuda toplu ödeme
  assert.deepEqual(yatan.slice(0, 9), new Array(9).fill(0),
    `erken ödeme var: ${yatan.join(',')}`);
  const beklenen = Math.round(Math.pow(200, 1.18) * INCOME_SCALE);
  assert(Math.abs(yatan[9] - beklenen) <= 2,
    `onuncu tikte ${yatan[9]} yattı, ~${beklenen} beklendi`);
});

t('gösterge döngüyle tutarlı ilerliyor', () => {
  const s = createSim(1);
  for (const n of s.nations) n.ai = false;
  assert.equal(tickIndex(s), 0);
  assert.equal(ticksToIncome(s), TICKS_PER_INCOME);
  const p0 = tickProgress(s);
  step(s, TICK * 0.5, TICK * 0.5);
  assert(tickProgress(s) > p0, 'tik ilerlemesi artmıyor');
  assert(secsToIncome(s) > 0 && secsToIncome(s) <= TICKS_PER_INCOME * TICK,
    `geri sayım aralık dışı: ${secsToIncome(s)}`);
  // tam bir döngü sonunda başa dönmeli
  while (s.tickNo < TICKS_PER_INCOME) step(s, 0.02, 0.02);
  assert.equal(tickIndex(s), 0, 'döngü başa dönmedi');
});

t('gelir yatınca arayüz için olay üretiliyor', () => {
  const s = createSim(1);
  for (const n of s.nations) n.ai = false;
  let gelirOlayi = 0, tikOlayi = 0;
  while (s.tickNo < TICKS_PER_INCOME) {
    step(s, 0.02, 0.02);
    for (const f of s.fx) if (f.tip === 'tick') { tikOlayi++; if (f.income) gelirOlayi++; }
    s.fx.length = 0;
  }
  assert.equal(tikOlayi, TICKS_PER_INCOME, `${tikOlayi} tik olayı`);
  assert.equal(gelirOlayi, 1, `${gelirOlayi} gelir olayı`);
});

// Ekonomi hızlanınca havuz sürekli tavanda duruyor; bu iki yol daha önce
// kırpılmadığı için tavan aşılıyordu.
t('geri dönen sefer askeri tavanı aşırmaz', () => {
  const s = fresh();
  const nat = s.nations[0];
  const a = startAttack(s, nat, -1, nat.pool * 0.6);
  nat.pool = hardCap(s, nat);            // bu arada havuz tavana dolsun
  cancelAttack(s, a);
  assert(nat.pool <= hardCap(s, nat) + 1e-6,
    `${nat.pool.toFixed(0)} > ${hardCap(s, nat).toFixed(0)}`);
});

t('toprak kaybeden ulusun askeri yeni tavana kırpılır', () => {
  const s = fresh();
  const A = s.nations[0];
  let hedef = -1;
  for (let i = 1; i < s.nations.length; i++) if (findBorder(s, 0, i) >= 0) { hedef = i; break; }
  if (hedef < 0) return;
  const B = s.nations[hedef];
  B.pool = hardCap(s, B);                // savunan tam dolu
  A.pool = hardCap(s, A);
  startAttack(s, A, hedef, A.pool);
  for (let i = 0; i < 200; i++) {
    step(s, 1 / 30, 1 / 30);
    if (!B.alive) return;
    assert(B.pool <= hardCap(s, B) + 1e-6,
      `toprak ${B.cells}, tavan ${hardCap(s, B).toFixed(0)}, asker ${B.pool.toFixed(0)}`);
  }
});

t('asker sert tavanı aşamaz', () => {
  const s = createSim(1);
  for (const n of s.nations) n.ai = false;
  const nat = s.nations[0];
  nat.pool = hardCap(s, nat) * 5;            // yapay olarak taşır
  for (let i = 0; i < 200; i++) step(s, 0.05, 0.05);
  assert(nat.pool <= hardCap(s, nat) + 1, `${nat.pool} > ${hardCap(s, nat)}`);
});

t('dalga ölçekten bağımsız olarak izlenebilir sürede akıyor', () => {
  // küçük ve büyük saldırı benzer sürede bitmeli (hız askere göre ayarlanıyor)
  const sure = (troops) => {
    const s = createSim(5);
    for (const n of s.nations) n.ai = false;
    const nat = s.nations[0];
    nat.pool = troops;
    const a = startAttack(s, nat, -1, troops);
    if (!a) return null;
    let ticks = 0;
    while (s.attacks.includes(a) && ticks < 3000) { step(s, 1 / 60, 1 / 60); ticks++; }
    return ticks / 60;
  };
  const kucuk = sure(400), buyuk = sure(20000);
  if (kucuk === null || buyuk === null) return;
  assert(buyuk < kucuk * 4, `küçük ${kucuk.toFixed(1)}sn, büyük ${buyuk.toFixed(1)}sn`);
  console.log(`      → 400 asker ${kucuk.toFixed(1)}sn, 20000 asker ${buyuk.toFixed(1)}sn`);
});

// ---------------------------------------------------------------- borç

console.log('\nBorçlanma');

t('elindekinden fazlasını sefere sürebilirsin', () => {
  const s = fresh();
  const nat = s.nations[0];
  const elde = nat.pool;
  const a = startAttack(s, nat, -1, elde + maxDebt(s, nat) * 0.5);
  assert(a, 'borçlu sefer başlamadı');
  assert(a.troops > elde, `sürülen ${a.troops} ≤ elindeki ${elde}`);
  assert(nat.pool < 0, `asker eksiye düşmedi: ${nat.pool}`);
  assert(inDebt(nat));
});

t('borç tavanı aşılamaz', () => {
  const s = fresh();
  const nat = s.nations[0];
  const tavan = maxCommit(s, nat);
  const a = startAttack(s, nat, -1, tavan * 10);
  assert(a.troops <= tavan + 1e-6, `${a.troops} > ${tavan}`);
  assert(nat.pool >= -maxDebt(s, nat) - 1e-6, `borç tavanı aşıldı: ${nat.pool}`);
});

t('borçtayken yeni sefere çıkılamaz', () => {
  const s = fresh();
  const nat = s.nations[0];
  startAttack(s, nat, -1, nat.pool + maxDebt(s, nat) * 0.6);
  assert(inDebt(nat));
  assert.equal(canAttack(s, nat, -1), false, 'borçluyken saldırabildi');
  assert.equal(startAttack(s, nat, -1, 100), null);
});

t('gelen gelir borcu kapatır', () => {
  const s = fresh();
  for (const n of s.nations) n.ai = false;
  const nat = s.nations[0];
  startAttack(s, nat, -1, nat.pool + maxDebt(s, nat) * 0.5);
  const borc = nat.pool;
  assert(borc < 0);
  for (let i = 0; i < 600; i++) step(s, 0.05, 0.05);
  assert(nat.pool > borc, `borç azalmadı: ${borc.toFixed(0)} → ${nat.pool.toFixed(0)}`);
});

t('borç kendi faiziyle büyür — bedava kredi değil', () => {
  const s = createSim(9);
  for (const n of s.nations) n.ai = false;
  const nat = s.nations[0];
  nat.cells = 0;                       // gelir olmasın ki sadece faiz görünsün
  nat.pool = -1000;
  for (let i = 0; i < 200; i++) step(s, 0.05, 0.05);   // 10 sn
  assert(nat.pool < -1000, `borç büyümedi: ${nat.pool.toFixed(1)}`);
});

t('borç kapanınca normal faize dönülür', () => {
  const s = fresh();
  for (const n of s.nations) n.ai = false;
  const nat = s.nations[0];
  startAttack(s, nat, -1, nat.pool + maxDebt(s, nat) * 0.35);
  assert(inDebt(nat));
  for (let i = 0; i < 4000 && inDebt(nat); i++) step(s, 0.05, 0.05);
  assert(!inDebt(nat), `borç kapanmadı: ${nat.pool.toFixed(0)}`);
  const once = nat.pool;
  for (let i = 0; i < 200; i++) step(s, 0.05, 0.05);
  assert(nat.pool > once, 'borç sonrası büyüme durmuş');
});

t('borçlu ulusun savunma bedeli tabanın altına inmez', () => {
  const s = fresh();
  const hedef = s.nations[1];
  hedef.cells = 200; hedef.pool = 500;
  const normal = attackCost(s, hedef.id);
  hedef.pool = -5000;
  const borclu = attackCost(s, hedef.id);
  assert(borclu > 0 && borclu <= normal,
    `borçluyken bedel ${borclu}, normalde ${normal}`);
});

t('borç tavanı toprakla büyür', () => {
  const s = fresh();
  const nat = s.nations[0];
  nat.cells = 100;
  const az = maxDebt(s, nat);
  nat.cells = 1000;
  assert(maxDebt(s, nat) > az * 5, 'borç tavanı toprakla artmıyor');
});

// ---------------------------------------------------------------- ittifak

console.log('\nİttifak');

t('ittifak karşılıklı kurulur', () => {
  const s = fresh();
  assert(formAlliance(s, s.nations[0], s.nations[1]));
  assert(allied(s.nations[0], s.nations[1]));
  assert(allied(s.nations[1], s.nations[0]));
});

t('müttefike saldırılamaz', () => {
  const s = fresh();
  formAlliance(s, s.nations[0], s.nations[1]);
  assert.equal(canAttack(s, s.nations[0], 1), false);
  assert.equal(startAttack(s, s.nations[0], 1, 500), null);
});

t('ittifakı bozan 20 saniye saldıramaz', () => {
  const s = fresh();
  const A = s.nations[0], B = s.nations[1];
  formAlliance(s, A, B);
  assert(!locked(s, A));
  breakAlliance(s, A, B);
  assert(locked(s, A), 'ceza uygulanmadı');
  assert(!locked(s, B), 'bozulan taraf da cezalandırıldı');
  assert.equal(startAttack(s, A, -1, A.pool * 0.5), null, 'cezalıyken saldırabildi');

  s.realT += BETRAY_LOCK + 0.1;
  assert(!locked(s, A), 'ceza bitmedi');
  assert(startAttack(s, A, -1, A.pool * 0.5), 'ceza sonrası saldıramadı');
});

t('ittifak bozulunca süren seferler geri çağrılır', () => {
  const s = fresh();
  const A = s.nations[0], B = s.nations[1];
  formAlliance(s, A, B);
  startAttack(s, A, -1, A.pool * 0.5);
  assert.equal(s.attacks.filter(a => a.from === A.id).length, 1);
  breakAlliance(s, A, B);
  assert.equal(s.attacks.filter(a => a.from === A.id).length, 0, 'sefer sürüyor');
});

t('ittifak bozma çift yönlü siler', () => {
  const s = fresh();
  const A = s.nations[0], B = s.nations[1];
  formAlliance(s, A, B);
  breakAlliance(s, A, B);
  assert(!allied(A, B) && !allied(B, A));
});

// ---------------------------------------------------------------- bütünlük

console.log('\nUzun süreli çalışma');

t('900 oyun-saniyesi hatasız koşar', () => {
  const s = createSim(2024);
  for (let i = 0; i < 18000; i++) step(s, 0.05, 0.05);
  assert(s.t > 890);
});

t('hücre sayaçları haritayla tutarlı kalır', () => {
  const s = createSim(31337);
  for (let i = 0; i < 8000; i++) step(s, 0.05, 0.05);
  const real = new Array(s.nations.length).fill(0);
  for (let i = 0; i < W * H; i++) if (s.owner[i] >= 0) real[s.owner[i]]++;
  for (const n of s.nations)
    assert.equal(n.cells, real[n.id], `${n.name}: sayaç ${n.cells}, gerçek ${real[n.id]}`);
});

t('ölü uluslar toprak, sefer ve ittifak bırakmaz', () => {
  const s = createSim(555);
  for (let i = 0; i < 14000; i++) step(s, 0.05, 0.05);
  for (const n of s.nations) {
    if (n.alive) continue;
    assert.equal(n.cells, 0, `${n.name} ölü ama toprağı var`);
    assert.equal(s.attacks.filter(a => a.from === n.id).length, 0);
    assert.equal(n.allies.size, 0);
  }
});

t('asker havuzu tavanı aşmaz, negatife düşmez', () => {
  const s = createSim(8080);
  for (let i = 0; i < 10000; i++) {
    step(s, 0.05, 0.05);
    if (i % 700) continue;
    for (const n of s.nations) {
      if (!n.alive) continue;
      assert(n.pool >= 0, `${n.name} negatif asker`);
      assert(n.pool <= troopCap(s, n) + 1, `${n.name} tavanı aştı`);
    }
  }
});

t('yapay zekâ fiilen saldırıyor ve harita doluyor', () => {
  const s = createSim(4711);
  for (let i = 0; i < 8000; i++) step(s, 0.05, 0.05);
  let tarafsiz = 0;
  for (let i = 0; i < W * H; i++) if (s.world.isLand[i] && s.owner[i] === -1) tarafsiz++;
  const oran = tarafsiz / s.landCells;
  assert(oran < 0.5, `haritanın %${(oran * 100).toFixed(0)}'ı hâlâ boş — YZ saldırmıyor`);
  console.log(`      → 400 sn sonra harita %${((1 - oran) * 100).toFixed(0)} paylaşılmış`);
});

t('yapay zekâ ittifak kuruyor', () => {
  const s = createSim(99);
  let gordu = false;
  for (let i = 0; i < 12000 && !gordu; i++) {
    step(s, 0.05, 0.05);
    gordu = s.nations.some(n => n.alive && n.allies.size > 0);
  }
  assert(gordu, 'hiç ittifak kurulmadı');
});

t('oyun bir lidere doğru gidiyor ve zafer eşiği ulaşılabilir', () => {
  const zirveler = [];
  let kazanan = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = createSim(seed);
    let zirve = 0;
    for (let i = 0; i < 60000; i++) {
      step(s, 0.05, 0.05);
      const top = [...s.nations].sort((a, b) => b.cells - a.cells)[0];
      zirve = Math.max(zirve, landFrac(s, top));
      if (zirve >= WIN_FRAC) break;
    }
    zirveler.push(zirve);
    if (zirve >= WIN_FRAC) kazanan++;
  }
  const ort = zirveler.reduce((a, b) => a + b) / zirveler.length;
  console.log(`      → 6 tohumun ${kazanan}'ında eşik geçildi, ortalama zirve %${(ort * 100).toFixed(0)}`);
  assert(ort > 0.3, `oyun tıkanıyor, ortalama zirve sadece %${(ort * 100).toFixed(0)}`);
});

console.log(`\n${pass} geçti, ${fail} kaldı\n`);
process.exit(fail ? 1 : 0);
