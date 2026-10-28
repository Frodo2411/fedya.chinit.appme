// Пояснения к названию детали — для мастера, клиенту не показываем: что значат слова поставщика
// (Hard/Soft OLED, площадка под IC, переклей…) и что будет на этой модели («Неизвестная деталь», 60/120 Гц).
// Ответ — [{ tag, text, warn }]: tag — коротко для списка «Все детали», text — пояснение, warn — на что обратить внимание.
// Это типичные свойства таких деталей; конкретная партия у поставщика может отличаться.

const iphoneGen = (model) => {
  const m = /^iPhone (\d+)/.exec(model || '');
  return m ? Number(m[1]) : null;
};
// У каких айфонов оригинальный экран OLED (у остальных — ЖК)
const OLED_IPHONE = /^iPhone (X|XS|XS Max|11 Pro|11 Pro Max|Air)$|^iPhone (1[2-9])(?! SE)/;
// ProMotion 120 Гц
const PROMOTION = /^iPhone (1[3-6] Pro( Max)?|17( Pro( Max)?)?|Air|18 Pro( Max)?)$/;
// «Неизвестная деталь» за неоригинальный дисплей — с iPhone 11, за аккумулятор — с XR/XS и SE 2020, за камеру — с 12
const displayMessage = (model) => (iphoneGen(model) || 0) >= 11;
const batteryMessage = (model) => /^iPhone (XR|XS|XS Max|SE 2020|SE 2022)$/.test(model || '') || (iphoneGen(model) || 0) >= 11 || /^iPhone (Air|16e|17e)$/.test(model || '');
const cameraMessage = (model) => (iphoneGen(model) || 0) >= 12 || /^iPhone (Air|16e|17e)$/.test(model || '');

// «Оригинал» в названии копии: у поставщика это уровень качества или марка, а не деталь производителя телефона
const ORIG_WORD = /оригинал|original|\borig\b/i;
const ORIG_REAL = /100\s*%|сервис|service|снят|разбор|переклей|(?<![а-яё])реф(?![а-яё])/i;

const IC = /площадк[а-яёa-z]*\s+под\s+IC|под\s+IC\b|movable\s*IC|перенос[а-яёa-z]*\s+(?:микросхем|IC)/i;
const VERIFIED = /верификац|с\s+привязкой|без\s+ошибки|genuine|подлинн|новая\s+запчасть/i;
// «без верификации», «без привязки» — наоборот
const NOT_VERIFIED = /без\s+(?:привязк|верификац)/i;
const verified = (n) => VERIFIED.test(n) && !NOT_VERIFIED.test(n);

function displayNotes(n, model, tier, out) {
  const add = (tag, text, warn) => out.push({ tag, text, warn: !!warn });
  const copy = String(tier || '').startsWith('copy');
  // матрица
  if (/soft\s*(?:oled|touch)/i.test(n)) add('Soft OLED', 'гибкая матрица, как в оригинале: тонкая, рамки как у оригинала, цвета и яркость ближе к нему');
  else if (/hard\s*(?:oled|touch)/i.test(n)) add('Hard OLED', 'жёсткая матрица: модуль толще, нижняя рамка заметно шире, яркость ниже, при падении бьётся легче; цвета и чёрный — как у OLED, лучше ЖК');
  else if (/\bfog\b|orig\s*tech/i.test(n)) add('FOG / Orig Tech', 'копия «под оригинал»; Hard это или Soft, в названии не сказано — уточнить у поставщика');
  else if (/in-?cell|incell|\btft\b|\bltps\b/i.test(n) || (copy && tier === 'copy_lcd' && !ORIG_WORD.test(n))) {
    add('ЖК', 'самая дешёвая копия: цвета бледнее, чёрный сероватый, экран толще, батарею ест больше'
      + (OLED_IPHONE.test(model || '') ? '; у оригинала OLED — разница заметна' : ''));
  } else if (copy && /\boled\b|amoled/i.test(n)) add('OLED', 'Hard или Soft — в названии не сказано, уточнить у поставщика');
  // разрешение
  if (/hd\s*plus|hd\+/i.test(n)) add('HD Plus', 'разрешение ниже: текст и мелкие детали мягче, чем у Full HD');
  else if (/full\s*hd|\bfhd\b/i.test(n)) add('Full HD', 'разрешение выше, чем у HD Plus, — чётче');
  else if (/\bHD\b/.test(n)) add('HD', 'разрешение низкое: текст мягче');
  // частота: у моделей с ProMotion 60 Гц — меньше, чем у оригинала; у остальных экран 60 Гц,
  // а «120 Гц» поставщики пишут у них массово — обычно это про отклик тача
  const hz = /(\d{2,3})\s*(?:гц|hz)/i.exec(n);
  if (hz && model && model.startsWith('iPhone')) {
    const f = Number(hz[1]);
    if (PROMOTION.test(model)) {
      if (f <= 60) add('60 Гц', 'у оригинала 120 Гц: прокрутка будет менее плавной', true);
      else if (f >= 120) add('120 Гц', 'как у оригинала');
    } else if (f >= 120) add('120 Гц', 'экран у этой модели 60 Гц; «120 Гц» поставщики обычно пишут про отклик тача — как у оригинала');
  }
  // микросхема дисплея: «Неизвестная деталь» и True Tone
  if (IC.test(n)) add('площадка под IC', 'можно перепаять микросхему со старого дисплея: не будет «Неизвестной детали», останется True Tone (нужна пайка)');
  if (verified(n)) add('с верификацией', 'по словам поставщика — без «Неизвестной детали»; часто для этого нужен программатор (JCID/JC) — уточнить');
  if (copy && !IC.test(n) && !verified(n) && displayMessage(model)) {
    add('будет «Неизвестная деталь»', 'без площадки под IC и без верификации: в настройках будет сообщение о неоригинальном дисплее, True Tone не будет', true);
  }
  // оригиналы
  // «(матрица orig)» пишут и у новых, и у переклеенных, и у снятых; без уточнения непонятно, что это
  if (/матриц[а-яёa-z]*\s+orig|orig[а-яёa-z]*\s+матриц/i.test(n) && !/нов|переклей|заменен|снят|полирован|разбор/i.test(n)) {
    add('матрица orig', 'оригинальная матрица, но новый это оригинал или переклей (новое стекло), в названии не сказано — уточнить у поставщика', true);
  } else if (/заменено\s+стекло\s+и\s+тач/i.test(n)) add('переклей: стекло и тач', 'оригинальная матрица, стекло и тач заменены — тач не родной, чувствительность может отличаться');
  else if (/заменено\s+только\s+стекло/i.test(n)) add('переклей: только стекло', 'оригинальная матрица и родной тач, заменено только стекло — лучший переклей');
  else if (tier === 'orig_reglass') add('переклей', 'оригинальная матрица с новым стеклом');
  if (tier === 'orig_used' && !/полирован/i.test(n)) add('снятый', 'оригинал с другого телефона: проверить на выгорание, полосы и пятна');
  if (/полирован/i.test(n)) add('полированный', 'снятый оригинал, стекло отполировано от царапин');
  if (/service\s*pack|\(SP\)(?!\s*=)/i.test(n)) add('Service Pack', 'новый оригинал из сервисного комплекта');
  if (/\bOR100\b/.test(n)) add('OR100', 'несмотря на «OR», это копия');
  if (/в\s+рамке|с\s+рамкой|with\s+frame/i.test(n)) add('в рамке', 'дисплей уже вклеен в рамку: ставить проще');
  // фабрика
  if (/\bJCID\b/.test(n)) add('JCID', 'делают и программаторы JC: «верификация» у них обычно через программатор');
  else if (/\bDD\b/.test(n)) add('DD', 'бюджетная фабрика');
  else if (/\bGX\b/.test(n)) add('GX', 'фабрика, копии у неё обычно получше среднего');
}

function batteryNotes(n, model, tier, out) {
  const add = (tag, text, warn) => out.push({ tag, text, warn: !!warn });
  const mah = /(\d{3,5})\s*mAh/i.exec(n);
  if (/усилен|повышенн[а-яёa-z]*\s+[её]мк/i.test(n)) add('усиленная', 'ёмкость больше заводской — держит дольше; реальную ёмкость проверить после установки');
  if (mah) add(mah[1] + ' мА·ч', 'ёмкость по словам поставщика');
  const used = /original|разбор|снят/i.test(n);
  // «подлинная деталь» — без ошибки; «с верификацией», «с привязкой», «без ошибки» — процент износа виден, «Неизвестная деталь» остаётся
  const genuine = verified(n) && !used && /genuine|подлинн|зел[её]н\S*\s+галочк|новая\s+запчасть/i.test(n);
  const bound = verified(n) && !used && !genuine;
  const ok = genuine || bound;
  if (genuine) add('без ошибки', 'в настройках как оригинальная: без «Неизвестной детали», процент износа виден');
  if (bound) add('с процентом износа', 'процент износа в настройках будет виден, но отметка «Неизвестная деталь» останется' + (batteryMessage(model) ? '' : ' (на этой модели её и так нет)'), batteryMessage(model));
  if (tier === 'orig_used') add('снятый', 'оригинал с другого телефона: ёмкость проверить (от 95%)');
  if (/\bOR100\b/.test(n)) add('OR100', 'несмотря на «OR», это копия');
  if (!ok && tier !== 'orig_new' && tier !== 'verified' && tier !== 'genuine' && batteryMessage(model)) {
    add('будет «Неизвестная деталь»', 'на этой модели неоригинальный аккумулятор покажет сообщение, а процент износа видно не будет; на работу не влияет', true);
  }
}

function coverNotes(n, out) {
  const add = (tag, text) => out.push({ tag, text, warn: false });
  if (/стекл[а-яёa-z]*\s+камер/i.test(n)) add('со стеклом камеры', 'стекло камеры уже стоит');
  if (/magsafe|магнит/i.test(n)) add('MagSafe', 'магниты MagSafe уже на крышке');
  if (/\bnfc\b/i.test(n)) add('NFC', 'антенна NFC уже на крышке');
  if (/широк[а-яёa-z]*\s+(?:вырез|отверст)/i.test(n)) add('широкий вырез', 'под замену стекла лазером, рамка камеры остаётся старая');
}

function housingNotes(n, out) {
  const add = (tag, text) => out.push({ tag, text, warn: false });
  if (/в\s+сборе|со\s+шлейф/i.test(n)) add('в сборе', 'шлейфы и кнопки уже стоят — переносить меньше');
  if (/\+\s*стекло|со\s+стеклом/i.test(n)) add('со стеклом', 'заднее стекло уже вклеено');
}

export function partNotes(name, svc, model, tier) {
  const n = String(name || '');
  const out = [];
  if (svc === 'd') displayNotes(n, model, tier, out);
  else if (svc === 'b') batteryNotes(n, model, tier, out);
  else if (svc === 'c') coverNotes(n, out);
  else if (svc === 'hs') housingNotes(n, out);
  else if ((svc === 'cr' || svc === 'cf') && String(tier || '').startsWith('copy') && cameraMessage(model)) {
    out.push({ tag: 'будет «Неизвестная деталь»', text: 'на этой модели после замены камеры на неоригинальную будет сообщение в настройках', warn: true });
  }
  // для любых деталей
  if ((String(tier || '').startsWith('copy') || tier === 'verified' || tier === 'genuine') && ORIG_WORD.test(n) && !ORIG_REAL.test(n)) {
    out.unshift({ tag: '«оригинал» — не деталь производителя', text: 'так у поставщика назван уровень качества копии (или марка); клиенту это копия', warn: false });
  }
  if (/премиум|premium|high\s*quality/i.test(n)) out.push({ tag: 'премиум', text: 'лучшая копия у этого поставщика (общего стандарта нет)', warn: false });
  const order = /под\s+заказ(?:\s+до\s+(\d+)\s*дн)?/i.exec(n);
  if (order) out.push({ tag: 'под заказ', text: 'не на складе' + (order[1] ? ', срок до ' + order[1] + ' дн.' : ', срок уточнить'), warn: true });
  const life = /пожизненн[а-яёa-z]*\s+гарант/i.test(n);
  const years = /гарант[а-яёa-z]*\s+(\d+)\s*(год|мес)/i.exec(n);
  if (life) out.push({ tag: 'пожизненная гарантия', text: 'гарантия поставщика — пожизненная', warn: false });
  else if (years) out.push({ tag: 'гарантия ' + years[1] + ' ' + years[2], text: 'гарантия поставщика', warn: false });
  return out;
}
