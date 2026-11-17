import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = file => readFileSync(path.join(dir, file), "utf8");

test("Home stays white without duplicate blurred media", () => {
  const app = read("app.js");
  const styles = read("modern-experience.css");
  assert.match(app, /class="profile-post-card home-feed-post-card"/);
  assert.doesNotMatch(app, /home-content-glow|glowSource/);
  assert.match(styles, /#app \.home-screen\[data-rectangle-feed="true"\][\s\S]*?background: #fff !important/);
  assert.match(styles, /color: #17191c/);
  assert.doesNotMatch(styles, /home-content-glow|filter: blur\(42px\)/);
  assert.match(styles, /background: transparent !important/);
});

test("full-screen post overflow remains solid white and notification badges use the shared count", () => {
  const styles = read("modern-experience.css");
  const app = read("app.js");
  assert.match(styles, /post-viewer-actions-menu > summary,[\s\S]*?color: #fff !important/);
  assert.match(app, /notificationBadgeMarkup\(unreadNotificationCount\(accountNotifications\(\), api\.db\(\)\.requests, api\.db\(\)\.friendRequests, me\.id\)\)/);
  assert.match(styles, /#e52e43 !important/);
});
