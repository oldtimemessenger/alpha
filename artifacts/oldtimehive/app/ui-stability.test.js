import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = name => readFileSync(new URL(name, import.meta.url), "utf8");

test("signup collapses empty feedback and constrains native form fields", () => {
  const auth = source("./auth-brand.css");
  const markup = source("./auth-design.js");
  assert.match(markup, /id="su-birthday"[^>]*type="date"/);
  assert.match(auth, /#err:empty/);
  assert.match(auth, /\.auth-success:empty/);
  assert.match(auth, /\.auth\.ot-auth \.field\{[^}]*width:100%;[^}]*min-width:0;[^}]*max-width:100%/);
  assert.match(auth, /\.signup-login\{margin-top:8px\}/);
});

test("full-screen post options work while Profile cards stay clean", () => {
  const app = source("./app.js");
  const styles = source("./styles.css");
  const postActions = source("./post-actions-menu.js");
  assert.doesNotMatch(app, /<details class="profile-post-menu"/);
  assert.match(app, /const mediaOptionsMenu = !communityPostContext && renderKind !== "text" && surface === "detail"/);
  assert.match(app, /data-post-engagement-open=/);
  assert.match(app, /data-post-viewer-download=/);
  assert.match(app, /data-post-viewer-why=/);
  assert.match(app, /data-audio-open=/);
  assert.match(app, /data-post-cover-edit=/);
  assert.match(app, /className: "community-post-actions-menu"/);
  assert.match(postActions, /data-post-edit=/);
  assert.match(postActions, /data-post-archive=/);
  assert.match(postActions, /data-delete-post=/);
  assert.doesNotMatch(app, /class="hookcard-edit"/);
  assert.doesNotMatch(app, /class="hookcard-cover"/);
  assert.match(styles, /\.profile-post-menu-items,\s*\.post-actions-menu-items\s*\{/);
  assert.match(styles, /\.profile-post-menu-items button:focus-visible/);
});

test("Community keeps opaque surfaces and avoids whole-screen fades on feed-tab changes", () => {
  const app = source("./app.js");
  const screen = source("./community-screen.css");
  assert.match(app, /const communityTabChange = previousScreen\?\.classList\.contains\("community-screen"\)/);
  assert.match(app, /if \(!sameScreen && !communityTabChange\)/);
  assert.match(app, /if \(communityTabChange \|\| item\.matches\("\.community-post-card"\)\) continue;/);
  assert.match(screen, /\.stories-phone \.community-screen > \.stories-feed-scroll \{[^}]*background: #fff/s);
});
