/**
 * Steady test suite — zero dependencies. Run: node tests/logic.test.js
 * Covers escaping, mood average, streak logic, trigger tallying,
 * JSON extraction, and prompt construction.
 */
const assert = require("assert");
const {
  escapeHtml, averageMood, currentStreak, toISO, topTriggers, extractJson, buildPrompt,
} = require("../app.js");

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + e.message); }
};

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

console.log("\ncurrentStreak");
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

console.log("\nextractJson");
test("parses fenced json", () => assert.strictEqual(extractJson('```json\n{"concern":false}\n```').concern, false));
test("parses json amid prose", () => assert.strictEqual(extractJson('ok {"a":1} done').a, 1));
test("throws on no json", () => assert.throws(() => extractJson("nothing")));
test("throws on null", () => assert.throws(() => extractJson(null)));
test("parses nested json objects", () => {
  const out = extractJson('{"actions":["a","b"],"meta":{"x":1}}');
  assert.strictEqual(out.actions.length, 2);
  assert.strictEqual(out.meta.x, 1);
});

console.log("\nbuildPrompt");
test("includes mood, triggers and reflection", () => {
  const p = buildPrompt({ mood: 2, triggers: ["Burnout", "Fear of results"], journal: "so tired" });
  ["2/5", "Burnout", "Fear of results", "so tired"].forEach((s) =>
    assert.ok(p.includes(s), "missing " + s));
});
test("instructs not to diagnose", () => assert.ok(/do NOT diagnose/i.test(buildPrompt({}))));
test("requests a concern flag for safety", () => assert.ok(/concern/.test(buildPrompt({}))));

console.log("\ntoISO");
test("formats local date", () => assert.strictEqual(toISO(new Date("2026-01-09T08:00:00")), "2026-01-09"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);