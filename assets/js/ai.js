/**
 * Optional Claude coach.
 *
 * Three jobs:
 *   1. Answer questions mid-workout ("the leg press is taken, what now?",
 *      "my shoulder clicks on this one") with your plan, today's session and
 *      your recent numbers as context.
 *   2. Identify a machine from a photo and say how to set it up.
 *   3. Write the short read of your week over numbers the app already worked out.
 *
 * It is never asked to count. Every figure comes from metrics.js; Claude is
 * handed finished numbers and told not to make new ones.
 *
 * ── Where the key lives ─────────────────────────────────────────────────
 *
 * In its own localStorage slot on this device, outside the app state object,
 * so no code path can put it into an exported backup or the public repo.
 * Requests go straight from the browser to Anthropic.
 */

const KEY_SLOT = 'gym-pal.anthropic-key';
const USAGE_SLOT = 'gym-pal.anthropic-usage';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export const MODELS = {
  /** Coaching chat and the weekly read: the better writer and reasoner. */
  coach: 'claude-sonnet-5-5',
  /** Reading a photo of a machine. */
  vision: 'claude-sonnet-5-5',
  /** Key test: the cheapest possible call. */
  quick: 'claude-haiku-5-5',
};

// ── The key ──────────────────────────────────────────────────────────────

export function getKey() {
  try {
    return localStorage.getItem(KEY_SLOT) || '';
  } catch {
    return '';
  }
}

export function setKey(key) {
  const trimmed = String(key ?? '').trim();
  try {
    if (trimmed) localStorage.setItem(KEY_SLOT, trimmed);
    else localStorage.removeItem(KEY_SLOT);
  } catch {
    /* private browsing — the feature just stays off */
  }
}

export function clearKey() {
  setKey('');
}

export function hasKey() {
  return Boolean(getKey());
}

/** A key looks roughly right — catches a pasted GitHub token by mistake. */
export function looksLikeKey(key) {
  return /^sk-ant-/.test(String(key ?? '').trim());
}

// ── Usage, so a billable feature is not invisible ────────────────────────

export function usage() {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_SLOT) || '{}');
    return { calls: 0, inputTokens: 0, outputTokens: 0, byModel: {}, since: null, ...raw };
  } catch {
    return { calls: 0, inputTokens: 0, outputTokens: 0, byModel: {}, since: null };
  }
}

export function resetUsage() {
  try {
    localStorage.removeItem(USAGE_SLOT);
  } catch {
    /* nothing to clear */
  }
}

function recordUsage(model, u) {
  if (!u) return;
  const current = usage();
  const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0);
  const output = u.output_tokens ?? 0;
  const perModel = current.byModel[model] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
  const next = {
    ...current,
    since: current.since ?? new Date().toISOString().slice(0, 10),
    calls: current.calls + 1,
    inputTokens: current.inputTokens + input,
    outputTokens: current.outputTokens + output,
    byModel: {
      ...current.byModel,
      [model]: {
        calls: perModel.calls + 1,
        inputTokens: perModel.inputTokens + input,
        outputTokens: perModel.outputTokens + output,
      },
    },
  };
  try {
    localStorage.setItem(USAGE_SLOT, JSON.stringify(next));
  } catch {
    /* not worth failing a request over */
  }
}


// ── The request ──────────────────────────────────────────────────────────

/**
 * One call to the Messages API.
 *
 * Raw `fetch` rather than the official SDK on purpose: this site has no build
 * step and no package manager, so there is nothing to bundle an npm package
 * with, and pulling one from a CDN would break both that constraint and the
 * offline service worker.
 *
 * `anthropic-dangerous-direct-browser-access` is what makes a browser call
 * possible at all — without it the API does not send CORS headers and the
 * request never leaves. The name is a fair warning: it is only acceptable here
 * because the key is per-device, typed in by its owner, and never committed.
 */
async function call({ model, system, prompt, messages, schema, maxTokens = 1024, signal }) {
  const key = getKey();
  if (!key) throw new AiError('no-key', 'No Claude key on this device.');

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: messages ?? [{ role: 'user', content: prompt }],
  };
  if (schema) {
    body.output_config = { format: { type: 'json_schema', schema } };
  }

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new AiError('offline', 'Could not reach Claude — check the connection.');
  }

  if (!response.ok) throw await httpError(response);

  const data = await response.json();
  recordUsage(model, data.usage);

  if (data.stop_reason === 'max_tokens') {
    throw new AiError('truncated', 'Claude ran out of room before finishing.');
  }

  const text = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('bad-json', 'Claude returned something unreadable.');
  }
}

class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function httpError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message ?? '';
  } catch {
    /* some errors are not JSON */
  }
  if (response.status === 401 || response.status === 403) {
    return new AiError('bad-key', 'That key was rejected. Check it in Setup.');
  }
  if (response.status === 400 && /credit|billing/i.test(detail)) {
    return new AiError('billing', 'The Anthropic account has no credit.');
  }
  if (response.status === 429) {
    return new AiError('rate-limit', 'Rate limited — try again in a moment.');
  }
  if (response.status >= 500) {
    return new AiError('server', 'Claude is unavailable right now.');
  }
  return new AiError('http', detail || `Claude returned ${response.status}.`);
}

/** Confirms a pasted key works, without spending anything meaningful. */
export async function testKey() {
  await call({
    model: MODELS.quick,
    system: 'Reply with the single word OK.',
    prompt: 'ping',
    maxTokens: 8,
  });
  return true;
}

// ── Coach chat ───────────────────────────────────────────────────────────

const COACH_SYSTEM = `You are a strength coach standing next to a beginner lifter in a big-box gym (LA Fitness). They message you from their phone between sets.

You are given their plan, today's session so far, their recent numbers and the exercise library (ids, names, muscles, alternatives). All figures were calculated by the app; use them as given and never compute new ones.

How to answer:
- Short. Two to six sentences or a few bullets. They are holding a phone between sets.
- Concrete: name the machine, the seat setting idea, the cue. When suggesting a swap, prefer the library's listed alternatives and name them exactly as the library does.
- Conservative with load: for a beginner, form first, small jumps (2–10%), stop sets 1–2 reps short of failure.
- If they describe sharp pain, numbness, chest pain, dizziness or anything that sounds like an injury, tell them to stop that exercise and get it checked by a doctor or physical therapist. Do not diagnose.
- You are not a doctor or dietitian. No medication, supplement dosing or calorie prescriptions.
- No emoji, no hype, no "great question".`;

/**
 * history: [{ role: 'user'|'assistant', content: string }]
 * context: object of finished facts from the app
 */
export async function coach(history, context, { signal } = {}) {
  const first = `Context from the app (JSON):\n${JSON.stringify(context)}`;
  const messages = [
    { role: 'user', content: first },
    { role: 'assistant', content: 'Got it. What do you need?' },
    ...history,
  ];
  return call({ model: MODELS.coach, system: COACH_SYSTEM, messages, maxTokens: 900, signal });
}

// ── Machine from a photo ─────────────────────────────────────────────────

const VISION_SYSTEM = `You identify gym equipment from a photo taken on a gym floor, and match it to an exercise library.

Rules:
- exerciseId must be one of the ids given, or "none" if the photo does not show something in the library. A wrong match is worse than "none".
- name is what the equipment is (e.g. "Hammer Strength iso-lateral incline press"), even when exerciseId is "none".
- setup and cues are short imperative steps a beginner can follow standing at that machine. Read any placard or seat-height numbers visible in the photo and use them.
- If the photo is not of gym equipment, say so in name and use "none".`;

export async function identifyMachine(base64, mediaType, library, { signal } = {}) {
  const ids = library.map((e) => e.id);
  const schema = {
    type: 'object',
    properties: {
      exerciseId: { type: 'string', enum: [...ids, 'none'] },
      name: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'low'] },
      muscles: { type: 'string', description: 'Muscles it works, short' },
      setup: { type: 'array', items: { type: 'string' } },
      cues: { type: 'array', items: { type: 'string' } },
    },
    required: ['exerciseId', 'name', 'confidence', 'muscles', 'setup', 'cues'],
    additionalProperties: false,
  };
  const list = library.map((e) => `${e.id}\t${e.name}\t${e.look}`).join('\n');
  return call({
    model: MODELS.vision,
    system: VISION_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `Exercise library (id, name, what it looks like):\n${list}\n\nWhat is this, and how do I use it?` },
        ],
      },
    ],
    schema,
    maxTokens: 1200,
    signal,
  });
}

// ── The weekly read ──────────────────────────────────────────────────────

const READ_SYSTEM = `You write a short, plain read of someone's training week for them.

You are given figures the app already calculated. Your job is the prose, not the arithmetic.

Hard rules:
- Use only the numbers given. Never calculate, estimate or round a new figure.
- If the data is thin (one or two sessions), say so plainly instead of padding.
- Start with the observation. No preamble, no sign-off, no emoji, no hype.
- Be useful: which muscles are under the 10-weekly-set mark, which lifts moved up, what to do next session, anything from the watch data worth noticing (sleep, heart rate) — only if it is in the data.`;

const READ_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One sentence under 90 characters' },
    points: { type: 'array', items: { type: 'string' }, description: 'Two to five observations' },
    next: { type: 'string', description: 'One concrete thing to do next session' },
  },
  required: ['headline', 'points', 'next'],
  additionalProperties: false,
};

export async function weeklyRead(facts, { signal } = {}) {
  return call({
    model: MODELS.coach,
    system: READ_SYSTEM,
    prompt: `Here is the week. Write the read.\n\n${JSON.stringify(facts, null, 1)}`,
    schema: READ_SCHEMA,
    maxTokens: 1200,
    signal,
  });
}
