// Модели только для приложения: телефоны, детали к которым есть у поставщиков, а на сайте их нет.
// [бренд, модель, год выхода, [другие названия у поставщиков]]. Год нужен для коэффициента новизны.
// Название модели должно совпадать с тем, как её пишут поставщики (регистр и «4G» не важны), иначе — в другие названия.

export const APP_MODELS = [
  ['Google', 'Google Pixel 3', 2018], ['Google', 'Google Pixel 3 XL', 2018],
  ['Google', 'Google Pixel 3a', 2019], ['Google', 'Google Pixel 3a XL', 2019],
  ['Google', 'Google Pixel 4', 2019], ['Google', 'Google Pixel 4 XL', 2019],
  ['Google', 'Google Pixel 4a', 2020], ['Google', 'Google Pixel 4a 5G', 2020], ['Google', 'Google Pixel 5', 2020],
  ['Google', 'Google Pixel 5a', 2021], ['Google', 'Google Pixel 6', 2021], ['Google', 'Google Pixel 6 Pro', 2021],
  ['Google', 'Google Pixel 6a', 2022], ['Google', 'Google Pixel 7', 2022], ['Google', 'Google Pixel 7 Pro', 2022],
  ['Google', 'Google Pixel 7a', 2023], ['Google', 'Google Pixel 8', 2023], ['Google', 'Google Pixel 8 Pro', 2023],
  ['Google', 'Google Pixel 8a', 2024], ['Google', 'Google Pixel 9', 2024], ['Google', 'Google Pixel 9 Pro', 2024],
  ['Google', 'Google Pixel 9 Pro XL', 2024], ['Google', 'Google Pixel 9a', 2025],
  ['Google', 'Google Pixel 10', 2025], ['Google', 'Google Pixel 10 Pro', 2025], ['Google', 'Google Pixel 10 Pro XL', 2025],
  ['Google', 'Google Pixel 10a', 2026],
];

// Другие названия моделей сайта у поставщиков: [как пишет поставщик, модель сайта]
export const SITE_ALIASES = [
  ['iPhone SE 2 2020', 'iPhone SE 2020'], ['iPhone SE 3 2022', 'iPhone SE 2022'],
  ['Xiaomi Pocophone F1', 'Poco F1'], ['Xiaomi Poco Pocophone F1', 'Poco F1'], ['Xiaomi Poco Redmi Note 12', 'Redmi Note 12'],
  ['Xiaomi Redmi 13С', 'Redmi 13C'], // «С» русская
  ['Realme GT Master Edition', 'Realme GT Master'],
  ['Huawei Honor P30 Lite', 'Huawei P30 lite'], ['Huawei Honor P40 Lite', 'Huawei P40 lite'], ['Huawei Honor Mate 20 Lite', 'Huawei Mate 20 lite'],
  ['Huawei Honor Pura P 70', 'Huawei Pura 70'], ['Huawei Honor Pura P 70 Pro', 'Huawei Pura 70 Pro'], ['Huawei Honor 9X Premium', 'Honor 9X'],
  // коды Samsung вместо названия: SM-A356B — это A35
  ['Samsung A356F', 'Samsung Galaxy A35'], ['Samsung A356B', 'Samsung Galaxy A35'], ['Samsung A546B', 'Samsung Galaxy A54'],
  ['Samsung A256B', 'Samsung Galaxy A25'], ['Samsung A556B', 'Samsung Galaxy A55'], ['Samsung A27 5G', 'Samsung Galaxy A27'],
];
