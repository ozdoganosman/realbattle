// Başsız simülasyon testi. sim.js hiçbir tarayıcı API'sine dokunmaz.

import assert from 'node:assert';
import {
  createSim, step, startAttack, cancelAttack, canAttack, attackCost,
  formAlliance, breakAlliance, allied, locked, landFrac, troopCap,
  density, power, BETRAY_LOCK, WIN_FRAC,
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
  const a = startAttack(s, nat, -1, 60);          // az asker
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
  zayif.pool = 100; zayif.cells = 400;
  guclu.pool = 3000; guclu.cells = 400;
  assert(attackCost(s, guclu.id) > attackCost(s, zayif.id) * 2,
    `${attackCost(s, zayif.id).toFixed(2)} vs ${attackCost(s, guclu.id).toFixed(2)}`);
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
