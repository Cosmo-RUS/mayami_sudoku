'use strict';
(() => {
const KEY = { game: 'sudoku.game.v1', set: 'sudoku.settings.v1', stats: 'sudoku.stats.v1' };
// Los niveles son aproximados: solo varían cuántas pistas se retiran.
const DIFFS = { easy: { name: 'Fácil', remove: 40 }, medium: { name: 'Media', remove: 48 }, hard: { name: 'Difícil', remove: 54 } };
const $ = s => document.querySelector(s);
const ROW = i => (i / 9) | 0, COL = i => i % 9, BOX = i => ((ROW(i) / 3) | 0) * 3 + ((COL(i) / 3) | 0);
const sees = (a, b) => ROW(a) === ROW(b) || COL(a) === COL(b) || BOX(a) === BOX(b);
const pc = x => { let n = 0; while (x) { x &= x - 1; n++; } return n; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const store = {
  get(k, d) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* almacenamiento no disponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignorado */ } }
};

/* ---------- Solucionador / generador ---------- */
// Backtracking con la celda de menos candidatos. Con limit=2 cuenta soluciones (0, 1 o 2+).
// Con random=true y limit=1 rellena g con una solución aleatoria (g queda mutado).
function search(g, limit, random) {
  const R = Array(9).fill(0), C = Array(9).fill(0), B = Array(9).fill(0);
  for (let i = 0; i < 81; i++) if (g[i]) { const b = 1 << (g[i] - 1); R[ROW(i)] |= b; C[COL(i)] |= b; B[BOX(i)] |= b; }
  let n = 0;
  const rec = () => {
    let bi = -1, bm = 0, bc = 10;
    for (let i = 0; i < 81; i++) if (!g[i]) {
      const m = ~(R[ROW(i)] | C[COL(i)] | B[BOX(i)]) & 511, k = pc(m);
      if (k < bc) { bc = k; bi = i; bm = m; if (k < 2) break; }
    }
    if (bi < 0) { n++; return n >= limit; }
    if (!bc) return false;
    const vals = [];
    for (let v = 1; v <= 9; v++) if ((bm >> (v - 1)) & 1) vals.push(v);
    if (random) shuffle(vals);
    const r = ROW(bi), c = COL(bi), b = BOX(bi);
    for (const v of vals) {
      const bit = 1 << (v - 1);
      g[bi] = v; R[r] |= bit; C[c] |= bit; B[b] |= bit;
      if (rec()) return true;
      g[bi] = 0; R[r] ^= bit; C[c] ^= bit; B[b] ^= bit;
    }
    return false;
  };
  rec();
  return n;
}
const countSolutions = (g, limit) => search(g.slice(), limit, false);

function generate(diff) {
  const solution = Array(81).fill(0);
  search(solution, 1, true);
  const puzzle = solution.slice();
  let removed = 0;
  for (const i of shuffle([...Array(81).keys()])) {
    if (removed >= DIFFS[diff].remove) break;
    const v = puzzle[i]; puzzle[i] = 0;
    if (countSolutions(puzzle, 2) === 1) removed++; else puzzle[i] = v;
  }
  return { puzzle, solution };
}

const isSolved = g => {
  const R = Array(9).fill(0), C = Array(9).fill(0), B = Array(9).fill(0);
  for (let i = 0; i < 81; i++) { const b = 1 << (g[i] - 1); R[ROW(i)] |= b; C[COL(i)] |= b; B[BOX(i)] |= b; }
  return [...R, ...C, ...B].every(m => m === 511);
};

/* ---------- Estado ---------- */
let G = null;            // partida: puzzle (original), solution, values/notes (editable)
let sel = -1, notesMode = false, paused = true, busy = false, timer = 0, last = 0;
let settings = { check: true, theme: 'auto' };
let stats = {};
let pending = null;
const cells = [];

function validGame(g) {
  const arr = (a, max) => Array.isArray(a) && a.length === 81 && a.every(x => Number.isInteger(x) && x >= 0 && x <= max);
  if (!g || g.v !== 1 || !DIFFS[g.diff] || !arr(g.puzzle, 9) || !arr(g.solution, 9) || !arr(g.values, 9) || !arr(g.notes, 511)) return false;
  if (g.solution.some(x => !x) || !isSolved(g.solution)) return false;
  if (!g.puzzle.every((x, i) => !x || x === g.solution[i])) return false;
  if (!g.values.every((x, i) => !g.puzzle[i] || x === g.puzzle[i])) return false;
  return Number.isFinite(g.elapsed) && g.elapsed >= 0;
}
const okHist = h => Array.isArray(h) && h.every(cs => Array.isArray(cs) && cs.every(c => Array.isArray(c) && c.length === 5 && c.every(Number.isInteger) && c[0] >= 0 && c[0] < 81));

function save() {
  if (!G) return;
  store.set(KEY.game, { v: 1, puzzle: G.puzzle, solution: G.solution, values: G.values, notes: G.notes, diff: G.diff,
    elapsed: Math.round(G.elapsed), mistakes: G.mistakes, hints: G.hints, over: G.over, hist: G.hist.slice(-100), redo: G.redo.slice(-100) });
}

/* ---------- Cronómetro ---------- */
const showTime = () => { $('#timer').textContent = (G.over ? '' : paused ? '▶ ' : '⏸ ') + fmt(G.elapsed); };
function tick() { const now = Date.now(); G.elapsed += now - last; last = now; showTime(); }
function startTimer() { if (timer || !G || G.over) return; last = Date.now(); timer = setInterval(tick, 250); }
function stopTimer() { if (timer) { tick(); clearInterval(timer); timer = 0; } }
function setPaused(p) {
  paused = p;
  if (p) { stopTimer(); save(); } else startTimer();
  $('#resume').hidden = !(paused && !G.over);
  render();
}
const canPlay = () => G && !paused && !G.over && !busy;

/* ---------- Acciones (cada cambio: [celda, valorAntes, notasAntes, valorDespués, notasDespués]) ---------- */
function applyChanges(chs, undo) {
  for (const [i, v0, n0, v1, n1] of undo ? [...chs].reverse() : chs) { G.values[i] = undo ? v0 : v1; G.notes[i] = undo ? n0 : n1; }
}
function act(chs) {
  chs = chs.filter(c => c[1] !== c[3] || c[2] !== c[4]);
  if (!chs.length) return;
  applyChanges(chs, false);
  G.hist.push(chs); if (G.hist.length > 200) G.hist.shift();
  G.redo = [];
  afterMove();
}
function afterMove() { checkWin(); save(); render(); }

// Colocar n en i y quitar n de las notas de las celdas relacionadas
function placeChanges(i, n) {
  const chs = [[i, G.values[i], G.notes[i], n, 0]], bit = 1 << (n - 1);
  for (let j = 0; j < 81; j++) if (j !== i && !G.values[j] && (G.notes[j] & bit) && sees(i, j)) chs.push([j, 0, G.notes[j], 0, G.notes[j] ^ bit]);
  return chs;
}
function enter(n) {
  if (!canPlay() || sel < 0 || G.puzzle[sel]) return;
  const i = sel, v = G.values[i], nt = G.notes[i];
  if (notesMode) { if (!v) act([[i, 0, nt, 0, nt ^ (1 << (n - 1))]]); return; }
  if (v === n) return;
  if (settings.check && n !== G.solution[i]) G.mistakes++;
  act(placeChanges(i, n));
}
function erase() {
  if (!canPlay() || sel < 0 || G.puzzle[sel]) return;
  act([[sel, G.values[sel], G.notes[sel], 0, 0]]);
}
function undo() { if (!canPlay() || !G.hist.length) return; const c = G.hist.pop(); applyChanges(c, true); G.redo.push(c); afterMove(); }
function redo() { if (!canPlay() || !G.redo.length) return; const c = G.redo.pop(); applyChanges(c, false); G.hist.push(c); afterMove(); }
function hint() {
  if (!canPlay()) return;
  let i = sel;
  if (i < 0 || G.puzzle[i] || G.values[i] === G.solution[i]) {
    const c = []; for (let j = 0; j < 81; j++) if (G.values[j] !== G.solution[j]) c.push(j);
    if (!c.length) return;
    i = c[(Math.random() * c.length) | 0];
  }
  sel = i; G.hints++;
  act(placeChanges(i, G.solution[i]));
}

function checkWin() {
  if (G.over || !G.values.every((v, k) => v === G.solution[k])) return;
  G.over = true; stopTimer(); sel = -1;
  const s = stats[G.diff]; s.done++;
  if (!G.hints && (s.best === null || G.elapsed < s.best)) s.best = Math.round(G.elapsed);
  store.set(KEY.stats, stats);
  $('#resume').hidden = true;
}

/* ---------- Partida nueva / carga ---------- */
function startNew(diff) {
  busy = true; stopTimer();
  $('#info').textContent = 'Generando…';
  setTimeout(() => {
    const p = generate(diff);
    G = { ...p, values: p.puzzle.slice(), notes: Array(81).fill(0), diff, elapsed: 0, mistakes: 0, hints: 0, over: false, hist: [], redo: [] };
    sel = -1; notesMode = false; busy = false;
    setPaused(false); save();
  }, 30);
}
function loadSaved() {
  const s = store.get(KEY.game, null);
  if (!validGame(s)) { store.del(KEY.game); return false; }
  G = { ...s, mistakes: Number.isInteger(s.mistakes) ? s.mistakes : 0, hints: Number.isInteger(s.hints) ? s.hints : 0, over: !!s.over,
    hist: okHist(s.hist) ? s.hist : [], redo: okHist(s.redo) ? s.redo : [] };
  paused = !G.over; // se reanuda manualmente
  $('#resume').hidden = G.over;
  render();
  return true;
}

/* ---------- Render ---------- */
function conflictSet() {
  const s = new Set();
  for (let i = 0; i < 81; i++) { const v = G.values[i]; if (!v) continue;
    for (let j = i + 1; j < 81; j++) if (G.values[j] === v && sees(i, j)) { s.add(i); s.add(j); } }
  return s;
}
function render() {
  if (!G) return;
  const cf = settings.check ? conflictSet() : new Set(), sv = sel >= 0 ? G.values[sel] : 0;
  for (let i = 0; i < 81; i++) {
    const el = cells[i], v = G.values[i], nt = G.notes[i], c = ['cell'];
    if (COL(i) % 3 === 2 && COL(i) < 8) c.push('cb');
    if (ROW(i) % 3 === 2 && ROW(i) < 8) c.push('rb');
    if (G.puzzle[i]) c.push('given');
    if (sel >= 0 && i !== sel && sees(sel, i)) c.push('peer');
    if (sv && v === sv && i !== sel) c.push('same');
    if (cf.has(i)) c.push('conf');
    else if (settings.check && v && !G.puzzle[i] && v !== G.solution[i]) c.push('wrong');
    if (i === sel) c.push('sel');
    if (!v && nt) c.push('has-notes');
    el.className = c.join(' ');
    el.firstChild.textContent = v || '';
    const ns = el.lastChild.children;
    for (let k = 0; k < 9; k++) ns[k].textContent = (nt >> k) & 1 ? k + 1 : '';
  }
  document.querySelectorAll('#pad [data-n]').forEach(b => b.classList.toggle('done', G.values.filter(x => x === +b.dataset.n).length >= 9));
  $('#info').textContent = DIFFS[G.diff].name;
  $('#errs').textContent = settings.check ? 'Errores: ' + G.mistakes : 'Sin comprobación';
  $('#undo').disabled = !G.hist.length; $('#redo').disabled = !G.redo.length;
  $('#notes').setAttribute('aria-pressed', notesMode);
  $('#banner').hidden = !G.over;
  if (G.over) $('#banner').textContent = '¡Resuelto! Tiempo: ' + fmt(G.elapsed);
  $('#timer').disabled = G.over;
  showTime();
}
function renderStats() {
  $('#stats').innerHTML = '<tr><th>Nivel</th><th>Completadas</th><th>Mejor</th></tr>' + Object.keys(DIFFS).map(d =>
    `<tr><td>${DIFFS[d].name}</td><td>${stats[d].done}</td><td>${stats[d].best === null ? '—' : fmt(stats[d].best)}</td></tr>`).join('');
}
function renderSettings() {
  $('#checkBtn').textContent = 'Comprobación: ' + (settings.check ? 'sí' : 'no');
  $('#themeBtn').textContent = 'Tema: ' + { auto: 'sistema', light: 'claro', dark: 'oscuro' }[settings.theme];
  if (settings.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = settings.theme;
}

/* ---------- Eventos ---------- */
function openMenu() { stopTimer(); $('#confirm').hidden = true; pending = null; renderStats(); renderSettings(); $('#menu').showModal(); }
function init() {
  const s = store.get(KEY.set, {});
  if (s && typeof s.check === 'boolean') settings.check = s.check;
  if (s && ['auto', 'light', 'dark'].includes(s.theme)) settings.theme = s.theme;
  const st = store.get(KEY.stats, {});
  for (const d in DIFFS) { const x = (st && st[d]) || {}; stats[d] = { done: Number.isInteger(x.done) ? x.done : 0, best: Number.isFinite(x.best) ? x.best : null }; }
  renderSettings();

  const board = $('#board');
  for (let i = 0; i < 81; i++) {
    const el = document.createElement('div');
    el.dataset.i = i; el.setAttribute('role', 'gridcell');
    el.innerHTML = '<span class="v"></span><span class="n">' + '<i></i>'.repeat(9) + '</span>';
    board.appendChild(el); cells.push(el);
  }
  board.addEventListener('click', e => {
    const c = e.target.closest('.cell');
    if (c && canPlay()) { sel = +c.dataset.i; render(); }
  });
  $('#pad').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('') + '<button id="erase" aria-label="Borrar">⌫</button>';
  $('#pad').addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.dataset.n ? enter(+b.dataset.n) : erase(); });
  $('#undo').onclick = undo; $('#redo').onclick = redo; $('#hint').onclick = hint;
  $('#notes').onclick = () => { notesMode = !notesMode; render(); };
  $('#timer').onclick = () => { if (G && !G.over && !busy) setPaused(!paused); };
  $('#resume').onclick = () => setPaused(false);
  $('#menuBtn').onclick = openMenu;
  $('#closeMenu').onclick = () => $('#menu').close();
  $('#menu').addEventListener('close', () => { if (G && !paused && !G.over && !busy) startTimer(); });
  const begin = d => { $('#menu').close(); startNew(d); };
  document.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => {
    if (G && !G.over && G.hist.length) { pending = b.dataset.diff; $('#confirm').hidden = false; } else begin(b.dataset.diff);
  });
  $('#yes').onclick = () => begin(pending); $('#no').onclick = () => { $('#confirm').hidden = true; pending = null; };
  $('#checkBtn').onclick = () => { settings.check = !settings.check; store.set(KEY.set, settings); renderSettings(); render(); };
  $('#themeBtn').onclick = () => { settings.theme = { auto: 'light', light: 'dark', dark: 'auto' }[settings.theme]; store.set(KEY.set, settings); renderSettings(); };

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || $('#menu').open) return;
    const k = e.key;
    if (/^[1-9]$/.test(k)) { enter(+k); e.preventDefault(); }
    else if (k === 'Backspace' || k === 'Delete' || k === '0') { erase(); e.preventDefault(); }
    else if (k === 'Escape') { if (sel >= 0) sel = -1; else notesMode = false; render(); }
    else if (k === 'n' || k === 'N') { notesMode = !notesMode; render(); }
    else if (k.startsWith('Arrow') && canPlay()) {
      const r = sel < 0 ? 4 : ROW(sel), c = sel < 0 ? 4 : COL(sel);
      const nr = Math.min(8, Math.max(0, r + (k === 'ArrowDown') - (k === 'ArrowUp')));
      const nc = Math.min(8, Math.max(0, c + (k === 'ArrowRight') - (k === 'ArrowLeft')));
      sel = nr * 9 + nc; render(); e.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G && !G.over && !paused && !busy) setPaused(true); });
  addEventListener('pagehide', () => { if (G && timer) tick(); save(); });

  if (!loadSaved()) startNew('medium');
}
init();
})();
