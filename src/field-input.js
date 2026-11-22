'use strict';

(function installFieldInput(global) {
  const CLOCK_ERROR = 'Enter the time as HH:MM on a 24-hour clock, for example 22:00.';
  const DAY_ERROR = 'Enter the date as DD/MM/YYYY, for example 15/03/2027.';

  function asText(value) {
    return typeof value === 'string' ? value : value == null ? '' : String(value);
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function oneCharEdit(before, after) {
    const [longer, shorter] = before.length > after.length ? [before, after] : [after, before];
    if (longer.length - shorter.length !== 1) return false;
    let index = 0;
    while (index < shorter.length && longer[index] === shorter[index]) index += 1;
    return longer.slice(index + 1) === shorter.slice(index);
  }

  function segmented(previous, raw, config) {
    const prior = asText(previous);
    const value = asText(raw);
    if (!oneCharEdit(prior, value)) {
      const whole = config.whole(value);
      if (whole !== null) return whole;
    }
    const { sep, sizes } = config;
    const cleaned = value.replace(config.separators, sep).replace(new RegExp(`[^\\d${sep}]`, 'g'), '');
    if (!/\d/.test(cleaned)) return '';
    if (prior.endsWith(sep) && cleaned === prior.slice(0, -1)) return cleaned.slice(0, -1);
    const digitsOf = text => text.replace(/\D/g, '');
    if (value.length > prior.length && oneCharEdit(prior, value) && digitsOf(value) === digitsOf(prior)) return prior;
    const parts = cleaned.split(sep);
    const last = parts.length - 1;
    if (last >= sizes.length) return prior;
    const growing = cleaned.length > prior.length;
    const tail = parts[last];
    let suffix = '';
    if (growing && last < sizes.length - 1) {
      if (tail.length === 1 && config.padFirst(last, Number(tail))) {
        parts[last] = `0${tail}`;
        suffix = sep;
      } else if (tail.length === sizes[last]) {
        suffix = sep;
      }
    }
    for (let index = 0; index <= last; index += 1) {
      if (parts[index].length > sizes[index] || !config.allowed(index, parts[index])) return prior;
    }
    return parts.join(sep) + suffix;
  }

  function clockParse(text) {
    const match = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*$/.exec(asText(text));
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours > 23 || minutes > 59 ? null : `${pad(hours)}:${pad(minutes)}`;
  }

  const CLOCK = {
    sep: ':',
    separators: /\./g,
    sizes: [2, 2],
    whole(value) {
      const digits = /^\s*(\d{2})(\d{2})\s*$/.exec(value);
      return clockParse(digits ? `${digits[1]}:${digits[2]}` : value);
    },
    padFirst: (index, digit) => index === 0 && digit >= 3,
    allowed(index, part) {
      if (part.length < 2) return index === 0 || part === '' || Number(part) <= 5;
      return Number(part) <= (index === 0 ? 23 : 59);
    }
  };

  function clockType(previous, raw) {
    return segmented(previous, raw, CLOCK);
  }

  function dayParse(text) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(asText(text));
    if (!match) return null;
    const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(year, month - 1, day);
    const real = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    return real ? `${match[3]}-${match[2]}-${match[1]}` : null;
  }

  function dayDisplay(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asText(iso));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }

  const DAY = {
    sep: '/',
    separators: /[.-]/g,
    sizes: [2, 2, 4],
    whole(value) {
      const match = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(value)
        || /^\s*(\d{2})(\d{2})(\d{4})\s*$/.exec(value);
      if (!match) return null;
      const display = `${pad(match[1])}/${pad(match[2])}/${match[3]}`;
      return dayParse(display) === null ? null : display;
    },
    padFirst: (index, digit) => (index === 0 ? digit >= 4 : digit >= 2),
    allowed(index, part) {
      if (index === 2 || part.length < 2) return true;
      const number = Number(part);
      return number >= 1 && number <= (index === 0 ? 31 : 12);
    }
  };

  function dayType(previous, raw) {
    return segmented(previous, raw, DAY);
  }

  function wholeType(raw, maxDigits) {
    return asText(raw).replace(/\D/g, '').slice(0, maxDigits);
  }

  function wholeParse(text, min, max) {
    const value = asText(text).trim();
    if (!/^\d+$/.test(value)) return null;
    const number = Number(value);
    return number >= min && number <= max ? number : null;
  }

  function bindTyped(input, typeFn, onValue) {
    let last = input.value;
    input.addEventListener('beforeinput', () => { last = input.value; });
    input.addEventListener('input', () => {
      const raw = input.value;
      const caret = typeof input.selectionStart === 'number' ? input.selectionStart : raw.length;
      const result = typeFn(last, raw);
      if (result !== raw) {
        input.value = result;
        let position = caret + (result.length - raw.length);
        if (caret === raw.length) position = result.length;
        else if (result === last) position = caret - (raw.length - last.length);
        position = Math.max(0, Math.min(result.length, position));
        try { input.setSelectionRange(position, position); } catch (error) { void error; }
      }
      last = result;
      if (typeof onValue === 'function') onValue(result);
    });
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const WEEKDAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  function clockDate(clock) {
    const value = typeof clock === 'function' ? clock() : Date.now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : new Date();
  }

  function isoDayOf(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function calendarIcon(document) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.3');
    const frame = document.createElementNS(SVG_NS, 'rect');
    frame.setAttribute('x', '1.6');
    frame.setAttribute('y', '3');
    frame.setAttribute('width', '12.8');
    frame.setAttribute('height', '11.4');
    frame.setAttribute('rx', '2');
    const bar = document.createElementNS(SVG_NS, 'path');
    bar.setAttribute('d', 'M1.6 6.6h12.8');
    const left = document.createElementNS(SVG_NS, 'path');
    left.setAttribute('d', 'M5.2 1.6v2.6');
    const right = document.createElementNS(SVG_NS, 'path');
    right.setAttribute('d', 'M10.8 1.6v2.6');
    svg.append(frame, bar, left, right);
    return svg;
  }

  function createCalendar({ make, clock, onPick, anchor, onOpen, prefix }) {
    const ownElement = (tagName, text) => {
      const element = make(tagName);
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const button = (label) => {
      const element = ownElement('button', label);
      element.type = 'button';
      element.style.cssText = 'font:inherit;cursor:pointer;';
      return element;
    };
    const wrap = ownElement('div');
    wrap.className = `${prefix}-calendar-wrap`;
    wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;';
    const trigger = button('');
    trigger.className = `${prefix}-calendar-trigger`;
    trigger.setAttribute('aria-label', 'Open calendar');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;font:inherit;color:inherit;cursor:pointer;background:Field;border:1px solid color-mix(in srgb,currentColor 32%,transparent);border-radius:4px;';
    trigger.append(calendarIcon(wrap.ownerDocument));
    const panel = ownElement('div');
    panel.className = `${prefix}-calendar`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Pick a date');
    panel.hidden = true;
    panel.style.cssText = 'display:none;position:fixed;z-index:2147483000;top:0;left:0;gap:6px;padding:8px;background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,currentColor 24%,transparent);border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.18);';
    const header = ownElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';
    const previous = button('\u2039');
    previous.setAttribute('aria-label', 'Previous month');
    previous.style.cssText = 'font:inherit;cursor:pointer;background:transparent;color:inherit;border:0;padding:2px 6px;';
    const label = ownElement('span');
    label.className = `${prefix}-calendar-label`;
    label.style.cssText = 'font-weight:600;';
    const next = button('\u203a');
    next.setAttribute('aria-label', 'Next month');
    next.style.cssText = previous.style.cssText;
    header.append(previous, label, next);
    const weekdays = ownElement('div');
    weekdays.style.cssText = 'display:grid;grid-template-columns:repeat(7,26px);gap:2px;opacity:.7;font-size:11px;text-align:center;';
    WEEKDAY_NAMES.forEach(name => weekdays.append(ownElement('span', name)));
    const grid = ownElement('div');
    grid.className = `${prefix}-calendar-grid`;
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,26px);gap:2px;';
    const footer = ownElement('div');
    footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';
    const todayButton = button('Today');
    todayButton.className = `${prefix}-calendar-today`;
    todayButton.style.cssText = 'font:inherit;cursor:pointer;background:transparent;color:inherit;border:0;padding:2px 4px;text-decoration:underline;';
    const clearButton = button('Clear');
    clearButton.className = `${prefix}-calendar-clear`;
    clearButton.style.cssText = todayButton.style.cssText;
    footer.append(clearButton, todayButton);
    panel.append(header, weekdays, grid, footer);
    wrap.append(trigger, panel);
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart'].forEach((type) => {
      panel.addEventListener(type, event => event.stopPropagation());
    });
    trigger.addEventListener('keydown', (event) => {
      if (!open || event.key !== 'Tab' || event.shiftKey) return;
      event.preventDefault();
      previous.focus();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const active = panel.getRootNode().activeElement;
      if (event.shiftKey && active === previous) {
        event.preventDefault();
        trigger.focus();
      } else if (!event.shiftKey && active === todayButton) {
        close();
        trigger.focus();
      }
    });

    let view = null;
    let selected = '';
    let open = false;

    function render() {
      if (!view) return;
      label.textContent = `${MONTH_NAMES[view.month]} ${view.year}`;
      grid.replaceChildren();
      const offset = (new Date(view.year, view.month, 1).getDay() + 6) % 7;
      const total = new Date(view.year, view.month + 1, 0).getDate();
      const today = isoDayOf(clockDate(clock));
      for (let index = 0; index < offset; index += 1) grid.append(ownElement('span'));
      for (let day = 1; day <= total; day += 1) {
        const iso = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
        const cell = button(String(day));
        cell.className = `${prefix}-calendar-day`;
        cell.dataset.day = iso;
        const chosen = iso === selected;
        cell.setAttribute('aria-pressed', chosen ? 'true' : 'false');
        cell.style.cssText = `font:inherit;cursor:pointer;width:26px;height:26px;padding:0;border-radius:4px;color:inherit;background:${chosen ? 'Highlight' : 'transparent'};border:1px solid ${chosen ? 'Highlight' : iso === today ? 'color-mix(in srgb,currentColor 40%,transparent)' : 'transparent'};`;
        if (chosen) cell.style.color = 'HighlightText';
        cell.addEventListener('click', () => { close(); onPick(iso); });
        grid.append(cell);
      }
      if (open) place();
    }

    function place() {
      if (!trigger.isConnected) return close();
      const page = wrap.ownerDocument.defaultView;
      const below = trigger.getBoundingClientRect();
      const edge = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : below;
      const height = panel.offsetHeight;
      const room = page.innerHeight - below.bottom;
      const above = room < height + 4 && below.top > room;
      const left = Math.max(4, Math.min(edge.left, page.innerWidth - panel.offsetWidth - 4));
      const top = above ? Math.max(4, below.top - height - 4) : below.bottom + 4;
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
    }

    function onDocumentPointer(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (!path.includes(wrap) && !path.includes(panel) && !wrap.contains(event.target)) close();
    }

    function onDocumentKey(event) {
      if (event.key === 'Escape') { close(); trigger.focus(); }
    }

    function close() {
      if (!open) return;
      open = false;
      panel.hidden = true;
      panel.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
      wrap.ownerDocument.removeEventListener('mousedown', onDocumentPointer, true);
      wrap.ownerDocument.removeEventListener('keydown', onDocumentKey, true);
      wrap.append(panel);
      wrap.ownerDocument.defaultView.removeEventListener('scroll', place, true);
      wrap.ownerDocument.defaultView.removeEventListener('resize', place);
    }

    function show() {
      if (open) return;
      if (typeof onOpen === 'function') onOpen();
      open = true;
      const base = /^\d{4}-\d{2}-\d{2}$/.test(selected) ? new Date(`${selected}T00:00:00`) : clockDate(clock);
      view = { year: base.getFullYear(), month: base.getMonth() };
      panel.hidden = false;
      panel.style.display = 'grid';
      trigger.setAttribute('aria-expanded', 'true');
      wrap.ownerDocument.addEventListener('mousedown', onDocumentPointer, true);
      wrap.ownerDocument.addEventListener('keydown', onDocumentKey, true);
      const page = wrap.ownerDocument.defaultView;
      panel.style.font = page.getComputedStyle(wrap).font;
      wrap.ownerDocument.body.append(panel);
      page.addEventListener('scroll', place, true);
      page.addEventListener('resize', place);
      render();
    }

    function step(delta) {
      if (!view) return;
      const moved = new Date(view.year, view.month + delta, 1);
      view = { year: moved.getFullYear(), month: moved.getMonth() };
      render();
    }

    trigger.addEventListener('click', () => { if (open) close(); else show(); });
    previous.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    todayButton.addEventListener('click', () => { close(); onPick(isoDayOf(clockDate(clock))); });
    clearButton.addEventListener('click', () => { close(); onPick(''); });

    return {
      wrap,
      trigger,
      panel,
      close,
      isOpen: () => open,
      setSelected(value) {
        selected = /^\d{4}-\d{2}-\d{2}$/.test(asText(value)) ? asText(value) : '';
        if (open) render();
      }
    };
  }

  global.ISA_FIELDS = {
    CLOCK_ERROR, DAY_ERROR, clockType, clockParse, dayType, dayParse, dayDisplay, wholeType, wholeParse, bindTyped, createCalendar
  };
}(typeof window !== 'undefined' ? window : globalThis));
