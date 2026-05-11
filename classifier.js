/* ============================================================
   MILO — Movement Classifier
   ============================================================
   Tags workouts (and exercises, when we have them) with:

     region:     upper | lower | total | cardio | core
     pattern:    push | pull | squat | hinge | lunge | carry | rotation | gait
     plane:      sagittal | frontal | transverse
     orientation:vertical | horizontal (for push/pull only)
     lateral:    bilateral | unilateral

   Today it operates on workout NAMES (Marin's titles already encode
   the structure — "Hinge, Carry, Core", "Vertical Pull + Lower
   Unilateral", "Lower Power + Frontal Plane", etc.).

   Tomorrow when we sync exercise-level data from Bridge, the same
   classifier runs over individual exercise names — no code change
   in the consumers (client.html etc.).
   ============================================================ */

const KEYWORDS = {
  // ─── REGIONS ────────────────────────────────
  region: {
    upper: ['upper', 'arm', 'shoulder', 'chest', 'back', 'lat', 'tricep', 'bicep', 'pec', 'press', 'row', 'pull-up', 'pullup', 'chin', 'curl', 'fly', 'dip', 'overhead', 'oh ', 'ohp'],
    lower: ['lower', 'squat', 'lunge', 'hinge', 'deadlift', 'glute', 'hip', 'hamstring', 'quad', 'calf', 'leg', 'step-up', 'stepup', 'split squat', 'rdl', 'thrust'],
    total: ['total body', 'full body', 'clean', 'snatch', 'thruster', 'turkish', 'burpee', 'sled', 'carry', 'farmer'],
    cardio: ['zone 2', 'zone 1', 'zone 3', 'aerobic', 'cardio', 'run', 'cycle', 'row erg', 'erg', 'sprint', 'interval', 'tempo'],
    core: ['core', 'plank', 'ab ', 'abs', 'rotation', 'pallof', 'dead bug', 'bird dog'],
  },

  // ─── PATTERNS ───────────────────────────────
  pattern: {
    push: ['push', 'press', 'bench', 'dip', 'fly', 'pushup', 'push-up'],
    pull: ['pull', 'row', 'chin', 'pullup', 'pull-up', 'curl', 'face pull', 'lat'],
    squat: ['squat', 'lunge', 'step-up', 'stepup', 'split squat', 'pistol'],
    hinge: ['hinge', 'deadlift', 'rdl', 'good morning', 'kettlebell swing', 'kb swing', 'hip thrust', 'thrust', 'glute bridge'],
    lunge: ['lunge', 'split squat'],
    carry: ['carry', 'farmer', 'suitcase', 'overhead carry', 'rack carry', 'yoke'],
    rotation: ['rotation', 'twist', 'chop', 'lift', 'pallof', 'wood'],
    gait: ['run', 'sprint', 'jog', 'walk', 'march'],
  },

  // ─── PLANES OF MOTION ───────────────────────
  plane: {
    sagittal:   ['sagittal', 'squat', 'deadlift', 'lunge forward', 'forward lunge', 'bench', 'row', 'pull-up', 'push-up', 'ohp', 'overhead press', 'hinge', 'curl', 'tricep', 'leg press', 'rdl'],
    frontal:    ['frontal', 'lateral', 'side', 'cossack', 'side lunge', 'lateral lunge', 'lateral raise', 'side plank', 'crab', 'monster walk', 'banded walk'],
    transverse: ['transverse', 'rotation', 'twist', 'chop', 'lift', 'pallof', 'turkish', 'cable rotation', 'wood chop', 'med ball rotation'],
  },

  // ─── ORIENTATION (for push/pull) ────────────
  orientation: {
    vertical:   ['vertical', 'overhead', 'oh ', 'ohp', 'pull-up', 'pullup', 'chin', 'pulldown', 'snatch'],
    horizontal: ['horizontal', 'bench', 'row', 'push-up', 'pushup', 'chest press'],
  },

  // ─── BILATERAL / UNILATERAL ─────────────────
  lateral: {
    unilateral: ['unilateral', 'single', 'one-arm', 'one arm', 'split', 'pistol', 'lunge', 'step-up', 'stepup', 'turkish', 'cossack', 'suitcase'],
    bilateral:  ['bilateral', 'barbell', 'double'],
  },
};

function matchAny(text, list) {
  const t = text.toLowerCase();
  return list.some(k => t.includes(k));
}

/**
 * Classify a workout/exercise name into movement attributes.
 * Returns an object with arrays for each dimension (some workouts span multiple).
 *
 *   classifyName("Hinge, Carry, Core")
 *   → { region: ['lower','total','core'], pattern: ['hinge','carry'], plane: ['sagittal'], orientation: [], lateral: [] }
 */
function classifyName(name) {
  if (!name) return null;
  const text = ' ' + name.toLowerCase() + ' ';

  // Strip noise
  const cleaned = text.replace(/\b(week|day|session|set|reps?|min|copy|template)\b/g, ' ');

  const out = {
    raw: name,
    region: [],
    pattern: [],
    plane: [],
    orientation: [],
    lateral: [],
  };

  for (const [dim, groups] of Object.entries(KEYWORDS)) {
    for (const [label, keywords] of Object.entries(groups)) {
      if (matchAny(cleaned, keywords)) {
        out[dim].push(label);
      }
    }
  }

  // Heuristic fixes — if "push" or "pull" tag present without orientation,
  // default to horizontal (bench/row are the common cases).
  if ((out.pattern.includes('push') || out.pattern.includes('pull')) && out.orientation.length === 0) {
    out.orientation.push('horizontal');
  }
  // If we have a pattern but no plane, infer sagittal (the default plane for most lifts)
  if (out.pattern.length && out.plane.length === 0) {
    out.plane.push('sagittal');
  }
  // Deduplicate
  for (const k of Object.keys(out)) {
    if (Array.isArray(out[k])) out[k] = [...new Set(out[k])];
  }

  return out;
}

/* ============================================================
   Aggregation helpers — used by client.html dashboard widgets
   ============================================================ */

/**
 * Push/Pull ratio across a list of workouts.
 * Counts how many sessions contain push patterns vs. pull patterns.
 * Returns { push, pull, ratio, total } where ratio = push/pull (or null if no pull).
 */
function pushPullRatio(workouts) {
  let push = 0, pull = 0;
  for (const w of workouts) {
    const tags = w._tags || classifyName(w.name);
    if (tags?.pattern?.includes('push')) push++;
    if (tags?.pattern?.includes('pull')) pull++;
  }
  return {
    push, pull,
    total: push + pull,
    ratio: pull > 0 ? Math.round((push / pull) * 100) / 100 : null,
    pushPct: (push + pull) > 0 ? Math.round((push / (push + pull)) * 100) : 0,
    pullPct: (push + pull) > 0 ? Math.round((pull / (push + pull)) * 100) : 0,
  };
}

/**
 * Plane-of-motion distribution across workouts.
 * Returns { sagittal, frontal, transverse, total, percentages }.
 */
function planesDistribution(workouts) {
  const counts = { sagittal: 0, frontal: 0, transverse: 0 };
  for (const w of workouts) {
    const tags = w._tags || classifyName(w.name);
    if (!tags?.plane) continue;
    for (const p of tags.plane) {
      if (counts[p] !== undefined) counts[p]++;
    }
  }
  const total = counts.sagittal + counts.frontal + counts.transverse;
  return {
    ...counts,
    total,
    sagittalPct: total ? Math.round(counts.sagittal / total * 100) : 0,
    frontalPct: total ? Math.round(counts.frontal / total * 100) : 0,
    transversePct: total ? Math.round(counts.transverse / total * 100) : 0,
  };
}

/**
 * Body region distribution (upper / lower / total / cardio / core).
 */
function regionDistribution(workouts) {
  const counts = { upper: 0, lower: 0, total: 0, cardio: 0, core: 0 };
  for (const w of workouts) {
    const tags = w._tags || classifyName(w.name);
    if (!tags?.region) continue;
    for (const r of tags.region) {
      if (counts[r] !== undefined) counts[r]++;
    }
  }
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  const pct = {};
  for (const k of Object.keys(counts)) pct[k] = sum ? Math.round(counts[k] / sum * 100) : 0;
  return { counts, percentages: pct, total: sum };
}

/* ============================================================
   Movement-pattern frequency (raw count over a period)
   ============================================================ */
function patternFrequency(workouts) {
  const counts = { push: 0, pull: 0, squat: 0, hinge: 0, lunge: 0, carry: 0, rotation: 0, gait: 0 };
  for (const w of workouts) {
    const tags = w._tags || classifyName(w.name);
    if (!tags?.pattern) continue;
    for (const p of tags.pattern) if (counts[p] !== undefined) counts[p]++;
  }
  return counts;
}

/* ============================================================
   Strength Progression / Adaptation trends
   ============================================================
   For each movement pattern, compute weekly:
     - frequency (sessions that include this pattern)
     - avg RPE for those sessions
   Then read the trend over the last N weeks:
     - RPE dropping w/ stable or rising frequency → adapting / getting stronger
     - RPE rising w/ stable freq → either harder load OR fatigue
     - Frequency dropping → not being trained
   ============================================================ */

function patternWeeklyTrends(workouts, weeksBack = 12, todayStr = '2026-05-11') {
  const [yy, mm, dd] = todayStr.split('-').map(Number);
  const todayUTC = Date.UTC(yy, mm - 1, dd);
  const dayMs = 86400000;
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  const monthDay = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // Pre-tag every workout
  const tagged = (workouts || []).map(w => ({ ...w, _tags: w._tags || classifyName(w.name) }));

  const PATTERNS = ['push', 'pull', 'squat', 'hinge', 'lunge', 'carry', 'rotation'];
  const out = {};
  for (const p of PATTERNS) out[p] = { weeks: [], totalSessions: 0 };

  for (let i = weeksBack - 1; i >= 0; i--) {
    const endMs = todayUTC - (i * 7 * dayMs);
    const startMs = endMs - (6 * dayMs);
    const startStr = fmt(startMs);
    const endStr = fmt(endMs);
    const inWeek = tagged.filter(w => w.date && w.date >= startStr && w.date <= endStr);

    for (const p of PATTERNS) {
      const matching = inWeek.filter(w => w._tags?.pattern?.includes(p));
      const rpes = matching.map(w => w.rpe).filter(r => r !== null && r !== undefined);
      const avgRpe = rpes.length ? rpes.reduce((s, r) => s + r, 0) / rpes.length : null;
      out[p].weeks.push({
        label: monthDay(endMs),
        sessions: matching.length,
        avgRpe,
      });
      out[p].totalSessions += matching.length;
    }
  }

  // Compute adaptation signal per pattern
  for (const p of PATTERNS) {
    out[p].signal = adaptationSignal(out[p].weeks);
  }

  return out;
}

/**
 * Read a pattern's weekly history and return an arrow + label:
 *   ↗ adapting   — RPE trending down with non-trivial frequency
 *   → stable     — both flat (or insufficient data to call it)
 *   ↘ regressing — RPE rising or frequency dropping
 *   −  untrained — no sessions of this pattern at all
 */
function adaptationSignal(weeks) {
  const nonEmpty = weeks.filter(w => w.sessions > 0);
  if (nonEmpty.length === 0) return { arrow: '−', label: 'Not trained', color: '#A0ABBE', confidence: 'none' };
  if (nonEmpty.length === 1) return { arrow: '→', label: 'Baseline', color: '#7A8499', confidence: 'low' };

  // Split into first half vs second half of populated weeks
  const half = Math.floor(nonEmpty.length / 2);
  const early = nonEmpty.slice(0, half);
  const late = nonEmpty.slice(-half);

  const earlyRpe = avg(early.map(w => w.avgRpe).filter(v => v !== null));
  const lateRpe  = avg(late.map(w => w.avgRpe).filter(v => v !== null));
  const earlyFreq = avg(early.map(w => w.sessions)) || 0;
  const lateFreq  = avg(late.map(w => w.sessions)) || 0;

  const haveRpe = earlyRpe !== null && lateRpe !== null;
  const rpeDelta = haveRpe ? lateRpe - earlyRpe : 0;
  const freqDelta = lateFreq - earlyFreq;
  const confidence = nonEmpty.length >= 4 ? 'high' : 'med';

  // Adapting: RPE dropping by ≥0.5, frequency not collapsing
  if (haveRpe && rpeDelta <= -0.5 && freqDelta >= -0.5) {
    return { arrow: '↗', label: 'Adapting', color: '#0D7A4E', confidence,
      detail: `RPE ${earlyRpe.toFixed(1)} → ${lateRpe.toFixed(1)}` };
  }
  // Regressing: RPE climbing notably OR frequency dropping while RPE flat
  if ((haveRpe && rpeDelta >= 0.5) || freqDelta <= -0.7) {
    const harder = haveRpe && rpeDelta >= 0.5;
    return { arrow: '↘', label: harder ? 'Harder/regressing' : 'Frequency dropping', color: '#C0202A', confidence,
      detail: harder ? `RPE ${earlyRpe.toFixed(1)} → ${lateRpe.toFixed(1)}` : `${earlyFreq.toFixed(1)}x → ${lateFreq.toFixed(1)}x/wk` };
  }
  return { arrow: '→', label: 'Stable', color: '#7A8499', confidence,
    detail: haveRpe ? `RPE ~${((earlyRpe + lateRpe) / 2).toFixed(1)}` : `${nonEmpty.length} weeks tracked` };
}

function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : null; }

/**
 * Overall progression read across all patterns.
 * Returns { arrow, label, color, score } — e.g. "↗ Adapting" if more
 * patterns are adapting than regressing.
 */
function overallProgression(trends) {
  let adapting = 0, regressing = 0, stable = 0;
  for (const p of Object.keys(trends)) {
    const sig = trends[p].signal;
    if (sig.arrow === '↗') adapting++;
    else if (sig.arrow === '↘') regressing++;
    else if (sig.arrow === '→') stable++;
  }
  const score = adapting - regressing;
  if (adapting === 0 && regressing === 0 && stable === 0)
    return { arrow: '−', label: 'No data', color: '#A0ABBE', adapting, regressing, stable };
  if (score >= 2)  return { arrow: '↗', label: 'Adapting',    color: '#0D7A4E', adapting, regressing, stable };
  if (score >= 1)  return { arrow: '↗', label: 'Improving',   color: '#0D7A4E', adapting, regressing, stable };
  if (score <= -2) return { arrow: '↘', label: 'Regressing',  color: '#C0202A', adapting, regressing, stable };
  if (score <= -1) return { arrow: '↘', label: 'Slipping',    color: '#C0202A', adapting, regressing, stable };
  return { arrow: '→', label: 'Stable', color: '#7A8499', adapting, regressing, stable };
}

/* ============================================================
   Expose globally
   ============================================================ */
if (typeof window !== 'undefined') {
  window.MILO_CLASSIFIER = {
    classifyName,
    pushPullRatio,
    planesDistribution,
    regionDistribution,
    patternFrequency,
    patternWeeklyTrends,
    adaptationSignal,
    overallProgression,
    KEYWORDS,
  };
}
