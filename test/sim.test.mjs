// Başsız simülasyon testi. sim.js hiçbir tarayıcı API'sine dokunmaz.

import assert from 'node:assert';
import {
  createSim, step, startAttack, cancelAttack, canAttack, attackCost,
  formAlliance, breakAlliance, allied, locked, landFrac, troopCap,
  density, power, BETRAY_LOCK, WIN_FRAC,
  interestRate, softCap, hardCap, maxDebt, maxCommit, inDebt,
  TICK, TICKS_PER_INCOME, tickProgress, tickIndex, ticksToIncome, secsToIncome,
  incomePayout, INCOME_SCALE, frontCost, frontStats, cellCost, minCells, ALLY_SECS,
  LANDING_MULT,
} from '../js/sim.js';
import { W, H, idx, STRAIT_MAX } from '../js/world.js';

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

// Hamle TAM HALKAYA yuvarlanır (cephe hep tek parça ilerlesin diye), o yüzden
// düşen miktar istenen değil, ona en yakın halka katıdır.
t('saldırı havuzdan tam halka kadar asker düşürür', () => {
  const s = fresh();
  const nat = s.nations[0];
  const before = nat.pool;
  const halka = frontCost(s, nat, -1);
  const a = startAttack(s, nat, -1, before * 0.5);
  assert(a, 'saldırı başlamadı');
  const dusen = before - nat.pool;
  assert(Math.abs(dusen - a.start) < 1e-6, 'düşen miktar sefere sürülenle uyuşmuyor');
  const kat = dusen / halka;
  assert(Math.abs(kat - Math.round(kat)) < 1e-6,
    `tam halka katı değil (${kat.toFixed(3)} halka)`);
  assert(Math.abs(dusen - before * 0.5) <= halka,
    `yuvarlama bir halkadan fazla saptı (${dusen.toFixed(0)} / ${(before * 0.5).toFixed(0)})`);
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

// Hazinesi dolu bir düşman gerçek bir kaledir: bedel yoğunlukla üstel artar.
t('bedel yoğunlukla üstel artar — kalabalık ordu kaledir', () => {
  const s = fresh();
  const n = s.nations[1];
  n.cells = 400;
  // Yoğunluklar tavandan türetilir; sabit sayı yazmak tavan değişince testi
  // anlamsız kılıyordu (10 kat büyüyen tavanda 17 artık "dolu" değil).
  const bedel = (d) => { n.pool = d * 400; return attackCost(s, 1); };
  // dışbükeylik için EŞİT aralıklı örnekle: 0, tavanın yarısı, tavan
  const sert = hardCap(s, n) / 400;
  const bos = bedel(0), yari = bedel(sert / 2), dolu = bedel(sert);
  // ikinci yarıdaki artış birincidekinden BÜYÜK olmalı (dışbükey eğri)
  assert(dolu - yari > yari - bos,
    `eğri doğrusal/içbükey: ${bos.toFixed(1)} → ${yari.toFixed(1)} → ${dolu.toFixed(1)}`);
  assert(dolu > bos * 8, `dolu hazine yeterince caydırıcı değil (${(dolu/bos).toFixed(1)} kat)`);
});

t('kalabalık ordu daha pahalıya saldırılır', () => {
  const s = fresh();
  const zayif = s.nations[1], guclu = s.nations[2];
  // aynı toprak, biri neredeyse boş biri tavanına yakın dolu
  zayif.cells = 400; zayif.pool = 400;                  // yoğunluk 1
  guclu.cells = 400; guclu.pool = hardCap(s, guclu);    // yoğunluk 60
  // yoğunluk bedele ÜSTEL girdiği için fark katbekat olmalı
  assert(attackCost(s, guclu.id) > attackCost(s, zayif.id) * 5,
    `${attackCost(s, zayif.id).toFixed(1)} vs ${attackCost(s, guclu.id).toFixed(1)}`);
});

// Çarpışmada İKİ taraf da erir: saldıran hücrenin bedelini öder, savunan
// bunun DEF_LOSS katını kaybeder — yani saldırının faturası daha ağırdır.
t('çarpışmada iki taraf da erir, saldıran daha çok verir', () => {
  const s = fresh();
  const A = s.nations[0];
  let hedef = -1;
  for (let i = 1; i < s.nations.length; i++) if (findBorder(s, 0, i) >= 0) { hedef = i; break; }
  if (hedef < 0) return;
  const B = s.nations[hedef];
  B.pool = 40000;                          // tavana takılmasın diye bol asker
  const onceB = B.pool, onceCells = B.cells;
  A.pool = 400000;
  const onceA = A.pool;
  const atk = startAttack(s, A, hedef, 120000);
  assert(atk, 'saldırı başlamadı');
  for (let i = 0; i < 30; i++) step(s, 1 / 30, 1 / 30);
  const alinan = onceCells - B.cells;
  assert(alinan > 0, 'hiç hücre alınmadı');
  const savunanKaybi = onceB - B.pool;
  // saldıranın harcadığı: cepheye sürdüğü eksi cephede kalan
  const saldiraninKaybi = (onceA - A.pool) - atk.troops;
  assert(savunanKaybi > 0, 'savunan hiç asker kaybetmedi');
  assert(saldiraninKaybi > savunanKaybi * 1.15,
    `saldıran ${saldiraninKaybi.toFixed(0)}, savunan ${savunanKaybi.toFixed(0)} kaybetti `
    + '— saldıranın faturası daha ağır olmalı');
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

// Cephe, hedefle paylaşılan BÜTÜN sınır hattıdır: dalga her yerden eşit
// başlar. Ölçüm uzun ve düz bir sınır üzerinde yapılır ki uçlar ayırt edilsin.
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
  // Bu kurulum KARA cephesini yalıtır. Şeridin üst sırası kıyıya denk gelip
  // cepheye bir çıkarma hücresi sokabiliyor (ölçüldü: 130 hücrenin 1'i) ve
  // çıkarma hücresi LANDING_MULT katı fiyatlandığı için buradaki düz fiyat
  // modeli sahte sapma gösteriyordu. Boğaz bağları kapatılıyor; çıkarmanın
  // korunumu kendi testinde ('deniz çıkarması yoktan asker üretmez') ölçülür.
  s.world.straitHead.fill(-1);
  const bx = bas % W, by = (bas / W) | 0;
  for (const n of s.nations) n.cells = 0;
  s.owner.fill(-1);
  for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 60; dx++) {
    s.owner[idx(bx + dx, by + dy)] = nat.id; nat.cells++;
  }
  nat.pool = hardCap(s, nat);
  return { s, nat, bx, by };
}

t('cephe sınırın iki ucuna birden uzanır', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat, bx } = g;
  const atk = startAttack(s, nat, -1, nat.pool);
  assert(atk, 'saldırı başlamadı');
  const xs = atk.layer.map(c => c % W);
  assert(Math.min(...xs) <= bx + 2 && Math.max(...xs) >= bx + 57,
    `cephe şeridin tamamını kapsamıyor (${Math.min(...xs)}..${Math.max(...xs)})`);
});

t('dalga sınırın her yerinde aynı anda ilerler', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat, bx, by } = g;
  startAttack(s, nat, -1, nat.pool);
  for (let i = 0; i < 40; i++) step(s, 0.05, 0.05);
  // şeridin altı kesin karadır (kurulumda 10 sıra kara arandı); sol ve sağ
  // uçların ikisinde de aşağı doğru toprak kazanılmış olmalı
  const kazanildi = (x) => {
    for (let dy = 6; dy <= 9; dy++) if (s.owner[idx(x, by + dy)] === nat.id) return true;
    return false;
  };
  assert(kazanildi(bx + 3) && kazanildi(bx + 56),
    'dalga sınırın yalnız bir bölümünde ilerlemiş');
});

// Cephenin TAMAMI aynı anda ilerler: bütçe bütün sınır hücrelerine eşit
// dağıtılır, hücre ancak kuşatma ilerlemesi dolunca el değiştirir. Böylece
// az asker sürmek sınırı boydan boya biraz iter — bir bölümünü çok değil.
function sinirHucreleri(s, nat, target) {
  const out = [];
  for (let c = 0; c < W * H; c++) {
    if (s.owner[c] !== target) continue;
    if (target < 0 && !s.world.isLand[c]) continue;
    const x = c % W;
    const nb = [];
    if (x > 0) nb.push(c - 1);
    if (x < W - 1) nb.push(c + 1);
    if (c >= W) nb.push(c - W);
    if (c < W * (H - 1)) nb.push(c + W);
    if (nb.some(n => s.owner[n] === nat.id)) out.push(c);
  }
  return out;
}

t('en küçük hamle bütün sınırı bir hücre iter — yarım halka kalmaz', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  const sinir = sinirHucreleri(s, nat, -1);
  // kaydıraç çeyrek halka dese bile hamle tam halkaya yuvarlanır
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1) * 0.25);
  assert(a, 'saldırı başlamadı');
  for (let i = 0; i < 300 && s.attacks.length; i++) step(s, 1 / 30, 1 / 30);
  const alinmayan = sinir.filter(c => s.owner[c] !== nat.id).length;
  assert.equal(alinmayan, 0,
    `${alinmayan}/${sinir.length} sınır hücresi alınmadı — cephe tırtıklı kaldı`);
  let iz = 0;
  for (let c = 0; c < W * H; c++) if (s.prog[c] > 0.01) iz++;
  assert.equal(iz, 0, `${iz} hücrede yarım kuşatma izi kalmış`);
});

t('küçük hamle bütün sınırı eşit ilerletir', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  const sinir = sinirHucreleri(s, nat, -1);
  const cephe = frontCost(s, nat, -1);
  startAttack(s, nat, -1, cephe * 0.25);        // çeyrek halka
  // dalga ~ATTACK_SECS sürer; sefer SÜRERKEN ölç (bitince bozdurulur)
  for (let i = 0; i < 50; i++) step(s, 1 / 30, 1 / 30);
  const p = sinir.map(c => s.prog[c]);
  const enAz = Math.min(...p), enCok = Math.max(...p);
  // asıl mesele EŞİTLİK: hiçbir hücre geride kalmamalı
  assert(enAz > 0.05, `sınırın bir kısmı hiç ilerlememiş (en az ${enAz.toFixed(2)})`);
  assert(enCok - enAz < 0.08,
    `ilerleme eşit değil: ${enAz.toFixed(2)} ile ${enCok.toFixed(2)} arası`);
  assert(nat.cells === g.nat.cells, 'çeyrek hamle sürerken hücre el değiştirmemeli');
});

t('art arda küçük hamleler birikip halkayı düşürür', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  const once = nat.cells;
  const cephe = frontCost(s, nat, -1);
  // dörtte birlik dört hamle = bir halka
  // art arda: her hamle bitince hemen bir sonraki (sönümleme payı içinde)
  for (let k = 0; k < 4; k++) {
    nat.pool = hardCap(s, nat);
    startAttack(s, nat, -1, cephe * 0.28);
    for (let i = 0; i < 115; i++) step(s, 1 / 30, 1 / 30);
  }
  assert(nat.cells > once,
    `biriken ilerleme hiç toprak getirmedi (${once} → ${nat.cells})`);
});

t('bir hücre dolmadan el değiştirmez', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  startAttack(s, nat, -1, frontCost(s, nat, -1) * 0.5);
  for (let i = 0; i < 50; i++) step(s, 1 / 30, 1 / 30);
  for (let c = 0; c < W * H; c++)
    assert(!(s.owner[c] === nat.id && s.prog[c] > 0),
      'el değişen hücrede kuşatma ilerlemesi kalmış');
});

t('sefer bitince kuşatma bozdurulur — haritada iz kalmaz', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  const cephe = frontCost(s, nat, -1);
  const birim = attackCost(s, -1);
  const once = nat.cells;
  startAttack(s, nat, -1, cephe * 0.3);
  for (let i = 0; i < 50; i++) step(s, 1 / 30, 1 / 30);
  let kusatilan = 0;
  for (let c = 0; c < W * H; c++) if (s.prog[c] > 0.01) kusatilan++;
  assert(kusatilan > 10, `sefer sürerken kuşatma görünmüyor (${kusatilan})`);

  // sefer bitsin
  for (let i = 0; i < 200; i++) step(s, 1 / 30, 1 / 30);
  assert.equal(s.attacks.length, 0, 'sefer bitmedi');
  let kalan = 0;
  for (let c = 0; c < W * H; c++) if (s.prog[c] > 0.01) kalan++;
  assert.equal(kalan, 0, `${kalan} hücrede yarım kuşatma izi kalmış`);

  // sürülen asker heba olmamalı: ~%30'luk pay kadar hücre alınmış olmalı
  const alinan = nat.cells - once;
  const beklenen = cephe * 0.3 / birim;
  assert(alinan >= beklenen * 0.75,
    `bozdurma askeri heba etti: ${alinan} hücre, ~${beklenen.toFixed(0)} beklendi`);
});

// ---------------------------------------------------------------- dağılma

console.log('\nKüçülen ulusun dağılması');

t('küçülen ulus dağılır, kırıntısı fatihe değil boşluğa gider', () => {
  const s = fresh();
  const A = s.nations[0];
  let hedef = -1;
  for (let i = 1; i < s.nations.length; i++) if (findBorder(s, 0, i) >= 0) { hedef = i; break; }
  if (hedef < 0) return;
  const B = s.nations[hedef];
  const esik = minCells(s);
  assert(esik >= 10 && esik < B.cells, `eşik makul değil (${esik} / ${B.cells})`);
  const bOnce = [];
  for (let c = 0; c < W * H; c++) if (s.owner[c] === B.id) bOnce.push(c);
  B.pool = 0;
  A.pool = 1e7;
  startAttack(s, A, hedef, 1e6);
  for (let i = 0; i < 900; i++) step(s, 1 / 30, 1 / 30);

  assert(!B.alive, 'ulus hâlâ ayakta');
  assert.equal(B.cells, 0, 'dağılan ulusun hücre sayacı sıfırlanmadı');
  let kalinti = 0, sahipsiz = 0;
  for (const c of bOnce) {
    if (s.owner[c] === B.id) kalinti++;
    if (s.owner[c] === -1) sahipsiz++;
  }
  assert.equal(kalinti, 0, `${kalinti} hücre dağılan ulusta kalmış`);
  // eşik altındaki kırıntı fethedilmez, sahipsiz kalır
  assert(sahipsiz > 0, 'dağılan ulusun toprağı hiç sahipsiz kalmadı');
});

// ------------------------------------------------------- sefer muhasebesi

console.log('\nSefer muhasebesi');

t('geri çağırma hazineyi tam olarak geri verir', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  const once = nat.pool;
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1) * 2);
  for (let i = 0; i < 30; i++) step(s, 1 / 30, 1 / 30);   // yarım halka birikti
  cancelAttack(s, a);
  assert(Math.abs(nat.pool - once) < 1e-6,
    `iade eksik/fazla: ${once.toFixed(2)} → ${nat.pool.toFixed(2)}`);
});

// Kuşatma ilerlerken savunanı kanatmak bedava hasar demekti: yarım kalan
// kuşatma saldırana iade edilirken savunanın kaybı kalıcı oluyordu.
t('hiç hücre alınmadan savunan kanamaz', () => {
  const s = fresh();
  const A = s.nations[0];
  let hedef = -1;
  for (let i = 1; i < s.nations.length; i++) if (findBorder(s, 0, i) >= 0) { hedef = i; break; }
  if (hedef < 0) return;
  const B = s.nations[hedef];
  B.pool = 30000;
  const onceB = B.pool, onceCells = B.cells;
  A.pool = 1e6;
  const a = startAttack(s, A, hedef, frontCost(s, A, hedef) * 2);
  for (let i = 0; i < 20; i++) step(s, 1 / 30, 1 / 30);
  if (B.cells !== onceCells) return;                 // hücre düştüyse test konusu değil
  cancelAttack(s, a);
  assert(Math.abs(B.pool - onceB) < 1e-6,
    `savunan hücre kaybetmeden ${(onceB - B.pool).toFixed(0)} asker yitirdi`);
});

t('ölen ulusun seferi haritada kuşatma izi bırakmaz', () => {
  const s = fresh();
  const A = s.nations[0];
  let hedef = -1;
  for (let i = 1; i < s.nations.length; i++) if (findBorder(s, 0, i) >= 0) { hedef = i; break; }
  if (hedef < 0) return;
  A.pool = 1e6;
  startAttack(s, A, hedef, frontCost(s, A, hedef) * 2);
  for (let i = 0; i < 20; i++) step(s, 1 / 30, 1 / 30);
  let kusatma = 0;
  for (let c = 0; c < W * H; c++) if (s.prog[c] > 0.01) kusatma++;
  assert(kusatma > 0, 'kuşatma oluşmadı');
  // saldıranı öldür — seferi listeden çıkarken izini de silmeli
  for (let c = 0; c < W * H; c++) if (s.owner[c] === A.id) { s.owner[c] = -1; }
  A.cells = 0;
  step(s, 1 / 30, 1 / 30);
  let kalan = 0;
  for (let c = 0; c < W * H; c++) if (s.prog[c] > 0.01) kalan++;
  assert.equal(kalan, 0, `${kalan} hücrede sahipsiz kuşatma izi kalmış`);
});

t('ittifak bozulunca kuşatma izi de temizlenir', () => {
  const s = fresh();
  const A = s.nations[0], B = s.nations[1];
  formAlliance(s, A, B);
  A.pool = 1e6;
  const a = startAttack(s, A, -1, frontCost(s, A, -1) * 2);
  assert(a, 'saldırı başlamadı');
  for (let i = 0; i < 20; i++) step(s, 1 / 30, 1 / 30);
  breakAlliance(s, A, B);
  let kalan = 0;
  for (let c = 0; c < W * H; c++) if (s.prog[c] > 0.01) kalan++;
  assert.equal(kalan, 0, `${kalan} hücrede kuşatma izi kalmış`);
  assert.equal(s.attacks.filter(x => x.from === A.id).length, 0, 'sefer kapanmadı');
});

// Cephe zaten hedefle paylaşılan BÜTÜN sınır hattıdır; ikinci sefer NESNESİ
// yeni bir yere yüklenmez, aynı hücrelerin `prog`unu paylaşırdı. İki ayrı
// `yatirim` defteri tutulunca biri kapanırken ötekinin kuşatmasını haritadan
// siliyor ama alacağı defterde kalıyor, iadede yoktan asker doğuyordu.
// Çözüm ikinci seferi reddetmek değil, TAKVİYEYE çevirmek: tek dalga, tek defter.
t('aynı hedefe dokunmak ikinci sefer açmaz, takviye eder', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  const cephe = frontCost(s, nat, -1);
  nat.pool = hardCap(s, nat);
  const a = startAttack(s, nat, -1, cephe * 2);
  assert(a, 'ilk sefer başlamadı');
  const b = startAttack(s, nat, -1, cephe * 2);
  assert.equal(b, a, 'takviye var olan sefere gitmedi');
  assert.equal(s.attacks.filter(x => x.from === nat.id).length, 1, 'ikinci sefer açıldı');
  assert.equal(a.takviye, 1, 'takviye sayacı işlemedi');
});

t('takviye cephedeki asker sayısını artırır', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  const cephe = frontCost(s, nat, -1);
  nat.pool = hardCap(s, nat);
  const a = startAttack(s, nat, -1, cephe * 2);
  const cepheOnce = a.troops, havuzOnce = nat.pool;
  startAttack(s, nat, -1, cephe * 3);
  const giden = havuzOnce - nat.pool;
  assert(giden > 0, 'takviye hazineden asker düşürmedi');
  assert(Math.abs((a.troops - cepheOnce) - giden) < 1e-6,
    `hazineden ${giden.toFixed(1)} çıktı ama cepheye ${(a.troops - cepheOnce).toFixed(1)} eklendi`);
  assert(a.start > cepheOnce, 'toplam taahhüt güncellenmedi (ilerleme çubuğu bozulur)');
});

// "cephenin gidişi" = a.rate. Takviye gelince dalga kalan TOPLAM askere göre
// yeniden hesaplanmalı, yoksa iki katı asker eski hızla akar ve cephe sürüncemede kalır.
t('takviye cephenin hızını yeniden hesaplar', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  const cephe = frontCost(s, nat, -1);
  nat.pool = hardCap(s, nat);
  const a = startAttack(s, nat, -1, cephe * 2);
  const hizOnce = a.rate;
  // Hız cephenin ORTALAMA hücre bedeline göre kurulur — şehir halkasından
  // geçen cephede hücreler tek tek pahalıdır, tek bir taban bedel yetmez.
  const birim = frontStats(s, nat).get(-1).birim;
  startAttack(s, nat, -1, cephe * 2);
  assert(a.rate > hizOnce, `hız güncellenmedi: ${hizOnce.toFixed(2)} → ${a.rate.toFixed(2)}`);
  // dalga yine ~ATTACK_SECS saniyede akmalı (taban hız devrede değilse)
  const beklenen = (a.troops / birim) / 3.6;
  if (beklenen > 7) assert(Math.abs(a.rate - beklenen) < 1e-6,
    `hız ${a.rate.toFixed(2)}, beklenen ${beklenen.toFixed(2)}`);
});

// Takviye, yeni seferle AYNI kurallara tabi: borçluyken çıkılamaz, borç
// tavanı aşılamaz, bir halkaya yetmeyen talep reddedilir.
t('borçluyken takviye gönderilemez', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  nat.pool = hardCap(s, nat);
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1));
  const cepheOnce = a.troops;
  nat.pool = -1;                                  // borçlu
  assert.equal(startAttack(s, nat, -1, frontCost(s, nat, -1) * 5), null,
    'borçluyken takviye engellenmedi');
  assert.equal(a.troops, cepheOnce, 'reddedilen takviye cepheye yine de eklendi');
});

t('bir halkaya yetmeyen takviye reddedilir', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  nat.pool = hardCap(s, nat);
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1));
  nat.pool = 0;                                   // hazine boş
  const cepheOnce = a.troops;
  assert.equal(startAttack(s, nat, -1, 1), null, 'yetersiz takviye kabul edildi');
  assert.equal(nat.pool, 0, 'reddedilen takviye hazineye dokundu');
  assert.equal(a.troops, cepheOnce, 'reddedilen takviye cepheye eklendi');
});

// Asıl güvence bu: takviye ne asker üretmeli ne yutmalı. Değişmez —
//   havuz + cephedeki asker + haritadaki kuşatma + alınan toprağın bedeli
// büyüme tiki dışında SABİT kalmalı. Takviye değeri havuzdan cepheye taşır,
// toplamı değiştirmez.
// Bu ölçüt `stepAttacks`'teki 0.999 eşiğinin hücreleri binde bir ucuza
// kapatmasını da yakalar (84 hücrelik halkada +0.4 asker yoktan doğuyordu).
t('takviye yoktan asker üretmez', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  for (const n of s.nations) n.ai = false;        // dışarıdan toprak el değiştirmesin
  const K = attackCost(s, -1);
  // Hücre bedeli artık cephe boyunca sabit değil (şehir halkası pahalı), o
  // yüzden hem kuşatma hem de alınan toprak HÜCRE HÜCRE fiyatlanmalı — tek
  // skalerle ölçmek şehirden geçen bir cepheyi sahte sapma gibi gösterirdi.
  const cd = s.world.cityDef;
  const toprak = () => {
    let v = 0;
    for (let c = 0; c < W * H; c++) if (s.owner[c] === nat.id) v += K * cd[c];
    return v;
  };
  const t0 = toprak();
  const kusatma = () => {
    let p = 0;
    for (let c = 0; c < W * H; c++) if (s.progBy[c] === nat.id) p += s.prog[c] * K * cd[c];
    return p;
  };
  const V = () => nat.pool + s.attacks.filter(a => a.from === nat.id)
    .reduce((t, a) => t + a.troops, 0) + kusatma() + (toprak() - t0);

  const halka = frontCost(s, nat, -1);
  nat.pool = hardCap(s, nat);      // hazine BİR KEZ dolar; döngü içinde asker
  startAttack(s, nat, -1, halka * 3);   // eklemek ölçülen değeri bozardı
  let once = V(), enBuyuk = 0, takviye = 0;
  for (let i = 0; i < 600; i++) {
    const tikOnce = s.tickNo;
    step(s, 1 / 60, 1 / 60);
    if (i % 45 === 0 && startAttack(s, nat, -1, halka * 2)) takviye++;
    const v = V();
    // büyüme tikinin yattığı kareyi atla — orada havuz bilerek büyür
    if (s.tickNo === tikOnce) enBuyuk = Math.max(enBuyuk, Math.abs(v - once));
    once = v;
  }
  assert(takviye >= 3, `takviye gitmedi (${takviye}) — ölçüm boş`);
  assert(enBuyuk < 0.01,
    `bir karede ${enBuyuk.toFixed(4)} asker yoktan doğdu/yok oldu (${takviye} takviye)`);
});

// Hücre `prog >= 0.999`'da düşmüş sayılır (prog bir Float32Array, tam 1'e
// oturmayabilir). Eşiği geçen hücre TAM bedelini ödemezse her halkada binde
// bir asker yoktan doğar. Rastlantıya bırakmadan kuralım: cepheyi eşiğin hemen
// altına getirip, eşiği ancak aşacak kadar küçük bir bütçeyle bir kare işlet.
t('eşiği geçen hücre tam bedelini öder', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  for (const n of s.nations) n.ai = false;
  const K = attackCost(s, -1);
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1) * 3);
  assert(a, 'sefer başlamadı');
  const canli = a.layer.filter(c => s.owner[c] === -1);
  assert(canli.length > 20, `cephe çok kısa (${canli.length})`);
  const cd = s.world.cityDef;
  for (const c of canli) { s.prog[c] = 0.9985; s.progBy[c] = nat.id; }
  // defter haritayla hizalansın — hücre bedeli şehir halkasında değişir
  a.yatirim = canli.reduce((t, c) => t + 0.9985 * K * cd[c], 0);
  a.rate = canli.length * 0.001 * 60;             // pay ≈ 0.001 → 0.9995'te düşer
  s.tickAcc = 0;                                  // tek karede büyüme tiki olmasın

  const toprak = () => {
    let v = 0;
    for (let c = 0; c < W * H; c++) if (s.owner[c] === nat.id) v += K * cd[c];
    return v;
  };
  const t0 = toprak();
  const c0 = nat.cells;
  const kusatma = () => {
    let p = 0;
    for (let c = 0; c < W * H; c++) if (s.progBy[c] === nat.id) p += s.prog[c] * K * cd[c];
    return p;
  };
  const V = () => nat.pool + s.attacks.filter(x => x.from === nat.id)
    .reduce((t, x) => t + x.troops, 0) + kusatma() + (toprak() - t0);

  const once = V();
  step(s, 1 / 60, 1 / 60);
  assert(nat.cells > c0, 'kurulum tutmadı — hiç hücre düşmedi');
  const sapma = V() - once;
  assert(sapma < 0.01,
    `eşikte ${sapma.toFixed(4)} asker yoktan doğdu (${nat.cells - c0} hücre düştü)`);
});

t('takviye borç tavanını aşamaz', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  nat.pool = hardCap(s, nat);
  startAttack(s, nat, -1, frontCost(s, nat, -1));
  startAttack(s, nat, -1, 1e9);                   // kaydıraç sonuna dayalı
  assert(nat.pool >= -maxDebt(s, nat) - 1e-6,
    `borç tavanı aşıldı: ${nat.pool.toFixed(1)} < ${(-maxDebt(s, nat)).toFixed(1)}`);
});

// Seferin `yatirim` defteri = haritada FİİLEN duran kuşatmanın bedeli. İkinci
// sefer bu ikisini ayırıyordu: biri kapanınca ötekinin ilerlemesini haritadan
// siliyor ama alacağı defterde kalıyor, iade sırasında yoktan asker doğuyordu.
// (Ekonomiden bağımsız bir ölçüt: büyüme bu invaryanta karışmaz.)
t('sefer defteri haritadaki kuşatmayla birebir tutar', () => {
  const g = genisSinirliSim();
  if (!g) return;
  const { s, nat } = g;
  const birim = attackCost(s, -1);
  nat.pool = hardCap(s, nat) * 0.5;
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1) * 4);
  assert(a, 'sefer başlamadı');
  for (let adim of [10, 30, 60, 120]) {
    for (let i = 0; i < adim; i++) step(s, 1 / 60, 1 / 60);
    if (!s.attacks.includes(a)) break;
    let degeri = 0;
    for (let c = 0; c < W * H; c++)
      if (s.progBy[c] === nat.id) degeri += s.prog[c] * birim * s.world.cityDef[c];
    // sim.prog Float32Array — kayan nokta payı göreli, mutlak değil
    assert(Math.abs(a.yatirim - degeri) < 1e-5 * (1 + degeri),
      `defter ${a.yatirim.toFixed(3)}, haritada ${degeri.toFixed(3)}`);
  }
});

// Etiket ve ölüm efekti nat.cx/cy'ye çizilir. Sabit bırakılırsa ulus yayıldıkça
// başlangıç yurdunda çakılı kalıp toprağının onlarca hücre dışına düşüyordu.
t('ulus merkezi toprağıyla birlikte kayar', () => {
  const s = fresh();
  const nat = s.nations[0];
  const bas = { x: nat.cx, y: nat.cy };
  for (let i = 0; i < 4000; i++) step(s, 0.05, 0.05);
  if (!nat.alive || nat.cells < 200) return;
  // merkez, sahiplenilen hücrelerin gerçek ağırlık merkezinde olmalı
  let sx = 0, sy = 0, k = 0;
  for (let c = 0; c < W * H; c++)
    if (s.owner[c] === nat.id) { sx += c % W; sy += (c / W) | 0; k++; }
  const gx = Math.round(sx / k), gy = Math.round(sy / k);
  assert(Math.hypot(nat.cx - gx, nat.cy - gy) <= 1,
    `merkez kaydı: (${nat.cx},${nat.cy}) yerine (${gx},${gy}) olmalıydı`);
  assert(bas.x !== nat.cx || bas.y !== nat.cy || k === 0,
    'merkez hiç güncellenmemiş');
});

t('aynı karede iki sefer kapanınca doğru olanlar silinir', () => {
  const s = fresh();
  const A = s.nations[0], B = s.nations[1];
  A.pool = 1e6; B.pool = 1e6;
  const a = startAttack(s, A, -1, frontCost(s, A, -1) * 2);
  const b = startAttack(s, B, -1, frontCost(s, B, -1) * 2);
  assert(a && b, 'seferler başlamadı');
  cancelAttack(s, a);
  assert(s.attacks.includes(b), 'yanlış sefer silindi');
  assert(!s.attacks.includes(a), 'iptal edilen sefer listede kaldı');
});

// İttifaklar kalıcı olunca geç oyunda iki blok donuyor ve harita kilitleniyor.
// Süreli ittifak bu kilidi açıyor: 24 tohumda çözülme 10/24'ten 24/24'e çıktı.
t('ittifakın süresi dolunca kendiliğinden düşer', () => {
  const s = fresh();
  const A = s.nations[0], B = s.nations[1];
  assert(formAlliance(s, A, B));
  for (let i = 0; i < ALLY_SECS * 30 - 60; i++) step(s, 1 / 30, 1 / 30);
  assert(allied(A, B), 'ittifak erken düştü');
  for (let i = 0; i < 120; i++) step(s, 1 / 30, 1 / 30);
  assert(!allied(A, B), 'ittifakın süresi dolmadı');
  assert(!allied(B, A), 'karşı tarafta ittifak kalmış');
});

t('süre dolunca ihanet cezası verilmez', () => {
  const s = fresh();
  const A = s.nations[0], B = s.nations[1];
  formAlliance(s, A, B);
  for (let i = 0; i < ALLY_SECS * 30 + 90; i++) step(s, 1 / 30, 1 / 30);
  assert(!allied(A, B), 'ittifak düşmedi');
  assert(!locked(s, A) && !locked(s, B), 'süre dolması ceza saydı');
});

t('lidere ittifak kurulmaz, gücü ne olursa olsun saldırılabilir', () => {
  const s = fresh();
  for (const n of s.nations) n.ai = true;
  const lider = s.nations[1];
  lider.cells = Math.round(s.landCells * 0.45);      // kıtanın yarısına yakın
  lider.pool = hardCap(s, lider);
  const kucuk = s.nations[2];
  // YZ liderle ittifak kurmamalı
  for (let i = 0; i < 900; i++) step(s, 1 / 30, 1 / 30);
  assert(!allied(kucuk, lider) || lider.cells < s.landCells * 0.35,
    'küçük ulus liderle ittifak kurdu');
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
  // Aralık GENİŞ olmalı: küçükken faiz sürünür, haritaya hükmederken uçar.
  // Dar bir aralık ekonomiyi tekdüze yapıyordu.
  const oran = interestRate(s, buyuk) / interestRate(s, kucuk);
  assert(oran > 6,
    `aralık dar (${oran.toFixed(1)} kat): %${(interestRate(s, kucuk) * 100).toFixed(2)} `
    + `→ %${(interestRate(s, buyuk) * 100).toFixed(2)}`);
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
  // Toprak iki katına çıkınca ödeme ikiden FAZLA katına çıkmalı — ama üs 1'e
  // yakın tutulur ki lider kaçmasın: kazanç belirgin, ezici değil.
  const kat = cok / az;
  assert(kat > 2 && kat < 2.3, `${az.toFixed(0)} → ${cok.toFixed(0)} (${kat.toFixed(2)} kat)`);
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
  assert(Math.abs(p.total - (p.land + p.city + p.balloon)) < 1e-6);
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
    // Ölçülen ARSA geliri. `cells` haritaya dokunmadan taklit edildiği için
    // şehir defteri burada anlamsız bir sabit; sıfırlanmazsa 4 kat toprağın
    // gelirine 4 kat büyümeyen bir terim eklenip oranı bozuyor.
    nat.cityScore = 0;
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
  // arsa + şehir; balon havuz 0 olduğu için sıfır
  const p = incomePayout(s, nat);
  const beklenen = Math.round(p.land + p.city);
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
  startAttack(s, nat, -1, maxCommit(s, nat));   // bilerek borca gir
  assert(inDebt(nat), `borca girilmedi: ${nat.pool.toFixed(0)}`);
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

// ---------------------------------------------------------------- deniz

console.log('\nDeniz çıkarması');

// Kara parçalarını çıkar: [0] ana kütle, gerisi ada.
function karaParcalari(s) {
  const gor = new Uint8Array(W * H), ps = [];
  for (let c0 = 0; c0 < W * H; c0++) {
    if (!s.world.isLand[c0] || gor[c0]) continue;
    const p = [], yig = [c0];
    gor[c0] = 1;
    while (yig.length) {
      const c = yig.pop();
      p.push(c);
      const x = c % W, nb = [];
      if (x > 0) nb.push(c - 1);
      if (x < W - 1) nb.push(c + 1);
      if (c >= W) nb.push(c - W);
      if (c < W * (H - 1)) nb.push(c + W);
      for (const m of nb) if (!gor[m] && s.world.isLand[m]) { gor[m] = 1; yig.push(m); }
    }
    ps.push(p);
  }
  return ps.sort((a, b) => b.length - a.length);
}

// EN KRİTİK İNVARYANT: menzil dışında ada üretilmemeli. Ulaşılamaz bir ada,
// haritada sonsuza dek boş kalan bir lekedir — mekaniği hiç eklememekten beter.
// Tohumlar rastgele seçilmedi: 7, 20 ve 21 menzil kısıtı kaldırıldığında
// ULAŞILAMAZ ada üreten tohumlardır (30 tohum tarandı, 570 adanın 3'ü menzil
// dışına düşüyordu). Kısıtın dişi bu tohumlarda görünür.
t('her ada boğaz menzilinde — ulaşılamaz ada üretilmiyor', () => {
  let adaSayisi = 0;
  for (const seed of [7, 20, 21, 11, 33]) {
    const s = createSim(seed);
    const ps = karaParcalari(s);
    for (const ada of ps.slice(1)) {
      adaSayisi++;
      const bagli = ada.some(c => s.world.straitHead[c] >= 0);
      assert(bagli, `tohum ${seed}: ${ada.length} hücrelik ada hiçbir boğaza bağlı değil`);
    }
  }
  assert(adaSayisi > 20, `6 tohumda yalnız ${adaSayisi} ada üretildi — ada üreticisi çalışmıyor`);
});

t('boğaz bağları çift yönlü', () => {
  const s = createSim(11);
  const { straitHead, straitTo, straitNext } = s.world;
  let denetlenen = 0;
  for (let c = 0; c < W * H; c++) {
    for (let e = straitHead[c]; e >= 0; e = straitNext[e]) {
      const o = straitTo[e];
      let geri = false;
      for (let f = straitHead[o]; f >= 0; f = straitNext[f]) if (straitTo[f] === c) { geri = true; break; }
      assert(geri, `${c} → ${o} var ama tersi yok`);
      denetlenen++;
    }
  }
  assert(denetlenen > 100, `yalnız ${denetlenen} bağ denetlendi`);
});

t('boğaz yalnız kısa geçitleri bağlar', () => {
  const s = createSim(11);
  const { straitHead, straitTo, straitNext, isLand } = s.world;
  for (let c = 0; c < W * H; c += 37) {
    for (let e = straitHead[c]; e >= 0; e = straitNext[e]) {
      const o = straitTo[e];
      const d = Math.abs(c % W - o % W) + Math.abs(((c / W) | 0) - ((o / W) | 0));
      assert(d <= STRAIT_MAX + 2, `${d} hücrelik geçit bağlanmış (üst sınır ${STRAIT_MAX})`);
      assert(isLand[c] && isLand[o], 'boğaz denize bağlanmış');
    }
  }
});

// Tek hücrelik bir yurttan cephe kur: kara komşuları normal, boğazın karşısı
// ÇIKARMA. İkisi bir arada olmalı — çıkarma kara cephesini kapatmaz.
function bogazliSim() {
  for (let seed = 1; seed <= 40; seed++) {
    const s = fresh(seed);
    for (let m = 0; m < W * H; m++) {
      if (s.world.straitHead[m] < 0) continue;
      const nat = s.nations[0];
      s.owner.fill(-1);
      for (const n of s.nations) { n.cells = 0; n.cityScore = 0; n.cityCount = 0; n.ai = false; }
      s.owner[m] = nat.id; nat.cells = 1;
      const ci = s.world.cityAt[m];
      if (ci >= 0) { nat.cityScore = s.world.cities[ci].size; nat.cityCount = 1; }
      nat.pool = 1e7;
      return { s, nat, m };
    }
  }
  return null;
}

t('cephe boğazın karşı kıyısına da kurulur', () => {
  const g = bogazliSim();
  assert(g, 'boğazlı kurulum bulunamadı');
  const { s, nat, m } = g;
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1) * 2);
  assert(a, 'sefer açılmadı');
  assert(a.amfibi.size > 0, 'boğazın karşısı cepheye girmedi — çıkarma yok');
  // çıkarma hücreleri gerçekten karşı kıyıda: bize kara komşusu OLMAMALI
  for (const c of a.amfibi) {
    const x = c % W, nb = [];
    if (x > 0) nb.push(c - 1);
    if (x < W - 1) nb.push(c + 1);
    if (c >= W) nb.push(c - W);
    if (c < W * (H - 1)) nb.push(c + W);
    assert(!nb.some(n => s.owner[n] === nat.id),
      'kara komşuluğu olan hücre çıkarma sayılmış — boşuna ceza ödenir');
  }
});

// Ölçüt LANDING_MULT'ı içe aktarıp kendisiyle karşılaştırmamalı — öyle olursa
// sabit 1'e çekildiğinde test yine geçer (denendi: geçti). Karşılaştırma
// MUTLAK: aynı hücreler cezasız fiyatlansa ne tutardı?
t('çıkarma hücresi kara hücresinden pahalı', () => {
  const g = bogazliSim();
  assert(g, 'boğazlı kurulum bulunamadı');
  const { s, nat } = g;
  const bogazli = frontCost(s, nat, -1);
  const st = frontStats(s, nat).get(-1);
  assert(st.cikarma > 0, 'cephede çıkarma hücresi görünmüyor');
  // çıkarma hücrelerinin cezasız bedeli
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1));
  assert(a && a.amfibi.size > 0, 'çıkarma cephesi kurulamadı');
  let cezasiz = 0;
  for (const c of a.amfibi) cezasiz += attackCost(s, -1) * s.world.cityDef[c];
  cancelAttack(s, a);
  // aynı cephe, boğazlar kapalıyken: çıkarma hücreleri hiç girmez
  s.world.straitHead.fill(-1);
  const karasal = frontCost(s, nat, -1);
  const fark = bogazli - karasal;
  assert(fark > cezasiz * 1.5,
    `çıkarma cezası yok sayılabilir: fark ${fark.toFixed(1)}, cezasız ${cezasiz.toFixed(1)}`);
});

// Korunum, çıkarma ceza katsayısıyla birlikte. `amfibi` kümesi bir seferin
// ömrü boyunca YALNIZ BÜYÜR (takviyede sıfırlanmaz), bu yüzden test hücrenin
// ödediği fiyatı düşüşünden sonra da bilebiliyor — kümenin sıfırlanması hem
// bu ölçümü imkânsız kılar hem de defteri haritadan ayırırdı.
t('deniz çıkarması yoktan asker üretmez', () => {
  const g = bogazliSim();
  assert(g, 'boğazlı kurulum bulunamadı');
  const { s, nat } = g;
  const K = attackCost(s, -1);
  const cd = s.world.cityDef;
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1) * 6);
  assert(a, 'sefer açılmadı');
  assert(a.amfibi.size > 0, 'çıkarma yok — ölçüm boş');
  const fiyat = c => K * cd[c] * (a.amfibi.has(c) ? LANDING_MULT : 1);
  const toprak = () => {
    let v = 0;
    for (let c = 0; c < W * H; c++) if (s.owner[c] === nat.id) v += fiyat(c);
    return v;
  };
  const kusatma = () => {
    let v = 0;
    for (let c = 0; c < W * H; c++) if (s.progBy[c] === nat.id) v += s.prog[c] * fiyat(c);
    return v;
  };
  const t0 = toprak();
  const V = () => nat.pool + s.attacks.filter(x => x.from === nat.id)
    .reduce((t, x) => t + x.troops, 0) + kusatma() + (toprak() - t0);

  let once = V(), enBuyuk = 0, dustu = 0;
  for (let i = 0; i < 400; i++) {
    const tikOnce = s.tickNo;
    step(s, 1 / 60, 1 / 60);
    const v = V();
    if (s.tickNo === tikOnce) enBuyuk = Math.max(enBuyuk, Math.abs(v - once));
    once = v;
  }
  for (const c of a.amfibi) if (s.owner[c] === nat.id) dustu++;
  assert(dustu > 0, 'hiçbir çıkarma hücresi düşmedi — ölçüm boş');
  assert(enBuyuk < 0.01,
    `bir karede ${enBuyuk.toFixed(4)} asker yoktan doğdu/yok oldu (${dustu} çıkarma hücresi düştü)`);
});

// Asıl gerekçe: boğaz olmadan ada oyun dışı kalır. 12 tohumda ölçüldü —
// boğazsız dünyada karanın %2.27'si sonsuza dek sahipsiz, boğazlarla %0.30.
t('boğaz kapalıyken ada fethedilemez, açıkken fethedilir', () => {
  // Adanın BAŞLANGIÇTA tamamen sahipsiz olması şart: büyük bir ada başlangıç
  // yurduna aday olabiliyor ve üstünde bir ulus doğuyor — o zaman boğaz kapalı
  // olsa da ada dolar, ölçüm anlamını yitirir.
  const olc = (bogazVar) => {
    const s = createSim(33);
    if (!bogazVar) s.world.straitHead.fill(-1);
    const ada = karaParcalari(s).slice(1)
      .filter(p => p.every(c => s.owner[c] < 0))
      .sort((a, b) => b.length - a.length)[0];
    assert(ada && ada.length >= 40, 'başlangıçta boş, ölçülebilir ada bulunamadı');
    for (let i = 0; i < 5200; i++) step(s, 0.05, 0.05);
    let alinan = 0;
    for (const c of ada) if (s.owner[c] >= 0) alinan++;
    return alinan / ada.length;
  };
  const kapali = olc(false), acik = olc(true);
  assert(kapali < 0.02, `boğaz kapalıyken adanın %${(kapali * 100).toFixed(0)}'ı alınmış`);
  assert(acik > 0.5, `boğaz açıkken adanın yalnız %${(acik * 100).toFixed(0)}'ı alınmış`);
});

// ---------------------------------------------------------------- şehirler

console.log('\nŞehirler');

t('şehir hücresi çevresini pahalandırıyor', () => {
  const s = createSim(11);
  const cd = s.world.cityDef;
  const buyuk = [...s.world.cities].sort((a, b) => b.size - a.size)[0];
  const merkez = idx(buyuk.x, buyuk.y);
  let duz = -1;
  for (let c = 0; c < W * H; c++) if (s.world.isLand[c] && cd[c] === 1) { duz = c; break; }
  assert(duz >= 0, 'haritada hiç düz arazi yok');
  assert(cd[merkez] > 1.5, `en büyük şehrin çarpanı ${cd[merkez].toFixed(2)} — halka çalışmıyor`);
  assert(cellCost(s, -1, merkez) > cellCost(s, -1, duz) * 1.5,
    `şehir ${cellCost(s, -1, merkez).toFixed(1)}, düz ${cellCost(s, -1, duz).toFixed(1)}`);
  // taban bedel hedefe ait, çarpan hücreye — ikisi ayrı kalmalı
  assert(Math.abs(cellCost(s, -1, duz) - attackCost(s, -1)) < 1e-9,
    'düz arazide hücre bedeli taban bedelden sapıyor');
});

t('şehir çarpanı sahibinden bağımsız — surlar kimin elindeyse onu korur', () => {
  const s = fresh();
  const buyuk = [...s.world.cities].sort((a, b) => b.size - a.size)[0];
  const c = idx(buyuk.x, buyuk.y);
  const once = s.world.cityDef[c];
  s.owner[c] = 3;
  assert.equal(s.world.cityDef[c], once, 'çarpan sahip değişince kaydı');
});

t('şehir sahibine gelir katıyor', () => {
  const s = createSim(11);
  const nat = s.nations[0];
  nat.cells = 500;
  nat.cityScore = 0;
  const sehirsiz = incomePayout(s, nat);
  assert.equal(sehirsiz.city, 0, 'şehirsizken şehir geliri var');
  nat.cityScore = 10;
  const sehirli = incomePayout(s, nat);
  assert(sehirli.city > 0, 'şehir geliri yatmıyor');
  assert(sehirli.total > sehirsiz.total, 'şehir toplam geliri artırmadı');
  // gelir `size` toplamıyla DOĞRUSAL: iki katı şehir, iki katı gelir
  nat.cityScore = 20;
  assert(Math.abs(incomePayout(s, nat).city - sehirli.city * 2) < 1e-6,
    'şehir geliri doğrusal değil');
});

// cityScore take() içinde O(1) taşınıyor — harita taranmıyor. Defterin
// haritayla ayrışması, gelirin yoktan doğması ya da buharlaşması demek.
t('şehir defteri haritayla birebir tutuyor', () => {
  const s = createSim(2024);
  for (let i = 0; i < 3000; i++) step(s, 0.05, 0.05);
  for (const nat of s.nations) {
    let puan = 0, adet = 0;
    for (let ci = 0; ci < s.world.cities.length; ci++) {
      const city = s.world.cities[ci];
      if (s.owner[idx(city.x, city.y)] === nat.id) { puan += city.size; adet++; }
    }
    assert(Math.abs(nat.cityScore - puan) < 1e-9,
      `${nat.name}: defter ${nat.cityScore.toFixed(3)}, haritada ${puan.toFixed(3)}`);
    assert.equal(nat.cityCount, adet, `${nat.name}: şehir sayısı ${nat.cityCount} ≠ ${adet}`);
  }
});

// Şehir el değiştirince İKİ defter birden hareket etmeli: kaybedenden düşer,
// alana eklenir. Kurulum tohuma bırakılamaz — 4242'de 0 numaralı ulus şehirsiz
// doğuyor ve test hiçbir şey ölçmeden geçiyordu. Bu yüzden uygun tohum/ulus
// ikilisi TARANIR ve bulunamaması testin başarısızlığı sayılır.
t('şehir el değiştirince gelir de el değiştirir', () => {
  // Aranan kurulum: SINIR HATTININ ÜSTÜNDE duran bir şehir — yani savunana ait,
  // saldırana komşu bir şehir hücresi. Böyle bir hücre cephenin ilk halkasında
  // olduğu için tek dalgada düşer; şehre "bir yerlerden ulaşmayı" ummak yok.
  // (t=0'da uluslar ayrı adacıklar hâlinde, hiç cephe yok — ölçüldü: ilk ulus
  // sınırı ~1600. adımda oluşuyor, ilk sınır şehri de orada. Pencere bunun
  // belirgin ötesine kadar açık.)
  let kur = null;
  for (let seed = 1; seed <= 40 && !kur; seed++) {
    const s = createSim(seed);
    for (let adim = 0; adim < 3200 && !kur; adim++) {
      step(s, 0.05, 0.05);
      if (adim % 50) continue;
      for (const city of s.world.cities) {
        const c = idx(city.x, city.y);
        const savunanId = s.owner[c];
        if (savunanId < 0) continue;
        const x = c % W;
        const nb = [];
        if (x > 0) nb.push(c - 1);
        if (x < W - 1) nb.push(c + 1);
        if (c >= W) nb.push(c - W);
        if (c < W * (H - 1)) nb.push(c + W);
        for (const n of nb) {
          const o = s.owner[n];
          if (o < 0 || o === savunanId || !s.world.isLand[n]) continue;
          kur = { s, saldiran: s.nations[o], savunan: s.nations[savunanId], hedef: c, size: city.size };
          break;
        }
        if (kur) break;
      }
    }
  }
  assert(kur, '40 tohumda cephe hattı üstünde şehir bulunamadı');
  const { s, saldiran, savunan, hedef, size } = kur;
  for (const n of s.nations) n.ai = false;      // yalnız ölçülen sefer koşsun
  saldiran.allies.clear(); savunan.allies.clear();
  saldiran.lockUntil = 0;
  const aOnce = savunan.cityScore, bOnce = saldiran.cityScore;
  saldiran.pool = hardCap(s, saldiran);
  const a = startAttack(s, saldiran, savunan.id, maxCommit(s, saldiran));
  assert(a, 'sefer açılmadı');
  for (let i = 0; i < 4000 && s.owner[hedef] === savunan.id; i++) step(s, 0.05, 0.05);
  assert.equal(s.owner[hedef], saldiran.id, 'şehir el değiştirmedi — ölçüm yapılamadı');
  // Dalga bir halkadan fazlasını alabilir, yani hedef şehirle birlikte başka
  // şehirler de düşmüş olabilir. İki ayrı ölçüt: (1) EN AZ hedef şehir kadar
  // hareket, (2) iki defter de haritayla BİREBİR — böylece "ne kadar" sorusu
  // da bağlanır, fazla/eksik taşınan puan yakalanır.
  assert(savunan.cityScore <= aOnce - size + 1e-6,
    `kaybedenin defteri ${aOnce.toFixed(2)} → ${savunan.cityScore.toFixed(2)}, en az ${size.toFixed(2)} düşmeliydi`);
  assert(saldiran.cityScore >= bOnce + size - 1e-6,
    `alanın defterine en az ${size.toFixed(2)} eklenmedi (${bOnce.toFixed(2)} → ${saldiran.cityScore.toFixed(2)})`);
  const gercek = (nat) => {
    let t = 0;
    for (const city of s.world.cities)
      if (s.owner[idx(city.x, city.y)] === nat.id) t += city.size;
    return t;
  };
  for (const nat of [saldiran, savunan])
    assert(Math.abs(nat.cityScore - gercek(nat)) < 1e-9,
      `${nat.name}: defter ${nat.cityScore.toFixed(3)}, haritada ${gercek(nat).toFixed(3)}`);
});

t('dağılan ulusun şehir defteri sıfırlanır', () => {
  const s = fresh();
  const nat = s.nations[5];
  nat.cityScore = 99; nat.cityCount = 7;
  // eşiğin altına düşür: dağılma yolu kill(s, nat, true)
  const esik = minCells(s);
  let kalan = esik - 1;
  for (let c = 0; c < W * H && nat.cells > kalan; c++) {
    if (s.owner[c] !== nat.id) continue;
    s.owner[c] = -1; nat.cells--;
  }
  startAttack(s, s.nations[0], -1, 1);          // step'i bir tur döndür
  step(s, 0.05, 0.05);
  if (nat.alive) return;                        // dağılma tetiklenmedi
  assert.equal(nat.cityScore, 0, 'dağılan ulusun şehir puanı kaldı');
  assert.equal(nat.cityCount, 0, 'dağılan ulusun şehir sayısı kaldı');
});

// Şehir görünür olmalı: cephe pahalı halkaya girince YAVAŞLAMALI. Bütçe salt
// ilerleme biriminde tutulduğunda cephe şehrin üstünden aynı süratle geçiyor,
// sadece daha çok asker yakıyordu — 10 tohumda ölçüldü, sahipsiz toprağın
// savunma çarpanı ortalamanın ancak %1.2 üstündeydi (yani şehir yok gibiydi).
t('cephe pahalı halkada yavaşlar', () => {
  const s = createSim(11);
  for (const n of s.nations) n.ai = false;
  const nat = s.nations[0];
  nat.pool = hardCap(s, nat);
  const a = startAttack(s, nat, -1, frontCost(s, nat, -1) * 4);
  assert(a, 'sefer başlamadı');
  // Açılış halkasının ağırlığı kaydedilmeli; yoksa oran hesaplanamaz.
  assert(a.agirlik >= 1, 'açılış halka ağırlığı kaydedilmedi');

  // Aynı seferi iki kez tek kare işlet: bir kez olduğu gibi, bir kez de halka
  // yapay olarak iki kat pahalılaştırılmış. İkincisi yarı kadar ilerlemeli.
  const olc = (carpan) => {
    const t = createSim(11);
    for (const n of t.nations) n.ai = false;
    const tn = t.nations[0];
    tn.pool = hardCap(t, tn);
    const ta = startAttack(t, tn, -1, frontCost(t, tn, -1) * 4);
    for (const c of ta.layer) t.world.cityDef[c] *= carpan;
    t.tickAcc = 0;
    step(t, 1 / 60, 1 / 60);
    let p = 0;
    for (const c of ta.layer) if (t.progBy[c] === tn.id) p += t.prog[c];
    return p;
  };
  const normal = olc(1), pahali = olc(2);
  assert(pahali < normal * 0.75,
    `pahalı halka yavaşlamadı: ${normal.toFixed(3)} → ${pahali.toFixed(3)} ilerleme`);
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
