/* Essensplaner – komplett clientseitig, damit er statisch auf GitHub Pages läuft.
 * Zustand liegt in localStorage, geteilt wird über einen Link mit dem Plan im URL-Hash. */
(() => {
  'use strict';

  const STORE_KEY = 'essensplaner.v1';
  const FAV_KEY = 'essensplaner.favs';
  const KID_FACTOR = 0.6;
  const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const SLOTS = [
    { k: 'f', label: 'Frühstück', icon: '☀️' },
    { k: 'm', label: 'Mittag', icon: '🕛' },
    { k: 'a', label: 'Abendessen', icon: '🌙' },
  ];
  const DIETS = [
    { k: 'alles', label: 'Alles', icon: '🍽️', desc: 'Fleisch, Fisch und Vegetarisches gemischt' },
    { k: 'flexi', label: 'Flexitarisch', icon: '🥕', desc: 'Überwiegend vegetarisch, ab und zu Fleisch' },
    { k: 'pesce', label: 'Pescetarisch', icon: '🐟', desc: 'Vegetarisch plus Fisch' },
    { k: 'veggie', label: 'Vegetarisch', icon: '🧀', desc: 'Kein Fleisch, kein Fisch' },
    { k: 'vegan', label: 'Vegan', icon: '🌱', desc: 'Rein pflanzlich' },
  ];
  const DIET_ALLOWS = {
    alles: ['vegan', 'veggie', 'fisch', 'fleisch'],
    flexi: ['vegan', 'veggie', 'fisch', 'fleisch'],
    pesce: ['vegan', 'veggie', 'fisch'],
    veggie: ['vegan', 'veggie'],
    vegan: ['vegan'],
  };
  const DIET_BADGE = { vegan: '🌱 vegan', veggie: '🧀 vegetarisch', fisch: '🐟 Fisch', fleisch: '🥩 Fleisch' };
  const ALLERGENS = [
    { k: 'g', label: 'Glutenfrei' },
    { k: 'l', label: 'Laktosefrei' },
    { k: 'n', label: 'Nussfrei' },
    { k: 'e', label: 'Ohne Ei' },
  ];
  const TIMES = [[15, '15 Min.'], [20, '20 Min.'], [30, '30 Min.'], [45, '45 Min.'], [60, '1 Std.'], [0, 'egal']];
  const BUDGETS = [
    { k: 'spar', label: 'Sparsam', icon: '€' },
    { k: 'normal', label: 'Normal', icon: '€€' },
    { k: 'egal', label: 'Darf mehr kosten', icon: '€€€' },
  ];
  const UNIT_PLURAL = { Zehe: 'Zehen', Scheibe: 'Scheiben', Rolle: 'Rollen' };

  const RECIPE = Object.fromEntries(RECIPES.map(r => [r.id, r]));
  const MAINS = RECIPES.filter(r => r.m === 'main');
  const BREAKFASTS = RECIPES.filter(r => r.m === 'fruehstueck');

  // ---------- Hilfsfunktionen ----------

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const num = n => String(Math.round(n * 100) / 100).replace('.', ',');

  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const newSeed = () => Math.floor(Math.random() * 2 ** 31);

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) {
    const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d);
  }
  function nextMonday() {
    const d = new Date(); const wd = d.getDay();
    d.setDate(d.getDate() + (wd === 1 ? 0 : (8 - wd) % 7));
    return isoDate(d);
  }
  const weekDates = start => Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const isWeekend = s => [0, 6].includes(parseDate(s).getDay());
  const dayName = s => DAY_NAMES[parseDate(s).getDay()];
  const shortDate = s => { const d = parseDate(s); return `${d.getDate()}.${d.getMonth() + 1}.`; };

  const portions = s => Math.max(1, s.adults + KID_FACTOR * s.kids);

  // Wortvergleich für Abneigungen und Vorrat: „Zwiebeln“ trifft „Zwiebel“, „Nudeln“ trifft Spaghetti (Alias).
  const stem = w => (w.length > 4 ? w.replace(/(en|n|e|s)$/, '') : w);
  const words = text => text.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean);
  const tokens = text => words(text || '').filter(w => w.length >= 2);
  function wordMatches(token, word) {
    const t = stem(token);
    return t.length >= 4 ? word.includes(t) : word === token || word.startsWith(token);
  }
  function textMatches(tokenList, text, exact) {
    const ws = words(text);
    return tokenList.some(t => ws.some(w => (exact ? stem(w) === stem(t) : wordMatches(t, w))));
  }
  const ingText = name => `${name} ${INGREDIENTS[name][3]}`;
  // Basics (Öl, Gewürze) nur bei exakt gleichem Wort: „Oliven“ soll kein Olivenöl treffen.
  const ingMatches = (tokenList, name) => textMatches(tokenList, ingText(name), INGREDIENTS[name][0] === 'basis');

  // ---------- Zustand ----------

  function defaultSettings() {
    const grid = weekDates(nextMonday()).map(d => (isWeekend(d) ? { f: false, m: true, a: true } : { f: false, m: false, a: true }));
    return {
      adults: 2, kids: 0, diet: 'alles', maxMeat: 4, allergies: [], dislikes: '',
      start: nextMonday(), grid, leftovers: true,
      timeWeek: 30, timeWeekend: 60, budget: 'normal', cuisines: [],
      pantry: '', haveBasics: true,
    };
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* privat/voll – App funktioniert trotzdem */ }
  }
  function loadFavs() {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []); } catch { return new Set(); }
  }
  function saveFavs() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* ignorieren */ }
  }

  let state = load(); // { settings, days, locked, checked, extras, notes }
  if (state && !(state.settings && Array.isArray(state.days))) state = null;
  const favs = loadFavs();
  const ui = { view: state ? 'plan' : 'wizard', step: 0, tab: 'plan', draft: state ? clone(state.settings) : defaultSettings(), hideDone: false };

  // ---------- Rezeptauswahl ----------

  function dropOptional(name, s) {
    const al = INGREDIENTS[name][2];
    return s.allergies.some(a => al.includes(a)) || ingMatches(tokens(s.dislikes), name);
  }

  function recipeOk(r, s) {
    if (!DIET_ALLOWS[s.diet].includes(r.d)) return false;
    const dis = tokens(s.dislikes);
    if (dis.length && textMatches(dis, r.n)) return false;
    for (const [name, , opt] of r.i) {
      if (opt) continue;
      if (s.allergies.some(a => INGREDIENTS[name][2].includes(a))) return false;
      if (dis.length && ingMatches(dis, name)) return false;
    }
    return true;
  }

  const family = k => (k === 'indisch' ? 'asiatisch' : k);
  const meatLimited = s => s.diet === 'alles' || s.diet === 'flexi';

  // Zählt, was im Plan schon vorkommt (ohne den Slot, der gerade neu besetzt wird).
  function planStats(days, skip) {
    const used = {}; const protein = {}; const cuisine = {}; let meat = 0;
    days.forEach((day, i) => SLOTS.forEach(({ k }) => {
      const v = day[k];
      if (!v || v.rest || (skip && skip.i === i && skip.k === k)) return;
      const r = RECIPE[v.r];
      used[r.id] = (used[r.id] || 0) + 1;
      if (r.m === 'main') {
        protein[r.p] = (protein[r.p] || 0) + 1;
        cuisine[family(r.k)] = (cuisine[family(r.k)] || 0) + 1;
        if (r.d === 'fleisch') meat++;
      }
    }));
    return { used, protein, cuisine, meat };
  }

  function neighbourMain(days, i, k, dir) {
    const order = [];
    days.forEach((d, di) => ['m', 'a'].forEach(sk => order.push([di, sk])));
    let idx = order.findIndex(([di, sk]) => di === i && sk === k);
    for (idx += dir; idx >= 0 && idx < order.length; idx += dir) {
      const v = days[order[idx][0]][order[idx][1]];
      if (v) return RECIPE[v.r];
    }
    return null;
  }

  function wantsLeftovers(s, days, i, locked) {
    return s.leftovers && i < 6 && s.grid[i + 1].m && !locked.includes(`${i + 1}-m`);
  }

  function pickMain(s, days, i, k, rnd, opts = {}) {
    const date = days[i].date;
    const limit = isWeekend(date) ? s.timeWeekend : s.timeWeek;
    const base = MAINS.filter(r => recipeOk(r, s) && r.id !== opts.exclude);
    const st = planStats(days, { i, k });
    const prev = neighbourMain(days, i, k, -1);
    const next = neighbourMain(days, i, k, +1);
    const stages = [
      r => (!limit || r.t <= limit) && !st.used[r.id] && !(meatLimited(s) && r.d === 'fleisch' && st.meat >= s.maxMeat),
      r => !st.used[r.id] && !(meatLimited(s) && r.d === 'fleisch' && st.meat >= s.maxMeat),
      r => !(meatLimited(s) && r.d === 'fleisch' && st.meat >= s.maxMeat),
      () => true,
    ];
    const notes = ['', 'Für manche Tage gab es nichts im Zeitlimit – dort dauert es etwas länger.', 'Zu wenige passende Rezepte – einzelne Gerichte kommen doppelt vor.', ''];
    let cands = [];
    let stage = 0;
    for (; stage < stages.length; stage++) {
      cands = base.filter(stages[stage]);
      if (cands.length) break;
    }
    if (!cands.length) return { v: null, note: 'Für manche Mahlzeiten gibt es kein passendes Rezept – lockere ggf. Abneigungen oder Unverträglichkeiten.' };

    const score = r => {
      let sc = rnd() * 2;
      if (s.cuisines.includes(r.k)) sc += 1.5;
      if (s.budget === 'spar') sc += r.c === 1 ? 1 : r.c === 3 ? -1.5 : 0;
      if (s.budget === 'normal' && r.c === 3) sc -= 0.4;
      if (s.kids > 0 && r.kid) sc += 0.8;
      if (favs.has(r.id)) sc += 2;
      if (opts.wantRest && r.rest) sc += 2.5;
      if (prev && prev.p === r.p) sc -= 2;
      if (next && next.p === r.p) sc -= 2;
      if (prev && family(prev.k) === family(r.k)) sc -= 1.2;
      if (next && family(next.k) === family(r.k)) sc -= 1.2;
      sc -= 0.5 * (st.protein[r.p] || 0);
      sc -= (s.cuisines.includes(r.k) ? 0.2 : 0.5) * (st.cuisine[family(r.k)] || 0);
      if (k === 'm' && !isWeekend(date)) sc -= r.t / 60; // mittags unter der Woche lieber schnell
      return sc;
    };
    let best = null; let bestScore = -Infinity;
    for (const r of cands) { const sc = score(r); if (sc > bestScore) { best = r; bestScore = sc; } }
    return { v: { r: best.id }, note: notes[stage] };
  }

  function pickBreakfast(s, days, i, rnd, opts = {}) {
    const we = isWeekend(days[i].date);
    let cands = BREAKFASTS.filter(r => recipeOk(r, s) && r.id !== opts.exclude);
    const quick = cands.filter(r => we || r.t <= 15);
    if (quick.length) cands = quick;
    if (!cands.length) return { v: null, note: 'Kein passendes Frühstück gefunden.' };
    const st = planStats(days, { i, k: 'f' });
    let best = null; let bestScore = -Infinity;
    for (const r of cands) {
      let sc = rnd() * 2 - 1.2 * (st.used[r.id] || 0);
      if (favs.has(r.id)) sc += 2;
      if (s.kids > 0 && r.kid) sc += 0.6;
      if (we && r.t > 15) sc += 1;
      if (sc > bestScore) { best = r; bestScore = sc; }
    }
    return { v: { r: best.id }, note: '' };
  }

  function fillSlot(s, days, i, k, rnd, locked, notes, opts = {}) {
    if (k === 'f') {
      const res = pickBreakfast(s, days, i, rnd, opts);
      days[i].f = res.v; if (res.note) notes.add(res.note);
      return;
    }
    if (k === 'm' && s.leftovers && !opts.exclude && i > 0 && days[i - 1].a && !days[i - 1].a.rest && RECIPE[days[i - 1].a.r].rest) {
      days[i].m = { r: days[i - 1].a.r, rest: true };
      return;
    }
    const res = pickMain(s, days, i, k, rnd, { ...opts, wantRest: k === 'a' && wantsLeftovers(s, days, i, locked) });
    days[i][k] = res.v; if (res.note) notes.add(res.note);
  }

  function generate(s, prev, locked, seed) {
    const rnd = mulberry32(seed);
    const days = weekDates(s.start).map((date, i) => {
      const day = { date, f: null, m: null, a: null };
      for (const { k } of SLOTS) {
        if (s.grid[i][k] && locked.includes(`${i}-${k}`) && prev && prev[i] && prev[i][k]) day[k] = prev[i][k];
      }
      return day;
    });
    const notes = new Set();
    days.forEach((day, i) => SLOTS.forEach(({ k }) => {
      if (!s.grid[i][k] || locked.includes(`${i}-${k}`)) return;
      fillSlot(s, days, i, k, rnd, locked, notes);
    }));
    return { days, notes: [...notes] };
  }

  // Nach einem neuen Abendessen: die Reste am nächsten Mittag nachziehen.
  function syncLeftovers(i) {
    const s = state.settings; const days = state.days;
    if (i >= 6 || !days[i + 1].m || !days[i + 1].m.rest) return;
    const dinner = days[i].a;
    if (dinner && RECIPE[dinner.r].rest) days[i + 1].m = { r: dinner.r, rest: true };
    else fillSlot(s, days, i + 1, 'm', Math.random, state.locked, new Set(), { exclude: days[i + 1].m.r });
  }

  function newPlan(settings, keepLocks) {
    const locked = keepLocks && state ? state.locked : [];
    const prevDays = keepLocks && state ? state.days : null;
    const { days, notes } = generate(settings, prevDays, locked, newSeed());
    state = {
      settings, days, notes, locked: locked.filter(key => { const [i, k] = key.split('-'); return days[i][k]; }),
      checked: keepLocks && state ? state.checked : {}, extras: state ? state.extras : [],
    };
    save();
  }

  // ---------- Einkaufsliste ----------

  function buildList() {
    const s = state.settings; const P = portions(s);
    const pantry = tokens(s.pantry);
    const items = {};
    for (const day of state.days) {
      for (const { k } of SLOTS) {
        const v = day[k]; if (!v) continue;
        const r = RECIPE[v.r];
        const ings = r.m === 'main' ? [...r.i, ['Salz', 0], ['Pfeffer', 0]] : r.i;
        for (const [name, qty, opt] of ings) {
          if (opt && dropOptional(name, s)) continue;
          const it = items[name] || (items[name] = { name, qty: 0, recipes: new Set() });
          it.qty += qty * P;
          if (!v.rest) it.recipes.add(r.n);
        }
      }
    }
    const groups = CATEGORIES.map(c => ({ ...c, items: [] }));
    for (const it of Object.values(items)) {
      const [cat] = INGREDIENTS[it.name];
      it.cat = cat;
      it.pantry = pantry.length > 0 && ingMatches(pantry, it.name);
      it.basic = cat === 'basis';
      it.key = `i:${it.name}`;
      groups.find(g => g.k === cat).items.push(it);
    }
    groups.forEach(g => g.items.sort((a, b) => a.name.localeCompare(b.name, 'de')));
    return groups.filter(g => g.items.length);
  }

  function isChecked(it) {
    const v = state.checked[it.key];
    if (v !== undefined) return v;
    return it.pantry || (it.basic && state.settings.haveBasics);
  }

  function roundUp(q, step) { return Math.ceil(q / step - 1e-9) * step; }

  function fmtAmount(q, unit, exact) {
    if (!unit) return '';
    if (unit === 'g' || unit === 'ml') {
      const big = unit === 'g' ? 'kg' : 'l';
      if (q >= 1000) return `${num(roundUp(q / 1000, exact ? 0.01 : 0.05))} ${big}`;
      return `${roundUp(q, exact ? 5 : q < 100 ? 5 : 10)} ${unit}`;
    }
    if (unit === 'EL' || unit === 'TL') return `${num(roundUp(q, 0.5))} ${unit}`;
    if (exact) return `${fraction(q)} ${q > 1 ? (UNIT_PLURAL[unit] || unit) : unit}`;
    const n = Math.max(1, Math.ceil(q - 0.1));
    return `${n} ${n > 1 ? (UNIT_PLURAL[unit] || unit) : unit}`;
  }

  function fraction(q) {
    const r = Math.round(q * 4) / 4;
    if (r === 0) return '¼';
    const whole = Math.floor(r); const rest = r - whole;
    const f = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[rest] || '';
    return whole ? `${whole}${f}` : f;
  }

  function listAmount(it) {
    const [, unit, , , pack] = INGREDIENTS[it.name];
    if (!unit) return { main: '', sub: '' };
    if (it.basic) return { main: unit === 'ml' ? `für ${fmtAmount(it.qty, unit)}` : `ca. ${fmtAmount(it.qty, unit)}`, sub: '' };
    if (pack) {
      const n = Math.max(1, Math.ceil(it.qty / pack[0] - 0.1));
      return { main: `${n} ${n > 1 ? pack[2] : pack[1]}`, sub: `à ${fmtAmount(pack[0], unit)} · Bedarf ${fmtAmount(it.qty, unit)}` };
    }
    return { main: `${unit === 'EL' || unit === 'TL' ? 'ca. ' : ''}${fmtAmount(it.qty, unit)}`, sub: '' };
  }

  function listAsText() {
    const s = state.settings;
    const lines = [`🛒 Einkaufsliste ${shortDate(s.start)}–${shortDate(addDays(s.start, 6))}`];
    for (const g of buildList()) {
      const open = g.items.filter(it => !isChecked(it));
      if (!open.length) continue;
      lines.push('', `${g.icon} ${g.label}`);
      for (const it of open) {
        const a = listAmount(it);
        lines.push(`• ${it.name}${a.main ? ` – ${a.main}` : ''}`);
      }
    }
    const extras = state.extras.filter(e => !e.done);
    if (extras.length) {
      lines.push('', '📝 Sonstiges');
      extras.forEach(e => lines.push(`• ${e.text}`));
    }
    return lines.join('\n');
  }

  // ---------- Teilen per Link ----------

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64decode(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  function shareUrl() {
    const d = state.days.map(day => SLOTS.map(({ k }) => (day[k] ? (day[k].rest ? '~' : '') + day[k].r : '')).join(','));
    const payload = { v: 1, s: state.settings, d, l: state.locked };
    return `${location.origin}${location.pathname}#plan=${b64encode(JSON.stringify(payload))}`;
  }

  function importFromHash() {
    const m = location.hash.match(/^#plan=([\w-]+)/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const p = JSON.parse(b64decode(m[1]));
      const settings = { ...defaultSettings(), ...p.s };
      if (!Array.isArray(p.d) || p.d.length !== 7 || !Array.isArray(settings.grid) || settings.grid.length !== 7) throw new Error('format');
      const dates = weekDates(settings.start);
      const days = p.d.map((row, i) => {
        const day = { date: dates[i], f: null, m: null, a: null };
        row.split(',').forEach((id, si) => {
          const rest = id.startsWith('~'); const rid = rest ? id.slice(1) : id;
          if (RECIPE[rid]) day[SLOTS[si].k] = rest ? { r: rid, rest: true } : { r: rid };
        });
        return day;
      });
      if (state && !confirm('Geteilten Wochenplan öffnen? Dein aktueller Plan wird dabei ersetzt.')) return;
      state = { settings, days, notes: [], locked: Array.isArray(p.l) ? p.l : [], checked: {}, extras: state ? state.extras : [] };
      ui.draft = clone(settings); ui.view = 'plan'; ui.tab = 'plan';
      save();
      toast('Geteilter Plan geladen');
    } catch {
      toast('Der Link ist leider ungültig.');
    }
  }

  // ---------- Rendering ----------

  const app = $('#app');

  function render() {
    app.innerHTML = ui.view === 'wizard' ? renderWizard() : renderPlan();
    document.title = ui.view === 'wizard' ? 'Essensplaner – Neue Woche' : 'Essensplaner – Wochenplan';
  }

  const STEPS = ['Haushalt', 'Ernährung', 'Woche', 'Kochen', 'Vorrat'];

  function renderWizard() {
    const d = ui.draft;
    const steps = STEPS.map((label, i) => `
      <li><button type="button" class="step ${i === ui.step ? 'is-current' : ''} ${i < ui.step ? 'is-done' : ''}" data-act="goto-step" data-step="${i}" ${i === ui.step ? 'aria-current="step"' : ''}>
        <span class="step-num">${i < ui.step ? '✓' : i + 1}</span><span class="step-label">${label}</span>
      </button></li>`).join('');
    const body = [stepHousehold, stepDiet, stepWeek, stepCooking, stepPantry][ui.step](d);
    const last = ui.step === STEPS.length - 1;
    return `
      <section class="wizard card">
        <ol class="steps">${steps}</ol>
        <p class="step-count">Schritt ${ui.step + 1} von ${STEPS.length} · ${STEPS[ui.step]}</p>
        <div class="step-body">${body}</div>
        <div class="wizard-nav">
          ${ui.step > 0 ? '<button type="button" class="btn btn-ghost" data-act="prev">← Zurück</button>' : state ? '<button type="button" class="btn btn-ghost" data-act="cancel-wizard">Abbrechen</button>' : '<span></span>'}
          ${last ? '<button type="button" class="btn btn-primary btn-lg" data-act="finish">🪄 Plan erstellen</button>' : '<button type="button" class="btn btn-primary" data-act="next">Weiter →</button>'}
        </div>
      </section>`;
  }

  function stepper(field, value, min, max, label, hint) {
    return `
      <div class="field">
        <span class="field-label">${label}</span>
        <div class="stepper">
          <button type="button" class="btn btn-icon" data-act="dec" data-field="${field}" data-min="${min}" ${value <= min ? 'disabled' : ''} aria-label="${label} verringern">−</button>
          <output>${value}</output>
          <button type="button" class="btn btn-icon" data-act="inc" data-field="${field}" data-max="${max}" ${value >= max ? 'disabled' : ''} aria-label="${label} erhöhen">+</button>
        </div>
        ${hint ? `<small class="hint">${hint}</small>` : ''}
      </div>`;
  }

  function stepHousehold(d) {
    return `
      <h2>Wer isst mit?</h2>
      <p class="lead">Danach richten sich alle Mengen auf der Einkaufsliste.</p>
      <div class="row">
        ${stepper('adults', d.adults, 1, 12, 'Erwachsene / Jugendliche')}
        ${stepper('kids', d.kids, 0, 10, 'Kinder', 'Kinderportionen rechnen wir mit ca. 60 %. Kinderfreundliche Gerichte werden bevorzugt.')}
      </div>
      <p class="pill-note">🍽️ Das sind <strong>${num(portions(d))} Portionen</strong> pro Mahlzeit.</p>`;
  }

  function stepDiet(d) {
    const diets = DIETS.map(x => `
      <label class="choice ${d.diet === x.k ? 'is-on' : ''}">
        <input type="radio" name="diet" value="${x.k}" data-field="diet" ${d.diet === x.k ? 'checked' : ''}>
        <span class="choice-icon">${x.icon}</span>
        <span><strong>${x.label}</strong><small>${x.desc}</small></span>
      </label>`).join('');
    const meat = meatLimited(d) ? `
      <div class="field">
        <label class="field-label" for="maxMeat">Fleisch höchstens <strong>${d.maxMeat}×</strong> pro Woche</label>
        <input type="range" id="maxMeat" min="0" max="7" step="1" value="${d.maxMeat}" data-field="maxMeat">
      </div>` : '';
    const allergies = ALLERGENS.map(a => chip('allergies', a.k, a.label, d.allergies.includes(a.k))).join('');
    return `
      <h2>Wie esst ihr?</h2>
      <div class="choices">${diets}</div>
      ${meat}
      <div class="field">
        <span class="field-label">Unverträglichkeiten</span>
        <div class="chips">${allergies}</div>
      </div>
      <div class="field">
        <label class="field-label" for="dislikes">Was soll nicht auf den Teller?</label>
        <input type="text" id="dislikes" data-field="dislikes" value="${esc(d.dislikes)}" placeholder="z. B. Pilze, Fisch, Kürbis" autocomplete="off">
        <small class="hint">Mehrere Zutaten mit Komma trennen. Gerichte damit werden ausgelassen.</small>
      </div>`;
  }

  function chip(field, value, label, on) {
    return `<button type="button" class="chip ${on ? 'is-on' : ''}" data-act="toggle-chip" data-field="${field}" data-value="${value}" aria-pressed="${on}">${on ? '✓ ' : ''}${esc(label)}</button>`;
  }

  function stepWeek(d) {
    const dates = weekDates(d.start);
    const rows = dates.map((date, i) => `
      <tr class="${isWeekend(date) ? 'is-weekend' : ''}">
        <th scope="row">${dayName(date).slice(0, 2)} <small>${shortDate(date)}</small></th>
        ${SLOTS.map(({ k, label }) => `<td><label class="tick"><input type="checkbox" data-field="grid" data-day="${i}" data-slot="${k}" ${d.grid[i][k] ? 'checked' : ''} aria-label="${dayName(date)} ${label}"><span></span></label></td>`).join('')}
      </tr>`).join('');
    const count = d.grid.reduce((n, g) => n + SLOTS.filter(({ k }) => g[k]).length, 0);
    return `
      <h2>Welche Mahlzeiten planen wir?</h2>
      <div class="row">
        <div class="field">
          <label class="field-label" for="start">Plan startet am</label>
          <input type="date" id="start" data-field="start" value="${d.start}">
        </div>
      </div>
      <div class="presets">
        <span class="field-label">Schnellauswahl</span>
        <div class="chips">
          <button type="button" class="chip" data-act="preset" data-preset="dinner">Nur Abendessen</button>
          <button type="button" class="chip" data-act="preset" data-preset="worker">Werktags abends, Wochenende mittags + abends</button>
          <button type="button" class="chip" data-act="preset" data-preset="lunchdinner">Mittag + Abend</button>
          <button type="button" class="chip" data-act="preset" data-preset="all">Alle Mahlzeiten</button>
        </div>
      </div>
      <table class="grid-table">
        <thead><tr><th></th>${SLOTS.map(s => `<th scope="col"><span aria-hidden="true">${s.icon}</span> ${s.label}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="pill-note">${count === 0 ? '⚠️ Bitte mindestens eine Mahlzeit auswählen.' : `📅 <strong>${count} Mahlzeiten</strong> werden geplant.`}</p>
      <label class="switch">
        <input type="checkbox" data-field="leftovers" ${d.leftovers ? 'checked' : ''}>
        <span class="switch-ui"></span>
        <span><strong>Reste einplanen</strong><small>Abends mehr kochen – das Mittagessen am nächsten Tag sind die Reste. Spart Zeit und Geld.</small></span>
      </label>`;
  }

  function stepCooking(d) {
    const sel = (field, value) => `<select id="${field}" data-field="${field}">${TIMES.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const budgets = BUDGETS.map(b => `
      <label class="seg ${d.budget === b.k ? 'is-on' : ''}"><input type="radio" name="budget" value="${b.k}" data-field="budget" ${d.budget === b.k ? 'checked' : ''}><span class="seg-icon">${b.icon}</span> ${b.label}</label>`).join('');
    const cuisines = Object.entries(CUISINES).map(([k, l]) => chip('cuisines', k, l, d.cuisines.includes(k))).join('');
    return `
      <h2>Kochen & Geschmack</h2>
      <div class="row">
        <div class="field"><label class="field-label" for="timeWeek">Kochzeit unter der Woche (max.)</label>${sel('timeWeek', d.timeWeek)}</div>
        <div class="field"><label class="field-label" for="timeWeekend">Kochzeit am Wochenende (max.)</label>${sel('timeWeekend', d.timeWeekend)}</div>
      </div>
      <div class="field">
        <span class="field-label">Budget</span>
        <div class="segmented">${budgets}</div>
      </div>
      <div class="field">
        <span class="field-label">Was esst ihr besonders gern? <small>(optional, mehrere möglich)</small></span>
        <div class="chips">${cuisines}</div>
      </div>`;
  }

  function stepPantry(d) {
    const diet = DIETS.find(x => x.k === d.diet);
    const meals = d.grid.reduce((n, g) => n + SLOTS.filter(({ k }) => g[k]).length, 0);
    const timeLabel = v => (TIMES.find(t => t[0] === v) || [0, 'egal'])[1];
    return `
      <h2>Was ist schon da?</h2>
      <div class="field">
        <label class="field-label" for="pantry">Vorräte, die du nicht kaufen musst</label>
        <textarea id="pantry" data-field="pantry" rows="3" placeholder="z. B. Reis, Nudeln, Zwiebeln, Kartoffeln, Haferflocken">${esc(d.pantry)}</textarea>
        <small class="hint">Diese Zutaten werden auf der Einkaufsliste automatisch als „im Vorrat“ abgehakt.</small>
      </div>
      <label class="switch">
        <input type="checkbox" data-field="haveBasics" ${d.haveBasics ? 'checked' : ''}>
        <span class="switch-ui"></span>
        <span><strong>Basics sind im Haus</strong><small>Salz, Pfeffer, Öl, Brühe, Gewürze, Essig & Co. nur zum Prüfen auflisten.</small></span>
      </label>
      <div class="summary">
        <h3>Zusammenfassung</h3>
        <ul>
          <li>👥 ${d.adults} Erwachsene${d.kids ? `, ${d.kids} ${d.kids === 1 ? 'Kind' : 'Kinder'}` : ''}</li>
          <li>${diet.icon} ${diet.label}${meatLimited(d) ? ` · Fleisch max. ${d.maxMeat}×` : ''}${d.allergies.length ? ` · ${d.allergies.map(a => ALLERGENS.find(x => x.k === a).label).join(', ')}` : ''}</li>
          ${d.dislikes.trim() ? `<li>🚫 Ohne: ${esc(d.dislikes)}</li>` : ''}
          <li>📅 ${meals} Mahlzeiten ab ${dayName(d.start)}, ${shortDate(d.start)}${d.leftovers ? ' · mit Resteverwertung' : ''}</li>
          <li>⏱️ Werktags ${timeLabel(d.timeWeek)}, am Wochenende ${timeLabel(d.timeWeekend)} · ${BUDGETS.find(b => b.k === d.budget).label}</li>
          ${d.cuisines.length ? `<li>❤️ ${d.cuisines.map(c => CUISINES[c]).join(', ')}</li>` : ''}
        </ul>
      </div>`;
  }

  function settingsLine(s) {
    const diet = DIETS.find(x => x.k === s.diet);
    return [
      `${s.adults} Erw.${s.kids ? ` + ${s.kids} ${s.kids === 1 ? 'Kind' : 'Kinder'}` : ''}`,
      `${diet.icon} ${diet.label}`,
      ...s.allergies.map(a => ALLERGENS.find(x => x.k === a).label),
    ].join(' · ');
  }

  function renderPlan() {
    const s = state.settings;
    const groups = buildList();
    const allItems = groups.flatMap(g => g.items);
    const open = allItems.filter(it => !isChecked(it) && !it.basic).length + state.extras.filter(e => !e.done).length;

    const cooked = [];
    state.days.forEach(day => SLOTS.forEach(({ k }) => { const v = day[k]; if (v && !v.rest) cooked.push(RECIPE[v.r]); }));
    const mains = cooked.filter(r => r.m === 'main');
    const avgTime = mains.length ? Math.round(mains.reduce((n, r) => n + r.t, 0) / mains.length) : 0;
    const veggieShare = mains.length ? Math.round(100 * mains.filter(r => r.d === 'vegan' || r.d === 'veggie').length / mains.length) : 0;
    const rests = state.days.filter(d => d.m && d.m.rest).length;

    const notes = (state.notes || []).map(n => `<p class="notice">ℹ️ ${esc(n)}</p>`).join('');
    return `
      <section class="plan-head">
        <div>
          <h2>Woche vom ${shortDate(s.start)} bis ${shortDate(addDays(s.start, 6))}</h2>
          <p class="muted">${esc(settingsLine(s))}</p>
        </div>
        <div class="actions no-print">
          <button type="button" class="btn" data-act="reroll" title="Alle nicht fixierten Gerichte neu auswählen">🎲 Neu würfeln</button>
          <button type="button" class="btn" data-act="edit">⚙️ Angaben ändern</button>
          <button type="button" class="btn" data-act="share">🔗 Teilen</button>
          <button type="button" class="btn" data-act="print">🖨️ Drucken</button>
        </div>
      </section>
      <section class="stats">
        <div><strong>${mains.length}</strong><span>Mal kochen</span></div>
        <div><strong>${avgTime}<small> Min.</small></strong><span>⌀ Kochzeit</span></div>
        <div><strong>${veggieShare}<small> %</small></strong><span>pflanzlich/veggie</span></div>
        <div><strong>${rests}</strong><span>Reste-Mahlzeiten</span></div>
      </section>
      ${notes}
      <nav class="tabs no-print" role="tablist">
        <button type="button" role="tab" class="tab ${ui.tab === 'plan' ? 'is-on' : ''}" aria-selected="${ui.tab === 'plan'}" data-act="tab" data-tab="plan">📅 Wochenplan</button>
        <button type="button" role="tab" class="tab ${ui.tab === 'list' ? 'is-on' : ''}" aria-selected="${ui.tab === 'list'}" data-act="tab" data-tab="list">🛒 Einkaufsliste <span class="badge">${open}</span></button>
      </nav>
      <section class="panel ${ui.tab === 'plan' ? '' : 'is-hidden'}" role="tabpanel">
        <div class="days">${state.days.map((d, i) => renderDay(d, i)).join('')}</div>
        <p class="muted small no-print">Tipp: Tippe auf ein Gericht für Rezept und Zutaten. 🔄 tauscht, 📌 fixiert ein Gericht beim Neu-Würfeln.</p>
      </section>
      <section class="panel ${ui.tab === 'list' ? '' : 'is-hidden'}" role="tabpanel">
        ${renderList(groups, allItems)}
      </section>`;
  }

  function renderDay(day, i) {
    const s = state.settings;
    const slots = SLOTS.map(({ k, label, icon }) => {
      const v = day[k];
      const key = `${i}-${k}`;
      if (!s.grid[i][k]) {
        if (!s.grid.some(g => g[k])) return '';
        return `<button type="button" class="slot-add no-print" data-act="add-slot" data-day="${i}" data-slot="${k}">+ ${label}</button>`;
      }
      if (!v) {
        return `<div class="slot is-empty"><span class="slot-label">${icon} ${label}</span><p class="muted small">Kein passendes Rezept</p>
          <div class="slot-actions no-print"><button type="button" class="btn btn-icon btn-sm" data-act="pick" data-day="${i}" data-slot="${k}" title="Gericht auswählen" aria-label="Gericht auswählen">✎</button></div></div>`;
      }
      const r = RECIPE[v.r];
      const locked = state.locked.includes(key);
      const tags = [];
      if (v.rest) tags.push('♻️ Reste vom Vortag');
      else {
        tags.push(`⏱️ ${r.t} Min.`);
        if (r.d === 'vegan' || r.d === 'veggie') tags.push(r.d === 'vegan' ? '🌱' : '🧀');
        if (k === 'a' && i < 6 && state.days[i + 1].m && state.days[i + 1].m.rest) tags.push('♻️ doppelte Menge');
      }
      return `
        <div class="slot ${v.rest ? 'is-rest' : ''} ${locked ? 'is-locked' : ''}">
          <span class="slot-label">${icon} ${label}</span>
          <button type="button" class="meal" data-act="recipe" data-day="${i}" data-slot="${k}">
            <span class="meal-emoji" aria-hidden="true">${r.e}</span>
            <span class="meal-text"><span class="meal-name">${esc(r.n)}</span><span class="meal-meta">${tags.join(' · ')}</span></span>
          </button>
          <div class="slot-actions no-print">
            <button type="button" class="btn btn-icon btn-sm" data-act="swap" data-day="${i}" data-slot="${k}" title="${v.rest ? 'Statt Resten etwas anderes' : 'Anderes Gericht'}" aria-label="Gericht tauschen">🔄</button>
            <button type="button" class="btn btn-icon btn-sm" data-act="pick" data-day="${i}" data-slot="${k}" title="Selbst auswählen" aria-label="Gericht selbst auswählen">✎</button>
            ${v.rest ? '' : `<button type="button" class="btn btn-icon btn-sm ${locked ? 'is-on' : ''}" data-act="lock" data-day="${i}" data-slot="${k}" title="${locked ? 'Fixierung lösen' : 'Fixieren'}" aria-label="Fixieren" aria-pressed="${locked}">📌</button>`}
            <button type="button" class="btn btn-icon btn-sm" data-act="remove" data-day="${i}" data-slot="${k}" title="Mahlzeit streichen (z. B. auswärts essen)" aria-label="Mahlzeit streichen">✕</button>
          </div>
        </div>`;
    }).join('');
    return `
      <article class="day ${isWeekend(day.date) ? 'is-weekend' : ''}">
        <header><h3>${dayName(day.date)}</h3><span class="muted">${shortDate(day.date)}</span></header>
        ${slots}
      </article>`;
  }

  function renderList(groups, allItems) {
    const total = allItems.filter(it => !it.basic).length + state.extras.length;
    const done = allItems.filter(it => !it.basic && isChecked(it)).length + state.extras.filter(e => e.done).length;
    const pct = total ? Math.round((100 * done) / total) : 0;
    const row = it => {
      const on = isChecked(it);
      if (on && ui.hideDone && !it.basic) return '';
      const a = listAmount(it);
      const recipes = [...it.recipes].join(', ');
      return `
        <li class="item ${on ? 'is-done' : ''}">
          <label>
            <input type="checkbox" data-act="check" data-key="${esc(it.key)}" ${on ? 'checked' : ''}>
            <span class="item-name">${esc(it.name)}${it.pantry ? ' <span class="tag">im Vorrat</span>' : ''}${recipes && !it.basic ? `<small>${esc(recipes)}</small>` : ''}</span>
            <span class="item-qty">${esc(a.main)}${a.sub ? `<small>${esc(a.sub)}</small>` : ''}</span>
          </label>
        </li>`;
    };
    const normal = groups.filter(g => g.k !== 'basis').map(g => {
      const rows = g.items.map(row).join('');
      return rows ? `<section class="cat"><h3>${g.icon} ${g.label}</h3><ul>${rows}</ul></section>` : '';
    }).join('');
    const basis = groups.find(g => g.k === 'basis');
    const basisHtml = basis ? `
      <details class="cat basics" ${state.settings.haveBasics ? '' : 'open'}>
        <summary><h3>🧂 Basics & Gewürze <small>– kurz prüfen, ob noch genug da ist</small></h3></summary>
        <ul>${basis.items.map(row).join('')}</ul>
      </details>` : '';
    const extras = state.extras.filter(e => !(e.done && ui.hideDone)).map(e => `
      <li class="item ${e.done ? 'is-done' : ''}">
        <label>
          <input type="checkbox" data-act="check-extra" data-id="${e.id}" ${e.done ? 'checked' : ''}>
          <span class="item-name">${esc(e.text)}</span>
          <button type="button" class="btn btn-icon btn-sm no-print" data-act="del-extra" data-id="${e.id}" aria-label="Entfernen">✕</button>
        </label>
      </li>`).join('');
    return `
      <div class="list-tools no-print">
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
        <p class="muted small">${done} von ${total} erledigt</p>
        <div class="actions">
          <button type="button" class="btn btn-sm" data-act="copy-list">📋 Als Text kopieren</button>
          ${navigator.share ? '<button type="button" class="btn btn-sm" data-act="share-list">📤 Senden</button>' : ''}
          <button type="button" class="btn btn-sm ${ui.hideDone ? 'is-on' : ''}" data-act="hide-done" aria-pressed="${ui.hideDone}">${ui.hideDone ? '👁️ Erledigte zeigen' : '🙈 Erledigte ausblenden'}</button>
          <button type="button" class="btn btn-sm" data-act="reset-checks">↺ Häkchen zurücksetzen</button>
        </div>
      </div>
      <div class="list">
        ${normal}
        <section class="cat">
          <h3>📝 Sonstiges</h3>
          <ul>${extras}</ul>
          <form class="add-extra no-print" data-act="add-extra">
            <input type="text" name="text" placeholder="Eigener Artikel, z. B. Spülmittel, Kaffee …" aria-label="Eigener Artikel" autocomplete="off">
            <button type="submit" class="btn btn-sm">Hinzufügen</button>
          </form>
        </section>
        ${basisHtml}
      </div>`;
  }

  // ---------- Dialoge ----------

  const dialog = $('#dialog');
  const dialogBody = $('#dialog-body');

  function openDialog(html) {
    dialogBody.innerHTML = html;
    if (!dialog.open) dialog.showModal();
  }

  function showRecipe(i, k) {
    const v = state.days[i][k];
    const r = RECIPE[v.r];
    const s = state.settings;
    let P = portions(s);
    const cookRest = k === 'a' && i < 6 && state.days[i + 1].m && state.days[i + 1].m.rest;
    if (cookRest) P *= 2;
    const ings = r.i.filter(([name, , opt]) => !(opt && dropOptional(name, s)));
    const fav = favs.has(r.id);
    openDialog(`
      <div class="recipe">
        <div class="recipe-head">
          <span class="recipe-emoji" aria-hidden="true">${r.e}</span>
          <div>
            <h2 id="dialog-title">${esc(r.n)}</h2>
            <p class="muted">${[`⏱️ ${r.t} Min.`, DIET_BADGE[r.d], `<span class="nowrap">${'€'.repeat(r.c)}</span>`, r.k ? CUISINES[r.k] : ''].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        ${v.rest ? `<p class="notice">♻️ Reste vom ${dayName(state.days[i - 1].date)}abend – einfach aufwärmen.</p>` : ''}
        <h3>Zutaten für ${num(P)} Portionen${cookRest ? ' <small>(inkl. Reste für morgen Mittag)</small>' : ''}</h3>
        <ul class="ing">${ings.map(([name, q]) => `<li><span>${esc(name)}</span><span>${esc(fmtAmount(q * P, INGREDIENTS[name][1], true))}</span></li>`).join('')}
          ${r.m === 'main' ? '<li><span>Salz, Pfeffer</span><span></span></li>' : ''}</ul>
        <h3>Zubereitung</h3>
        <ol class="steps-list">${r.s.map(st => `<li>${esc(st)}</li>`).join('')}</ol>
        <div class="dialog-actions">
          <button type="button" class="btn ${fav ? 'is-on' : ''}" data-act="fav" data-id="${r.id}" data-day="${i}" data-slot="${k}" aria-pressed="${fav}">${fav ? '❤️ Lieblingsgericht' : '🤍 Als Liebling merken'}</button>
          <button type="button" class="btn btn-primary" data-act="close-dialog">Schließen</button>
        </div>
      </div>`);
  }

  function showPicker(i, k, query = '') {
    const s = state.settings;
    const pool = k === 'f' ? BREAKFASTS : MAINS;
    const q = query.trim().toLowerCase();
    const current = state.days[i][k] && state.days[i][k].r;
    const list = pool.filter(r => recipeOk(r, s))
      .filter(r => !q || r.n.toLowerCase().includes(q) || r.i.some(([n]) => n.toLowerCase().includes(q)))
      .sort((a, b) => (favs.has(b.id) - favs.has(a.id)) || a.t - b.t || a.n.localeCompare(b.n, 'de'));
    const items = list.map(r => `
      <li><button type="button" class="pick ${r.id === current ? 'is-on' : ''}" data-act="choose" data-id="${r.id}" data-day="${i}" data-slot="${k}">
        <span class="meal-emoji" aria-hidden="true">${r.e}</span>
        <span class="meal-text"><span class="meal-name">${favs.has(r.id) ? '❤️ ' : ''}${esc(r.n)}</span>
        <span class="meal-meta">⏱️ ${r.t} Min. · ${DIET_BADGE[r.d]} · ${'€'.repeat(r.c)}</span></span>
      </button></li>`).join('');
    const html = `
      <h2 id="dialog-title">${SLOTS.find(x => x.k === k).label} am ${dayName(state.days[i].date)}</h2>
      <input type="search" class="picker-search" data-act="picker-search" data-day="${i}" data-slot="${k}" value="${esc(query)}" placeholder="Gericht oder Zutat suchen …" aria-label="Suchen">
      <ul class="picker">${items || '<li class="muted">Nichts gefunden.</li>'}</ul>
      <div class="dialog-actions"><button type="button" class="btn" data-act="close-dialog">Abbrechen</button></div>`;
    if (dialog.open && $('.picker', dialogBody)) {
      $('.picker', dialogBody).innerHTML = items || '<li class="muted">Nichts gefunden.</li>';
    } else {
      openDialog(html);
      $('.picker-search', dialogBody).focus();
    }
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      openDialog(`<h2 id="dialog-title">Zum Kopieren</h2><textarea class="copy-area" rows="10" readonly>${esc(text)}</textarea>
        <div class="dialog-actions"><button type="button" class="btn btn-primary" data-act="close-dialog">Fertig</button></div>`);
      $('.copy-area', dialogBody).select();
    }
  }

  // ---------- Aktionen ----------

  function validateStep() {
    const d = ui.draft;
    if (ui.step === 2) {
      if (!d.start) { toast('Bitte ein Startdatum wählen.'); return false; }
      if (!d.grid.some(g => g.f || g.m || g.a)) { toast('Bitte mindestens eine Mahlzeit auswählen.'); return false; }
    }
    return true;
  }

  function applyPreset(p) {
    const dates = weekDates(ui.draft.start);
    ui.draft.grid = dates.map(date => {
      const we = isWeekend(date);
      if (p === 'dinner') return { f: false, m: false, a: true };
      if (p === 'worker') return { f: false, m: we, a: true };
      if (p === 'lunchdinner') return { f: false, m: true, a: true };
      return { f: true, m: true, a: true };
    });
  }

  function handleAction(el, ev) {
    const act = el.dataset.act;
    const i = el.dataset.day !== undefined ? Number(el.dataset.day) : null;
    const k = el.dataset.slot;
    const d = ui.draft;
    switch (act) {
      case 'goto-step': {
        const target = Number(el.dataset.step);
        if (target > ui.step && !validateStep()) return;
        ui.step = target; render(); scrollTop(); return;
      }
      case 'next': if (!validateStep()) return; ui.step++; render(); scrollTop(); return;
      case 'prev': ui.step--; render(); scrollTop(); return;
      case 'cancel-wizard': ui.view = 'plan'; ui.draft = clone(state.settings); render(); return;
      case 'inc': case 'dec': {
        const f = el.dataset.field;
        d[f] = act === 'inc' ? Math.min(Number(el.dataset.max), d[f] + 1) : Math.max(Number(el.dataset.min), d[f] - 1);
        render(); return;
      }
      case 'toggle-chip': {
        const arr = d[el.dataset.field]; const val = el.dataset.value;
        const idx = arr.indexOf(val);
        if (idx >= 0) arr.splice(idx, 1); else arr.push(val);
        render(); return;
      }
      case 'preset': applyPreset(el.dataset.preset); render(); return;
      case 'finish':
        if (!d.grid.some(g => g.f || g.m || g.a)) { ui.step = 2; render(); toast('Bitte mindestens eine Mahlzeit auswählen.'); return; }
        newPlan(clone(d), false);
        ui.view = 'plan'; ui.tab = 'plan'; render(); scrollTop();
        return;

      case 'tab': ui.tab = el.dataset.tab; render(); return;
      case 'reroll': {
        const { days, notes } = generate(state.settings, state.days, state.locked, newSeed());
        state.days = days; state.notes = notes; save(); render();
        toast(state.locked.length ? 'Neu gewürfelt – fixierte Gerichte bleiben' : 'Neu gewürfelt');
        return;
      }
      case 'edit': ui.draft = clone(state.settings); ui.step = 0; ui.view = 'wizard'; render(); scrollTop(); return;
      case 'share': copyText(shareUrl(), 'Link kopiert – wer ihn öffnet, sieht deinen Plan'); return;
      case 'print': window.print(); return;
      case 'swap': {
        const v = state.days[i][k];
        fillSlot(state.settings, state.days, i, k, Math.random, state.locked, new Set(), { exclude: v.r });
        if (!state.days[i][k]) state.days[i][k] = v; // keine Alternative gefunden
        if (k === 'a') syncLeftovers(i);
        save(); render(); return;
      }
      case 'lock': {
        const key = `${i}-${k}`;
        state.locked = state.locked.includes(key) ? state.locked.filter(x => x !== key) : [...state.locked, key];
        save(); render(); return;
      }
      case 'remove': {
        state.settings.grid[i][k] = false;
        state.days[i][k] = null;
        state.locked = state.locked.filter(x => x !== `${i}-${k}`);
        if (k === 'a' && i < 6 && state.days[i + 1].m && state.days[i + 1].m.rest) {
          state.days[i + 1].m = null;
          fillSlot(state.settings, state.days, i + 1, 'm', Math.random, state.locked, new Set());
        }
        save(); render(); return;
      }
      case 'add-slot': {
        state.settings.grid[i][k] = true;
        fillSlot(state.settings, state.days, i, k, Math.random, state.locked, new Set());
        save(); render(); return;
      }
      case 'recipe': showRecipe(i, k); return;
      case 'pick': showPicker(i, k); return;
      case 'choose': {
        state.days[i][k] = { r: el.dataset.id };
        const key = `${i}-${k}`;
        if (!state.locked.includes(key)) state.locked.push(key);
        if (k === 'a') syncLeftovers(i);
        save(); dialog.close(); render(); toast('Gericht gesetzt und fixiert 📌');
        return;
      }
      case 'fav': {
        const id = el.dataset.id;
        if (favs.has(id)) favs.delete(id); else favs.add(id);
        saveFavs(); showRecipe(i, k); return;
      }
      case 'close-dialog': dialog.close(); return;

      case 'check': {
        const key = el.dataset.key;
        state.checked[key] = el.checked; save(); render(); return;
      }
      case 'check-extra': {
        const e = state.extras.find(x => x.id === el.dataset.id);
        if (e) e.done = el.checked; save(); render(); return;
      }
      case 'del-extra':
        ev.preventDefault();
        state.extras = state.extras.filter(x => x.id !== el.dataset.id); save(); render(); return;
      case 'copy-list': copyText(listAsText(), 'Einkaufsliste kopiert'); return;
      case 'share-list':
        navigator.share({ title: 'Einkaufsliste', text: listAsText() }).catch(() => {});
        return;
      case 'hide-done': ui.hideDone = !ui.hideDone; render(); return;
      case 'reset-checks':
        state.checked = {}; state.extras.forEach(e => { e.done = false; }); save(); render(); return;
      default:
    }
  }

  function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'FORM' || el.dataset.act === 'picker-search') return;
    if (el.type === 'checkbox') return; // über „change“ behandelt
    handleAction(el, ev);
  });

  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.act === 'check' || el.dataset.act === 'check-extra') { handleAction(el, ev); return; }
    const f = el.dataset.field;
    if (!f || ui.view !== 'wizard') return;
    const d = ui.draft;
    if (f === 'grid') d.grid[Number(el.dataset.day)][el.dataset.slot] = el.checked;
    else if (f === 'leftovers' || f === 'haveBasics') d[f] = el.checked;
    else if (f === 'maxMeat' || f === 'timeWeek' || f === 'timeWeekend') d[f] = Number(el.value);
    else if (f === 'start') { if (el.value) d.start = el.value; }
    else if (f === 'diet') { d.diet = el.value; d.maxMeat = el.value === 'flexi' ? 2 : 4; }
    else d[f] = el.value;
    if (!['dislikes', 'pantry'].includes(f)) render();
  });

  document.addEventListener('input', ev => {
    const el = ev.target;
    if (el.dataset.act === 'picker-search') { showPicker(Number(el.dataset.day), el.dataset.slot, el.value); return; }
    const f = el.dataset.field;
    if (ui.view !== 'wizard' || !f) return;
    if (f === 'dislikes' || f === 'pantry') ui.draft[f] = el.value;
    if (f === 'maxMeat') {
      ui.draft.maxMeat = Number(el.value);
      const lbl = $('label[for="maxMeat"] strong');
      if (lbl) lbl.textContent = `${el.value}×`;
    }
  });

  document.addEventListener('submit', ev => {
    const form = ev.target;
    if (form.dataset.act !== 'add-extra') return;
    ev.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    state.extras.push({ id: Date.now().toString(36), text, done: false });
    save(); render();
    const input = $('.add-extra input'); if (input) input.focus();
  });

  dialog.addEventListener('click', ev => { if (ev.target === dialog) dialog.close(); });

  $('#brand').addEventListener('click', ev => {
    ev.preventDefault();
    if (state) { ui.view = 'plan'; render(); }
  });

  importFromHash();
  window.addEventListener('hashchange', () => { importFromHash(); render(); });
  render();
})();
