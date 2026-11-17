import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const store = readFileSync(new URL("./store.js", import.meta.url), "utf8");
const engagement = readFileSync(new URL("./post-engagement-sheet.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const mediaStyles = readFileSync(new URL("./media-style-consistency.css", import.meta.url), "utf8");
const icons = readFileSync(new URL("./icons.js", import.meta.url), "utf8");
const profileRefinements = readFileSync(new URL("./destination-landing-refinement.css", import.meta.url), "utf8");
const audioPanel = readFileSync(new URL("./audio-panel.js", import.meta.url), "utf8");
const viewerStyles = readFileSync(new URL("./post-viewer-immersive.css", import.meta.url), "utf8");
const selectionTheme = readFileSync(new URL("./active-selection-theme.css", import.meta.url), "utf8");
const modernExperience = readFileSync(new URL("./modern-experience.css", import.meta.url), "utf8");
const soundbarStart = app.indexOf('<div class="soundbar"');
const soundbarEnd = app.indexOf("</article>", soundbarStart);
const soundbarMarkup = app.slice(soundbarStart, soundbarEnd + "</article>".length);

test("media sound controls stay small and unboxed", () => {
  assert.match(app, /data-feed-sound-toggle/);
  assert.match(app, /video\.muted = false/);
  assert.match(mediaStyles, /\.media-action-sound-toggle\s*\{[^}]*width:36px!important;[^}]*height:36px!important;[^}]*border:0!important;[^}]*border-radius:0!important;[^}]*background:transparent!important;/s);
  assert.match(mediaStyles, /\.media-action-sound-toggle svg\s*\{[^}]*width:16px!important;[^}]*height:16px!important;/s);
});

test("Home keeps Share in the media row and limits post menus to full-screen", () => {
  assert.doesNotMatch(app, /home-share-current|visibleHomePostId/);
  assert.match(app, /id="notifications-open" aria-label="Notifications"/);
  assert.match(app, /class="app-search-shortcut" data-tab="search" aria-label="Search"/);
  assert.match(app, /const feedContent = homeView === "nearby"[\s\S]*?posts\.map\(\(post, index\) => postCard\(post, "main"\)/);
  assert.doesNotMatch(app, /homeGridMode|homeMediaGridCard|home-media-grid|data-home-grid-open/,
    "For You and Following use the original full-screen post feed");
  assert.match(app, /hideNav: true/);
  assert.doesNotMatch(app, /post-viewer-comment-overlay|feed-comment-preview|showFeedCommentPreview/,
    "comments stay in the comments view instead of floating over media");
  assert.match(app, /const actions = unifiedMediaActions[\s\S]*?\$\{likeAction\}[\s\S]*?\$\{commentAction\}[\s\S]*?\$\{saveAction\}[\s\S]*?\$\{shareIconButton\}/,
    "Share is the last icon in the same media action row");
  assert.match(app, /const mediaOptionsMenu = !communityPostContext && renderKind !== "text" && surface === "detail"/,
    "the three-dot menu appears only on non-Community full-screen media");
  for (const option of ["data-post-viewer-why", "data-post-engagement-open",
    "data-post-viewer-download", "data-post-edit", "data-post-archive", "data-delete-post",
    "data-post-cover-edit", "data-post-report", "data-post-not-interested"]) {
    assert.match(app, new RegExp(option), `full-screen menu retains ${option}`);
  }
  const mediaMenuMarkup = app.match(/const mediaOptionsMenu =[\s\S]*?<\/details>`\s*: "";/)?.[0] || "";
  assert.doesNotMatch(mediaMenuMarkup, /data-audio-open/,
    "Original audio stays out of the three-dot menu");
  const homeTimeline = app.match(/function homeTimelinePostCard\([\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(homeTimeline, /post-actions-menu/,
    "the rectangular Home timeline keeps its post cards free of overflow menus");
  assert.doesNotMatch(app, /profile-content-post-actions-menu/,
    "the Profile timeline keeps its post cards free of overflow menus");
  assert.match(app, /className: "community-post-actions-menu"/,
    "Community post menus remain available");
  assert.match(app, /class="post-viewer-media-controls"/);
});

test("Home full-screen viewer switches only Home feeds with real followed avatars", () => {
  const switcherStart = app.indexOf("function homeViewerSwitcherMarkup");
  const switcherEnd = app.indexOf("async function switchHomeViewerFeed", switcherStart);
  const switcher = app.slice(switcherStart, switcherEnd);
  assert.ok(switcherStart >= 0 && switcherEnd > switcherStart, "the contextual Home viewer switcher is present");
  assert.match(switcher, /\["discover", "Discover"\], \["following", "Following"\]/);
  assert.match(switcher, /\["foryou", "For You"\], \["following", "Following"\]/);
  assert.doesNotMatch(switcher, /Community|community/,
    "Community stays outside the full-screen Home feed switcher");
  assert.match(switcher, /target === "following" \? homeViewerFollowAvatarStack\(\)/,
    "the avatar stack sits directly beside Following like the reference");
  assert.match(app, /function homeViewerFollowAvatarStack\(\)[\s\S]*?const me = api\.me\(\)[\s\S]*?Array\.isArray\(me\?\.following\)[\s\S]*?api\.user\(id\)/);
  assert.match(app, /data-home-viewer-target/);
  assert.match(app, /if \(!\["following", "discover"\]\.includes\(target\)/);
  assert.match(app, /viewerSource === "home-community" \|\| isCommunitySurfaceMediaPost\(p\)/);
  assert.match(viewerStyles, /post-viewer-screen\.home-feed-viewer/);
  assert.match(viewerStyles, /home-viewer-follow-avatars/);
  assert.match(viewerStyles, /home-viewer-follow-avatars img\s*\{[^}]*25px/);
  assert.match(app, /class="post-actions-menu post-viewer-actions-menu media-post-options/,
    "the full-screen three-dot menu remains in the viewer");
  assert.match(app, /currentFeed\.animate\(/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(viewerStyles, /post-viewer-screen\.post-viewer-media \.post-actions-menu > summary\s*\{\s*color:#fff!important;/);
  assert.match(selectionTheme, /#app \.home-view-tab\.on::after\s*\{\s*display:\s*none;\s*content:\s*none;/);
});

test("Post feed overflow dots stay white across media and Community feeds", () => {
  assert.match(app, /class="post-actions-menu post-viewer-actions-menu media-post-options/,
    "full-screen post actions retain their three-dot menu");
  assert.match(modernExperience, /#app \.post-viewer-screen\.post-viewer-has-media:not\(\.post-viewer-community\) \.media-post-options > summary,[\s\S]*?color:#fff!important/);
  assert.match(modernExperience, /#app \.screen \.community-post-actions-menu > summary\s*\{\s*color:#fff!important;/);
  assert.match(modernExperience, /\.community-post-actions-menu > summary \.navic circle[\s\S]*?fill:#fff!important/);
});

test("Feed post-action menus use native summary activation", () => {
  const start = app.indexOf("function bindPostEditActions");
  const end = app.indexOf('root.querySelectorAll("[data-post-edit]")', start);
  const binding = app.slice(start, end);
  assert.doesNotMatch(binding, /(?:root|menu)\.addEventListener\("click"|event\.preventDefault\(\)|menu\.open\s*=\s*shouldOpen/,
    "the browser handles native summary activation without custom click interception");
  assert.match(binding, /menu\.addEventListener\("toggle", \(\) => \{[\s\S]*?menu\.querySelector\(":scope > summary"\)\?\.setAttribute\("aria-expanded", String\(menu\.open\)\)/);
});

test("The Home comments panel uses a flat edge instead of a rounded sheet", () => {
  assert.match(css, /\.comment-panel\s*\{[^}]*border-radius:\s*0/);
});

test("Profile post tiles hide engagement metrics without discarding stored counts", () => {
  assert.match(store, /measuredViews:\s*Number\.isSafeInteger\(post\.measuredViews\)\s*&&\s*post\.measuredViews\s*>=\s*0\s*\?\s*post\.measuredViews\s*:\s*0/,
    "the server-measured view count remains stored");
  const gridMarkup = app.slice(app.indexOf("const profileGridMarkup"), app.indexOf("const profileGridEmptyMessage"));
  assert.doesNotMatch(gridMarkup, /profile-post-(?:stats|likes|views)|profilePostViewCount|postLikes/,
    "profile tiles do not render like or view counts");
  const mediaStart = gridMarkup.indexOf('class="profile-post-media');
  const mediaEnd = gridMarkup.indexOf('</${archived ? "div" : "button"}>', mediaStart);
  assert.ok(mediaStart >= 0 && mediaEnd > mediaStart, "profile media preview markup remains intact");
  assert.doesNotMatch(gridMarkup.slice(mediaStart, mediaEnd), /profile-post-views|profile-post-video-mark|profile-repost-mark|profile-post-menu/,
    "profile media previews have no badges or menu overlay");
  const statsStart = app.indexOf("const profileStatsMarkup =");
  const statsEnd = app.indexOf("const requested", statsStart);
  assert.ok(statsStart >= 0 && statsEnd > statsStart, "profile header stats are assembled separately");
  assert.doesNotMatch(app.slice(statsStart, statsEnd), /\bviews?\b/i,
    "view totals stay off the profile header");
  assert.doesNotMatch(app, /measured plays/);
});

test("Home keeps view counts off the media rail while Community retains them", () => {
  assert.match(icons, /viewBars:\s*'<path d="M4 19V13M9\.3 19V8M14\.7 19V4M20 19V10"/);
  const postCardStart = app.indexOf("function postCard(");
  const actionsStart = app.indexOf("const actions = placesViewer", postCardStart);
  const actionsEnd = app.indexOf("const mediaViewerControls", actionsStart);
  assert.ok(postCardStart >= 0 && actionsEnd > actionsStart, "Home feed post actions are present");
  assert.doesNotMatch(app.slice(actionsStart, actionsEnd), /viewsMetric/,
    "the Home rail has no standalone Views button");
  assert.match(engagement, /data-engagement-tab/);
  assert.match(app, /class="ot-view-metric" aria-label="\$\{fmt\(post\.measuredViews\)\} views"/);
  assert.match(app, /\$\{likeButton\}\$\{repostButton\}\$\{commentButton\}\$\{viewsMetric\}\$\{saveButton\}\$\{shareButton\}/,
    "the separate Community action row keeps its existing views metric");
  assert.match(css, /\.community-post-actions \{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(css, /\.ot-view-metric \.navic \{ width:18px; height:18px/);
});

test("non-Community media keeps Save in the shared row and text posts retain legacy saves", () => {
  const saveAction = app.slice(app.indexOf("const saveAction ="), app.indexOf("const actions = placesViewer"));
  assert.match(saveAction, /<button class="act \$\{saved \? "on" : ""\}" data-save="\$\{esc\(p\.id\)\}"/);
  const actionsStart = app.indexOf("const actions = unifiedMediaActions");
  const actionsEnd = app.indexOf("const mediaViewerControls", actionsStart);
  const actions = app.slice(actionsStart, actionsEnd);
  assert.ok(actionsStart >= 0 && actionsEnd > actionsStart, "the feed action branches are present");
  assert.match(actions, /const actions = unifiedMediaActions[\s\S]*?\$\{likeAction\}[\s\S]*?\$\{commentAction\}[\s\S]*?\$\{saveAction\}/);
  assert.equal(actions.split("${legacySaveAction}").length - 1, 2,
    "text-only legacy branches keep their existing save behavior");
});

test("Profile posts use a responsive grid with creator details only", () => {
  assert.match(profileRefinements, /#app \.profile-screen \.profile-post-grid\s*\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[\s\S]*?column-gap:10px[\s\S]*?row-gap:12px/);
  assert.match(profileRefinements, /@media \(min-width:700px\)[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,
    "the gallery gains a column on wider screens");
  assert.match(profileRefinements, /@media \(min-width:1100px\)[\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,
    "the gallery can expand again on desktop");
  assert.match(app, /import "\.\/destination-landing-refinement\.css"/,
    "the final profile gallery refinement is loaded after base styles");
  const profileCard = app.indexOf('return `<article class="profile-post-card">');
  const detail = app.indexOf('class="profile-post-detail"', profileCard);
  const byline = app.indexOf('class="profile-post-byline"', detail);
  const media = app.indexOf('class="profile-post-media', byline);
  const profileCardMarkup = app.slice(profileCard, app.indexOf("</article>", profileCard));
  assert.ok(profileCard >= 0 && detail > profileCard && byline > detail && media > byline,
    "existing media and creator byline stay in the profile card");
  assert.doesNotMatch(profileCardMarkup, /profile-post-caption|profile-post-(?:stats|likes|views)/,
    "captions and like/view counters are omitted from profile tiles");
  assert.doesNotMatch(app, /const profilePostMenu =/,
    "profile thumbnails do not gain an extra floating options button");
});

test("Full-screen video hearts and comments are white while saves keep their existing color", () => {
  assert.match(css, /\.clip:not\(\.post-detail\) > \.rail \.act\[data-like\]:not\(\.on\),[\s\S]*?\.clip:not\(\.post-detail\) > \.rail \.act\[data-comment\]\s*\{ color:#fff; \}/);
  assert.match(css, /\.clip:not\(\.post-detail\) > \.rail \.act\[data-like\]\.on \{ color:var\(--feed-like\); \}/);
  assert.match(css, /\.clip \.act\[data-save\]\.on \.navic \{ color:#1d9bf0; fill:#1d9bf0; stroke:#1d9bf0; \}/);
});

test("Feed sound is a simple label with reuse actions in sound details", () => {
  assert.match(css, /\.soundbar\s*\{[^}]*left: 14px; right: 76px; bottom: calc\(128px \+ env\(safe-area-inset-bottom\)\);[^}]*border:0; border-radius:0; background:transparent/);
  assert.match(css, /\.clip \.meta\{bottom:calc\(144px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(soundbarMarkup, /class="soundbar-note" aria-hidden="true">♫<\/span>/);
  assert.match(soundbarMarkup, /data-audio-open="\$\{esc\(p\.id\)\}"/);
  assert.doesNotMatch(soundbarMarkup, /soundbar-action|soundbar-sub|data-audio-action/);
  assert.match(audioPanel, /data-audio-reuse/);
  assert.match(audioPanel, /data-audio-remix/);
});

test("Home feed details and action icons sit closer to navigation without sound overlap", () => {
  assert.match(css, /#feed \.clip:not\(\.post-detail\) \.meta \{ bottom:calc\(98px \+ env\(safe-area-inset-bottom,0px\)\); \}/);
  assert.match(css, /#feed \.clip:not\(\.post-detail\) \.soundbar \{ bottom:calc\(64px \+ env\(safe-area-inset-bottom,0px\)\); \}/);
  assert.match(css, /#feed \.clip:not\(\.post-detail\) \.rail \{ bottom:calc\(76px \+ env\(safe-area-inset-bottom,0px\)\); \}/);
  assert.match(mediaStyles, /#app #feed \.clip:not\(\.post-detail\):not\(\.community-media-exempt\) > \.post-viewer-media-controls\s*\{\s*min-height:50px;\s*padding:6px 12px 0!important;/);
  assert.match(mediaStyles, /#app #feed \.clip:not\(\.post-detail\):not\(\.community-media-exempt\) > \.post-viewer-media-controls\s*\{\s*bottom:calc\(60px \+ env\(safe-area-inset-bottom,0px\)\)!important;/);
  assert.equal(126 - (96 + 22), 8, "metadata ends 8px above the sound label");
});

test("Opaque cross-origin browser errors are not shown verbatim as app toasts", () => {
  assert.match(app, /function handleUnhandledClientError\(error\)/);
  assert.match(app, /crossOriginLoad = \/cross\[- \]origin/);
  assert.doesNotMatch(app, /toast\(e\.(?:error|reason)\.message\)/);
});
