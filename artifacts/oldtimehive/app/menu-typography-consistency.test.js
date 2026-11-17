import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const app = read("./app.js");
const foundations = read("./ui-foundations.css");
const menus = read("./shared-menu-consistency.css");
const profileActions = read("./profile-action-controls.css");
const settingsNotifications = read("./settings-notification-refinement.css");

test("final shared menu layer is loaded after feature styles", () => {
  assert.match(app, /import "\.\/shared-menu-consistency\.css"/);
  assert.ok(app.indexOf('import "./shared-menu-consistency.css"') > app.indexOf('import "./interface-cleanup.css"'));
});

test("menu typography tokens define consistent item and helper sizes", () => {
  assert.match(foundations, /--ot-font-menu:\s*14px/);
  assert.match(foundations, /--ot-font-menu-meta:\s*14px/);
  assert.match(menus, /font-size:\s*var\(--ot-font-menu\)/);
  assert.match(menus, /font-size:\s*var\(--ot-font-menu-meta\)/);
});

test("shared menu sizing stays scoped and preserves the screen heading hierarchy", () => {
  assert.match(menus, /details:not\(\.ce-menu\)/);
  assert.match(foundations, /--ot-font-page:\s*var\(--fs-page,\s*20px\)/);
  assert.match(foundations, /--ot-font-section:\s*var\(--fs-section,\s*17px\)/);
  assert.doesNotMatch(menus, /Shared heading sizes and control typography across ordinary app screens/);
  assert.doesNotMatch(menus, /font-size:\s*var\(--ot-font-control\)/);
});

test("Settings and Notifications use scoped white, neutral styling", () => {
  assert.match(settingsNotifications, /#app \.account-settings-screen\.settings-home-view[\s\S]*?background:#fff/);
  assert.match(settingsNotifications, /#app \.notifications-screen[\s\S]*?background:#fff/);
  assert.match(settingsNotifications, /\.notification-insights-button[\s\S]*?color:#24252a/);
  assert.match(settingsNotifications, /\.notification-filters button\.on[\s\S]*?color:#17181b/);
  assert.match(settingsNotifications, /--notification-red/);
  assert.doesNotMatch(settingsNotifications, /--landing-blue|#1456d9|#007cf8/i);
});

test("ordinary dropdown surfaces and their rows use white compact menu styling", () => {
  for (const selector of [
    ".post-actions-menu-items", ".profile-post-menu-items", ".post-edit-menu-items",
    ".profile-action-dropdown-panel", ".discovery-browse-menu"
  ]) assert.ok(menus.includes(selector), `Missing shared style for ${selector}`);
  assert.match(menus, /background:\s*var\(--ot-menu-surface\)/);
  assert.match(menus, /min-height:\s*48px/);
  assert.match(menus, /width:\s*var\(--ot-menu-icon\)/);
  assert.match(profileActions, /background:\s*#f6f6f8/); // Later shared layer overrides only this menu surface.
});

test("immersive Story/media and creative editor palette are deliberately excluded", () => {
  assert.match(menus, /Story\/media, camera, and the creative editor keep their contextual palettes/);
  assert.doesNotMatch(menus, /#storyview\s*\{|\.camera-screen\s*\{|\.creative-editor\s*\{/);
});
