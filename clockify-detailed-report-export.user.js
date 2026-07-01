// ==UserScript==
// @name         Clockify Detailed Report monthly CSV collector
// @namespace    https://github.com/MaksimLevchenko/clockifyAnalyzer
// @version      1.0.3
// @description  Собирает Clockify Detailed report по месяцам в один CSV-файл.
// @match        https://app.clockify.me/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'clockify-detailed-csv-collector-state';
  const CONFIG_KEY = 'clockify-detailed-csv-collector-config';
  const CSV_HEADERS = [
    'Project',
    'Client',
    'Description',
    'Task',
    'User',
    'Group',
    'Email',
    'Tags',
    'Billable',
    'Start Date',
    'Start Time',
    'End Date',
    'End Time',
    'Duration (h)',
    'Duration (decimal)',
    'Billable Rate (USD)',
    'Billable Amount (USD)',
    'Date of creation',
  ];

  const MONTHS_EN = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  const DEFAULT_CONFIG = {
    fromMonth: currentMonth(),
    toMonth: currentMonth(),
    rate: '',
    user: '',
    email: '',
    billable: 'Yes',
  };

  let panel;
  let collectionStepRunning = false;
  let collectionStepTimer = 0;

  function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key)) || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeState(state) {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function readState() {
    return readJson(STORE_KEY, null);
  }

  function clearState() {
    sessionStorage.removeItem(STORE_KEY);
    localStorage.removeItem(STORE_KEY);
  }

  function readConfig() {
    return { ...DEFAULT_CONFIG, ...readJson(CONFIG_KEY, {}) };
  }

  function writeConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function isDetailedReport() {
    return location.pathname.includes('/reports/detailed');
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function parseMonth(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return { year, month };
  }

  function compareMonths(a, b) {
    const ma = parseMonth(a);
    const mb = parseMonth(b);
    return ma.year * 12 + ma.month - (mb.year * 12 + mb.month);
  }

  function addMonths(yyyyMm, count) {
    const m = parseMonth(yyyyMm);
    const date = new Date(Date.UTC(m.year, m.month - 1 + count, 1));
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
  }

  function monthStartIso(yyyyMm) {
    const m = parseMonth(yyyyMm);
    return new Date(Date.UTC(m.year, m.month - 1, 1, 0, 0, 0, 0)).toISOString();
  }

  function monthEndIso(yyyyMm) {
    const m = parseMonth(yyyyMm);
    return new Date(Date.UTC(m.year, m.month, 0, 23, 59, 59, 999)).toISOString();
  }

  function daysInSelectedMonth(yyyyMm) {
    const m = parseMonth(yyyyMm);
    return new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
  }

  function monthFromUrl() {
    const start = new URLSearchParams(location.search).get('start');
    const match = /^(\d{4})-(\d{2})-/.exec(start || '');
    return match ? `${match[1]}-${match[2]}` : null;
  }

  function localMonthFromUrl() {
    const start = new URLSearchParams(location.search).get('start');
    if (!start) return null;
    const date = new Date(start);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  function urlMatchesMonth(yyyyMm) {
    return monthFromUrl() === yyyyMm || localMonthFromUrl() === yyyyMm;
  }

  function pageMatchesMonth(yyyyMm) {
    return dateRangeMonthFromPage() === yyyyMm;
  }

  function navigateToMonth(yyyyMm) {
    if (isDetailedReport()) {
      scheduleCollectionStep(700);
      return;
    }

    const url = new URL(location.href);
    url.pathname = '/reports/detailed';
    url.searchParams.set('start', monthStartIso(yyyyMm));
    url.searchParams.set('end', monthEndIso(yyyyMm));
    location.href = url.toString();
    scheduleCollectionStep(1800);
  }

  function scheduleCollectionStep(delay) {
    if (!readState()?.running) return;
    clearTimeout(collectionStepTimer);
    collectionStepTimer = setTimeout(runCollectionStep, delay);
  }

  function installNavigationWatcher() {
    const notify = () => scheduleCollectionStep(1400);
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        notify();
        return result;
      };
    }
    window.addEventListener('popstate', notify);
    setInterval(() => {
      if (readState()?.running) scheduleCollectionStep(1600);
    }, 5000);
  }

  function dateRangeMonthFromPage() {
    const root = document.querySelector('datepicker-range, [data-cy="date-picker"]');
    const texts = [
      ...Array.from(root?.querySelectorAll('input') || []).map(input => input.value),
      ...Array.from(root?.querySelectorAll('[data-cy="date-picker-range"], .cl-d-print-block') || [])
        .map(el => el.textContent || el.innerText),
      root?.textContent || root?.innerText || '',
    ];
    for (const text of texts.map(normalizeText).filter(Boolean)) {
      const month = monthFromDateRangeText(text);
      if (month) return month;
    }
    return null;
  }

  function presetMonthFromPage() {
    const root = document.querySelector('datepicker-range, [data-cy="date-picker"]');
    const text = normalizeText(root?.textContent || root?.innerText || '');
    if (/\bthis month\b/i.test(text)) return currentMonth();
    if (/\blast month\b/i.test(text)) return addMonths(currentMonth(), -1);
    return null;
  }

  function reportMonthFromPage() {
    return dateRangeMonthFromPage() || presetMonthFromPage();
  }

  function monthFromDateRangeText(text) {
    const range = parseDateRange(text);
    if (!range) return null;
    if (range.start.year !== range.end.year || range.start.month !== range.end.month) return null;
    if (range.start.day !== 1) return null;
    const yyyyMm = `${range.start.year}-${pad2(range.start.month)}`;
    return range.end.day === daysInSelectedMonth(yyyyMm) ? yyyyMm : null;
  }

  function parseDateRange(text) {
    return parseNamedDateRange(text) || parseNumericDateRange(text);
  }

  function parseNamedDateRange(text) {
    const pattern = /\b([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\b/;
    const match = pattern.exec(text || '');
    if (!match) return null;
    const startMonth = MONTHS_EN[match[1].toLowerCase()];
    const endMonth = MONTHS_EN[match[4].toLowerCase()];
    if (!startMonth || !endMonth) return null;
    return {
      start: { year: Number(match[3]), month: startMonth, day: Number(match[2]) },
      end: { year: Number(match[6]), month: endMonth, day: Number(match[5]) },
    };
  }

  function parseNumericDateRange(text) {
    const pattern = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\s*-\s*(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/;
    const match = pattern.exec(text || '');
    if (!match) return null;
    return {
      start: { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) },
      end: { year: Number(match[6]), month: Number(match[5]), day: Number(match[4]) },
    };
  }

  async function setReportMonth(yyyyMm) {
    setStatus(`Переключаю отчет на ${yyyyMm}...`);
    if (await setReportMonthWithArrows(yyyyMm)) return;
    throw new Error('Не смог переключить месяц стрелками. Убедись, что Detailed report открыт с месячным диапазоном.');
  }

  async function setReportMonthWithArrows(yyyyMm) {
    let current = reportMonthFromPage();
    if (!current) return false;
    let distance = compareMonths(yyyyMm, current);
    if (distance === 0) return true;

    const direction = distance > 0 ? 'right' : 'left';
    for (let i = 0; i < Math.abs(distance); i += 1) {
      const button = reportMonthArrowButton(direction);
      if (!button) return false;
      current = reportMonthFromPage();
      button.click();
      await waitForReport();
      await waitForArrowMonthStep(current, direction);
    }

    await waitForReportMonth(yyyyMm, true);
    return true;
  }

  function reportMonthArrowButton(direction) {
    const root = document.querySelector('datepicker-range') || document;
    const needle = direction === 'right' ? 'right' : 'left';
    const imgs = Array.from(root.querySelectorAll('button img'));
    const img = imgs.find(node => {
      const haystack = `${node.getAttribute('src') || ''} ${node.getAttribute('alt') || ''}`.toLowerCase();
      return haystack.includes(`chevron-${needle}`) || haystack.includes(`${needle} arrow`);
    });
    const button = img?.closest('button');
    return button && isVisible(button) ? button : null;
  }

  async function waitForArrowMonthStep(previousMonth, direction) {
    const expected = previousMonth ? addMonths(previousMonth, direction === 'right' ? 1 : -1) : null;
    const started = Date.now();
    while (Date.now() - started < 15000) {
      await waitForReport();
      const current = reportMonthFromPage();
      if (expected && current === expected) return true;
      if (!expected && current && current !== previousMonth) return true;
      await sleep(250);
    }
    return false;
  }

  async function waitForReportMonth(yyyyMm, allowUrlMatch) {
    const started = Date.now();
    while (Date.now() - started < 30000) {
      await waitForReport();
      if (
        pageMatchesMonth(yyyyMm)
        || (allowUrlMatch && (urlMatchesMonth(yyyyMm) || presetMonthFromPage() === yyyyMm))
      ) return true;
      await sleep(250);
    }
    if (allowUrlMatch) return false;
    throw new Error(`Clockify не переключил страницу на ${yyyyMm}.`);
  }

  function setStatus(message) {
    const box = document.querySelector('#ca-status');
    if (box) box.textContent = message;
  }

  function installPanel() {
    if (panel) return;
    const config = readConfig();
    const state = readState();
    const style = document.createElement('style');
    style.textContent = `
      #ca-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;background:#fff;color:#1f2937;border:1px solid #d1d5db;box-shadow:0 10px 28px rgba(15,23,42,.2);font:13px/1.35 Arial,sans-serif;padding:12px}
      #ca-panel h3{margin:0 0 10px;font-size:14px}
      #ca-panel label{display:grid;grid-template-columns:108px 1fr;gap:8px;align-items:center;margin:7px 0}
      #ca-panel input,#ca-panel select{box-sizing:border-box;width:100%;height:28px;border:1px solid #cbd5e1;padding:3px 6px;background:#fff;color:#111827}
      #ca-panel .ca-row{display:flex;gap:8px;margin-top:10px}
      #ca-panel button{height:30px;border:1px solid #0f6fff;background:#0f6fff;color:#fff;padding:0 10px;cursor:pointer}
      #ca-panel button.secondary{border-color:#cbd5e1;background:#f8fafc;color:#1f2937}
      #ca-panel button.danger{border-color:#b91c1c;background:#b91c1c}
      #ca-status{margin-top:10px;min-height:32px;color:#475569;white-space:pre-wrap}
    `;
    document.documentElement.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'ca-panel';
    panel.innerHTML = `
      <h3>Clockify CSV collector</h3>
      <label>С месяца <input id="ca-from" type="month" value="${escapeAttr(config.fromMonth)}"></label>
      <label>По месяц <input id="ca-to" type="month" value="${escapeAttr(config.toMonth)}"></label>
      <label>Ставка USD <input id="ca-rate" type="number" step="0.01" value="${escapeAttr(config.rate)}"></label>
      <label>Пользователь <input id="ca-user" type="text" value="${escapeAttr(config.user)}"></label>
      <label>Email <input id="ca-email" type="email" value="${escapeAttr(config.email)}"></label>
      <label>Billable <select id="ca-billable"><option value="Yes">Yes</option><option value="No">No</option></select></label>
      <div class="ca-row">
        <button id="ca-start">Собрать CSV</button>
        <button id="ca-download" class="secondary">Скачать сейчас</button>
        <button id="ca-stop" class="danger">Стоп</button>
      </div>
      <div id="ca-status"></div>
    `;
    document.documentElement.appendChild(panel);
    document.querySelector('#ca-billable').value = config.billable || 'Yes';
    document.querySelector('#ca-start').addEventListener('click', startCollection);
    document.querySelector('#ca-download').addEventListener('click', downloadCurrentState);
    document.querySelector('#ca-stop').addEventListener('click', () => {
      clearState();
      setStatus('Сбор остановлен.');
    });
    setStatus(state?.running ? `Сбор активен: ${state.cursor}` : 'Открой Detailed report и выбери диапазон месяцев.');
  }

  function escapeAttr(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  function readPanelConfig() {
    const config = {
      fromMonth: document.querySelector('#ca-from').value,
      toMonth: document.querySelector('#ca-to').value,
      rate: document.querySelector('#ca-rate').value,
      user: document.querySelector('#ca-user').value.trim(),
      email: document.querySelector('#ca-email').value.trim(),
      billable: document.querySelector('#ca-billable').value,
    };
    writeConfig(config);
    return config;
  }

  function startCollection() {
    const config = readPanelConfig();
    if (!parseMonth(config.fromMonth) || !parseMonth(config.toMonth)) {
      setStatus('Укажи корректный диапазон месяцев.');
      return;
    }
    if (compareMonths(config.fromMonth, config.toMonth) > 0) {
      setStatus('Начальный месяц должен быть не позже конечного.');
      return;
    }
    const state = {
      running: true,
      fromMonth: config.fromMonth,
      toMonth: config.toMonth,
      cursor: config.fromMonth,
      config,
      rows: [],
      warnings: [],
      startedAt: new Date().toISOString(),
    };
    writeState(state);
    if (!isDetailedReport()) {
      navigateToMonth(state.cursor);
      return;
    }
    runCollectionStep();
  }

  async function runCollectionStep() {
    if (collectionStepRunning) return;
    const state = readState();
    if (!state?.running) return;
    collectionStepRunning = true;
    try {
      installPanel();
      if (!isDetailedReport()) {
        navigateToMonth(state.cursor);
        return;
      }

      await waitForReport();
      if (!pageMatchesMonth(state.cursor)) {
        await setReportMonth(state.cursor);
      }
      const confirmedMonth = await waitForReportMonth(state.cursor, true);
      if (!confirmedMonth) {
        state.warnings.push(`${state.cursor}: не смог подтвердить месяц по шапке Clockify после переключения стрелками.`);
        writeState(state);
      }
      setStatus(`Собираю ${state.cursor}...`);
      await loadAllRenderedRows();
      await expandGroupedRows();
      await loadAllRenderedRows();
      const result = collectCurrentMonth(state.cursor, state.config);
      state.rows.push(...result.rows);
      state.warnings.push(...result.warnings);
      state.rows = dedupeRows(state.rows);
      const completedMonth = state.cursor;
      const next = addMonths(state.cursor, 1);
      if (compareMonths(next, state.toMonth) <= 0) {
        state.cursor = next;
        writeState(state);
        setStatus(`Собрано ${result.rows.length} строк за ${completedMonth}.\nПереход к ${next}...`);
        await sleep(700);
        navigateToMonth(next);
        return;
      }
      state.running = false;
      writeState(state);
      setStatus(`Готово. Строк: ${state.rows.length}.`);
      downloadCsv(state);
    } catch (error) {
      state.running = false;
      state.warnings.push(String(error?.message || error));
      writeState(state);
      setStatus(`Ошибка: ${error?.message || error}`);
    } finally {
      collectionStepRunning = false;
    }
  }

  async function waitForReport() {
    const started = Date.now();
    while (Date.now() - started < 30000) {
      const report = document.querySelector('app-detailed-reports, table.cl-detailed-reports-table');
      const loader = document.querySelector('.rotating-loader-logo-wrapper:not([hidden]), .cl-progress-bar-wrapper:not([hidden])');
      if (report && !loader) return;
      await sleep(250);
    }
    throw new Error('Не дождался загрузки Detailed report.');
  }

  async function loadAllRenderedRows() {
    let stableTicks = 0;
    let previousCount = -1;
    for (let i = 0; i < 30; i += 1) {
      clickLoadMore();
      scrollReportToBottom();
      await sleep(450);
      const count = candidateElements().length;
      if (count === previousCount) stableTicks += 1;
      else stableTicks = 0;
      previousCount = count;
      if (stableTicks >= 3) break;
    }
  }

  function clickLoadMore() {
    const buttons = Array.from(document.querySelectorAll('button, a'))
      .filter(isVisible)
      .filter(el => /load more|show more|more|загрузить|показать еще|показать ещё/i.test(normalizeText(el.innerText)));
    buttons.forEach(button => button.click());
  }

  function scrollReportToBottom() {
    const targets = [
      document.scrollingElement,
      ...document.querySelectorAll('main, .cl-main-wrapper, .cl-page-component-wrapper, .cl-table-responsive'),
    ].filter(Boolean);
    targets.forEach(target => {
      target.scrollTop = target.scrollHeight;
    });
  }

  async function expandGroupedRows() {
    const badges = Array.from(document.querySelectorAll('tbody .cl-badge-same-entries, tbody select-arrow'))
      .map(el => el.closest('a, button, span') || el)
      .filter(isVisible);
    for (const badge of badges) {
      badge.click();
      await sleep(120);
    }
    await sleep(500);
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function candidateElements() {
    const byContainer = Array.from(document.querySelectorAll('tbody .cl-row-hover-shadow.cl-detailed-reports-table'));
    const byRows = Array.from(document.querySelectorAll('tbody tr[detailed-row]'));
    const byInputs = Array.from(document.querySelectorAll('[data-cy="time-entry"]'))
      .map(el => el.closest('.cl-row-hover-shadow, tr, responsive-row') || el);
    return dedupeElements([...byContainer, ...byRows, ...byInputs]).filter(isVisible);
  }

  function dedupeElements(elements) {
    const seen = new Set();
    return elements.filter(el => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  }

  function collectCurrentMonth(month, config) {
    const rows = candidateElements()
      .map(el => extractRow(el, month, config))
      .filter(row => row && (row.project || row.description || row.durationH));
    const datedRows = rows.filter(row => row.startDate);
    const selectedRows = datedRows.length ? datedRows : rows;
    const warnings = [];
    const missingDates = selectedRows.filter(row => !row.startDate).length;
    if (missingDates) {
      warnings.push(`${month}: ${missingDates} строк без даты. Включи Date/Start/End в Clockify или раскрой группы строк перед сбором.`);
    }
    return { rows: selectedRows, warnings };
  }

  function extractRow(el, month, config) {
    const rowText = normalizeText(el.innerText || el.textContent);
    const entryId = getEntryId(el);
    const description = pickInputValue(el, '.cl-input-description, input[id^="description-"]')
      || cleanPlaceholder(textOf(el.querySelector('.cl-fake-input')));
    const durationH = pickInputValue(el, '.cl-input-time-picker-sum, input-duration input')
      || extractDuration(rowText);
    const durationDecimal = durationToDecimal(durationH);
    const { project, task, client } = extractProject(el);
    const tags = extractTags(el);
    const dateIso = extractDate(rowText, month);
    const times = extractTimes(rowText, durationH);
    const startTime = normalizeTime(times[0]) || '';
    const endTime = normalizeTime(times[1]) || '';
    const startDate = dateIso ? isoToCsvDate(dateIso) : '';
    const endDate = dateIso ? isoToCsvDate(endDateIso(dateIso, startTime, endTime)) : '';
    const rate = Number(config.rate || 0);
    const amount = Number.isFinite(durationDecimal) ? durationDecimal * rate : 0;

    return {
      entryId,
      project,
      client,
      description,
      task,
      user: config.user || '',
      group: '',
      email: config.email || '',
      tags,
      billable: config.billable || 'Yes',
      startDate,
      startTime,
      endDate,
      endTime,
      durationH,
      durationDecimal: Number.isFinite(durationDecimal) ? durationDecimal.toFixed(2) : '',
      rate: config.rate || '',
      amount: Number.isFinite(amount) ? amount.toFixed(2) : '',
      createdAt: objectIdDate(entryId) ? isoToCsvDate(objectIdDate(entryId)) : startDate,
    };
  }

  function pickInputValue(root, selector) {
    const input = root.querySelector(selector);
    return normalizeText(input?.value || input?.getAttribute('value') || '');
  }

  function textOf(el) {
    return normalizeText(el?.innerText || el?.textContent || '');
  }

  function cleanPlaceholder(value) {
    return /^(add description|description)$/i.test(value) ? '' : value;
  }

  function getEntryId(root) {
    const input = Array.from(root.querySelectorAll('input[id]'))
      .find(el => /^[0-9a-f]{24}$/i.test(el.id));
    return input?.id || '';
  }

  function extractProject(root) {
    const projectEl = root.querySelector('.cl-project-name, [project-picker-label]');
    const client = textOf(root.querySelector('.cl-listing-client'));
    let value = textOf(projectEl);
    if (client) value = normalizeText(value.replace(client, ''));
    value = value.replace(/\s*Add project\s*/i, '').trim();
    const parts = value.split(/\s*:\s*/);
    if (parts.length > 1) {
      return { project: parts.shift(), task: parts.join(': '), client };
    }
    return { project: value, task: '', client };
  }

  function extractTags(root) {
    const tagText = textOf(root.querySelector('tag-names-text-only, .cl-reports-tags'));
    return /add tags/i.test(tagText) ? '' : tagText;
  }

  function extractDuration(text) {
    const matches = text.match(/\b\d{1,4}:\d{2}(?::\d{2})\b/g) || [];
    return matches.find(value => {
      const [h, m, s = '0'] = value.split(':').map(Number);
      return h >= 0 && m < 60 && s < 60;
    }) || '';
  }

  function durationToDecimal(value) {
    const parts = String(value || '').split(':').map(Number);
    if (parts.length < 2 || parts.some(part => !Number.isFinite(part))) return NaN;
    const [h, m, s = 0] = parts;
    return Math.round((h + m / 60 + s / 3600) * 100) / 100;
  }

  function extractDate(text, month) {
    const numeric = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
    if (numeric) return normalizeDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]), month);
    const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return normalizeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), month);
    const named = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\b/);
    if (named) return normalizeDate(Number(named[3]), MONTHS_EN[named[1].toLowerCase()], Number(named[2]), month);
    return '';
  }

  function normalizeDate(year, monthNumber, day, expectedMonth) {
    if (!year || !monthNumber || !day) return '';
    const iso = `${year}-${pad2(monthNumber)}-${pad2(day)}`;
    return iso.startsWith(expectedMonth) ? iso : '';
  }

  function objectIdDate(id) {
    if (!/^[0-9a-f]{24}$/i.test(id)) return '';
    const seconds = Number.parseInt(id.slice(0, 8), 16);
    if (!Number.isFinite(seconds)) return '';
    const date = new Date(seconds * 1000);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function extractTimes(text, duration) {
    const matches = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || [];
    const durationNorm = normalizeTime(duration);
    return matches
      .map(normalizeTime)
      .filter(Boolean)
      .filter(value => value !== durationNorm)
      .slice(0, 2);
  }

  function normalizeTime(value) {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || '').trim());
    if (!match) return '';
    return `${pad2(match[1])}:${match[2]}:${match[3] || '00'}`;
  }

  function endDateIso(startDateIso, startTime, endTime) {
    if (!startTime || !endTime || endTime >= startTime) return startDateIso;
    const date = new Date(`${startDateIso}T00:00:00`);
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function isoToCsvDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }

  function dedupeRows(rows) {
    const seen = new Set();
    return rows.filter(row => {
      const key = row.entryId || [
        row.startDate,
        row.startTime,
        row.project,
        row.task,
        row.description,
        row.durationH,
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function toCsv(rows) {
    const lines = [CSV_HEADERS.map(csvCell).join(',')];
    for (const row of rows) {
      lines.push([
        row.project,
        row.client,
        row.description,
        row.task,
        row.user,
        row.group,
        row.email,
        row.tags,
        row.billable,
        row.startDate,
        row.startTime,
        row.endDate,
        row.endTime,
        row.durationH,
        row.durationDecimal,
        row.rate,
        row.amount,
        row.createdAt,
      ].map(csvCell).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function downloadCsv(state) {
    const from = state.fromMonth.replace('-', '_');
    const to = state.toMonth.replace('-', '_');
    const blob = new Blob([toCsv(state.rows)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Clockify_Detailed_${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    if (state.warnings.length) console.warn('[Clockify CSV collector]', state.warnings);
  }

  function downloadCurrentState() {
    const state = readState();
    if (!state?.rows?.length) {
      setStatus('Пока нет собранных строк.');
      return;
    }
    downloadCsv(state);
  }

  installNavigationWatcher();
  installPanel();
  if (readState()?.running) {
    scheduleCollectionStep(500);
  }
})();
