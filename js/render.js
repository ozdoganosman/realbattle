// Çizim katmanı. Simülasyonu sadece OKUR, asla değiştirmez.

import { W, H, S, idx, clamp, PLAINS, FOREST, MOUNT } from './world.js';

const SEA = [58, 140, 128];
const SEA_DEEP = [42, 112, 103];
const NEUTRAL = [206, 190, 154];

// arazi başına parlaklık çarpanı
const TF = [1.0, 0.84, 0.66];

function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createRenderer(sim, mapCanvas, fxCanvas) {
  mapCanvas.width = W * S; mapCanvas.height = H * S;
  fxCanvas.width = W * S; fxCanvas.height = H * S;
  const mctx = mapCanvas.getContext('2d');
  const fctx = fxCanvas.getContext('2d');
  mctx.imageSmoothingEnabled = false;

  // düşük çözünürlüklü renk tamponu → ölçekleyerek çiz (hızlı)
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  const img = octx.createImageData(W, H);
  const px = img.data;

  // ulus × arazi renk tablosu
  const palette = sim.nations.map(n => {
    const [r, g, b] = hexRGB(n.color);
    return TF.map(f => [(r * f) | 0, (g * f) | 0, (b * f) | 0]);
  });
  const neutralPal = TF.map(f => [
    (NEUTRAL[0] * f) | 0, (NEUTRAL[1] * f * 0.98) | 0, (NEUTRAL[2] * f * 0.9) | 0]);

  function paintBase() {
    const { isLand, terrain } = sim.world;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      let c;
      if (!isLand[i]) {
        // kıyıya yakın su daha açık
        const x = i % W, y = (i / W) | 0;
        let near = false;
        if (x > 0 && isLand[i - 1]) near = true;
        else if (x < W - 1 && isLand[i + 1]) near = true;
        else if (y > 0 && isLand[i - W]) near = true;
        else if (y < H - 1 && isLand[i + W]) near = true;
        c = near ? SEA : SEA_DEEP;
      } else {
        const o = sim.owner[i];
        c = (o >= 0 ? palette[o] : neutralPal)[terrain[i]];
      }
      px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
  }

  function paintBorders() {
    const { isLand } = sim.world;
    mctx.fillStyle = 'rgba(24,14,6,0.78)';
    const t = Math.max(1, (S / 3) | 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (!isLand[i]) continue;
      const o = sim.owner[i];
      if (x < W - 1) {
        const n = i + 1;
        if (isLand[n] && sim.owner[n] !== o) mctx.fillRect((x + 1) * S - t / 2, y * S, t, S);
      }
      if (y < H - 1) {
        const n = i + W;
        if (isLand[n] && sim.owner[n] !== o) mctx.fillRect(x * S, (y + 1) * S - t / 2, S, t);
      }
    }
  }

  function paintCities() {
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    for (const city of sim.world.cities) {
      if (city.size < 1.1 && !city.castle) continue;
      const x = city.x * S + S / 2, y = city.y * S + S / 2;
      const r = clamp(2 + city.size * 1.4, 2.5, 6);
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fillStyle = city.owner >= 0 ? 'rgba(255,248,225,0.92)' : 'rgba(120,100,70,0.75)';
      mctx.fill();
      mctx.lineWidth = 1;
      mctx.strokeStyle = 'rgba(30,18,8,0.85)';
      mctx.stroke();
      if (city.castle > 0) {
        // kale: küçük mazgallı kule silueti
        mctx.fillStyle = 'rgba(38,24,10,0.9)';
        const w = 3 + city.castle;
        mctx.fillRect(x - w / 2, y - r - 4 - city.castle, w, 3 + city.castle);
      }
      if (city.size > 1.9) {
        mctx.font = `${clamp(6 + city.size, 7, 11)}px Georgia, serif`;
        mctx.fillStyle = 'rgba(28,18,8,0.72)';
        mctx.fillText(city.name, x, y + r + 7);
      }
    }
  }

  function paintLabels() {
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    for (const nat of sim.nations) {
      if (!nat.alive || nat.cells < 30) continue;
      const size = clamp(Math.sqrt(nat.cells) * 0.55, 11, 30);
      mctx.font = `bold ${size}px Georgia, serif`;
      mctx.lineWidth = 3;
      mctx.strokeStyle = 'rgba(245,235,205,0.55)';
      mctx.strokeText(nat.name, nat.cx * S, nat.cy * S);
      mctx.fillStyle = 'rgba(28,16,6,0.82)';
      mctx.fillText(nat.name, nat.cx * S, nat.cy * S);
    }
  }

  function renderMap() {
    paintBase();
    mctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    mctx.drawImage(off, 0, 0, mapCanvas.width, mapCanvas.height);
    paintBorders();
    paintCities();
    paintLabels();
  }

  // ---------------------------------------------------------- efekt katmanı

  function armyShape(ctx, a, nat, now) {
    const x = a.x * S, y = a.y * S;
    const size = clamp(6 + Math.sqrt(a.troops) * 0.55, 7, 20);

    ctx.save();
    ctx.translate(x, y);

    // gölge
    ctx.beginPath();
    ctx.ellipse(1.5, size * 0.55, size * 0.75, size * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fill();

    // yön oku
    const ang = Math.atan2(a.dy, a.dx);
    ctx.save();
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(size * 0.85, 0);
    ctx.lineTo(size * 0.3, -size * 0.42);
    ctx.lineTo(size * 0.3, size * 0.42);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,250,230,0.9)';
    ctx.fill();
    ctx.restore();

    // kalkan gövdesi
    ctx.beginPath();
    ctx.moveTo(-size * 0.55, -size * 0.62);
    ctx.lineTo(size * 0.55, -size * 0.62);
    ctx.lineTo(size * 0.55, size * 0.12);
    ctx.quadraticCurveTo(size * 0.55, size * 0.78, 0, size * 0.95);
    ctx.quadraticCurveTo(-size * 0.55, size * 0.78, -size * 0.55, size * 0.12);
    ctx.closePath();
    ctx.fillStyle = nat.color;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = a.clashing > 0
      ? `rgba(255,${60 + 120 * Math.abs(Math.sin(now / 90))},40,0.95)`
      : 'rgba(26,16,6,0.9)';
    ctx.stroke();

    // güç çubuğu (başlangıca göre kalan)
    const frac = clamp(a.troops / a.start, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(-size * 0.55, -size * 1.05, size * 1.1, 3);
    ctx.fillStyle = frac > 0.5 ? '#7ed07e' : frac > 0.25 ? '#e8c14a' : '#e05b4a';
    ctx.fillRect(-size * 0.55, -size * 1.05, size * 1.1 * frac, 3);

    ctx.font = `bold ${clamp(size * 0.62, 8, 12)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(Math.round(a.troops), 0, size * 0.1);
    ctx.fillStyle = '#fff8e6';
    ctx.fillText(Math.round(a.troops), 0, size * 0.1);

    ctx.restore();
  }

  function renderFx(state) {
    const now = state.now;
    fctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

    // çarpışma parıltıları
    for (const a of sim.armies) {
      if (!(a.clashing > 0)) continue;
      const p = 0.5 + 0.5 * Math.sin(now / 70);
      fctx.beginPath();
      fctx.arc(a.x * S, a.y * S, 14 + p * 8, 0, Math.PI * 2);
      fctx.strokeStyle = `rgba(230,60,40,${0.25 + p * 0.4})`;
      fctx.lineWidth = 2.5;
      fctx.stroke();
    }

    for (const a of sim.armies) armyShape(fctx, a, sim.nations[a.nat], now);

    // sürükleme önizlemesi
    const d = state.drag;
    if (d && d.active) {
      const x0 = d.x0 * S, y0 = d.y0 * S, x1 = d.x1 * S, y1 = d.y1 * S;
      const nat = sim.nations[sim.playerId];
      fctx.save();
      fctx.setLineDash([9, 6]);
      fctx.lineWidth = clamp(3 + Math.sqrt(d.troops) * 0.16, 3, 11);
      fctx.strokeStyle = d.blocked ? 'rgba(210,60,50,0.85)' : nat.color;
      fctx.beginPath();
      fctx.moveTo(x0, y0); fctx.lineTo(x1, y1);
      fctx.stroke();
      fctx.setLineDash([]);

      const ang = Math.atan2(y1 - y0, x1 - x0);
      fctx.translate(x1, y1); fctx.rotate(ang);
      fctx.beginPath();
      fctx.moveTo(16, 0); fctx.lineTo(-6, -11); fctx.lineTo(-6, 11);
      fctx.closePath();
      fctx.fillStyle = d.blocked ? 'rgba(210,60,50,0.9)' : nat.color;
      fctx.fill();
      fctx.lineWidth = 1.5;
      fctx.strokeStyle = 'rgba(20,12,4,0.85)';
      fctx.stroke();
      fctx.restore();

      // çıkış noktası halkası
      fctx.beginPath();
      fctx.arc(x0, y0, 7, 0, Math.PI * 2);
      fctx.strokeStyle = 'rgba(255,245,215,0.9)';
      fctx.lineWidth = 2;
      fctx.stroke();

      // etiket: gönderilecek asker + savaş uyarısı
      const label = `${Math.round(d.troops)} asker`;
      fctx.font = 'bold 15px Georgia, serif';
      fctx.textAlign = 'center';
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - 16;
      fctx.lineWidth = 3.5;
      fctx.strokeStyle = 'rgba(0,0,0,0.6)';
      fctx.strokeText(label, mx, my);
      fctx.fillStyle = '#fff8e6';
      fctx.fillText(label, mx, my);
      if (d.warn) {
        fctx.font = 'bold 13px Georgia, serif';
        fctx.strokeText(d.warn, mx, my + 17);
        fctx.fillStyle = '#ffd28a';
        fctx.fillText(d.warn, mx, my + 17);
      }
    }
  }

  return { renderMap, renderFx };
}
