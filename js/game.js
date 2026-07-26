// İstemci katmanı: girdi, arayüz, ana döngü.
// Oyun kuralları burada DEĞİL — hepsi sim.js içinde (sunucuya taşınabilir).

import { W, H, S, idx, clamp, TERRAIN } from './world.js';
import {
  createSim, step, NATION_DEFS, dateLabel, WIN_FRAC, BETRAY_LOCK,
  troopCap, power, landFrac, natOf, atWar, allied, truced, locked,
  launchArmy, declareWar, makePeace, formAlliance, breakAlliance,
  answerCall, log,
} from './sim.js';
import { createRenderer } from './render.js';

const $ = id => document.getElementById(id);
const fmt = v => Math.round(v).toLocaleString('tr-TR');

const seed = (Math.random() * 2 ** 31) | 0;
const sim = createSim(seed);

const mapCanvas = $('map'), fxCanvas = $('fx');
const renderer = createRenderer(sim, mapCanvas, fxCanvas);

const ui = {
  speed: 1, started: false,
  drag: null,
  selected: -1,
  pct: 0.55,
  lastLogLen: 0,
  now: 0,
};

// ------------------------------------------------------------------ görünüm

const stage = $('stage');
const wrap = $('map-wrap');
const view = { scale: 1, tx: 0, ty: 0 };

function isNarrow() { return window.innerWidth <= 860; }

// Görünür harita alanı — map-wrap'in DOLGU HARİÇ kutusu. Dar ekranda alttaki
// çekmece için ayrılan dolgu görünür alan değildir; kaydırma sınırları da
// bu kutuya göre hesaplanmalı.
function wrapBox() {
  const r = wrap.getBoundingClientRect();
  const cs = getComputedStyle(wrap);
  const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
  const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
  return {
    left: r.left + pl, top: r.top + pt,
    width: r.width - pl - pr, height: r.height - pt - pb,
  };
}

// Sahnenin dönüşümsüz (flex ile ortalanmış) konumu. Uygulanmış dönüşümden
// geri hesaplanamaz: clampView, view.tx güncellendikten AMA DOM'a yazılmadan
// önce çalışır; o anda okunan dikdörtgen hâlâ eski dönüşümü taşır. Bu yüzden
// dönüşümü geçici olarak kaldırıp doğrudan ölçüyoruz.
const base = { left: 0, top: 0 };
function measureBase() {
  const prev = stage.style.transform;
  stage.style.transform = 'none';
  const r = stage.getBoundingClientRect();
  base.left = r.left; base.top = r.top;
  stage.style.transform = prev;
}

function fitStage() {
  const b = wrapBox();
  const s = Math.min(b.width / (W * S), b.height / (H * S));
  stage.style.width = W * S * s + 'px';
  stage.style.height = H * S * s + 'px';
  measureBase();
  applyView();
}

function baseOrigin() { return base; }

function clampView() {
  const bw = stage.offsetWidth * view.scale;
  const bh = stage.offsetHeight * view.scale;
  const wr = wrapBox();
  const b = baseOrigin();
  const fit = (base, size, wrapStart, wrapSize, t) => {
    if (size <= wrapSize) return wrapStart + (wrapSize - size) / 2 - base;
    return clamp(t, wrapStart + wrapSize - size - base, wrapStart - base);
  };
  view.tx = fit(b.left, bw, wr.left, wr.width, view.tx);
  view.ty = fit(b.top, bh, wr.top, wr.height, view.ty);
}

function applyView() {
  clampView();
  stage.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
}

// (u,v) = sahne içeriğine göre 0..1 konum; onu ekranda (sx,sy)'de tut.
function anchorAt(u, v, sx, sy, newScale) {
  const b = baseOrigin();
  view.scale = newScale;
  view.tx = sx - b.left - u * stage.offsetWidth * newScale;
  view.ty = sy - b.top - v * stage.offsetHeight * newScale;
  applyView();
}

function contentPoint(sx, sy) {
  const b = baseOrigin();
  return {
    u: (sx - b.left - view.tx) / (stage.offsetWidth * view.scale),
    v: (sy - b.top - view.ty) / (stage.offsetHeight * view.scale),
  };
}

function zoomBy(factor) {
  const wr = wrapBox();
  const cx = wr.left + wr.width / 2, cy = wr.top + wr.height / 2;
  const p = contentPoint(cx, cy);
  anchorAt(p.u, p.v, cx, cy, clamp(view.scale * factor, 1, 9));
}

// oyuncunun başkentine odaklan (dar ekranda başlangıç görünümü)
function focusCapital() {
  const me = sim.nations[sim.playerId];
  if (!me) return;
  const cap = sim.world.cities[me.capital];
  const wr = wrapBox();
  anchorAt(cap.x / W, cap.y / H, wr.left + wr.width / 2, wr.top + wr.height / 2,
    isNarrow() ? 3.4 : 1);
}

window.addEventListener('resize', fitStage);
$('zoom-in').onclick = () => zoomBy(1.45);
$('zoom-out').onclick = () => zoomBy(1 / 1.45);
$('zoom-fit').onclick = () => { view.scale = 1; applyView(); };

mapCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const p = contentPoint(e.clientX, e.clientY);
  anchorAt(p.u, p.v, e.clientX, e.clientY,
    clamp(view.scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 1, 9));
}, { passive: false });

function cellFromPoint(sx, sy) {
  const r = mapCanvas.getBoundingClientRect();
  const x = (sx - r.left) / r.width * W;
  const y = (sy - r.top) / r.height * H;
  return { x, y, cx: clamp(x | 0, 0, W - 1), cy: clamp(y | 0, 0, H - 1) };
}

// ------------------------------------------------------------------ sürükleme

// Sürükleme çizgisi üzerindeki hücreleri örnekleyip savaş uyarısı üret.
function dragWarning(d) {
  const me = sim.nations[sim.playerId];
  const foes = new Set();
  const len = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
  const steps = clamp(len | 0, 1, 120);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = clamp((d.x0 + (d.x1 - d.x0) * t) | 0, 0, W - 1);
    const y = clamp((d.y0 + (d.y1 - d.y0) * t) | 0, 0, H - 1);
    const c = idx(x, y);
    if (!sim.world.isLand[c]) continue;
    const o = sim.owner[c];
    if (o < 0 || o === me.id) continue;
    const n = sim.nations[o];
    if (allied(me, n)) continue;
    if (truced(sim, me, n)) { foes.add(`⛔ ${n.name} ile ateşkes`); continue; }
    if (!atWar(me, n)) foes.add(`⚠ ${n.name}'a savaş ilanı`);
  }
  return [...foes].slice(0, 2).join('  ·  ');
}

// Tek işaretçi (fare ya da tek parmak):
//   kendi toprağından başlarsa → ordu fırlatma
//   başka yerden başlarsa      → haritayı kaydırma
// İki parmak: her zaman yakınlaştırma + kaydırma.

const ptrs = new Map();
let pan = null, pinch = null;

function startLaunch(sx, sy) {
  const me = sim.nations[sim.playerId];
  const p = cellFromPoint(sx, sy);
  const c = idx(p.cx, p.cy);
  ui.selected = c;
  refreshRegion();
  if (sim.owner[c] !== me.id) return false;
  if (locked(sim, me)) {
    flashHint(`İhanet cezası sürüyor — ${Math.ceil(me.lockUntil - sim.realT)} sn saldıramazsın`);
    return false;
  }
  ui.drag = { active: true, x0: p.x, y0: p.y, x1: p.x, y1: p.y, troops: 0, warn: '', blocked: false };
  return true;
}

function endLaunch() {
  const d = ui.drag;
  ui.drag = null;
  if (!d || !d.active) return;
  const me = sim.nations[sim.playerId];
  const dx = d.x1 - d.x0, dy = d.y1 - d.y0;
  const len = Math.hypot(dx, dy);
  if (len < 2.5) return;                        // kazara dokunuş
  const troops = me.pool * ui.pct;
  if (troops < 20) { flashHint('Yeterli asker yok'); return; }
  if (launchArmy(sim, me, d.x0, d.y0, dx, dy, troops, len)) refreshTop();
}

function beginPinch() {
  ui.drag = null; pan = null;
  const [a, b] = [...ptrs.values()];
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  pinch = {
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    scale: view.scale,
    ...contentPoint(mx, my),
  };
}

mapCanvas.addEventListener('pointerdown', e => {
  if (!ui.started || sim.over) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  mapCanvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (ptrs.size === 2) { beginPinch(); return; }
  if (ptrs.size > 2) return;

  if (!startLaunch(e.clientX, e.clientY))
    pan = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
});

mapCanvas.addEventListener('pointermove', e => {
  const rec = ptrs.get(e.pointerId);
  if (rec) { rec.x = e.clientX; rec.y = e.clientY; }

  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    anchorAt(pinch.u, pinch.v, mx, my, clamp(pinch.scale * (d / pinch.dist), 1, 9));
    return;
  }
  if (pan) {
    view.tx = pan.tx + (e.clientX - pan.sx);
    view.ty = pan.ty + (e.clientY - pan.sy);
    applyView();
    return;
  }
  const d = ui.drag;
  if (!d || !d.active) return;
  const p = cellFromPoint(e.clientX, e.clientY);
  d.x1 = p.x; d.y1 = p.y;
  d.troops = sim.nations[sim.playerId].pool * ui.pct;
  d.warn = dragWarning(d);
  d.blocked = d.warn.startsWith('⛔');
});

function endPointer(e) {
  ptrs.delete(e.pointerId);
  if (pinch) { if (ptrs.size < 2) pinch = null; return; }
  if (pan) { pan = null; return; }
  endLaunch();
}
mapCanvas.addEventListener('pointerup', endPointer);
mapCanvas.addEventListener('pointercancel', endPointer);

function flashHint(text) {
  const el = $('hint-bar');
  el.textContent = text;
  el.classList.add('warn');
  clearTimeout(flashHint._t);
  flashHint._t = setTimeout(() => {
    el.classList.remove('warn');
    el.innerHTML = 'Kendi toprağından <b>bas–sürükle–bırak</b>: ordu o yöne fırlar.';
  }, 2600);
}

// ------------------------------------------------------------------ arayüz

$('pct').addEventListener('input', e => { ui.pct = +e.target.value / 100; refreshPct(); });

function refreshPct() {
  if (sim.playerId < 0) return;
  const me = sim.nations[sim.playerId];
  $('pct-label').innerHTML =
    `Ordunun <b>%${Math.round(ui.pct * 100)}</b>'i &nbsp;→&nbsp; <b>${fmt(me.pool * ui.pct)}</b> asker`;
}

function refreshTop() {
  if (sim.playerId < 0) return;
  const me = sim.nations[sim.playerId];
  $('tb-nation').textContent = me.name;
  $('tb-nation').style.color = me.color;
  $('tb-gold').textContent = fmt(me.gold);
  $('tb-troops').textContent = fmt(me.pool);
  $('tb-cap').textContent = fmt(troopCap(sim, me));
  $('tb-land').textContent = (landFrac(sim, me) * 100).toFixed(1) + '%';
  $('tb-date').textContent = dateLabel(sim);
  const lockEl = $('tb-lock');
  if (locked(sim, me)) {
    lockEl.classList.remove('hidden');
    lockEl.textContent = `⛔ İhanet cezası ${Math.ceil(me.lockUntil - sim.realT)}sn`;
  } else lockEl.classList.add('hidden');
  refreshPct();
}

function refreshRegion() {
  const el = $('region-info');
  const c = ui.selected;
  if (c < 0 || !sim.world.isLand[c]) {
    el.innerHTML = '<span class="dim-i">İncelemek için bir bölge seç.</span>';
    return;
  }
  const reg = sim.world.regions[sim.world.regionOf[c]];
  const city = reg && reg.city != null ? sim.world.cities[reg.city] : null;
  const o = sim.owner[c];
  const holder = o >= 0 ? sim.nations[o] : null;
  const ter = TERRAIN[sim.world.terrain[c]];
  const rows = [
    ['Sahip', holder
      ? `<b style="color:${holder.color}">${holder.name}</b>`
      : '<i>tarafsız</i>'],
    ['Arazi', `${ter.ad} <span class="dim">(×${ter.cost.toFixed(2)} maliyet)</span>`],
  ];
  if (city) {
    rows.push(['Şehir', `${city.name} <span class="dim">(${fmt(city.pop)} nüfus)</span>`]);
    rows.push(['Kale', city.castle ? '▮'.repeat(city.castle) : '—']);
  }
  if (!holder && reg) rows.push(['Yerel direnç', `×${reg.def.toFixed(2)}`]);
  el.innerHTML = rows.map(r => `<div class="row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');

  // kendi şehrinse kale yükseltme
  if (city && city.owner === sim.playerId && city.castle < 4) {
    const me = sim.nations[sim.playerId];
    const cost = (city.castle + 1) * 220;
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = `🏰 Kaleyi güçlendir (${cost} altın)`;
    b.disabled = me.gold < cost;
    b.onclick = () => {
      if (me.gold < cost) return;
      me.gold -= cost; city.castle++;
      sim.dirty = true;
      log(sim, `🏰 ${city.name} kalesi ${city.castle}. kademeye çıktı`, 'build');
      refreshRegion(); refreshTop();
    };
    el.appendChild(b);
  }
}

function statusOf(me, n) {
  if (n === me) return { t: 'sen', k: 'self' };
  if (allied(me, n)) return { t: 'ittifak', k: 'ally' };
  if (atWar(me, n)) return { t: 'savaş', k: 'war' };
  if (truced(sim, me, n)) return { t: 'ateşkes', k: 'truce' };
  return { t: 'barış', k: 'peace' };
}

function refreshDiplo() {
  const el = $('diplo');
  const me = sim.nations[sim.playerId];
  const list = sim.nations.filter(n => n.alive)
    .sort((a, b) => b.cells - a.cells);
  el.innerHTML = '';
  for (const n of list) {
    const st = statusOf(me, n);
    const row = document.createElement('div');
    row.className = 'nat-row ' + st.k;
    const frac = (landFrac(sim, n) * 100).toFixed(1);
    row.innerHTML =
      `<span class="sw" style="background:${n.color}"></span>` +
      `<span class="nm">${n.name}</span>` +
      `<span class="pc">${frac}%</span>` +
      `<span class="st">${st.t}</span>`;
    if (n !== me) {
      const acts = document.createElement('div');
      acts.className = 'acts';
      if (allied(me, n)) {
        acts.appendChild(mkBtn('İttifakı boz', 'bad', () => {
          breakAlliance(sim, me, n);
          refreshDiplo(); refreshTop();
        }, `${BETRAY_LOCK} saniye hiçbir yere saldıramazsın`));
      } else if (atWar(me, n)) {
        acts.appendChild(mkBtn('Barış teklif et', 'good', () => {
          if (power(sim, n) < power(sim, me) * 0.85 || sim.rnd() < 0.3) makePeace(sim, me, n);
          else log(sim, `❌ ${n.name} barış teklifini reddetti`, 'info');
          refreshDiplo();
        }));
      } else {
        if (!truced(sim, me, n))
          acts.appendChild(mkBtn('Savaş ilan et', 'bad', () => {
            declareWar(sim, me, n); refreshDiplo();
          }));
        acts.appendChild(mkBtn('İttifak teklif et', '', () => {
          const ok = power(sim, me) < power(sim, n) * 2.2 && landFrac(sim, me) < 0.34;
          if (ok && formAlliance(sim, me, n)) log(sim, `🤝 ${n.name} teklifini kabul etti`, 'ally');
          else log(sim, `❌ ${n.name} ittifakı reddetti — fazla güçlüsün`, 'info');
          refreshDiplo();
        }));
      }
      row.appendChild(acts);
    }
    el.appendChild(row);
  }
}

function mkBtn(text, cls, fn, title) {
  const b = document.createElement('button');
  b.className = 'mini ' + cls;
  b.textContent = text;
  if (title) b.title = title;
  b.onclick = fn;
  return b;
}

function refreshInbox() {
  const el = $('inbox');
  const me = sim.nations[sim.playerId];
  el.innerHTML = '';
  let any = false;

  // savaşa çağrılar
  for (const call of sim.pendingCalls.filter(c => c.target === sim.playerId)) {
    any = true;
    const caller = sim.nations[call.caller], foe = sim.nations[call.foe];
    const box = document.createElement('div');
    box.className = 'msg call';
    box.innerHTML = `<div><b>${caller.name}</b> seni <b>${foe.name}</b>'a karşı savaşa çağırıyor.</div>`;
    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.appendChild(mkBtn('Katıl', 'good', () => {
      answerCall(sim, call, true);
      sim.pendingCalls.splice(sim.pendingCalls.indexOf(call), 1);
      refreshInbox(); refreshDiplo();
    }));
    acts.appendChild(mkBtn('Reddet', 'bad', () => {
      answerCall(sim, call, false);
      sim.pendingCalls.splice(sim.pendingCalls.indexOf(call), 1);
      refreshInbox(); refreshDiplo(); refreshTop();
    }, `İttifak bozulur — ${BETRAY_LOCK} saniye saldırı yasağı`));
    box.appendChild(acts);
    el.appendChild(box);
  }

  // barış teklifleri
  for (const id of sim.playerOffers.peace) {
    const n = sim.nations[id];
    if (!n.alive || !atWar(me, n)) { sim.playerOffers.peace.delete(id); continue; }
    any = true;
    const box = document.createElement('div');
    box.className = 'msg';
    box.innerHTML = `<div><b>${n.name}</b> barış istiyor.</div>`;
    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.appendChild(mkBtn('Kabul', 'good', () => {
      makePeace(sim, me, n); sim.playerOffers.peace.delete(id);
      refreshInbox(); refreshDiplo();
    }));
    acts.appendChild(mkBtn('Reddet', 'bad', () => {
      sim.playerOffers.peace.delete(id); refreshInbox();
    }));
    box.appendChild(acts);
    el.appendChild(box);
  }

  // ittifak teklifleri
  for (const id of sim.playerOffers.ally) {
    const n = sim.nations[id];
    if (!n.alive || allied(me, n) || atWar(me, n)) { sim.playerOffers.ally.delete(id); continue; }
    any = true;
    const box = document.createElement('div');
    box.className = 'msg';
    box.innerHTML = `<div><b>${n.name}</b> ittifak teklif ediyor.</div>`;
    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.appendChild(mkBtn('Kabul', 'good', () => {
      formAlliance(sim, me, n); sim.playerOffers.ally.delete(id);
      refreshInbox(); refreshDiplo();
    }));
    acts.appendChild(mkBtn('Reddet', 'bad', () => {
      sim.playerOffers.ally.delete(id); refreshInbox();
    }));
    box.appendChild(acts);
    el.appendChild(box);
  }

  $('sec-inbox').classList.toggle('hidden', !any);
}

function refreshLog() {
  if (sim.events.length === ui.lastLogLen) return;
  ui.lastLogLen = sim.events.length;
  const last = sim.events.slice(isNarrow() ? -4 : -7);
  $('log').innerHTML = last
    .map((e, i) => `<div class="ev ${e.tip} ${i < last.length - 3 ? 'old' : ''}">${e.metin}</div>`)
    .join('');
}

// hız
function setSpeed(v, btn) {
  ui.speed = v;
  document.querySelectorAll('.spd').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
$('btn-pause').onclick = e => setSpeed(0, e.currentTarget);
$('btn-play').onclick = e => setSpeed(1, e.currentTarget);
$('btn-fast').onclick = e => setSpeed(3, e.currentTarget);
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); (ui.speed ? $('btn-pause') : $('btn-play')).click(); }
});

// ------------------------------------------------------------------ başlangıç

function buildStart() {
  const list = $('nation-list');
  NATION_DEFS.forEach(([name, color], i) => {
    const b = document.createElement('button');
    b.className = 'nation-btn';
    b.innerHTML = `<span class="sw" style="background:${color}"></span>${name}`;
    b.onclick = () => start(i);
    list.appendChild(b);
  });
  $('btn-random').onclick = () => start((Math.random() * NATION_DEFS.length) | 0);
}

function start(id) {
  sim.playerId = id;
  sim.nations[id].ai = false;
  $('start-screen').classList.add('hidden');
  ui.started = true;
  log(sim, `👑 ${sim.nations[id].name} tahtına oturdun`, 'info');
  fitStage();
  focusCapital();
  refreshTop(); refreshDiplo(); refreshInbox();
  if (isNarrow())
    flashHint('Kendi toprağından sürükle · boş yerden kaydır · iki parmakla yakınlaştır');
}

// dar ekranda yan panel alttan açılan çekmeceye dönüşür
const drawer = $('drawer');
drawer.onclick = () => {
  const open = $('panel').classList.toggle('open');
  drawer.setAttribute('aria-expanded', open ? 'true' : 'false');
};

function refreshDrawer() {
  const n = sim.pendingCalls.filter(c => c.target === sim.playerId).length
    + sim.playerOffers.peace.size + sim.playerOffers.ally.size;
  $('drawer-label').innerHTML = n
    ? `Krallıklar ve Divan <span class="badge">${n}</span>`
    : 'Krallıklar ve Divan';
}

function showEnd() {
  const el = $('end-screen');
  if (!el.classList.contains('hidden')) return;
  el.classList.remove('hidden');
  const me = sim.nations[sim.playerId];
  $('end-title').textContent = sim.won ? '👑 Zafer' : '💀 Yenilgi';
  $('end-desc').textContent = sim.won
    ? `${me.name} kıtanın %${Math.round(WIN_FRAC * 100)}'inden fazlasına hükmediyor. Çağ senin adınla anılacak.`
    : `${me.name} haritadan silindi. Taht boş kalmaz — bir hanedan düşer, bir başkası yükselir.`;
}

// ------------------------------------------------------------------ döngü

let last = performance.now();
let uiTimer = 0, diploTimer = 0;

function frame(now) {
  const realDt = Math.min(0.08, (now - last) / 1000);
  last = now;
  ui.now = now;

  if (ui.started && !sim.over) {
    step(sim, realDt * ui.speed, realDt);
    uiTimer += realDt;
    diploTimer += realDt;
    if (uiTimer > 0.2) {
      uiTimer = 0;
      refreshTop(); refreshLog(); refreshInbox(); refreshRegion(); refreshDrawer();
    }
    if (diploTimer > 1.0) { diploTimer = 0; refreshDiplo(); }
  }
  if (sim.over) showEnd();

  // harita yalnız sahiplik değiştiğinde yeniden boyanır
  if (sim.dirty || !frame.painted) { sim.dirty = false; frame.painted = true; renderer.renderMap(); }
  renderer.renderFx(ui);

  requestAnimationFrame(frame);
}

// hata ayıklama / otomatik test tutamağı
window.__rb = {
  sim, ui, view, W, H, S, focusCapital, fitStage,
  api: { launchArmy, declareWar, makePeace, formAlliance, breakAlliance, answerCall, power },
};

buildStart();
fitStage();
renderer.renderMap();
requestAnimationFrame(frame);
