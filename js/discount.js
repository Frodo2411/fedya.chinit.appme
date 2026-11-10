// Скидка в заказе и скидка дня (акция).
// Цена заказа в таблице («Цена для клиента») — уже со скидкой: прибыль, «к оплате» и итоги считаются как обычно.
// Сколько было без скидки и какой процент — запись в комментарии заказа, как запись о скидке за комплекс:
// «Скидка 11.11 −20%: было 125 р., стало 100 р.». По ней заказ открывается со скидкой, а «Итоги» знают, сколько
// отдано скидками. Скрипт таблицы для этого обновлять не нужно.
// Скидка дня — в настройках (promo): { on, pct, name, from, to }, даты 'YYYY-MM-DD', «по» включительно, без «по» — один день.

const toNum = (s) => Number(String(s).replace(',', '.'));
const numText = (x) => String(Math.round(Number(x) * 100) / 100).replace('.', ',');

// Цена со скидкой pct %: вниз до рубля — клиент получает не меньше обещанного процента
export function discounted(base, pct) {
  const kop = Math.round(Number(base) * 100);
  return Math.floor((kop * (100 - pct)) / 10000 + 1e-9);
}

// Название акции («11.11»): без двоеточий и переносов строк — по ним запись о скидке читается обратно
export function promoName(s) {
  return String(s || '').replace(/[:\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

// «Скидка 11.11 −20%»
export function discountLabel(d) {
  const name = promoName(d.name);
  return 'Скидка' + (name ? ' ' + name : '') + ' −' + numText(d.pct) + '%';
}

// Запись о скидке для комментария заказа. d — { name, pct, base }, price — цена со скидкой
export function discountNote(d, price) {
  return discountLabel(d) + ': было ' + numText(d.base) + ' р., стало ' + numText(price) + ' р.';
}

const NOTE = /(^|\s)Скидка(?:\s+([^:\n]*?))?\s+[−-]\s?(\d+(?:[.,]\d+)?)\s?%:\s*было\s+(\d+(?:[.,]\d+)?)\s*р\.,\s*стало\s+(\d+(?:[.,]\d+)?)\s*р\./;

// Запись о скидке в комментарии: что в ней и где она стоит. Запись о скидке за комплекс («…скидка за комплекс 20% на
// работу: −10 р.») — не она
export function parseDiscount(comment) {
  const m = NOTE.exec(String(comment ?? ''));
  if (!m) return null;
  return { name: m[2] || '', pct: toNum(m[3]), base: toNum(m[4]), price: toNum(m[5]), at: m.index + m[1].length, end: m.index + m[0].length };
}

// Скидка записанного заказа: { name, pct, base } — если запись в комментарии есть и цена заказа та же, что в ней.
// Цену потом поправили вручную — запись устарела, заказ считается без скидки
export function orderDiscount(o) {
  const d = o ? parseDiscount(o.comment) : null;
  if (!d || !(d.pct > 0) || !(d.base > d.price)) return null;
  if (o.price === null || o.price === undefined || o.price === '' || Math.abs(toNum(o.price) - d.price) > 0.005) return null;
  return { name: d.name, pct: d.pct, base: d.base };
}

// Комментарий с записью о скидке: прежняя запись меняется на месте, новая встаёт в начало; note пустая — запись убирается
export function setDiscountNote(comment, note) {
  const text = String(comment ?? '');
  const d = parseDiscount(text);
  if (!d) return note ? (text.trim() ? note + ' ' + text.trim() : note) : text;
  if (note) return text.slice(0, d.at) + note + text.slice(d.end);
  return [text.slice(0, d.at).trim(), text.slice(d.end).trim()].filter(Boolean).join(' ');
}

// Последний день скидки дня
export function promoEnd(promo) {
  return promo.to && promo.to >= promo.from ? promo.to : promo.from;
}

// Скидка дня идёт в этот день: включена, процент от 1 до 99 и день выбран
export function promoActive(promo, day) {
  if (!promo || !promo.on || !(promo.pct > 0 && promo.pct < 100) || !promo.from) return false;
  return day >= promo.from && day <= promoEnd(promo);
}

// Для текста клиенту: «со скидкой 20% по акции «11.11»»
export function promoWords(promo) {
  const name = promoName(promo.name);
  return 'со скидкой ' + numText(promo.pct) + '%' + (name ? ' по акции «' + name + '»' : '');
}
