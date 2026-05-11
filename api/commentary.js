// MILO — LLM Commentary serverless function
// Vercel auto-detects /api/*.js as Node.js serverless functions.
// Required env var on Vercel: ANTHROPIC_API_KEY

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are MILO, an expert strength & conditioning coach working alongside Marin Lazic at Otion Performance.
You speak coach-to-coach: precise, evidence-informed, no fluff, no clichés.

You will be given a structured snapshot of one athlete's recent training (last ~12 weeks):
- programs (active + completed)
- weekly buckets (sessions, total minutes, avg RPE, sRPE training load)
- ACWR (acute:chronic workload ratio) + zone classification
- movement profile (push/pull ratio, planes of motion %, body region split)
- recent workouts (with RPE)

Write a 3-paragraph coaching note (≤ 180 words total):

  1) Where the athlete is right now — load trend, intensity, ACWR zone implication, anything unusual.
  2) Movement balance — what's missing or imbalanced (frontal/transverse plane, push/pull skew, upper/lower).
  3) What you'd do next week — one or two specific, actionable recommendations Marin could apply tomorrow.

Rules:
- Be specific. Reference actual numbers from the data.
- Don't recap data the coach already sees in the dashboard — interpret it.
- If data is sparse (< 3 weeks), say so and recommend re-syncing before deeper analysis.
- Never invent exercises the athlete didn't do. Never claim certainty about injury risk — speak in tendencies.
- Plain prose, no bullet lists, no markdown headings. Two newlines between paragraphs.`;

export default async function handler(req, res) {
  // CORS for browser fetch
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      commentary: null,
      setupNeeded: true,
      message: 'AI commentary is not configured yet. Add ANTHROPIC_API_KEY to your Vercel project environment variables to enable.',
    });
  }

  try {
    const { client, buckets, acwr, movement } = req.body || {};
    if (!client) return res.status(400).json({ error: 'Missing client data' });

    const userContent = `Athlete snapshot:

CLIENT
${JSON.stringify({ name: client.name, age: client.age, weightKg: client.weightKg, activeProgramCount: client.activePrograms, primaryProgram: client.primaryProgram }, null, 2)}

WEEKLY BUCKETS (most recent 12 weeks, oldest first)
${JSON.stringify(buckets, null, 2)}

ACWR
${JSON.stringify(acwr, null, 2)}

MOVEMENT PROFILE (recent sessions)
${JSON.stringify(movement, null, 2)}

Write the coaching note now.`;

    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = msg.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return res.status(200).json({
      commentary: text,
      model: msg.model,
      usage: msg.usage,
    });
  } catch (err) {
    console.error('Commentary error:', err);
    return res.status(500).json({
      error: 'AI commentary failed',
      detail: err.message || String(err),
    });
  }
}
