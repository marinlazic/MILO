// MILO Sync — background service worker
// Registers daily alarms at 08:30 and 10:00 local time.
// When alarm fires, finds (or opens) a Bridge tab and runs the sync.

import { syncFromBridge } from './sync-logic.js';

const ALARMS = [
  { name: 'milo-auto-sync-0830', hour: 8,  minute: 30 },
  { name: 'milo-auto-sync-1000', hour: 10, minute: 0  },
];

// ── Schedule helpers ───────────────────────────────────
function nextOccurrenceMs(hour, minute) {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

async function setAlarms(enabled) {
  await chrome.alarms.clearAll();
  if (!enabled) return;
  for (const a of ALARMS) {
    await chrome.alarms.create(a.name, {
      when: nextOccurrenceMs(a.hour, a.minute),
      periodInMinutes: 24 * 60, // daily
    });
  }
  console.log('[MILO] Auto-sync alarms scheduled:', ALARMS.map(a => `${a.hour}:${String(a.minute).padStart(2,'0')}`).join(', '));
}

// ── Lifecycle: re-arm alarms on install/startup ────────
chrome.runtime.onInstalled.addListener(async () => {
  const { autoSyncEnabled } = await chrome.storage.local.get(['autoSyncEnabled']);
  // Default ON for new installs
  const enabled = autoSyncEnabled === undefined ? true : autoSyncEnabled;
  await chrome.storage.local.set({ autoSyncEnabled: enabled });
  await setAlarms(enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const { autoSyncEnabled } = await chrome.storage.local.get(['autoSyncEnabled']);
  await setAlarms(autoSyncEnabled !== false);
});

// ── React to toggle changes from popup ─────────────────
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.autoSyncEnabled) {
    await setAlarms(changes.autoSyncEnabled.newValue !== false);
  }
});

// ── Alarm fires → run the sync ─────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('milo-auto-sync')) return;
  console.log(`[MILO] Alarm fired: ${alarm.name}`);

  const { secret, autoSyncEnabled } = await chrome.storage.local.get(['secret', 'autoSyncEnabled']);
  if (autoSyncEnabled === false) return;
  if (!secret) {
    notify('MILO auto-sync skipped', 'Open the extension and set your sync secret first.');
    return;
  }

  // Find a Bridge tab. If none, open one in the background.
  const tabs = await chrome.tabs.query({ url: ['https://bridgeathletic.com/*', 'https://*.bridgeathletic.com/*'] });
  let tab = tabs[0];
  let openedFresh = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: 'https://bridgeathletic.com/', active: false, pinned: true });
    openedFresh = true;
    // Wait up to 25 seconds for the tab to fully load
    await waitForTabLoad(tab.id, 25_000);
  }

  // Run the sync
  let result;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [secret],
      func: syncFromBridge,
    });
    result = r?.result;
  } catch (e) {
    result = { error: `executeScript failed: ${e.message}` };
  }

  if (result?.ok) {
    await chrome.storage.local.set({ lastSync: Date.now(), lastSyncResult: result });
    notify('MILO synced ✓', `${result.clientCount} clients · ${result.workoutCount} workouts · ${result.setCount} logged sets. Vercel deploying.`);
  } else {
    await chrome.storage.local.set({ lastSyncError: result?.error || 'Unknown', lastSyncErrorAt: Date.now() });
    notify('MILO sync failed', result?.error || 'Unknown error. Open MILO Sync popup to retry manually.');
  }

  // Close the tab we opened (we don't want to litter)
  if (openedFresh) {
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
  }
});

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        // tiny extra delay for app shell to mount
        setTimeout(resolve, 1500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title,
    message,
    priority: 0,
  });
}
