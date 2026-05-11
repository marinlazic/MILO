/* ============================================================
   MILO — Client Data Layer
   ----------------------------------------------------------------
   This file is the SINGLE SOURCE OF TRUTH for client data in MILO.

   Right now: data is hand-keyed from Bridge Athletic screenshots.

   Future (Option B — live Bridge sync):
     replace `BRIDGE_DATA` with output from `bridgeSync.fetchClient(id)`
     which will use Chrome MCP automation to scrape Bridge in real-time.
     The schema below is what bridgeSync must produce.
   ============================================================ */

const BRIDGE_DATA = {

  // ─────────────────────────────────────────────
  // Craig Blair — fully populated from Bridge
  // Source: bridgeathletic.com/.../roster/283036
  // Captured: 2026-05-11
  // ─────────────────────────────────────────────
  "craig-blair": {
    id: "craig-blair",
    bridgeId: "283036",
    name: "Craig Blair",
    initials: "CB",
    email: "craig@airtree.vc",
    status: "active",
    position: "",
    age: 57,
    heightCm: 182,
    weightKg: 83,
    hrMax: 163,

    programs: [
      { name: "Road to LA28 — Craig",     completed: 174, total: 206, primary: true  },
      { name: "Pre-Surf Return Program",  completed: 4,   total: 14,  primary: false },
      { name: "Hotel Gym Program INDIA",  completed: 2,   total: 9,   primary: false },
      { name: "STRONG HIPS",              completed: 0,   total: 28,  primary: false },
      { name: "Train From Home (6wk)",    completed: 0,   total: 16,  primary: false },
      { name: "TESTING",                  completed: 0,   total: 1,   primary: false }
    ],

    todayAssignments: 0,   // already completed today's session

    recentWorkouts: [
      { date: "2026-05-11", name: "Hinge, Carry, Core",       duration: 49, rpe: 3 },
      { date: "2026-05-06", name: "Zone 2 Aerobic Base",      duration: 44, rpe: 5 },
      { date: "2026-05-05", name: "Pull, Posterior Shoulder", duration: 56, rpe: 5 },
      // older entries get loaded on demand once we wire Bridge fetcher
    ],

    // May 2026 schedule pulled from Bridge calendar view
    scheduledWorkouts: [
      { date: "2026-04-28", name: "Pull (5/3)",                status: "completed" },
      { date: "2026-04-30", name: "Pull (5/3)",                status: "completed" },
      { date: "2026-05-01", name: "Pull (5/3)",                status: "completed" },
      { date: "2026-05-03", name: "Push, Glute, Hip",          status: "completed" },
      { date: "2026-05-04", name: "Pull, Posterior Shoulder",  status: "completed" },
      { date: "2026-05-05", name: "Pull, Posterior Shoulder",  status: "completed" },
      { date: "2026-05-06", name: "Zone 2 Aerobic Base",       status: "completed" },
      { date: "2026-05-11", name: "Hinge, Carry, Core",        status: "completed" }
    ],

    forms: [
      { name: "Post Workout",    lastSubmitted: "2026-05-11" },
      { name: "Performance Log", lastSubmitted: "2026-05-11" },
      { name: "Activity Form",   lastSubmitted: "2023-08-25" }
    ],

    notes: [],

    // ─── MILO-NATIVE FIELDS ──────────────────────
    // these don't come from Bridge — they get populated
    // via MILO's own daily check-in widget or wearables
    miloFields: {
      readiness: null,    // 0–100, from daily check-in
      recovery:  null,    // 0–100, from HRV + sleep
      load7d:    72,      // computed from RPE × duration over 7 days
      lastCheckIn: null,
    }
  },

  // ─── Other 18 clients from Bridge roster (basic shell — fill in as we go) ───
  "liam-beard":           { id: "liam-beard",           name: "Liam Beard",           initials: "LB", programs: [{ name: "Liam Tennis Performance Foundation",      completed: 0,  total: 30 }] },
  "stephanie-belton":     { id: "stephanie-belton",     name: "Stephanie Belton",     initials: "SB", programs: [{ name: "2026 Program \"Move Strong\" — Mel & Steph", completed: 20, total: 20 }] },
  "melanie-caffrey":      { id: "melanie-caffrey",      name: "Melanie Caffrey",      initials: "MC", programs: [{ name: "2026 Program \"Move Strong\" — Mel & Steph", completed: 16, total: 19 }] },
  "katherine-freire":     { id: "katherine-freire",     name: "Katherine Freire",     initials: "KF", programs: [{ name: "Health & Performance",                     completed: 5,  total: 16 }] },
  "maria-goddard":        { id: "maria-goddard",        name: "Maria Goddard",        initials: "MG", programs: [{ name: "Health and Performance — Maria",           completed: 5,  total: 14 }] },
  "linda-gregory":        { id: "linda-gregory",        name: "Linda Gregory",        initials: "LG", programs: [{ name: "2025 — Linda",                             completed: 2,  total: 18 }] },
  "sondra-hamill":        { id: "sondra-hamill",        name: "Sondra Hamill",        initials: "SH", programs: [{ name: "Sondra Hamill — 12 Week Home Programme",   completed: 6,  total: 12 }], flagged: true },
  "michael-james":        { id: "michael-james",        name: "Michael James",        initials: "MJ", programs: [{ name: "ARM FARM MJ",                              completed: 16, total: 16 }] },
  "charlie-lanchester":   { id: "charlie-lanchester",   name: "Charlie Lanchester",   initials: "CL", programs: [{ name: "ARM FARM Charlie",                         completed: 9,  total: 16 }] },
  "renee-lodens":         { id: "renee-lodens",         name: "Renee Lodens",         initials: "RL", programs: [{ name: "2026 Program — Renee Lodens (Kettlebells)", completed: 16, total: 16 }] },
  "mark-oreilly":         { id: "mark-oreilly",         name: "Mark O'Reilly",        initials: "MO", programs: [{ name: "Mark — SLEEP BETTER PROGRAM",              completed: 4,  total: 12 }] },
  "reini-otter":          { id: "reini-otter",          name: "Reini Otter",          initials: "RO", programs: [{ name: "ARM FARM (no above head)",                 completed: 30, total: 30 }] },
  "nathan-parris":        { id: "nathan-parris",        name: "Nathan Parris",        initials: "NP", programs: [{ name: "Nathan 2026 Health and Performance",       completed: 4,  total: 30 }] },
  "alana-saphin":         { id: "alana-saphin",         name: "Alana Saphin",         initials: "AS", programs: [{ name: "Alana 2026 Health and Performance",        completed: 30, total: 30 }] },
  "craig-saphin":         { id: "craig-saphin",         name: "Craig Saphin",         initials: "CS", programs: [{ name: "2025 — Craig Saphin",                      completed: 4,  total: 12 }] },
  "david-shein":          { id: "david-shein",          name: "David Shein",          initials: "DS", programs: [{ name: "Road to LA — David",                       completed: 4,  total: 18 }] },
  "steve-turner":         { id: "steve-turner",         name: "Steve Turner",         initials: "ST", programs: [{ name: "Steve Turner 2025",                        completed: 1,  total: 16 }] },
  "samantha-van-gelder":  { id: "samantha-van-gelder",  name: "Samantha van Gelder",  initials: "SG", programs: [{ name: "Hypertrophy & Impulse Integration",        completed: 1,  total: 30 }] }
};

/* ============================================================
   Bridge Sync interface — stub for Option B
   ----------------------------------------------------------------
   When we wire Chrome MCP, replace bridgeSync.fetchClient(id) so
   it scrapes Bridge live and returns the same schema as above.
   ============================================================ */
const bridgeSync = {
  async fetchClient(id) {
    // PLACEHOLDER — Option B will replace this body with a live scrape.
    return BRIDGE_DATA[id] || null;
  },
  async fetchAllClients() {
    return Object.values(BRIDGE_DATA);
  },
  lastSynced: "2026-05-11T10:30:00+10:00"
};

/* ============================================================
   Helpers
   ============================================================ */
function getClient(id) {
  return BRIDGE_DATA[id] || null;
}

function getAllClients() {
  return Object.values(BRIDGE_DATA);
}

function pctComplete(c) {
  return c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0;
}

// expose globally for plain-html consumption
if (typeof window !== 'undefined') {
  window.MILO = { BRIDGE_DATA, bridgeSync, getClient, getAllClients, pctComplete };
}
