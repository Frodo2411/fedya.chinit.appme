// Экран «Ещё»: прайсы, расчёт цены, текст для клиента, поставщики, Google Таблица, приложение.

import { h, fill, toast, openSheet, field, parseNum, fmtDate, shareFile, copyText } from './ui.js';
import { DEFAULTS, SERVICES, MORE_SERVICES, settingsWithDefaults, siteFile } from './engine.js';
import { SVC } from './view-prices.js';
import { openImport } from './import-flow.js';
import { monthTitle } from './ui.js';

export const APP_VERSION = '1.0.0';

export function createMoreView(app) {
  const root = h('div');

  function filePicker(supKey) {
    const input = h('input', {
      type: 'file', accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv', hidden: true,
      onchange: () => { const f = input.files[0]; input.value = ''; if (f) openImport(app, supKey, f); },
    });
    return input;
  }

  function draw() {
    const sups = Object.entries(app.data.suppliers).sort((a, b) => (a[1].rank ?? 9) - (b[1].rank ?? 9)).reverse();
    const pickers = Object.fromEntries(sups.map(([k]) => [k, filePicker(k)]));
    const hist = (app.data.history || []).slice(-6).reverse();
    fill(root, 
      h('h1', { text: 'Ещё' }),

      h('div', { class: 'card' },
        h('h3', { text: 'Прайсы поставщиков' }),
        h('div', { class: 'small muted', text: 'Раз в месяц загрузи свежие файлы: приложение само сопоставит позиции и покажет, что изменится.' }),
        sups.map(([k, s]) => h('div', { class: 'row', style: 'margin-top:12px' },
          h('div', { class: 'grow' }, h('b', { text: s.name }), h('div', { class: 'tiny muted', text: 'от ' + fmtDate(s.date || app.data.priceDate) + (s.stock ? '' : ' · без наличия') })),
          pickers[k], h('button', { class: 'btn small', text: 'Загрузить', onclick: () => pickers[k].click() }))),
        hist.length ? h('div', { class: 'tiny faint', style: 'margin-top:12px' }, 'Обновления: ',
          hist.map((x) => fmtDate(x.date) + ' ' + ((app.data.suppliers[x.sup] || {}).name || x.sup) + ' (новых ' + x.fresh + ', пропало ' + x.gone + ')').join('; ')) : null,
        h('div', { class: 'row wrap', style: 'margin-top:14px' },
          app.hasPrevData() ? h('button', { class: 'btn small', text: 'Вернуть прошлые прайсы', onclick: () => app.restorePrevData() }) : null,
          h('button', { class: 'btn small', text: 'Файл цен для сайта', onclick: () => exportSite() }))),

      h('div', { class: 'card' },
        h('h3', { text: 'Расчёт цены' }),
        h('div', { class: 'small muted', text: 'Ставки за работу, коэффициенты, налог и правило SmartFix.' }),
        h('button', { class: 'btn small', style: 'margin-top:12px', text: 'Открыть настройки расчёта', onclick: () => openFormula(app) })),

      h('div', { class: 'card' },
        h('h3', { text: 'Текст для клиента' }),
        field('Строка в конце', h('textarea', { class: 'input', value: app.settings.clientFooter || '', onchange: (e) => app.saveSettings({ clientFooter: e.target.value }, { redraw: false }) })),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: app.settings.clientHints !== false, onchange: (e) => app.saveSettings({ clientHints: e.target.checked }, { redraw: false }) }),
          'Пояснять варианты («цвета и яркость ближе к оригиналу»)')),

      h('div', { class: 'card' },
        h('h3', { text: 'Как заказывать у поставщиков' }),
        h('div', { class: 'small muted', text: 'Сайт, бот, телефон, срок доставки. Покажу под деталью.' }),
        sups.map(([k, s]) => {
          const site = s.site || ((app.repoData && app.repoData.suppliers[k]) || {}).site;
          return h('div', {},
            field(s.name, h('textarea', {
              class: 'input', value: (app.settings.supplierNotes || {})[k] || '', placeholder: 'Например: Telegram-бот @…, доставка завтра, от 50 р.',
              onchange: (e) => app.saveSettings({ supplierNotes: { ...(app.settings.supplierNotes || {}), [k]: e.target.value } }, { redraw: false }),
            })),
            site ? h('a', { class: 'small', style: 'display:inline-block;margin-top:6px', href: site, target: '_blank', rel: 'noopener', text: 'Сайт: ' + site.replace(/^https?:\/\//, '').replace(/\/$/, '') }) : null);
        })),

      h('div', { class: 'card' },
        h('h3', { text: 'Google Таблица' }),
        h('div', { class: 'small muted', text: app.sheet.connected ? 'Подключена' + (app.sheet.cache && app.sheet.cache.title ? ': ' + app.sheet.cache.title : '') + '. Заказы и расходы пишутся в неё.' : 'Не подключена. Журнал заказов и итоги появятся после подключения.' }),
        h('button', { class: 'btn small', style: 'margin-top:12px', text: app.sheet.connected ? 'Настройки подключения' : 'Подключить', onclick: () => app.openSheetSetup() })),

      h('div', { class: 'card' },
        h('h3', { text: 'Приложение' }),
        h('div', { class: 'small muted', text: 'Версия ' + APP_VERSION + '. Данные прайса от ' + fmtDate(app.data.priceDate) + ', SmartFix от ' + fmtDate(app.data.sfDate) + '.' }),
        h('div', { class: 'row wrap', style: 'margin-top:12px' },
          h('button', { class: 'btn small', text: 'Проверить обновление', onclick: () => app.checkUpdate() }),
          h('button', { class: 'btn small danger', text: 'Забыть пароль', onclick: () => { if (confirm('Выйти? Пароль придётся ввести заново.')) app.logout(); } }))),
    );
  }

  async function exportSite() {
    const d = new Date();
    const text = siteFile(app.pricer, monthTitle(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')));
    await shareFile('prices-models.js', text, 'text/javascript');
    toast('Файл prices-models.js готов: в нём только цены клиенту');
  }

  return { el: root, draw };
}

function openFormula(app) {
  const S = settingsWithDefaults(app.settings.formula);
  const num = (v, label, set, opts = {}) => field(label, h('input', {
    class: 'input num', inputmode: 'decimal', value: String(v).replace('.', ','),
    oninput: (e) => { const n = parseNum(e.target.value); if (n !== null) set(opts.pct ? n / 100 : n); },
  }));
  const tableRows = (rows, labelA, labelB) => rows.map((r, i) => h('div', { class: 'grid2' },
    num(r[0], i ? '' : labelA, (n) => { r[0] = n; }), num(r[1], i ? '' : labelB, (n) => { r[1] = n; })));
  const body = h('div', {},
    h('h3', { style: 'margin-top:8px', text: 'Работа (база), р.' }),
    h('div', { class: 'grid2' }, SERVICES.map((svc) => num(S.base[svc], SVC[svc], (n) => { S.base[svc] = n; }))),
    h('div', { class: 'tiny faint', style: 'margin-top:6px', text: 'Работа для камер, динамиков, шлейфов, корпуса и других новых ремонтов подобрана по прайсам сервисов Минска (октябрь 2026). Если цена не нравится — поправь здесь.' }),
    h('div', { class: 'grid2' },
      num(S.min_work, 'Минимум за работу, р.', (n) => { S.min_work = n; }),
      num(S.round, 'Округлять до, р.', (n) => { S.round = n; })),
    h('h3', { style: 'margin-top:20px', text: 'Свой минимум за работу' }),
    h('div', { class: 'tiny faint', style: 'margin-bottom:6px', text: 'Для лёгких ремонтов (SIM-лоток, стекло камеры, динамики) общий минимум делает цену выше рынка. Пусто — общий минимум.' }),
    h('div', { class: 'grid2' }, MORE_SERVICES.map((svc) => field(SVC[svc], h('input', {
      class: 'input num', inputmode: 'decimal', placeholder: String(S.min_work), value: S.min_svc[svc] == null ? '' : String(S.min_svc[svc]).replace('.', ','),
      // пусто — общий минимум: храним null, иначе при чтении настроек вернётся значение по умолчанию
      oninput: (e) => { S.min_svc[svc] = parseNum(e.target.value); },
    })))),
    h('div', { class: 'grid2' },
      num(Math.round(S.tax * 1000) / 10, 'Налог в цене, %', (n) => { S.tax = n; }, { pct: true }),
      field('Текущий год', h('input', { class: 'input num', inputmode: 'numeric', placeholder: 'сам', value: S.year || '', oninput: (e) => { S.year = parseNum(e.target.value) || 0; } }))),
    h('h3', { style: 'margin-top:20px', text: 'SmartFix' }),
    h('div', { class: 'grid2' },
      num(S.sf_offset, 'Ниже их цены на, р.', (n) => { S.sf_offset = n; }),
      num(Math.round(S.sf_floor_share * 100), 'Не дешевле, % их цены', (n) => { S.sf_floor_share = n; }, { pct: true })),
    h('div', { class: 'tiny faint', style: 'margin-top:6px', text: 'Цена ставится на 5–9 р. ниже SmartFix, но не ниже указанной доли их цены и не ниже, чем деталь плюс минимальная работа с налогом.' }),
    h('h3', { style: 'margin-top:20px', text: 'Сложность по iFixit' }),
    tableRows(S.diff, 'Оценка от', 'Коэффициент'),
    num(S.diff_default, 'Нет оценки iFixit — коэффициент', (n) => { S.diff_default = n; }),
    h('h3', { style: 'margin-top:20px', text: 'Новизна модели' }),
    tableRows(S.novelty, 'Возраст от, лет', 'Коэффициент'),
    h('h3', { style: 'margin-top:20px', text: 'Проклейка' }),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: S.glue, onchange: (e) => { S.glue = e.target.checked; } }),
      'Учитывать проклейку в заработке и в заказе'),
    num(S.glue_default, 'Если своей проклейки нет в прайсе, р.', (n) => { S.glue_default = n; }),
    h('div', { class: 'tiny faint', style: 'margin-top:6px', text: 'На цену клиенту не влияет. Дисплей, стекло экрана и тачскрин — проклейка дисплея, крышка — задней крышки, аккумулятор — батареи и стороны вскрытия, корпус — дисплея, батареи и стороны вскрытия, стекло камеры и SIM-лоток — без проклейки, остальное — стороны вскрытия. Айфоны из списка ниже и почти все Android вскрываются сзади, остальные айфоны и большинство Pixel — через дисплей. Берётся самая дешёвая в наличии, набор «(5шт)» — за штуку.' }),
    h('h3', { style: 'margin-top:20px', text: 'Задняя крышка iPhone' }),
    field('Модели без лазера, по одной в строке', h('textarea', { class: 'input', style: 'min-height:160px', value: S.no_laser.join('\n'), oninput: (e) => { S.no_laser = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); } })),
  );
  const sheet = openSheet('Расчёт цены', body, [
    h('button', { class: 'btn', text: 'Как было', onclick: () => { if (confirm('Вернуть все числа как было изначально?')) { app.saveSettings({ formula: null }); sheet.close(); toast('Настройки сброшены'); } } }),
    h('button', {
      class: 'btn primary', text: 'Сохранить',
      onclick: () => {
        S.diff.sort((a, b) => a[0] - b[0]);
        S.novelty.sort((a, b) => a[0] - b[0]);
        if (!(S.tax >= 0 && S.tax < 0.9) || !(S.round > 0)) { toast('Проверь налог и округление'); return; }
        const diff = {};
        for (const k of Object.keys(DEFAULTS)) if (JSON.stringify(S[k]) !== JSON.stringify(DEFAULTS[k])) diff[k] = S[k];
        app.saveSettings({ formula: Object.keys(diff).length ? diff : null });
        sheet.close();
        toast('Цены пересчитаны');
      },
    }),
  ]);
}

// Подключение Google Таблицы
export function openSheetSetup(app) {
  const urlInput = h('input', { class: 'input', type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', value: (app.sheet.cfg && app.sheet.cfg.url) || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const status = h('div', { class: 'small', style: 'margin-top:10px;min-height:22px' });
  // Код загружаем заранее: на айфоне копировать можно только сразу в обработчике нажатия, без ожидания сети
  let code = null;
  const copyBtn = h('button', { class: 'btn small primary', text: 'Загружаю код…', disabled: true });
  app.scriptCode().then((c) => { code = c; copyBtn.disabled = false; copyBtn.textContent = 'Скопировать код скрипта'; })
    .catch((e) => { copyBtn.textContent = 'Код не загрузился'; toast(e.message, 4000); });
  copyBtn.onclick = async () => {
    if (code && await copyText(code)) toast('Код скрипта скопирован');
    else toast('Не получилось скопировать', 4000);
  };
  const connect = async () => {
    const url = urlInput.value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { status.textContent = 'Нужен адрес веб-приложения: начинается с https://script.google.com/'; return; }
    fill(status, h('span', { class: 'spin' }), ' Проверяю…');
    try {
      const cfg = { url, key: await app.sheetKey() };
      const info = await app.sheet.call('ping', {}, cfg);
      app.sheet.configure(cfg);
      await app.sheet.load();
      status.textContent = 'Подключено: ' + info.title;
      toast('Таблица подключена');
      app.afterSheetConnected();
      app.redraw();
    } catch (e) {
      fill(status, h('div', { style: 'color:var(--bad)', text: e.message }), e.network ? diagnose(url) : null);
    }
  };
  // Что делать, если скрипт не отвечает: открыть его адрес и посмотреть, что покажет Google
  const diagnose = (url) => h('div', { class: 'card', style: 'margin-top:12px' },
    h('div', { class: 'small', text: 'Открой адрес скрипта в новой вкладке и посмотри, что покажет Google:' }),
    h('a', { class: 'btn small primary', style: 'margin-top:10px', href: url, target: '_blank', rel: 'noopener', text: 'Открыть адрес скрипта' }),
    h('ul', { class: 'small', style: 'padding-left:18px;margin:12px 0 0' },
      h('li', {}, h('b', { text: 'Вход в Google или «нет доступа»' }), ' — доступ выбран не тот. Развертывание → Управление развертываниями → карандаш → «У кого есть доступ»: ',
        h('b', { text: '«Все»' }), ' (не «Все, у кого есть аккаунт Google») → Развернуть.'),
      h('li', { style: 'margin-top:8px' }, h('b', { text: '«Функция скрипта не найдена: doGet»' }), ' — код не был сохранён перед развертыванием. Вставь код, нажми «Сохранить» (значок дискеты), затем Управление развертываниями → карандаш → Версия: ',
        h('b', { text: '«Новая версия»' }), ' → Развернуть. Адрес останется тем же.'),
      h('li', { style: 'margin-top:8px' }, h('b', { text: '«Требуется авторизация»' }), ' — в редакторе скрипта выбери функцию doGet, нажми «Выполнить» и разреши доступ. Потом снова «Подключить».'),
      h('li', { style: 'margin-top:8px' }, h('b', { text: '«Скрипт работает» или «Неверный ключ»' }), ' — со скриптом всё в порядке. Мешает браузер: выключи блокировщик рекламы для этой страницы или попробуй в Safari на айфоне.')));
  const body = h('div', {},
    h('div', { class: 'small muted', text: 'Делается один раз. Удобнее с компьютера: открой там это приложение по той же ссылке и с тем же паролем.' }),
    h('ol', { class: 'steps' },
      h('li', {}, 'Открой свою таблицу заказов в Google Таблицах.'),
      h('li', {}, 'Меню ', h('b', { text: 'Расширения → Apps Script' }), '.'),
      h('li', {}, 'Удали всё, что есть в редакторе, вставь код скрипта и нажми ', h('b', { text: '«Сохранить»' }), ' (значок дискеты). В коде уже есть твой ключ доступа.',
        h('div', { style: 'margin-top:8px' }, copyBtn)),
      h('li', {}, 'Нажми ', h('b', { text: 'Развертывание → Новое развертывание' }), ', тип ', h('b', { text: '«Веб-приложение»' }), '. Запуск от имени: ', h('b', { text: '«Я»' }),
        '. Кто имеет доступ: ', h('b', { text: '«Все»' }), ' (именно «Все», не «Все, у кого есть аккаунт Google»). Нажми «Начать развертывание».'),
      h('li', {}, 'Google попросит разрешение. Если появится «Приложение не проверено», нажми «Дополнительные настройки» и «Перейти к проекту». Скрипт работает только с этой таблицей.'),
      h('li', {}, 'Скопируй ', h('b', { text: 'URL веб-приложения' }), ' (заканчивается на /exec) и вставь сюда. На телефоне вставь тот же адрес: пришли его себе в мессенджер.')),
    field('Адрес веб-приложения', urlInput),
    status,
    h('div', { class: 'tiny faint', style: 'margin-top:14px', text: 'Без ключа скрипт ничего не отдаёт. Данные таблицы идут напрямую между телефоном и Google, на GitHub ничего не попадает. Если поменяешь код скрипта, разверни новую версию: Развертывание → Управление развертываниями → изменить → Новая версия.' }),
    app.sheet.connected ? h('button', { class: 'btn small danger', style: 'margin-top:16px', text: 'Отключить таблицу на этом телефоне', onclick: () => { if (confirm('Отключить таблицу на этом телефоне? В самой таблице ничего не удалится.')) { app.sheet.configure(null); sheet.close(); app.redraw(); } } }) : null,
  );
  const sheet = openSheet('Google Таблица', body, [
    h('button', { class: 'btn', text: 'Закрыть', onclick: () => sheet.close() }),
    h('button', { class: 'btn primary', text: 'Подключить', onclick: connect }),
  ]);
}
