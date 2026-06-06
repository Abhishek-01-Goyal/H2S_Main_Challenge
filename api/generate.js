/**
 * Serverless proxy for Gemini — keeps the API key server-side.
 * The key is read from the GEMINI_API_KEY environment variable
 * (set in Vercel → Project → Settings → Environment Variables),
 * so it never appears in the repo or the browser.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
  }

  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
      key;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
      }),
    });

    if (!r.ok) {
      return res.status(502).json({ error: "Upstream error " + r.status });
    }
    const data = await r.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "Generation failed" });
  }
}
