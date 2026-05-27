// ─────────────────────────────────────────────────────────────────────────────
// /api/claude.js  —  v11
// Server-side proxy to Anthropic Messages API.
//
// Improvements over v10:
//  - Server-side AbortController with hard cap shorter than Vercel function ceiling
//  - Structured error responses the client can branch on (timeout vs rate vs other)
//  - No retry here — retry policy lives in client (with model downgrade)
//  - Preserves the original request body shape (model, max_tokens, system, messages)
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
  // Vercel Hobby plan caps at 60s. We give ourselves 50 and fail fast.
  maxDuration: 55,
};

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const SERVER_TIMEOUT_MS = 45_000; // hard cap before we give up on Anthropic

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: { code: 'method_not_allowed', message: 'Use POST' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { code: 'no_api_key', message: 'API key not configured on server' },
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);

  const t0 = Date.now();

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(req.body),
    });

    clearTimeout(timeoutId);

    const elapsed = Date.now() - t0;
    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      // Pass through Anthropic's error structure so the client can branch
      // on 429 (rate limit) vs 529 (overloaded) vs everything else.
      return res.status(upstream.status).json({
        error: {
          code: data?.error?.type || `http_${upstream.status}`,
          message: data?.error?.message || `Anthropic returned ${upstream.status}`,
          status: upstream.status,
          elapsed_ms: elapsed,
        },
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - t0;

    if (err.name === 'AbortError') {
      return res.status(504).json({
        error: {
          code: 'upstream_timeout',
          message: `Anthropic did not respond within ${SERVER_TIMEOUT_MS}ms`,
          elapsed_ms: elapsed,
        },
      });
    }

    return res.status(500).json({
      error: {
        code: 'proxy_error',
        message: err.message || 'Unknown proxy error',
        elapsed_ms: elapsed,
      },
    });
  }
}
