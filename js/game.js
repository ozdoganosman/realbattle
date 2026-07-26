// İstemci: girdi, arayüz, ana döngü, hissiyat.
// Oyun kuralları burada DEĞİL — hepsi sim.js içinde.

import { W, H, S, idx, clamp } from './world.js';
import {
  createSim, step, NATION_DEFS, WIN_FRAC, BETRAY_LOCK,
  troopCap, power, landFrac, allied, locked, density,
  softCap, hardCap, interestRate, maxDebt, maxCommit, inDebt,
  TICKS_PER_INCOME, tickProgress, tickIndex, ticksToIncome, secsToIncome,
  INCOME_SCALE, incomePayout,
  startAttack, cancelAttack, canAttack, attackCost,
  formAlliance, breakAlliance, log,
} from './sim.js';
import { createRenderer } from './render.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);
const fmt = v => Math.round(v).toLocaleString('tr-TR');

const seed = (Math.random() * 2 ** 31) | 0;
const sim = createSim(seed);

const mapCanvas = $('map'), fxCanvas = $('fx');
const renderer = createRenderer(sim, mapCanvas, fxCanvas);

const ui = {
  speed: 1, started: false,
  pct: 0.5,
  hoverCell: -1, hoverOwner: undefined,
  now: 0,
  shake: 0,
  streak: 0, lastCells: 0,
  shownTroops: 0, shownLand: 0,     // yumuşak akan sayaçlar
  lastLogLen: 0,
};

// ------------------------------------------------------------------ görünüm

const stage = $('stage');
const wrap = $('map-wrap');
const view = { scale: 1, tx: 0, ty: 0 };

const isNarrow = () => window.innerWidth <= 860;

function wrapBox() {
  const r = wrap.getBoundingClientRect();
  const cs = getComputedStyle(wrap);
  const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
  const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
  return { left: r.left + pl, top: r.top + pt, width: r.width - pl - pr, height: r.height - pt - pb };
}

// Sahnenin dönüşümsüz konumu — uygulanmış dönüşümden geri hesaplanamaz,
// çünkü clampView, DOM'a yazılmadan önce çalışır.
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

function clampView() {
  const bw = stage.offsetWidth * view.scale, bh = stage.offsetHeight * view.scale;
  const wr = wrapBox();
  const fit = (b, size, ws, wsize, t) => {
    if (size <= wsize) return ws + (wsize - size) / 2 - b;
    return clamp(t, ws + wsize - size - b, ws - b);
  };
  view.tx = fit(base.left, bw, wr.left, wr.width, view.tx);
  view.ty = fit(base.top, bh, wr.top, wr.height, view.ty);
}

function applyView() {
  clampView();
  // sarsıntı görünümün üstüne biner
  const sx = ui.shake ? (Math.random() - 0.5) * ui.shake : 0;
  const sy = ui.shake ? (Math.random() - 0.5) * ui.shake : 0;
  stage.style.transform =
    `translate(${view.tx + sx}px, ${view.ty + sy}px) scale(${view.scale})`;
}

function contentPoint(sx, sy) {
  return {
    u: (sx - base.left - view.tx) / (stage.offsetWidth * view.scale),
    v: (sy - base.top - view.ty) / (stage.offsetHeight * view.scale),
  };
}

function anchorAt(u, v, sx, sy, ns) {
  view.scale = ns;
  view.tx = sx - base.left - u * stage.offsetWidth * ns;
  view.ty = sy - base.top - v * stage.offsetHeight * ns;
  applyView();
}

function zoomBy(f) {
  const wr = wrapBox();
  const cx = wr.left + wr.width / 2, cy = wr.top + wr.height / 2;
  const p = contentPoint(cx, cy);
  anchorAt(p.u, p.v, cx, cy, clamp(view.scale * f, 1, 9));
}

function focusHome() {
  const me = sim.nations[sim.playerId];
  if (!me) return;
  const wr = wrapBox();
  anchorAt(me.cx / W, me.cy / H, wr.left + wr.width / 2, wr.top + wr.height / 2,
    isNarrow() ? 3.2 : 1.6);
}

window.addEventListener('resize', fitStage);
$('zoom-in').onclick = () => { sfx.ui(); zoomBy(1.45); };
$('zoom-out').onclick = () => { sfx.ui(); zoomBy(1 / 1.45); };
$('zoom-fit').onclick = () => { sfx.ui(); view.scale = 1; applyView(); };

mapCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const p = contentPoint(e.clientX, e.clientY);
  anchorAt(p.u, p.v, e.clientX, e.clientY,
    clamp(view.scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 1, 9));
}, { passive: false });

function cellFromPoint(sx, sy) {
  const r = mapCanvas.getBoundingClientRect();
  const x = clamp(((sx - r.left) / r.width * W) | 0, 0, W - 1);
  const y = clamp(((sy - r.top) / r.height * H) | 0, 0, H - 1);
  return idx(x, y);
}

// ------------------------------------------------------------------ girdi

// Tek parmak/fare: kendi toprağın dışına dokunmak saldırıdır.
// Kaydırma için parmağı sürüklemen yeterli — dokunup çekmek haritayı gezdirir.
const ptrs = new Map();
let pan = null, pinch = null, pressed = null;
const TAP_SLOP = 9;      // bu kadar pikselden az hareket = dokunma, fazlası = kaydırma

mapCanvas.addEventListener('pointerdown', e => {
  if (!ui.started || sim.over) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  sfx.init(); sfx.resume();
  mapCanvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (ptrs.size === 2) {
    pressed = null; pan = null;
    const [a, b] = [...ptrs.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: view.scale, ...contentPoint(mx, my) };
    return;
  }
  if (ptrs.size > 2) return;
  pressed = { sx: e.clientX, sy: e.clientY, moved: 0 };
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
  if (pressed) {
    pressed.moved = Math.max(pressed.moved,
      Math.hypot(e.clientX - pressed.sx, e.clientY - pressed.sy));
  }
  if (pan && pressed && pressed.moved > TAP_SLOP) {
    view.tx = pan.tx + (e.clientX - pan.sx);
    view.ty = pan.ty + (e.clientY - pan.sy);
    applyView();
    return;
  }
  // fareyle gezinirken hedefi vurgula
  if (e.pointerType === 'mouse' && !pan) updateHover(e.clientX, e.clientY);
});

function endPointer(e) {
  ptrs.delete(e.pointerId);
  if (pinch) { if (ptrs.size < 2) pinch = null; return; }
  const p = pressed; pressed = null; pan = null;
  if (!p || p.moved > TAP_SLOP) return;      // kaydırmaydı, dokunma değil
  tapAttack(e.clientX, e.clientY);
}
mapCanvas.addEventListener('pointerup', endPointer);
mapCanvas.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); pressed = null; pan = null; });

mapCanvas.addEventListener('pointerleave', () => {
  ui.hoverCell = -1; ui.hoverOwner = undefined; hideChip();
});

function updateHover(sx, sy) {
  const c = cellFromPoint(sx, sy);
  const o = sim.world.isLand[c] ? sim.owner[c] : undefined;
  if (c === ui.hoverCell && o === ui.hoverOwner) return;
  ui.hoverCell = c;
  ui.hoverOwner = o;
  sim.dirty = true;                          // vurgulama taban katmanında
  showChip(sx, sy, o);
}

function showChip(sx, sy, o) {
  const chip = $('target-chip');
  const me = sim.nations[sim.playerId];
  if (o === undefined || o === me.id) { hideChip(); return; }
  const cost = attackCost(sim, o);
  const troops = me.pool * ui.pct;
  const cells = Math.floor(troops / cost);
  const ad = o < 0 ? 'Boş toprak' : sim.nations[o].name;
  let uyari = '';
  if (o >= 0 && allied(me, sim.nations[o])) uyari = '<i>müttefikin</i>';
  else if (locked(sim, me)) uyari = '<i>ihanet cezan sürüyor</i>';
  chip.innerHTML = `<b>${ad}</b>` +
    (uyari ? ` — ${uyari}` : ` · ${fmt(cells)} birim toprak alabilirsin`);
  chip.classList.remove('hidden');
  const r = wrap.getBoundingClientRect();
  chip.style.left = clamp(sx - r.left, 70, r.width - 70) + 'px';
  chip.style.top = clamp(sy - r.top - 42, 6, r.height - 30) + 'px';
}
function hideChip() { $('target-chip').classList.add('hidden'); }

function tapAttack(sx, sy) {
  const me = sim.nations[sim.playerId];
  const c = cellFromPoint(sx, sy);
  if (!sim.world.isLand[c]) return;
  const target = sim.owner[c];
  const x = c % W, y = (c / W) | 0;

  if (target === me.id) {
    renderer.ripple(x, y, 'rgba(255,250,225,0.9)');
    sfx.ui();
    return;
  }
  if (locked(sim, me)) {
    flash(`İhanet cezası — ${Math.ceil(me.lockUntil - sim.realT)} sn saldıramazsın`);
    renderer.ripple(x, y, 'rgba(235,90,70,0.95)');
    sfx.betray();
    return;
  }
  if (target >= 0 && allied(me, sim.nations[target])) {
    flash(`${sim.nations[target].name} müttefikin — önce ittifakı bozmalısın`);
    renderer.ripple(x, y, 'rgba(235,190,90,0.95)');
    sfx.ui();
    return;
  }
  if (inDebt(me)) {
    flash(`Borçlusun — ${fmt(-me.pool)} asker açığı kapanmadan sefere çıkamazsın`);
    renderer.ripple(x, y, 'rgba(235,90,70,0.95)');
    return;
  }
  const atk = startAttack(sim, me, target, commitOf(me));
  if (!atk) {
    flash(sim.attacks.some(a => a.from === me.id && a.target === target)
      ? 'Bu cephe zaten açık' : 'Yeterli asker yok ya da sınırın değmiyor');
    renderer.ripple(x, y, 'rgba(200,200,200,0.6)');
    return;
  }
  renderer.ripple(x, y, me.color);
  sfx.attack();
  ui.shake = Math.max(ui.shake, 5);
  refreshTop(); refreshFronts();
}

function flash(text) {
  const el = $('hint-bar');
  el.textContent = text;
  el.classList.add('warn');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => {
    el.classList.remove('warn');
    el.innerHTML = 'Saldırmak için düşman ya da boş toprağa <b>dokun</b>.';
  }, 2400);
}

// ------------------------------------------------------------------ arayüz

$('pct').addEventListener('input', e => {
  ui.pct = +e.target.value / 100;
  refreshPct();
});
$('pct').addEventListener('change', () => sfx.ui());

// Kaydıraç, elindeki askerin değil GÖNDEREBİLECEĞİN TOPLAM GÜCÜN yüzdesi:
// garnizon + borçlanabileceğin. Elindekinin yüzdesi olsaydı asker bitince
// borçlanma kapasiten de sıfırlanırdı — oysa borç tavanı toprağa bağlı ve
// hazine boşken saldırabilmek borcun bütün amacı.
function commitOf(me) {
  return maxCommit(sim, me) * ui.pct;
}

function refreshPct() {
  if (sim.playerId < 0) return;
  const me = sim.nations[sim.playerId];
  const troops = commitOf(me);
  const elde = Math.max(0, me.pool);
  const borc = Math.max(0, troops - elde);
  $('pct-label').innerHTML =
    `<b>${fmt(troops)}</b> asker` +
    (borc > 0 ? ` <span class="debt">· ${fmt(borc)} borç</span>` : '');
  // Kaydıracın hangi noktadan sonra borca girdiğini şeridin üstünde göster;
  // eşik hazinen değiştikçe kayar.
  const esik = clamp(elde / Math.max(1, maxCommit(sim, me)) * 100, 0, 100);
  const p = $('pct');
  p.style.setProperty('--borrow-at', esik + '%');
  p.classList.toggle('borrowing', borc > 0);
}

function refreshTop() {
  if (sim.playerId < 0) return;
  const me = sim.nations[sim.playerId];
  $('tb-nation').textContent = me.name;
  $('tb-nation').style.color = me.color;
  $('tb-troops').textContent = fmt(ui.shownTroops);
  $('tb-cap').textContent = fmt(troopCap(sim, me));
  $('tb-land').textContent = (ui.shownLand * 100).toFixed(1) + '%';
  const lockEl = $('tb-lock');
  if (locked(sim, me)) {
    lockEl.classList.remove('hidden');
    lockEl.textContent = `⛔ ${Math.ceil(me.lockUntil - sim.realT)}sn`;
  } else lockEl.classList.add('hidden');
  refreshTreasury(me);
  refreshPct();
}

// Faiz bileşik çalışıyor ama görünmezse tekdüze hissediliyor — oranı,
// geliri ve tavana ne kadar kaldığını açıkça göster.
function refreshTreasury(me) {
  const soft = softCap(sim, me), hard = hardCap(sim, me);
  const borclu = inDebt(me);
  const fill = $('cap-fill');
  if (borclu) {
    fill.style.width = clamp(-me.pool / maxDebt(sim, me) * 100, 0, 100) + '%';
    fill.style.background = 'var(--bad)';
    $('econ-int').textContent = 'borç büyüyor';
    $('econ-int').className = 'stalled';
  } else {
    const r = interestRate(sim, me);
    fill.style.width = clamp(ui.shownTroops / hard * 100, 0, 100) + '%';
    fill.style.background = me.color;
    $('econ-int').textContent = r > 0 ? `%${(r * 100).toFixed(2)} / tik` : 'durdu (tavan)';
    $('econ-int').className = r > 0 ? '' : 'stalled';
  }
  $('cap-soft').style.left = (soft / hard * 100) + '%';
  $('cap-soft').style.display = borclu ? 'none' : '';
  const pay = incomePayout(sim, me);
  $('econ-inc').textContent = `+${fmt(pay.land)}` + (borclu ? ' → borca' : '');
  $('econ-balloon').textContent = borclu ? '—' : `+${fmt(pay.balloon)}`;
  $('econ-soft').textContent = borclu
    ? `borç ${fmt(-me.pool)} / ${fmt(maxDebt(sim, me))}`
    : fmt(soft);
  $('tb-troops').classList.toggle('debt', borclu);
}

// Faiz/gelir döngüsü göstergesi: 10 hane, her faiz tikinde biri dolar,
// onuncusu dolunca arazi geliri yatar. İki yerde gösteriliyor — panelde
// ve dar ekranda çekmece kapalıyken özet şeritte.
const pipSets = new Map();
function paintPips(boxId) {
  let els = pipSets.get(boxId);
  if (!els) {
    const box = $(boxId);
    els = [];
    for (let i = 0; i < TICKS_PER_INCOME; i++) {
      const p = document.createElement('i');
      p.appendChild(document.createElement('b'));
      box.appendChild(p);
      els.push(p);
    }
    pipSets.set(boxId, els);
  }
  const done = tickIndex(sim), prog = tickProgress(sim);
  for (let i = 0; i < els.length; i++) {
    const p = els[i];
    const dolu = i < done;
    p.classList.toggle('on', dolu);
    p.classList.toggle('now', i === done);
    p.firstChild.style.width = i === done ? (prog * 100) + '%' : dolu ? '100%' : '0%';
  }
}

function refreshCycle(me, borclu) {
  paintPips('pips');
  const kalan = secsToIncome(sim);
  const pay = incomePayout(sim, me);
  $('cycle-note').innerHTML = borclu
    ? `<b>${fmt(pay.land)}</b> ödeme <b>${kalan.toFixed(1)}sn</b> sonra borca yatacak`
    : `<b>+${fmt(pay.total)}</b> <span class="s">(arsa ${fmt(pay.land)} + balon ${fmt(pay.balloon)})</span>` +
      ` <b>${kalan.toFixed(1)}sn</b> sonra`;
  refreshMini(me, borclu, kalan);
}

// Dar ekranda çekmece kapalıyken tek görünen şerit bu — bilgiyi burada
// yoğunlaştır: asker/tavan, faiz, gelir geri sayımı ve süren sefer.
function refreshMini(me, borclu, kalan) {
  const hard = hardCap(sim, me), soft = softCap(sim, me);
  const t = $('mini-troops');
  t.textContent = borclu ? `−${fmt(-me.pool)}` : fmt(ui.shownTroops);
  t.className = borclu ? 'debt' : '';

  const r = interestRate(sim, me);
  const mi = $('mini-int');
  mi.textContent = borclu ? 'borç' : r > 0 ? `%${(r * 100).toFixed(1)}` : 'tavan';
  mi.className = borclu || r <= 0 ? 'stalled' : '';

  const pay = incomePayout(sim, me);
  $('mini-inc').innerHTML =
    `+${fmt(borclu ? pay.land : pay.total)}<span class="s"> ${kalan.toFixed(1)}sn</span>`;

  const fill = $('mini-fill');
  if (borclu) {
    fill.style.width = clamp(-me.pool / maxDebt(sim, me) * 100, 0, 100) + '%';
    fill.style.background = 'var(--bad)';
  } else {
    fill.style.width = clamp(ui.shownTroops / hard * 100, 0, 100) + '%';
    fill.style.background = me.color;
  }
  $('mini-soft').style.left = (soft / hard * 100) + '%';
  $('mini-soft').style.display = borclu ? 'none' : '';

  paintPips('mini-pips');

  const mine = sim.attacks.filter(a => a.from === me.id);
  const mf = $('mini-front');
  mf.classList.toggle('hidden', !mine.length);
  if (mine.length) {
    const a = mine[0];
    const ad = a.target < 0 ? 'boş toprak' : sim.nations[a.target].name;
    mf.innerHTML = `⚔ ${ad} — <b>${fmt(a.troops)}</b> asker cephede` +
      (mine.length > 1 ? ` <span class="s">+${mine.length - 1} cephe</span>` : '');
  }
}

function mkBtn(text, cls, fn, title) {
  const b = document.createElement('button');
  b.className = 'mini ' + cls;
  b.textContent = text;
  if (title) b.title = title;
  b.onclick = ev => { sfx.init(); sfx.resume(); sfx.ui(); fn(ev); };
  return b;
}

function refreshFronts() {
  const me = sim.nations[sim.playerId];
  const mine = sim.attacks.filter(a => a.from === me.id);
  $('sec-fronts').classList.toggle('hidden', !mine.length);
  const el = $('fronts');
  el.innerHTML = '';
  for (const a of mine) {
    const ad = a.target < 0 ? 'Boş toprak' : sim.nations[a.target].name;
    const row = document.createElement('div');
    row.className = 'front';
    const pct = clamp(a.troops / a.start, 0, 1);
    row.innerHTML =
      `<div class="front-top"><span>${ad}</span><b>${fmt(a.troops)}</b></div>` +
      `<div class="bar"><i style="width:${pct * 100}%;background:${me.color}"></i></div>`;
    row.appendChild(mkBtn('Geri çağır', 'bad', () => {
      cancelAttack(sim, a); refreshFronts(); refreshTop();
    }, 'Kalan asker garnizona döner'));
    el.appendChild(row);
  }
}

function refreshOffers() {
  const me = sim.nations[sim.playerId];
  const el = $('offers');
  el.innerHTML = '';
  let any = false;
  for (const id of sim.playerOffers) {
    const n = sim.nations[id];
    if (!n.alive || allied(me, n)) { sim.playerOffers.delete(id); continue; }
    any = true;
    const box = document.createElement('div');
    box.className = 'msg';
    box.innerHTML = `<div><b>${n.name}</b> ittifak teklif ediyor.</div>`;
    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.appendChild(mkBtn('Kabul', 'good', () => {
      formAlliance(sim, me, n); sim.playerOffers.delete(id);
      sfx.ally(); refreshOffers(); refreshDiplo();
    }));
    acts.appendChild(mkBtn('Reddet', 'bad', () => {
      sim.playerOffers.delete(id); refreshOffers();
    }));
    box.appendChild(acts);
    el.appendChild(box);
  }
  $('sec-offers').classList.toggle('hidden', !any);
}

function refreshDiplo() {
  const el = $('diplo');
  const me = sim.nations[sim.playerId];
  const list = sim.nations.filter(n => n.alive).sort((a, b) => b.cells - a.cells);
  el.innerHTML = '';
  for (const n of list) {
    const row = document.createElement('div');
    const self = n === me;
    const ally = !self && allied(me, n);
    row.className = 'nat-row' + (self ? ' self' : ally ? ' ally' : '');
    row.innerHTML =
      `<span class="sw" style="background:${n.color}"></span>` +
      `<span class="nm">${n.name}</span>` +
      `<span class="pc">${(landFrac(sim, n) * 100).toFixed(1)}%</span>` +
      `<span class="st">${self ? 'sen' : ally ? 'ittifak' : 'yoğunluk ' + density(n).toFixed(1)}</span>`;
    if (!self) {
      const acts = document.createElement('div');
      acts.className = 'acts';
      if (ally) {
        acts.appendChild(mkBtn('İttifakı boz', 'bad', () => {
          breakAlliance(sim, me, n);
          sfx.betray(); ui.shake = Math.max(ui.shake, 7);
          refreshDiplo(); refreshTop(); refreshFronts();
        }, `${BETRAY_LOCK} saniye hiçbir yere saldıramazsın`));
      } else {
        acts.appendChild(mkBtn('İttifak teklif et', '', () => {
          const ok = power(sim, me) < power(sim, n) * 2 && landFrac(sim, me) < 0.35;
          if (ok && formAlliance(sim, me, n)) sfx.ally();
          else log(sim, `❌ ${n.name} ittifakı reddetti — fazla güçlüsün`, 'info');
          refreshDiplo();
        }));
      }
      row.appendChild(acts);
    }
    el.appendChild(row);
  }
}

function refreshLog() {
  if (sim.events.length === ui.lastLogLen) return;
  ui.lastLogLen = sim.events.length;
  const last = sim.events.slice(isNarrow() ? -4 : -6);
  $('log').innerHTML = last
    .map((e, i) => `<div class="ev ${e.tip} ${i < last.length - 2 ? 'old' : ''}">${e.metin}</div>`)
    .join('');
}

// sim'in ürettiği anlık olayları ses ve efekte çevir
function drainFx() {
  for (const f of sim.fx) {
    if (f.tip === 'death') {
      renderer.burst(f.x, f.y, sim.nations[f.nat].color);
      sfx.death();
      ui.shake = Math.max(ui.shake, 9);
    } else if (f.tip === 'betray' && f.nat !== sim.playerId) {
      sfx.betray();
    } else if (f.tip === 'tick' && f.income) {
      // arazi geliri yattı — görünür ve duyulur olsun
      sfx.income();
      const box = $('sec-treasury');
      box.classList.remove('paid');
      void box.offsetWidth;                 // animasyonu yeniden tetikle
      box.classList.add('paid');
    }
  }
  sim.fx.length = 0;
}

// hız
function setSpeed(v, btn) {
  ui.speed = v;
  document.querySelectorAll('.spd').forEach(b => {
    if (b.id !== 'btn-sound') b.classList.remove('active');
  });
  btn.classList.add('active');
  sfx.init(); sfx.resume(); sfx.ui();
}
$('btn-pause').onclick = e => setSpeed(0, e.currentTarget);
$('btn-play').onclick = e => setSpeed(1, e.currentTarget);
$('btn-fast').onclick = e => setSpeed(3, e.currentTarget);
$('btn-sound').onclick = e => {
  sfx.init(); sfx.resume();
  sfx.on = !sfx.on;
  e.currentTarget.classList.toggle('off', !sfx.on);
  e.currentTarget.textContent = sfx.on ? '♪' : '♪̸';
  if (sfx.on) sfx.ui();
};
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); (ui.speed ? $('btn-pause') : $('btn-play')).click(); }
});

const drawer = $('drawer');
drawer.onclick = () => {
  sfx.init(); sfx.resume(); sfx.ui();
  const open = $('panel').classList.toggle('open');
  drawer.setAttribute('aria-expanded', open ? 'true' : 'false');
};

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
  sfx.init(); sfx.resume(); sfx.ui();
  sim.playerId = id;
  sim.nations[id].ai = false;
  ui.lastCells = sim.nations[id].cells;
  ui.shownTroops = sim.nations[id].pool;
  ui.shownLand = landFrac(sim, sim.nations[id]);
  $('start-screen').classList.add('hidden');
  ui.started = true;
  log(sim, `👑 ${sim.nations[id].name} tahtına oturdun`, 'info');
  fitStage(); focusHome();
  refreshTop(); refreshDiplo(); refreshOffers(); refreshFronts();
}

function showEnd() {
  const el = $('end-screen');
  if (!el.classList.contains('hidden')) return;
  el.classList.remove('hidden');
  const me = sim.nations[sim.playerId];
  $('end-title').textContent = sim.won ? '👑 Zafer' : '💀 Yenilgi';
  $('end-desc').textContent = sim.won
    ? `${me.name} kıtanın %${Math.round(WIN_FRAC * 100)}'ından fazlasına hükmediyor.`
    : `${me.name} haritadan silindi.`;
  sim.won ? sfx.win() : sfx.lose();
}

// ------------------------------------------------------------------ döngü

let last = performance.now();
let uiTimer = 0, diploTimer = 0;

function frame(now) {
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  ui.now = now;

  if (ui.started && !sim.over) {
    step(sim, realDt * ui.speed, realDt);
    drainFx();

    const me = sim.nations[sim.playerId];
    // toprak kazandıkça yükselen tık sesi
    if (me.cells > ui.lastCells) {
      ui.streak += me.cells - ui.lastCells;
      sfx.capture(ui.streak, now);
    } else if (ui.streak) ui.streak = Math.max(0, ui.streak - 1);
    ui.lastCells = me.cells;

    // sayaçlar sıçramaz, akar
    const k = 1 - Math.pow(0.001, realDt);
    ui.shownTroops += (me.pool - ui.shownTroops) * k;
    ui.shownLand += (landFrac(sim, me) - ui.shownLand) * k;

    // döngü göstergesi her karede — 0.08sn'lik arayüz turunda takılı görünürdü
    refreshCycle(me, inDebt(me));

    uiTimer += realDt; diploTimer += realDt;
    if (uiTimer > 0.08) { uiTimer = 0; refreshTop(); refreshLog(); }
    if (diploTimer > 0.5) {
      diploTimer = 0;
      refreshDiplo(); refreshOffers(); refreshFronts();
    }
  }
  if (sim.over) showEnd();

  if (ui.shake > 0.05) { ui.shake *= Math.pow(0.02, realDt); applyView(); }
  else if (ui.shake) { ui.shake = 0; applyView(); }

  // saldırı sürerken harita her karede yeniden boyanır (parlama animasyonu)
  if (sim.dirty || sim.attacks.length) { sim.dirty = false; renderer.renderMap(ui.hoverOwner); }
  renderer.renderFx(ui, realDt);

  requestAnimationFrame(frame);
}

window.__rb = {
  sim, ui, view, W, H, S, focusHome, fitStage, sfx,
  api: {
    startAttack, cancelAttack, canAttack, attackCost, formAlliance, breakAlliance,
    power, maxDebt, maxCommit, inDebt, softCap, hardCap, interestRate,
    tickProgress, tickIndex, ticksToIncome, secsToIncome,
  },
};

buildStart();
fitStage();
renderer.renderMap();
requestAnimationFrame(frame);
