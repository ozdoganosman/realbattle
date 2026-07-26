# RealBattle

`territorial.io` mekaniğinde bir kıta hâkimiyeti oyunu, ortaçağ haritası üzerinde.
Tarayıcıda çalışır, kurulum gerektirmez.

Kural sade tutuldu; iddia **hissiyatta**: dokunuşun tepkisi, sınırın yayılma
animasyonu, ele geçen her hücrenin parlaması, sentezlenmiş ses.

---

## Oynanış

**Dokun, yayıl.** Düşman ya da boş bir toprağa dokun — sınırın o tarafa doğru
dalga hâlinde ilerler. Kenar çubuğundaki *Saldırı Gücü* kaç asker
göndereceğini belirler.

| Mekanik | Nasıl işler |
|---|---|
| **Sınır dalgası** | Saldırı, hedefin sana değen bütün sınırından başlar ve içeri doğru yayılır. Kopuk toprak oluşmaz. Deniz asla ele geçmez. |
| **Bileşik büyüme** | Ödemeler kesikli: her **0.56 sn**'lik tikte mevcut askerinin üstüne **bileşik faiz** (toprak payına göre %1.0–%2.6, açılışta 1.9 kat hızlı), her **10. tikte** (5.6 sn) **toprağın kadar** düz gelir. Hazine panelindeki 10 haneli gösterge bir sonraki ödemeye ne kaldığını sayar. |
| **Tavanlar** | Yumuşak tavan toprağın **40 katı**, sert tavan **60 katı**. İkisi arasında faiz doğrusal olarak sıfıra iner — sonsuz birikim yok, ama doygunluk düz bir çizgi de değil. |
| **Borçlanma** | Saldırı gücünü **%100'ün ötesine** çekip elinde olmayanı sefere sürebilirsin; askerin eksiye düşer. Gelen gelirin tamamı borca gider, borç da kendi faiziyle büyür ve kapanana kadar yeni sefere çıkamazsın. |
| **Yoğunluk savunur** | Bir hücrenin bedeli, savunanın *askeri / toprağı* oranıyla artar. Az toprakta çok asker tutan zor lokmadır. |
| **Savunan da erir** | Kaybedilen her hücre savunanın askerinden de götürür. |
| **Geri çağırma** | Süren bir seferi durdurabilirsin; kalan asker garnizona döner. |
| **İttifak** | Müttefikler birbirine saldıramaz. Ama ittifakı **bozan taraf 20 saniye boyunca hiçbir yere saldıramaz** — ihanet bedava değil. |

Zafer: kıtanın **%60**'ı. Bütün toprağını kaybedersen tarihe karışırsın.

Haritadaki arazi tipleri ve isimli şehirler **tamamen dekoratiftir** — fetih
maliyetini, hızı ya da geliri etkilemezler. Sadece harita gerçek bir ortaçağ
haritası gibi dursun diye varlar.

## Hissiyat

- Ele geçen her hücre beyaz parlar, sonra rengine oturur — dalga gözle görülür
- Üstüne geldiğin krallığın bütün toprağı aydınlanır, ne kadar yer alacağın yazar
- Saldırı anında ekran hafif sarsılır, tıkladığın yerden halka yayılır
- Yıkılan krallık parçacıklara dağılır
- Sayaçlar sıçramaz, akar
- Ses tamamen **sentezlenir** (WebAudio) — tek dosyaya sığsın diye hiç ses dosyası yok

---

## Çalıştırma

```bash
npm start          # http://localhost:8080
```

### Tek dosyalık sürüm

```bash
npm run build
```

`dist/realbattle.html` — bütün modüllerin ve CSS'in tek dosyaya paketlenmiş,
kendi başına açılan hâli (~60 KB). Dış bağımlılığı yok; doğrudan çift
tıklayarak da açılır. `dist/artifact.html` ise `<head>`'i kendi sağlayan
ortamlar için yalnız gövde içeriğini taşır.

## Test

```bash
npm test               # başsız simülasyon (50)
npm run test:browser   # masaüstü tarayıcı, gerçek fare (41)
npm run test:mobile    # telefon, gerçek çok parmaklı dokunma (24)
npm run test:all
```

`npm test` hiçbir tarayıcı gerektirmez: `js/sim.js` tamamen DOM'suzdur ve
Node'da doğrudan koşar. Tarayıcı testleri Playwright ile gerçek tıklama yapar;
telefon testi CDP üzerinden çok parmaklı dokunma göndererek dokun-saldır,
kaydırma ve iki parmakla yakınlaştırmayı ayrı ayrı doğrular.

Testler paketlenmiş sürüme karşı da koşturulabilir — kaynakla birebir aynı
davrandığını doğrular:

```bash
PAGE=/dist/realbattle.html npm run test:browser
PAGE=/dist/realbattle.html npm run test:mobile
```

---

## Mimari

```
js/world.js         Harita üretimi. Seed'den deterministik.
                    Arazi ve şehirler yalnız çizim içindir.
js/sim.js           Bütün oyun kuralları. DOM yok, Math.random yok, Date yok.
                    Tek giriş noktası: createSim(seed) + step(dt, realDt).
js/render.js        Canvas çizimi ve efektler. Simülasyonu sadece okur.
js/audio.js         Sentezlenmiş ses. Dosya yok, hepsi WebAudio ile üretilir.
js/game.js          İstemci: girdi (fare + dokunma), arayüz, ana döngü.
scripts/bundle.mjs  Tek dosyalık sürümü üretir.
server/             Şimdilik yalnız statik sunucu.
```

Rastgelelik `mulberry32` ile seed'e bağlı, zaman dışarıdan `dt` olarak
veriliyor. Aynı seed + aynı girdi dizisi → aynı sonuç; test bunu doğruluyor.
Kurallar çizimden ayrık olduğu için `sim.js` olduğu gibi bir sunucuda
koşturulabilir.
