/* Blundr Live — parent view. Reads data/live.json (written by scraper/live.mjs). */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const DATA_URL = 'data/live.json';
  const REFRESH_MS = 20000;
  let data = null;
  let failures = 0;
  let followed = safeGet('blundr.follow');      // {name, section}
  let openSection = safeGet('blundr.section') || null;
  let openRound = {};                            // section -> round shown in boards view

  function safeGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  function safeSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }

  const fmtTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const clean = s => (s || '').replace(/\s+\.$/, '').trim(); // Tornelo hides some surnames as " ."

  // ---------- data
  async function load() {
    try {
      const r = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
      failures = 0;
      render();
    } catch (e) {
      failures++;
      if (failures < 2 && data) return; // one blip is normal while the file is being rewritten
      $('#updated').textContent = data ? 'Connection lost. Showing the last update.' : 'Could not load results yet.';
      $('#updated').classList.add('stale');
    }
  }

  function allPlayers() {
    const out = [];
    const rosterSeen = new Set();
    for (const p of data.roster || []) if (data.sections[p.section]) { rosterSeen.add(p.section + '|' + norm(p.name)); out.push({ name: p.name, section: p.section }); }
    for (const sec of Object.values(data.sections)) {
      const seen = new Set([...rosterSeen].filter(k => k.startsWith(sec.slug + '|')).map(k => k.split('|')[1]));
      const add = n => { if (n && !seen.has(norm(n))) { seen.add(norm(n)); out.push({ name: n, section: sec.slug }); } };
      for (const s of sec.standings) add(s.name);
      for (const rows of Object.values(sec.rounds)) for (const r of rows) { add(r.white); add(r.black); }
    }
    return out;
  }
  function allPlayersOld() {
    const out = [];
    for (const sec of Object.values(data.sections)) {
      const seen = new Set();
      for (const s of sec.standings) { seen.add(s.name); out.push({ name: s.name, section: sec.slug }); }
      for (const rows of Object.values(sec.rounds)) for (const r of rows) for (const n of [r.white, r.black]) if (n && !seen.has(n)) { seen.add(n); out.push({ name: n, section: sec.slug }); }
    }
    return out;
  }

  function playerHistory(name, sec) {
    const rounds = [];
    const nums = Object.keys(sec.rounds).map(Number).sort((a, b) => a - b);
    for (const n of nums) {
      const row = sec.rounds[n].find(r => r.white === name || r.black === name);
      if (!row) { rounds.push({ round: n, bye: true }); continue; }
      const isWhite = row.white === name;
      const opp = isWhite ? row.black : row.white;
      let outcome = null; // win/loss/draw/live
      if (row.result) {
        const [w, b] = row.result.split('-');
        const mine = isWhite ? w : b;
        outcome = mine.startsWith('1') ? 'win' : mine.startsWith('½') ? 'draw' : 'loss';
      }
      rounds.push({ round: n, board: row.board, colour: isWhite ? 'White' : 'Black', opponent: opp, result: row.result, outcome });
    }
    return rounds;
  }

  // ---------- render
  let render = function () {
    const gen = new Date(data.generatedAt);
    const ageMin = (Date.now() - gen) / 60000;
    const u = $('#updated');
    u.textContent = `Updated ${fmtTime(data.generatedAt)}`;
    u.classList.toggle('stale', ageMin > 5);
    if (ageMin > 5) u.textContent += ` · ${Math.round(ageMin)} min ago`;
    $('#event-name').textContent = data.event.name;
    $('#tornelo-link').href = data.event.tornelo;

    // announcements
    const ann = $('#announcements'), list = $('#announce-list');
    list.replaceChildren();
    const items = (data.announcements || []).slice(-6).reverse();
    ann.hidden = items.length === 0;
    for (const a of items) list.append(el('li', {}, el('time', {}, fmtTime(a.at)), el('div', {}, a.text)));

    // next round
    const nr = $('#next-round');
    if (data.nextRound && (data.nextRound.startsAt || data.nextRound.number)) {
      nr.hidden = false;
      nr.replaceChildren(
        el('div', {}, el('div', { class: 'big' }, data.nextRound.startsAt || ''), el('div', { class: 'sub' }, `Round ${data.nextRound.number || ''} starts`)),
        el('div', { class: 'sub' }, data.nextRound.note || 'Players to their boards five minutes before. Pairings appear here as soon as they are published.'));
    } else nr.hidden = true;

    renderFollowed();
    renderBrowse();
    renderSections();
    renderBoards();
  }

  function renderFollowed() {
    const box = $('#player');
    if (!followed) { box.hidden = true; return; }
    const sec = data.sections[followed.section];
    if (!sec) { box.hidden = true; return; }
    const name = followed.name;
    const st = sec.standings.find(s => s.name === name);
    const hist = playerHistory(name, sec);
    const cur = hist.find(h => h.round === sec.currentRound);
    box.hidden = false;
    box.replaceChildren(
      el('div', { class: 'head' },
        el('div', {}, el('div', { class: 'name' }, clean(name)), el('div', { class: 'meta' }, `${sec.name} section`)),
        el('button', { class: 'forget', onclick: () => { followed = null; safeSet('blundr.follow', null); render(); } }, 'Change player')),
      checkinBlock(name, sec),
      cur ? nowBlock(cur, sec) : el('p', { class: 'empty' }, sec.currentRound ? `No game listed for round ${sec.currentRound}. Please ask at the desk.` : 'Round 1 pairings are not published yet.'),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', {}, st ? st.score : '–'), el('span', {}, 'points')),
        el('div', { class: 'stat' }, el('b', {}, st ? `${st.rank}` : '–'), el('span', {}, `of ${sec.standings.length || '–'}`)),
        el('div', { class: 'stat' }, el('b', {}, `${sec.currentRound || 0}/${sec.totalRounds || 6}`), el('span', {}, 'rounds'))),
      historyTable(hist));
  }

  // Check-in: shown until round 1 is paired. Opens the pre-filled form; one tap on Submit there.
  function checkinBlock(name, sec) {
    const ci = data.checkin;
    if (!ci || !ci.enabled || !ci.formUrl) return null;
    if (sec.currentRound) return null; // pairings exist: check-in is over
    const arrived = (ci.arrived || []).some(a => norm(a.name) === norm(name));
    const local = safeGet('blundr.checkedin.' + norm(name));
    if (arrived) return el('div', { class: 'checkin done' }, el('strong', {}, 'Checked in ✓'), el('span', {}, ` ${clean(name)} is on the list for round 1.`));
    if (local) return el('div', { class: 'checkin pending' }, el('strong', {}, 'Thanks, we have it.'), el('span', {}, ' This will show as checked in within a couple of minutes. If it does not, tell the desk.'));
    const url = ci.formUrl.replace('NAME', encodeURIComponent(name)).replace('SECTION', encodeURIComponent(sec.slug));
    return el('div', { class: 'checkin' },
      el('a', { class: 'bigbtn', href: url, target: '_blank', rel: 'noopener', onclick: () => { safeSet('blundr.checkedin.' + norm(name), Date.now()); setTimeout(render, 300); } }, `We're here: check ${clean(name).split(' ')[0]} in`),
      el('p', { class: 'small' }, `One tap on Submit on the next screen. Check-in closes at ${ci.closesAt || '09:40'}; anyone not checked in is left out of round 1.`));
  }

  function nowBlock(h, sec) {
    if (h.bye) return el('div', { class: 'now' }, el('div', { class: 'board' }, '—', el('small', {}, 'board')), el('div', { class: 'detail' }, el('strong', {}, `Round ${h.round}: no game this round`), el('span', {}, 'A bye scores one point. Check with the desk if this looks wrong.')));
    const pill = h.outcome ? el('span', { class: `pill ${h.outcome}` }, h.outcome === 'win' ? 'Won' : h.outcome === 'loss' ? 'Lost' : 'Draw') : el('span', { class: 'pill live' }, 'Playing');
    return el('div', { class: 'now' },
      el('div', { class: 'board' }, h.board, el('small', {}, `${sec.name} board`)),
      el('div', { class: 'detail' },
        el('strong', {}, `Round ${h.round} v ${clean(h.opponent) || 'TBC'}`),
        el('span', {}, el('span', { class: `pill ${h.colour.toLowerCase()}` }, h.colour), ' ', pill, h.result ? ` ${h.result.replace('-', ' – ')}` : '')));
  }

  function historyTable(hist) {
    const t = el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Rd'), el('th', {}, 'Opponent'), el('th', {}, 'Colour'), el('th', { class: 'num' }, 'Result'))));
    const tb = el('tbody');
    for (const h of hist) {
      if (h.bye) { tb.append(el('tr', {}, el('td', {}, h.round), el('td', {}, 'Bye'), el('td', {}, '–'), el('td', { class: 'num' }, '1'))); continue; }
      const label = h.outcome === 'win' ? 'Won' : h.outcome === 'loss' ? 'Lost' : h.outcome === 'draw' ? 'Draw' : 'Playing';
      tb.append(el('tr', {}, el('td', {}, h.round), el('td', {}, `${clean(h.opponent) || 'TBC'} `, el('span', { class: 'small' }, `(board ${h.board})`)), el('td', {}, h.colour), el('td', { class: 'num' }, el('span', { class: `pill ${h.outcome || 'live'}` }, label))));
    }
    t.append(tb);
    return t;
  }

  function renderSections() {
    const box = $('#sections');
    const secs = Object.values(data.sections);
    if (!openSection || !data.sections[openSection]) openSection = followed?.section || secs[0]?.slug;
    box.replaceChildren(el('h2', {}, 'Standings'));
    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    for (const s of secs) tabs.append(el('button', { role: 'tab', 'aria-selected': String(s.slug === openSection), onclick: () => { openSection = s.slug; safeSet('blundr.section', s.slug); render(); } }, s.name));
    box.append(tabs);
    const sec = data.sections[openSection];
    if (!sec) return;
    const statusText = sec.status === 'not-paired' ? 'Round 1 not yet paired.' : sec.progress ? `Round ${sec.currentRound} of ${sec.totalRounds}: ${sec.progress.entered} of ${sec.progress.boards} results in.` : '';
    box.append(el('p', { class: 'status' }, statusText));
    if (!sec.standings.length) { box.append(el('p', { class: 'empty' }, 'Standings appear after the first results.')); return; }
    const t = el('table', {}, el('thead', {}, el('tr', {}, el('th', { class: 'num' }, '#'), el('th', {}, 'Player'), el('th', { class: 'num' }, 'Pts'))));
    const tb = el('tbody');
    for (const s of sec.standings) tb.append(el('tr', { class: followed && followed.name === s.name ? 'me' : '' }, el('td', { class: 'num' }, s.rank), el('td', {}, el('button', { class: 'linklike', onclick: () => follow(s.name, sec.slug) }, clean(s.name))), el('td', { class: 'num' }, s.score ?? '')));
    t.append(tb); box.append(t);
  }

  function renderBoards() {
    const box = $('#boards');
    const sec = data.sections[openSection];
    box.replaceChildren(el('h2', {}, 'Pairings and results'));
    if (!sec || !sec.currentRound) { box.append(el('p', { class: 'empty' }, 'Pairings appear here when the arbiter publishes them.')); return; }
    const nums = Object.keys(sec.rounds).map(Number).sort((a, b) => a - b);
    const shown = openRound[sec.slug] && nums.includes(openRound[sec.slug]) ? openRound[sec.slug] : sec.currentRound;
    const sub = el('div', { class: 'subtabs' });
    for (const n of nums) sub.append(el('button', { 'aria-selected': String(n === shown), onclick: () => { openRound[sec.slug] = n; render(); } }, `Round ${n}`));
    box.append(sub);
    const t = el('table', {}, el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Bd'), el('th', {}, 'White'), el('th', { class: 'num' }, 'Result'), el('th', {}, 'Black'))));
    const tb = el('tbody');
    for (const r of sec.rounds[shown]) {
      const me = followed && (r.white === followed.name || r.black === followed.name);
      tb.append(el('tr', { class: me ? 'me' : '' }, el('td', { class: 'num' }, r.board), el('td', {}, clean(r.white)), el('td', { class: 'num' }, r.result ? r.result.replace('-', '–') : el('span', { class: 'pill live' }, '…')), el('td', {}, clean(r.black) || 'bye')));
    }
    t.append(tb); box.append(t);
  }

  function follow(name, section) {
    followed = { name, section };
    safeSet('blundr.follow', followed);
    openSection = section; safeSet('blundr.section', section);
    $('#q').value = ''; $('#matches').replaceChildren();
    render();
    $('#player').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- browse (poster QR lands here: ?browse=1). Section buttons, then every name. No typing.
  function renderBrowse() {
    const box = $('#browse'); if (!box || !data) return;
    box.replaceChildren(el('h2', {}, 'Or pick a section'));
    const tabs = el('div', { class: 'tabs' });
    let open = browseSection && data.sections[browseSection] ? browseSection : null;
    for (const s of Object.values(data.sections)) tabs.append(el('button', { 'aria-selected': String(s.slug === open), onclick: () => { browseSection = s.slug; renderBrowse(); } }, s.name));
    box.append(tabs);
    if (!open) return;
    const names = allPlayers().filter(p => p.section === open).sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
    if (!names.length) { box.append(el('p', { class: 'empty' }, 'Names appear once this section has been paired.')); return; }
    const ul = el('ul', { class: 'matches' });
    for (const p of names) ul.append(el('li', {}, el('button', { onclick: () => follow(p.name, p.section) }, clean(p.name))));
    box.append(ul);
  }
  let browseSection = null;

  // ---------- search
  $('#q').addEventListener('input', e => {
    const q = norm(e.target.value);
    const ul = $('#matches'); ul.replaceChildren();
    if (!data || q.length < 2) return;
    const hits = allPlayers().filter(p => norm(p.name).includes(q)).slice(0, 8);
    if (!hits.length) { ul.append(el('li', { class: 'empty' }, 'No player with that name yet. Names appear once the section has been paired.')); return; }
    for (const p of hits) ul.append(el('li', {}, el('button', { onclick: () => follow(p.name, p.section) }, clean(p.name), el('span', {}, data.sections[p.section].name))));
  });

  // ---------- boot (QR deep links: ?section=u8&board=3  or  ?section=u10&player=Name)
  const params = new URLSearchParams(location.search);
  if (params.get('section')) { openSection = params.get('section'); safeSet('blundr.section', openSection); }
  const wantPlayer = params.get('player');
  const wantBoard = params.get('board');
  if (wantPlayer) followed = null; // the QR wins over a previously remembered child
  if (params.get('browse')) { followed = null; safeSet('blundr.follow', null); }
  const origRender = render;
  render = function () {
    origRender();
    if (wantPlayer && data) {
      const hit = allPlayers().find(p => norm(p.name) === norm(wantPlayer)) || allPlayers().find(p => norm(p.name).includes(norm(wantPlayer)));
      if (hit) { history.replaceState(null, '', location.pathname); follow(hit.name, hit.section); }
    }
    if (wantBoard && data && $('#boards tbody')) {
      const row = [...$('#boards tbody').rows].find(r => r.cells[0].textContent === String(wantBoard));
      if (row) { row.classList.add('me'); row.scrollIntoView({ block: 'center' }); history.replaceState(null, '', location.pathname); }
    }
  };
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
