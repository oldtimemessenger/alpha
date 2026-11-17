import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(name, import.meta.url), "utf8");

test("all media surfaces use one horizontal Like, Comment, Save row", async () => {
  const app = await read("./app.js");

  assert.match(app, /app\.querySelectorAll\("\[data-open\]"\)\.forEach\(b => b\.onclick = \(\) => openPostViewer\(b\.dataset\.open, "", \{[\s\S]*?source: "profile",[\s\S]*?sourcePostIds: grid\.map\(post => String\(post\.id\)\),[\s\S]*?sourceProfileId: u\.id/ ,
    "profile post tiles open the full-screen post viewer");
  assert.match(app, /viewerSource = \["places", "explore", "search", "profile", "home-following", "home-foryou"\]\.includes\(source\) \? source : ""/,
    "the viewer retains the profile source");
  assert.match(app, /const profileViewer = viewerSource === "profile" && mediaViewer && surface === "detail"/);
  const unifiedActions = app.match(/const actions = unifiedMediaActions\s*\? `([\s\S]*?)`\s*: profileViewer/)?.[1] || "";
  assert.match(unifiedActions, /\$\{likeAction\}[\s\S]*?\$\{commentAction\}[\s\S]*?\$\{saveAction\}/,
    "all non-Community media viewers use Home's Like, Comment, Save order and icons");
  assert.match(unifiedActions, /\$\{likeAction\}[\s\S]*?\$\{commentAction\}[\s\S]*?\$\{saveAction\}[\s\S]*?\$\{shareIconButton\}/,
    "the unified media row includes Share after Like, Comment, and Save");
  assert.doesNotMatch(unifiedActions, /data-repost/,
    "the unified media action row does not add Repost");
  assert.match(app, /const mediaViewerControls = unifiedMediaActions && \(mediaViewer \|\| surface === "main"\)/,
    "Home and full-screen media surfaces share one controls component");
  assert.match(app, /class="post-viewer-media-controls"[\s\S]*?class="media-action-row"/,
    "the old vertical rail is replaced by a dedicated horizontal row");
  assert.match(app, /class="post-viewer-media-prompt" data-post-viewer-comment-prompt=/,
    "every media screen has the requested Say something prompt");
  assert.match(app, /app\.querySelectorAll\("\[data-post-viewer-comment-prompt\]"\)\.forEach\(button => button\.onclick = event => \{[\s\S]*?comments\(button\.dataset\.postViewerCommentPrompt\);[\s\S]*?requestAnimationFrame\(\(\) => \$\("#cbody"\)\?\.focus\(\)\)/,
    "tapping the prompt opens the comments panel and focuses its input");
  const mediaStyles = await read("./media-style-consistency.css");
  assert.match(mediaStyles, /\.post-viewer-media-controls > \.media-action-row\s*\{[^}]*flex-direction:row!important/s);
  assert.match(mediaStyles, /\.post-viewer-media-controls > \.media-action-row \.act\s*\{[^}]*flex-direction:row!important/s);
  assert.match(mediaStyles, /\.post-viewer-media-controls > \.post-viewer-media-prompt\s*\{[^}]*flex:1 1 0%!important;[^}]*min-width:0!important/s);
  assert.match(mediaStyles, /\.media-action-sound-toggle\s*\{[^}]*position:absolute!important/s,
    "video sound stays separate from Like, Comment, and Save");
});
