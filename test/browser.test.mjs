// Tarayıcı testi: tıkla-saldır akışı, çizim, hissiyat katmanı, arayüz.
// Kendi statik sunucusunu kaldırır.  Çalıştırma: npm run test:browser

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SHOT_DIR || path.join(ROOT, '.shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('yok'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (ad, ok, detay = '') => {
  if (ok) { console.log(`  ✓ ${ad}`); pass++; }
  else { console.log(`  ✗ ${ad}${detay ? '\n      ' + detay : ''}`); fail++; }
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + (process.env.PAGE || '/index.html'), { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

console.log('\nAçılış');
check('16 krallık listeleniyor', (await page.$$('.nation-btn')).length === 16);
check('harita ilk karede çiziliyor', await page.evaluate(() => {
  const c = document.getElementById('map');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4 * 977) if (d[i] > 0) n++;
  return n > 10;
}));
await page.screenshot({ path: path.join(OUT, '01-acilis.png') });

await (await page.$$('.nation-btn'))[12].click();
await page.waitForTimeout(600);

const info = () => page.evaluate(() => {
  const { sim, ui } = window.__rb;
  const me = sim.nations[sim.playerId];
  return {
    ad: me.name, cells: me.cells, pool: Math.round(me.pool),
    fronts: sim.attacks.filter(a => a.from === me.id).length,
    t: +sim.t.toFixed(1), shake: +ui.shake.toFixed(1),
    allies: me.allies.size, locked: me.lockUntil > sim.realT,
  };
});

console.log('\nOyuna giriş');
const start = await info();
check('oyuncu krallığı seçildi', start.ad === 'Osmanlı' && start.cells > 0, JSON.stringify(start));
check('üst çubuk oyuncuyu gösteriyor',
  (await page.textContent('#tb-nation')).trim() === 'Osmanlı');
check('başlangıçta yurda yakınlaşılmış',
  await page.evaluate(() => window.__rb.view.scale > 1.2));
// Başlangıç yurdu FETHEDİLMİŞ sayılmamalı: sonCells 0'da bırakılınca bitiş
// ekranı daha ilk karede bütün başlangıç toprağını "fethedilen"e yazıyordu.
check('başlangıç toprağı fethedilmiş sayılmıyor', await page.evaluate(() => {
  const { ui } = window.__rb;
  return ui.fethedilen === 0;
}), 'fethedilen: ' + await page.evaluate(() => window.__rb.ui.fethedilen));

// ---------------------------------------------------------------- saldırı
console.log('\nTıkla — sınır dalgası');

// oyuncunun sınırındaki bir düşman/boş hücrenin ekran konumu
const target = await page.evaluate(() => {
  const { sim, W, H } = window.__rb;
  const me = sim.nations[sim.playerId];
  const r = document.getElementById('map').getBoundingClientRect();
  for (let c = 0; c < W * H; c++) {
    if (sim.owner[c] !== me.id) continue;
    const x = c % W;
    const nb = [];
    if (x > 0) nb.push(c - 1);
    if (x < W - 1) nb.push(c + 1);
    if (c >= W) nb.push(c - W);
    if (c < W * (H - 1)) nb.push(c + W);
    for (const n of nb) {
      if (!sim.world.isLand[n] || sim.owner[n] === me.id) continue;
      const nx = n % W, ny = (n / W) | 0;
      const sx = r.left + (nx + 0.5) / W * r.width;
      const sy = r.top + (ny + 0.5) / H * r.height;
      if (sx > 30 && sx < 1470 && sy > 70 && sy < 870)
        return { sx, sy, owner: sim.owner[n] };
    }
  }
  return null;
});
check('sınırda tıklanabilir hedef var', !!target);

// üstüne gelince hedef bilgisi çıkmalı
await page.mouse.move(target.sx, target.sy);
await page.waitForTimeout(250);
check('hedefin üstüne gelince bilgi baloncuğu çıkıyor',
  !(await page.$eval('#target-chip', el => el.classList.contains('hidden'))));
check('hedefin toprağı vurgulanıyor (hover)',
  await page.evaluate(() => window.__rb.ui.hoverOwner !== undefined));
await page.screenshot({ path: path.join(OUT, '02-hedef.png') });

// Varsayılan konumda hamle çoğu zaman TEK halkaya yuvarlanır ve ilk karede
// biter — süren bir cephe görmek için kaydıracı yukarı çek.
await page.evaluate(async () => {
  const p = document.getElementById('pct');
  p.value = '85'; p.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 40));
});
const before = await info();
await page.mouse.click(target.sx, target.sy);
await page.waitForTimeout(200);
const afterClick = await info();
check('tıklayınca sefer başlıyor', afterClick.fronts === 1, JSON.stringify(afterClick));
check('sefer havuzdan asker düşürüyor', afterClick.pool < before.pool,
  `${before.pool} → ${afterClick.pool}`);
check('tıklama sarsıntı tetikliyor', afterClick.shake > 0, `shake=${afterClick.shake}`);
check('süren seferler paneli açıldı',
  !(await page.$eval('#sec-fronts', el => el.classList.contains('hidden'))));

// Cephe göstergesi harita üstünde, panelden bağımsız olarak HER ZAMAN görünür.
check('cephe göstergesi seferi listeliyor', await page.evaluate(() => {
  const el = document.getElementById('fronts-hud');
  if (el.classList.contains('hidden')) return false;
  const fr = el.querySelectorAll('.fr');
  if (!fr.length) return false;
  const bar = fr[0].querySelector('.bar i');
  return /\d/.test(fr[0].querySelector('.tr').textContent) && !!bar;
}));

// Süren seferi göstergedeki ✕ ile geri çağır, sonra aynı hedefe yeniden çık:
// sonraki yayılma ölçümü ayakta kalsın. (Aynı hedefe ikinci cephe artık
// açılmıyor — cephe zaten hedefle paylaşılan bütün sınır hattı.)
const geriCagirma = await page.evaluate(async () => {
  const { sim, api } = window.__rb;
  const me = sim.nations[sim.playerId];
  window.__rb.ui.speed = 0;
  await new Promise(r => setTimeout(r, 140));
  const ek = sim.attacks.find(a => a.from === me.id);
  if (!ek) { window.__rb.ui.speed = 1; return { hata: 'süren sefer yok' }; }
  const hedef = ek.target;
  const once = sim.attacks.filter(a => a.from === me.id).length;
  const b = [...document.querySelectorAll('#fronts-hud .x')]
    .find(x => +x.dataset.id === ek.id);
  if (!b) { window.__rb.ui.speed = 1; return { hata: 'göstergede ✕ düğmesi yok' }; }
  b.click();
  await new Promise(r => setTimeout(r, 60));
  const sonra = sim.attacks.filter(a => a.from === me.id).length;
  // seferi geri aç ki "sınır fiilen yayılıyor" ölçümü sürsün
  me.pool = api.hardCap(sim, me);
  const yeni = api.startAttack(sim, me, hedef, api.frontCost(sim, me, hedef) * 2);
  window.__rb.ui.speed = 1;
  return { once, sonra, kapandi: !sim.attacks.includes(ek), yeniden: !!yeni };
});
check('göstergedeki ✕ seferi geri çağırıyor',
  geriCagirma.sonra === geriCagirma.once - 1 && geriCagirma.kapandi,
  JSON.stringify(geriCagirma));
// Geri çağrılan cepheye yeniden çıkılabilmeli — engel yalnız AÇIK cephe için.
check('geri çağrılan cepheye yeniden çıkılabiliyor',
  geriCagirma.yeniden === true, JSON.stringify(geriCagirma));

// Savaş cephesi 9 sn, tarafsız cephe 3.6 sn sürüyor; dalganın ilk halkayı
// düşürmesi için yeterince bekle.
await page.waitForTimeout(4500);
const spread = await info();
check('sınır fiilen yayılıyor', spread.cells > before.cells,
  `${before.cells} → ${spread.cells}`);
await page.screenshot({ path: path.join(OUT, '03-yayilma.png') });

check('ele geçen hücreler parlama için damgalanıyor', await page.evaluate(() => {
  const { sim, W, H } = window.__rb;
  let n = 0;
  for (let c = 0; c < W * H; c++) if (sim.lastCapture[c] > 0) n++;
  return n > 5;
}));

// ---------------------------------------------------------------- geri çağırma
console.log('\nSeferi geri çağırma');
// Ölçüm sırasında oyunu durdur: en küçük hamleye yuvarlanan bir sefer askerini
// ilk halkada bitirir ve geriye bir şey kalmaz — bilerek fazla asker sürülür.
const iade = await page.evaluate(async () => {
  const { sim, api } = window.__rb;
  const hiz = window.__rb.ui.speed;
  window.__rb.ui.speed = 0;
  const me = sim.nations[sim.playerId];
  sim.attacks.length = 0;
  me.lockUntil = 0;
  me.pool = api.hardCap(sim, me);
  const cephe = api.frontCost(sim, me, -1);
  const surulen = cephe * 6;                 // altı halkalık asker
  const atk = api.startAttack(sim, me, -1, surulen);
  const havuzSonra = me.pool;
  const acikti = sim.attacks.length === 1;
  api.cancelAttack(sim, atk);
  const sonuc = { acikti, kapandi: sim.attacks.length === 0,
    havuzSonra, iade: me.pool - havuzSonra, kalan: atk.troops };
  window.__rb.ui.speed = hiz;
  return sonuc;
});
check('geri çağırınca sefer kapanıyor', iade.acikti && iade.kapandi, JSON.stringify(iade));
check('kalan asker garnizona dönüyor', iade.iade > 0 && Math.abs(iade.iade - iade.kalan) < 1,
  JSON.stringify(iade));
await page.click('#btn-play');

// ---------------------------------------------------------------- oynanış
console.log('\nSimülasyon akışı');
await page.click('#btn-fast');
await page.waitForTimeout(7000);
const mid = await info();
check('hızlı modda zaman ilerliyor', mid.t > spread.t + 5, `t=${mid.t}`);
check('duraklat gerçekten durduruyor', await page.evaluate(async () => {
  document.getElementById('btn-pause').click();
  const t0 = window.__rb.sim.t;
  await new Promise(r => setTimeout(r, 600));
  return window.__rb.sim.t === t0;
}));
await page.evaluate(() => { window.__rb.ui.speed = 1; });
await page.screenshot({ path: path.join(OUT, '04-oyun.png') });

// ---------------------------------------------------------------- ittifak
console.log('\nİttifak ve ihanet cezası');
const betray = await page.evaluate(() => {
  const { sim, api } = window.__rb;
  const me = sim.nations[sim.playerId];
  const other = sim.nations.find(n => n.alive && n !== me);
  api.formAlliance(sim, me, other);
  const kuruldu = me.allies.has(other.id);
  const saldirilabilir = api.canAttack(sim, me, other.id);
  api.breakAlliance(sim, me, other);
  return {
    kuruldu, saldirilabilir,
    cezali: me.lockUntil > sim.realT,
    kalan: +(me.lockUntil - sim.realT).toFixed(1),
  };
});
check('ittifak kurulabiliyor', betray.kuruldu);
check('müttefike saldırı engelleniyor', betray.saldirilabilir === false);
check('ittifakı bozan ~20sn cezalanıyor',
  betray.cezali && betray.kalan > 19 && betray.kalan <= 20, JSON.stringify(betray));
await page.waitForTimeout(300);
check('üst çubukta ceza görünüyor',
  !(await page.$eval('#tb-lock', el => el.classList.contains('hidden'))));
check('cezalıyken tıklayarak saldırılamıyor', await page.evaluate(() => {
  const { sim, api } = window.__rb;
  const me = sim.nations[sim.playerId];
  const before = sim.attacks.length;
  api.startAttack(sim, me, -1, me.pool * 0.5);
  return sim.attacks.length === before;
}));
await page.screenshot({ path: path.join(OUT, '05-ceza.png') });

// ---------------------------------------------------------------- döngü
console.log('\nFaiz/gelir göstergesi');
check('10 haneli döngü göstergesi çizildi',
  (await page.$$('#pips i')).length === 10);

check('haneler zamanla doluyor', await page.evaluate(async () => {
  const dolu = () => document.querySelectorAll('#pips i.on').length;
  const a = dolu();
  await new Promise(r => setTimeout(r, 1400));
  const b = dolu();
  return b !== a;                       // ya arttı ya döngü başa döndü
}));

check('geri sayım yazısı saniye gösteriyor',
  /\d+[.,]\d+sn/.test(await page.textContent('#cycle-note')),
  await page.textContent('#cycle-note'));

check('geri sayım azalıyor', await page.evaluate(async () => {
  const { secsToIncome, sim } = { sim: window.__rb.sim, secsToIncome: window.__rb.api.secsToIncome };
  const a = secsToIncome(sim);
  await new Promise(r => setTimeout(r, 200));
  const b = secsToIncome(sim);
  return b < a || b > a;                // azalır, döngü dönerse sıçrar
}));

check('gelir tam onuncu tikte yatıyor', await page.evaluate(async () => {
  const { sim, api } = window.__rb;
  const me = sim.nations[sim.playerId];
  sim.attacks.length = 0;
  me.pool = 0;                          // tavandayken gelir kırpılır, sıfırdan başlat
  const hedef = sim.tickNo + (10 - sim.tickNo % 10);
  let oncekiTik = sim.tickNo, artis = null, sonPool = me.pool;
  const t0 = Date.now();
  while (sim.tickNo < hedef && Date.now() - t0 < 12000) {
    await new Promise(r => setTimeout(r, 30));
    if (sim.tickNo > oncekiTik) {
      artis = me.pool - sonPool;
      oncekiTik = sim.tickNo; sonPool = me.pool;
    }
  }
  // Gelir tiki, sim'in ilan ettiği arsa ödemesi kadar yatırmalı. Sabit bir
  // "toprak kadar" beklentisi yanlış: ödeme INCOME_SCALE ile ölçekleniyor.
  const beklenen = api.incomePayout(sim, me).land;
  return artis !== null
    && (artis >= beklenen * 0.9 || me.pool >= api.hardCap(sim, me) - 1);
}));
await page.screenshot({ path: path.join(OUT, '04b-dongu.png') });

// ---------------------------------------------------------------- borç
console.log('\nBorçlanma');
// Borç KASITLI olmalı: normal konumlarda hazineden pay gider, borç yalnız
// kaydıracın son diliminde (kırmızı bölge) başlar.
await page.evaluate(() => { window.__rb.ui.speed = 0; });

check('normal konumda borç yok', await page.evaluate(async () => {
  const { sim, api } = window.__rb;
  const me = sim.nations[sim.playerId];
  me.pool = api.hardCap(sim, me);
  const p = document.getElementById('pct');
  p.value = '40'; p.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 60));
  return document.querySelector('.pct-label .debt') === null;
}));

check('kaydıraç kırmızı bölgede borç gösteriyor', await page.evaluate(async () => {
  const p = document.getElementById('pct');
  p.value = '97'; p.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 60));
  return document.querySelector('.pct-label .debt') !== null
    && p.classList.contains('borrowing');
}));

check('düşük konum askerin küçük bir dilimini sürüyor', await page.evaluate(async () => {
  const { sim } = window.__rb;
  const me = sim.nations[sim.playerId];
  const p = document.getElementById('pct');
  const oku = () => +document.getElementById('pct-label')
    .querySelector('b').textContent.replace(/[^0-9]/g, '');
  p.value = '30'; p.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 40));
  const dusuk = oku();
  p.value = '80'; p.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 40));
  const yuksek = oku();
  // eğri alt uçta yatık: %30 hazinenin dörtte birinden azını sürmeli
  return dusuk < me.pool * 0.25 && yuksek > dusuk * 2;
}));

check('borç eşiği kaydıraç üstünde sabit işaretli', await page.evaluate(() => {
  const v = document.getElementById('pct').style.getPropertyValue('--borrow-at');
  return parseFloat(v) > 80 && parseFloat(v) < 95;
}));

// kırmızı bölgeden ateşlemek gerçekten borca sokmalı
const debt = await page.evaluate(() => {
  const { sim, api } = window.__rb;
  const me = sim.nations[sim.playerId];
  me.lockUntil = 0;
  sim.attacks.length = 0;
  const elde = me.pool;
  api.startAttack(sim, me, -1, elde + api.maxDebt(sim, me) * 0.6);
  return { elde: Math.round(elde), sonra: Math.round(me.pool), borclu: me.pool < 0 };
});
check('kırmızı bölgede elindekinden fazlasını sürebiliyorsun',
  debt.borclu && debt.sonra < 0, JSON.stringify(debt));

await page.waitForTimeout(300);
check('üst çubukta asker kırmızıya dönüyor',
  await page.$eval('#tb-troops', el => el.classList.contains('debt')));
check('hazine borcu gösteriyor',
  (await page.textContent('#econ-soft')).includes('borç'));
check('gelir borca gidiyor yazıyor',
  (await page.textContent('#econ-inc')).includes('borca'));

check('borçtayken tıklayarak saldırılamıyor', await page.evaluate(() => {
  const { sim, api } = window.__rb;
  const me = sim.nations[sim.playerId];
  return api.canAttack(sim, me, -1) === false;
}));
await page.screenshot({ path: path.join(OUT, '05b-borc.png') });

// borcu kapat ve kaydıracı varsayılana çek ki kalan testler normal işlesin
await page.evaluate(() => {
  const { sim } = window.__rb;
  sim.nations[sim.playerId].pool = 500;
  const p = document.getElementById('pct');
  p.value = '38'; p.dispatchEvent(new Event('input'));
});
await page.evaluate(() => { window.__rb.ui.speed = 1; });

// ---------------------------------------------------------------- his
console.log('\nHissiyat katmanı');
// Asker sayısı ulus renginin üstüne doğrudan yazılınca okunmuyordu (koyu
// yeşil/mor/turuncu zeminlerde kayboluyordu). Artık parşömen bir hapın
// üstüne basılıyor — hem hap hem mürekkep piksel olarak aranıyor.
check('haritada asker sayısı okunaklı basılıyor', await page.evaluate(() => {
  const { sim, S } = window.__rb;
  const cv = document.getElementById('map');
  const ctx = cv.getContext('2d');
  const olcek = cv.width / (window.__rb.W * S);
  for (const nat of sim.nations) {
    if (!nat.alive || nat.cells < 45) continue;
    const size = Math.max(11, Math.min(30, Math.sqrt(nat.cells) * 0.5));
    const cx = nat.cx * S * olcek, cy = (nat.cy * S + size * 0.86) * olcek;
    const w = Math.round(70 * olcek), h = Math.round(size * 1.4 * olcek);
    if (cx - w / 2 < 0 || cy - h / 2 < 0 || cx + w / 2 > cv.width || cy + h / 2 > cv.height) continue;
    const d = ctx.getImageData(cx - w / 2, cy - h / 2, w, h).data;
    let parsomen = 0, murekkep = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 235 && g > 228 && b > 205) parsomen++;
      if (r < 90 && g < 70 && b < 60) murekkep++;
    }
    // hap yeterince geniş, sayının mürekkebi de içinde
    if (parsomen > 40 && murekkep > 8) return true;
  }
  return false;
}));

// Kaydıracın altındaki sayı ile fiilen giden asker AYNI olmalı. Hamle bir
// halkaya yuvarlandığı için "15 asker" yazıp 100 göndermek kullanıcıyı
// şaşırtıyordu.
check('yazan asker ile giden asker aynı', await page.evaluate(async () => {
  const { sim, api } = window.__rb;
  const hiz = window.__rb.ui.speed;
  window.__rb.ui.speed = 0;
  const me = sim.nations[sim.playerId];
  sim.attacks.length = 0;
  me.lockUntil = 0;
  me.pool = api.hardCap(sim, me);
  const p = document.getElementById('pct');
  p.value = '20'; p.dispatchEvent(new Event('input'));     // bilerek küçük
  // cephe bedelleri 250ms önbellekli — tazelensin diye bekleyip tekrar tetikle
  await new Promise(r => setTimeout(r, 320));
  p.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 60));
  // sayı <b> içinde; etiketin geri kalanında da rakam var (cephe payı, borç)
  const yazan = +document.getElementById('pct-label')
    .querySelector('b').textContent.replace(/[^0-9]/g, '');
  // en ucuz cepheye saldır — etiketin dayandığı cephe bu
  const bedeller = api.frontCosts(sim, me);
  let hedef = null, enUcuz = Infinity;
  for (const [id, b] of bedeller) if (b < enUcuz) { enUcuz = b; hedef = id; }
  const atk = api.startAttack(sim, me, hedef, window.__rb.commitOf(me));
  window.__rb.ui.speed = hiz;
  if (!atk) return false;
  return Math.abs(atk.start - yazan) <= Math.max(2, yazan * 0.02);
}));

// Kısmi kuşatma haritada GÖRÜNMELİ: hiçbir hücre el değiştirmese bile cephe
// boyunca renk saldıranın rengine kayar. Yoksa küçük hamle "hiçbir şey
// olmadı" gibi hissettiriyor.
check('kısmi kuşatma haritada renk olarak görünüyor', await page.evaluate(async () => {
  const { sim, api } = window.__rb;
  window.__rb.ui.speed = 0;
  const me = sim.nations[sim.playerId];
  sim.attacks.length = 0; me.lockUntil = 0;
  sim.prog.fill(0); sim.progBy.fill(-1);
  me.pool = api.hardCap(sim, me);
  const cv = document.getElementById('map');
  const ctx = cv.getContext('2d');
  const kare = () => ctx.getImageData(0, 0, cv.width, cv.height).data;
  sim.dirty = true;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const once = kare();
  // Çok halkalı bir sefer: ölçüm anında mutlaka yarım dolmuş bir halka olsun
  // (tek halkalık hamle ilk saniyede kapanıp kuşatmayı bitiriyordu).
  api.startAttack(sim, me, -1, api.frontCost(sim, me, -1) * 6);
  window.__rb.ui.speed = 1;
  await new Promise(r => setTimeout(r, 400));
  window.__rb.ui.speed = 0;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sonra = kare();
  let degisen = 0;
  for (let i = 0; i < once.length; i += 4)
    if (Math.abs(once[i] - sonra[i]) + Math.abs(once[i + 1] - sonra[i + 1]) > 12) degisen++;
  // kuşatma altındaki hücrelerin çoğu HÂLÂ dolmamış olmalı (sefer sürüyor)
  let yarim = 0;
  for (let c = 0; c < sim.prog.length; c++) if (sim.prog[c] > 0.02 && sim.prog[c] < 1) yarim++;
  return degisen > 200 && yarim > 20;
}));

check('ses motoru kuruldu', await page.evaluate(() => !!window.__rb.sfx.ctx));
check('ses düğmesi sesi kapatıp açıyor', await page.evaluate(async () => {
  const b = document.getElementById('btn-sound');
  const before = window.__rb.sfx.on;
  b.click();
  const off = window.__rb.sfx.on;
  b.click();
  return before === true && off === false && window.__rb.sfx.on === true;
}));
check('sayaçlar sıçramadan akıyor', await page.evaluate(async () => {
  const { ui, sim } = window.__rb;
  const me = sim.nations[sim.playerId];
  ui.shownTroops = 0;                    // sıfırdan başlat
  await new Promise(r => setTimeout(r, 120));
  const ara = ui.shownTroops;
  return ara > 0 && ara < me.pool;       // yolda, henüz varmamış
}));

// ---------------------------------------------------------------- bitiş
// Lider kuralı ÇİFT yönlü olmalı — YZ zaten lidere yanaşmıyor (aiThink), ama
// arayüz yalnız OYUNCUNUN payına bakıyordu: oyuncu kaçan liderle ittifak kurup
// haritayı kilitleyebiliyordu.
console.log('\nLider kuralı');
const liderSonuc = await page.evaluate(async () => {
  const { sim } = window.__rb;
  const me = sim.nations[sim.playerId];
  const o = sim.nations.find(n => n.alive && n !== me && !me.allies.has(n.id));
  if (!o) return { atlandi: true };
  const yedek = o.cells;
  o.cells = Math.round(sim.landCells * 0.5);        // kıtanın yarısı = lider
  await new Promise(r => setTimeout(r, 700));       // refreshDiplo tazelesin
  let tiklandi = false;
  for (const row of document.querySelectorAll('#diplo .nat-row')) {
    if (row.querySelector('.nm').textContent !== o.name) continue;
    const b = [...row.querySelectorAll('button')].find(x => x.textContent.includes('teklif'));
    if (b) { b.click(); tiklandi = true; }
  }
  const kuruldu = me.allies.has(o.id);
  o.cells = yedek;                                   // simülasyonu geri al
  me.allies.delete(o.id); o.allies.delete(me.id);
  return { tiklandi, kuruldu, ad: o.name };
});
check('lider krallıkla ittifak kurulamıyor',
  liderSonuc.atlandi || (liderSonuc.tiklandi && !liderSonuc.kuruldu),
  JSON.stringify(liderSonuc));

console.log('\nBitiş ekranı');
await page.evaluate(() => { window.__rb.sim.over = true; window.__rb.sim.won = true; });
await page.waitForTimeout(300);
check('zafer ekranı açılıyor',
  !(await page.$eval('#end-screen', el => el.classList.contains('hidden'))));
check('zafer başlığı doğru', (await page.textContent('#end-title')).includes('Zafer'));
// Kuru bir "Zafer" yerine oyunun özeti: süre, zirve, fetih, devrilen taht.
check('bitiş ekranı özet veriyor', await page.evaluate(() => {
  const el = document.getElementById('end-stats');
  const yazi = el.textContent;
  return el.querySelectorAll('b').length >= 5
    && /Süre/.test(yazi) && /Zirve/.test(yazi) && /Yıkılan/.test(yazi)
    && /\d/.test(el.querySelector('b').textContent);
}));
await page.screenshot({ path: path.join(OUT, '06-zafer.png') });

console.log('\nKonsol');
check('sayfada JS hatası yok', errors.length === 0, errors.join('\n      '));

await browser.close();
server.close();
console.log(`\n${pass} geçti, ${fail} kaldı`);
console.log(`ekran görüntüleri: ${OUT}\n`);
process.exit(fail ? 1 : 0);
