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
   Expose globally
   ============================================================ */
if (typeof window !== 'undefined') {
  window.MILO_CLASSIFIER = {
    classifyName,
    pushPullRatio,
    planesDistribution,
    regionDistribution,
    patternFrequency,
    KEYWORDS,
  };
}
