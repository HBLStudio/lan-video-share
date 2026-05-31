const test = require("node:test");
const assert = require("node:assert/strict");
const { applyPreferenceAction, normalizePreferences } = require("../src/server");

test("normalizePreferences keeps only valid preference maps", () => {
  const preferences = normalizePreferences({
    blocked: {
      "a.mp4": 100,
      "__proto__": 200,
      "bad.mp4": "not-a-number"
    },
    favorite: {
      "b.mp4": "300"
    }
  });

  assert.deepEqual(preferences.blocked, { "a.mp4": 100 });
  assert.deepEqual(preferences.favorite, { "b.mp4": 300 });
});

test("applyPreferenceAction keeps favorite and blocked mutually exclusive", () => {
  const first = applyPreferenceAction({}, "favorite", "a.mp4", 1000);
  assert.deepEqual(first.favorite, { "a.mp4": 1000 });
  assert.deepEqual(first.blocked, {});

  const second = applyPreferenceAction(first, "block", "a.mp4", 2000);
  assert.deepEqual(second.favorite, {});
  assert.deepEqual(second.blocked, { "a.mp4": 2000 });

  const third = applyPreferenceAction(second, "unblock", "a.mp4", 3000);
  assert.deepEqual(third.favorite, {});
  assert.deepEqual(third.blocked, {});
});

test("applyPreferenceAction rejects invalid actions and ids", () => {
  assert.throws(() => applyPreferenceAction({}, "unknown", "a.mp4"), /Invalid action/);
  assert.throws(() => applyPreferenceAction({}, "favorite", ""), /Invalid videoId/);
});
