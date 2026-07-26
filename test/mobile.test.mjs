// Telefon testi: gerçek dokunma olaylarıyla (CDP çok parmak) ordu fırlatma,
// harita kaydırma, iki parmakla yakınlaştırma ve alt çekmece.

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
  args: ['--no-sandbox'],
});
// iPhone 14 ölçüleri
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
  type,
  touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// tek parmakla sürükleme
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
  document.documentElement.scrollWidth <= window.innerWidth + 1),
  await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`));
check('açılış ekranı ekrana sığıyor', await page.evaluate(() => {
  const r = document.getElementById('start-box').getBoundingClientRect();
  return r.width <= window.innerWidth && r.height <= window.innerHeight;
}));
check('krallık listesi telefonda 2 sütun', await page.evaluate(() =>
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
await page.waitForTimeout(500);

const info = () => page.evaluate(() => {
  const { sim, ui } = window.__rb;
  const me = sim.nations[sim.playerId];
  return {
    cells: me.cells, pool: Math.round(me.pool),
    armies: sim.armies.filter(a => a.nat === me.id).length,
    t: +sim.t.toFixed(1), scale: +window.__rb.view.scale.toFixed(2),
    tx: Math.round(window.__rb.view.tx), ty: Math.round(window.__rb.view.ty),
    drawerOpen: document.getElementById('panel').classList.contains('open'),
    dragging: !!ui.drag,
  };
});

console.log('\nÇekmece');
const s0 = await info();
check('çekmece kapalı başlıyor', !s0.drawerOpen);
check('kapalıyken sefer gücü görünür', await page.evaluate(() =>
  document.getElementById('pct').getBoundingClientRect().height > 0));
check('kapalıyken krallık listesi gizli', await page.evaluate(() =>
  document.querySelector('.sec.grow').getBoundingClientRect().height === 0));
// Yakınlaşmışken harita çekmecenin altına taşabilir (kaydırarak ulaşılır);
// asıl gereklilik, sığdır ölçeğinde haritanın tamamının görünür kalması.
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
await page.evaluate(() => window.__rb.focusCapital());
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, 'm2-kapali.png') });

await page.tap('#drawer');
await page.waitForTimeout(450);
check('koluna dokununca çekmece açılıyor', (await info()).drawerOpen);
check('açıkken krallık listesi görünür', await page.evaluate(() =>
  document.querySelector('.sec.grow').getBoundingClientRect().height > 0));
await page.screenshot({ path: path.join(OUT, 'm3-acik.png') });
await page.tap('#drawer');
await page.waitForTimeout(450);
check('tekrar dokununca kapanıyor', !(await info()).drawerOpen);

console.log('\nBaşlangıç görünümü');
check('telefonda başkente yakınlaşılmış başlıyor', s0.scale > 2,
  `ölçek ${s0.scale}`);
// Yakınlaşmışken harita, çekmecenin üstündeki görünür alanı boşluk
// bırakmadan doldurmalı (kaydırma sınırı dolguyu görünür alan sanmamalı).
check('yakınlaşmışken harita görünür alanı dolduruyor', await page.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect();
  const w = document.getElementById('map-wrap');
  const r = w.getBoundingClientRect();
  const cs = getComputedStyle(w);
  const top = r.top + (parseFloat(cs.paddingTop) || 0);
  const bottom = r.bottom - (parseFloat(cs.paddingBottom) || 0);
  return st.top <= top + 2 && st.bottom >= bottom - 2;
}), await page.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect();
  const w = document.getElementById('map-wrap');
  const r = w.getBoundingClientRect();
  const cs = getComputedStyle(w);
  return `harita ${Math.round(st.top)}–${Math.round(st.bottom)}, ` +
    `görünür alan ${Math.round(r.top + (parseFloat(cs.paddingTop) || 0))}–` +
    `${Math.round(r.bottom - (parseFloat(cs.paddingBottom) || 0))}`;
}));

// ---------------------------------------------------------------- fırlatma
console.log('\nTek parmakla ordu fırlatma');
const front = await page.evaluate(() => {
  const { sim, W, H } = window.__rb;
  const me = sim.nations[sim.playerId];
  const r = document.getElementById('map').getBoundingClientRect();
  for (let i = 0; i < W * H; i++) {
    if (sim.owner[i] !== me.id) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (y + oy) * W + (x + ox);
      if (!sim.world.isLand[n] || sim.owner[n] === me.id) continue;
      const sx = r.left + (x + 0.5) / W * r.width;
      const sy = r.top + (y + 0.5) / H * r.height;
      // ekranda ve haritanın görünür kısmında olsun
      if (sx > 20 && sx < window.innerWidth - 20 && sy > 60 && sy < window.innerHeight - 160)
        return { sx, sy, dx: ox, dy: oy };
    }
  }
  return null;
});
check('ekranda görünür bir sınır noktası var', !!front);

const before = await info();
await swipe({ x: front.sx, y: front.sy },
  { x: front.sx + front.dx * 90, y: front.sy + front.dy * 90 });
await page.waitForTimeout(300);
const afterLaunch = await info();
check('parmakla sürükleyince ordu fırlıyor', afterLaunch.armies > before.armies,
  `${before.armies} → ${afterLaunch.armies}`);
check('fırlatma garnizondan asker düşürüyor', afterLaunch.pool < before.pool,
  `${before.pool} → ${afterLaunch.pool}`);
check('ordu fırlatırken harita kaymadı',
  afterLaunch.tx === before.tx && afterLaunch.ty === before.ty,
  `(${before.tx},${before.ty}) → (${afterLaunch.tx},${afterLaunch.ty})`);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'm4-ordu.png') });

// ---------------------------------------------------------------- kaydırma
console.log('\nHarita gezinme');
const sea = await page.evaluate(() => {
  const { sim, W, H } = window.__rb;
  const r = document.getElementById('map').getBoundingClientRect();
  for (let i = 0; i < W * H; i++) {
    if (sim.world.isLand[i]) continue;
    const x = i % W, y = (i / W) | 0;
    const sx = r.left + (x + 0.5) / W * r.width;
    const sy = r.top + (y + 0.5) / H * r.height;
    if (sx > 60 && sx < window.innerWidth - 60 && sy > 120 && sy < window.innerHeight - 260)
      return { sx, sy };
  }
  return null;
});
if (sea) {
  const b2 = await info();
  await swipe({ x: sea.sx, y: sea.sy }, { x: sea.sx - 70, y: sea.sy });
  await page.waitForTimeout(250);
  const a2 = await info();
  check('kendi toprağın dışından sürükleyince harita kayıyor', a2.tx !== b2.tx,
    `tx ${b2.tx} → ${a2.tx}`);
  check('kaydırma ordu üretmiyor', a2.armies <= b2.armies,
    `oyuncunun ordusu ${b2.armies} → ${a2.armies}`);
} else {
  check('kaydırma için deniz noktası bulundu', false, 'uygun nokta yok');
}

// iki parmakla yakınlaştırma
const cx = 195, cy = 330;
const b3 = await info();
await touch('touchStart', [{ x: cx - 40, y: cy, id: 0 }, { x: cx + 40, y: cy, id: 1 }]);
for (let i = 1; i <= 8; i++) {
  const d = 40 + i * 9;
  await touch('touchMove', [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }]);
  await sleep(20);
}
await touch('touchEnd', []);
await page.waitForTimeout(250);
const a3 = await info();
check('iki parmakla yakınlaştırma çalışıyor', a3.scale > b3.scale,
  `ölçek ${b3.scale} → ${a3.scale}`);

// uzaklaştırma düğmesi
await page.tap('#zoom-fit');
await page.waitForTimeout(250);
check('sığdır düğmesi haritayı tam ölçeğe döndürüyor', (await info()).scale === 1);
await page.screenshot({ path: path.join(OUT, 'm5-sigdir.png') });

console.log('\nOynanış');
await page.tap('#btn-fast');
await page.waitForTimeout(6000);
const fin = await info();
check('telefonda oyun ilerliyor', fin.t > afterLaunch.t + 4, `t=${fin.t}`);
check('toprak kazanılıyor', fin.cells > before.cells, `${before.cells} → ${fin.cells}`);
await page.screenshot({ path: path.join(OUT, 'm6-oyun.png') });

console.log('\nKonsol');
check('telefonda JS hatası yok', errors.length === 0, errors.join('\n      '));

await browser.close();
server.close();
console.log(`\n${pass} geçti, ${fail} kaldı\n`);
process.exit(fail ? 1 : 0);
