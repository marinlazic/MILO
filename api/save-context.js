// MILO — Save coaching context (principles + per-athlete notes)
//
// POST /api/save-context with one of:
//   { type: 'principles', principles: {...} }
//   { type: 'athleteNotes', clientId: 'craig-blair', notes: {...} }
//
// Commits coaching-principles.json or athlete-notes.json back to
// the GitHub repo via Contents API.
//
// Auth: same SYNC_SECRET as /api/sync (set in Vercel env vars).

const GH_OWNER = 'marinlazic';
const GH_REPO  = 'MILO';
const GH_BRANCH = 'main';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Sync-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const expectedSecret = process.env.SYNC_SECRET;
  if (!expectedSecret) return res.status(500).json({ error: 'SYNC_SECRET not configured' });
  if (req.headers['x-sync-secret'] !== expectedSecret) return res.status(401).json({ error: 'Bad sync secret' });

  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });

  const { type, principles, clientId, notes } = req.body || {};
  const ts = new Date().toISOString();

  try {
    if (type === 'principles') {
      if (!principles || typeof principles !== 'object') return res.status(400).json({ error: 'Missing principles object' });
      const merged = { ...principles, _meta: { ...(principles._meta || {}), lastEdited: ts, version: (principles._meta?.version || 1) } };
      const commit = await upsertFile(ghToken, 'coaching-principles.json', JSON.stringify(merged, null, 2), `chore(context): update coaching principles · ${ts}`);
      return res.status(200).json({ ok: true, ts, commit });
    }

    if (type === 'athleteNotes') {
      if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
      if (!notes || typeof notes !== 'object') return res.status(400).json({ error: 'Missing notes object' });

      // Fetch existing file, merge, write back
      const existing = await fetchJson(ghToken, 'athlete-notes.json');
      const current = existing.json || { _meta: { version: 1 } };
      current[clientId] = notes;
      current._meta = { ...(current._meta || {}), lastEdited: ts, lastEditedClient: clientId };

      const commit = await upsertFile(
        ghToken,
        'athlete-notes.json',
        JSON.stringify(current, null, 2),
        `chore(context): update notes for ${clientId} · ${ts}`,
        existing.sha
      );
      return res.status(200).json({ ok: true, ts, clientId, commit });
    }

    return res.status(400).json({ error: 'Invalid type. Use "principles" or "athleteNotes".' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

async function fetchJson(token, path) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'milo-context' } });
    if (!r.ok) return { json: null, sha: null };
    const j = await r.json();
    const content = Buffer.from(j.content, 'base64').toString('utf8');
    return { json: JSON.parse(content), sha: j.sha };
  } catch (e) { return { json: null, sha: null }; }
}

async function upsertFile(token, path, content, message, existingSha) {
  const apiBase = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  let sha = existingSha;
  if (!sha) {
    try {
      const r = await fetch(`${apiBase}?ref=${GH_BRANCH}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'milo-context' },
      });
      if (r.ok) sha = (await r.json()).sha;
    } catch (e) {}
  }
  const contentB64 = Buffer.from(content, 'utf8').toString('base64');
  const r = await fetch(apiBase, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'milo-context' },
    body: JSON.stringify({ message, content: contentB64, branch: GH_BRANCH, ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw new Error(`Failed to write ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.commit?.sha;
}
