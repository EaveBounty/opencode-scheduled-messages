import test from "node:test";
import assert from "node:assert/strict";
import { formatInZone, fromIso, isValidTimezone, toIso } from "../src/util.js";

test("validates IANA timezones", () => {
  assert.equal(isValidTimezone("Asia/Shanghai"), true);
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("Mars/Olympus"), false);
  assert.equal(isValidTimezone(""), false);
});

test("formats epoch milliseconds in a target zone", () => {
  const ms = Date.parse("2026-10-26T16:30:00Z");
  assert.match(formatInZone(ms, "Asia/Shanghai"), /2026-10-27.*00:30/);
  assert.match(formatInZone(ms, "UTC"), /2026-10-26.*16:30/);
});

test("round-trips ISO timestamps", () => {
  const ms = Date.parse("2026-10-26T04:00:00.000Z");
  assert.equal(fromIso(toIso(ms)), ms);
  assert.equal(fromIso("2026-10-26T04:00:00.000Z"), ms);
  assert.equal(fromIso("not-a-date"), null);
});
