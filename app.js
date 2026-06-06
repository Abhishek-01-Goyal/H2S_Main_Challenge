/**
 * Steady — Mental Wellness Tracker for exam season.
 *
 * Architecture:
 *   - Pure, side-effect-free logic (escapeHtml, averageMood, currentStreak,
 *     topTriggers, extractJson, buildPrompt) — fully unit-tested.
 *   - A thin browser layer that wires the DOM, persists check-ins to
 *     localStorage, and renders insights.
 *   - AI support is fetched from the /api/generate serverless function, which
 *     holds the Gemini key server-side (Vercel env var GEMINI_API_KEY) so it
 *     never reaches the repo or the browser.
 */
const API_ENDPOINT = "/api/generate";
const STORAGE_KEY = "steady.entries.v1";

const MOOD_LABELS = { 1: "Struggling", 2: "Low", 3: "Okay", 4: "Good", 5: "Great" };

/* ---------------- Pure, unit-tested helpers ---------------- */

/** Escape HTML to neutralise anything echoed from the model. */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/** Average mood across entries, rounded to 1 dp; null if none. */
function averageMood(entries) {
  if (!entries || !entries.length) return null;
  const sum = entries.reduce((a, e) => a + (Number(e.mood) || 0), 0);
  return Math.round((sum / entries.length) * 10) / 10;
}

/**
 * Count consecutive-day streak ending today.
 * entries: [{date:'YYYY-MM-DD'}], `today` injectable for tests.
 */
function currentStreak(entries, today = new Date()) {
  if (!entries || !entries.length) return 0;
  const days = new Set(entries.map((e) => e.date));
  let streak = 0;
  const d = new Date(today);
  // allow streak to count from today OR yesterday (so it survives until next check-in)
  if (!days.has(toISO(d))) {
    d.setDate(d.getDate() - 1);
    if (!days.has(toISO(d))) return 0;
  }
  while (days.has(toISO(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** YYYY-MM-DD in local time. */
function toISO(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Tally triggers across entries, sorted desc. -> [{name,count}] */
function topTriggers(entries, limit = 5) {
  const counts = {};
  (entries || []).forEach((e) =>
    (e.triggers || []).forEach((t) => (counts[t] = (counts[t] || 0) + 1))
  );
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Pull a JSON object out of a possibly-fenced model response. */
function extractJson(text) {
  let t = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");
  return JSON.parse(t.slice(start, end + 1));
}

/** Build a safety-aware support prompt from a check-in. */
function buildPrompt(checkin) {
  return `You are Steady, a warm, calm wellness companion for students in India preparing for high-pressure exams (NEET, JEE, CUET, CAT, GATE, UPSC, board exams).

A student just checked in:
- Mood: ${checkin.mood}/5 (${MOOD_LABELS[checkin.mood] || "unknown"})
- Stress triggers: ${(checkin.triggers || []).join(", ") || "none selected"}
- Their reflection: "${checkin.journal || "(none written)"}"

Respond with warmth and respect. Do NOT diagnose, do NOT use clinical labels, do NOT minimise their feelings. You are a supportive companion, not a therapist.

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "reflection": "1-2 warm sentences that acknowledge how they feel and gently reframe, specific to their triggers",
  "actions": ["3 small, concrete, doable coping suggestions for the next few hours, tailored to their triggers"],
  "affirmation": "one short grounding affirmation in second person",
  "concern": true ONLY if the reflection text suggests serious distress, hopelessness, or self-harm; otherwise false
}
Keep it real and student-friendly, not preachy. If concern is true, your reflection should gently, non-alarmingly encourage talking to someone they trust.`;
}

// Node export for tests
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    escapeHtml, averageMood, currentStreak, toISO, topTriggers, extractJson, buildPrompt, MOOD_LABELS,
  };
}

/* ---------------- Browser wiring ---------------- */
if (typeof document !== "undefined") {
  // Cache element references once instead of re-querying the DOM on every render.
  const el = {
    moods: [...document.querySelectorAll(".mood")],
    chips: [...document.querySelectorAll("#triggerChips .chip")],
    err: document.getElementById("err"),
    journal: document.getElementById("journal"),
    checkInBtn: document.getElementById("checkInBtn"),
    clearBtn: document.getElementById("clearBtn"),
    support: document.getElementById("support"),
    loader: document.getElementById("loader"),
    loadMsg: document.getElementById("loadMsg"),
    insights: document.getElementById("insights"),
    chart: document.getElementById("chart"),
    triggerStats: document.getElementById("triggerStats"),
    streakNum: document.getElementById("streakNum"),
    checkinNum: document.getElementById("checkinNum"),
    avgMood: document.getElementById("avgMood"),
  };

  let selectedMood = null;
  // In-memory source of truth; persisted to localStorage on every mutation.
  let entries = readStore();

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function writeStore() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  // Mood selection (single radio group).
  el.moods.forEach((btn) => {
    btn.addEventListener("click", () => {
      el.moods.forEach((m) => m.setAttribute("aria-checked", "false"));
      btn.setAttribute("aria-checked", "true");
      selectedMood = Number(btn.dataset.mood);
      el.err.textContent = "";
    });
  });

  // Trigger toggles.
  el.chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const on = chip.getAttribute("aria-pressed") === "true";
      chip.setAttribute("aria-pressed", String(!on));
    });
  });

  el.checkInBtn.addEventListener("click", checkIn);
  el.clearBtn.addEventListener("click", () => {
    if (confirm("Clear all your check-in history from this device?")) {
      entries = [];
      localStorage.removeItem(STORAGE_KEY);
      el.insights.hidden = true;
      renderStats();
    }
  });

  const LOAD_MSGS = ["Taking that in…", "Thinking it through with care…", "Finding something useful…"];
  const FALLBACK_SUPPORT = {
    reflection:
      "Thanks for checking in — that takes honesty. Whatever the score, your effort today still counts.",
    actions: [
      "Step away from your desk for 5 minutes and stretch.",
      "Drink a glass of water and take 3 slow breaths.",
      "Write down one small thing you got done today.",
    ],
    affirmation: "You are more than any exam result.",
    concern: false,
  };

  async function checkIn() {
    if (!selectedMood) {
      el.err.textContent = "Pick how you're feeling first — even a rough guess is fine.";
      return;
    }

    const triggers = el.chips
      .filter((c) => c.getAttribute("aria-pressed") === "true")
      .map((c) => c.textContent);
    const entry = {
      date: toISO(new Date()),
      mood: selectedMood,
      triggers,
      journal: el.journal.value.trim(),
      ts: Date.now(),
    };

    // Persist first so streak/chart stay accurate even if the AI call fails.
    entries.push(entry);
    writeStore();
    renderStats();
    renderInsights();

    el.checkInBtn.disabled = true;
    el.err.textContent = "";
    el.support.hidden = true;
    el.loader.hidden = false;
    let i = 0;
    const ticker = setInterval(() => {
      el.loadMsg.textContent = LOAD_MSGS[(i = (i + 1) % LOAD_MSGS.length)];
    }, 1500);

    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildPrompt(entry) }),
      });
      if (!res.ok) throw new Error("Request failed (" + res.status + ")");
      const { text } = await res.json();
      renderSupport(extractJson(text || ""));
    } catch (err) {
      console.error(err);
      renderSupport(FALLBACK_SUPPORT); // never leave the user at a dead end
    } finally {
      clearInterval(ticker);
      el.loader.hidden = true;
      el.checkInBtn.disabled = false;
    }
  }

  function renderSupport(s) {
    const actions = (s.actions || []).map((a) => `<li>${escapeHtml(a)}</li>`).join("");
    const concernNote = s.concern
      ? `<div class="affirm" style="border-color:rgba(232,153,168,.4);background:rgba(232,153,168,.1)">It sounds like things feel really heavy right now. You don't have to carry this alone — talking to someone you trust, or one of the helplines below, can genuinely help.</div>`
      : "";
    el.support.innerHTML = `
      <p class="warm-line">${escapeHtml(s.reflection || "")}</p>
      <h3>A few small things you could try</h3>
      <ul class="acts">${actions}</ul>
      ${s.affirmation ? `<div class="affirm">“${escapeHtml(s.affirmation)}”</div>` : ""}
      ${concernNote}
    `;
    el.support.hidden = false;
    el.support.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderStats() {
    el.streakNum.textContent = currentStreak(entries);
    el.checkinNum.textContent = entries.length;
    const avg = averageMood(entries);
    el.avgMood.textContent = avg == null ? "–" : avg;
  }

  function renderInsights() {
    if (!entries.length) {
      el.insights.hidden = true;
      return;
    }
    el.insights.hidden = false;

    // Mood trend — last 7 check-ins.
    el.chart.innerHTML = entries
      .slice(-7)
      .map((x) => {
        const pct = (Number(x.mood) / 5) * 100;
        const lbl = new Date(x.ts || x.date).toLocaleDateString(undefined, { weekday: "short" });
        return `<div class="bar-col"><div class="bar-fill" style="height:${pct}%" title="${escapeHtml(MOOD_LABELS[x.mood] || "")}"></div><span class="bar-day">${lbl}</span></div>`;
      })
      .join("");

    // Most frequent stress triggers.
    const tops = topTriggers(entries, 5);
    const max = tops.length ? tops[0].count : 1;
    el.triggerStats.innerHTML = tops.length
      ? tops
        .map(
          (t) =>
            `<li><span class="tname">${escapeHtml(t.name)}</span><span class="tbar"><i style="width:${(t.count / max) * 100}%"></i></span><span class="tcount">${t.count}</span></li>`
        )
        .join("")
      : `<li class="muted">No triggers logged yet.</li>`;
  }

  // Initial paint from any stored history.
  renderStats();
  renderInsights();
}