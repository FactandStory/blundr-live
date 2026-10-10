// Chessboard renderer and lesson player for the hall screen. No rules engine: lessons list their own moves.
// Needs window.PIECE_SVG (pieces.js) and window.LESSONS (lessons.js).
(() => {
  const FILES = 'abcdefgh';
  const sqXY = (sq, flip) => { const f = FILES.indexOf(sq[0]), r = Number(sq[1]) - 1; return flip ? [7 - f, r] : [f, 7 - r]; };
  function fromFen(fen) {
    const pos = {}; const rows = fen.split(' ')[0].split('/');
    rows.forEach((row, i) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += Number(ch); else { pos[FILES[f] + (8 - i)] = ch; f++; } } });
    return pos;
  }

  // Build a board inside `host`. Returns { set(pos), apply(step), highlight(sqs) }.
  function mountBoard(host, { flip = false } = {}) {
    host.classList.add('cb');
    host.innerHTML = `<div class="cb-squares"></div><div class="cb-pieces"></div>`;
    const squares = host.querySelector('.cb-squares'), layer = host.querySelector('.cb-pieces');
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const d = document.createElement('div'); d.className = 'cb-sq ' + (((r + f) % 2) ? 'dark' : 'light');
      const file = flip ? 7 - f : f, rank = flip ? r : 7 - r; d.dataset.sq = FILES[file] + (rank + 1);
      if (r === 7) d.dataset.file = FILES[file]; if (f === 0) d.dataset.rank = rank + 1;
      squares.append(d);
    }
    let pieces = {}; // square -> element
    const place = (sq, piece) => {
      const el = document.createElement('div'); el.className = 'cb-piece ' + (piece === piece.toUpperCase() ? 'w' : 'b');
      el.innerHTML = window.PIECE_SVG[piece] || ''; el.dataset.piece = piece;
      const [x, y] = sqXY(sq, flip); el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
      layer.append(el); pieces[sq] = el; return el;
    };
    const api = {
      set(pos) { layer.replaceChildren(); pieces = {}; for (const [sq, p] of Object.entries(pos)) place(sq, p); api.highlight([]); },
      highlight(sqs) { for (const d of squares.children) d.classList.toggle('hi', sqs.includes(d.dataset.sq)); },
      mark(sqs) { for (const d of squares.children) d.classList.toggle('mk', sqs.includes(d.dataset.sq)); },
      apply(step, animate = true) {
        const touched = [];
        for (const op of step.ops || []) {
          const [from, to, promo] = op; if (from === to) continue;
          const el = pieces[from]; if (!el) continue;
          const victim = pieces[to];
          if (victim && victim !== el) { victim.classList.add('gone'); setTimeout(() => victim.remove(), animate ? 450 : 0); }
          delete pieces[from]; pieces[to] = el;
          const [x, y] = sqXY(to, flip); el.style.transition = animate ? '' : 'none'; el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
          if (promo) { el.dataset.piece = promo; el.innerHTML = window.PIECE_SVG[promo]; }
          touched.push(from, to);
        }
        api.highlight(touched); api.mark(step.marks || []);
      },
    };
    return api;
  }

  // Lesson timeline: intro, steps, outro. Returns the frame index for an elapsed time, and total length.
  const INTRO_MS = 7000, OUTRO_MS = 10000, STEP_MS = 4200;
  function timeline(lesson) {
    const frames = [{ kind: 'intro', ms: INTRO_MS }];
    for (const s of lesson.steps) frames.push({ kind: 'step', step: s, ms: s.hold || (s.note ? 5200 : STEP_MS) });
    frames.push({ kind: 'outro', ms: OUTRO_MS });
    let t = 0; for (const f of frames) { f.at = t; t += f.ms; }
    return { frames, total: t };
  }
  function frameAt(tl, elapsed) { let i = 0; for (let k = 0; k < tl.frames.length; k++) if (elapsed >= tl.frames[k].at) i = k; return i; }

  // Mount a full lesson view in `host`; call .tick(elapsedMs) regularly. Returns { tick, total, title }.
  function mountLesson(host, lesson) {
    host.innerHTML = `
      <div class="ls-board"><div class="ls-boardbox"></div></div>
      <div class="ls-side">
        <div class="ls-kicker">Chess interlude</div>
        <div class="ls-title"></div>
        <div class="ls-sub"></div>
        <div class="ls-moves"></div>
        <div class="ls-note"></div>
      </div>`;
    const board = mountBoard(host.querySelector('.ls-boardbox'), { flip: lesson.flip });
    host.querySelector('.ls-title').textContent = lesson.title;
    host.querySelector('.ls-sub').textContent = lesson.subtitle || '';
    const moves = host.querySelector('.ls-moves'), note = host.querySelector('.ls-note');
    const tl = timeline(lesson); let shown = -1;
    const render = (i, animate) => {
      const f = tl.frames[i];
      // rebuild position up to frame i (cheap: positions are tiny)
      let pos = fromFen(lesson.start); let lastStep = null; const played = [];
      for (let k = 1; k <= i && k < tl.frames.length - 1; k++) {
        const s = tl.frames[k].step; if (s.position) pos = fromFen(s.position);
        for (const [from, to, promo] of s.ops || []) { if (from === to) continue; const p = pos[from]; if (!p) continue; delete pos[from]; pos[to] = promo || p; }
        if (s.san) played.push(s.san); lastStep = s;
      }
      if (animate && shown === i - 1 && f.kind === 'step' && !f.step.position) { board.apply(f.step, true); }
      else { board.set(pos); if (lastStep && f.kind === 'step') { board.highlight((lastStep.ops || []).flat().filter(x => x && x.length === 2)); board.mark(lastStep.marks || []); } }
      moves.replaceChildren(...played.slice(-14).map((m, k, arr) => { const b = document.createElement('span'); b.textContent = m; if (k === arr.length - 1) b.className = 'cur'; return b; }));
      if (f.kind === 'intro') { note.textContent = lesson.blurb; note.className = 'ls-note intro'; moves.replaceChildren(); }
      else if (f.kind === 'outro') { note.textContent = lesson.outro; note.className = 'ls-note outro'; }
      else { note.textContent = f.step.note || ''; note.className = 'ls-note'; }
      shown = i;
    };
    return {
      total: tl.total, title: lesson.title,
      tick(elapsed) { const i = frameAt(tl, Math.max(0, elapsed)); if (i !== shown) render(i, true); },
    };
  }

  window.Chess = { mountBoard, mountLesson, fromFen, timeline };
})();
