// Dört ES modülünü ve CSS'i tek dosyaya paketler.
// İki çıktı üretir:
//   dist/realbattle.html   — kendi başına açılan tam belge (paylaşım / Pages)
//   dist/artifact.html     — yalnız gövde içeriği (<head>'i barındıran ortamlar için)
//
// Kullanım: npm run build

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ES modül sözdizimini tek kapsama indir: modüller arası import/export kalkar,
// dosyalar bağımlılık sırasına göre birleşir.
function strip(src, name) {
  const out = src
    .replace(/^import\s+[\s\S]*?\s+from\s+'[^']*';[ \t]*\r?\n?/gm, '')
    .replace(/^export\s*\{[\s\S]*?\}\s*from\s+'[^']*';[ \t]*\r?\n?/gm, '')
    .replace(/^export\s+(const|function|let|var|class)\b/gm, '$1');
  // paketlemeyi bozacak bir kalıntı kaldıysa sessizce geçme
  const leftover = out.match(/^\s*(import|export)\b.*/m);
  if (leftover) throw new Error(`${name}: paketlenemeyen satır → ${leftover[0].trim()}`);
  return out;
}

const MODULES = ['js/world.js', 'js/sim.js', 'js/render.js', 'js/game.js'];
const script = MODULES
  .map(f => `// ${'='.repeat(28)} ${f}\n${strip(read(f), f)}`)
  .join('\n');

const css = read('style.css');

// index.html'in gövdesini al; modül <script> etiketini çıkar.
const html = read('index.html');
const body = html
  .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

// Gömülü <head> yoksa görünüm penceresini kendimiz kuruyoruz: bu olmadan
// telefon tarayıcısı 980px'lik yerleşim varsayar ve dar ekran kuralları
// hiç devreye girmez.
const VIEWPORT_SHIM = `
(function () {
  if (!document.querySelector('meta[name="viewport"]')) {
    var m = document.createElement('meta');
    m.name = 'viewport';
    m.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    document.head.appendChild(m);
  }
  if (!document.title) document.title = 'RealBattle — 1444';
})();
`.trim();

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 2 4 6v11c0 7 5 11 12 13 7-2 12-6 12-13V6z' fill='%231f7a4d' stroke='%232b1f14' stroke-width='2'/%3E%3C/svg%3E";

const payload = `<style>\n${css}\n</style>\n\n${body}\n\n<script type="module">\n${VIEWPORT_SHIM}\n\n${script}\n</script>\n`;

const standalone = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>RealBattle — 1444</title>
<link rel="icon" href="${FAVICON}">
</head>
<body>
${payload}</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/realbattle.html'), standalone);
fs.writeFileSync(path.join(ROOT, 'dist/artifact.html'), payload);

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`dist/realbattle.html  ${kb(standalone.length)}`);
console.log(`dist/artifact.html    ${kb(payload.length)}`);
