// Tarayıcı testi: gerçek fare ile bas–sürükle–bırak, çizim ve arayüz akışı.
// Kendi statik sunucusunu ayağa kaldırır.  Çalıştırma: npm run test:browser

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SHOT_DIR || path.join(ROOT, '.shots');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml',
};

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
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

console.log('\nAçılış');
check('açılış ekranı 16 krallık listeliyor',
  (await page.$$('.nation-btn')).length === 16);
check('harita ilk karede çiziliyor', await page.evaluate(() => {
  const c = document.getElementById('map');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let nonEmpty = 0;
  for (let i = 3; i < d.length; i += 4 * 977) if (d[i] > 0) nonEmpty++;
  return nonEmpty > 10;
}));
await page.screenshot({ path: path.join(OUT, '01-acilis.png') });

await (await page.$$('.nation-btn'))[12].click();     // Osmanlı
await page.waitForTimeout(400);

const info = () => page.evaluate(() => {
  const { sim } = window.__rb;
  const me = sim.nations[sim.playerId];
  return {
    ad: me.name, cells: me.cells, pool: Math.round(me.pool),
    armies: sim.armies.length, t: +sim.t.toFixed(1),
    alive: sim.nations.filter(n => n.alive).length,
    locked: me.lockUntil > sim.realT,
  };
});

console.log('\nOyuna giriş');
const start = await info();
check('oyuncu krallığı seçildi ve toprağı var', start.ad === 'Osmanlı' && start.cells > 0,
  JSON.stringify(start));
check('üst çubuk oyuncu adını gösteriyor',
  (await page.textContent('#tb-nation')).trim() === 'Osmanlı');

// ---------------------------------------------------------------- sürükleme
console.log('\nBas–sürükle–bırak');
const front = await page.evaluate(() => {
  const { sim, W, H } = window.__rb;
  const me = sim.nations[sim.playerId];
  for (let i = 0; i < W * H; i++) {
    if (sim.owner[i] !== me.id) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (y + oy) * W + (x + ox);
      if (sim.world.isLand[n] && sim.owner[n] !== me.id) return { x, y, dx: ox, dy: oy };
    }
  }
  return null;
});
check('oyuncunun sınır hücresi bulundu', !!front);

const geo = await page.evaluate(() => {
  const r = document.getElementById('map').getBoundingClientRect();
  return { left: r.left, top: r.top, w: r.width, h: r.height, W: window.__rb.W, H: window.__rb.H };
});
const p0 = {
  x: geo.left + (front.x + 0.5) / geo.W * geo.w,
  y: geo.top + (front.y + 0.5) / geo.H * geo.h,
};
const p1 = { x: p0.x + front.dx * 190, y: p0.y + front.dy * 190 };

await page.mouse.move(p0.x, p0.y);
await page.mouse.down();
await page.mouse.move((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, { steps: 8 });
await page.waitForTimeout(150);
await page.mouse.move(p1.x, p1.y, { steps: 8 });
await page.waitForTimeout(250);

const dragState = await page.evaluate(() => {
  const d = window.__rb.ui.drag;
  return d ? { active: d.active, troops: Math.round(d.troops) } : null;
});
check('sürükleme sırasında önizleme oluşuyor', !!dragState && dragState.troops > 0,
  JSON.stringify(dragState));
await page.screenshot({ path: path.join(OUT, '02-surukleme.png') });

const poolBefore = (await info()).pool;
await page.mouse.up();
await page.waitForTimeout(250);
const afterDrag = await info();
check('bırakınca ordu fırlıyor', afterDrag.armies >= 1, JSON.stringify(afterDrag));
check('fırlatma garnizondan asker düşürüyor', afterDrag.pool < poolBefore,
  `${poolBefore} → ${afterDrag.pool}`);

await page.waitForTimeout(2000);
const moved = await page.evaluate(() => {
  const a = window.__rb.sim.armies[0];
  return a ? { x: +a.x.toFixed(1), y: +a.y.toFixed(1), troops: Math.round(a.troops) } : null;
});
check('ordu haritada ilerliyor', !!moved, JSON.stringify(moved));
await page.screenshot({ path: path.join(OUT, '03-ordu.png') });

// ---------------------------------------------------------------- oynanış
console.log('\nSimülasyon akışı');
await page.click('#btn-fast');
await page.waitForTimeout(8000);
const mid = await info();
check('hızlı modda zaman ilerliyor', mid.t > afterDrag.t + 5, `t=${mid.t}`);
check('oyuncu toprak kazandı', mid.cells > start.cells, `${start.cells} → ${mid.cells}`);
await page.screenshot({ path: path.join(OUT, '04-oyun.png') });

check('duraklat gerçekten durduruyor', await page.evaluate(async () => {
  document.getElementById('btn-pause').click();
  const t0 = window.__rb.sim.t;
  await new Promise(r => setTimeout(r, 600));
  return window.__rb.sim.t === t0;
}));
await page.click('#btn-play');

// ---------------------------------------------------------------- diplomasi
console.log('\nDiplomasi ve ihanet cezası');
const betray = await page.evaluate(() => {
  const { sim, api } = window.__rb;
  const me = sim.nations[sim.playerId];
  const other = sim.nations.find(n => n.alive && n !== me && !me.wars.has(n.id));
  api.formAlliance(sim, me, other);
  const kuruldu = me.allies.has(other.id);
  api.breakAlliance(sim, me, other);
  return { kuruldu, cezali: me.lockUntil > sim.realT, kalan: +(me.lockUntil - sim.realT).toFixed(1) };
});
check('ittifak kurulabiliyor', betray.kuruldu);
check('ittifakı bozan cezalanıyor (~20sn)', betray.cezali && betray.kalan > 19 && betray.kalan <= 20,
  JSON.stringify(betray));

await page.waitForTimeout(400);
check('üst çubukta ihanet cezası görünüyor',
  !(await page.$eval('#tb-lock', el => el.classList.contains('hidden'))));

const blocked = await page.evaluate(() => {
  const { sim, api } = window.__rb;
  const me = sim.nations[sim.playerId];
  const before = sim.armies.length;
  api.launchArmy(sim, me, 5, 5, 1, 0, 200, 20);
  return sim.armies.length === before;
});
check('cezalıyken ordu fırlatılamıyor', blocked);
await page.screenshot({ path: path.join(OUT, '05-ceza.png') });

// ---------------------------------------------------------------- bitiş
console.log('\nBitiş ekranı');
await page.evaluate(() => { window.__rb.sim.over = true; window.__rb.sim.won = true; });
await page.waitForTimeout(300);
check('zafer ekranı açılıyor',
  !(await page.$eval('#end-screen', el => el.classList.contains('hidden'))));
check('zafer başlığı doğru', (await page.textContent('#end-title')).includes('Zafer'));
await page.screenshot({ path: path.join(OUT, '06-zafer.png') });

console.log('\nKonsol');
check('sayfada JS hatası yok', errors.length === 0, errors.join('\n      '));

await browser.close();
server.close();
console.log(`\n${pass} geçti, ${fail} kaldı`);
console.log(`ekran görüntüleri: ${OUT}\n`);
process.exit(fail ? 1 : 0);
