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

  // ---------- player facts (standings first, roster as fallback)
  const toNum = v => { if (v == null || v === '') return null; const n = Number(String(v).replace('½', '.5').replace(/[^\d.-]/g, '')); return isNaN(n) ? null : n; };
  const fmtPts = n => { if (n == null) return '–'; const w = Math.floor(n), h = n - w >= 0.5; return (w || !h ? w : '') + (h ? '½' : '') || '0'; };
  const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  function info(name, sec) {
    const st = sec.standings.find(x => norm(x.name) === norm(name)) || null;
    const ro = (data.roster || []).find(x => x.section === sec.slug && norm(x.name) === norm(name)) || null;
    const rating = (st && st.rating) || (ro && ro.rating) || null;
    return { st, rating, score: st ? toNum(st.score) : null, rank: st ? st.rank : null, perf: st ? st.perf : null, tiebreak: st ? st.tiebreak : null, delta: st ? st.delta : null };
  }
  function oppLine(name, sec) {
    const i = info(name, sec); const bits = [];
    if (i.rating) bits.push(`rated ${i.rating}`); else bits.push('unrated');
    if (i.score != null) bits.push(`${fmtPts(i.score)} pts${i.rank ? ', ' + ordinal(i.rank) : ''}`);
    return bits.join(' · ');
  }
  function oppSentence(name, sec) {
    const i = info(name, sec); const who = clean(name).split(' ')[0];
    const bits = [];
    bits.push(i.rating ? `is rated ${i.rating}` : 'is unrated');
    if (i.score != null) bits.push(`is now on ${fmtPts(i.score)} ${i.score === 1 ? 'point' : 'points'}${i.rank ? `, ${ordinal(i.rank)} in ${sec.name}` : ''}`);
    return `${who} ${bits.join(' and ')}.`;
  }
  function ticketBlock(name, sec, hist) {
    const q = (data.qualify || {})[sec.slug]; if (!q) return null;
    const me = info(name, sec); const score = me.score ?? 0;
    const played = hist.filter(h => h.bye || h.outcome).length; const left = Math.max(0, (sec.totalRounds || 6) - played);
    const targets = Object.entries(q).filter(([k]) => k !== '_how').map(([k, v]) => ({ k, label: k === 'final' ? `the ${sec.name} Final` : `the ${k === 'minor' ? 'Minor' : 'Major'} final`, need: v }));
    if (!targets.length) return null;
    const lines = []; let best = null;
    for (const t of targets.sort((a, b) => a.need - b.need)) {
      const gap = t.need - score;
      if (gap <= 0) { best = t; continue; }
      lines.push(gap <= left ? `${fmtPts(gap)} more ${gap === 1 ? 'point' : 'points'} for ${t.label} (${left} ${left === 1 ? 'game' : 'games'} left)` : `${t.label} is out of reach this time (needs ${fmtPts(t.need)})`);
    }
    const head = best ? `Golden Ticket: qualified for ${best.label} ✓` : 'Golden Ticket';
    return el('div', { class: 'ticket' + (best ? ' done' : '') }, el('b', {}, head), ...(lines.length ? [el('div', { class: 'small' }, lines.join(' · '))] : []),
      el('div', { class: 'small' }, `Scores out of ${sec.totalRounds || 6}. Qualifying does not enter you; register at ljcc.co.uk afterwards.`));
  }

  // ---------- next round and countdown (desk setting first, printed timetable as fallback)
  function nextRound() {
    const today = (hm) => { const [h, m] = hm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
    const nr = data.nextRound;
    if (nr && nr.startsAt) return { number: nr.number, at: today(nr.startsAt), label: nr.startsAt, note: nr.note || '' };
    const sch = (data.schedule && data.schedule.rounds) || {}; const now = Date.now();
    for (const [n, t] of Object.entries(sch)) { const at = today(t); if (at.getTime() > now - 3 * 60000) return { number: Number(n), at, label: t, note: '' }; }
    if (data.schedule && data.schedule.prizes) { const at = today(data.schedule.prizes); if (at.getTime() > now - 3 * 60000) return { number: null, at, label: data.schedule.prizes, note: 'Prize-giving' }; }
    return null;
  }
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0'); };
  function tickCountdown() {
    const cd = $('#cd'); if (!cd || !data) return; const nr = nextRound(); if (!nr) return;
    const left = nr.at.getTime() - Date.now();
    cd.textContent = left > 0 ? mmss(left) : (nr.number ? `Round ${nr.number} starting` : 'Starting now');
    cd.classList.toggle('soon', left > 0 && left < 5 * 60000);
  }
  setInterval(tickCountdown, 1000);

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
    const nrBox = $('#next-round'); const nr = nextRound();
    if (nr) {
      nrBox.hidden = false;
      nrBox.replaceChildren(
        el('div', {}, el('div', { class: 'big', id: 'cd' }, ''), el('div', { class: 'sub' }, nr.number ? `Round ${nr.number} starts at ${nr.label}` : `${nr.note || 'Next'} at ${nr.label}`)),
        el('div', { class: 'sub' }, nr.note && nr.number ? nr.note : 'Players to the Pavilion five minutes before. Parents stay in the Village Hall.'));
      tickCountdown();
    } else nrBox.hidden = true;

    // find card: top of the page until a child is followed, then below pairings as "look up another player"
    const find = document.querySelector('.card.find'), boards = $('#boards'), h1 = find && find.querySelector('h1');
    if (find) { if (followed) { boards.after(find); find.classList.add('later'); if (h1) h1.textContent = 'Look up another player'; } else { $('#app').prepend(find); find.classList.remove('later'); if (h1) h1.textContent = 'Find a player'; const rb = $('#result-banner'); if (rb) $('#app').prepend(rb); } }
    renderResultBanner();
    renderFollowed();
    renderBrowse();
    renderSections();
    renderBoards();
    renderTimetable();
  }

  function renderTimetable() {
    const box = $('#timetable'); if (!box) return;
    const sch = data.schedule || {}; box.replaceChildren();
    for (const [n, t] of Object.entries(sch.rounds || {})) box.append(el('b', {}, t), el('span', {}, `Round ${n}`));
    if (sch.lunch) box.append(el('b', { class: 'lunch' }, sch.lunch), el('span', { class: 'lunch' }, 'Lunch, 45 minutes'));
    if (sch.prizes) box.append(el('b', { class: 'prizes' }, sch.prizes), el('span', { class: 'prizes' }, 'Prize-giving in the Village Hall'));
    // keep chronological: lunch sits between rounds 3 and 4
    const items = [...box.children]; const pairs = []; for (let i = 0; i < items.length; i += 2) pairs.push([items[i], items[i + 1]]);
    pairs.sort((x, y) => x[0].textContent.localeCompare(y[0].textContent)); box.replaceChildren(...pairs.flat());
  }

  // Big result banner: the followed child's latest result, until the parent taps Got it. Returns for each new round.
  function renderResultBanner() {
    const box = $('#result-banner'); if (!box) return;
    if (!followed) { box.hidden = true; return; }
    const sec = data.sections[followed.section]; if (!sec || !sec.currentRound) { box.hidden = true; return; }
    const hist = playerHistory(followed.name, sec);
    const latest = [...hist].reverse().find(h => h.outcome || h.bye); if (!latest) { box.hidden = true; return; }
    const key = `blundr.seen.${sec.slug}.${latest.round}.${norm(followed.name)}`;
    const current = latest.bye ? 'bye' : latest.outcome; const seen = safeGet(key);
    if (seen === current) { box.hidden = true; return; }
    const corrected = seen && seen !== current;
    const first = clean(followed.name).split(' ')[0];
    const verb = latest.bye ? `${first} has a bye` : latest.outcome === 'win' ? `${first} wins` : latest.outcome === 'draw' ? `${first} draws` : `${first} loses`;
    const detail = latest.bye ? 'One point, no game this round.' : `Round ${latest.round}, ${latest.colour.toLowerCase()} against ${clean(latest.opponent)} on board ${latest.board}.`;
    box.className = 'card banner ' + (['u8', 'u10', 'u12'].includes(sec.slug) ? sec.slug : 'other');
    box.hidden = false;
    box.replaceChildren(el('div', {}, el('div', { class: 'k' }, `${corrected ? 'Corrected result' : 'Result'} · round ${latest.round}`), el('div', { class: 'r' }, verb), el('div', { class: 'd' }, corrected ? 'The arbiter has corrected this result. ' + detail : detail)),
      el('button', { onclick: () => { safeSet(key, current); render(); } }, 'Got it'));
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
    const me = info(name, sec);
    box.replaceChildren(...[
      el('div', { class: 'head' },
        el('div', {}, el('div', { class: 'name' }, clean(name)), el('div', { class: 'meta' }, `${sec.name} section${me.rating ? ' · rated ' + me.rating : ' · unrated'}`)),
        el('button', { class: 'forget', onclick: () => { followed = null; safeSet('blundr.follow', null); render(); } }, 'Change player')),
      checkinBlock(name, sec),
      cur ? nowBlock(cur, sec) : el('p', { class: 'empty' }, sec.currentRound ? `No game listed for round ${sec.currentRound}. Please ask at the desk.` : 'Round 1 pairings are not published yet.'),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', {}, fmtPts(me.score)), el('span', {}, 'points'), el('span', { class: 'sub' }, `of ${sec.totalRounds || 6} possible`)),
        el('div', { class: 'stat' }, el('b', {}, me.rank ? ordinal(me.rank) : '–'), el('span', {}, 'place'), el('span', { class: 'sub' }, `of ${sec.standings.length || '–'} in ${sec.name}`)),
        el('div', { class: 'stat' }, el('b', {}, me.perf ?? '–'), el('span', {}, 'performance rating'), el('span', { class: 'sub' }, 'from results so far')),
        el('div', { class: 'stat' }, el('b', {}, me.delta ? `${me.delta.startsWith('-') ? '' : '+'}${me.delta}` : '–'), el('span', {}, 'predicted rating change'), el('span', { class: 'sub' }, "Tornelo's estimate, not the ECF figure"))),
      ticketBlock(name, sec, hist),
      historyTable(hist, sec)].filter(Boolean));
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
    const first = clean(followed.name).split(' ')[0];
    if (h.bye) return el('div', { class: 'now' }, el('div', { class: 'board' }, '—', el('small', {}, 'board')), el('div', { class: 'detail' }, el('strong', {}, `Round ${h.round}: ${first} has a bye`), el('span', {}, 'No game this round. A bye scores one point.')));
    const nr = nextRound(); const upcoming = !h.result && nr && nr.number === h.round && nr.at.getTime() > Date.now();
    const heading = h.result ? `Round ${h.round} result` : upcoming ? `Next game · round ${h.round}, ${nr.label}` : `Playing now · round ${h.round}`;
    const verdict = !h.result ? null : h.outcome === 'win' ? `A win for ${first}` : h.outcome === 'loss' ? `A loss for ${first}` : `A draw for ${first}`;
    const scoreline = h.result ? h.result.replace('-', ' – ') : '';
    return el('div', { class: 'now' },
      el('div', { class: 'board' }, h.board, el('small', {}, 'board')),
      el('div', { class: 'detail' },
        el('span', { class: 'small', style: 'text-transform:uppercase;letter-spacing:.06em;font-weight:700' }, heading),
        verdict ? el('strong', { class: `verdict ${h.outcome}` }, verdict, ' ', el('span', { class: `pill ${h.outcome}` }, scoreline)) : el('strong', {}, upcoming ? `${first} plays next` : `${first} is playing now`, ' ', el('span', { class: 'pill live' }, upcoming ? 'Not started' : 'In play')),
        el('span', {}, `${first} ${h.result ? 'played' : upcoming ? 'will have' : 'has'} `, el('span', { class: `pill ${h.colour.toLowerCase()}` }, h.colour), ` against `, el('button', { class: 'linklike', onclick: () => follow(h.opponent, sec.slug) }, clean(h.opponent) || 'TBC'), '.'),
        el('span', { class: 'small' }, h.opponent ? oppSentence(h.opponent, sec) : '')));
  }

  function historyTable(hist, sec) {
    const first = clean(followed.name).split(' ')[0];
    const t = el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Rd'), el('th', {}, `${first}'s games`), el('th', { class: 'num' }, 'Result'))));
    const tb = el('tbody');
    for (const h of hist) {
      if (h.bye) { tb.append(el('tr', {}, el('td', {}, h.round), el('td', {}, 'Bye: no game, one point'), el('td', { class: 'num' }, el('span', { class: 'pill win' }, '+1')))); continue; }
      const i = info(h.opponent, sec);
      const oppNow = i.score != null ? `now on ${fmtPts(i.score)} ${i.score === 1 ? 'pt' : 'pts'}${i.rank ? ', ' + ordinal(i.rank) : ''}` : '';
      const label = h.outcome === 'win' ? `Won ${h.result.replace('-', '–')}` : h.outcome === 'loss' ? `Lost ${h.result.replace('-', '–')}` : h.outcome === 'draw' ? 'Draw ½–½' : 'In play';
      tb.append(el('tr', {}, el('td', {}, h.round),
        el('td', {}, el('div', { class: 'opp' },
          el('span', {}, 'v ', el('button', { class: 'linklike', onclick: () => follow(h.opponent, sec.slug) }, clean(h.opponent) || 'TBC'), el('span', { class: 'meta' }, i.rating ? ` (rated ${i.rating})` : ' (unrated)')),
          el('span', { class: 'meta' }, `${first} had ${h.colour} · board ${h.board}${oppNow ? ' · opponent ' + oppNow : ''}`))),
        el('td', { class: 'num' }, el('span', { class: `pill ${h.outcome || 'live'}` }, label))));
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
    if (sec.standingsUrl) box.append(el('p', { class: 'seclink' }, el('a', { href: sec.pairingsUrl || sec.standingsUrl, target: '_blank', rel: 'noopener' }, `${sec.name} on Tornelo`)));
    if (!sec.standings.length) { box.append(el('p', { class: 'empty' }, 'Standings appear after the first results.')); return; }
    const hasTb = sec.standings.some(x => x.tiebreak != null), hasPerf = sec.standings.some(x => x.perf != null), hasRtg = sec.standings.some(x => x.rating != null);
    const t = el('table', {}, el('thead', {}, el('tr', {}, el('th', { class: 'num' }, '#'), el('th', {}, 'Player'), hasRtg ? el('th', { class: 'num' }, 'Rtg') : null, el('th', { class: 'num' }, 'Pts'), hasTb ? el('th', { class: 'num tb' }, 'BH') : null, hasPerf ? el('th', { class: 'num tb' }, 'Perf') : null)));
    const tb = el('tbody');
    for (const s of sec.standings) tb.append(el('tr', { class: followed && norm(followed.name) === norm(s.name) ? 'me' : '' },
      el('td', { class: 'num' }, s.rank), el('td', {}, el('button', { class: 'linklike', onclick: () => follow(s.name, sec.slug) }, clean(s.name))),
      hasRtg ? el('td', { class: 'num' }, s.rating ?? '') : null, el('td', { class: 'num' }, s.score ?? ''),
      hasTb ? el('td', { class: 'num tb' }, s.tiebreak ?? '') : null, hasPerf ? el('td', { class: 'num tb' }, s.perf ?? '') : null));
    t.append(tb); box.append(t);
    box.append(el('p', { class: 'standings-note' }, [hasTb ? 'BH is the Buchholz tiebreak: the total points of everyone you have played. Higher breaks a tie.' : null, hasPerf ? 'Perf is your performance rating in this event so far.' : null, 'Tap a name to follow that player.'].filter(Boolean).join(' ')));
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
