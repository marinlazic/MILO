// Shared sync function injected into the Bridge tab by both the
// popup (manual sync) and background.js (scheduled auto-sync).
//
// IMPORTANT: this function runs in the bridgeathletic.com tab's ISOLATED
// world (extension privilege) so it bypasses Bridge's CSP for fetches to
// milo-cyan.vercel.app, while cookies are still attached for Bridge
// fetches via credentials:'include'.
//
// Must be fully self-contained — chrome.scripting.executeScript({ func })
// passes ONLY this function literal across the world boundary; it can't
// reference anything in module scope.

export async function syncFromBridge(secret) {
  const ENDPOINT = 'https://milo-cyan.vercel.app/api/sync';
  const ORG_ID = '19791', TEAM_ID = '37345';
  const get = (u) => fetch(u, { credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error(`${u.split('?')[0]} → ${r.status}`);
    return r.json();
  });
  const slugify = (n) => n.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const ageFrom = (bd) => bd ? Math.floor((Date.now() - new Date(bd)) / (365.25 * 86400000)) : null;
  const initials = (n) => n.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  let phase = 'init';
  try {
    phase = 'members';
    const members = await get(`/api/v1/organizations/${ORG_ID}/teams/${TEAM_ID}/members`);
    const userMap = Object.fromEntries(members.users.map(u => [u.id, u]));
    const wtMap   = Object.fromEntries(members.teammemberships.map(m => [m.userId, m.bodyWeight]));
    const athleteIds = members.teammemberships.filter(m => m.accessRole === 'athlete').map(m => m.userId);

    phase = 'activities';
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
      } catch (e) { /* skip individual */ }
    }

    phase = 'workouts';
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
    for (let i = 0; i < ids.length; i += 25) {
      const batch = ids.slice(i, i + 25);
      const results = await Promise.all(batch.map(extract));
      batch.forEach((id, idx) => { if (results[idx]) workoutContent[id] = results[idx]; });
    }

    phase = 'setHistory';
    const allSets = {};
    const exerciseNames = {};
    for (const id of athleteIds) {
      try {
        const url = `/api/v1/organizations/${ORG_ID}/teams/${TEAM_ID}/users/${id}/activities?timeRange=12&objectTypes=blockSetHistory%7CTracked&objectTypes=blockSetHistory%7CRequired&include=workoutHistories&dataLimit=500`;
        const data = await get(url);
        // Widened filter: accept ANY record that has a non-zero result weight OR reps, regardless
        // of `type`. Older Bridge data uses type 'Tracked'; newer logs may come back as 'Required'
        // with the result fields populated, or another tag entirely. Keying off the result data
        // itself is the reliable signal that a set was actually logged.
        const hasResult = (r) => (r.resultWeight && r.resultWeight > 0) || (r.resultReps != null && r.resultReps !== '');
        const records = (data.data || []).filter(hasResult);
        const exObj = data.linked?.exercises || {};
        const exArr = Array.isArray(exObj) ? exObj : Object.values(exObj);
        for (const e of exArr) if (e.exerciseId) exerciseNames[e.exerciseId] = e.name;
        allSets[id] = records.map(r => ({
          d: r.date || r.dateTime?.slice(0,10) || r.completedAt?.slice(0,10),
          ex: r.exerciseId || r.blockExerciseId,
          rw: r.resultWeight, rr: r.resultReps,
          rrpe: r.resultRPE?.value ?? r.resultRPE,
          whId: r.workoutHistoryId,
          t: r.type,  // keep the record type for debugging
        })).filter(s => s.d && s.ex && (s.rw || s.rr));
      } catch (e) { allSets[id] = []; }
    }
    const setHistory = { sets: allSets, exerciseNames };

    phase = 'post';
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Secret': secret },
      body: JSON.stringify({ bridgeData, workoutContent, setHistory }),
    });
    const body = await r.json();
    if (!r.ok) return { error: body.error || `HTTP ${r.status}` };

    const totalSets = Object.values(allSets).reduce((s, a) => s + a.length, 0);
    return {
      ok: true,
      clientCount: body.clientCount || Object.keys(bridgeData).length,
      workoutCount: Object.keys(workoutContent).length,
      setCount: totalSets,
    };
  } catch (e) {
    return { error: `[${phase}] ${e.message || String(e)}` };
  }
}
