import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./media-style-consistency.css", import.meta.url), "utf8");
const finalCss = readFileSync(new URL("./unboxed-interface.css", import.meta.url), "utf8");

test("media feeds share the reference icon and text scale", () => {
  assert.match(css, /#app #feed \.clip:not\(\.post-detail\):not\(\.community-media-exempt\) > \.rail\s*\{[\s\S]*?flex-direction:row/s);
  assert.match(css, /#app #feed \.clip:not\(\.post-detail\):not\(\.community-media-exempt\) > \.rail \.act \.navic\s*\{[\s\S]*?width:28px;\s*height:28px;/s);
  assert.match(css, /\.clip:not\(\.post-detail\).*?min-width:44px;\s*min-height:44px;/s);
  assert.match(css, /\.post-viewer-screen\.post-viewer-has-media .*?flex-direction:row!important/s);
  assert.match(css, /\.post-viewer-screen\.post-viewer-has-media .*?width:28px!important;\s*height:28px!important;/s);
  assert.match(css, /\.post-viewer-media-controls > \.media-action-row\s*\{[^}]*flex-direction:row!important/s,
    "the media action row is a separate horizontal component, not a restyled vertical rail");
  assert.match(css, /\.post-viewer-media-controls > \.media-action-row \.act\s*\{[^}]*flex-direction:row!important/s,
    "action counts sit inline beside their icons");
  assert.match(css, /\.post-viewer-media-controls > \.post-viewer-media-prompt\s*\{[^}]*flex:1 1 0%!important;[^}]*min-width:0!important/s,
    "the comment prompt shrinks before action counts are clipped");
  assert.match(css, /\.followpill\s*\{\s*font-size:12px;/s);
  assert.match(css, /font-size:14px;\s*font-weight:400;\s*line-height:19px;/);
  assert.match(css, /\.post-viewer-screen\.post-viewer-media.*?line-height:19px;/s);
  assert.match(css, /\.community-video-card.*?width:24px;\s*height:24px;/s);
});

test("Community text-only cards are excluded from media styling", () => {
  assert.match(css, /\.community-post-card:has\(\.community-post-media\)/);
  assert.match(css, /\.community-post-card:has\(\.community-attachment-grid\)/);
  assert.doesNotMatch(css, /#app \.community-post-card \.community-post-actions/);
});

test("saved media bookmarks are solid white on non-Community media rails", () => {
  assert.match(finalCss, /#app \.clip \.act\[data-save\]\.on \.navic[\s\S]*?fill:#fff!important/);
  assert.match(css, /post-viewer-screen\.post-viewer-has-media .*?\.act\[data-save\]\.on \.navic[\s\S]*?fill:#fff!important/s);
  assert.match(finalCss, /\.blast-screen \.blast-post-actions \[data-blast-save\]\.is-on svg[\s\S]*?fill:#fff!important/);
});
