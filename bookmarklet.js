/* MILO — Bridge sync bookmarklet (full version, loaded from milo-cyan.vercel.app)
 *
 * Runs in the bridgeathletic.com tab when user clicks the "MILO Sync"
 * bookmark. Pulls members, activities, assignments, workout content,
 * and set history, then POSTs to MILO's /api/sync.
 *
 * The bookmark URI just loads this file — keeps the bookmark tiny and
 * makes future changes update automatically (no re-installing the bookmark).
 */
(async () => {
  const ENDPOINT  = 'https://milo-cyan.vercel.app/api/sync';
  const ORG_ID    = '19791';
  const TEAM_ID   = '37345';

  // Read sync secret from a global set by the bookmarklet URI (`__MILO_SECRET__`)
  // OR fall back to prompting once
  let secret = window.__MILO_SECRET__ || localStorage.getItem('miloSyncSecret');
  if (!secret) {
    secret = prompt('First-time setup: paste your MILO sync secret\n(this is the SYNC_SECRET you set in Vercel env vars)');
    if (!secret) return;
    if (confirm('Save this secret to localStorage so you don\'t have to paste it again on this device?')) {
      localStorage.setItem('miloSyncSecret', secret);
    }
  }

  // ── Floating progress toast ──────────────────────────────
  let toast = document.getElementById('milo-sync-toast');
  if (toast) toast.remove();
  toast = document.createElement('div');
  toast.id = 'milo-sync-toast';
  toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:#0E1117;color:#fff;padding:18px 22px;border-radius:12px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.5);min-width:300px;max-width:380px';
  const setStatus = (msg, color) => {
    toast.style.background = color || '#0E1117';
    toast.innerHTML = `<div style="display:flex;align-items:center;gap:10px"><div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#1A6BF5,#6BA8FF);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">M</div><div>MILO Sync</div></div><div style="margin-top:8px;font-weight:500;font-size:12px;color:rgba(255,255,255,0.85);line-height:1.5">${msg}</div>`;
  };
  document.body.appendChild(toast);
  setStatus('Connecting to Bridge…');

  const get = (u) => fetch(u, { credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error(`${u} → ${r.status}`);
    return r.json();
  });

  const slugify = (n) => n.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const ageFrom = (bd) => bd ? Math.floor((Date.now() - new Date(bd)) / (365.25 * 86400000)) : null;
  const initials = (n) => n.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  try {
    // ── 1. Members ────────────────────────────────────────
    setStatus('Pulling roster…');
    const members = await get(`/api/v1/organizations/${ORG_ID}/teams/${TEAM_ID}/members`);
    const userMap = Object.fromEntries(members.users.map(u => [u.id, u]));
    const wtMap   = Object.fromEntries(members.teammemberships.map(m => [m.userId, m.bodyWeight]));
    const athleteIds = members.teammemberships.filter(m => m.accessRole === 'athlete').map(m => m.userId);

    // ── 2. Per-athlete: assignments + activities (parallel within each user) ──
    setStatus(`Pulling 12-week activity for ${athleteIds.length} athletes…`);
    const bridgeData = {};
    const allWorkoutIds = new Set();
    for (const id of athleteIds) {
      const u = userMap[id]; if (!u) continue;
      try {
        const [assignments, activities] = await Promise.all([
          get(`/api/v2/organizations/${ORG_ID}/users/${id}/assignments?active=true&completed=true&teamIds=${TEAM_ID}`),
          get(`/api/v1/organizations/${ORG_ID}/teams/${TEAM_ID}/users/${id}/activities?timeRange=12&include=workoutHistories&objectTypes=workoutHistory&dataLimit=100`),
        ]);
        const recent = (activities.data || [])
          .filter(a => a.objectType === 'workoutHistory')
          .map(w => {
            if (w.workoutId) allWorkoutIds.add(w.workoutId);
            return {
              date: w.date ? w.date.slice(0, 10) : null,
              name: w.name, workoutId: w.workoutId, workoutHistoryId: w.workoutHistoryId,
              duration: w.duration ? Math.round(w.duration / 60000) : null,
              rpe: w.rpe ?? null, program: w.programName, status: w.status,
            };
          });
        const programs = (assignments.data || []).map(p => ({
          bridgeId: p.programHistoryId, name: p.name, status: p.status,
          startedAt: p.createdAt ? p.createdAt.slice(0,10) : null,
          updatedAt: p.updatedAt ? p.updatedAt.slice(0,10) : null,
          isPlaylist: !!p.isPlaylist,
        }));
        bridgeData[slugify(u.fullName)] = {
          id: slugify(u.fullName), bridgeId: u.id, name: u.fullName, initials: initials(u.fullName),
          email: u.email, age: ageFrom(u.birthDate), birthDate: u.birthDate ? u.birthDate.slice(0,10) : null,
          gender: u.gender, weightKg: wtMap[id] ? Math.round(wtMap[id]/1000000*10)/10 : null,
          programs, recentWorkouts: recent,
          programCount: programs.length, totalCompletedThisRange: recent.filter(w => w.status === 'completed').length,
        };
      } catch (e) { /* skip individual failures */ }
    }

    // ── 3. Workout content for all unique workoutIds (batched parallel) ──
    setStatus(`Pulling ${allWorkoutIds.size} workout templates…`);
    const workoutContent = {};
    const extract = async (wid) => {
      try {
        const r = await fetch(`/api/v1/organizations/${ORG_ID}/workouts/${wid}`, { credentials: 'include' });
        if (!r.ok) return null;
        const data = await r.json();
        const w = data.workouts; const linked = data.linked || {};
        const blocks = Object.values(linked.blocks || {});
        const blockSets = Object.values(linked.blockSets || {});
        const exercises = Object.values(linked.exercises || {});
        const exById = Object.fromEntries(exercises.map(e => [e.exerciseId, e]));
        const bsById = Object.fromEntries(blockSets.map(s => [s.blockSetId, s]));
        const leanBlocks = blocks.sort((a,b) => (a.sequence||0)-(b.sequence||0)).map(b => {
          const setIds = b.links?.blockSets || [];
          const setRows = setIds.map(sid => bsById[sid]).filter(Boolean);
          const byExercise = {};
          for (const s of setRows) {
            const exId = s.weightExerciseId || s.blockExerciseId || (s.links?.exercises?.[0]) || 'unknown';
            if (!byExercise[exId]) byExercise[exId] = { exerciseId: exId, sets: [] };
            byExercise[exId].sets.push({
              type: s.type, reps: s.reps,
              weight: s.prescribed?.weight?.modifier?.value, weightUnit: s.prescribed?.weight?.unit,
              distance: s.prescribed?.distance?.value, distanceUnit: s.prescribed?.distance?.unit,
              rpe: s.RPE, rest: s.restTime, note: s.note,
            });
          }
          return {
            name: b.name, rounds: b.rounds, minutes: b.minutes, isCircuit: b.isCircuit,
            exercises: Object.values(byExercise).map(e => ({
              name: exById[e.exerciseId]?.name || `#${e.exerciseId}`,
              slug: exById[e.exerciseId]?.slug, exerciseId: e.exerciseId, sets: e.sets,
            })),
          };
        });
        return { workoutId: wid, name: w.name, blocks: leanBlocks };
      } catch (e) { return null; }
    };
    const ids = [...allWorkoutIds];
    const batchSize = 25;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(extract));
      batch.forEach((id, idx) => { if (results[idx]) workoutContent[id] = results[idx]; });
      setStatus(`Pulling workout templates… ${Math.min(i + batchSize, ids.length)}/${ids.length}`);
    }

    // ── 4. Set history (logged sets) for all athletes ──
    setStatus('Pulling logged set history…');
    const allSets = {};
    const exerciseNames = {};
    for (const id of athleteIds) {
      try {
        const url = `/api/v1/organizations/${ORG_ID}/teams/${TEAM_ID}/users/${id}/activities?timeRange=12&objectTypes=blockSetHistory%7CTracked&objectTypes=blockSetHistory%7CRequired&include=workoutHistories&dataLimit=500`;
        const data = await get(url);
        const records = (data.data || []).filter(r => r.type === 'Tracked' && (r.resultWeight || r.resultReps));
        const exObj = data.linked?.exercises || {};
        const exArr = Array.isArray(exObj) ? exObj : Object.values(exObj);
        for (const e of exArr) if (e.exerciseId) exerciseNames[e.exerciseId] = e.name;
        allSets[id] = records.map(r => ({
          d: r.date || r.dateTime?.slice(0,10),
          ex: r.exerciseId || r.blockExerciseId,
          rw: r.resultWeight, rr: r.resultReps,
          rrpe: r.resultRPE?.value ?? r.resultRPE,
          whId: r.workoutHistoryId,
        })).filter(s => s.d && s.ex && (s.rw || s.rr));
      } catch (e) { allSets[id] = []; }
    }
    const setHistory = { sets: allSets, exerciseNames };

    // ── 5. POST to MILO ───────────────────────────────────
    setStatus('Posting to Vercel…');
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Secret': secret },
      body: JSON.stringify({ bridgeData, workoutContent, setHistory }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);

    const totalSets = Object.values(allSets).reduce((s, a) => s + a.length, 0);
    setStatus(`<b style="color:#7BE0A8">✓ Synced ${body.clientCount} clients · ${Object.keys(workoutContent).length} workouts · ${totalSets} logged sets</b><br><span style="opacity:0.7;font-size:11px">Vercel is redeploying — fresh on milo-cyan.vercel.app in ~60-90s.</span>`, '#0D2818');
    setTimeout(() => toast.remove(), 8000);
  } catch (e) {
    setStatus(`<b style="color:#FF8888">✗ ${e.message}</b><br><span style="opacity:0.7;font-size:11px">Check console for details. Bookmark stayed loaded; safe to try again.</span>`, '#2A0E0E');
    console.error('[MILO Sync]', e);
    setTimeout(() => toast.remove(), 12000);
  }
})();
