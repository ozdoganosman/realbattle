# RealBattle

Ortaçağ konseptli, `territorial.io` çekirdeğinden yola çıkan ama fetih mekaniğini
derinleştiren bir kıta hâkimiyeti oyunu. Tarayıcıda çalışır, kurulum gerektirmez.

**Temel fark:** toprak sınır boyunca eşit yayılmaz. Ordular haritada gerçek
birimlerdir; nereye fırlatırsan oraya gider.

---

## Oynanış

**Bas – sürükle – bırak.** Kendi toprağından bir noktaya bas, sürükle, bırak.
Ordu o yönde fırlar ve önüne çıkan toprağı alır. Sürükleme uzunluğu menzili,
kenar çubuğundaki *Sefer Gücü* ise kaç asker göndereceğini belirler.

Telefonda da aynı: **tek parmak** kendi toprağından başlarsa ordu fırlatır,
başka yerden başlarsa haritayı kaydırır. **İki parmak** her zaman yakınlaştırır.
Sağ üstteki ± düğmeleri ve haritayı sığdırma düğmesi de var. Yan panel dar
ekranda alttan açılan bir çekmeceye dönüşür; kapalıyken *Sefer Gücü* hep
görünür kalır, koluna dokununca krallıklar ve Divan açılır.

| Mekanik | Nasıl işler |
|---|---|
| **İlerledikçe erime** | Her alınan hücre asker yer. Ova ucuz, orman ×1.55, dağ ×2.60. Kalenin yakını daha da pahalı. Ordu toprak kazanır ama küçülür. |
| **Ordu çarpışması** | Karşılaşan iki düşman ordu, biri tükenene kadar birbirinin puanını götürür. Çarpışan ordular neredeyse durur. |
| **Kuşatma** | Bir kara parçası tamamen tek bir krallığın toprağıyla çevrelenirse o krallık tarafından tek lokmada yutulur. Cebi kapatmak, onu tek tek fethetmekten çok ucuzdur. |
| **İkmal** | Ordu her saniye kendiliğinden bir miktar erir. Menzili biten ya da takılan ordunun kalan askeri garnizona döner. |
| **Şehir ve kale** | Her bölgede bir şehir var. Şehirler altın getirir; kaleler (4 kademe) çevresindeki hücrelerin fetih maliyetini artırır. Altınla kendi kaleni yükseltebilirsin. |

### Diplomasi

- **İttifak** — müttefikler birbirine saldıramaz, orduları birbirinin toprağından
  bedelsiz geçer.
- **Birlikte savaşa girme** — müttefikin savaşa girince *Divan*'a çağrı düşer.
  Katılırsan sen de savaşa girersin.
- **İhanet cezası** — ittifakı **bozan taraf 20 saniye boyunca hiçbir yere
  saldıramaz.** Savaşa çağrıyı reddetmek de ittifakı bozmak sayılır. Bu yüzden
  ittifak gerçek bir taahhüttür, bedava sigorta değil.
- **Barış ve ateşkes** — barış imzalayan iki taraf arasında bir süre saldırı
  yasağı olur; ateşkesli komşunun toprağı fetihte otomatik atlanır.

Yapay zekâ krallıklar bunların hepsini kullanır: zayıf düşünce barış ister,
büyüyen bir güce karşı kendi aralarında ittifak kurar, cephedeki en ucuz hedefe
yüklenir.

### Zafer

Kıtanın **%55**'ine hükmet. Bütün toprağını kaybedersen tarihe karışırsın.

Tipik bir oyunun yayı: ilk ~5 dakika tarafsız toprak kapışması, ardından
krallıkların birbirini yemesi, ~25–30. dakikada bir liderin eşiği geçmesi.

---

## Çalıştırma

```bash
npm start          # http://localhost:8080
```

Sunucusuz da açılır, ancak ES modülleri `file://` üzerinden CORS'a takılır —
statik bir sunucu gerekir.

### Tek dosyalık sürüm

```bash
npm run build
```

`dist/realbattle.html` — dört modülün ve CSS'in tek dosyaya paketlenmiş,
kendi başına açılan hâli (~70 KB). Hiçbir dış bağımlılığı yok; telefona
kopyalayıp ya da herhangi bir statik yere koyup açabilirsin.
`dist/artifact.html` ise `<head>`'i kendi sağlayan ortamlar için yalnız
gövde içeriğini taşır.

## Test

```bash
npm test               # başsız simülasyon (25)
npm run test:browser   # masaüstü tarayıcı, gerçek fare (19)
npm run test:mobile    # telefon, gerçek çok parmaklı dokunma (24)
npm run test:all
```

`npm test` hiçbir tarayıcı gerektirmez: `js/sim.js` tamamen DOM'suzdur ve
Node'da doğrudan koşar. Tarayıcı testleri Playwright ile gerçek
bas–sürükle–bırak yapar; telefon testi CDP üzerinden çok parmaklı dokunma
göndererek kaydırmayı ve iki parmakla yakınlaştırmayı da doğrular. İkisi de
`.shots/` altına ekran görüntüsü bırakır.

Testler paketlenmiş sürüme karşı da koşturulabilir — kaynakla birebir aynı
davrandığını doğrular:

```bash
PAGE=/dist/realbattle.html npm run test:browser
PAGE=/dist/realbattle.html npm run test:mobile
```

---

## Mimari

Kod bilerek **kural / çizim** olarak ikiye ayrıldı; çok oyunculuya geçişte
simülasyon katmanı olduğu gibi sunucuya taşınacak.

```
js/world.js       Harita üretimi. Seed'den deterministik: arazi, bölgeler, şehirler.
js/sim.js         Oyunun bütün kuralları. DOM yok, Math.random yok, Date yok.
                  Tek giriş noktası: createSim(seed) + step(dt, realDt).
js/render.js      Canvas çizimi. Simülasyonu sadece okur, asla değiştirmez.
js/game.js        İstemci: girdi (fare + dokunma), arayüz, ana döngü.
scripts/bundle.mjs  Tek dosyalık sürümü üretir.
server/           Şimdilik yalnız statik sunucu. Otoriter oyun sunucusu buraya.
```

Rastgelelik `mulberry32` ile seed'e bağlıdır, zaman dışarıdan `dt` olarak
verilir. Aynı seed + aynı girdi dizisi → aynı sonuç. `test/sim.test.mjs`
bunu doğrular (aynı seed aynı haritayı üretir, hücre sayaçları haritayla
tutarlı kalır).

### Sonraki aşama — çok oyunculu

`sim.js` zaten sunucuda koşacak hâlde. Yapılacaklar:

1. Sunucuda otoriter tik döngüsü (`step`) ve WebSocket yayını.
2. İstemci girdisi tek bir mesaja iner: `launchArmy(x, y, dx, dy, oran, menzil)`.
3. İstemci `sim`'i tahmin için yerel koşturur, sunucu durumu gelince düzeltir.
4. `render.js` ve `game.js` değişmeden kalır.
