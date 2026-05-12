// MILO Sync — popup logic
// User clicks extension icon → this popup loads → user clicks Sync now
// → we inject the sync function into the active bridgeathletic.com tab
// → it runs the full data pull and POSTs to /api/sync.

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const lastSyncEl = $('lastSync');
const secretInput = $('secret');
const btn = $('syncBtn');

function setStatus(msg, kind) {
  statusEl.innerHTML = `<span class="${kind || ''}">${msg}</span>`;
}

// Load saved state
chrome.storage.local.get(['secret', 'lastSync'], ({ secret, lastSync }) => {
  if (secret) secretInput.value = secret;
  if (lastSync) {
    const ago = Math.round((Date.now() - lastSync) / 60000);
    const txt = ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago/60)}h ago` : `${Math.round(ago/1440)}d ago`;
    lastSyncEl.textContent = `Last synced: ${txt}`;
  }
  if (!secret) {
    setStatus('Paste your SYNC_SECRET above (the same value you put into Vercel). It saves locally — you only do this once.', 'progress');
  } else {
    setStatus('Ready. Click "Sync now" while logged into Bridge.', 'progress');
  }
});

secretInput.addEventListener('input', () => {
  chrome.storage.local.set({ secret: secretInput.value });
});

btn.addEventListener('click', async () => {
  const secret = secretInput.value.trim();
  if (!secret) { setStatus('Paste your sync secret first.', 'err'); return; }

  btn.disabled = true;
  setStatus('Finding Bridge tab…', 'progress');

  // Find an existing Bridge tab (any subdomain/path)
  const tabs = await chrome.tabs.query({ url: ['https://bridgeathletic.com/*', 'https://*.bridgeathletic.com/*'] });
  let tab = tabs[0];

  if (!tab) {
    setStatus('No Bridge tab open. Opening one — log in if needed, then come back here and click Sync again.', 'err');
    await chrome.tabs.create({ url: 'https://bridgeathletic.com/' });
    btn.disabled = false;
    return;
  }

  setStatus('Connected to Bridge tab. Pulling data — this takes ~30-60s…', 'progress');

  // Inject the sync function and run it with the secret
  let result;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      // Default 'ISOLATED' world — extension scripts get to bypass the page's CSP,
      // while fetches with credentials:'include' still attach the user's cookies
      // for the origin (so Bridge API calls work and POST to MILO is allowed).
      args: [secret],
      func: syncFromBridge,
    });
    result = r?.result;
  } catch (e) {
    setStatus(`<b>✗ Could not run sync:</b> ${e.message}`, 'err');
    btn.disabled = false;
    return;
  }

  if (!result) {
    setStatus('<b>✗ No response from sync function.</b>', 'err');
  } else if (result.error) {
    setStatus(`<b>✗</b> ${result.error}`, 'err');
  } else {
    setStatus(`<b>✓ Synced</b> ${result.clientCount} clients · ${result.workoutCount} workouts · ${result.setCount} logged sets<br><span class="progress">Vercel deploying — fresh data on milo-cyan.vercel.app in ~60-90s.</span>`, 'ok');
    chrome.storage.local.set({ lastSync: Date.now() });
    setTimeout(() => {
      const ago = '0m ago';
      lastSyncEl.textContent = `Last synced: just now`;
    }, 100);
  }
  btn.disabled = false;
});

/**
 * INJECTED into the active bridgeathletic.com tab. Has access to the
 * user's Bridge cookies (via credentials:'include') and runs all the
 * Bridge API calls, then POSTs to /api/sync.
 *
 * Returns { clientCount, workoutCount, setCount } on success or { error } on fail.
 */
async function syncFromBridge(secret) {
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
    // 1. Members
    const members = await get(`/api/v1/organizations/${ORG_ID}/teams/${TEAM_ID}/members`);
    const userMap = Object.fromEntries(members.users.map(u => [u.id, u]));
    const wtMap   = Object.fromEntries(members.teammemberships.map(m => [m.userId, m.bodyWeight]));
    const athleteIds = members.teammemberships.filter(m => m.accessRole === 'athlete').map(m => m.userId);

    phase = 'activities';
    // 2. Per-athlete activities + assignments (parallel pairs)
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

    phase = 'workouts';
    // 3. Workout content per unique workoutId (parallel batches of 25)
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
    // 4. Set history (logged sets)
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

    phase = 'post';
    // 5. POST to MILO
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
