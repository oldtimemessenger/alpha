import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoCarouselProject, createTextPostProject } from "./create-flow-project.js";

test("a selection of photos becomes one ordered swipeable post with safe cleanup", () => {
  const files = Array.from({ length: 7 }, (_, index) => ({
    name: `photo-${index + 1}.jpg`,
    type: "image/jpeg",
  }));
  const created = [];
  const revoked = [];
  const { project, release } = createPhotoCarouselProject(files, {
    createObjectURL: file => {
      const url = `blob:test-${file.name}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: url => revoked.push(url),
  });

  assert.equal(project.pages.length, 7);
  assert.deepEqual(project.pages.map(scene => scene.background.media), created);
  assert.ok(project.pages.every(scene =>
    scene.background.kind === "photo" && scene.background.fit === "contain"));
  assert.deepEqual(project.pages.map(scene => `${scene.width}:${scene.height}`), Array(7).fill("1080:1350"));

  release();
  assert.deepEqual(revoked, created);
});

test("the text-post choice starts on a selected color canvas with editable text", () => {
  const project = createTextPostProject("A note for the feed", "#e5262f");
  assert.equal(project.background.kind, "color");
  assert.equal(project.background.color, "#e5262f");
  assert.equal(project.layers.length, 1);
  assert.equal(project.layers[0].text, "A note for the feed");
  assert.equal(project.layers[0].color, "#ffffff");
  assert.equal(project.outputKind, "photo");
});

test("text posts require real copy and carousels stay within editor limits", () => {
  assert.throws(() => createTextPostProject("  ", "#1456d9"), /Write something/);
  assert.throws(() => createPhotoCarouselProject([{ type: "image/png" }]), /2 to 10 photos/);
  assert.throws(() => createPhotoCarouselProject([
    { type: "image/png" }, { type: "video/mp4" },
  ]), /2 to 10 photos/);
});
