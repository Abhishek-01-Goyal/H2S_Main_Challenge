"use strict";

/**
 * Serverless proxy for Google Gemini — keeps the API key server-side.
 *
 * Security measures:
 *   - API key is read from `GEMINI_API_KEY` env var (Vercel project settings),
 *     so it never appears in the repo or the browser.
 *   - API key is sent via the `x-goog-api-key` header (not a query param) to
 *     avoid leaking it into server access logs.
 *   - Request body size is capped to prevent abuse.
 *   - Only POST is accepted; all other methods receive 405.
 *   - CORS is restricted to same-origin by default.
 *
 * @module api/generate
 */

/** Maximum allowed prompt length in characters. */
const MAX_PROMPT_LENGTH = 6000;

/** Maximum allowed request body size in bytes. */
const MAX_BODY_SIZE = 8192;

/** Gemini model endpoint (without the API key). */
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

/** Gemini generation configuration. */
const GENERATION_CONFIG = Object.freeze({
  temperature: 0.7,
  maxOutputTokens: 800,
});

/**
 * Set common security and CORS headers on every response.
 *
 * @param {import("http").ServerResponse} res - The response object.
 * @returns {void}
 */
function setSecurityHeaders(res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
}

/**
 * Vercel serverless handler — proxies a prompt to Gemini and returns the
 * generated text.
 *
 * @param {import("http").IncomingMessage & { method: string, body: unknown }} req
 * @param {import("http").ServerResponse & { status: Function, json: Function }} res
 * @returns {Promise<void>}
 */
export default async function handler(req, res) {
  setSecurityHeaders(res);

  /* Handle CORS preflight. */
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY", code: "CONFIG_ERROR" });
  }

  try {
    const body = req.body || {};

    /* Validate body size (approximation from JSON). */
    const bodySize = JSON.stringify(body).length;
    if (bodySize > MAX_BODY_SIZE) {
      return res.status(413).json({ error: "Request body too large", code: "BODY_TOO_LARGE" });
    }

    const { prompt } = body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid prompt", code: "BAD_REQUEST" });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: "Prompt exceeds maximum length", code: "PROMPT_TOO_LONG" });
    }

    /*
     * Send the prompt to Gemini.  The API key is passed as a header
     * (`x-goog-api-key`) instead of a query-string parameter so that it
     * does not appear in server access logs.
     */
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: GENERATION_CONFIG,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      return res.status(502).json({ error: `Upstream error ${status}`, code: "UPSTREAM_ERROR" });
    }

    const data = await response.json();

    const text =
      data?.candidates?.[0]?.content?.parts?.map((/** @type {{ text: string }} */ p) => p.text).join("") || "";

    return res.status(200).json({ text });
  } catch (err) {
    /* Log the error server-side for debugging, but never expose internals. */
    console.error("[generate] Error:", err?.message || err);
    return res.status(500).json({ error: "Generation failed", code: "INTERNAL_ERROR" });
  }
}
