import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const detailCss = readFileSync(new URL("./post-detail.css", import.meta.url), "utf8");
const immersiveCss = readFileSync(new URL("./post-viewer-immersive.css", import.meta.url), "utf8");
const mediaStyle = readFileSync(new URL("./media-style-consistency.css", import.meta.url), "utf8");
const quietStyle = readFileSync(new URL("./quiet-interface.css", import.meta.url), "utf8");
const interactionRules = readFileSync(new URL("./app-wide-interaction-rules.css", import.meta.url), "utf8");
const homeCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const postCardStart = app.indexOf("function postCard(");
const postCardEnd = app.indexOf("function postPlaceValue(", postCardStart);
const postCardSource = app.slice(postCardStart, postCardEnd);

test("non-Community media uses the Home action row and a plain ellipsis menu", () => {
  const header = app.match(/<header class="post-viewer-topbar">([\s\S]*?)<\/header>/)?.[1] || "";
  assert.ok(header, "post viewer header should exist");
  assert.doesNotMatch(header, /post-viewer-share|aria-label="Share post"/);
  assert.match(header, /mediaViewer\s*\?\s*""\s*:\s*fromPlaces\s*\?\s*`<span class="post-viewer-place-title">Post<\/span>`\s*:\s*`<button type="button" class="post-viewer-avatar"/,
    "all media viewers omit the custom identity and Places title while text detail screens keep theirs");
  assert.doesNotMatch(header, /post-viewer-download/,
    "the download control is no longer a separate viewer-header button");
  assert.match(header, /post-viewer-avatar/);
  assert.match(header, /post-viewer-identity/);
  assert.match(header, /post-viewer-follow/);
  assert.match(app, /class="feed-author-avatar" data-avatar-profile=/);
  assert.match(app, /class="feed-author-name" data-profile=/);
  assert.match(app, /feedFollowButton\(\{author:u,me:api\.me\(\),following,requests:api\.db\(\)\.requests,className:"followpill"/);
  assert.doesNotMatch(postCardSource, /<details class="profile-post-menu"/,
    "profile grid cards no longer display the floating options menu");
  assert.match(postCardSource, /const mediaOptionsMenu = !communityPostContext && renderKind !== "text" && surface === "detail"/,
    "non-Community three-dot controls render only in the full-screen viewer");
  assert.match(postCardSource, /post-viewer-actions-menu media-post-options/,
    "the full-screen menu has its own top-layer target");
  assert.match(app, /className: "community-post-actions-menu"/,
    "Community keeps its own post action menu");
  assert.match(app, /summary\?\.setAttribute\("aria-haspopup", "menu"\)/,
    "the ellipsis has an accessible, working menu trigger");
  assert.match(postCardSource, /const actions = unifiedMediaActions\s*\? `/,
    "non-Community media uses a shared action-row branch");
  const unifiedActions = postCardSource.match(/const actions = unifiedMediaActions\s*\?\s*`([\s\S]*?)`\s*: profileViewer/)?.[1] || "";
  assert.match(unifiedActions, /\$\{likeAction\}[\s\S]*?\$\{commentAction\}[\s\S]*?\$\{saveAction\}/,
    "the shared action row uses Like, Comment, Save in Home order");
  assert.match(unifiedActions, /\$\{saveAction\}[\s\S]*?\$\{shareIconButton\}/,
    "Share sits in the same row after Save");
  assert.doesNotMatch(unifiedActions, /data-repost/,
    "media does not add Repost to the Home action row");
  assert.match(postCardSource, /const saveAction = `<button class="act \$\{saved \? "on" : ""\}" data-save=/,
    "Save remains a primary action in every non-Community media viewer");
  for (const option of ["data-post-viewer-why", "data-post-engagement-open",
    "data-post-viewer-download", "data-post-edit", "data-post-archive", "data-delete-post",
    "data-post-cover-edit", "data-post-report", "data-post-not-interested"]) {
    assert.match(postCardSource, new RegExp(option), `the full-screen menu includes ${option}`);
  }
  const optionsMenu = postCardSource.match(/const mediaOptionsMenu =[\s\S]*?<\/details>`\s*: "";/)?.[0] || "";
  assert.doesNotMatch(optionsMenu, /data-audio-open/,
    "Original audio stays out of the full-screen options menu");
  assert.match(postCardSource, /data-audio-open=/,
    "the post's separate sound controls remain available");
  assert.match(detailCss, /#app \.post-viewer-media \.post-viewer-media-info \.meta \.handle\s*\{\s*display:flex!important;/);
  assert.match(immersiveCss, /background:transparent!important/,
    "the full-screen post header has no black fade");
  assert.match(mediaStyle, /post-viewer-has-media[^{}]*\.media-post-options/,
    "the restored menu stays above the transparent media header");
  assert.match(homeCss, /#feed \.clip:not\(\.post-detail\) \.rail \.ot-view-metric\s*\{[^}]*flex-direction:column/s,
    "feed view counts stack directly under the views icon");
  assert.match(mediaStyle, /#app #feed \.clip:not\(\.post-detail\) \.handle,\s*#app \.post-viewer-media \.post-viewer-media-info \.meta \.handle/);
  assert.match(quietStyle, /#app \.home-screen \.handle \.feed-author-name,#app \.post-viewer-media \.post-viewer-media-info \.meta \.feed-author-name/);
  assert.match(homeCss, /#feed \.clip:not\(\.post-detail\) \.meta \{ bottom:calc\(98px \+ env\(safe-area-inset-bottom,0px\)\); \}/);
  assert.match(homeCss, /#feed \.clip:not\(\.post-detail\) \.soundbar \{ bottom:calc\(64px \+ env\(safe-area-inset-bottom,0px\)\); \}/);
  assert.match(mediaStyle, /#app #feed \.clip:not\(\.post-detail\):not\(\.community-media-exempt\) > \.rail\s*\{[^}]*flex-direction:row/);
  assert.match(mediaStyle, /#app \.post-viewer-screen\.post-viewer-has-media \.clip\.post-detail > \.post-viewer-media-controls\s*\{[^}]*flex-direction:row!important/);
  assert.match(mediaStyle, /#app \.post-viewer-media-controls > \.media-action-row\s*\{[^}]*flex-direction:row!important/);
  assert.match(mediaStyle, /post-viewer-media-controls > \.media-action-row \.act:is\(\[data-like\],\[data-comment\],\[data-save\],\[data-share\]\) \.navic\s*\{[^}]*width:28px!important;[^}]*height:28px!important;/s);
  assert.match(mediaStyle, /#app \.post-viewer-screen\.post-viewer-has-media\.post-viewer-media:not\(\.post-viewer-profile\) \.post-viewer-media-info\s*\{[^}]*right:14px;[^}]*bottom:calc\(66px \+/);
  assert.match(mediaStyle, /#app \.post-viewer-screen\.post-viewer-has-media\.post-viewer-media\.post-viewer-profile:not\(\.post-viewer-community\) \.post-viewer-media-info\s*\{[^}]*right:14px;[^}]*bottom:calc\(66px \+/);
  assert.match(mediaStyle, /#app \.post-viewer-screen\.post-viewer-media \.post-viewer-media-info \.meta \.caption-more\s*\{\s*color:rgba\(255,255,255,\.82\);/);
  assert.match(quietStyle, /#app \.post-viewer-media \.post-viewer-media-info \.meta \.followpill\{[^}]*min-width:78px;min-height:44px[^}]*font-size:12px/);
  assert.match(quietStyle, /#app \.post-viewer-media \.post-viewer-media-info \.meta \.followpill::before\{display:none\}/);
  assert.match(quietStyle, /#app \.post-viewer-media \.post-viewer-media-info \.meta \.followpill\{[^}]*background:var\(--color-follow,#d7263d\)/);
  assert.match(interactionRules, /--color-follow:#d7263d/);
  assert.match(immersiveCss, /\.post-viewer-screen\.post-viewer-media \s*\{[^}]*width:100%; height:100dvh/);
  assert.match(immersiveCss, /#app \.post-viewer-screen\.post-viewer-media \.clip\.post-detail > \.fullimg,[\s\S]*?object-fit:contain!important/);
  assert.match(immersiveCss, /object-position:center/);
  assert.match(immersiveCss, /#app \.post-viewer-screen\.post-viewer-media \.post-viewer-media-backdrop \{ display:block; \}/);
  assert.doesNotMatch(detailCss, /font-size:12\.5px|font:600 11\.5px/,
    "viewer metadata uses the Home feed's caption and sound text sizes");
  assert.match(app, /class="act" data-share="\$\{p\.id\}"/,
    "text-only posts retain their existing Share action");
  assert.match(postCardSource, /community-media-exempt/,
    "Community media is marked for exclusion from the global layout rules");
});

test("full-screen carousel count sits below the post options menu", () => {
  assert.match(mediaStyle,
    /post-viewer-has-media[\s\S]*?\.post-carousel > \.carousel-count\s*\{[^}]*top:calc\(60px \+ env\(safe-area-inset-top,0px\)\)!important;[^}]*right:12px!important;/,
    "the slide count clears the top-right options control");
});

test("fullscreen viewer keeps author details attached to every post while swiping", () => {
  assert.match(app, /function ensurePostViewerInfo\(clip\)\s*\{[\s\S]*?if \(meta && meta\.parentElement !== info\) info\.append\(meta\);[\s\S]*?if \(!info\.isConnected\) clip\.append\(info\);/,
    "author and caption metadata move into the visible overlay, not behind the media");
  assert.match(app, /if \(screen\.classList\.contains\("post-viewer-media"\)\)\s*\{\s*feed\.querySelectorAll\(":scope > \.clip\.post-detail"\)\.forEach\(ensurePostViewerInfo\);/,
    "every newly appended swipe card gets its own metadata overlay");
  assert.match(app, /if \(mediaViewer\) \{\s*app\.querySelectorAll\("\.post-viewer-media \.clip\.post-detail"\)\.forEach\(ensurePostViewerInfo\);\s*bindMediaViewerComments\(id\);/,
    "the initial fullscreen card is prepared before interactions are bound");
  assert.match(immersiveCss, /post-viewer-media-info > \.meta\s*\{[\s\S]*?position:relative!important;[\s\S]*?display:block!important;/,
    "the moved details are positioned in normal flow and remain visible");
  assert.match(immersiveCss, /#app \.post-viewer-screen\.post-viewer-media \.post-viewer-media-info\s*\{[\s\S]*?z-index:6!important;[\s\S]*?visibility:visible!important;[\s\S]*?opacity:1!important;/,
    "the metadata overlay stays above media and is not hidden during viewer changes");
  assert.match(postCardSource, /post-collaborator-byline[\s\S]*?post-collaborator-avatars[\s\S]*?and \$\{acceptedCollaborators\.length\}/,
    "accepted collaborators use the stacked-avatar author byline");
});
