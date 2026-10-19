'use strict';

// The Ninjago playtest tracker as a home-screen web app. Its data is the JSON the playtest PC exports
// (tools/playtest_dashboard.py), published next to this page under data/.
(() => {
  const SOURCES = ['status', 'items', 'runs', 'events', 'bugs'];
  const CHAPTERS = ['Whole game', 'Pilot', 'Ch. 1', 'Ch. 2', 'Ch. 3', 'Ch. 4', 'Ch. 5', 'Ch. 6'];
  const VERDICTS = ['All', 'Pass', 'Fail', 'Unverified', 'Not reached'];
  const TABS = ['now', 'runs', 'items', 'bugs'];
  const POLL_MS = 60 * 1000;
  const STALE_MIN = 120;

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false || kid === '') continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }

  const minutesSince = (iso) => (Date.now() - new Date(iso)) / 60000;
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  const dayTime = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const day = (ymd) => (ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '');
  const dur = (m) => (m == null ? '' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  function ago(iso) {
    if (!iso) return '';
    const m = Math.round(minutesSince(iso));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 1440) return `${dur(m)} ago`;
    return `${Math.floor(m / 1440)} d ago`;
  }
  const slug = (v) => String(v || '').replace(/\s+/g, '-');
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '0%');

  const state = {
    data: null,
    fromCache: false,
    failed: false,
    tab: 'now',
    q: '',
    verdict: store.get('pt-verdict') || 'All',
    chapter: store.get('pt-chapter') || '',
  };

  // ---- data: always from the network, the service worker's copy only when offline
  async function fetchJson(name) {
    const r = await fetch(`data/${name}.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`);
    return { cached: r.headers.get('x-pt-cache') === '1', rows: await r.json() };
  }
  let loading = null;
  function load() {
    if (loading) return loading;
    $('refresh').classList.add('spin');
    loading = Promise.all(SOURCES.map(fetchJson))
      .then((parts) => {
        state.data = Object.fromEntries(SOURCES.map((n, i) => [n, parts[i].rows]));
        state.fromCache = parts.some((p) => p.cached);
        state.failed = false;
      })
      .catch((e) => {
        console.warn(e);
        state.failed = true;
      })
      .finally(() => {
        loading = null;
        $('refresh').classList.remove('spin');
        render();
      });
    return loading;
  }

  const status = () => state.data?.status?.[0];
  const thisRun = () => (state.data?.runs || []).find((r) => r.run === status()?.run);

  // ---- header and banner (redrawn every half minute so "ago" stays true)
  function renderChrome() {
    const s = status();
    const pill = $('state');
    pill.textContent = s ? s.state : state.failed ? 'Offline' : 'Loading';
    pill.dataset.state = s ? s.state : '';
    const sub = $('updated');
    if (!s) sub.textContent = state.failed ? "Can't reach the tracker data." : 'Fetching the latest from the playtest PC…';
    else sub.textContent = `Updated ${ago(s.updated)}${state.fromCache ? ' · offline copy' : ''}`;

    const banner = $('banner');
    let msg = '';
    if (s && state.fromCache) msg = `You're offline. This is the copy from ${dayTime(s.updated)}.`;
    else if (s && state.failed) msg = `Couldn't refresh just now. Showing the data from ${dayTime(s.updated)}.`;
    else if (s && minutesSince(s.updated) > STALE_MIN) msg = `No update from the playtest PC for ${ago(s.updated).replace(' ago', '')}. The tracker updates while the playtest runs.`;
    banner.textContent = msg;
    banner.hidden = !msg;
  }

  // ---- now
  function renderNow() {
    const s = status();
    const run = thisRun();
    const live = s.state === 'Running' || s.state === 'Story sweep';
    $('run').textContent = s.run ?? '—';
    $('build').textContent = s.build ? `build ${s.build}` : '';
    $('objective').textContent = s.objective || s.now || '—';
    $('doing').textContent = live && s.now && s.now !== s.objective ? `Doing: ${s.now}` : !live ? s.now || '' : '';
    const why = !live && run && !['Running now', 'Stopped; a fix is being tested'].includes(run.stopped_by) ? run.stopped_by : !live ? s.stopped_by : '';
    $('stopped').textContent = why ? `Stopped: ${why.replace(/^STOP: /, '')}` : '';
    $('stopped').hidden = !why;
    $('started').textContent = s.started ? `Started ${dayTime(s.started)}` : '';
    const ran = live ? Math.max(0, Math.round((new Date(s.updated) - new Date(s.started)) / 60000)) : run?.minutes;
    $('elapsed').textContent = ran == null ? '' : live ? `${dur(ran)} in` : `ran ${dur(ran)}`;

    $('pass').textContent = s.pass;
    $('pass-meter').style.width = s.total ? `${(100 * s.pass) / s.total}%` : '0';
    $('pass-share').textContent = `${pct(s.pass, s.total)} of ${s.total}`;
    $('fail').textContent = s.fail;
    $('fail').classList.toggle('bad', s.fail > 0);
    $('unverified').textContent = s.unverified ? `${s.unverified} unverified` : 'None unverified';
    $('quests').textContent = s.quests_done;
    $('furthest').textContent = s.furthest ? `Last: ${s.furthest}` : '';
    $('deaths').textContent = s.deaths;

    $('hp').textContent = s.hp == null ? '—' : `${s.hp} / 20`;
    $('food').textContent = s.food == null ? '—' : `${s.food} / 20`;
    $('hp-meter').style.width = `${(100 * (s.hp || 0)) / 20}%`;
    $('food-meter').style.width = `${(100 * (s.food || 0)) / 20}%`;
    $('where').textContent = s.where || '—';
    $('seen').textContent = s.last_seen ? `${time(s.last_seen)} (${ago(s.last_seen)})` : '—';

    const list = $('events');
    const rows = (state.data.events || []).slice(0, 40);
    list.replaceChildren(...(rows.length ? rows.map((e) => h('li', null,
      h('span', { class: 'ev-time', text: e.time.slice(0, 5) }),
      h('span', { class: 'ev-text' }, h('span', { class: `chip k-${slug(e.kind)}`, text: e.kind }), e.text),
    )) : [h('li', { class: 'empty', text: 'Nothing yet this run.' })]));
  }

  // ---- runs
  function niceStep(max) {
    for (const step of [5, 10, 20, 25, 50, 100]) if (max / step <= 5) return step;
    return 200;
  }
  function renderRuns() {
    const runs = state.data.runs || [];
    const rows = runs.filter((r) => r.passes != null);
    const latest = runs.length ? runs[runs.length - 1].run : null;
    const box = $('runs-chart');
    const width = Math.max(300, box.clientWidth || 340);
    const height = 170;
    const m = { t: 8, r: 4, b: 22, l: 28 };
    const max = Math.max(10, ...rows.map((r) => r.passes));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const y = (v) => m.t + (height - m.t - m.b) * (1 - v / top);
    const band = (width - m.l - m.r) / Math.max(1, rows.length);
    const bw = Math.max(3, band * 0.72);
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Items passed in each run' });
    for (let v = 0; v <= top; v += step) {
      chart.append(svg('line', { x1: m.l, x2: width - m.r, y1: y(v), y2: y(v), stroke: 'var(--line)' }));
      chart.append(svg('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, v));
    }
    const every = Math.ceil(rows.length / Math.max(1, Math.floor((width - m.l) / 26)));
    rows.forEach((r, i) => {
      const x = m.l + i * band + (band - bw) / 2;
      const fill = r.run === latest ? 'var(--ok)' : r.cause === 'mod bug' ? 'var(--bad)' : 'var(--idle-strong)';
      chart.append(svg('rect', { x, y: y(r.passes), width: bw, height: Math.max(0, y(0) - y(r.passes)), rx: Math.min(3, bw / 3), fill }));
      const hit = svg('rect', { class: 'bar-hit', x: m.l + i * band, y: m.t, width: band, height: height - m.t - m.b, fill: 'transparent' });
      hit.append(svg('title', null, `Run ${r.run}: ${r.passes} passed`));
      hit.addEventListener('click', () => {
        const card = $(`run-${r.run}`);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
      });
      chart.append(hit);
      if (i % every === 0 || i === rows.length - 1) {
        chart.append(svg('text', { x: m.l + i * band + band / 2, y: height - 6, 'text-anchor': 'middle' }, r.run));
      }
    });
    box.replaceChildren(chart);

    $('runs').replaceChildren(...runs.slice().reverse().map((r) => {
      const cause = r.run === latest && (r.cause === 'running' || r.cause === 'stopped') ? 'latest' : r.cause;
      const label = cause === 'latest' ? (r.cause === 'running' ? 'running' : 'latest') : r.cause;
      const figs = [r.passes != null && `${r.passes} passed`, r.fails ? `${r.fails} failed` : null, r.deaths != null && `${r.deaths} deaths`]
        .filter(Boolean).join(' · ');
      return h('li', { class: 'card run', id: `run-${r.run}` },
        h('div', { class: 'run-head' },
          h('span', { class: 'run-title', text: `Run ${r.run}` }),
          h('span', { class: 'run-meta', text: [day(r.date), dur(r.minutes)].filter(Boolean).join(' · ') })),
        figs && h('p', { class: 'run-figs', text: figs + (r.furthest ? ` · last quest: ${r.furthest}` : '') }),
        r.stopped_by && h('p', { class: 'run-text', text: r.stopped_by }),
        h('div', { class: 'run-foot' },
          h('span', { class: `chip c-${slug(cause)}`, text: label }),
          r.fix && h('span', { class: 'mono', text: `fix ${r.fix}` }),
          r.build && h('span', { class: 'mono', text: `build ${r.build}` })));
    }));
  }

  // ---- items
  function setChapter(c) {
    state.chapter = state.chapter === c ? '' : c;
    store.set('pt-chapter', state.chapter);
    renderItems();
    if (state.chapter) $('filters').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderItems() {
    const items = state.data.items || [];
    const parts = [['Pass', 'var(--ok)'], ['Fail', 'var(--bad)'], ['Unverified', 'var(--warn)']];
    $('chapters').replaceChildren(...CHAPTERS.map((c) => {
      const rows = items.filter((d) => d.chapter === c);
      if (!rows.length) return null;
      const n = (v) => rows.filter((d) => d.status === v).length;
      return h('button', { class: 'chapter', type: 'button', 'aria-pressed': String(state.chapter === c), onclick: () => setChapter(c) },
        h('span', { class: 'ch-name', text: c }),
        h('span', { class: 'ch-bar' }, ...parts.map(([v, col]) => (n(v) ? h('span', { style: `width:${(100 * n(v)) / rows.length}%;background:${col}` }) : null))),
        h('span', { class: 'ch-n', text: `${n('Pass')} / ${rows.length}` }));
    }).filter(Boolean));

    $('verdicts').replaceChildren(...VERDICTS.map((v) => {
      const count = v === 'All' ? items.length : items.filter((d) => d.status === v).length;
      return h('button', {
        class: 'seg', type: 'button', 'aria-pressed': String(state.verdict === v),
        onclick: () => { state.verdict = v; store.set('pt-verdict', v); renderItems(); },
      }, `${v} ${count}`);
    }));

    const q = state.q.trim().toLowerCase();
    const rows = items.filter((d) => (state.verdict === 'All' || d.status === state.verdict)
      && (!state.chapter || d.chapter === state.chapter)
      && (!q || `${d.item} ${d.id} ${d.kind} ${d.note} ${d.happened}`.toLowerCase().includes(q)));
    $('item-count').textContent = `${rows.length} of ${items.length} items`;
    const clear = $('clear-chapter');
    clear.hidden = !state.chapter;
    clear.textContent = state.chapter ? `${state.chapter} only · show all` : '';

    const list = $('items');
    if (!rows.length) {
      list.replaceChildren(h('li', { class: 'empty', text: 'No items match.' }));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const d of rows) {
      frag.append(h('li', null,
        h('span', { class: 'it-name' }, h('span', { class: 'it-n', text: d.n }), d.item),
        h('span', { class: `chip k-${slug(d.status)}`, text: d.status }),
        h('span', { class: 'it-sub', text: `${d.chapter} · ${d.kind}` }),
        d.note && h('span', { class: 'it-note', text: d.note })));
    }
    list.replaceChildren(frag);
  }

  // ---- bugs
  function renderBugs() {
    const bugs = state.data.bugs || [];
    $('bugs').replaceChildren(...bugs.slice().reverse().map((b) => h('li', { class: 'card' },
      h('p', { class: 'bug-title', text: `${b.n}. ${b.bug}` }),
      h('div', { class: 'run-foot' }, h('span', { text: `Found in ${b.found}` }), h('span', { class: 'mono', text: `fix ${b.commit}` })))));
  }

  // ---- tabs
  const RENDER = { now: renderNow, runs: renderRuns, items: renderItems, bugs: renderBugs };
  function renderTab() {
    if (!state.data) {
      const msg = state.failed ? "Can't reach the tracker data right now. It'll try again in a minute." : 'Loading…';
      const box = $(`tab-${state.tab}`);
      if (!box.querySelector('.empty.loading')) box.prepend(h('div', { class: 'empty loading' }));
      box.querySelector('.empty.loading').textContent = msg;
      return;
    }
    document.querySelectorAll('.empty.loading').forEach((el) => el.remove());
    RENDER[state.tab]();
  }
  function render() {
    renderChrome();
    renderTab();
  }
  function setTab(t, { scroll = true } = {}) {
    if (!TABS.includes(t)) t = 'now';
    state.tab = t;
    store.set('pt-tab', t);
    for (const id of TABS) $(`tab-${id}`).hidden = id !== t;
    document.querySelectorAll('.tabs a').forEach((a) => {
      if (a.dataset.tab === t) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (location.hash !== `#${t}`) history.replaceState(null, '', `#${t}`);
    renderTab();
    if (scroll) window.scrollTo(0, 0);
  }

  function measureBar() {
    document.documentElement.style.setProperty('--bar-h', `${$('bar').offsetHeight}px`);
  }

  function start() {
    document.querySelectorAll('.tabs a').forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (a.dataset.tab === state.tab) window.scrollTo({ top: 0, behavior: 'smooth' });
      else setTab(a.dataset.tab);
    }));
    window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));
    $('refresh').addEventListener('click', () => load());
    $('q').addEventListener('input', (ev) => { state.q = ev.target.value; renderItems(); });
    $('clear-chapter').addEventListener('click', () => setChapter(state.chapter));
    window.addEventListener('resize', () => { measureBar(); if (state.data && state.tab === 'runs') renderRuns(); });
    measureBar();

    let timer = null;
    const schedule = () => {
      clearInterval(timer);
      if (document.visibilityState === 'visible') timer = setInterval(load, POLL_MS);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') load();
      schedule();
    });
    window.addEventListener('online', () => load());
    setInterval(() => { renderChrome(); if (state.data && state.tab === 'now') renderNow(); }, 30 * 1000);
    schedule();

    setTab(location.hash.slice(1) || store.get('pt-tab') || 'now', { scroll: false });
    load();

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
    }
  }

  start();
})();
