import test from "node:test";
import assert from "node:assert/strict";
import { buildHomeStoryGroups, renderHomeStoryRail } from "./home-stories-rail.js";

const now = 10_000_000;
const people = {
  me: { id: "me", name: "Me", following: ["a", "b"] },
  a: { id: "a", name: "Ada", username: "ada", avatar: "/ada.jpg" },
  b: { id: "b", name: "Bo" },
  stranger: { id: "stranger", name: "Stranger" },
};
const base = {
  me: people.me,
  user: id => people[id] || null,
  now,
  isStoryActive: story => !story.expired,
  canSeeStory: story => story.visible !== false,
  blocked: (_a, b) => b === "blocked",
};

test("Home story bubbles group only active, visible stories from the owner and followed creators", () => {
  const groups = buildHomeStoryGroups({
    ...base,
    stories: [
      { id: "a-old", author: "a", created: now - 90_000_000 },
      { id: "a-new", author: "a", created: now - 1_000, text: "Story caption" },
      { id: "private", author: "a", created: now, visible: false },
      { id: "expired", author: "b", created: now, expired: true },
      { id: "stranger", author: "stranger", created: now },
      { id: "blocked", author: "blocked", created: now },
      { id: "mine", author: "me", created: now - 2_000 },
    ],
  });

  assert.deepEqual(groups.map(group => group.authorId), ["me", "a"]);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[1].items.length, 2);
  assert.equal(groups[1].freshCount, 1);
  assert.deepEqual(groups[1].items.map(item => item.id), ["a-new", "a-old"]);
});

test("story bubbles open the latest Story directly without an intermediate panel", () => {
  const groups = buildHomeStoryGroups({
    ...base,
    stories: [
      { id: "story-1", author: "a", created: now - 1_000, text: "First Story" },
      { id: "story-2", author: "a", created: now - 2_000, text: "Second Story" },
    ],
  });
  const html = renderHomeStoryRail(groups, {
    esc: value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    avatarMarkup: () => '<img src="/avatar.jpg" alt="" />',
  });

  assert.match(html, /class="home-stories-inline"/);
  assert.match(html, /data-home-story-group="a" data-home-story-open="story-1"/);
  assert.doesNotMatch(html, /aria-expanded|home-story-slides|home-story-slide/);
  assert.doesNotMatch(html, /home-story-count/);
  assert.match(html, /Open newest Story/);
  assert.doesNotMatch(html, /data-home-update-post|Post/);
  assert.doesNotMatch(renderHomeStoryRail([], {}), /home-stories-inline/);
});

test("recent Story views or contacts can gently mix into newest-first ordering", () => {
  const stories = [
    { id: "a-older", author: "a", created: now - 20 * 60_000 },
    { id: "b-newer", author: "b", created: now - 5 * 60_000 },
  ];
  const chronological = buildHomeStoryGroups({ ...base, stories });
  assert.deepEqual(chronological.map(group => group.authorId), ["b", "a"]);

  const recentlyContacted = buildHomeStoryGroups({
    ...base,
    stories,
    interactionAt: authorId => authorId === "a" ? now : 0,
  });
  assert.deepEqual(recentlyContacted.map(group => group.authorId), ["a", "b"]);
});

test("Stories hidden by privacy, expiry, follows, or blocks never enter the rail", () => {
  const groups = buildHomeStoryGroups({
    ...base,
    stories: [
      { id: "hidden", author: "a", created: now, visible: false },
      { id: "expired", author: "a", created: now, expired: true },
      { id: "stranger-story", author: "stranger", created: now },
      { id: "blocked-story", author: "blocked", created: now },
    ],
  });
  assert.deepEqual(groups, []);
});
