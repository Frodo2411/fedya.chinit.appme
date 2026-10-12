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
