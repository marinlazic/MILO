/* ============================================================
   MILO — Client Data Layer
   ============================================================
   Auto-synced from Bridge Athletic via /api/sync.
   Last synced: 2026-06-05T00:15:11.371Z
   ============================================================ */

const BRIDGE_DATA = {};

function getClient(id) { return BRIDGE_DATA[id] || null; }
function getAllClients() { return Object.values(BRIDGE_DATA); }
function activePrograms(c) {
  return (c.programs || []).filter(p => p.status === "started")
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
function completedPrograms(c) {
  return (c.programs || []).filter(p => p.status === "completed")
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
function primaryProgram(c) { const a = activePrograms(c); return a[0] || null; }
function avgRpe(c, n = 4) {
  const r = (c.recentWorkouts || []).slice(0, n);
  if (!r.length) return null;
  return Math.round(r.reduce((s, w) => s + (w.rpe || 0), 0) / r.length * 10) / 10;
}
function sessionsThisRange(c) { return (c.recentWorkouts || []).filter(w => w.status === "completed").length; }
function lastWorkoutDate(c) { const r = c.recentWorkouts || []; return r.length ? r[0].date : null; }
function daysSinceLastWorkout(c, today = new Date()) {
  const d = lastWorkoutDate(c);
  if (!d) return null;
  return Math.round((today - new Date(d)) / (86400000));
}

let _workoutCache = null;
async function getWorkoutContent(workoutId) {
  if (!workoutId) return null;
  if (!_workoutCache) {
    try { const r = await fetch('bridge-workouts.json'); _workoutCache = await r.json(); }
    catch (e) { _workoutCache = {}; }
  }
  return _workoutCache[workoutId] || null;
}

let _setHistoryCache = null;
async function getSetHistory() {
  if (!_setHistoryCache) {
    try { const r = await fetch('bridge-set-history.json'); _setHistoryCache = await r.json(); }
    catch (e) { _setHistoryCache = { sets: {}, exerciseNames: {} }; }
  }
  return _setHistoryCache;
}

async function getExerciseProgression(client) {
  const { sets, exerciseNames } = await getSetHistory();
  const userSets = sets[client.bridgeId] || [];
  if (!userSets.length) return {};
  const bySessionEx = {};
  for (const s of userSets) {
    if (!s.rw || !s.rr) continue;
    const weight = s.rw / 1000000;
    const reps = parseInt(s.rr, 10);
    if (!weight || !reps || reps < 1) continue;
    const e1rm = weight * (1 + reps / 30);
    const key = `${s.d}|${s.ex}`;
    if (!bySessionEx[key] || e1rm > bySessionEx[key].e1rm) {
      bySessionEx[key] = { e1rm, weight, reps, date: s.d, exId: s.ex };
    }
  }
  const out = {};
  for (const v of Object.values(bySessionEx)) {
    const name = exerciseNames[v.exId] || `Exercise #${v.exId}`;
    if (!out[name]) out[name] = [];
    out[name].push({ date: v.date, e1rm: v.e1rm, weight: v.weight, reps: v.reps });
  }
  for (const name of Object.keys(out)) out[name].sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Extract previous block exercises (per movement pattern, with logged loads if available).
// Used by /build.html to drive the 'keep / adjacent / new' progression toggles.
async function extractPreviousBlock(client, opts = {}) {
  if (!client) return null;
  const CLF = (typeof window !== "undefined") ? window.MILO_CLASSIFIER : null;
  if (!CLF) return null;
  const recents = (client.recentWorkouts || []).filter(w => w.status === "completed");
  if (!recents.length) return null;
  const programFilter = opts.program || (recents[0].program || null);
  const filtered = programFilter ? recents.filter(w => w.program === programFilter) : recents;
  const sessions = filtered.slice(0, opts.limit || 10);
  const workouts = await Promise.all(sessions.map(s => getWorkoutContent(s.workoutId)));
  const setHistory = await getSetHistory();
  const setsByUser = (setHistory.sets || {})[client.bridgeId] || [];
  const exNames = setHistory.exerciseNames || {};
  const lastSetByExName = {};
  for (const s of setsByUser) {
    if (!s.rw || !s.rr) continue;
    const name = exNames[s.ex];
    if (!name) continue;
    const weight = s.rw / 1000000;
    const reps = parseInt(s.rr, 10);
    if (!weight || !reps) continue;
    const e1rm = weight * (1 + reps / 30);
    const prev = lastSetByExName[name];
    if (!prev || (s.d || "") > (prev.date || "")) {
      lastSetByExName[name] = { weight_kg: weight, reps, date: s.d, e1rm_kg: e1rm };
    }
  }
  const byPattern = {};
  for (const w of workouts) {
    if (!w || !w.blocks) continue;
    for (const blk of w.blocks) {
      for (const ex of (blk.exercises || [])) {
        const tags = CLF.classifyName(ex.name);
        const pat = tags?.pattern && tags.pattern[0];
        if (!pat) continue;
        if (!byPattern[pat]) byPattern[pat] = new Map();
        const slot = byPattern[pat].get(ex.name) || {
          exercise: ex.name, slug: ex.slug || null, sessions: 0,
          blockNames: new Set(),
          lastE1rm_kg: null, lastReps: null, lastWeight_kg: null, lastDate: null,
        };
        slot.sessions += 1;
        if (blk.name) slot.blockNames.add(blk.name);
        const set = lastSetByExName[ex.name];
        if (set && (!slot.lastDate || set.date > slot.lastDate)) {
          slot.lastE1rm_kg = Math.round(set.e1rm_kg);
          slot.lastReps = set.reps;
          slot.lastWeight_kg = Math.round(set.weight_kg * 10) / 10;
          slot.lastDate = set.date;
        }
        byPattern[pat].set(ex.name, slot);
      }
    }
  }
  const out = {};
  for (const [pat, exMap] of Object.entries(byPattern)) {
    const arr = Array.from(exMap.values()).map(s => ({ ...s, blockNames: Array.from(s.blockNames || []).slice(0, 3) }));
    arr.sort((a, b) => b.sessions - a.sessions);
    out[pat] = arr.slice(0, 4);
  }
  const dates = sessions.map(s => s.date).filter(Boolean).sort();
  return {
    program: programFilter,
    dateRange: dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : null,
    workoutsAnalysed: sessions.length,
    byPattern: out,
  };
}

if (typeof window !== "undefined") {
  window.MILO = {
    BRIDGE_DATA,
    getClient, getAllClients,
    activePrograms, completedPrograms, primaryProgram,
    avgRpe, sessionsThisRange, lastWorkoutDate, daysSinceLastWorkout,
    getWorkoutContent, getSetHistory, getExerciseProgression,
    extractPreviousBlock,
  };
}
