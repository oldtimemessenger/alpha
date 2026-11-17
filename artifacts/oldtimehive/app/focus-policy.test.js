import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const focusPolicy = read("focus-policy.css");
const app = read("app.js");

test("visible focus rings are suppressed across app screens and body-mounted sheets", () => {
  assert.match(focusPolicy, /:root body :is\(\*\):is\(:focus, :focus-visible\)\s*\{[^}]*outline: none !important;[^}]*outline-offset: 0 !important;[^}]*box-shadow: none !important/s);
  assert.match(focusPolicy, /:root body :focus-within\s*\{[^}]*box-shadow: none !important/);
  assert.ok(
    app.lastIndexOf('import "./focus-policy.css";') > app.lastIndexOf('import "./modern-experience.css";'),
    "the focus reset loads after the app's component styles",
  );
  assert.doesNotMatch(focusPolicy, /user-select\s*:\s*none|caret-color\s*:\s*transparent/);
});
