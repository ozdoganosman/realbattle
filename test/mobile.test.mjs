// Telefon testi: gerçek dokunma olaylarıyla (CDP çok parmak) dokun-saldır,
// kaydırma, iki parmakla yakınlaştırma ve alt çekmece.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SHOT_DIR || path.join(ROOT, '.shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3, isMobile: true, hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + (process.env.PAGE || '/index.html'), { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const cdp = await context.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tap(p) {
  await touch('touchStart', [p]);
  await sleep(40);
  await touch('touchEnd', []);
}
async function swipe(from, to, steps = 10) {
  await touch('touchStart', [from]);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', [{
      x: from.x + (to.x - from.x) * i / steps,
      y: from.y + (to.y - from.y) * i / steps,
    }]);
    await sleep(16);
  }
  await touch('touchEnd', []);
}

console.log('\nTelefon yerleşimi');
check('sayfa yatay taşmıyor', await page.evaluate(() =>
  document.documentElement.scrollWidth <= window.innerWidth + 1));
check('açılış ekranı ekrana sığıyor', await page.evaluate(() => {
  const r = document.getElementById('start-box').getBoundingClientRect();
  return r.width <= window.innerWidth && r.height <= window.innerHeight;
}));
check('krallık listesi 2 sütun', await page.evaluate(() =>
  getComputedStyle(document.getElementById('nation-list')).gridTemplateColumns.split(' ').length === 2));
check('üst çubuk tek satırda kalıyor', await page.evaluate(() => {
  const tb = document.getElementById('topbar');
  return tb.scrollHeight <= tb.clientHeight + 1 && tb.scrollWidth <= tb.clientWidth + 1;
}), await page.evaluate(() => {
  const tb = document.getElementById('topbar');
  return `içerik ${tb.scrollWidth}×${tb.scrollHeight}, kutu ${tb.clientWidth}×${tb.clientHeight}`;
}));
await page.screenshot({ path: path.join(OUT, 'm1-acilis.png') });

await (await page.$$('.nation-btn'))[12].click();
await page.waitForTimeout(600);

const info = () => page.evaluate(() => {
  const { sim, view } = window.__rb;
  const me = sim.nations[sim.playerId];
  return {
    cells: me.cells, pool: Math.round(me.pool),
    fronts: sim.attacks.filter(a => a.from === me.id).length,
    t: +sim.t.toFixed(1),
    scale: +view.scale.toFixed(2), tx: Math.round(view.tx), ty: Math.round(view.ty),
    drawerOpen: document.getElementById('panel').classList.contains('open'),
  };
});

console.log('\nÇekmece');
const s0 = await info();
check('çekmece kapalı başlıyor', !s0.drawerOpen);
check('kapalıyken saldırı gücü görünür', await page.evaluate(() =>
  document.getElementById('pct').getBoundingClientRect().height > 0));
check('kapalıyken krallık listesi gizli', await page.evaluate(() =>
  document.querySelector('.sec.grow').getBoundingClientRect().height === 0));

await page.tap('#zoom-fit');
await page.waitForTimeout(250);
check('sığdır ölçeğinde harita tümüyle çekmecenin üstünde', await page.evaluate(() => {
  const m = document.getElementById('stage').getBoundingClientRect();
  const p = document.getElementById('panel').getBoundingClientRect();
  return m.bottom <= p.top + 2 && m.top >= 38;
}), await page.evaluate(() => {
  const m = document.getElementById('stage').getBoundingClientRect();
  const p = document.getElementById('panel').getBoundingClientRect();
  return `harita ${Math.round(m.top)}–${Math.round(m.bottom)}, panel üst ${Math.round(p.top)}`;
}));
await page.evaluate(() => window.__rb.focusHome());
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(OUT, 'm2-kapali.png') });

await page.tap('#drawer');
await page.waitForTimeout(450);
check('koluna dokununca açılıyor', (await info()).drawerOpen);
check('açıkken krallık listesi görünür', await page.evaluate(() =>
  document.querySelector('.sec.grow').getBoundingClientRect().height > 0));
await page.screenshot({ path: path.join(OUT, 'm3-acik.png') });
await page.tap('#drawer');
await page.waitForTimeout(450);
check('tekrar dokununca kapanıyor', !(await info()).drawerOpen);

console.log('\nBaşlangıç görünümü');
check('telefonda yurda yakınlaşılmış başlıyor', (await info()).scale > 2,
  `ölçek ${(await info()).scale}`);
check('yakınlaşmışken harita görünür alanı dolduruyor', await page.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect();
  const w = document.getElementById('map-wrap');
  const r = w.getBoundingClientRect();
  const cs = getComputedStyle(w);
  const top = r.top + (parseFloat(cs.paddingTop) || 0);
  const bottom = r.bottom - (parseFloat(cs.paddingBottom) || 0);
  return st.top <= top + 2 && st.bottom >= bottom - 2;
}));

// ---------------------------------------------------------------- saldırı
console.log('\nDokun — saldır');
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
      if (sx > 25 && sx < window.innerWidth - 25 && sy > 60 && sy < window.innerHeight - 150)
        return { sx, sy };
    }
  }
  return null;
});
check('ekranda dokunulabilir hedef var', !!target);

const before = await info();
await tap({ x: target.sx, y: target.sy });
await page.waitForTimeout(250);
const afterTap = await info();
check('parmakla dokununca sefer başlıyor', afterTap.fronts > before.fronts,
  `${before.fronts} → ${afterTap.fronts}`);
check('sefer havuzdan asker düşürüyor', afterTap.pool < before.pool,
  `${before.pool} → ${afterTap.pool}`);
check('dokunma haritayı kaydırmadı',
  afterTap.tx === before.tx && afterTap.ty === before.ty);

await page.waitForTimeout(1600);
check('sınır yayılıyor', (await info()).cells > before.cells);
await page.screenshot({ path: path.join(OUT, 'm4-saldiri.png') });

// ---------------------------------------------------------------- gezinme
console.log('\nHarita gezinme');
// Görünüm kenara dayanmışsa o yöne kayamaz (kaydırma sınırı böyle çalışır),
// bu yüzden tek yöne bakmak kararsız bir test olur — iki yönü de dene.
const b2 = await info();
await swipe({ x: 200, y: 400 }, { x: 120, y: 400 });
await page.waitForTimeout(250);
let a2 = await info();
if (a2.tx === b2.tx) {
  await swipe({ x: 120, y: 400 }, { x: 240, y: 400 });
  await page.waitForTimeout(250);
  a2 = await info();
}
check('parmağı sürükleyince harita kayıyor', a2.tx !== b2.tx, `tx ${b2.tx} → ${a2.tx}`);
check('kaydırma sefer başlatmıyor', a2.fronts <= b2.fronts,
  `sefer ${b2.fronts} → ${a2.fronts}`);

const b3 = await info();
const cx = 195, cy = 380;
await touch('touchStart', [{ x: cx - 40, y: cy, id: 0 }, { x: cx + 40, y: cy, id: 1 }]);
for (let i = 1; i <= 8; i++) {
  const d = 40 + i * 9;
  await touch('touchMove', [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }]);
  await sleep(20);
}
await touch('touchEnd', []);
await page.waitForTimeout(250);
check('iki parmakla yakınlaştırma çalışıyor', (await info()).scale > b3.scale,
  `ölçek ${b3.scale} → ${(await info()).scale}`);

await page.tap('#zoom-fit');
await page.waitForTimeout(250);
check('sığdır düğmesi tam ölçeğe döndürüyor', (await info()).scale === 1);

console.log('\nOynanış');
await page.tap('#btn-fast');
await page.waitForTimeout(6000);
const fin = await info();
check('telefonda oyun ilerliyor', fin.t > afterTap.t + 4, `t=${fin.t}`);
await page.screenshot({ path: path.join(OUT, 'm5-oyun.png') });

console.log('\nKonsol');
check('telefonda JS hatası yok', errors.length === 0, errors.join('\n      '));

await browser.close();
server.close();
console.log(`\n${pass} geçti, ${fail} kaldı\n`);
process.exit(fail ? 1 : 0);
