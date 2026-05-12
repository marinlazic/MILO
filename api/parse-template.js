// MILO — Parse Template from Screenshot
//
// POST /api/parse-template with:
//   { images: [{ base64, mimeType }], hint?: 'optional coach note' }
//
// Sends the screenshot(s) to Claude Sonnet 4.5 with vision and asks for a
// structured template in MILO's program-templates.json schema. Returns the
// parsed JSON for the coach to review + save via /api/save-context.

import Anthropic from '@anthropic-ai/sdk';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

const SYSTEM_PROMPT = `You are a coaching template parser for MILO. Marin (the head coach) will paste a screenshot of a program template — usually a table of workouts with columns like Category/Exercise / Sets / Reps / Workout 1-3 or W1-W6. Your job: convert the image into a structured JSON template that fits MILO's program-templates.json schema EXACTLY.

OUTPUT SHAPE (this is what /templates.html and /api/program.js expect):

{
  "id": "kebab-case-id-derived-from-name",
  "name": "Short human name (e.g. 'Strength + Power 3')",
  "progressionOrder": 12,
  "summary": {
    "style": "foundation | volume bump | triplet density | metabolic | hypertrophy",
    "repScheme": "very short summary, e.g. '2-3×6 + 2×15' or 'Wave 7-5-3 → 5-3-1'",
    "conditioning": "very short, e.g. 'Intervals · 30s/30s' or 'Free Zone AMRAP · 5 min'"
  },
  "description": "1-2 sentence plain-English summary of the block.",
  "tags": ["strength", "hypertrophy", "advanced", ...],
  "weeks": 4,
  "uniqueSessions": 2,
  "frequencyOptions": [2, 3, 4],
  "defaultFrequency": 3,
  "cyclingNote": "How the workouts cycle through the week.",
  "undulating": {  // OPTIONAL — only if periodisation is daily-undulating or wave
    "type": "daily" | "wave",
    "dailyRotation": [ { "day": 1, "sets": 4, "reps": 6, "intent": "strength" }, ... ],
    "wavePeriodization": {
      "wavesPerSession": 2,
      "setsPerWave": 3,
      "cycles": [ { "cycle": 1, "weeks": [1], "repsPerSet": [7,5,3,7,5,3], "intent": "..." }, ... ]
    }
  },
  "sessions": [
    {
      "name": "Workout A",
      "blocks": [
        { "pattern": "<see vocab below>", "intensity": "primary | secondary | accessory | finisher", "sets": 3, "reps": 8, "loaded": true, "pair": "1a", "note": "...", "category": "<for mobility: ankle | hip | t-spine>", "zone": "<for conditioning: 1..5>" }
      ]
    }
  ],
  "notes": "Coaching notes — what the block is for, key cues, watch-outs."
}

PATTERN VOCABULARY (use ONLY these strings for "pattern"):
  squat, single_leg, hinge, hinge_unilateral, lunge,
  horizontal_push, horizontal_push_unilateral, vertical_push,
  horizontal_pull, horizontal_pull_unilateral, vertical_pull,
  carry, rotation, anti_rotation, anti_extension, anti_lateral_flexion,
  frontal_plane, transverse_plane, power_lower, power_upper, explosive_carry,
  combination_total_body, locomotion, conditioning, core_finisher, free_zone, mobility

DESIGN RULES (MUST follow, even if the screenshot is silent on them):
1. Day 1 (A) push/pull = HORIZONTAL. Day 2 (B) push/pull = VERTICAL. Day 3 (C) repeats horizontal. Day 4 (D) repeats vertical.
2. Mobility is WOVEN into the session, not appended:
   - Workout A: hip mobility AS the 1c slot (after first strength pair), ankle mobility as the final cool-down block.
   - Workout B: t-spine mobility as 1c, ankle as cool-down.
   - Workout C: hip mid-session, ankle cool-down.
   - Workout D: t-spine mid-session, ankle cool-down.
3. Strength supersets carry "pair" labels: 1a / 1b (/ 1c mobility), 2a / 2b, 3a / 3b/c/d for any triplet/quartet/finisher.
4. Use real sets and reps from the screenshot. Ranges are OK ("2-3", "3-4"). For wave/DUP, fill the "undulating" object.
5. "Free Zone" = pattern "free_zone", typically 8-10 sets reps "AMRAP in 5 min", paired 3a/3b.
6. Output the JSON object ONLY. No prose, no markdown, no code fences. Just JSON.
7. progressionOrder: leave it 99 (Marin will renumber on save).
8. id: kebab-case, append "-ab" for 2-session A/B or "-4day" for 4-session A/B/C/D.

Common heuristics:
- "Maximum Strength & Power" or "Max S&P" header → primary intensity, low reps.
- "Muscle Hypertrophy", "Hypertrophy & Endurance" → secondary intensity, 8-15 reps.
- "Free Zone" → finisher, pattern "free_zone".
- "Wave" or set-by-set numeric prescriptions → undulating.type "wave", populate cycles.
- W1/W2/W3 columns with same numbers in each → identical exposure weekly, no undulating field.
- "Workout 1/2/3" columns with progressing reps → undulating.type "wave" (each "Workout N" = cycle N, weeks: [N]).
- Sets like "5,5,5,5,8" (mixed) → keep as the reps string verbatim.
- Locomotion (sled, bear crawl, sprint, farmer walk) → pattern "locomotion", loaded true if carrying load.

When in doubt about the style summary:
- ≤6 reps everywhere → "foundation" or "hypertrophy" (call it hypertrophy if it has high-rep blocks too)
- Anything with waves or 5×3-5 main → "hypertrophy" with the conditioning being whatever the finisher is.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      setupNeeded: true,
      message: 'Add ANTHROPIC_API_KEY to your Vercel environment variables to enable template parsing.',
    });
  }

  try {
    const { images, hint } = req.body || {};
    if (!Array.isArray(images) || !images.length) {
      return res.status(400).json({ error: 'Missing images — POST { images: [{ base64, mimeType }], hint? }' });
    }

    const contentBlocks = [];
    for (const img of images) {
      if (!img.base64 || !img.mimeType) continue;
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
      });
    }
    contentBlocks.push({
      type: 'text',
      text: `Parse this template into the MILO JSON schema described in the system prompt.${hint ? ` Coach hint: ${hint}` : ''} Output JSON only.`,
    });

    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 6000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contentBlocks }],
    });

    const text = msg.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    // Try to parse JSON. Claude sometimes wraps in ```json ... ``` despite instructions.
    let template;
    try {
      let clean = text;
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      // Sometimes Claude prepends a single line like "Here is the JSON:" — strip to first '{'
      const firstBrace = clean.indexOf('{');
      if (firstBrace > 0) clean = clean.slice(firstBrace);
      template = JSON.parse(clean);
    } catch (e) {
      return res.status(500).json({
        error: 'Claude returned non-JSON',
        raw: text.slice(0, 2000),
      });
    }

    return res.status(200).json({
      template,
      model: msg.model,
      usage: msg.usage,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Template parsing error:', err);
    return res.status(500).json({
      error: 'Template parsing failed',
      detail: err.message || String(err),
    });
  }
}
