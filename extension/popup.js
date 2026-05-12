// MILO Sync — popup logic
// Manual "Sync now" + toggle for auto-sync at 8:30 + 10:00 daily.

import { syncFromBridge } from './sync-logic.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const lastSyncEl = $('lastSync');
const nextSyncEl = $('nextSync');
const secretInput = $('secret');
const btn = $('syncBtn');
const toggle = $('autoToggle');

function setStatus(msg, kind) {
  statusEl.innerHTML = `<span class="${kind || ''}">${msg}</span>`;
}

function fmtAgo(ts) {
  if (!ts) return '—';
  const ago = Math.round((Date.now() - ts) / 60000);
  if (ago < 1) return 'just now';
  if (ago < 60) return `${ago}m ago`;
  if (ago < 1440) return `${Math.round(ago/60)}h ago`;
  return `${Math.round(ago/1440)}d ago`;
}

function fmtNext(date) {
  const ms = date.getTime() - Date.now();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `in ${h}h ${m}m`;
}

function nextScheduledSync() {
  // Same logic as background.js — next of 8:30 or 10:00 today, else tomorrow's 8:30
  const candidates = [
    new Date(), new Date()
  ];
  candidates[0].setHours(8, 30, 0, 0);
  candidates[1].setHours(10, 0, 0, 0);
  for (const c of candidates) {
    if (c.getTime() > Date.now()) return c;
  }
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 30, 0, 0);
  return tomorrow;
}

// ── Load initial state ─────────────────────────────────
chrome.storage.local.get(['secret', 'lastSync', 'lastSyncError', 'autoSyncEnabled'], (s) => {
  if (s.secret) secretInput.value = s.secret;
  lastSyncEl.textContent = `Last synced: ${fmtAgo(s.lastSync)}`;

  // Default ON for first time
  const enabled = s.autoSyncEnabled !== false;
  toggle.checked = enabled;
  updateNextSyncDisplay(enabled);

  if (s.lastSyncError && (!s.lastSync || s.lastSyncError && Date.now() - (s.lastSync || 0) > 60000)) {
    // Show last error if it's recent and there isn't a more recent success
  }

  if (!s.secret) {
    setStatus('Paste your SYNC_SECRET above. Saves locally — only enter it once per device.', 'progress');
  } else {
    setStatus('Ready. Click "Sync now" or wait for the scheduled run.', 'progress');
  }
});

function updateNextSyncDisplay(enabled) {
  if (!enabled) {
    nextSyncEl.textContent = 'Auto-sync is OFF';
    nextSyncEl.style.opacity = 0.6;
    return;
  }
  const next = nextScheduledSync();
  const time = next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  nextSyncEl.textContent = `Next auto-sync: ${time} (${fmtNext(next)})`;
  nextSyncEl.style.opacity = 1;
}

// ── Listeners ──────────────────────────────────────────
secretInput.addEventListener('input', () => {
  chrome.storage.local.set({ secret: secretInput.value });
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ autoSyncEnabled: toggle.checked });
  updateNextSyncDisplay(toggle.checked);
});

btn.addEventListener('click', async () => {
  const secret = secretInput.value.trim();
  if (!secret) { setStatus('Paste your sync secret first.', 'err'); return; }

  btn.disabled = true;
  setStatus('Finding Bridge tab…', 'progress');

  const tabs = await chrome.tabs.query({ url: ['https://bridgeathletic.com/*', 'https://*.bridgeathletic.com/*'] });
  let tab = tabs[0];

  if (!tab) {
    setStatus('No Bridge tab open. Opening one — log in if needed, then come back here and click Sync again.', 'err');
    await chrome.tabs.create({ url: 'https://bridgeathletic.com/' });
    btn.disabled = false;
    return;
  }

  setStatus('Connected. Pulling data — this takes ~30-60s…', 'progress');

  let result;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
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
    chrome.storage.local.set({ lastSync: Date.now(), lastSyncResult: result });
    lastSyncEl.textContent = 'Last synced: just now';
  }
  btn.disabled = false;
});
