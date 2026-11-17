import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const discovery = readFileSync(new URL("./discovery-professional.css", import.meta.url), "utf8");
const immersive = readFileSync(new URL("./post-viewer-immersive.css", import.meta.url), "utf8");
const homeTimeline = readFileSync(new URL("./home-feed-timeline.css", import.meta.url), "utf8");
const profileTimeline = readFileSync(new URL("./profile-x-reference.css", import.meta.url), "utf8");

test("the fifth navigation slot is Profile while Home keeps a Search shortcut", () => {
  assert.match(app, /data-tab="profile"[^>]*aria-label="Profile"[^>]*data-testid="button-nav-profile"/);
  assert.match(app, /class="app-search-shortcut" data-tab="search"/);
  assert.match(styles, /#app \.nav:not\(\.nav-hidden\)\s*\{\s*grid-template-columns:repeat\(5,minmax\(0,1fr\)\);/);
  assert.match(styles, /\.nav-profile-frame\s*\{[^}]*width:28px[^}]*height:28px/);
});

test("Home timeline uses native scrolling, prefetching, and no card snapping", () => {
  assert.match(styles, /\.feed\s*\{[^}]*overflow-y:\s*auto;[^}]*-webkit-overflow-scrolling:\s*touch;/);
  assert.match(homeTimeline, /#feed\s*\{[^}]*scroll-snap-type:\s*none/);
  assert.match(app, /new IntersectionObserver\(entries => \{\s*if \(entries\.some\(entry => entry\.isIntersecting\)\) void loadMoreCloudPosts\(\);\s*\}, \{ root: \$\("#feed"\), rootMargin: feedPaginationRootMargin\(\{ viewportHeight: window\.innerHeight \}\) \}\)/,
    "native scrolling still prefetches the next page based on viewport and connection");
});

test("For You and Following use profile-sized rectangular timeline cards", () => {
  assert.match(app, /const rectangularHomeFeed = homeView === "following" \|\| homeView === "explore"/);
  assert.match(app, /posts\.map\(post => homeTimelinePostCard\(post\)\)/);
  assert.match(app, /data-home-feed-open[\s\S]*sourcePostIds/);
  assert.match(homeTimeline, /grid-template-columns:\s*40px minmax\(0, 1fr\)/);
  assert.match(homeTimeline, /aspect-ratio:\s*16 \/ 10/);
  assert.match(profileTimeline, /aspect-ratio:\s*16 \/ 10/);
});

test("full-screen media uses native vertical snap instead of scripted touch swipes", () => {
  assert.match(discovery, /\.post-viewer-explore \.post-viewer-feed[^}]*overflow-y:auto[^}]*scroll-snap-type:y mandatory[^}]*touch-action:pan-y/);
  const start = app.indexOf("function bindExploreViewerSwipe");
  const end = app.indexOf("// Search/Discover media viewer", start);
  const binder = app.slice(start, end);
  assert.match(binder, /feed\.addEventListener\("scroll", onScroll/);
  assert.doesNotMatch(binder, /feed\.addEventListener\("touch(?:start|end|cancel)"/);
  assert.doesNotMatch(binder, /feed\.addEventListener\("wheel"/);
});

test("Search and Discover keep viewer cards stacked and avoid remounting on each swipe", () => {
  assert.match(app, /exploreViewer \? " post-viewer-explore" : ""/);
  assert.match(immersive, /post-viewer-feed\s*>\s*\.clip\.post-detail\s*\{[^}]*position:relative!important/);
  const start = app.indexOf("function bindExploreViewerSwipe");
  const end = app.indexOf("// Search/Discover media viewer", start);
  const binder = app.slice(start, end);
  assert.match(binder, /activeId = active\.dataset\.id;[\s\S]*?viewer = activeId/);
  assert.match(binder, /screen\.dataset\.scrollContext = screenScrollContext/);
  assert.match(binder, /bindMediaViewerComments\(activeId\)/);
  assert.doesNotMatch(binder, /viewer = active\.dataset\.id;\s*render\(\)/);
});

test("full-screen Home and Profile swipes stay within their source collection", () => {
  assert.match(app, /viewerSourceCollection = \{\s*ids: Array\.isArray\(sourcePostIds\)/);
  assert.match(app, /source === "home-following" \|\| source === "home-foryou" \|\| source === "profile"/);
  assert.match(app, /loadMoreHomeViewerPosts\(cursorId\)/);
  assert.match(app, /loadMoreProfileViewerPosts\(cursorId\)/);
  assert.match(app, /api\.loadMoreCloudFeed\(\)/);
  assert.match(app, /api\.loadMoreCloudProfileReposts\(profileUserId, user\.username\)/);
  assert.match(app, /observeProfileInfiniteScroll\(\{ userId: u\.id, mode: profileMode, gridLength: grid\.length \}\)/);
  assert.match(app, /data-profile-infinite/);
});

test("Search viewer likes and follows update without remounting the active video", () => {
  assert.match(app, /like\(id, null, !isPlaceViewer && !isMediaViewer\)/);
  assert.match(app, /follow\(b\.dataset\.follow, \{ rerender: !Boolean\(b\.closest\("\.post-viewer-media"\)\) \}\)/);
  assert.match(app, /function syncFollowButtons\(id\)/);
  assert.match(app, /bindPosts\(\{ observe: false \}\)/);
});

test("Search viewer pages through matching media and Discover loads more posts", () => {
  assert.match(app, /viewerAdjacentPostIds\(id, viewerSource\)/);
  assert.match(app, /const ids = api\.posts\(\)\.filter\(post =>/);
  assert.match(app, /exploreEco\.ensureNext\(cursorId\)/);
  assert.match(app, /const appendSearchNext = \(\) =>/);
  assert.match(app, /data-viewer-next-pending/);
});
