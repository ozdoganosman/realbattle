// Saf simülasyon. DOM yok, Math.random yok, Date yok.
// territorial.io çekirdeği: tıkladığın tarafa sınırın dalga gibi yayılır.
// Ordu birimi, arazi, ekonomi yok — sadece toprak, asker ve ittifak.

import { W, H, createWorld, mulberry32, idx, clamp } from './world.js';

export const NATION_DEFS = [
  ['İngiltere', '#d94141'], ['Fransa', '#3a63d8'], ['Kastilya', '#e8c33a'],
  ['Portekiz', '#2fa05e'], ['Aragon', '#ef8a2f'], ['Burgonya', '#f0b03f'],
  ['Avusturya', '#c8cdd8'], ['Danimarka', '#e0729b'], ['Polonya', '#d955ab'],
  ['Litvanya', '#8f4444'], ['Moskova', '#3fbb8a'], ['Macaristan', '#a86fe0'],
  ['Osmanlı', '#1f9159'], ['Bizans', '#7b48b8'], ['Venedik', '#42b8dc'],
  ['Novgorod', '#9aa844'],
];

export const WIN_FRAC = 0.60;
export const BETRAY_LOCK = 20;        // ihanet cezası — GERÇEK saniye
// İttifaklar SÜRELİDİR. Kalıcı olunca geç oyunda iki blok donuyor ve harita
// kilitleniyordu: 24 tohumun 14'ünde lider %50-59'da takılıp kalıyordu.
// Süre dolunca ittifak kendiliğinden düşer (ihanet sayılmaz, ceza yok) ve
// cepheler yeniden açılır.
export const ALLY_SECS = 45;
// Kıtanın bu kadarını tutan artık "lider"dir: kimse onunla ittifak kurmaz ve
// gücü ne olursa olsun üstüne gidilebilir. Arayüz de aynı eşiği kullanmalı —
// oyuncunun lidere yanaşabilmesi tam da kilitlenmeyi getiren durumdu.
export const LEADER_FRAC = 0.35;

// --- ekonomi (territorial.io modeli) ---
// İki ayrı büyüme: her TICK'te mevcut askerin üstüne BİLEŞİK faiz, ve her
// INCOME_PERIOD'da toprağın kadar düz gelir. Faiz oranı toprak payıyla
// yükselir; yumuşak tavanı geçince doğrusal olarak sıfıra iner.
export const TICK = 0.56;             // faiz periyodu (sn)
export const TICKS_PER_INCOME = 10;   // her 10 tikte bir arazi geliri (5.6 sn)
// Bütün asker sayıları bu kadar küçülür — sadece okunabilirlik için, oyunun
// dengesini değiştirmez (hem gelirler hem tavanlar hem bedeller birlikte iner).
const TROOP_SCALE = 1 / 3.5;
// Buna EK olarak toprak ucuzlar: aynı askerle daha çok yer alırsın.
const LAND_CHEAP = 1.0;

// Ekonominin hızı — birimsiz. Asker ölçeğinden bağımsızdır.
const SPEED = 2;
// Arsa ödemesi asker birimindedir, bu yüzden asker ölçeğiyle birlikte küçülür.
export const INCOME_SCALE = SPEED * TROOP_SCALE;
// Arazi geliri toprakla üstel artar ama üs neredeyse 1: büyümek çok az
// kendini besler. Tam 1 yaparsak oyun kilitleniyor (12 tohumda 4'ü çözüldü),
// bu yüzden üstellik sıfırlanmıyor, yalnızca hissedilmez seviyeye çekiliyor.
const INCOME_EXP = 1.03;
// Gelir tikinde faiz de toplu (balon) ödeme yapar — tik faizinin bu katı.
const BALLOON = 6;
// Şehir geliri: elindeki şehirlerin `size` toplamı × bu × INCOME_SCALE, arsa
// gelirinin YANINA yatar. Asıl mesele toplam değil DAĞILIM: şehir kuşağını
// tutan, aynı toprakla belirgin biçimde daha hızlı büyür.
//
// Bu sayı GERİ ÖDEME süresine göre seçildi: şehri almak, halkasının fazladan
// faturasını kaç saniyede çıkarıyor? 28'de ödeme ~173 saniyeydi — bir oyun 144
// saniye sürdüğü için şehir fethetmek matematiksel olarak zarardı ve ölçümde
// kazananla kaybedenin şehir yoğunluğu ayırt edilemiyordu (1.03× vs 1.04×).
export const CITY_INCOME = 60;
// YZ'nin şehir iştahı: ortalamanın üç katı şehir yoğunluğuna sahip bir komşu
// bu katsayıyla iki kat çekici olur. Çok yükseltmek YZ'yi surlara koşturup
// ordusunu eritiyordu (şehir halkası aynı zamanda pahalı).
const CITY_GREED = 0.5;
// Faiz bir ORAN: asker ölçeğiyle değil, yalnız hızla çarpılır.
const INTEREST_MIN = 0.006 * SPEED;   // çok az toprakta tik başına faiz
const INTEREST_MAX = 0.070 * SPEED;   // bütün haritaya hükmederken
// Tavan toprağın katı. Gelir 5.6 sn'de toprak kadar geldiğinden, faiz ancak
// asker toprağın ~5 katını aştıktan sonra baskın olur; tavan dar tutulursa
// bileşik büyüme hiç hissedilmez. Bu yüzden aralık geniş.
// Tavan 10 KATA çıkarıldı: hazine çok daha derin, bileşik faiz çok daha uzun
// süre çalışıyor ve dolu bir hazineyle çok daha büyük hamleler yapılabiliyor.
const CAP_BOOST = 10;
const SOFT_MULT = 40 * CAP_BOOST * TROOP_SCALE;   // yumuşak tavan = toprak × bu
const HARD_MULT = 60 * CAP_BOOST * TROOP_SCALE;   // sert tavan — faiz burada tam durur
const EARLY_BOOST = 1.9;              // açılışta faiz çarpanı
const EARLY_SECS = 160;             // bu sürede 1'e iner — oyun yavaşlayınca pencere de uzadı
const START_MULT = 18 * TROOP_SCALE;   // başlangıç askeri = toprak × bu

// --- borçlanma ---
// Elindekinden fazlasını sefere sürebilirsin; asker eksiye düşer. Gelen gelir
// önce borcu kapatır, borç da kendi faiziyle büyür — bedava kredi değil.
// En fazla borç = toprak × bu. Tavanla birlikte ölçekleniyor: yoksa hazine
// 10 kat derinleşince borç bölgesi hazinenin binde biri kalır ve kaydıracın
// kırmızı ucu hiçbir işe yaramazdı (eskiden sert tavanın ~%17'siydi).
const DEBT_MULT = 10 * CAP_BOOST * TROOP_SCALE;
const DEBT_RATE = 0.012;              // borcun tik başına büyümesi — borçlanmak riskli

// --- saldırı dengesi ---
// Boş toprak ucuz, savunulan toprak pahalı. Açılıştaki kapışma hızlı olmalı;
// asıl zorluk yerleşmiş bir krallıktan toprak koparmak.
const NEUTRAL_COST = 25 * TROOP_SCALE / LAND_CHEAP;  // tarafsız hücrenin bedeli
const BASE_COST = 14 * TROOP_SCALE / LAND_CHEAP;     // düşman hücresinin tabanı
// Yoğunluk bedele ÜSTEL girer: kalabalık ordu doğrusal değil, hızlanarak
// pahalanır — dolu bir hazinenin üstüne yürümek gerçekten kaledir.
const DEF_EXP = 1.15;
// Savunanın yoğunluk ağırlığı. Tavan CAP_BOOST kadar büyüyünce yoğunluk da
// aynı oranda büyür, o yüzden katsayı CAP_BOOST^DEF_EXP ile bölünür: savunma
// eğrisinin ŞEKLİ korunur (boş hazine 4.0, yumuşak tavan 33.6, sert tavan 51.3
// asker/hücre — sert/boş oranı 12.8 kat).
// Bölünmeseydi dolu hazine 400 askere fırlar, harita kilitlenirdi.
const DEF_K = 1.8 / LAND_CHEAP / Math.pow(CAP_BOOST, DEF_EXP);
// Çarpışmada iki taraf da erir ama saldıran daha çok verir: savunan, hücrenin
// bedelinin bu kadarını kaybeder (1'in altı = saldıran daha pahalıya alır).
// Kanamak yoğunluğunu düşürür, düşen yoğunluk hücreyi ucuzlatır — yani baskı
// altındaki büyük ordu zamanla kırılır, ama bedeli saldıran öder.
const DEF_LOSS = 0.75;
// Dalganın hedeflenen süresi. Boş toprağa yayılmak hızlı olmalı — asıl olay
// başka bir krallıkla çarpışmak, o yüzden savaş cephesi belirgin biçimde
// daha uzun sürer: kuşatmayı izleyecek, karşılık verecek zaman olsun.
const ATTACK_SECS = 3.6;              // tarafsız toprak
const WAR_SECS = 9;                   // düşman toprağı
const RATE_MIN = 7;                   // en yavaş yayılma (hücre/sn)
// Bir ulus bu kadar küçülünce dağılır: toprakları sahipsiz kalır. Kalan bir
// iki hücrelik kırıntıya nişan almak imkânsız, haritayı da kirletiyor.
const MIN_CELLS = 0.0008;             // kıtanın bu payının altı = dağılma

export function createSim(seed) {
  const world = createWorld(seed);
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const owner = new Int16Array(W * H).fill(-1);

  // Haritadaki bütün şehirlerin `size` toplamı ve kara hücresi başına ortalama
  // şehir yoğunluğu. YZ "bu hedef ortalamadan zengin mi" sorusunu buna göre
  // sorar — tohumdan tohuma şehir sayısı değişiyor, sabit eşik yanıltırdı.
  let cityTotal = 0;
  for (const c of world.cities) cityTotal += c.size;

  const sim = {
    world, rnd, owner,
    lastCapture: new Float32Array(W * H).fill(-99),  // hücre ne zaman el değiştirdi
    // Kuşatma ilerlemesi: bir hücre tek hamlede değil, 0'dan 1'e dolarak el
    // değiştirir. Böylece cephenin TAMAMI aynı anda ve eşit ilerler; az asker
    // sürmek sınırı boydan boya biraz ilerletir, bir bölümünü çok değil.
    prog: new Float32Array(W * H),
    progBy: new Int16Array(W * H).fill(-1),
    t: 0, realT: 0,
    nations: [], attacks: [], nextAttackId: 1,
    playerId: -1, over: false, won: false,
    events: [], fx: [],                              // fx: arayüzün tükettiği anlık olaylar
    playerOffers: new Set(),
    landCells: world.landCells,
    cityTotal,
    cityYogunluk: cityTotal / Math.max(1, world.landCells),
    tickAcc: 0, tickNo: 0,            // faiz/gelir döngüsü — gösterge bunu okur
    dirty: true,
  };

  // başlangıç yurtları: birbirinden olabildiğince uzak
  const spots = [];
  const cand = [];
  // Başlangıç yurdu ölçeği: harita büyüdükçe yurt da büyür, yoksa açılış
  // kıtanın içinde kaybolur.
  const R = Math.round(4 * (W / 280));
  for (let y = R; y < H - R; y += 3) for (let x = R; x < W - R; x += 3) {
    const c = idx(x, y);
    if (!world.isLand[c]) continue;
    // kıyıya çok yakın olmasın ki başlangıç yurdu sıkışmasın
    let land = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const n = idx(clamp(x + dx, 0, W - 1), clamp(y + dy, 0, H - 1));
      if (world.isLand[n]) land++;
    }
    if (land > (2 * R + 1) ** 2 * 0.82) cand.push({ x, y });
  }
  // Aday yoksa spots[i] undefined kalır ve aşağıdaki `spots[i].x` çöker.
  // Harita üretimi her tohumda bol aday veriyor ama sessiz çökme yerine
  // konuşan bir hata daha iyi.
  if (!cand.length) throw new Error(`createSim(${seed}): başlangıç yurdu için aday hücre yok`);
  spots.push(cand[(rnd() * cand.length) | 0]);
  while (spots.length < NATION_DEFS.length && spots.length < cand.length) {
    let best = null, bestD = -1;
    for (const c of cand) {
      let d = Infinity;
      for (const k of spots) d = Math.min(d, (c.x - k.x) ** 2 + (c.y - k.y) ** 2);
      if (d > bestD) { bestD = d; best = c; }
    }
    spots.push(best);
  }
  // Aday sayısı ulus sayısından azsa (aşırı denizli bir tohum) kalanlar
  // adaylardan tekrar seçilir — eksik spots[i] doğrudan çökme demekti.
  while (spots.length < NATION_DEFS.length) spots.push(cand[(rnd() * cand.length) | 0]);

  NATION_DEFS.forEach(([name, color], i) => {
    const nat = {
      id: i, name, color, pool: 0, cells: 0,
      alive: true, ai: true,
      allies: new Set(), allySince: new Map(), lockUntil: 0,
      lastThink: rnd() * 2.5,
      // cx/cy toprağın ağırlık merkezi — yalnız çizim için, take() ile
      // birlikte kayar. sumX/sumY o merkezin O(1) güncellenen birikimidir.
      cx: spots[i].x, cy: spots[i].y, sumX: 0, sumY: 0,
      // Elindeki şehirlerin `size` toplamı — gelir buradan okunur. take() ile
      // O(1) güncellenir; gelir tikinde şehir listesi taranmaz.
      cityScore: 0, cityCount: 0,
      // Bu ulusun şehir iştahı. Ulus başına ayrı duruyor ki dengeyi ölçerken
      // A/B kurulabilsin: aynı tohumda tek ulusu şehir avcısı yapıp ötekileri
      // olduğu gibi bırakmak, "şehre yönelmek işe yarıyor mu"yu tek başına
      // yalıtan tek ölçüm.
      cityGreed: CITY_GREED,
    };
    sim.nations.push(nat);
    // R hücre yarıçapında yuvarlak bir başlangıç yurdu
    const { x, y } = spots[i];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R + 2) continue;
      const cx = clamp(x + dx, 0, W - 1), cy = clamp(y + dy, 0, H - 1);
      const c = idx(cx, cy);
      if (world.isLand[c] && owner[c] === -1) {
        owner[c] = i; nat.cells++;
        nat.sumX += cx; nat.sumY += cy;
        const ci = world.cityAt[c];
        if (ci >= 0) { nat.cityScore += world.cities[ci].size; nat.cityCount++; }
      }
    }
    if (nat.cells > 0) {
      nat.cx = clamp(Math.round(nat.sumX / nat.cells), 0, W - 1);
      nat.cy = clamp(Math.round(nat.sumY / nat.cells), 0, H - 1);
    }
    // Başlangıç askeri toprağa oranlı olmalı: sabit bir sayı, bedel ölçeği
    // değiştiğinde açılışı ölü doğurur (140 asker ≈ 5 hücre demekti).
    nat.pool = nat.cells * START_MULT;
  });

  return sim;
}

// ------------------------------------------------------------------ yardımcı

export function log(sim, metin, tip = 'info') {
  sim.events.push({ tip, metin });
  if (sim.events.length > 120) sim.events.shift();
}

export const allied = (a, b) => a.allies.has(b.id);
export const locked = (sim, n) => n.lockUntil > sim.realT;
export const landFrac = (sim, nat) => nat.cells / sim.landCells;

// Tavanlar toprağa bağlı: büyüdükçe biriktirebileceğin asker de büyür.
export function softCap(sim, nat) { return Math.max(60 * TROOP_SCALE, nat.cells * SOFT_MULT); }
export function hardCap(sim, nat) { return Math.max(90 * TROOP_SCALE, nat.cells * HARD_MULT); }
export const troopCap = hardCap;      // arayüzde gösterilen tavan

// Tik başına bileşik faiz oranı. Toprak payıyla yükselir, yumuşak tavandan
// sonra doğrusal olarak sıfıra iner — sonsuz birikim yok ama doygunluk da
// düz bir çizgi değil.
export function interestRate(sim, nat) {
  const frac = nat.cells / sim.landCells;
  let r = INTEREST_MIN + (INTEREST_MAX - INTEREST_MIN) * frac;
  if (sim.t < EARLY_SECS) r *= 1 + (EARLY_BOOST - 1) * (1 - sim.t / EARLY_SECS);
  const soft = softCap(sim, nat), hard = hardCap(sim, nat);
  if (nat.pool > soft) r *= clamp(1 - (nat.pool - soft) / (hard - soft), 0, 1);
  return r;
}

// Gelir tikinde yatacak toplu ödeme: arazi geliri (toprakla üstel) artı
// faizin balon ödemesi. Arayüz bunu okuyup geri sayımın yanında gösterir.
export function incomePayout(sim, nat) {
  const land = Math.pow(Math.max(0, nat.cells), INCOME_EXP) * INCOME_SCALE;
  const city = nat.cityScore * CITY_INCOME * INCOME_SCALE;
  const balloon = Math.max(0, nat.pool) * interestRate(sim, nat) * BALLOON;
  return { land, city, balloon, total: land + city + balloon };
}

// Borçtayken savunma yoğunluğu negatife düşmesin — bedel tabanın altına inmez.
export function density(nat) { return Math.max(0, nat.pool) / Math.max(25, nat.cells); }

export function maxDebt(sim, nat) { return nat.cells * DEBT_MULT; }
export const inDebt = nat => nat.pool < 0;
// Bir seferde sürebileceğin en yüksek asker: elindeki + borçlanabileceğin.
export function maxCommit(sim, nat) { return nat.pool + maxDebt(sim, nat); }
// Havuza yapılan HER ekleme buradan geçmeli. Ekonomi hızlanınca havuz sürekli
// tavanda duruyor; geri dönen sefer askeri kırpılmazsa tavan aşılıyor.
export function deposit(sim, nat, amount) {
  nat.pool = Math.min(nat.pool + amount, hardCap(sim, nat));
}

export function power(sim, nat) {
  let onFront = 0;
  for (const a of sim.attacks) if (a.from === nat.id) onFront += a.troops;
  return nat.pool + onFront + nat.cells * 0.5;
}

const nbs = (c, out) => {
  const x = c % W;
  out.length = 0;
  if (x > 0) out.push(c - 1);
  if (x < W - 1) out.push(c + 1);
  if (c >= W) out.push(c - W);
  if (c < W * (H - 1)) out.push(c + W);
  return out;
};

// ------------------------------------------------------------------ ittifak

export function formAlliance(sim, a, b) {
  if (a === b || allied(a, b)) return false;
  a.allies.add(b.id); b.allies.add(a.id);
  a.allySince.set(b.id, sim.t); b.allySince.set(a.id, sim.t);
  log(sim, `🤝 ${a.name} ve ${b.name} ittifak kurdu`, 'ally');
  return true;
}

// İttifakı bozan taraf 20 GERÇEK saniye hiçbir yere saldıramaz.
export function breakAlliance(sim, breaker, other) {
  if (!allied(breaker, other)) return false;
  breaker.allies.delete(other.id); other.allies.delete(breaker.id);
  breaker.allySince.delete(other.id); other.allySince.delete(breaker.id);
  breaker.lockUntil = sim.realT + BETRAY_LOCK;
  // İhanet bozanın BÜTÜN seferlerini durdurur — yalnız karşı tarafa olanları
  // değil. (Müttefike zaten saldırılamadığı için "o tarafa süren sefer" hiç
  // var olamaz; kural fiilen "ihanet ettiğin an ordun evine döner"dir.)
  // Kalan asker ve yarım kuşatma bitirSaldiri ile iade edilir.
  for (let i = sim.attacks.length - 1; i >= 0; i--) {
    const at = sim.attacks[i];
    if (at.from === breaker.id) bitirSaldiri(sim, at);   // asker + kuşatma iade
  }
  log(sim, `💔 ${breaker.name} ittifakı bozdu — ${BETRAY_LOCK}sn saldıramaz`, 'betray');
  sim.fx.push({ tip: 'betray', nat: breaker.id });
  return true;
}

// ------------------------------------------------------------------ saldırı

export function canAttack(sim, nat, targetId) {
  if (!nat.alive || locked(sim, nat)) return false;
  if (inDebt(nat)) return false;                  // borç kapanmadan yeni sefer yok
  if (targetId === nat.id) return false;
  if (targetId >= 0 && allied(nat, sim.nations[targetId])) return false;
  return true;
}

// Bir hedefin hücrelerinin TABAN bedeli. Savunanın asker yoğunluğu arttıkça
// pahalanır — oyunun ana gerilim kaynağı bu: büyük ordu iyi savunur.
// Bu değer hedefin tamamı için aynıdır; hücreye özel olan çarpan cellCost'ta.
export function attackCost(sim, targetId) {
  if (targetId < 0) return NEUTRAL_COST;
  return BASE_COST + Math.pow(density(sim.nations[targetId]), DEF_EXP) * DEF_K;
}

// Belirli bir HÜCREYİ almanın bedeli: taban bedel × şehir savunma çarpanı.
// Şehir halkası bedeli 2.8 kata kadar çıkarır, yani zengin bölge aynı zamanda
// sert bölgedir — gelir bedavaya gelmez. Çarpan sahibinden bağımsızdır:
// şehrin surları kimin elindeyse onu korur.
export function cellCost(sim, targetId, cell) {
  return attackCost(sim, targetId) * sim.world.cityDef[cell];
}

// Bir hücre listesinin toplam bedeli — cephe hep bir bütün olarak fiyatlanır.
function ringCost(sim, targetId, cells) {
  const base = attackCost(sim, targetId);
  const cd = sim.world.cityDef;
  let t = 0;
  for (const c of cells) t += base * cd[c];
  return t;
}

// Halkanın ortalama savunma ağırlığı (şehir çarpanı). Dalganın hızı, ilerledikçe
// karşılaştığı halkaların ağırlığını açılıştakine oranlayarak ayarlanır.
function ringWeight(sim, cells) {
  const cd = sim.world.cityDef;
  let t = 0;
  for (const c of cells) t += cd[c];
  return cells.length ? t / cells.length : 1;
}

// Hedefin bize değen bütün hücreleri — cephenin ta kendisi.
function frontOf(sim, nat, targetId) {
  const border = [];
  const tmp = [];
  for (let c = 0; c < W * H; c++) {
    if (sim.owner[c] !== targetId) continue;
    if (targetId < 0 && !sim.world.isLand[c]) continue;
    for (const n of nbs(c, tmp)) {
      if (sim.owner[n] === nat.id) { border.push(c); break; }
    }
  }
  return border;
}

// Bu cepheyi bir hücre içeri itmenin bedeli — yapılabilecek EN KÜÇÜK hamle.
export function frontCost(sim, nat, targetId) {
  if (targetId === nat.id) return 0;
  return ringCost(sim, targetId, frontOf(sim, nat, targetId));
}

// Bütün komşu cepheler, TEK taramada: halkanın bedeli ve kaç hücre olduğu.
// Arayüz bunu her karede sorabilsin diye var — hedef başına ayrı frontCost
// çağırmak haritayı komşu sayısı kadar tarardı.
// Hücre sayısı da dönüyor çünkü hücre bedeli artık cephe boyunca sabit değil:
// "bu asker kaç hücre alır" ancak ORTALAMA birim bedelle söylenebilir.
export function frontStats(sim, nat) {
  const say = new Map();
  const cd = sim.world.cityDef;
  const tmp = [];
  for (let c = 0; c < W * H; c++) {
    const o = sim.owner[c];
    if (o === nat.id) continue;
    if (o < 0 && !sim.world.isLand[c]) continue;
    for (const n of nbs(c, tmp)) {
      if (sim.owner[n] === nat.id) {
        const r = say.get(o) || { hucre: 0, agirlik: 0 };
        r.hucre++; r.agirlik += cd[c];
        say.set(o, r);
        break;
      }
    }
  }
  const out = new Map();
  for (const [id, r] of say) {
    const bedel = r.agirlik * attackCost(sim, id);
    out.set(id, { bedel, hucre: r.hucre, birim: bedel / r.hucre });
  }
  return out;
}

// Yalnız halka bedelleri — çağıranların çoğu bunu istiyor.
export function frontCosts(sim, nat) {
  const out = new Map();
  for (const [id, r] of frontStats(sim, nat)) out.set(id, r.bedel);
  return out;
}

// Cephe HEP tek parça ilerler: hamle tam halkalara yuvarlanır. Yarım halka
// bırakmak sınırı tırtıklı, "nokta nokta" gösteriyordu — oysa halkanın ya
// tamamı düşmeli ya hiçbiri. Yuvarlama kendiliğinden borçlandırmaz: tavanı
// aşan halka sayısı kırpılır. 0 dönerse bir halkaya bile yetmiyordur.
function halkayaYuvarla(halka, istenen, tavan) {
  if (halka <= 0) return istenen;
  if (halka > tavan) return 0;
  let n = Math.max(1, Math.round(istenen / halka));
  while (n > 1 && n * halka > tavan) n--;
  return n * halka;
}

// Dalganın hızı, kalan askerin kaç hücreye yeteceğine göre ayarlanır: cephe
// ölçekten bağımsız olarak hep ~`sure` saniyede akar, yani izlenebilir kalır.
// Takviye geldiğinde de bundan geçilir — cephe hem büyür hem hızlanır.
// `birim` cephenin ORTALAMA hücre bedelidir: şehir halkasından geçen cephede
// hücreler pahalıdır, dolayısıyla aynı askerle daha az hücre alınır ve dalga
// buna göre yavaşlar. Hız ilerlemenin (hücre/sn) hızıdır, harcamanın değil —
// cephe pahalı bölgede de aynı süratle, sadece daha çok asker yakarak akar.
function cepheHizi(targetId, troops, birim) {
  const sure = targetId < 0 ? ATTACK_SECS : WAR_SECS;
  return Math.max(RATE_MIN, (troops / birim) / sure);
}

// Açık cepheye TAKVİYE: gelen asker var olan sefere eklenir ve dalganın hızı
// kalan TOPLAM askere göre yeniden hesaplanır.
//
// Neden ayrı bir sefer nesnesi açmıyoruz: cephe zaten hedefle paylaşılan bütün
// sınır hattı, yani ikinci sefer yeni bir yere yüklenmez — aynı hücrelerin
// `prog`unu paylaşır. İki nesne iki ayrı `yatirim` defteri tutar; biri
// kapanınca ötekinin kuşatma ilerlemesini haritadan siler ama alacağı defterde
// kalır, iadede yoktan asker doğardı (ölçüldü: +128,6). Tek dalga, tek defter.
export function reinforceAttack(sim, nat, atk, troops) {
  if (!canAttack(sim, nat, atk.target)) return null;
  if (sim.attacks.indexOf(atk) < 0 || atk.from !== nat.id) return null;
  troops = Math.min(troops, maxCommit(sim, nat));   // borçlanmaya izin var

  // Halka bedeli CANLI cepheden okunur: sefer ilerledikçe sınır değişir, o
  // yüzden takviye başlangıçtaki değil şu andaki cephe hattına yuvarlanır.
  // Şehir halkasına girmiş bir cephede bu fark büyüktür — aynı hücre sayısı
  // çok daha pahalıya gelir.
  const border = frontOf(sim, nat, atk.target);
  if (!border.length) return null;                  // cephe kapanmış
  const halka = ringCost(sim, atk.target, border);
  troops = halkayaYuvarla(halka, troops, Math.max(nat.pool, troops));
  if (!troops) return null;                         // bir halkaya bile yetmiyor

  nat.pool -= troops;
  atk.troops += troops;
  atk.start += troops;          // ilerleme çubuğu kalan/toplam okur
  atk.rate = cepheHizi(atk.target, atk.troops, halka / border.length);
  // hız CANLI cepheye göre yeniden kuruldu; yavaşlama ölçütü de oraya taşınmalı
  atk.agirlik = ringWeight(sim, border);
  atk.takviye = (atk.takviye || 0) + 1;
  sim.fx.push({ tip: 'attack', nat: nat.id, target: atk.target, takviye: true });
  sim.dirty = true;
  return atk;
}

// Sefere çık. Cephe, hedefle paylaştığın BÜTÜN sınır hattıdır: dalga oradan
// eşit hızda içeri yayılır. Dokunulan hücre yalnızca hedefi seçer.
// O hedefe zaten bir sefer sürüyorsa yenisi açılmaz — takviyeye çevrilir.
export function startAttack(sim, nat, targetId, troops) {
  if (!canAttack(sim, nat, targetId)) return null;
  const acik = sim.attacks.find(a => a.from === nat.id && a.target === targetId);
  if (acik) return reinforceAttack(sim, nat, acik, troops);

  troops = Math.min(troops, maxCommit(sim, nat));   // borçlanmaya izin var

  const border = frontOf(sim, nat, targetId);
  if (!border.length) return null;

  const halka = ringCost(sim, targetId, border);
  troops = halkayaYuvarla(halka, troops, Math.max(nat.pool, troops));
  if (!troops) return null;                       // bir halkaya bile yetmiyor

  const layer = border;
  const inQ = new Set(layer);

  nat.pool -= troops;
  const atk = {
    id: sim.nextAttackId++, from: nat.id, target: targetId,
    troops, start: troops, layer, next: [], inQ,
    rate: cepheHizi(targetId, troops, halka / border.length),
    // açılış halkasının ağırlığı — ilerledikçe karşılaşılan halkalar buna
    // oranlanır, pahalı halkada dalga yavaşlar (şehir cepheyi takar)
    agirlik: ringWeight(sim, border),
    yatirim: 0,       // yarım halkaya yatırılmış, henüz toprağa dönmemiş asker
    takviye: 0,       // cepheye kaç kez takviye gitti
  };
  sim.attacks.push(atk);
  sim.fx.push({ tip: 'attack', nat: nat.id, target: targetId });
  return atk;
}

export function cancelAttack(sim, atk) {
  bitirSaldiri(sim, atk);         // kalan asker ve yarım kuşatma iade edilir
}

// Ulusun ağırlık merkezi — YALNIZ çizim için (etiket ve ölüm efekti buraya
// konur). Her hücre el değiştirişinde O(1) güncellenir: harita taramaya gerek
// yok. Sabit bırakılırsa etiket başlangıç yurdunda çakılı kalıyor ve ulus
// yayılınca toprağının onlarca hücre dışına düşüyordu.
function moveCenter(nat, cell, dir) {
  nat.sumX += (cell % W) * dir;
  nat.sumY += ((cell / W) | 0) * dir;
  if (nat.cells > 0) {
    nat.cx = clamp(Math.round(nat.sumX / nat.cells), 0, W - 1);
    nat.cy = clamp(Math.round(nat.sumY / nat.cells), 0, H - 1);
  }
}

// Hücrede şehir varsa `size`'ı, yoksa 0. Şehir defteri (cityScore) bununla
// O(1) taşınır — el değiştiren her hücrede şehir listesi taranmaz.
function cityOf(sim, cell) {
  const ci = sim.world.cityAt[cell];
  return ci >= 0 ? sim.world.cities[ci].size : 0;
}

function take(sim, cell, nat) {
  if (!sim.world.isLand[cell]) return;      // deniz sahiplenilemez
  const sehir = cityOf(sim, cell);
  const o = sim.owner[cell];
  if (o >= 0) {
    const def = sim.nations[o];
    def.cells--;
    if (sehir) { def.cityScore -= sehir; def.cityCount--; }
    moveCenter(def, cell, -1);
    // Tavan toprağa bağlı: küçülen ulusun askeri de yeni tavana kırpılmalı,
    // yoksa toprak kaybeden bir ulus tavanının üstünde asker taşır.
    if (def.pool > 0) def.pool = Math.min(def.pool, hardCap(sim, def));
    if (def.cells <= 0) kill(sim, def);
    else if (def.cells < minCells(sim)) kill(sim, def, true);
  }
  sim.owner[cell] = nat.id;
  sim.prog[cell] = 0; sim.progBy[cell] = -1;
  sim.lastCapture[cell] = sim.t;
  nat.cells++;
  if (sehir) {
    nat.cityScore += sehir; nat.cityCount++;
    sim.fx.push({ tip: 'city', nat: nat.id, cell, size: sehir });
    log(sim, `🏰 ${nat.name} ${sim.world.cities[sim.world.cityAt[cell]].name} şehrini aldı`, 'city');
  }
  moveCenter(nat, cell, +1);
  sim.dirty = true;
}

// Dağılma eşiği: kıtanın binde 0.8'i, en az 10 hücre.
export const minCells = sim => Math.max(10, Math.round(sim.landCells * MIN_CELLS));

function kill(sim, nat, dagil = false) {
  if (!nat.alive) return;
  nat.alive = false;
  for (const id of nat.allies) {
    sim.nations[id].allies.delete(nat.id);
    sim.nations[id].allySince.delete(nat.id);
  }
  nat.allies.clear(); nat.allySince.clear();
  // Sefer listesinden ham splice DEĞİL: kuşatma izleri temizlensin.
  for (let i = sim.attacks.length - 1; i >= 0; i--)
    if (sim.attacks[i].from === nat.id) bitirSaldiri(sim, sim.attacks[i]);
  if (dagil) {
    // Kalan kırıntı fatihe gitmez, SAHİPSİZ kalır: kimse tıklayamayacak kadar
    // küçük bir lekeyi kovalamak zorunda kalmasın, toprak yeniden yarışa girsin.
    for (let c = 0; c < W * H; c++) {
      if (sim.owner[c] !== nat.id) continue;
      sim.owner[c] = -1;
      sim.prog[c] = 0; sim.progBy[c] = -1;
      sim.lastCapture[c] = sim.t;
    }
    nat.cells = 0;
    nat.pool = 0;
    nat.cityScore = 0; nat.cityCount = 0;   // şehirleri de sahipsiz kaldı
    nat.sumX = 0; nat.sumY = 0;   // cx/cy son gerçek merkezde donar (ölüm efekti oraya)
    sim.dirty = true;
  }
  log(sim, `💀 ${nat.name} ${dagil ? 'dağıldı — toprakları sahipsiz' : 'tarihe karıştı'}`, 'death');
  sim.fx.push({ tip: 'death', nat: nat.id, x: nat.cx, y: nat.cy });
  if (nat.id === sim.playerId) { sim.over = true; sim.won = false; }
}

// Sefer biterken yarım kalan kuşatma İADE edilir: hücreler el değiştirmez,
// biriken ilerleme askere çevrilip garnizona döner. Böylece sınır ya bir
// halka tam ilerler ya hiç — haritada yarım boyalı iz ya da tırtıklı, nokta
// nokta bir cephe kalmaz. (Hamle zaten tam halkalara yuvarlandığı için bu
// yol çoğunlukla yalnız son halkanın artığını toplar.)
// HER sefer buradan kapanmalı: kuşatma izini temizlemeyen bir kapanış haritada
// kalıcı yarım boyalı hücreler bırakır. İndeks dışarıdan alınmaz — take() bir
// ulusu öldürüp araya splice yapabildiği için dışarıdaki indeks bayatlayabilir
// ve yanlış seferi silerdi.
function bitirSaldiri(sim, a) {
  const i = sim.attacks.indexOf(a);
  if (i < 0) return;
  const nat = sim.nations[a.from];
  for (const c of a.layer) {
    if (sim.progBy[c] !== a.from) continue;
    sim.prog[c] = 0; sim.progBy[c] = -1;
  }
  // Yarım halkaya yatırılan asker, ÖDENDİĞİ bedelle geri döner. Bitişteki
  // bedelle hesaplamak yanlıştı: savunan kanadıkça hücre ucuzluyor, iade de
  // sessizce eriyordu.
  if (nat.alive) deposit(sim, nat, Math.max(0, a.troops) + Math.max(0, a.yatirim));
  sim.attacks.splice(i, 1);
  sim.dirty = true;
}

// Süresi dolan ittifaklar kendiliğinden düşer — ihanet değil, sadece bitiş.
function stepAlliances(sim) {
  for (const nat of sim.nations) {
    if (!nat.alive || !nat.allies.size) continue;
    for (const id of [...nat.allies]) {
      const bas = nat.allySince.get(id);
      if (bas === undefined || sim.t - bas < ALLY_SECS) continue;
      const o = sim.nations[id];
      nat.allies.delete(id); nat.allySince.delete(id);
      o.allies.delete(nat.id); o.allySince.delete(nat.id);
      if (nat.id < id) log(sim, `📜 ${nat.name}–${o.name} ittifakının süresi doldu`, 'info');
    }
  }
}

function stepAttacks(sim, dt) {
  const tmp = [];
  // Kopya üzerinden gez: take() bir ulusu öldürebilir, o da o ulusun seferini
  // listeden çıkarır. Ham indeksle dönerken liste bir adımda iki kısalıyor ve
  // döngü dizinin dışına taşıyordu (sim.attacks[i] === undefined).
  for (const a of [...sim.attacks]) {
    if (sim.attacks.indexOf(a) < 0) continue;      // bu kare içinde kapanmış
    const nat = sim.nations[a.from];
    if (!nat.alive) { bitirSaldiri(sim, a); continue; }

    // Bütçe, sıradaki halkanın BÜTÜN hücrelerine eşit dağıtılır: her hücrenin
    // kuşatma İLERLEMESİ aynı anda ve aynı hızda artar. Hücre ancak dolunca
    // el değiştirir, yani sınır her yerde birlikte ilerler — sıra sıra tek
    // hücre düşen "fermuar" görüntüsü yok. Halka dolunca sıradakine geçilir.
    //
    // Bedel artık hücre başına DEĞİŞİR (şehir halkası pahalı). İki kural
    // birlikte tutulmalı:
    //   1. HALKA İÇİNDE ilerleme eşittir — sınır tek parça hareket eder. Bu
    //      oyunun temel hissiyatı, hücre bedeli değiştirmemeli.
    //   2. PAHALI HALKA YAVAŞ ilerler. Bütçeyi salt ilerleme biriminde tutmak
    //      denendi: cephe şehrin üstünden aynı süratle geçiyor, sadece daha çok
    //      asker yakıyordu — yani şehir oyunda GÖRÜNMÜYORDU (10 tohumda ölçüldü,
    //      sahipsiz kalan toprağın savunma çarpanı ortalamanın ancak %1.2
    //      üstündeydi). Şehir bir kaleyse cephe orada takılmalı.
    // İkisini birden veren ölçek: halkanın ortalama bedeli, seferin AÇILDIĞI
    // halkanın ortalamasına oranlanır. İki kat pahalı halka yarı hızla dolar,
    // ama içindeki bütün hücreler yine aynı anda ilerler.
    const base = attackCost(sim, a.target);
    const cd = sim.world.cityDef;
    let butce = a.rate * dt;
    let bitti = false;

    for (let tur = 0; butce > 1e-9 && tur < 64; tur++) {
      const canli = a.layer.filter(c => sim.owner[c] === a.target);
      if (!canli.length) {
        if (!a.next.length) { bitti = true; break; }
        a.layer = a.next; a.next = [];
        continue;
      }
      // başka bir ulusun bıraktığı ilerleme devralınmaz
      for (const c of canli)
        if (sim.progBy[c] !== a.from) { sim.prog[c] = 0; sim.progBy[c] = a.from; }

      // bu halkanın ortalama ağırlığı — sefer açılışındakine oranla hızı belirler
      let agirlik = 0;
      for (const c of canli) agirlik += cd[c];
      const yavaslama = a.agirlik / (agirlik / canli.length);

      // Payın asker maliyeti hücreden hücreye değiştiği için önce ölçülür:
      // sefer bütçesi yetmiyorsa pay orantılı kısılır. (Eskiden tek bir bedel
      // vardı ve bütçe `troops / cost` ile baştan kırpılabiliyordu.)
      let pay = butce * yavaslama / canli.length;
      let maliyet = 0;
      for (const c of canli) maliyet += Math.min(pay, 1 - sim.prog[c]) * base * cd[c];
      if (maliyet > a.troops && maliyet > 0) pay *= a.troops / maliyet;

      let ilerleme = 0, harcanan = 0;
      const dolan = [];
      for (const c of canli) {
        let ek = Math.min(pay, 1 - sim.prog[c]);
        sim.prog[c] += ek;
        // Eşik 1.0 değil 0.999: prog bir Float32Array, tam 1'e oturmayabilir ve
        // hücre hiç düşmezdi. Ama eşiği geçen hücre TAM bedelini ödemeli —
        // yoksa hücre binde bir ucuza kapanır ve her halkada o kadar asker
        // yoktan doğardı (84 hücrelik halkada ölçüldü: +0.4).
        if (sim.prog[c] >= 0.999) {
          ek += 1 - sim.prog[c];              // kalan dilimin bedeli de ödensin
          sim.prog[c] = 1;
          dolan.push(c);
        }
        ilerleme += ek;
        harcanan += ek * base * cd[c];
      }
      // bütçe seferin AÇILIŞ birimindedir; harcanan ilerleme oraya çevrilir
      butce -= ilerleme / yavaslama;
      a.troops -= harcanan;
      a.yatirim += harcanan;
      if (ilerleme > 0) sim.dirty = true;
      // Savunan yalnız HÜCRE KAYBEDİNCE kanar. Kuşatma ilerledikçe kanatmak
      // bedavaya hasar demekti: yarım kalan kuşatma saldırana iade ediliyor
      // ama savunanın kaybı kalıcıydı — art arda ufak dokunuşla bir orduyu
      // hiç toprak almadan eritmek mümkündü.
      let dusenBedel = 0;
      for (const c of dolan) dusenBedel += base * cd[c];
      if (a.target >= 0 && dolan.length) {
        const def = sim.nations[a.target];
        def.pool = Math.max(0, def.pool - dusenBedel * DEF_LOSS);
      }
      a.yatirim = Math.max(0, a.yatirim - dusenBedel);
      for (const c of dolan) {
        take(sim, c, nat);
        a.lastX = c % W; a.lastY = (c / W) | 0;
        for (const n of nbs(c, tmp)) {
          // Deniz asla cepheye girmez. Tarafsız hedefte deniz de owner === -1
          // olduğu için bu kontrol olmazsa dalga okyanusa akar: görünmez
          // hücreler ele geçer, saldırı bütçesi orada erir ve kıyıda başlayan
          // ulus karaya doğru büyüyemez.
          if (!sim.world.isLand[n]) continue;
          if (sim.owner[n] === a.target && !a.inQ.has(n)) { a.inQ.add(n); a.next.push(n); }
        }
      }
      if (!dolan.length) break;         // hiçbir hücre dolmadı, tur ilerlemiyor
    }

    if (bitti || a.troops <= base * 0.01) bitirSaldiri(sim, a);
  }
}

function stepGrowth(sim, dt) {
  sim.tickAcc += dt;
  while (sim.tickAcc >= TICK) {
    sim.tickAcc -= TICK;
    sim.tickNo++;
    const income = sim.tickNo % TICKS_PER_INCOME === 0;

    for (const nat of sim.nations) {
      if (!nat.alive) continue;
      const borcluydu = nat.pool < 0;
      if (borcluydu) {
        nat.pool *= 1 + DEBT_RATE;      // borç kendi faiziyle büyür
      } else {
        nat.pool *= 1 + interestRate(sim, nat);
      }
      if (income) {
        const p = incomePayout(sim, nat);
        nat.pool += p.total;
      }
      if (nat.pool > 0) nat.pool = Math.min(nat.pool, hardCap(sim, nat));
      if (borcluydu && nat.pool >= 0) log(sim, `💰 ${nat.name} borcunu kapattı`, 'info');
    }
    sim.fx.push({ tip: 'tick', income });
    if (sim.fx.length > 200) sim.fx.splice(0, sim.fx.length - 200);
  }
}

// --- gösterge için ---
export const tickProgress = sim => sim.tickAcc / TICK;
export const tickIndex = sim => sim.tickNo % TICKS_PER_INCOME;
export const ticksToIncome = sim => TICKS_PER_INCOME - (sim.tickNo % TICKS_PER_INCOME);
export const secsToIncome = sim => ticksToIncome(sim) * TICK - sim.tickAcc;

// ------------------------------------------------------------------ yapay zekâ

// Komşuları ve tarafsız sınırı örnekle.
function neighbours(sim, nat) {
  const set = new Set();
  const tmp = [];
  for (let c = 0; c < W * H; c += 2) {
    if (sim.owner[c] !== nat.id) continue;
    for (const n of nbs(c, tmp)) {
      if (!sim.world.isLand[n]) continue;
      const o = sim.owner[n];
      if (o !== nat.id) set.add(o);
    }
  }
  return set;
}

function aiThink(sim, nat) {
  const busy = sim.attacks.some(a => a.from === nat.id);
  const nb = neighbours(sim, nat);

  // ittifak: güçlü bir komşuyla anlaş
  if (nat.allies.size < 2 && sim.rnd() < 0.25) {
    for (const id of nb) {
      if (id < 0) continue;
      const o = sim.nations[id];
      if (!o.alive || allied(nat, o)) continue;
      // Lidere yanaşma: onu korumak haritayı kilitliyor.
      if (landFrac(sim, o) >= LEADER_FRAC) continue;
      if (power(sim, o) > power(sim, nat) * 1.3) {
        if (o.id === sim.playerId) sim.playerOffers.add(nat.id);
        else formAlliance(sim, nat, o);
        break;
      }
    }
  }

  if (busy || locked(sim, nat) || nat.pool < softCap(sim, nat) * 0.4) return;

  // hedef: en ucuz komşu. Tarafsız toprak varsa ona öncelik.
  let best = null, bestScore = -Infinity;
  for (const id of nb) {
    if (id >= 0) {
      const o = sim.nations[id];
      if (!o.alive || allied(nat, o)) continue;
      // Kendinden çok güçlüye girme — ama LİDER istisna: kıtanın üçte birini
      // aşan birine herkes yüklenir, yoksa oyun kilitleniyor.
      if (landFrac(sim, o) < LEADER_FRAC && power(sim, o) > power(sim, nat) * 1.5) continue;
    }
    // Asker başına kazanılan toprak. Büyük hedefi kırpma isteği ÇARPAN olarak
    // eklenir — toplama olsaydı bedel ölçeği değiştiğinde terimlerden biri
    // diğerini ezerdi (bedeller büyüyünce YZ boş toprağı görmez olmuştu).
    let score = (id < 0 ? 2.5 : 1) / attackCost(sim, id);
    if (id >= 0) {
      const o = sim.nations[id];
      score *= 1 + landFrac(sim, o) * 1.5;
      // Şehir kuşağını tutan komşu daha çekici: aynı toprak daha çok gelir.
      // Ölçüt ortalamaya GÖRE — mutlak sayı tohumdan tohuma kayıyor. Yalnız
      // yukarı yönlü: şehirsiz komşu cezalandırılmaz, zengin komşu ödüllenir.
      const yogun = (o.cityScore / Math.max(1, o.cells)) / sim.cityYogunluk;
      score *= 1 + clamp(yogun - 1, 0, 2) * nat.cityGreed;
    }
    if (score > bestScore) { bestScore = score; best = id; }
  }
  if (best === null) return;
  // Oyuncu hamlesini istediği kadar ince dileyebilir; YZ dilmez. Cepheyi
  // kapatmayan saldırı sınırı tırtıklaştırıp bir sonrakini pahalandırıyor,
  // savaşlar sonuçsuz kalıyordu. Bu yüzden YZ hep en az BİR HALKALIK asker
  // sürer — yetmiyorsa hiç çıkmaz, birikmeyi bekler. (24 tohumda ölçüldü:
  // hamle payı 0.45'ten 0.85'e çıkınca çözülme 9/24'ten 15/24'e yükseldi.)
  const enAz = frontCost(sim, nat, best);
  const pay = nat.pool * (0.85 + sim.rnd() * 0.15);
  if (enAz > nat.pool) return;
  startAttack(sim, nat, best, Math.max(pay, enAz));
}

// ------------------------------------------------------------------ ana adım

export function step(sim, dt, realDt) {
  if (sim.over) return;
  sim.t += dt;
  sim.realT += realDt;

  stepGrowth(sim, dt);
  stepAlliances(sim);
  stepAttacks(sim, dt);

  for (const nat of sim.nations) {
    if (!nat.alive || !nat.ai) continue;
    if (sim.t - nat.lastThink > 1.8) { nat.lastThink = sim.t; aiThink(sim, nat); }
  }

  if (sim.playerId >= 0) {
    const me = sim.nations[sim.playerId];
    if (me.alive && landFrac(sim, me) >= WIN_FRAC) { sim.over = true; sim.won = true; }
  }
}

export { W, H, S, idx, clamp } from './world.js';
