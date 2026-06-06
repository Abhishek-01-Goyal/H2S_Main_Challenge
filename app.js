"use strict";

/**
 * Steady — Mental Wellness Tracker for exam season.
 *
 * Architecture:
 *   - Pure, side-effect-free logic (escapeHtml, averageMood, currentStreak,
 *     topTriggers, extractJson, buildPrompt, sanitizeText, getGreeting)
 *     — all fully unit-tested.
 *   - A thin browser layer that wires the DOM, persists check-ins to
 *     localStorage, manages SPA tab navigation, and renders insights.
 *   - AI support is fetched from the /api/generate serverless function,
 *     which holds the Gemini key server-side (Vercel env var GEMINI_API_KEY)
 *     so it never reaches the repo or the browser.
 *
 * @module Steady
 */

/** API endpoint for the Gemini serverless proxy. */
const API_ENDPOINT = "/api/generate";

/** localStorage key for persisted entries. */
const STORAGE_KEY = "steady.entries.v1";

/** Minimum valid mood value (inclusive). */
const MOOD_MIN = 1;

/** Maximum valid mood value (inclusive). */
const MOOD_MAX = 5;

/** Maximum allowed journal text length in characters. */
const MAX_JOURNAL_LENGTH = 2000;

/** Number of recent entries to display in the mood chart. */
const MAX_CHART_ENTRIES = 7;

/** Minimum interval between check-in submissions (milliseconds). */
const DEBOUNCE_MS = 2000;

/** Human-readable mood labels keyed by numeric score. */
const MOOD_LABELS = Object.freeze({
  1: "Struggling",
  2: "Low",
  3: "Okay",
  4: "Good",
  5: "Great",
});

/* ================================================================
   Pure, unit-tested helpers
   ================================================================ */

/**
 * Escape HTML special characters to prevent XSS when rendering
 * user-supplied or model-generated content into the DOM.
 *
 * @param {*} s - The value to escape (coerced to string).
 * @returns {string} The HTML-safe string.
 */
function escapeHtml(s) {
  const str = String(s == null ? "" : s);
  if (str.length === 0) return str;
  return str.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/**
 * Compute the average mood across an array of entries, rounded to
 * one decimal place.
 *
 * @param {Array<{mood: number}>|null} entries - The entries to average.
 * @returns {number|null} The rounded average, or null if no entries.
 */
function averageMood(entries) {
  if (!entries || entries.length === 0) return null;
  const sum = entries.reduce((acc, entry) => acc + (Number(entry.mood) || 0), 0);
  return Math.round((sum / entries.length) * 10) / 10;
}

/**
 * Count the consecutive-day check-in streak ending today (or
 * yesterday, to allow a grace period).
 *
 * @param {Array<{date: string}>|null} entries - Entries with ISO date strings.
 * @param {Date} [today=new Date()] - Override "today" for testability.
 * @returns {number} The streak length in days.
 */
function currentStreak(entries, today = new Date()) {
  if (!entries || entries.length === 0) return 0;

  const days = new Set(entries.map((e) => e.date));
  let streak = 0;
  const cursor = new Date(today);

  /* Allow streak to survive until the next check-in (grace: yesterday). */
  if (!days.has(toISO(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(toISO(cursor))) return 0;
  }

  while (days.has(toISO(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Format a Date as a YYYY-MM-DD string in local time.
 *
 * @param {Date|string} date - The date to format.
 * @returns {string} ISO-formatted date string (local).
 */
function toISO(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Tally stress triggers across entries and return the top N, sorted
 * by frequency descending.
 *
 * @param {Array<{triggers?: string[]}>|null} entries - The entries to scan.
 * @param {number} [limit=5] - Maximum number of triggers to return.
 * @returns {Array<{name: string, count: number}>} Sorted trigger tallies.
 */
function topTriggers(entries, limit = 5) {
  /** @type {Record<string, number>} */
  const counts = Object.create(null);

  const list = entries || [];
  for (let i = 0; i < list.length; i++) {
    const triggers = list[i].triggers;
    if (!triggers) continue;
    for (let j = 0; j < triggers.length; j++) {
      const name = triggers[j];
      counts[name] = (counts[name] || 0) + 1;
    }
  }

  return Object.keys(counts)
    .map((name) => ({ name, count: counts[name] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Extract a JSON object from a model response that may contain
 * markdown fences, prose, or other wrapping text.
 *
 * @param {string|null} text - The raw model response.
 * @returns {Object} The parsed JSON object.
 * @throws {Error} If no valid JSON object is found.
 */
function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON found in response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Sanitize user-entered text by removing control characters (except
 * newlines and tabs) that could cause rendering or parsing issues.
 *
 * @param {string} text - The raw text to sanitize.
 * @returns {string} The cleaned text.
 */
function sanitizeText(text) {
  if (!text) return "";
  /* Remove control chars U+0000–U+001F except \t (09) and \n (0A). */
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * Return a time-appropriate greeting string based on the hour of day.
 *
 * @param {Date} [now=new Date()] - The current date/time.
 * @returns {string} A greeting like "Good morning" or "Good evening".
 */
function getGreeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 5)  return "Working late? Take it easy";
  if (hour < 12) return "Good morning ☀️";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Winding down? You deserve rest";
}

/**
 * Build a safety-aware support prompt from a check-in entry.
 * Instructs the model to respond empathetically without diagnosing
 * or using clinical labels.
 *
 * @param {{mood?: number, triggers?: string[], journal?: string}} checkin
 * @returns {string} The formatted prompt string.
 */
function buildPrompt(checkin) {
  const mood = Number(checkin.mood) || 0;
  const label = MOOD_LABELS[mood] || "unknown";
  const triggers = (checkin.triggers || []).join(", ") || "none selected";
  const journal = checkin.journal || "(none written)";

  return `You are Steady, a warm, calm wellness companion for students in India preparing for high-pressure exams (NEET, JEE, CUET, CAT, GATE, UPSC, board exams).

A student just checked in:
- Mood: ${mood}/${MOOD_MAX} (${label})
- Stress triggers: ${triggers}
- Their reflection: "${journal}"

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

/**
 * Generate a personalized, dynamic fallback response client-side if the
 * serverless function fails or is unavailable.
 *
 * @param {{mood?: number, triggers?: string[], journal?: string}} entry - The check-in entry.
 * @returns {{reflection: string, actions: string[], affirmation: string, concern: boolean}}
 */
function getFallbackSupport(entry) {
  const mood = Number(entry?.mood) || 3;
  const triggers = entry?.triggers || [];

  /* Tailor the reflection based on the mood level */
  let reflection = "";
  if (mood <= 2) {
    reflection = "Acknowledging a tough day takes courage. Remember that feeling overwhelmed during intense exam prep is a very natural response, and you don't have to face it alone.";
  } else if (mood === 3) {
    reflection = "Checking in on a neutral day is a great habit. Finding your steady center amidst the daily grind is a quiet win — keep pacing yourself.";
  } else {
    reflection = "It's wonderful to see you in high spirits! Riding this positive wave while keeping your energy balanced will help you stay steady.";
  }

  /* Map triggers to specific actionable recommendations */
  const actionPool = [];
  const triggerSet = new Set(triggers);

  if (triggerSet.has("Exam pressure") || triggerSet.has("Self-doubt")) {
    actionPool.push("Write down 1 or 2 small topics you already know well to remind yourself of your capabilities.");
    actionPool.push("Try box breathing: inhale for 4 seconds, hold for 4, exhale for 4, hold for 4.");
  }
  if (triggerSet.has("Lack of sleep") || triggerSet.has("Exhaustion")) {
    actionPool.push("Step away from all screens and close your eyes for a 15-minute quiet rest.");
    actionPool.push("Gently stretch your neck, shoulders, and wrists to relieve physical tension.");
  }
  if (triggerSet.has("Procrastination") || triggerSet.has("Distractions")) {
    actionPool.push("Set a timer for just 10 minutes of focused reading to break the friction of starting.");
    actionPool.push("Place your phone in another room or turn on Do Not Disturb mode during this study block.");
  }
  if (triggerSet.has("Loneliness") || triggerSet.has("Peer pressure")) {
    actionPool.push("Reach out to a trusted classmate or family member for a quick 5-minute chat.");
    actionPool.push("Remind yourself that everyone's preparation journey moves at its own unique pace.");
  }

  /* Add fallback actions if we don't have enough specific ones */
  const defaultActions = [
    "Drink a tall glass of water and stretch your body.",
    "Take three slow, deep breaths, letting your shoulders drop completely.",
    "Step outside or look out a window to change your visual environment.",
    "Write down one single task you can easily complete in the next 15 minutes."
  ];

  const actions = [];
  // Use specific actions first
  for (let i = 0; i < actionPool.length && actions.length < 3; i++) {
    actions.push(actionPool[i]);
  }
  // Fill the rest with defaults
  for (let i = 0; i < defaultActions.length && actions.length < 3; i++) {
    if (!actions.includes(defaultActions[i])) {
      actions.push(defaultActions[i]);
    }
  }

  /* Select an appropriate affirmation */
  let affirmation = "You are more than any exam result.";
  if (mood <= 2) {
    affirmation = "One step, one breath at a time. You are doing the best you can.";
  } else if (triggerSet.has("Exam pressure")) {
    affirmation = "Your worth as a person is not defined by a test score.";
  } else if (mood >= 4) {
    affirmation = "Appreciate your progress and celebrate the small steps today.";
  }

  return {
    reflection,
    actions,
    affirmation,
    concern: false,
  };
}

/* ================================================================
   Node export for tests
   ================================================================ */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    escapeHtml,
    averageMood,
    currentStreak,
    toISO,
    topTriggers,
    extractJson,
    buildPrompt,
    sanitizeText,
    getGreeting,
    getFallbackSupport,
    MOOD_LABELS,
    MOOD_MIN,
    MOOD_MAX,
    MAX_JOURNAL_LENGTH,
    MAX_CHART_ENTRIES,
    DEBOUNCE_MS,
  };
}

/* ================================================================
   Browser wiring — only runs in a document context
   ================================================================ */
if (typeof document !== "undefined") {
  /**
   * Cache all frequently-accessed DOM elements once at startup to
   * avoid repeated querySelector calls during renders.
   *
   * @type {Record<string, HTMLElement|HTMLElement[]>}
   */
  const el = {
    /* Mood selection */
    moods:        /** @type {HTMLElement[]} */ ([...document.querySelectorAll(".mood")]),
    /* Trigger chips */
    chips:        /** @type {HTMLElement[]} */ ([...document.querySelectorAll("#triggerChips .chip")]),
    /* Form fields */
    err:          /** @type {HTMLElement} */ (document.getElementById("err")),
    journal:      /** @type {HTMLTextAreaElement} */ (document.getElementById("journal")),
    journalHint:  /** @type {HTMLElement} */ (document.getElementById("journal-hint")),
    checkInBtn:   /** @type {HTMLButtonElement} */ (document.getElementById("checkInBtn")),
    clearBtn:     /** @type {HTMLButtonElement} */ (document.getElementById("clearBtn")),
    /* Support output */
    support:      /** @type {HTMLElement} */ (document.getElementById("support")),
    loader:       /** @type {HTMLElement} */ (document.getElementById("loader")),
    loadMsg:      /** @type {HTMLElement} */ (document.getElementById("loadMsg")),
    /* Insights */
    insights:     /** @type {HTMLElement} */ (document.getElementById("insights")),
    noInsights:   /** @type {HTMLElement} */ (document.getElementById("noInsights")),
    chart:        /** @type {HTMLElement} */ (document.getElementById("chart")),
    dashChart:    /** @type {HTMLElement} */ (document.getElementById("dashChart")),
    dashChartBars:/** @type {HTMLElement} */ (document.getElementById("dashChartBars")),
    triggerStats: /** @type {HTMLElement} */ (document.getElementById("triggerStats")),
    /* Stats */
    streakNum:    /** @type {HTMLElement} */ (document.getElementById("streakNum")),
    checkinNum:   /** @type {HTMLElement} */ (document.getElementById("checkinNum")),
    avgMood:      /** @type {HTMLElement} */ (document.getElementById("avgMood")),
    /* Greeting */
    greeting:     /** @type {HTMLElement} */ (document.getElementById("greeting")),
    /* Navigation */
    goCheckin:    /** @type {HTMLElement} */ (document.getElementById("goCheckin")),
    tabs:         /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[role="tab"]')]),
    panels:       /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[role="tabpanel"]')]),
  };

  /** Currently selected mood value (null if none selected). */
  let selectedMood = null;

  /** Timestamp of last successful check-in (for debounce). */
  let lastCheckInTime = 0;

  /** Cached entry count to avoid unnecessary re-renders. */
  let lastRenderedCount = -1;

  /**
   * In-memory source of truth for entries; persisted to localStorage
   * on every mutation.
   *
   * @type {Array<{date: string, mood: number, triggers: string[], journal: string, ts: number}>}
   */
  let entries = readStore();

  /* ---- localStorage helpers ---- */

  /**
   * Read entries from localStorage, returning an empty array on parse
   * failure or missing data.
   *
   * @returns {Array<Object>} Parsed entries or empty array.
   */
  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Persist the current entries array to localStorage.
   *
   * @returns {void}
   */
  function writeStore() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  /* ---- SPA Tab Navigation ---- */

  /**
   * Switch the active tab panel. Manages ARIA states, visibility,
   * focus, and animations.
   *
   * @param {string} tabId - The id of the tab button to activate (e.g. "tab-home").
   * @returns {void}
   */
  function switchTab(tabId) {
    const targetTab = document.getElementById(tabId);
    if (!targetTab) return;

    const panelId = targetTab.getAttribute("aria-controls");
    const targetPanel = document.getElementById(panelId);
    if (!targetPanel) return;

    /* Deactivate all tabs and hide all panels. */
    for (let i = 0; i < el.tabs.length; i++) {
      el.tabs[i].setAttribute("aria-selected", "false");
      el.tabs[i].setAttribute("tabindex", "-1");
    }
    for (let i = 0; i < el.panels.length; i++) {
      el.panels[i].setAttribute("aria-hidden", "true");
      el.panels[i].classList.remove("active");
    }

    /* Activate the selected tab and show its panel. */
    targetTab.setAttribute("aria-selected", "true");
    targetTab.setAttribute("tabindex", "0");
    targetPanel.setAttribute("aria-hidden", "false");
    targetPanel.classList.add("active");

    /* Re-trigger the panel entrance animation. */
    targetPanel.style.animation = "none";
    /* Force a reflow so the browser registers the style change. */
    void targetPanel.offsetHeight;
    targetPanel.style.animation = "";

    targetTab.focus();
  }

  /* Wire tab click handlers using event delegation on the tablist. */
  const tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    tablist.addEventListener("click", (e) => {
      const tab = /** @type {HTMLElement} */ (e.target).closest('[role="tab"]');
      if (tab) switchTab(tab.id);
    });

    /* Keyboard navigation: arrow keys, Home, End. */
    tablist.addEventListener("keydown", (e) => {
      const idx = el.tabs.indexOf(/** @type {HTMLElement} */ (e.target));
      if (idx === -1) return;

      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % el.tabs.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (idx - 1 + el.tabs.length) % el.tabs.length;
      } else if (e.key === "Home") {
        next = 0;
      } else if (e.key === "End") {
        next = el.tabs.length - 1;
      }

      if (next !== -1) {
        e.preventDefault();
        switchTab(el.tabs[next].id);
      }
    });
  }

  /* CTA button on dashboard → jump to check-in tab. */
  if (el.goCheckin) {
    el.goCheckin.addEventListener("click", () => switchTab("tab-checkin"));
  }

  /* ---- Mood selection (radio group pattern) ---- */
  el.moods.forEach((btn) => {
    btn.addEventListener("click", () => {
      for (let i = 0; i < el.moods.length; i++) {
        el.moods[i].setAttribute("aria-checked", "false");
      }
      btn.setAttribute("aria-checked", "true");
      selectedMood = Number(btn.dataset.mood);
      el.err.textContent = "";
    });
  });

  /* ---- Trigger chip toggles ---- */
  el.chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const isPressed = chip.getAttribute("aria-pressed") === "true";
      chip.setAttribute("aria-pressed", String(!isPressed));
    });
  });

  /* ---- Journal character counter ---- */
  if (el.journal && el.journalHint) {
    el.journal.addEventListener("input", () => {
      const len = el.journal.value.length;
      el.journalHint.textContent = `${len.toLocaleString()} / ${MAX_JOURNAL_LENGTH.toLocaleString()}`;
    });
  }

  /* ---- Check-in submission ---- */
  el.checkInBtn.addEventListener("click", checkIn);

  /* ---- Clear history ---- */
  el.clearBtn.addEventListener("click", () => {
    if (confirm("Clear all your check-in history from this device?")) {
      entries = [];
      localStorage.removeItem(STORAGE_KEY);
      lastRenderedCount = -1;
      renderStats();
      renderInsights();
    }
  });

  /** Rotating loader messages for a warm, patient feel. */
  const LOAD_MSGS = Object.freeze([
    "Taking that in…",
    "Thinking it through with care…",
    "Finding something useful…",
  ]);



  /**
   * Handle a check-in submission. Validates input, persists the
   * entry, calls the AI endpoint, and renders the response.
   *
   * @returns {Promise<void>}
   */
  async function checkIn() {
    /* ---- Validate mood selection ---- */
    if (!selectedMood) {
      el.err.textContent = "Pick how you're feeling first — even a rough guess is fine.";
      return;
    }

    /* ---- Validate mood range ---- */
    if (selectedMood < MOOD_MIN || selectedMood > MOOD_MAX) {
      el.err.textContent = "Please select a valid mood.";
      return;
    }

    /* ---- Debounce rapid submissions ---- */
    const now = Date.now();
    if (now - lastCheckInTime < DEBOUNCE_MS) {
      el.err.textContent = "Take a breath — you just checked in. Try again shortly.";
      return;
    }

    /* ---- Gather form data ---- */
    const triggers = el.chips
      .filter((c) => c.getAttribute("aria-pressed") === "true")
      .map((c) => c.textContent.trim());

    const rawJournal = el.journal.value.trim();
    const journal = sanitizeText(rawJournal).slice(0, MAX_JOURNAL_LENGTH);

    /** @type {{date: string, mood: number, triggers: string[], journal: string, ts: number}} */
    const entry = {
      date: toISO(new Date()),
      mood: selectedMood,
      triggers,
      journal,
      ts: now,
    };

    /* ---- Persist first (so stats/chart stay accurate even if AI fails) ---- */
    entries.push(entry);
    writeStore();
    lastCheckInTime = now;
    renderStats();
    renderInsights();

    /* ---- Show loader, disable button ---- */
    el.checkInBtn.disabled = true;
    el.err.textContent = "";
    el.support.hidden = true;
    el.loader.hidden = false;

    let msgIndex = 0;
    const ticker = setInterval(() => {
      msgIndex = (msgIndex + 1) % LOAD_MSGS.length;
      el.loadMsg.textContent = LOAD_MSGS[msgIndex];
    }, 1500);

    /* ---- Call AI endpoint ---- */
    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildPrompt(entry) }),
      });

      if (!res.ok) {
        throw new Error("Request failed (" + res.status + ")");
      }

      const { text } = await res.json();
      renderSupport(extractJson(text || ""));
    } catch (err) {
      console.error("[Steady] AI call failed:", err?.message || err);
      renderSupport(getFallbackSupport(entry));
    } finally {
      clearInterval(ticker);
      el.loader.hidden = true;
      el.checkInBtn.disabled = false;
    }
  }

  /* ---- Rendering functions ---- */

  /**
   * Render the AI support response into the support panel.
   * All model output is HTML-escaped before insertion.
   *
   * @param {{reflection?: string, actions?: string[], affirmation?: string, concern?: boolean}} s
   * @returns {void}
   */
  function renderSupport(s) {
    const frag = document.createDocumentFragment();
    const container = document.createElement("div");

    /* Reflection text */
    const warmLine = document.createElement("p");
    warmLine.className = "warm-line";
    warmLine.textContent = s.reflection || "";
    container.appendChild(warmLine);

    /* Actions heading */
    const actionsHeading = document.createElement("h3");
    actionsHeading.textContent = "A few small things you could try";
    container.appendChild(actionsHeading);

    /* Actions list */
    const actionsList = document.createElement("ul");
    actionsList.className = "acts";
    const actions = s.actions || [];
    for (let i = 0; i < actions.length; i++) {
      const li = document.createElement("li");
      li.textContent = actions[i];
      actionsList.appendChild(li);
    }
    container.appendChild(actionsList);

    /* Affirmation */
    if (s.affirmation) {
      const affirm = document.createElement("div");
      affirm.className = "affirm";
      affirm.textContent = "\u201C" + s.affirmation + "\u201D";
      container.appendChild(affirm);
    }

    /* Concern flag */
    if (s.concern) {
      const concern = document.createElement("div");
      concern.className = "affirm";
      concern.style.borderColor = "rgba(212,104,122,0.4)";
      concern.style.background = "rgba(212,104,122,0.08)";
      concern.textContent = "It sounds like things feel really heavy right now. You don\u2019t have to carry this alone \u2014 talking to someone you trust, or one of the helplines in the Help tab, can genuinely help.";
      container.appendChild(concern);
    }

    frag.appendChild(container);

    /* Clear and append in one operation to minimise reflows. */
    el.support.innerHTML = "";
    el.support.appendChild(frag);
    el.support.hidden = false;
    el.support.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /**
   * Update the stat counters (streak, check-in count, average mood).
   *
   * @returns {void}
   */
  function renderStats() {
    el.streakNum.textContent = String(currentStreak(entries));
    el.checkinNum.textContent = String(entries.length);
    const avg = averageMood(entries);
    el.avgMood.textContent = avg == null ? "–" : String(avg);

    /* Update greeting. */
    if (el.greeting) {
      el.greeting.textContent = getGreeting();
    }
  }

  /**
   * Build chart bar HTML using DocumentFragment for efficient DOM
   * insertion. Used for both the dashboard mini-chart and full insights chart.
   *
   * @param {Array<Object>} recentEntries - The entries to chart.
   * @returns {DocumentFragment} Fragment containing bar-col elements.
   */
  function buildChartFragment(recentEntries) {
    const frag = document.createDocumentFragment();

    for (let i = 0; i < recentEntries.length; i++) {
      const entry = recentEntries[i];
      const moodVal = Number(entry.mood) || 0;
      const pct = (moodVal / MOOD_MAX) * 100;
      const label = new Date(entry.ts || entry.date).toLocaleDateString(undefined, {
        weekday: "short",
      });
      const moodLabel = MOOD_LABELS[moodVal] || "";

      const col = document.createElement("div");
      col.className = "bar-col";

      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.height = pct + "%";
      fill.setAttribute("role", "meter");
      fill.setAttribute("aria-valuenow", String(moodVal));
      fill.setAttribute("aria-valuemin", String(MOOD_MIN));
      fill.setAttribute("aria-valuemax", String(MOOD_MAX));
      fill.setAttribute("aria-label", moodLabel + " on " + label);
      fill.title = moodLabel;

      const daySpan = document.createElement("span");
      daySpan.className = "bar-day";
      daySpan.textContent = label;

      col.appendChild(fill);
      col.appendChild(daySpan);
      frag.appendChild(col);
    }

    return frag;
  }

  /**
   * Render the insights panel: mood chart, trigger stats, and
   * the dashboard mini-chart. Skips rendering if the entry count
   * has not changed since the last render.
   *
   * @returns {void}
   */
  function renderInsights() {
    /* Skip if nothing changed since last render. */
    if (entries.length === lastRenderedCount) return;
    lastRenderedCount = entries.length;

    if (entries.length === 0) {
      el.insights.hidden = true;
      el.noInsights.hidden = false;
      if (el.dashChart) el.dashChart.hidden = true;
      return;
    }

    el.insights.hidden = false;
    el.noInsights.hidden = true;

    /* ---- Mood trend chart (last N entries) ---- */
    const recent = entries.slice(-MAX_CHART_ENTRIES);

    /* Full chart */
    el.chart.innerHTML = "";
    el.chart.appendChild(buildChartFragment(recent));

    /* Dashboard mini-chart */
    if (el.dashChart && el.dashChartBars) {
      el.dashChart.hidden = false;
      el.dashChartBars.innerHTML = "";
      el.dashChartBars.appendChild(buildChartFragment(recent));
    }

    /* ---- Top stress triggers ---- */
    const tops = topTriggers(entries, 5);
    const maxCount = tops.length > 0 ? tops[0].count : 1;

    const triggerFrag = document.createDocumentFragment();

    if (tops.length === 0) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No triggers logged yet.";
      triggerFrag.appendChild(li);
    } else {
      for (let i = 0; i < tops.length; i++) {
        const t = tops[i];
        const li = document.createElement("li");

        const nameSpan = document.createElement("span");
        nameSpan.className = "tname";
        nameSpan.textContent = t.name;

        const barSpan = document.createElement("span");
        barSpan.className = "tbar";
        barSpan.setAttribute("role", "meter");
        barSpan.setAttribute("aria-valuenow", String(t.count));
        barSpan.setAttribute("aria-valuemin", "0");
        barSpan.setAttribute("aria-valuemax", String(maxCount));
        barSpan.setAttribute("aria-label", t.name + ": " + t.count + " times");

        const barInner = document.createElement("i");
        barInner.style.width = ((t.count / maxCount) * 100) + "%";
        barSpan.appendChild(barInner);

        const countSpan = document.createElement("span");
        countSpan.className = "tcount";
        countSpan.textContent = String(t.count);

        li.appendChild(nameSpan);
        li.appendChild(barSpan);
        li.appendChild(countSpan);
        triggerFrag.appendChild(li);
      }
    }

    el.triggerStats.innerHTML = "";
    el.triggerStats.appendChild(triggerFrag);
  }

  /* ---- Initial paint from stored history ---- */
  renderStats();
  renderInsights();
}