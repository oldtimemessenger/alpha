import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const app = read("./app.js");
const rules = read("./app-wide-interaction-rules.css");
const palette = read("./button-palette.css");
const community = read("./community-screen.css");
const releaseInterface = read("./release-interface.css");
const composer = read("./blast-social.js");
const account = read("./account-professional.css");
const authBrand = read("./auth-brand.css");
const landing = read("./destination-landing-refinement.css");
const profileHeader = read("./profile-header-refinement.css");
const viewerPlace = read("./place-profile.css");
const feedPlace = read("./styles.css");
const repost = read("./repost-affordance.css");

test("Oldtime primary actions are black and Follow actions are red", () => {
  assert.match(palette, /--color-primary:#17191c/);
  assert.match(rules, /background:#17191c !important/);
  assert.match(rules, /background:#d7263d !important/);
  assert.match(rules, /\.post-viewer-follow/);
});

test("Create uses the existing camera icon without a blue circle", () => {
  assert.match(app, /class="nav-create-icon">\$\{ic\.camera\}/);
  assert.match(rules, /\.phone > nav\.nav \.nav-create-icon[\s\S]*?background:transparent !important/);
});

test("Community composer uses the message edit icon and requested prompt", () => {
  assert.match(composer, /class="blast-compose-icon"[^>]*>\$\{icon\("edit"\)\}/);
  assert.match(composer, /<span>Type something…<\/span>/);
  assert.match(releaseInterface, /\.community-header \.community-new-post\.compose-trigger\{[^}]*border:0[^}]*border-radius:0[^}]*background:transparent/);
});

test("place labels match the compact repost control in feed and fullscreen viewer", () => {
  assert.match(feedPlace, /\.clip-place-card\s*\{[^}]*min-height:\s*27px/s);
  assert.match(viewerPlace, /\.post-viewer-place-location\.place-video-overlay\s*\{[^}]*min-height:\s*27px/s);
  assert.match(repost, /min-height:\s*27px/);
  assert.match(rules, /\.clip-place-icon\s*\{[^}]*width:20px;[^}]*height:20px/);
});

test("account type choices and actions use a compact, separated type scale", () => {
  assert.match(account, /\.ap-card h2\{[^}]*font:650 15px\/1\.3/);
  assert.match(account, /\.ap-opt span\{[^}]*gap:3px/);
  assert.match(account, /\.ap-opt small\{[^}]*font:400 12px\/1\.4/);
  assert.match(account, /\.ap-wrap > \.ap-btn\[data-ap-next\]\{[^}]*margin-top:8px/);
});

test("auth, notifications, and profile actions follow the black-red palette", () => {
  assert.match(authBrand, /\.btn\.primary\{background:#17191c/);
  assert.match(rules, /\.btn:not\(\.ghost\):not\(\.danger\):not\(\.auth-link\)/);
  assert.match(rules, /\.auth\.ot-auth \.btn\.auth-link\s*\{[^}]*background:transparent !important/);
  assert.match(landing, /\.notification-row\.is-unread[^}]*background:#fff/);
  assert.match(landing, /\.chat-list-heading[^}]*background:#fff/);
  assert.match(profileHeader, /\.profile-follow-button\[aria-pressed="false"\]\s*\{[^}]*background:#d7263d/);
});
