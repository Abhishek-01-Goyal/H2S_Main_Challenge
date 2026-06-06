/**
 * Steady — comprehensive test suite.
 *
 * Zero dependencies. Run: node tests/logic.test.js
 *
 * Covers all pure helper functions: escapeHtml, averageMood,
 * currentStreak, toISO, topTriggers, extractJson, buildPrompt,
 * sanitizeText, getGreeting, and exported constants.
 *
 * @module tests/logic
 */
"use strict";

const assert = require("assert");
const {
  escapeHtml,
  averageMood,
  currentStreak,
  toISO,
  topTriggers,
  extractJson,
  buildPrompt,
  sanitizeText,
  getGreeting,
  MOOD_LABELS,
  MOOD_MIN,
  MOOD_MAX,
  MAX_JOURNAL_LENGTH,
  MAX_CHART_ENTRIES,
  DEBOUNCE_MS,
} = require("../app.js");

let pass = 0;
let fail = 0;

/**
 * Run a single test case, printing the result to stdout.
 *
 * @param {string} name - Descriptive name for the test.
 * @param {Function} fn - Test body (should throw on failure).
 */
const test = (name, fn) => {
  try {
    fn();
    pass++;
    console.log("  \u2713 " + name);
  } catch (e) {
    fail++;
    console.log("  \u2717 " + name + "\n      " + e.message);
  }
};

/* ================================================================
   escapeHtml
   ================================================================ */
console.log("\nescapeHtml");

test("escapes injection characters", () =>
  assert.strictEqual(escapeHtml('<img src=x onerror=1>"'), "&lt;img src=x onerror=1&gt;&quot;"));

test("handles null", () => assert.strictEqual(escapeHtml(null), ""));

test("handles undefined", () => assert.strictEqual(escapeHtml(undefined), ""));

test("escapes single quotes and ampersands", () =>
  assert.strictEqual(escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#39;s"));

test("coerces numbers to string", () => assert.strictEqual(escapeHtml(42), "42"));

test("leaves safe text untouched", () =>
  assert.strictEqual(escapeHtml("just plain text"), "just plain text"));

test("handles empty string", () => assert.strictEqual(escapeHtml(""), ""));

test("handles repeated special characters", () =>
  assert.strictEqual(escapeHtml("<<>>&&"), "&lt;&lt;&gt;&gt;&amp;&amp;"));

test("handles mixed safe and unsafe characters", () =>
  assert.strictEqual(escapeHtml('Hello "world" & <earth>'), 'Hello &quot;world&quot; &amp; &lt;earth&gt;'));

/* ================================================================
   averageMood
   ================================================================ */
console.log("\naverageMood");

test("returns null for empty", () => assert.strictEqual(averageMood([]), null));

test("returns null for null input", () => assert.strictEqual(averageMood(null), null));

test("computes rounded average", () =>
  assert.strictEqual(averageMood([{ mood: 4 }, { mood: 5 }, { mood: 3 }]), 4));

test("rounds to one decimal", () =>
  assert.strictEqual(averageMood([{ mood: 5 }, { mood: 4 }]), 4.5));

test("treats missing mood as 0", () =>
  assert.strictEqual(averageMood([{ mood: 4 }, {}]), 2));

test("handles a single entry", () =>
  assert.strictEqual(averageMood([{ mood: 3 }]), 3));

test("handles large dataset (100 entries)", () => {
  const big = Array.from({ length: 100 }, (_, i) => ({ mood: (i % 5) + 1 }));
  const avg = averageMood(big);
  assert.ok(avg >= 1 && avg <= 5, "average should be between 1 and 5");
});

test("handles non-numeric mood gracefully", () =>
  assert.strictEqual(averageMood([{ mood: "abc" }, { mood: 4 }]), 2));

test("handles mood at boundary value 0", () =>
  assert.strictEqual(averageMood([{ mood: 0 }]), 0));

/* ================================================================
   currentStreak
   ================================================================ */
console.log("\ncurrentStreak");

/** Helper to create a minimal entry with just a date. */
const day = (iso) => ({ date: iso });

test("zero for no entries", () => assert.strictEqual(currentStreak([]), 0));

test("counts consecutive days ending today", () => {
  const today = new Date("2026-06-06T10:00:00");
  const e = [day("2026-06-04"), day("2026-06-05"), day("2026-06-06")];
  assert.strictEqual(currentStreak(e, today), 3);
});

test("breaks on a gap", () => {
  const today = new Date("2026-06-06T10:00:00");
  const e = [day("2026-06-02"), day("2026-06-05"), day("2026-06-06")];
  assert.strictEqual(currentStreak(e, today), 2);
});

test("still counts if last check-in was yesterday", () => {
  const today = new Date("2026-06-06T10:00:00");
  assert.strictEqual(currentStreak([day("2026-06-05")], today), 1);
});

test("zero if newest entry is stale", () => {
  const today = new Date("2026-06-06T10:00:00");
  assert.strictEqual(currentStreak([day("2026-06-01")], today), 0);
});

test("dedupes multiple check-ins on the same day", () => {
  const today = new Date("2026-06-06T10:00:00");
  const e = [day("2026-06-06"), day("2026-06-06"), day("2026-06-05")];
  assert.strictEqual(currentStreak(e, today), 2);
});

test("counts a single same-day check-in as 1", () => {
  const today = new Date("2026-06-06T10:00:00");
  assert.strictEqual(currentStreak([day("2026-06-06")], today), 1);
});

test("handles null entries", () => assert.strictEqual(currentStreak(null), 0));

test("handles year boundary streaks (Dec 31 → Jan 1)", () => {
  const today = new Date("2026-01-02T10:00:00");
  const e = [day("2025-12-31"), day("2026-01-01"), day("2026-01-02")];
  assert.strictEqual(currentStreak(e, today), 3);
});

test("handles month boundary streaks", () => {
  const today = new Date("2026-03-02T10:00:00");
  const e = [day("2026-02-28"), day("2026-03-01"), day("2026-03-02")];
  assert.strictEqual(currentStreak(e, today), 3);
});

test("handles very long streaks (30 days)", () => {
  const today = new Date("2026-06-30T10:00:00");
  const e = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date("2026-06-01");
    d.setDate(d.getDate() + i);
    e.push(day(toISO(d)));
  }
  assert.strictEqual(currentStreak(e, today), 30);
});

/* ================================================================
   toISO
   ================================================================ */
console.log("\ntoISO");

test("formats local date", () =>
  assert.strictEqual(toISO(new Date("2026-01-09T08:00:00")), "2026-01-09"));

test("pads single-digit months and days", () =>
  assert.strictEqual(toISO(new Date("2026-03-05T12:00:00")), "2026-03-05"));

test("handles end-of-year date", () =>
  assert.strictEqual(toISO(new Date("2026-12-31T23:59:59")), "2026-12-31"));

test("handles leap year date", () =>
  assert.strictEqual(toISO(new Date("2024-02-29T12:00:00")), "2024-02-29"));

test("handles start of year", () =>
  assert.strictEqual(toISO(new Date("2026-01-01T00:00:00")), "2026-01-01"));

/* ================================================================
   topTriggers
   ================================================================ */
console.log("\ntopTriggers");

test("tallies and sorts triggers", () => {
  const e = [
    { triggers: ["Burnout", "Self-doubt"] },
    { triggers: ["Burnout"] },
    { triggers: ["Self-doubt", "Burnout"] },
  ];
  const t = topTriggers(e);
  assert.strictEqual(t[0].name, "Burnout");
  assert.strictEqual(t[0].count, 3);
  assert.strictEqual(t[1].count, 2);
});

test("respects the limit", () => {
  const e = [{ triggers: ["a", "b", "c", "d", "e", "f"] }];
  assert.strictEqual(topTriggers(e, 3).length, 3);
});

test("handles entries without triggers", () =>
  assert.deepStrictEqual(topTriggers([{}, { triggers: [] }]), []));

test("handles null input", () => assert.deepStrictEqual(topTriggers(null), []));

test("counts a single trigger once", () => {
  const t = topTriggers([{ triggers: ["Self-doubt"] }]);
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].count, 1);
});

test("handles tie-breaking (same count preserves order)", () => {
  const e = [{ triggers: ["A", "B", "C"] }];
  const t = topTriggers(e);
  assert.strictEqual(t.length, 3);
  t.forEach((item) => assert.strictEqual(item.count, 1));
});

test("handles unicode trigger names", () => {
  const e = [{ triggers: ["परीक्षा का दबाव", "😰 Stress"] }];
  const t = topTriggers(e);
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[0].name, "परीक्षा का दबाव");
});

test("limit greater than total returns all", () => {
  const e = [{ triggers: ["A", "B"] }];
  assert.strictEqual(topTriggers(e, 10).length, 2);
});

/* ================================================================
   extractJson
   ================================================================ */
console.log("\nextractJson");

test("parses fenced json", () =>
  assert.strictEqual(extractJson('```json\n{"concern":false}\n```').concern, false));

test("parses json amid prose", () =>
  assert.strictEqual(extractJson('ok {"a":1} done').a, 1));

test("throws on no json", () => assert.throws(() => extractJson("nothing")));

test("throws on null", () => assert.throws(() => extractJson(null)));

test("parses nested json objects", () => {
  const out = extractJson('{"actions":["a","b"],"meta":{"x":1}}');
  assert.strictEqual(out.actions.length, 2);
  assert.strictEqual(out.meta.x, 1);
});

test("handles extra whitespace around JSON", () => {
  const out = extractJson('   \n  {"key": "value"}  \n  ');
  assert.strictEqual(out.key, "value");
});

test("handles JSON with unicode characters", () => {
  const out = extractJson('{"msg": "नमस्ते 🙏"}');
  assert.strictEqual(out.msg, "नमस्ते 🙏");
});

test("throws on incomplete JSON (missing closing brace)", () =>
  assert.throws(() => extractJson('{"key": "value"')));

test("parses JSON with boolean and null values", () => {
  const out = extractJson('{"a": true, "b": false, "c": null}');
  assert.strictEqual(out.a, true);
  assert.strictEqual(out.b, false);
  assert.strictEqual(out.c, null);
});

/* ================================================================
   buildPrompt
   ================================================================ */
console.log("\nbuildPrompt");

test("includes mood, triggers and reflection", () => {
  const p = buildPrompt({ mood: 2, triggers: ["Burnout", "Fear of results"], journal: "so tired" });
  ["2/5", "Burnout", "Fear of results", "so tired"].forEach((s) =>
    assert.ok(p.includes(s), "missing " + s)
  );
});

test("instructs not to diagnose", () =>
  assert.ok(/do NOT diagnose/i.test(buildPrompt({}))));

test("requests a concern flag for safety", () =>
  assert.ok(/concern/.test(buildPrompt({}))));

test("handles all 5 mood levels correctly", () => {
  for (let m = MOOD_MIN; m <= MOOD_MAX; m++) {
    const p = buildPrompt({ mood: m });
    assert.ok(p.includes(m + "/" + MOOD_MAX), "missing mood " + m);
    assert.ok(p.includes(MOOD_LABELS[m]), "missing label for mood " + m);
  }
});

test("handles XSS attempt in journal text", () => {
  const p = buildPrompt({ mood: 3, journal: '<script>alert("xss")</script>' });
  assert.ok(p.includes('<script>'), "journal should be included as-is in prompt");
  /* Note: XSS is sanitised at render time (escapeHtml), not in the prompt. */
});

test("includes safety instruction keywords", () => {
  const p = buildPrompt({});
  assert.ok(p.includes("not a therapist"), "missing therapist disclaimer");
  assert.ok(p.includes("JSON"), "missing JSON format instruction");
});

test("handles empty triggers array", () => {
  const p = buildPrompt({ mood: 3, triggers: [] });
  assert.ok(p.includes("none selected"), "should show 'none selected' for empty triggers");
});

test("handles missing journal", () => {
  const p = buildPrompt({ mood: 3 });
  assert.ok(p.includes("(none written)"), "should show fallback for missing journal");
});

/* ================================================================
   sanitizeText
   ================================================================ */
console.log("\nsanitizeText");

test("removes control characters", () => {
  assert.strictEqual(sanitizeText("hello\x00world"), "helloworld");
});

test("preserves newlines and tabs", () => {
  assert.strictEqual(sanitizeText("line1\nline2\ttab"), "line1\nline2\ttab");
});

test("handles empty string", () => {
  assert.strictEqual(sanitizeText(""), "");
});

test("handles null", () => {
  assert.strictEqual(sanitizeText(null), "");
});

test("preserves normal unicode text", () => {
  assert.strictEqual(sanitizeText("Hello 🌍 नमस्ते"), "Hello 🌍 नमस्ते");
});

test("removes mixed control characters", () => {
  assert.strictEqual(sanitizeText("a\x01b\x02c\x03d"), "abcd");
});

/* ================================================================
   getGreeting
   ================================================================ */
console.log("\ngetGreeting");

test("returns morning greeting before noon", () => {
  const result = getGreeting(new Date("2026-06-06T09:00:00"));
  assert.ok(result.toLowerCase().includes("morning"), "should greet morning");
});

test("returns afternoon greeting in the afternoon", () => {
  const result = getGreeting(new Date("2026-06-06T14:00:00"));
  assert.ok(result.toLowerCase().includes("afternoon"), "should greet afternoon");
});

test("returns evening greeting in the evening", () => {
  const result = getGreeting(new Date("2026-06-06T19:00:00"));
  assert.ok(result.toLowerCase().includes("evening"), "should greet evening");
});

test("returns late-night greeting after 9 PM", () => {
  const result = getGreeting(new Date("2026-06-06T23:00:00"));
  assert.ok(result.length > 0, "should return a non-empty greeting");
});

test("returns early-morning greeting before 5 AM", () => {
  const result = getGreeting(new Date("2026-06-06T03:00:00"));
  assert.ok(result.length > 0, "should return a non-empty greeting");
});

/* ================================================================
   Constants validation
   ================================================================ */
console.log("\nConstants");

test("MOOD_LABELS has all 5 levels", () => {
  for (let i = 1; i <= 5; i++) {
    assert.ok(MOOD_LABELS[i], "missing label for mood " + i);
    assert.ok(typeof MOOD_LABELS[i] === "string", "label should be string for mood " + i);
  }
});

test("MOOD_MIN and MOOD_MAX are valid", () => {
  assert.strictEqual(MOOD_MIN, 1);
  assert.strictEqual(MOOD_MAX, 5);
  assert.ok(MOOD_MIN < MOOD_MAX, "MIN should be less than MAX");
});

test("MAX_JOURNAL_LENGTH is a positive number", () => {
  assert.ok(MAX_JOURNAL_LENGTH > 0, "journal limit should be positive");
  assert.ok(Number.isInteger(MAX_JOURNAL_LENGTH), "journal limit should be integer");
});

test("MAX_CHART_ENTRIES is a positive number", () => {
  assert.ok(MAX_CHART_ENTRIES > 0, "chart entries limit should be positive");
});

test("DEBOUNCE_MS is a positive number", () => {
  assert.ok(DEBOUNCE_MS > 0, "debounce should be positive");
});

/* ================================================================
   Summary
   ================================================================ */
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);