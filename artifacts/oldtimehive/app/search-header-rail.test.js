import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./search-discovery.css", import.meta.url), "utf8");
const compact = readFileSync(new URL("./compact-interface.css", import.meta.url), "utf8");
const destination = readFileSync(new URL("./destination-landing-refinement.css", import.meta.url), "utf8");
const xe = readFileSync(new URL("./explore-ecosystem.js", import.meta.url), "utf8");
const finalCss = readFileSync(new URL("./unboxed-interface.css", import.meta.url), "utf8");
const search = app.slice(app.indexOf("function search()"), app.indexOf("\nfunction notes()", app.indexOf("function search()")));

test("Search opens directly to an inline query field with a working submit action", () => {
  const head = search.slice(search.indexOf('<header class="community-header search-app-header">'), search.indexOf("</header>", search.indexOf("search-app-header")));
  assert.match(head, /<form class="search-header-field" data-search-form role="search">/);
  assert.match(head, /class="search-header-submit">Search<\/button>/);
  assert.match(search, /const searchHeaderInput = `<label class="search-explore-search">[\s\S]*id="q"[\s\S]*\$\{searchHeaderPlaceholder\}/);
  assert.doesNotMatch(head, /search-new-post|community-new-post/);
  assert.doesNotMatch(search, /search-new-post/);
  assert.match(app, /let searchSection = "search"/);
  assert.match(search, /searchLandingMarkup\(\)/);
  assert.match(search, /searchForm\.onsubmit = event =>/);
  assert.match(search, /saveRecentSearch\(value\)/);
  assert.doesNotMatch(search, /class="discovery-header"/);
  assert.match(css, /search-header-submit\s*\{[^}]*background:transparent;[^}]*color:#17191c/);
  assert.match(app, /import "\.\/release-interface\.css"/);
});

test("Category row is one unboxed underlined scroller with the filter icon on the right", () => {
  const row = search.slice(search.indexOf('class="discovery-home-topic-tabs"'), search.indexOf('class="discovery-browse-menu"'));
  assert.ok(row.indexOf('class="discovery-topic-scroll"') < row.indexOf('class="discovery-filter-button"'));
  assert.match(css, /\.search-screen \.discovery-topic-scroll \.discovery-category \{[^}]*border:0;[^}]*background:none/);
  assert.match(css, /\.discovery-category\.on::after \{[^}]*background:#17191c/);
});

test("Search removes Stories and the old Videos/Places landing hub", () => {
  assert.doesNotMatch(app, /discoveryStoryRail|bindDiscoveryStoryPreviews|data-discovery-story-preview/);
  assert.doesNotMatch(css, /discovery-stories|discovery-story-card/);
  assert.doesNotMatch(search, /data-search-hub|search-hub-tabs/);
  assert.match(search, /const showSearchLanding = searchSection === "search" && !searchQ\.trim\(\)/);
  assert.match(search, /body = searchLandingMarkup\(\)/);
  assert.match(xe, /let type = "videos"/);
  assert.match(xe, /\["engagement", "Most interacted"\]/);
  assert.match(xe, /\["shuffle", "Shuffle"\]/);
  assert.match(xe, /setSort\(button\.dataset\.xeSort\)/);
  assert.doesNotMatch(xe, /class="xe-chips xe-sort"/);
  assert.match(xe, /sort === "shuffle" && shuffleSeed/);
});

test("Search never shows result-type pills and keeps mixed results available", () => {
  assert.doesNotMatch(search, /data-search-hub|search-hub-tabs|showTypeFilters|data-local-search-type/);
  assert.doesNotMatch(xe, /Result type|data-xe-type/);
  assert.match(xe, /data-xe-open-places/);
  assert.match(search, /Search people, posts, topics, or places/);
  assert.doesNotMatch(search, /id="search-layout-toggle"|Open Explore layout/);
  assert.match(app, /openPlaces: query => openSearchPlaces\(query\)/);
});

test("Search suggestions are refreshed from real public trends and recent queries stay private to the session", () => {
  assert.match(search, /if \(showSearchLanding\) loadDiscoveryTrends\(\)/);
  assert.match(app, /requestCloudApi\("\/api\/discovery\/trending"\)/);
  assert.match(app, /function searchLandingMarkup\(\)/);
  assert.match(app, /data-search-suggestion=/);
  assert.match(app, /data-search-recent=/);
  assert.match(app, /sessionStorage\.setItem\(`oldtime:recent-searches:/);
  assert.match(css, /\.search-suggestion-list\s*\{/);
  assert.doesNotMatch(search, /data-search-hub|search-hub-tabs/);
});

test("Place search uses Home cards and opens a swipeable viewer that returns to Search", () => {
  assert.match(search, /renderPostCard: placeSearchTimelineCard/);
  assert.match(search, /source: "places",\s*sourcePostIds: discoveryPlaceFeed\.posts\.map/);
  assert.match(search, /mapVisible: discoveryPlaceMapVisible,\s*showMap: true/);
  assert.match(search, /showLanding: false/);
  assert.match(app, /const sourceIds = viewerSourceCollection\.ids/);
  assert.match(app, /searchSection, discoveryPlaceQuery/);
  assert.match(app, /searchPlacesReturn/);
  assert.match(app, /if \(tab === "search" && searchSection !== "places"\) navigationStack\.push/);
});

test("Hold-to-speak sits below plain suggestions and discloses browser transcription", () => {
  assert.match(app, /data-voice-search-status/);
  assert.match(app, /engine\.start\(\)/);
  assert.match(app, /pointerup", stopRecognition/);
  assert.match(app, /Your browser’s speech service transcribes audio/);
  assert.match(css, /\.search-voice-search\s*\{[\s\S]*?position:sticky/);
  assert.match(css, /\.search-voice-search p\s*\{[\s\S]*?border-radius:0/);
});

test("failed topic results wait for an explicit retry instead of rerendering in a request loop", () => {
  const start = app.indexOf("function loadDiscoveryTopicPosts");
  const end = app.indexOf("\nfunction discoveryReasonLabel", start);
  const loader = app.slice(start, end);
  assert.match(loader, /if \(!append && sameTopic && \["loading", "success", "error"\]\.includes\(discoveryTopicPosts\.status\)\) return/);
  assert.match(app, /app\.querySelectorAll\("\[data-topic-retry\]"\)\.forEach\(button => button\.onclick = \(\) => \{\s*discoveryTopicPosts = \{ topic: discoveryTopic, status: "idle"/);
});

test("Search has no separate Explore control or legacy landing markup", () => {
  assert.doesNotMatch(search, /id="search-layout-toggle"|class="search-layout-toggle/);
  assert.doesNotMatch(search, /id="search-new-post"/);
  assert.match(search, /searchSection === "search"/);
  assert.match(search, /body = searchLandingMarkup\(\)/);
  assert.doesNotMatch(search, /\$\{searchLandingDiscovery\}|\$\{searchHubTabs\}/);
  assert.doesNotMatch(css, /search-explore-layout|search-layout-toggle/);
});

test("Discover is exactly two columns everywhere; no stale three-column rule", () => {
  assert.doesNotMatch(css, /(explore-feed-grid|xe-grid)[^{}]*\{[^}]*repeat\(3/);
  assert.match(css, /\.search-screen \.xe-grid, \.search-screen \.explore-feed-grid \{ ?grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
});

test("cloud Community uses the real feed module without an internal release notice", () => {
  assert.match(app, /legacyFeedFallback \? communityFallbackTabs :/);
  const tabs = app.slice(app.indexOf("const communityFallbackTabs"), app.indexOf("shell(`", app.indexOf("const communityFallbackTabs")));
  assert.match(tabs, /<nav class="cf-feed-tabs"/);
  assert.match(tabs, />Following<\/button>[\s\S]*>Discover<\/button>[\s\S]*\["popular", "Popular"\], \["friends", "Mutuals \/ Friends"\]/);
  assert.doesNotMatch(tabs, /Photos & Video|Unavailable<\/small>/);
  assert.match(tabs, /class="cf-controls" data-community-fallback-controls/);
  assert.match(tabs, /class="cf-description"/);
  assert.doesNotMatch(app, /This server doesn’t support Popular/);
  assert.doesNotMatch(app, /Updated feed controls are awaiting the server release|data-community-server-update/);
});

test("Search submits typed queries and keeps the input compact", () => {
  assert.match(search, /class="search-header-field" data-search-form role="search"/);
  assert.match(search, /searchForm\.onsubmit = event =>/);
  assert.match(search, /if \(searchInput\) searchInput\.oninput =/);
  assert.match(search, /exploreEco\.setQuery\(searchQ\)/);
  assert.match(search, /exploreEco\.bind\(app, \{ bindQuery:/);
  assert.match(css, /\.search-screen \.xe-search,\s*\.search-screen \.discovery-search-wrap \{[^}]*min-height:38px;[^}]*border:0;[^}]*box-shadow:none/);
  assert.match(css, /\.search-screen \.xe-search:focus-within,\s*\.search-screen \.discovery-search-wrap:focus-within \{[^}]*border:0; box-shadow:none; outline:0/);
});

test("Search uses the outlined reference field and a plain submit action", () => {
  assert.match(finalCss, /#app \.search-screen \.search-header-control\s*\{[^}]*border:1px solid #e5e7eb;[^}]*background:#fff/);
  assert.match(finalCss, /#app \.search-screen \.search-header-control:focus-within\s*\{[^}]*border-color:#cfd3d9;[^}]*background:#fff;[^}]*box-shadow:none/);
  assert.match(finalCss, /#app \.search-screen \.search-header-control input\[type="search"\]\s*\{[^}]*-webkit-appearance:none!important;[^}]*background:transparent!important/);
  assert.match(finalCss, /input\[type="search"\]::-webkit-search-cancel-button,[\s\S]*?display:none/);
  assert.match(finalCss, /search-header-submit\s*\{[^}]*background:transparent;[^}]*color:#17191c/);
});

test("Search controls fit narrow mobile viewports", () => {
  assert.doesNotMatch(css, /search-hub-tabs|xe-chips\[aria-label="Result type"\]/);
  assert.match(css, /\.search-screen \.discovery-place-map-container \.places-map\s*\{[^}]*height:min\(50vh, 460px\)/);
  assert.match(css, /\.search-screen \.discovery-body,[\s\S]*?\.search-screen \.places-post-author \{[^}]*min-width:0;[^}]*max-width:100%/);
  assert.match(destination, /\.notifications-screen \.notification-category > span:nth-child\(2\),[\s\S]*?overflow-wrap:anywhere/);
  assert.match(compact, /\.phone :is\(p,small,b,strong,h1,h2,h3,label,span/);
  assert.match(css, /\.search-screen \.discovery-topic-scroll \.discovery-category \{[^}]*border:0;[^}]*background:none/);
});
