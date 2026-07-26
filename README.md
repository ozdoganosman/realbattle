# RealBattle

`territorial.io` mekaniğinde bir kıta hâkimiyeti oyunu, ortaçağ haritası üzerinde.
Tarayıcıda çalışır, kurulum gerektirmez.

Kural sade tutuldu; iddia **hissiyatta**: dokunuşun tepkisi, sınırın yayılma
animasyonu, ele geçen her hücrenin parlaması, sentezlenmiş ses.

---

## Oynanış

**Dokun, yayıl.** Düşman ya da boş bir toprağa dokun — o hedefle paylaştığın
*bütün sınır hattı* aynı anda dalga hâlinde içeri ilerler. Kenar çubuğundaki
*Saldırı Gücü* kaç asker göndereceğini belirler.

| Mekanik | Nasıl işler |
|---|---|
| **Sınır dalgası** | Dokunmak hedefi seçer, giriş noktasını değil: cephe hedefin sana değen bütün hücreleridir. Dalga **halka halka** ilerler — sıradaki halkanın tamamı aynı anda düşer, yani sınır her yerde aynı derinlikte kalır, dişli ya da noktalı bir cephe oluşmaz. Kopuk toprak oluşmaz. Deniz asla ele geçmez. |
| **En küçük hamle** | Bir halka ya tamamen alınır ya hiç. Bu yüzden en küçük hamle "bütün sınırı bir hücre içeri it"tir; kaydıraç daha azını söylerse hamle sessizce bu en küçük değere yuvarlanır (borçlandırmaz). Cephe uzadıkça en küçük hamle de pahalanır — geniş sınır itmek pahalı, dar sınır itmek ucuzdur. |
| **Bileşik büyüme** | Ödemeler kesikli. Her **0.56 sn**'lik tikte mevcut askerinin üstüne **bileşik faiz** — oran toprak payıyla yükselir ve aralık geniştir: bir avuç toprakla tik başına ~**%2.4**, kıtaya hükmederken ~**%28** (açılışta ayrıca 1.9 kat hızlı). Küçükken ekonomi sürünür, büyüdükçe uçar. Her **10. tikte** (5.6 sn) toplu ödeme: **arsa ödemesi** — toprakla üstel artar ama üs neredeyse 1 (toprak iki katına çıkınca ödeme ~2.04 kat), yani büyümek kendini az besler ve lider kaçamaz — artı **faiz balonu**, tik faizinin altı katı. Hazine panelindeki 10 haneli gösterge bir sonraki ödemeye ne kaldığını sayar. |
| **Tavanlar** | Yumuşak tavan toprağın ~**11 katı**, sert tavan ~**17 katı**. İkisi arasında faiz doğrusal olarak sıfıra iner — sonsuz birikim yok, ama doygunluk düz bir çizgi de değil. |
| **Kaydıraç eğrisi** | Kaydıracın **%88**'ine kadarı hazinendir ve eğri alt uçta yatıktır: düşük konumlar askerinin küçük bir dilimini sürer. Amaç tek büyük hamle değil, **seri seri küçük hamleler**. |
| **Borçlanma** | Borç bölgesi kaydıracın son diliminde (kırmızı) sabittir — oraya çekmeden borçlanmazsın. Hazinen bittiğinde de saldırabilirsin, ama bu bilinçli bir tercihtir: askerin eksiye düşer, gelen ödemenin tamamı borca gider, borç kendi faiziyle büyür ve kapanana kadar yeni sefere çıkamazsın. |
| **Yoğunluk savunur** | Bir hücrenin bedeli, savunanın *askeri / toprağı* oranıyla **üstel** artar. Hazinesi boş bir düşmanın hücresi 2.5 askere gelir, hazinesi tıka basa dolu olanınki **32** — yani 13 kat. Dolu hazine gerçek bir kaledir; önce onu kanatman gerekir. |
| **İki taraf da erir** | Çarpışmada ikisi de kanar ama **saldıranın faturası ağır**: saldıran hücrenin tam bedelini öder, savunan bunun **%75**'ini kaybeder. Savunan kanadıkça yoğunluğu düşer, yoğunluğu düşünce hücreleri ucuzlar — kale zamanla çöker, ama bedelini saldıran öder. |
| **Geri çağırma** | Süren bir seferi durdurabilirsin; kalan asker garnizona döner. |
| **İttifak** | Müttefikler birbirine saldıramaz. Ama ittifakı **bozan taraf 20 saniye boyunca hiçbir yere saldıramaz** — ihanet bedava değil. |

Zafer: kıtanın **%60**'ı. Bütün toprağını kaybedersen tarihe karışırsın.

Haritadaki arazi tipleri ve isimli şehirler **tamamen dekoratiftir** — fetih
maliyetini, hızı ya da geliri etkilemezler. Sadece harita gerçek bir ortaçağ
haritası gibi dursun diye varlar.

## Hissiyat

- Dar ekranda çekmece kapalıyken bile asker, faiz, gelir geri sayımı, hazine
  çubuğu ve süren sefer görünür kalır
- Her krallığın adının altında askeri yazar — kimin ne kadar gücü olduğu haritadan okunur
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
npm test               # başsız simülasyon (62)
npm run test:browser   # masaüstü tarayıcı, gerçek fare (43)
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
