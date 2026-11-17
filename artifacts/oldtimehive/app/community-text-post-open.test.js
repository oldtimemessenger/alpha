import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("Community text post cards open their original post without a separate View button", () => {
  assert.match(app, /data-community-open-post="\$\{esc\(post\.id\)\}"/);
  assert.match(app, /function bindCommunityTextPostOpen\(\)/);
  assert.match(app, /openPostViewer\(card\.dataset\.communityOpenPost\)/);
  assert.match(app, /event\.key !== "Enter" && event\.key !== " "/);
});

test("text-only posts never enter the full-screen media viewer", () => {
  assert.match(app, /const postMedia = profilePostMedia\(p\);\s*const renderKind = postMedia\.length \? p\.kind : "text";/);
  assert.match(app, /if \(originalPost && !profilePostMedia\(originalPost\)\.length && !originalPost\.creativeProject\) \{\s*if \(commentId\) comments\(id, commentId\);\s*else openCommunityOriginalPostSheet\(originalPost\);/);
  assert.match(app, /const unifiedMediaActions = renderKind !== "text" && \(!communityPostContext \|\| mediaViewer\)/);
  assert.match(app, /const mediaOptionsMenu = !communityPostContext && renderKind !== "text" && surface === "detail"/,
    "post options are limited to full-screen media, not text-only Community cards");
  assert.match(app, /className: "community-post-actions-menu"/,
    "Community retains its post menu");
});
