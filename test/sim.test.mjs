// Başsız simülasyon testi. sim.js hiçbir tarayıcı API'sine dokunmadığı için
// Node'da olduğu gibi çalışır — 2. aşamadaki sunucu portunun ön kanıtı.

import assert from 'node:assert';
import {
  createSim, step, launchArmy, formAlliance, breakAlliance, declareWar,
  makePeace, power, landFrac, troopCap, allied, atWar, truced, locked,
  BETRAY_LOCK,
} from '../js/sim.js';
import { W, H, idx } from '../js/world.js';

let pass = 0, fail = 0;
function t(ad, fn) {
  try { fn(); console.log(`  ✓ ${ad}`); pass++; }
  catch (e) { console.log(`  ✗ ${ad}\n      ${e.message}`); fail++; }
}

// ---------------------------------------------------------------- dünya

console.log('\nDünya üretimi');
const sim = createSim(12345);

t('kara ve deniz makul oranda bölünmüş', () => {
  const frac = sim.landCells / (W * H);
  assert(frac > 0.25 && frac < 0.75, `kara oranı ${frac.toFixed(2)}`);
});

t('16 krallık kuruldu ve hepsinin toprağı var', () => {
  assert.equal(sim.nations.length, 16);
  for (const n of sim.nations) assert(n.cells > 0, `${n.name} topraksız`);
});

t('her krallığın bir başkent şehri var', () => {
  for (const n of sim.nations) {
    const c = sim.world.cities[n.capital];
    assert(c && c.owner === n.id, `${n.name} başkenti yok`);
  }
});

t('aynı seed aynı haritayı üretir', () => {
  const a = createSim(777), b = createSim(777);
  assert.equal(a.landCells, b.landCells);
  for (let i = 0; i < W * H; i += 97)
    assert.equal(a.owner[i], b.owner[i], `hücre ${i} farklı`);
});

t('farklı seed farklı harita üretir', () => {
  const a = createSim(1), b = createSim(2);
  let diff = 0;
  for (let i = 0; i < W * H; i++) if (a.world.isLand[i] !== b.world.isLand[i]) diff++;
  assert(diff > W * H * 0.05, 'haritalar fazla benzer');
});

// ---------------------------------------------------------------- ordular

console.log('\nOrdular');

function freshSim(seed = 4242) {
  const s = createSim(seed);
  s.playerId = 0;
  s.nations[0].ai = false;
  return s;
}

// bir ulusun sınırında, komşusu kendisine ait olmayan bir hücre bul
function findFront(s, natId) {
  for (let i = 0; i < W * H; i++) {
    if (s.owner[i] !== natId) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ox, ny = y + oy;
      if (nx < 2 || ny < 2 || nx >= W - 2 || ny >= H - 2) continue;
      const n = idx(nx, ny);
      if (s.world.isLand[n] && s.owner[n] !== natId)
        return { x: x + 0.5, y: y + 0.5, dx: ox, dy: oy };
    }
  }
  return null;
}

t('fırlatılan ordu havuzdan asker düşürür', () => {
  const s = freshSim();
  const nat = s.nations[0];
  const f = findFront(s, 0);
  assert(f, 'sınır bulunamadı');
  const before = nat.pool;
  const army = launchArmy(s, nat, f.x, f.y, f.dx, f.dy, 200, 20);
  assert(army, 'ordu oluşmadı');
  assert(Math.abs(nat.pool - (before - 200)) < 1e-6, 'havuz düşmedi');
  assert.equal(s.armies.length, 1);
});

t('ordu fırlatıldığı yönde ilerler ve toprak kazandırır', () => {
  const s = freshSim();
  const nat = s.nations[0];
  const f = findFront(s, 0);
  const cellsBefore = nat.cells;
  const a = launchArmy(s, nat, f.x, f.y, f.dx, f.dy, 900, 22);
  const x0 = a.x, y0 = a.y;
  for (let i = 0; i < 200; i++) step(s, 1 / 30, 1 / 30);
  assert(nat.cells > cellsBefore, `toprak artmadı (${cellsBefore} → ${nat.cells})`);
  // hareket ettiği yön, fırlatma yönüyle aynı işarette olmalı
  const movedX = a.x - x0, movedY = a.y - y0;
  const dot = movedX * f.dx + movedY * f.dy;
  assert(dot > 0 || s.armies.length === 0, 'ordu yanlış yöne gitti');
});

t('ordu ilerledikçe erir (puan azalır, toprak artar)', () => {
  const s = freshSim();
  const nat = s.nations[0];
  const f = findFront(s, 0);
  const a = launchArmy(s, nat, f.x, f.y, f.dx, f.dy, 800, 25);
  const start = a.troops;
  const cells0 = nat.cells;
  for (let i = 0; i < 90; i++) step(s, 1 / 30, 1 / 30);
  assert(a.troops < start, `asker azalmadı (${start} → ${a.troops})`);
  assert(nat.cells > cells0, 'toprak kazanılmadı');
});

t('ordu denize çıkamaz', () => {
  const s = freshSim();
  for (let i = 0; i < 900; i++) step(s, 1 / 20, 1 / 20);
  for (const a of s.armies) {
    const c = idx(Math.max(0, Math.min(W - 1, a.x | 0)), Math.max(0, Math.min(H - 1, a.y | 0)));
    assert(s.world.isLand[c], `ordu denizde: ${a.x.toFixed(1)},${a.y.toFixed(1)}`);
  }
});

t('karşılaşan iki ordu birbirinin puanını götürür', () => {
  const s = freshSim();
  const A = s.nations[0], B = s.nations[1];
  declareWar(s, A, B);
  // aynı noktaya iki düşman ordu koy
  let spot = -1;
  for (let i = 0; i < W * H; i++) if (s.owner[i] === A.id) { spot = i; break; }
  const x = (spot % W) + 0.5, y = ((spot / W) | 0) + 0.5;
  const a = launchArmy(s, A, x, y, 1, 0, 400, 30);
  const b = launchArmy(s, B, x, y, -1, 0, 400, 30);
  b.x = x; b.y = y;              // temas ettir
  const a0 = a.troops, b0 = b.troops;
  step(s, 0.2, 0.2);
  assert(a.troops < a0, 'saldıran erimedi');
  assert(b.troops < b0, 'savunan erimedi');
});

t('ordu bitince kalan asker garnizona döner', () => {
  const s = freshSim();
  const nat = s.nations[0];
  const f = findFront(s, 0);
  launchArmy(s, nat, f.x, f.y, f.dx, f.dy, 300, 3);   // çok kısa menzil
  const poolLow = nat.pool;
  for (let i = 0; i < 120; i++) step(s, 1 / 30, 1 / 30);
  assert.equal(s.armies.filter(a => a.nat === 0).length, 0, 'ordu hâlâ ayakta');
  assert(nat.pool > poolLow, 'asker geri dönmedi');
});

// ---------------------------------------------------------------- kuşatma

console.log('\nKuşatma');

t('tamamen sarılan düşman cebi yutulur', () => {
  const s = createSim(999);
  const A = s.nations[0], B = s.nations[1];
  declareWar(s, A, B);

  // yapay kurulum: A'nın ortasında B'ye ait tek hücrelik bir cep
  // önce geniş bir A bloğu boya
  let cx = 60, cy = 60;
  // kara olan bir alan bul
  outer:
  for (let y = 6; y < H - 6; y++) for (let x = 6; x < W - 6; x++) {
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++)
      for (let dx = -3; dx <= 3; dx++)
        if (!s.world.isLand[idx(x + dx, y + dy)]) { ok = false; break; }
    if (ok) { cx = x; cy = y; break outer; }
  }
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const c = idx(cx + dx, cy + dy);
    if (s.owner[c] >= 0) s.nations[s.owner[c]].cells--;
    s.owner[c] = A.id; A.cells++;
  }
  const mid = idx(cx, cy);
  s.owner[mid] = B.id; A.cells--; B.cells++;
  const bBefore = B.cells;

  s.encTimer = 99;                        // kuşatma taramasını tetikle
  step(s, 0.01, 0.01);

  assert.equal(s.owner[mid], A.id, 'cep yutulmadı');
  assert.equal(B.cells, bBefore - 1, 'sayaç güncellenmedi');
});

t('müttefikin toprağı kuşatmayla yutulmaz', () => {
  const s = createSim(999);
  const A = s.nations[0], B = s.nations[1];
  formAlliance(s, A, B);
  let cx = 60, cy = 60;
  outer2:
  for (let y = 6; y < H - 6; y++) for (let x = 6; x < W - 6; x++) {
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++)
      for (let dx = -3; dx <= 3; dx++)
        if (!s.world.isLand[idx(x + dx, y + dy)]) { ok = false; break; }
    if (ok) { cx = x; cy = y; break outer2; }
  }
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const c = idx(cx + dx, cy + dy);
    if (s.owner[c] >= 0) s.nations[s.owner[c]].cells--;
    s.owner[c] = A.id; A.cells++;
  }
  const mid = idx(cx, cy);
  s.owner[mid] = B.id; A.cells--; B.cells++;
  s.encTimer = 99;
  step(s, 0.01, 0.01);
  assert.equal(s.owner[mid], B.id, 'müttefikin toprağı yutuldu');
});

// ---------------------------------------------------------------- diplomasi

console.log('\nDiplomasi');

t('ittifak karşılıklı kurulur', () => {
  const s = freshSim();
  const A = s.nations[0], B = s.nations[1];
  assert(formAlliance(s, A, B));
  assert(allied(A, B) && allied(B, A));
});

t('savaştaki iki ulus ittifak kuramaz', () => {
  const s = freshSim();
  const A = s.nations[0], B = s.nations[1];
  declareWar(s, A, B);
  assert.equal(formAlliance(s, A, B), false);
});

t('ittifakı bozan 20 saniye saldıramaz', () => {
  const s = freshSim();
  const A = s.nations[0], B = s.nations[1];
  formAlliance(s, A, B);
  assert(!locked(s, A));
  breakAlliance(s, A, B);
  assert(locked(s, A), 'ceza uygulanmadı');
  assert(!locked(s, B), 'bozulan taraf da cezalandırıldı');

  const f = findFront(s, 0);
  assert.equal(launchArmy(s, A, f.x, f.y, f.dx, f.dy, 200, 20), null,
    'cezalıyken ordu fırlatabildi');

  // 20 gerçek saniye sonra serbest
  s.realT += BETRAY_LOCK + 0.1;
  assert(!locked(s, A), 'ceza bitmedi');
  assert(launchArmy(s, A, f.x, f.y, f.dx, f.dy, 200, 20), 'ceza sonrası saldıramadı');
});

t('savaş ilanı müttefikleri savaşa çağırır', () => {
  const s = freshSim();
  const A = s.nations[0], B = s.nations[1], C = s.nations[2];
  formAlliance(s, B, C);
  s.pendingCalls.length = 0;
  declareWar(s, A, B);
  const call = s.pendingCalls.find(c => c.target === C.id);
  assert(call, 'çağrı üretilmedi');
  assert.equal(call.foe, A.id);
});

t('barış ateşkes başlatır ve ateşkeste saldırı engellenir', () => {
  const s = freshSim();
  const A = s.nations[0], B = s.nations[1];
  declareWar(s, A, B);
  makePeace(s, A, B);
  assert(!atWar(A, B), 'savaş bitmedi');
  assert(truced(s, A, B), 'ateşkes yok');
});

t('ateşkesli komşunun toprağı fetihte atlanır', () => {
  const s = freshSim();
  const A = s.nations[0], B = s.nations[1];
  declareWar(s, A, B); makePeace(s, A, B);
  const bBefore = B.cells;
  // A'nın B sınırına ordu sür
  for (let i = 0; i < W * H; i++) {
    if (s.owner[i] !== A.id) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = idx(x + ox, y + oy);
      if (s.owner[n] === B.id) {
        launchArmy(s, A, x + 0.5, y + 0.5, ox, oy, 1500, 15);
        for (let k = 0; k < 120; k++) step(s, 1 / 30, 1 / 30);
        assert(B.cells >= bBefore, `ateşkese rağmen ${bBefore - B.cells} hücre alındı`);
        return;
      }
    }
  }
});

// ---------------------------------------------------------------- bütünlük

console.log('\nUzun süreli çalışma');

t('600 oyun-saniyesi boyunca hata olmadan koşar', () => {
  const s = createSim(2024);
  s.playerId = -1;
  for (let i = 0; i < 12000; i++) step(s, 0.05, 0.05);
  assert(s.t > 590);
});

t('hücre sayaçları haritayla tutarlı kalır', () => {
  const s = createSim(31337);
  for (let i = 0; i < 6000; i++) step(s, 0.05, 0.05);
  const real = new Array(s.nations.length).fill(0);
  for (let i = 0; i < W * H; i++) if (s.owner[i] >= 0) real[s.owner[i]]++;
  for (const n of s.nations)
    assert.equal(n.cells, real[n.id], `${n.name}: sayaç ${n.cells}, gerçek ${real[n.id]}`);
});

t('ölü uluslar toprağını ve ordularını kaybeder', () => {
  const s = createSim(555);
  for (let i = 0; i < 9000; i++) step(s, 0.05, 0.05);
  for (const n of s.nations) {
    if (n.alive) continue;
    assert.equal(n.cells, 0, `${n.name} ölü ama toprağı var`);
    assert.equal(s.armies.filter(a => a.nat === n.id).length, 0, `${n.name} ölü ama ordusu var`);
    assert.equal(n.wars.size, 0);
    assert.equal(n.allies.size, 0);
  }
});

t('asker havuzu tavanı aşmaz ve negatife düşmez', () => {
  const s = createSim(8080);
  for (let i = 0; i < 6000; i++) {
    step(s, 0.05, 0.05);
    if (i % 500) continue;
    for (const n of s.nations) {
      if (!n.alive) continue;
      assert(n.pool >= 0, `${n.name} negatif asker`);
      assert(n.pool <= troopCap(s, n) * 1.51, `${n.name} tavanı aştı`);
    }
  }
});

t('oyun bir noktada birinin lehine ilerler (konsolidasyon)', () => {
  const s = createSim(606);
  const alive0 = s.nations.filter(n => n.alive).length;
  for (let i = 0; i < 20000; i++) step(s, 0.05, 0.05);
  const biggest = Math.max(...s.nations.map(n => landFrac(s, n)));
  const alive1 = s.nations.filter(n => n.alive).length;
  assert(biggest > 0.08, `en büyük ulus sadece %${(biggest * 100).toFixed(1)}`);
  assert(alive1 <= alive0, 'ulus sayısı arttı(!)');
  console.log(`      → ${alive1}/${alive0} krallık ayakta, en büyüğü %${(biggest * 100).toFixed(1)}`);
});

t('savaş ve ittifak yapay zekâ tarafından fiilen kullanılıyor', () => {
  const s = createSim(4711);
  let sawWar = false, sawAlly = false;
  for (let i = 0; i < 12000; i++) {
    step(s, 0.05, 0.05);
    if (!sawWar && s.nations.some(n => n.alive && n.wars.size > 0)) sawWar = true;
    if (!sawAlly && s.nations.some(n => n.alive && n.allies.size > 0)) sawAlly = true;
    if (sawWar && sawAlly) break;
  }
  assert(sawWar, 'hiç savaş çıkmadı');
  assert(sawAlly, 'hiç ittifak kurulmadı');
});

console.log(`\n${pass} geçti, ${fail} kaldı\n`);
process.exit(fail ? 1 : 0);
