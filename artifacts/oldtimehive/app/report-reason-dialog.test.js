import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const dialog = readFileSync(new URL("./report-reason-dialog.js", import.meta.url), "utf8");

test("post and place-review reports use the in-app reason dialog", () => {
  assert.match(app, /requestReportReason\(\{ minLength: 10 \}\)/);
  assert.match(app, /const reason = await requestReportReason\(\);/);
  assert.doesNotMatch(app, /window\.prompt\s*\(/);
});

test("report reason dialog asks a simple question without exposing a site address", () => {
  assert.match(dialog, /Why are you reporting this\?/);
  assert.match(dialog, /Submit report/);
  assert.match(dialog, /data-report-cancel/);
  assert.doesNotMatch(dialog, /heyoldtime\.com|www\./i);
});
