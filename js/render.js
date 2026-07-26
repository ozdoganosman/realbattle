// Çizim katmanı. Simülasyonu sadece OKUR.
// Hissiyatın büyük kısmı burada: ele geçen hücrenin beyaz parlaması,
// hedefin üstüne gelince bütün toprağının aydınlanması, dalgalar, parçacıklar.

import { W, H, S, idx, clamp, TERRAIN_SHADE } from './world.js';

const SEA = [66, 158, 142];
const SEA_SHALLOW = [84, 186, 167];
const NEUTRAL = [216, 201, 163];      // sıcak parşömen — gri değil

const FLASH = 0.55;          // ele geçirme parlamasının süresi (oyun sn)

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

  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  const img = octx.createImageData(W, H);
  const px = img.data;

  const pal = sim.nations.map(n => hexRGB(n.color));
  const ripples = [];
  const bursts = [];

  function ripple(x, y, color) { ripples.push({ x, y, color, age: 0 }); }
  function burst(x, y, color) {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const sp = 26 + (i % 5) * 12;
      bursts.push({ x: x * S, y: y * S, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, color });
    }
  }

  // ---------------------------------------------------------------- taban

  function paintBase(hover) {
    const { isLand, shade, terrain } = sim.world;
    const t = sim.t;
    for (let y = 0, i = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, i++, p += 4) {
      let r, g, b;
      if (!isLand[i]) {
        const near = (x > 0 && isLand[i - 1]) || (x < W - 1 && isLand[i + 1])
          || (y > 0 && isLand[i - W]) || (y < H - 1 && isLand[i + W]);
        const c = near ? SEA_SHALLOW : SEA;
        r = c[0]; g = c[1]; b = c[2];
      } else {
        const o = sim.owner[i];
        const c = o >= 0 ? pal[o] : NEUTRAL;
        // Renk okunaklı kalsın diye gölge hafif; üstüne ince bir tane dokusu.
        // x ve y ayrı karıştırılmalı — düz i üzerinden hash çapraz şerit yapar.
        let h = (x * 73856093) ^ (y * 19349663);
        h = (h ^ (h >>> 13)) >>> 0;
        const grain = (h & 11) - 5.5;
        // arazi tipi ve yükseklik yalnız renk tonunu değiştirir, oynanışı değil
        const f = TERRAIN_SHADE[terrain[i]] * (0.96 + shade[i] * 0.08);
        r = c[0] * f + grain; g = c[1] * f + grain; b = c[2] * f + grain;

        // hedefin üstündeyken bütün toprağı aydınlansın
        if (hover !== undefined && o === hover) { r += 46; g += 46; b += 46; }

        // yeni ele geçen hücre beyaz parlar, sonra rengine oturur
        const age = t - sim.lastCapture[i];
        if (age >= 0 && age < FLASH) {
          const k = 1 - age / FLASH;
          const w = k * k * 235;
          r += (255 - r) * (w / 255);
          g += (255 - g) * (w / 255);
          b += (255 - b) * (w / 255);
        }
      }
      px[p] = r > 255 ? 255 : r < 0 ? 0 : r;
      px[p + 1] = g > 255 ? 255 : g < 0 ? 0 : g;
      px[p + 2] = b > 255 ? 255 : b < 0 ? 0 : b;
      px[p + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
  }

  function paintBorders() {
    const { isLand } = sim.world;
    mctx.fillStyle = 'rgba(18,12,6,0.72)';
    const t = Math.max(1, (S / 3) | 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (!isLand[i]) continue;
      const o = sim.owner[i];
      if (x < W - 1 && isLand[i + 1] && sim.owner[i + 1] !== o)
        mctx.fillRect((x + 1) * S - t / 2, y * S, t, S);
      if (y < H - 1 && isLand[i + W] && sim.owner[i + W] !== o)
        mctx.fillRect(x * S, (y + 1) * S - t / 2, S, t);
    }
  }

  // Dekoratif yerleşimler — hiçbir oyun etkisi yok, harita dolu dursun diye.
  function paintCities() {
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    for (const c of sim.world.cities) {
      const x = c.x * S + S / 2, y = c.y * S + S / 2;
      const r = clamp(1.8 + c.size * 1.5, 2, 6);
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fillStyle = 'rgba(244,232,204,0.9)';
      mctx.fill();
      mctx.lineWidth = 1;
      mctx.strokeStyle = 'rgba(34,22,10,0.72)';
      mctx.stroke();

      const fs = clamp(5.5 + c.size * 1.5, 6, 10);
      mctx.font = `${fs}px Georgia, serif`;
      mctx.fillStyle = 'rgba(30,20,8,0.66)';
      mctx.fillText(c.name, x, y + r + fs * 0.75);
    }
  }

  function paintLabels() {
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    for (const nat of sim.nations) {
      if (!nat.alive || nat.cells < 45) continue;
      const size = clamp(Math.sqrt(nat.cells) * 0.5, 11, 30);
      mctx.font = `bold ${size}px Georgia, serif`;
      mctx.lineWidth = 3.5;
      mctx.strokeStyle = 'rgba(250,244,225,0.5)';
      mctx.strokeText(nat.name, nat.cx * S, nat.cy * S);
      mctx.fillStyle = 'rgba(24,14,4,0.85)';
      mctx.fillText(nat.name, nat.cx * S, nat.cy * S);
    }
  }

  function renderMap(hover) {
    paintBase(hover);
    mctx.drawImage(off, 0, 0, mapCanvas.width, mapCanvas.height);
    paintBorders();
    paintCities();
    paintLabels();
  }

  // ---------------------------------------------------------------- efektler

  function renderFx(state, realDt) {
    fctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    const now = state.now;

    // saldırı cephesinin nabzı
    for (const a of sim.attacks) {
      if (a.lastX === undefined) continue;
      const p = 0.5 + 0.5 * Math.sin(now / 110);
      fctx.beginPath();
      fctx.arc(a.lastX * S, a.lastY * S, 10 + p * 7, 0, Math.PI * 2);
      fctx.strokeStyle = sim.nations[a.from].color;
      fctx.globalAlpha = 0.25 + p * 0.3;
      fctx.lineWidth = 3;
      fctx.stroke();
      fctx.globalAlpha = 1;
    }

    // tıklama dalgaları
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.age += realDt;
      const k = r.age / 0.55;
      if (k >= 1) { ripples.splice(i, 1); continue; }
      fctx.beginPath();
      fctx.arc(r.x * S, r.y * S, 6 + k * 60, 0, Math.PI * 2);
      fctx.strokeStyle = r.color;
      fctx.globalAlpha = (1 - k) * 0.85;
      fctx.lineWidth = 4 * (1 - k) + 1;
      fctx.stroke();
      fctx.globalAlpha = 1;
    }

    // yıkılan krallığın parçacıkları
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.age += realDt;
      if (b.age > 1.1) { bursts.splice(i, 1); continue; }
      b.x += b.vx * realDt; b.y += b.vy * realDt;
      b.vy += 34 * realDt;
      fctx.globalAlpha = clamp(1 - b.age / 1.1, 0, 1);
      fctx.fillStyle = b.color;
      fctx.fillRect(b.x - 2, b.y - 2, 4, 4);
      fctx.globalAlpha = 1;
    }

    // hedef nişangâhı
    if (state.hoverCell >= 0 && state.hoverOwner !== undefined) {
      const x = (state.hoverCell % W) * S, y = ((state.hoverCell / W) | 0) * S;
      const p = 0.5 + 0.5 * Math.sin(now / 220);
      fctx.strokeStyle = `rgba(255,250,230,${0.45 + p * 0.4})`;
      fctx.lineWidth = 2;
      fctx.beginPath();
      fctx.arc(x, y, 11 + p * 3, 0, Math.PI * 2);
      fctx.stroke();
    }
  }

  return { renderMap, renderFx, ripple, burst };
}
