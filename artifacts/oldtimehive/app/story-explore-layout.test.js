import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const chat = readFileSync(new URL("./chat.js", import.meta.url), "utf8");
const store = readFileSync(new URL("./store.js", import.meta.url), "utf8");
const places = readFileSync(new URL("./places-view.js", import.meta.url), "utf8");
const explore = readFileSync(new URL("./explore-ecosystem.js", import.meta.url), "utf8");
const saved = readFileSync(new URL("./saved-sheets.js", import.meta.url), "utf8");
const shared = readFileSync(new URL("./shared-content.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const homeStories = readFileSync(new URL("./home-stories-rail.js", import.meta.url), "utf8");
const homeStoriesStyles = readFileSync(new URL("./home-stories-rail.css", import.meta.url), "utf8");
const discoveryStyles = readFileSync(new URL("./search-discovery.css", import.meta.url), "utf8");
const ecosystemStyles = readFileSync(new URL("./explore-ecosystem.css", import.meta.url), "utf8");

test("Search keeps Places reachable without result-type pills or Home recommendation dots", () => {
  const screen = app.slice(app.indexOf("function search()"), app.indexOf("\nfunction notes()", app.indexOf("function search()")));
  assert.doesNotMatch(screen, /data-search-hub|search-hub-tabs|showTypeFilters/);
  assert.doesNotMatch(screen, /data-search-section="people"/);
  assert.doesNotMatch(explore, /data-xe-type|Result type/);
  assert.match(explore, /data-xe-open-places/);
  assert.doesNotMatch(app, /<details class="feed-recommendation-menu"/);
});

test("Home keeps its feed and places followed Story bubbles beside the tabs", () => {
  const header = app.slice(app.indexOf('<header class="home-discovery-header">'), app.indexOf("</header>`}", app.indexOf('<header class="home-discovery-header">')));
  assert.doesNotMatch(header, /home-topic-tabs/);
  assert.match(header, /homeStoriesMarkup/);
  assert.match(header, /home-notifications-button/);
  assert.doesNotMatch(app, /home-hub|homeHub|data-home-story-author|class="stories home-stories"/);
  assert.doesNotMatch(styles, /home-hub|home-hub-progress|stories-scrolled/);
  assert.match(homeStories, /following\.has\(authorId\)/);
  assert.match(homeStories, /canSeeStory\(story\)/);
  assert.doesNotMatch(homeStories, /expandedAuthorId|home-story-slides|home-story-close/);
  assert.doesNotMatch(app, /homeStoryExpandedAuthorId|homeStatusStories/);
  assert.match(app, /openPersonAvatar\(button\.dataset\.homeStoryGroup \|\| "", \{ source: "home" \}\)/);
  assert.match(app, /function openPersonAvatar\(id, \{ source = "direct" \} = \{\}\)[\s\S]*?if \(story\) return openStory\(id, story\.id, \{ source \}\);[\s\S]*?return navigateToProfile\(id\);/);
  assert.match(homeStoriesStyles, /\.home-primary-row \.home-view-tabs\s*\{[^}]*flex:\s*0 0 auto;[^}]*overflow:\s*visible/);
  assert.match(homeStoriesStyles, /\.home-story-new\s*\{[^}]*top:\s*0;/);
  assert.match(homeStories, /interactionAt\(group\.authorId\)/);
  assert.match(header, /homeStoriesMarkup[\s\S]*?<nav class="home-view-tabs"/);
  assert.doesNotMatch(app, /data-home-update-post/);
  assert.match(app, /openPersonAvatar\(b\.dataset\.avatarProfile\)/);
  const views = app.slice(app.indexOf("const HOME_VIEWS = ["), app.indexOf("const HOME_TOPICS = ["));
  assert.match(views, /\{ id: "explore", label: "For You" \}/);
  assert.match(views, /\{ id: "following", label: "Following" \}/);
  assert.doesNotMatch(views, /Places/);
  assert.match(app, /data-discovery-home-topic="\$\{esc\(topic\.id\)\}"/);
});

test("Discover uses one topic bar, keeps browse controls, and never labels the page Stories", () => {
  const screen = app.slice(app.indexOf("function search()"), app.indexOf("\nfunction notes()", app.indexOf("function search()")));
  assert.match(screen, /<header class="community-header search-app-header">[\s\S]*?class="search-back-button" data-search-back[\s\S]*?class="search-header-field"/);
  assert.doesNotMatch(screen, /<h1>Stories<\/h1>|class="discovery-tabs"/);
  assert.match(screen, /class="discovery-home-topic-tabs"/);
  assert.match(screen, /class="discovery-filter-button"/);
  assert.doesNotMatch(screen, /discoveryStoryRail|data-discovery-story/);
  assert.match(explore, /\["engagement", "Most interacted"\]/);
  assert.match(explore, /\["shuffle", "Shuffle"\]/);
  assert.match(screen, /data-discovery-home-topic="\$\{esc\(topic\.id\)\}"/);
  assert.match(screen, /data-discovery-explore-topic="\$\{esc\(topic\.id\)\}"/);
  assert.doesNotMatch(screen, /data-search-hub|search-hub-tabs|showTypeFilters/);
  assert.doesNotMatch(screen, /data-search-section="people"/);
  assert.doesNotMatch(screen, /discovery-stories-heading"><h2>Following<\/h2><span>Stories/);
});

test("Message inbox opens only active, viewable Stories from its avatar", () => {
  assert.match(chat, /isStoryActive\(story\)\s*&&\s*api\.canSeeStory\(story\)/);
  assert.match(chat, /data-inbox-story="\$\{ctxEsc\(storyPerson\.id\)\}"/);
  assert.match(chat, /querySelectorAll\("\[data-inbox-story\]"\)/);
  assert.match(chat, /ctx\.openStory\(button\.dataset\.inboxStory\)/);
});

test("Search removes Stories without removing the Messages Stories viewer", () => {
  assert.doesNotMatch(app, /discoveryStoryRail|bindDiscoveryStoryPreviews|loadCloudStoryPreview/);
  assert.match(chat, /data-inbox-story/);
  assert.match(chat, /ctx\.openStory\(button\.dataset\.inboxStory\)/);
  assert.match(store, /async loadCloudStoryPreview\(id\)/);
  assert.match(app, /class="search-back-button" data-search-back aria-label="Back"/);
  assert.doesNotMatch(app, /<h1>Stories<\/h1>/);
});

test("Explore media grids are two columns on mobile for both local and cloud data", () => {
  assert.match(discoveryStyles, /\.explore-feed-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(ecosystemStyles, /\.xe-grid,\s*\.xe-skeleton\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("the built-in avatar fallback is never treated as post media", () => {
  assert.match(app, /const stored = postMediaReferences\(post\)/);
  assert.match(store, /post\.media\.filter\(item => typeof item\?\.reference === "string" && item\.reference && !isDefaultAvatarMediaReference\(item\.reference\)\)/);
  assert.match(places, /return reference && !isDefaultAvatarMediaReference\(reference\)/);
  assert.match(explore, /isDefaultAvatarMediaReference\(rawMedia\) \? "" : rawMedia/);
  assert.match(saved, /isDefaultAvatarMediaReference\(reference\) \|\| \(!isLocalMediaReference\(reference\) && !safeUrl\(reference\)\) \? "" : reference/);
  assert.match(shared, /isDefaultAvatarMediaReference\(imageReference\) \? "" : safeImage\(imageReference\)/);
});

test("Home Story avatars stay fully visible and snap into place while swiping", () => {
  assert.ok(homeStoriesStyles.includes("flex: 0 0 clamp(68px, 18vw, 76px);"));
  assert.ok(homeStoriesStyles.includes("scroll-snap-type: x mandatory;"));
  assert.ok(homeStoriesStyles.includes("scroll-padding-inline: 3px;"));
  assert.ok(homeStoriesStyles.includes("touch-action: pan-x;"));
  assert.ok(homeStoriesStyles.includes("scroll-snap-align: start;"));
  assert.ok(homeStoriesStyles.includes("scroll-snap-stop: always;"));
});
