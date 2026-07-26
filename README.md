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

Kıta **400×248** hücre (~57.500 kara hücresi). Boş toprağa yayılma hızlıdır
(~3.6 sn) ama **başka bir krallıkla çarpışma 9 saniye sürer** — kuşatmayı
izleyecek, karşılık verecek zaman olsun diye.

Bir oyun ortalama **~2.4 dakika** sürer; harita ~90 saniyede paylaşılır.
Uzunluk tek bir düğmeden ayarlanır: `SPEED` (ekonominin hızı). Yarıya
indirmek oyunu kabaca iki katına çıkarır.

| Mekanik | Nasıl işler |
|---|---|
| **Sınır dalgası** | Dokunmak hedefi seçer, giriş noktasını değil: cephe hedefin sana değen bütün hücreleridir. Dalga **halka halka** ilerler ve bütçe halkanın bütün hücrelerine **eşit** dağıtılır: her hücrenin kuşatma ilerlemesi aynı anda, aynı hızda artar. Hücre ancak ilerlemesi dolunca el değiştirir, yani sınır her yerde birlikte hareket eder — sıra sıra tek hücre düşen fermuar ya da dağınık benek görüntüsü yok. Kopuk toprak oluşmaz. Deniz asla ele geçmez. |
| **Tam halka** | Hamle **tam halkalara** yuvarlanır: sınır ya bir hücre birden ilerler ya hiç. Yarım halka bırakmak cepheyi tırtıklı, nokta nokta gösteriyordu. Sefer sürerken bütün cephe senin rengine doğru birlikte kayar (kuşatma), halka dolunca hep birlikte düşer. Artan kuşatma **iade** edilir — asker heba olmaz, haritada iz kalmaz. Kaydıracın altındaki yazı sınırı kaç hücre iteceğini söyler. |
| **Bileşik büyüme** | Ödemeler kesikli. Her **0.56 sn**'lik tikte mevcut askerinin üstüne **bileşik faiz** — oran toprak payıyla yükselir ve aralık geniştir: bir avuç toprakla tik başına ~**%1.2**, kıtaya hükmederken ~**%14** (açılışta ayrıca 1.9 kat hızlı). Küçükken ekonomi sürünür, büyüdükçe uçar. Her **10. tikte** (5.6 sn) toplu ödeme: **arsa ödemesi** — toprakla üstel artar ama üs neredeyse 1 (toprak iki katına çıkınca ödeme ~2.04 kat), yani büyümek kendini az besler ve lider kaçamaz — artı **faiz balonu**, tik faizinin altı katı. Hazine panelindeki 10 haneli gösterge bir sonraki ödemeye ne kaldığını sayar. |
| **Tavanlar** | Yumuşak tavan toprağın ~**114 katı**, sert tavan ~**171 katı** (eski tavanın 10 katı). İkisi arasında faiz doğrusal olarak sıfıra iner — sonsuz birikim yok ama hazine çok derin, bileşik faiz uzun süre çalışıyor ve dolu hazineyle devasa hamleler yapılabiliyor. Savunma katsayısı bu büyümeyle birlikte bölünür, yani savunmanın *şekli* aynı kalır: boş hazine **4**, yumuşak tavan **34**, sert tavan **51** asker/hücre. |
| **Kaydıraç eğrisi** | Kaydıracın **%88**'ine kadarı hazinendir ve eğri alt uçta yatıktır: düşük konumlar askerinin küçük bir dilimini sürer. Amaç tek büyük hamle değil, **seri seri küçük hamleler**. |
| **Borçlanma** | Borç bölgesi kaydıracın son diliminde (kırmızı) sabittir — oraya çekmeden borçlanmazsın. Borç sınırı toprağın ~**29 katı** — sert tavanın %17'si, tavanla birlikte ölçeklenir. Hazinen bittiğinde de saldırabilirsin, ama bu bilinçli bir tercihtir: askerin eksiye düşer, gelen ödemenin tamamı borca gider, borç kendi faiziyle büyür ve kapanana kadar yeni sefere çıkamazsın. |
| **Yoğunluk savunur** | Bir hücrenin bedeli, savunanın *askeri / toprağı* oranıyla **üstel** artar. Hazinesi boş bir düşmanın hücresi 4 askere gelir, hazinesi tıka basa dolu olanınki **51** — yani 13 kat. Dolu hazine gerçek bir kaledir; önce onu kanatman gerekir. |
| **İki taraf da erir** | Çarpışmada ikisi de kanar ama **saldıranın faturası ağır**: saldıran hücrenin tam bedelini öder, savunan bunun **%75**'ini kaybeder. Savunan kanadıkça yoğunluğu düşer, yoğunluğu düşünce hücreleri ucuzlar — kale zamanla çöker, ama bedelini saldıran öder. |
| **Tek hedef, tek cephe** | Bir hedefe karşı aynı anda **tek** sefer sürer. Cephe zaten o hedefle paylaştığın bütün sınır hattı olduğu için ikinci bir sefer yeni bir yere yüklenmez — aynı hücreleri kuşatır. Daha çok asker sürmek istersen önce geri çağır, sonra gücü yükseltip yeniden çık. |
| **Geri çağırma** | Süren bir seferi durdurabilirsin; kalan asker garnizona döner (hazine tavanı taşarsa fazlası kırpılır). |
| **Dağılma** | Bir krallık kıtanın binde 0.8'inin (en az 10 hücre) altına düşünce **dağılır**: kalan kırıntı fatihe geçmez, **sahipsiz** toprağa döner. Tıklanamayacak kadar küçük lekeleri kovalamak yok, toprak yeniden yarışa girer. |
| **İttifak** | Müttefikler birbirine saldıramaz. İttifakı **bozan taraf 20 saniye boyunca hiçbir yere saldıramaz** ve **süren bütün seferleri o anda geri çağrılır** — ihanet bedava değil. Ama ittifaklar **süreli**: 45 saniye sonra kendiliğinden düşer (ceza yok, yeniden kurulabilir). Kalıcı ittifaklar geç oyunda iki bloğu dondurup haritayı kilitliyordu. |
| **Lider yalnızdır** | Kıtanın **%35**'ini aşan krallıkla kimse ittifak kurmaz ve gücü ne olursa olsun üstüne gidilir. Kural iki yönlüdür: lidere teklif götüremezsin, lider konumundaysan sana da kimse yanaşmaz. |

Zafer: kıtanın **%60**'ı. Toprağın eşiğin altına düşerse tarihe karışırsın.

Haritadaki arazi tipleri ve isimli şehirler **tamamen dekoratiftir** — fetih
maliyetini, hızı ya da geliri etkilemezler. Sadece harita gerçek bir ortaçağ
haritası gibi dursun diye varlar.

## Hissiyat

- Dar ekranda çekmece kapalıyken bile asker, faiz, gelir geri sayımı, hazine
  çubuğu, döngü göstergesi, süren sefer **ve saldırı gücü kaydıracı** görünür
  kalır — telefonda hamle yapmak için çekmeceyi açmaya gerek yok
- Harita üstündeki **cephe göstergesi** her zaman açıktır: kime yükleniyorsun,
  kim sana yükleniyor, halka ne kadar doldu, cephede kaç asker kaldı — ve ✕ ile
  seferi oradan geri çağırabilirsin
- Her krallığın adının altında askeri yazar — kimin ne kadar gücü olduğu haritadan okunur
- Ele geçen her hücre beyaz parlar, sonra rengine oturur — dalga gözle görülür
- Üstüne geldiğin krallığın bütün toprağı aydınlanır, ne kadar yer alacağın yazar
- Saldırı anında ekran hafif sarsılır, tıkladığın yerden halka yayılır
- Yıkılan krallık parçacıklara dağılır
- Kuşatma sürerken alçak bir uğultu duyulur, perde halka doldukça yükselir;
  halka düşünce tok bir vuruş gelir, art arda düşen halkalarda perde tırmanır
- Bitiş ekranı oyunun özetini verir: süre, zirve toprak, fethedilen toprak,
  yıkılan krallık sayısı, sıralaman
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
kendi başına açılan hâli (~100 KB). Dış bağımlılığı yok; doğrudan çift
tıklayarak da açılır. `dist/artifact.html` ise `<head>`'i kendi sağlayan
ortamlar için yalnız gövde içeriğini taşır.

## Test

```bash
npm test               # başsız simülasyon (77)
npm run test:browser   # masaüstü tarayıcı, gerçek fare (52)
npm run test:mobile    # telefon, gerçek çok parmaklı dokunma (29)
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
