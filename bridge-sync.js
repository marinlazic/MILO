/* ============================================================
   MILO — Bridge Athletic Sync
   ============================================================

   Reusable functions to pull live data from Bridge Athletic
   into MILO's data layer.

   HOW TO RUN A SYNC:
   ------------------
   Option A (manual, browser console):
     1. Open https://bridgeathletic.com in Chrome (logged in)
     2. Open DevTools console
     3. Paste this file's contents OR run: bridgeSync.run()
     4. A milo-bridge-sync.json file will download
     5. Replace `bridge-data.json` in the repo with it
     6. Commit & push

   Option B (via Claude Code + Chrome MCP):
     Just say "sync from Bridge" — Claude drives the browser.

   ENDPOINTS WE USE (Bridge's internal API):
   -----------------------------------------
     GET /api/v1/users/{userId}                   → profile
     GET /api/v1/organizations/{orgId}/teams/{teamId}/members
                                                  → roster + bodyweight
     GET /api/v2/organizations/{orgId}/users/{userId}/assignments
                                                  → all program assignments
     GET /api/v1/organizations/{orgId}/teams/{teamId}/users/{userId}/activities
                                                  → recent workouts (RPE, duration)
   ============================================================ */

(function (global) {
  const ORG_ID  = '19791';      // Marin Lazic Coaching
  const TEAM_ID = '37345';      // Health and Performance Team

  const TODAY = new Date();

  const slugify = (n) => n.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const age = (bd) => bd ? Math.floor((TODAY - new Date(bd)) / (365.25 * 24 * 60 * 60 * 1000)) : null;
  const initials = (n) => n.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  const get = (url) => fetch(url, { credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r.json();
  });

  async function fetchAllAthletes(orgId = ORG_ID, teamId = TEAM_ID) {
    const members = await get(`/api/v1/organizations/${orgId}/teams/${teamId}/members`);
    const userMap = Object.fromEntries(members.users.map(u => [u.id, u]));
    const wtMap   = Object.fromEntries(members.teammemberships.map(m => [m.userId, m.bodyWeight]));
    const athleteIds = members.teammemberships
      .filter(m => m.accessRole === 'athlete')
      .map(m => m.userId);

    const results = {};
    for (const id of athleteIds) {
      const u = userMap[id];
      if (!u) continue;
      try {
        const [assignments, activities] = await Promise.all([
          get(`/api/v2/organizations/${orgId}/users/${id}/assignments?active=true&completed=true&teamIds=${teamId}`),
          get(`/api/v1/organizations/${orgId}/teams/${teamId}/users/${id}/activities?timeRange=12&include=workoutHistories&objectTypes=workoutHistory&dataLimit=100`),
        ]);

        const recent = (activities.data || [])
          .filter(a => a.objectType === 'workoutHistory')
          .slice(0, 100)
          .map(w => ({
            date: w.date ? w.date.slice(0, 10) : null,
            name: w.name,
            duration: w.duration ? Math.round(w.duration / 60000) : null,
            rpe: w.rpe ?? null,
            program: w.programName,
            status: w.status,
          }));

        const programs = (assignments.data || []).map(p => ({
          bridgeId: p.programHistoryId,
          name: p.name,
          status: p.status,
          startedAt: p.createdAt ? p.createdAt.slice(0, 10) : null,
          updatedAt: p.updatedAt ? p.updatedAt.slice(0, 10) : null,
          isPlaylist: !!p.isPlaylist,
        }));

        results[slugify(u.fullName)] = {
          id: slugify(u.fullName),
          bridgeId: u.id,
          name: u.fullName,
          initials: initials(u.fullName),
          email: u.email,
          age: age(u.birthDate),
          birthDate: u.birthDate ? u.birthDate.slice(0, 10) : null,
          gender: u.gender,
          weightKg: wtMap[id] ? Math.round(wtMap[id] / 1000000 * 10) / 10 : null,
          programs,
          recentWorkouts: recent,
          programCount: programs.length,
          totalCompletedThisRange: recent.filter(w => w.status === 'completed').length,
        };
      } catch (e) {
        results[slugify(u.fullName)] = {
          id: slugify(u.fullName),
          name: u.fullName,
          error: String(e),
        };
      }
    }
    return results;
  }

  function downloadJSON(data, filename = 'milo-bridge-sync.json') {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function run({ orgId, teamId, download = true } = {}) {
    console.log('[MILO] Bridge sync starting…');
    const data = await fetchAllAthletes(orgId, teamId);
    const count = Object.keys(data).length;
    console.log(`[MILO] Bridge sync complete. ${count} athletes pulled.`);
    if (download) {
      downloadJSON(data);
      console.log('[MILO] milo-bridge-sync.json downloaded — replace bridge-data.json in repo.');
    }
    window._bridgeData = data;
    return data;
  }

  global.bridgeSync = { run, fetchAllAthletes, downloadJSON, ORG_ID, TEAM_ID };
})(typeof window !== 'undefined' ? window : globalThis);
