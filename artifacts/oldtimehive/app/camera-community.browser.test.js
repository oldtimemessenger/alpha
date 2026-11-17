import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { checkCameraReference } from "./camera-reference-checks.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/repl/tools/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome"
  ].filter(Boolean);
  const installed = candidates.find(path => existsSync(path));
  if (installed) return installed;

  for (const command of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      return execFileSync("which", [command], { encoding: "utf8" }).trim();
    } catch {}
  }
  throw new Error("Chromium is required for the Oldtime browser regression test.");
}

async function openOwnProfile(page) {
  // Profile replaces Search in the primary navigation.
  const shortcut = page.locator('[data-testid="button-nav-profile"]');
  await shortcut.waitFor({ state: "visible" });
  await shortcut.click();
  await page.locator(".profile-screen:visible .profile-page").waitFor({ state: "visible" });
}

async function assertHomeCreateAvailable(page, pageErrors = []) {
  try {
    await page.locator(".home-screen").waitFor({ state: "visible" });
  } catch (error) {
    const browserState = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyText: document.body.innerText.slice(0, 1000),
      appClass: document.querySelector("#app")?.className || "",
      appMarkup: document.querySelector("#app")?.innerHTML.slice(0, 1200) || "",
      startupMarkup: document.querySelector("#oldtime-startup")?.outerHTML || "",
    }));
    throw new Error(`Home did not render: ${JSON.stringify({ browserState, pageErrors })}`, { cause: error });
  }
  assert.equal(await page.locator("#create-open").count(), 1,
    "Home exposes one central Create action");
  assert.equal(await page.locator("#create-open").isVisible(), true,
    "the central Create action is visible");
}

async function openCreatePreview(page) {
  await page.evaluate(() => {
    if (typeof window.__oldtimeOpenCreatePreview !== "function") {
      throw new Error("The development-only Create preview hook is unavailable.");
    }
    window.__oldtimeOpenCreatePreview();
  });
  await page.locator(".creative-editor").waitFor({ state: "visible" });
}

// Create v2 now opens a CapCut-style workspace (bottom tools + sheets + header Publish) once media exists.
// These helpers drive the VISIBLE control for whichever shell is actually rendered; legacy rails are only
// used when the workspace is not present, never force-clicked while hidden.
async function studioWorkspaceActive(page) {
  return page.locator(".cs-studio.has-workspace .cs-tools").isVisible();
}
async function openStudioTool(page, tool) {
  await page.locator(`[data-cs-tool="${tool}"]`).click();
  await page.locator(`#ce-ws-sheet[data-tool="${tool}"]`).waitFor({ state: "visible" });
}
async function chooseStudioAction(page, tool, label, legacyRail) {
  if (!(await studioWorkspaceActive(page))) return page.locator(`[data-ce-rail="${legacyRail}"]`).click();
  if (!(await page.locator(`#ce-ws-sheet[data-tool="${tool}"]`).isVisible())) await openStudioTool(page, tool);
  await page.locator("#ce-ws-sheet .cs-action", { hasText: label }).first().click();
}
async function openPublishReview(page) {
  if (await page.locator("#ce-studio-publish").isVisible()) await page.locator("#ce-studio-publish").click();
  else await page.locator("#ce-next-action").click();
  await page.locator("#ce-details").waitFor({ state: "visible" });
}
async function clickVisibleCreate(page, workspaceSelector, legacySelector) {
  await page.locator((await studioWorkspaceActive(page)) ? workspaceSelector : legacySelector).click();
}
async function ensureDiscoverySearchInput(page) {
  if (!(await page.locator("#q").isVisible())) await page.locator('[data-testid="button-header-search"]').click();
  await page.locator("#q").waitFor({ state: "visible" });
}

async function assertCreateSurfaceFillsViewport(page, state) {
  const bounds = await page.locator(".cs-studio").evaluate(editor => {
    const rect = editor.getBoundingClientRect();
    const hit = document.elementFromPoint(window.innerWidth - 3, window.innerHeight - 3);
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      coversBottomEdge: hit === editor || editor.contains(hit),
    };
  });
  assert.ok(Math.abs(bounds.top) < 2 && Math.abs(bounds.left) < 2, `${state}: Create starts at the viewport edge`);
  assert.ok(Math.abs(bounds.width - bounds.viewportWidth) < 2, `${state}: Create fills the viewport width`);
  assert.ok(Math.abs(bounds.height - bounds.viewportHeight) < 2, `${state}: Create fills the viewport height`);
  assert.equal(bounds.coversBottomEdge, true, `${state}: Create covers the app navigation at the bottom edge`);
}

const fixture = {
  session: "camera-quotes-test",
  settings: { readReceipts: true, lastSeen: "everyone" },
  users: [{
    id: "camera-quotes-test",
    username: "testmember",
    name: "Test Member",
    email: "testmember@example.test",
    password: "test-password",
    avatar: "/app/test-viewer-photo.svg",
    cover: "/app/test-profile-cover.svg",
    private: false,
    followers: [],
    following: ["story-member"],
    friends: ["story-member"],
    closeFriends: ["story-member"],
    interests: [],
    profileVisibility: { city: true, interests: true }
  }, {
    id: "story-member",
    username: "storymember",
    name: "Story Member",
    avatar: "/app/avatar.svg",
    private: false,
    followers: ["camera-quotes-test"],
    following: [],
    friends: ["camera-quotes-test"],
    closeFriends: [],
    interests: [],
    profileVisibility: { city: true, interests: true }
  }, {
    id: "story-outsider",
    username: "storyoutsider",
    name: "Story Outsider",
    avatar: "/app/avatar.svg",
    private: false,
    followers: [],
    following: [],
    friends: [],
    closeFriends: [],
    interests: [],
    profileVisibility: { city: true, interests: true }
  }, {
    id: "new-chat-member",
    username: "newchatmember",
    name: "New Chat Member",
    avatar: "/app/avatar.svg",
    private: false,
    followers: ["camera-quotes-test"],
    following: ["story-member"],
    friends: [],
    closeFriends: [],
    interests: [],
    profileVisibility: { city: true, interests: true }
  }],
  requests: [],
  friendRequests: [],
  posts: [],
  stories: [],
  convos: [{
    id: "empty-chat",
    members: ["camera-quotes-test", "new-chat-member"],
    createdAt: 1700000000000,
    messages: []
  }, {
    id: "primary-chat",
    members: ["camera-quotes-test", "story-member"],
    messages: [{ id: "primary-message", author: "story-member", body: "Primary conversation", created: 1700000000000 }]
  }, {
    id: "request-chat",
    members: ["camera-quotes-test", "story-outsider"],
    messages: [{ id: "request-message", author: "story-outsider", body: "Request conversation", created: 1700000001000 }]
  }, {
    id: "general-chat",
    members: ["camera-quotes-test", "story-member", "story-outsider"],
    group: { name: "General test group" },
    messages: [
      { id: "general-message", author: "story-member", body: "General conversation", created: 1700000002000 },
      { id: "general-outgoing", author: "camera-quotes-test", body: "hey", created: 1700000002500 },
      { id: "general-outgoing-followup", author: "camera-quotes-test", body: "again", created: 1700000003000 }
    ]
  }],
  notes: [],
  blocks: [],
  reports: [],
  campaigns: [],
  interests: {},
  resets: []
};

async function assertCompactShareLayout(page) {
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  const shareLayout = await page.locator("#ce-details").evaluate(details => {
    const body = details.querySelector(".cs-details-body");
    const footer = details.querySelector(".cs-details-foot");
    const buttons = [...details.querySelectorAll(".cs-destination-options button")];
    return {
      bodyBottom: body.getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
      destinationsFit: buttons.every(button => {
        const bounds = button.getBoundingClientRect();
        return button.scrollWidth <= button.clientWidth + 1 && [...button.children].every(child => {
          const childBounds = child.getBoundingClientRect();
          return childBounds.left >= bounds.left - 1 && childBounds.right <= bounds.right + 1;
        });
      }),
    };
  });
  assert.ok(shareLayout.bodyBottom <= shareLayout.footerTop + 1,
    "the share form scroll area stops above its fixed publish action");
  assert.equal(shareLayout.destinationsFit, true,
    "destination labels and icons fit without colliding on a narrow phone");
  const keyboardLayout = await page.locator(".cs-studio.is-create-v2").evaluate(editor => {
    editor.classList.add("is-keyboard-open");
    editor.style.setProperty("--ce-viewport-height", "360px");
    const details = editor.querySelector("#ce-details");
    const body = details.querySelector(".cs-details-body");
    const footer = details.querySelector(".cs-details-foot");
    return {
      sheetTop: details.getBoundingClientRect().top,
      sheetBottom: details.getBoundingClientRect().bottom,
      editorBottom: editor.getBoundingClientRect().bottom,
      bodyBottom: body.getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
      footerBottom: footer.getBoundingClientRect().bottom,
    };
  });
  assert.ok(keyboardLayout.sheetTop <= 10,
    "the review sheet expands to the top when the keyboard reduces the viewport");
  assert.ok(keyboardLayout.sheetBottom <= keyboardLayout.editorBottom + 1,
    "the review sheet stays inside the keyboard-visible editor area");
  assert.ok(keyboardLayout.bodyBottom <= keyboardLayout.footerTop + 1,
    "the keyboard-visible form scroll area stays above Publish");
  assert.ok(keyboardLayout.footerBottom <= keyboardLayout.editorBottom + 1,
    "Publish remains above the keyboard");
  const lastAudience = page.locator('#ce-feed-audience [data-ce-audience="close-friends"]');
  await lastAudience.scrollIntoViewIfNeeded();
  const audienceLayout = await lastAudience.evaluate(button => {
    const text = button.querySelector("span").getBoundingClientRect();
    const icon = button.querySelector("svg").getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    return { textLeft: text.left, textRight: text.right, iconRight: icon.right, boundsRight: bounds.right };
  });
  assert.ok(audienceLayout.iconRight <= audienceLayout.textLeft,
    "audience copy clears its icon at compact width");
  assert.ok(audienceLayout.textRight <= audienceLayout.boundsRight,
    "audience copy stays within its card at compact width");
  if (process.env.OLDTIME_CREATE_LAYOUT_SCREENSHOT === "1") {
    await page.screenshot({ path: "/tmp/oldtime-create-details-compact.png" });
  }
  await page.locator(".cs-studio.is-create-v2").evaluate(editor => {
    editor.classList.remove("is-keyboard-open");
    editor.style.removeProperty("--ce-viewport-height");
  });
  await page.setViewportSize(originalViewport);
}

function feedSurfaceResponse(response, surface) {
  try {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/feed") &&
      url.searchParams.get("surface") === surface &&
      response.request().method() === "GET";
  } catch {
    return false;
  }
}

async function homeForYouTimelineCard(page, postId) {
  const following = page.locator('.home-view-tab[data-home-view="following"]');
  const forYou = page.locator('.home-view-tab[data-home-view="explore"]');
  await following.waitFor({ state: "visible" });
  await forYou.waitFor({ state: "visible" });
  if (await following.getAttribute("aria-selected") !== "true") {
    const followingResponse = page.waitForResponse(response => feedSurfaceResponse(response, "following"));
    await following.click();
    await followingResponse;
  }
  const mainResponse = page.waitForResponse(response => feedSurfaceResponse(response, "main"));
  await forYou.click();
  const response = await mainResponse;
  assert.equal(response.status(), 200, `Home For You feed returned HTTP ${response.status()}`);
  const payload = await response.json();
  assert.ok(payload.posts?.some(post => post.id === postId),
    `Home For You response omitted ${postId}: ${JSON.stringify(payload.posts?.map(post => post.id))}`);
  const card = page.locator("#feed .home-feed-post-card").filter({
    has: page.locator(`[data-home-feed-open="${postId}"]`),
  });
  await card.waitFor({ state: "visible" });
  return card;
}

async function showHomeForYouPost(page, postId) {
  const card = await homeForYouTimelineCard(page, postId);
  await card.locator(`[data-home-feed-open="${postId}"]`).click();
  const viewerPost = page.locator(`.post-viewer-screen .clip[data-id="${postId}"]`);
  await viewerPost.waitFor({ state: "visible" });
  return viewerPost;
}

test(process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1"
  ? "Profile posts keep loading and viewer swipes stay in that profile"
  : process.env.OLDTIME_STORY_REPLY_ONLY === "1"
    ? "Story replies use the photo pill without dimming media"
  : process.env.OLDTIME_POST_ENGAGEMENT_ONLY === "1"
    ? "Post engagement opens real likes, views and reposts without an inline likes row"
  : process.env.OLDTIME_HOME_RENDER_ONLY === "1"
    ? "Home renders a plain feed without layers, a status tray or caught errors"
  : process.env.OLDTIME_POST_MENU_ONLY === "1"
    ? "Feed post menus open and close from their three-dot controls"
  : process.env.OLDTIME_MEDIA_CONTROLS_ONLY === "1"
    ? "Floating video stays movable and keeps its full source ratio"
  : process.env.OLDTIME_PLACES_MEDIA_ONLY === "1"
    ? "Places media uses the shared Home action row"
  : process.env.OLDTIME_REPOST_RENDER_ONLY === "1"
    ? "Home uses Profile-sized cards and opens media in its full-screen viewer"
  : process.env.OLDTIME_COMMUNITY_MEDIA_ACTIONS_ONLY === "1"
    ? "Community full-screen media hides repost and views and keeps sharing readable"
    : process.env.OLDTIME_COMMUNITY_ACTION_RENDER_ONLY === "1"
      ? "Community actions stay on one line with qualifying views"
    : "Oldtime navigation, settings, search, profile, Chat, and creation flows work in the browser", {
  timeout: 300_000
}, async () => {
  const originalPort = process.env.PORT;
  const originalBasePath = process.env.BASE_PATH;
  process.env.PORT = "5173";
  process.env.BASE_PATH = "/";

  const server = await createServer({
    configFile: resolve(packageRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false }
  });
  let browser;

  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address === "object", "Vite should listen on an available port");

    browser = await chromium.launch({
      executablePath: findChromium(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
        "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
    });
    const emulatePostMenuTouch = process.env.OLDTIME_POST_MENU_ONLY === "1" ||
      process.env.OLDTIME_REPOST_RENDER_ONLY === "1" ||
      process.env.OLDTIME_COMMUNITY_HEADER_ONLY === "1";
    const context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 402, height: 874 },
      ...(emulatePostMenuTouch ? { isMobile: true, hasTouch: true } : {}),
    });
    // This isolated rendering regression test has no API service. Real
    // authentication and draft recovery are also checked against the running app.
    const storyNow = Date.now();
    const browserStories = [{
      id: "cloud-friend-story", text: "Story viewer reference", visibility: "public", hasMedia: true, mediaType: "photo",
      savedToProfile: false, commentsEnabled: true, createdAt: storyNow - 3_600_000, expiresAt: storyNow + 80_400_000,
      author: { id: "story-member", username: "storymember", displayName: "Story Member", createdAt: storyNow - 1_000_000 }
    }, {
      id: "cloud-owner-story", text: "I WANT TO GET MARRIED", visibility: "public", hasMedia: true, mediaType: "photo",
      stickers: [{ id: "owner-trendsetters-sticker", kind: "trendsetters", title: "Prompt", prompt: "Write a prompt", x: 0.5, y: 0.15, width: 0.8, height: 0.12, rotation: 0 }],
      savedToProfile: false, commentsEnabled: true, createdAt: storyNow - 1_800_000, expiresAt: storyNow + 84_600_000,
      author: { id: fixture.session, username: "testmember", displayName: "Test Member", createdAt: storyNow - 2_000_000 }
    }];
    let publishedStory = null;
    let creationMediaReserved = false;
    let communityPostPublishingEnabled = false;
    let createdCommunityPostBody = null;
    let accountState = null;
    let closeFriendIds = ["52a126f3-8f2b-4c15-b45f-07af2853d821"];
    const closeFriendProfile = { id: "52a126f3-8f2b-4c15-b45f-07af2853d821", username: "storymember", displayName: "Story Member Online" };
    const groupMemberProfile = { id: "62a126f3-8f2b-4c15-b45f-07af2853d822", username: "groupmember", displayName: "Group Member Online" };
    const storyApiCalls = [];
    const placeDiscoveryQueries = [];
    const placeFeedQueries = [];
    const placeLikeCalls = [];
    let placePostLiked = false;
    const communityPost = {
      id: "browser-repost-post",
      sourceId: null,
      destination: "main",
      text: "A cloud-backed photo for the repost interaction test",
      visibility: "public",
      media: [{
        id: "browser-repost-media",
        contentType: "image/svg+xml",
        reference: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 800'%3E%3Crect width='400' height='800' fill='%23101116'/%3E%3Ccircle cx='200' cy='300' r='120' fill='%23e12b36'/%3E%3C/svg%3E",
      }],
      createdAt: storyNow,
      author: { id: "story-member", username: "storymember", displayName: "Story Member", joinedAt: storyNow - 1_000_000 },
      likeCount: 0,
      likedByMe: false,
      likedBy: [],
      commentCount: 2,
      topComment: {
        id: "00000000-0000-4000-8000-000000000017",
        body: "A thoughtful comment appears briefly over the video.",
        createdAt: storyNow,
        author: {
          id: "00000000-0000-4000-8000-000000000018",
          username: "savagelove",
          displayName: "Savage Love",
          joinedAt: storyNow - 1_000_000,
        },
        likeCount: 3,
      },
      saveCount: 4,
      remixSourcePostId: null,
      remixCount: 3,
      repostCount: 0,
      repostedByMe: false,
      repostNote: null,
      place: null,
      sportsCard: null,
    };
    let showRepostFixture = false;
    let communityReposted = false;
    let showProfileGridFixture = process.env.OLDTIME_PROFILE_POSTS_ONLY === "1" ||
      process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1";
    let showCommunityActionFixture = process.env.OLDTIME_COMMUNITY_ACTION_RENDER_ONLY === "1" ||
      process.env.OLDTIME_COMMUNITY_MEDIA_ACTIONS_ONLY === "1";
    let showExploreFixture = false;
    const exploreRequests = [];
    const testImageMedia = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#1856d5"/></svg>')}`;
    const testVideoMedia = `data:video/webm;base64,${readFileSync(resolve(packageRoot, "app/story-share-test.webm")).toString("base64")}`;
    const exploreFixturePosts = [{
      id: "explore-dating-humor",
      kind: "video",
      text: "Funny first date with my girlfriend",
      visibility: "public",
      media: [{ id: "explore-dating-humor-media", contentType: "video/mp4", reference: testVideoMedia, thumbnailReference: testImageMedia }],
      mediaPosters: [testImageMedia],
      createdAt: storyNow - 3_000,
      author: { id: "story-member", username: "storymember", displayName: "Story Member" },
      likeCount: 2,
      likedByMe: false,
      commentCount: 0,
      place: { id: "osm:relation:miami-beach", label: "Miami Beach", source: "osm", lat: "25.79", lon: "-80.13" },
    }, {
      id: "explore-nba",
      kind: "video",
      text: "NBA basketball highlights",
      visibility: "public",
      media: [{ id: "explore-nba-media", contentType: "video/mp4", reference: testVideoMedia, thumbnailReference: testImageMedia }],
      mediaPosters: [testImageMedia],
      createdAt: storyNow - 2_000,
      author: { id: "story-outsider", username: "storyoutsider", displayName: "Story Outsider" },
      likeCount: 3,
      likedByMe: false,
      commentCount: 0,
    }];
    const placeMediaRef = "oldtime-media:11111111-1111-4111-8111-111111111111";
    const profileGridPosts = [{
      id: "profile-grid-image", text: "", visibility: "public",
      media: [{ id: "profile-grid-image-media", contentType: "image/svg+xml", reference: testImageMedia }],
      createdAt: storyNow - 3_000, author: { id: fixture.session, username: "testmember", displayName: "Test Member" },
      likeCount: 1, likedByMe: false, commentCount: 2, saveCount: 3,
      remixSourcePostId: null, remixCount: 5, repostCount: 4, repostedByMe: false, savedByMe: false,
    }, {
      id: "profile-grid-note", text: "A thought from the test profile", visibility: "public", media: [],
      createdAt: storyNow - 2_000, author: { id: fixture.session, username: "testmember", displayName: "Test Member" },
       likeCount: 0, likedByMe: false, commentCount: 0, saveCount: 0,
      remixSourcePostId: null, remixCount: 0, repostCount: 0, repostedByMe: false, savedByMe: false,
    }, {
      id: "profile-grid-video", text: "A video in the community timeline", visibility: "public",
      media: [{ id: "profile-grid-video-media", contentType: "video/webm", reference: testVideoMedia }],
      createdAt: storyNow - 1_000, author: { id: fixture.session, username: "testmember", displayName: "Test Member" },
       likeCount: 123400000, likedByMe: false, commentCount: 9876000, saveCount: 0,
      remixSourcePostId: null, remixCount: 0, repostCount: 0, repostedByMe: false, savedByMe: false,
    }];
    const profilePaginationPosts = Array.from({ length: 12 }, (_, index) => ({
      id: `profile-scroll-${index + 1}`,
      kind: "image",
      text: `Profile scroll post ${index + 1}`,
      visibility: "public",
      media: [{
        id: `profile-scroll-media-${index + 1}`,
        contentType: "image/svg+xml",
        reference: testImageMedia,
      }],
      createdAt: storyNow - (index + 1) * 1_000,
      author: profileGridPosts[0].author,
      likeCount: 0,
      likedByMe: false,
      commentCount: 0,
      saveCount: 0,
      remixSourcePostId: null,
      remixCount: 0,
      repostCount: 0,
      repostedByMe: false,
      savedByMe: false,
    }));
    const isolateApi=route=>{
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/signup-policy" && route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            minimumInterests: 3,
            maximumInterests: 24,
            optionalOfficialFollow: true,
            interestIds: ["fitness", "running", "basketball", "yoga", "college", "nursing", "cybersecurity",
              "study-groups", "gaming", "cars", "music", "photography", "fashion", "food", "tech", "travel", "art", "pets", "beauty"],
          }),
        });
      }
      if (process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1" &&
          /^\/api\/profiles\/[^/]+\/posts$/.test(url.pathname) &&
          route.request().method() === "GET") {
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        const limit = Math.min(100, Number(url.searchParams.get("limit")) || 50);
        const posts = profilePaginationPosts.slice(offset, offset + limit);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          posts,
          postCount: profilePaginationPosts.length,
          hasMore: offset + posts.length < profilePaginationPosts.length,
          nextOffset: offset + posts.length,
        }) });
      }
      if (process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1" &&
          /^\/api\/profiles\/[^/]+\/reposts$/.test(url.pathname) &&
          route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          posts: [], hasMore: false, nextOffset: 0,
        }) });
      }
      if ((process.env.OLDTIME_PROFILE_POSTS_ONLY === "1" ||
           process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1") &&
          /^\/api\/profiles\/[^/]+$/.test(url.pathname) && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          profile: profileGridPosts[0].author,
          posts: process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1"
            ? profilePaginationPosts.slice(0, 8) : profileGridPosts,
          postCount: process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1"
            ? profilePaginationPosts.length : profileGridPosts.length,
          hasMore: process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1",
          nextOffset: process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1"
            ? 8 : profileGridPosts.length,
          stats: { followerCount: 0, followingCount: 0, viewCount: 0, likeCount: 0, saveCount: 0 },
        }) });
      }
      if (/^\/api\/media\/[0-9a-f-]+\/url$/.test(url.pathname) && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          url: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
        }) });
      }
      if (url.pathname === "/api/places/discovery" && route.request().method() === "GET") {
        const query = url.searchParams.get("q") || "";
        placeDiscoveryQueries.push(query);
        const places = [{
          place: { id: "osm:relation:miami-beach", label: "Miami Beach", source: "osm", lat: "25.7907", lon: "-80.13" },
          postCount: 12, creatorCount: 7, latestAt: storyNow, previewReference: placeMediaRef, previewType: "photo",
        }, {
          place: { id: "osm:relation:wynwood", label: "Wynwood", source: "osm", lat: 25.801, lon: -80.199 },
          postCount: 4, creatorCount: 3, latestAt: storyNow - 60_000, previewReference: null, previewType: null,
        }].filter(item => !query || item.place.label.toLowerCase().includes(query.toLowerCase()));
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          places, attribution: { text: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
        }) });
      }
      if (url.pathname === "/api/places/feed" && route.request().method() === "GET") {
        const placeId = url.searchParams.get("placeId");
        const query = url.searchParams.get("q") || "";
        const allTaggedPosts = [{
          id: "miami-place-post",
          text: "Coffee in Miami #food",
          createdAt: storyNow - 2_000,
          author: { id: fixture.session, username: "testmember", displayName: "Test Member", avatar: "/app/avatar.svg" },
          media: [{ id: "miami-place-media", contentType: "image/png", reference: placeMediaRef, thumbnailReference: null }],
          place: { id: "osm:relation:miami-beach", label: "Miami Beach", source: "osm", lat: "25.7907", lon: "-80.13" },
          likeCount: placePostLiked ? 18 : 17, likedByMe: placePostLiked, commentCount: 2,
        }, {
          id: "wynwood-place-post",
          text: "Wynwood afternoon",
          createdAt: storyNow - 1_000,
          author: { id: fixture.session, username: "testmember", displayName: "Test Member", avatar: "/app/avatar.svg" },
          media: [{ id: "wynwood-place-media", contentType: "image/png", reference: "/app/avatar.svg", thumbnailReference: null }],
          place: { id: "osm:relation:wynwood", label: "Wynwood", source: "osm", lat: 25.801, lon: -80.199 },
          likeCount: 4, commentCount: 0,
        }];
        const posts = allTaggedPosts.filter(post =>
          (!placeId || post.place.id === placeId) &&
          (!query || post.text.toLowerCase().includes(query.toLowerCase()) || post.place.label.toLowerCase().includes(query.toLowerCase())));
        placeFeedQueries.push({ placeId, query, returnedCount: posts.length });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          posts,
          hasMore: false, nextOffset: posts.length,
          attribution: { text: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
        }) });
      }
      if (url.pathname === "/api/posts/miami-place-post" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          post: {
            id: "miami-place-post",
            text: "Coffee in Miami",
            createdAt: storyNow - 2_000,
            author: { id: fixture.session, username: "testmember", displayName: "Test Member", avatar: "/app/avatar.svg" },
            media: [{ id: "miami-place-media", contentType: "image/png", reference: placeMediaRef, thumbnailReference: null }],
            place: { id: "osm:relation:miami-beach", label: "Miami Beach", source: "osm", lat: "25.7907", lon: "-80.13" },
            visibility: "public", destination: "main",
            likeCount: placePostLiked ? 18 : 17, commentCount: 2, saveCount: 0, repostCount: 0,
            likedByMe: placePostLiked, savedByMe: false, repostedByMe: false,
          },
        }) });
      }
      if (url.pathname === "/api/posts/miami-place-post/like" &&
        ["PUT", "DELETE"].includes(route.request().method())) {
        placePostLiked = route.request().method() === "PUT";
        placeLikeCalls.push(route.request().method());
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ liked: placePostLiked, likeCount: placePostLiked ? 18 : 17 }),
        });
      }
      if (url.pathname === "/api/account/state") {
        if (route.request().method() === "GET") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: accountState }) });
        }
        if (route.request().method() === "PUT") {
          accountState = route.request().postDataJSON()?.state || null;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: accountState }) });
        }
      }
      if (url.pathname === "/api/auth/me" && route.request().method() === "GET") {
        const owner = fixture.users.find(user => user.id === fixture.session);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ account: {
            id: fixture.session,
            username: owner?.username || "testmember",
            displayName: owner?.displayName || owner?.name || "Test Member",
            email: owner?.email || "testmember@example.test",
          } }),
        });
      }
      if (process.env.OLDTIME_CREATE_LAYOUT_ONLY === "1" && url.pathname === "/api/sounds/discovery") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          sounds: [{
            id: "00000000-0000-4000-8000-000000000099", title: "Trending test sound",
            author: "Oldtime creator", avatar: "", mediaReference: "https://media.test/trending-audio.mp3",
            reuseAllowed: true, available: true, owned: false, saved: false, useCount: 12,
            trending: true, createdAt: Date.now(),
          }],
          hasMore: false, nextOffset: 1,
        }) });
      }
      if (url.pathname === "/api/account/profile" && route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        const profile = {
          ...body.profile,
          username: body.username,
          displayName: body.displayName,
          profileVisibility: body.profile?.profileVisibility || { city: true, interests: true },
        };
        accountState = { ...(accountState || {}), profile };
        const owner = fixture.users.find(user => user.id === fixture.session);
        if (owner) Object.assign(owner, {
          username: body.username,
          name: body.displayName,
          displayName: body.displayName,
          email: body.email,
          ...profile,
        });
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            account: { id: fixture.session, username: body.username, displayName: body.displayName, email: body.email },
            profile,
          }),
        });
      }
      if (url.pathname === "/api/close-friends") {
        if (route.request().method() === "GET") {
          return route.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify({ profiles: closeFriendIds.includes(closeFriendProfile.id) ? [closeFriendProfile] : [] }) });
        }
        if (route.request().method() === "PUT") {
          const memberIds = route.request().postDataJSON()?.memberIds;
          if (!Array.isArray(memberIds) || memberIds.some(id => id !== closeFriendProfile.id)) {
            return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Invalid Close Friends list" }) });
          }
          closeFriendIds = [...new Set(memberIds)];
          return route.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify({ profiles: closeFriendIds.map(() => closeFriendProfile) }) });
        }
      }
      if (url.pathname === "/api/account/blocks" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profiles: [] }) });
      }
      if (url.pathname === "/api/account/professional") {
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ accountType: "personal", settings: { accountType: "personal" } }) });
      }
      if (url.pathname === "/api/analytics/me") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          overview: { views: 12, profileVisits: 3, uniqueViewers: 8, newFollowers: 2, unfollows: 0,
            netFollowers: 2, totalFollowers: 2, likes: 4, comments: 1, shares: 1, saves: 0, engagementRate: .5 },
          comparison: {}, definitions: {}, series: [], content: [{
            id: "00000000-0000-4000-8000-000000000001", title: "Analytics fixture post", kind: "photo",
            createdAt: Date.now(), views: 7, likes: 1, comments: 0, shares: 0, saves: 0,
          }], hasMore: false,
          trackingSince: new Date().toISOString(), unavailable: [],
        }) });
      }
      if (process.env.OLDTIME_HOME_RENDER_ONLY === "1" && url.pathname === "/api/discovery/trending") {
        const topics = process.env.OLDTIME_SEARCH_EXPLORE_EMPTY === "1" ? [] : [{
          topic: "long-topic-name-used-to-check-that-explore-text-wraps-on-compact-screens",
          postCount: 42, creatorCount: 9, changePercent: 25, direction: "rising",
        }];
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ topics }) });
      }
      if (process.env.OLDTIME_HOME_RENDER_ONLY === "1" && url.pathname === "/api/community/lists" &&
          route.request().method() === "GET") {
        const lists = process.env.OLDTIME_SEARCH_EXPLORE_EMPTY === "1" ? [] : [{
          id: "22222222-2222-4222-8222-222222222222",
          name: "A public feed with a deliberately long title to check text wrapping",
          description: "Creator-written feed description for the compact Search Explore layout.",
          isPublic: true, owned: false, followed: false,
          owner: { id: "33333333-3333-4333-8333-333333333333", username: "testcreator", displayName: "Test Creator" },
          members: [{ id: "33333333-3333-4333-8333-333333333333", username: "testcreator", displayName: "Test Creator" }],
        }];
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lists }) });
      }
      if (process.env.OLDTIME_HOME_RENDER_ONLY === "1" && url.pathname === "/api/community/preferences") {
        if (route.request().method() === "GET") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
            preferences: { pinned: ["following"], filters: {}, mutedWords: [], mutedAccounts: [] }, mutedAccounts: [],
          }) });
        }
        if (route.request().method() === "PUT") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
            preferences: route.request().postDataJSON(), mutedAccounts: [],
          }) });
        }
      }
      if (url.pathname === "/api/discovery/explore" && route.request().method() === "GET") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const topic = url.searchParams.get("topic") || "";
        exploreRequests.push(url.search);
        const topicOf = post => /date|girlfriend/i.test(post.text) ? "dating-humor" : /nba/i.test(post.text) ? "nba" : "";
        const posts = exploreFixturePosts.filter(post => (!q || post.text.toLowerCase().includes(q) ||
          (post.place?.label || "").toLowerCase().includes(q)) && (!topic || topicOf(post) === topic));
        const availableTopics = [{ id: "dating-humor", label: "Dating humor", postCount: 1 }, { id: "nba", label: "NBA", postCount: 1 }];
        const topics = availableTopics.filter(item => !q || item.label.toLowerCase().includes(q) ||
          posts.some(post => topicOf(post) === item.id));
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          posts, people: process.env.OLDTIME_HOME_RENDER_ONLY === "1"
            ? Array.from({ length: 4 }, (_, index) => ({ ...closeFriendProfile, id: `layout-person-${index}`, username: `layoutperson${index}` }))
              .filter(person => !q || `${person.displayName} ${person.username}`.toLowerCase().includes(q))
            : ((!q && url.searchParams.get("type")==="people") || q.replace(/^@/,"")==="storymember") ? [closeFriendProfile] : [],
          places: q.includes("miami") ? [{
            place: { id: "osm:relation:miami-beach", label: "Miami Beach", source: "osm", lat: "25.7907", lon: "-80.13" },
            postCount: 12, previewReference: placeMediaRef, previewType: "photo",
          }] : [],
          hashtags: [],
          topics,
          topicOptions: [{ id: "nba", label: "NBA" }], emergingTopics: [], relatedSearches: [],
          postTopics: posts.map(post => ({ postId: post.id, topics: topicOf(post) ? [{ id: topicOf(post), label: topicOf(post), confidence: 1 }] : [], excludedTopics: [] })),
          preferences: { hiddenTopics: [], personalize: true }, correctedQuery: null,
          hasMore: false, nextOffset: posts.length, algorithmVersion: "test",
        }) });
      }
      if ((showProfileGridFixture || showCommunityActionFixture || process.env.OLDTIME_COMMUNITY_HEADER_ONLY === "1") &&
          url.pathname === "/api/community/preferences" && route.request().method() === "GET") {
        const preferences = {
          pinned: ["following", "discover", "popular", "friends"],
          filters: {}, mutedWords: [], mutedAccounts: [], caughtUp: {},
        };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          preferences, mutedAccounts: [],
        }) });
      }
      if ((showProfileGridFixture || showCommunityActionFixture || process.env.OLDTIME_COMMUNITY_HEADER_ONLY === "1") &&
          url.pathname === "/api/community/lists" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lists: [] }) });
      }
      if (showCommunityActionFixture && url.pathname === "/api/community/feed" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          posts: [{ ...communityPost, repostCount: communityReposted ? 1 : 0, repostedByMe: communityReposted }],
          hasMore: false, nextOffset: 1, reason: null, reasons: {}, caughtUpAt: null,
        }) });
      }
      if (showProfileGridFixture && url.pathname === "/api/community/feed" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          posts: profileGridPosts, hasMore: false, nextOffset: profileGridPosts.length,
          reason: null, reasons: {}, caughtUpAt: null,
        }) });
      }
      if (showProfileGridFixture && /^\/api\/community\/profile\/[^/]+$/.test(url.pathname) &&
          route.request().method() === "GET") {
        const posts = profileGridPosts.filter(post => post.id === "profile-grid-note");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          posts, hasMore: false, nextOffset: posts.length,
        }) });
      }
      if (url.pathname === "/api/feed" && route.request().method() === "GET") {
        if (showExploreFixture && url.searchParams.get("surface") === "main") {
          return route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify({ posts: exploreFixturePosts, hasMore: false, nextOffset: exploreFixturePosts.length }),
          });
        }
        if (showProfileGridFixture) {
          return route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify({ posts: profileGridPosts, hasMore: false, nextOffset: profileGridPosts.length }),
          });
        }
        return route.fulfill({
          status: showRepostFixture ? 200 : 503,
          contentType: "application/json",
          body: JSON.stringify(showRepostFixture
            ? { posts: process.env.OLDTIME_COMMUNITY_HEADER_ONLY === "1"
              ? [communityPost, { ...communityPost, id: "browser-repost-post-2", text: "A second community photo" },
                { ...communityPost, id: "browser-repost-post-3", text: "A third community photo" }]
                : process.env.OLDTIME_REPOST_RENDER_ONLY === "1"
                  ? [communityPost, {
                    ...communityPost,
                    id: "browser-repost-post-grid-peer",
                    text: "A second media card for grid layout coverage",
                    media: communityPost.media.map(media => ({ ...media, id: "browser-repost-media-grid-peer" })),
                    createdAt: communityPost.createdAt - 1_000,
                  }]
              : [{
              ...communityPost,
              repostCount: communityReposted ? 1 : 0,
              repostedByMe: communityReposted,
              repostNote: null,
              }], hasMore: false, nextOffset: process.env.OLDTIME_REPOST_RENDER_ONLY === "1" ? 2 : 1 }
            : { error: "API unavailable in the isolated rendering test" }),
        });
      }
      if (/^\/api\/posts\/browser-repost-post\/(likes|reposts)$/.test(url.pathname) &&
          route.request().method() === "GET") {
        const kind = url.pathname.endsWith("/reposts") ? "reposts" : "likes";
        const people = kind === "likes" ? [{
          id: "00000000-0000-4000-8000-000000000018",
          username: "storymember", displayName: "Story Member", avatar: testImageMedia,
        }, {
          id: "00000000-0000-4000-8000-000000000019",
          username: "miyafan", displayName: "Miya Fan", avatar: testImageMedia,
        }] : [{
          id: "00000000-0000-4000-8000-000000000020",
          username: "reposter", displayName: "Repost Person", avatar: testImageMedia,
        }];
        const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        const page = people.slice(offset, offset + limit);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            [kind]: page,
            total: people.length,
            hasMore: offset + page.length < people.length,
            nextOffset: offset + page.length,
          }),
        });
      }
      if (/^\/api\/posts\/explore-(dating-humor|nba)$/.test(url.pathname) && route.request().method() === "GET") {
        const postId = url.pathname.split("/").at(-1);
        const post = exploreFixturePosts.find(item => item.id === postId);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ post }) });
      }
      if (/^\/api\/posts\/profile-grid-[^/]+\/like$/.test(url.pathname)) {
        const liked = route.request().method() === "PUT";
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ liked, likeCount: liked ? 1 : 0 }),
        });
      }
      if (/^\/api\/posts\/profile-grid-[^/]+$/.test(url.pathname) && route.request().method() === "GET") {
        const postId = url.pathname.split("/").at(-1);
        const post = profileGridPosts.find(item => item.id === postId);
        if (!post) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Post not found." }) });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ post }) });
      }
      if (/^\/api\/posts\/profile-grid-[^/]+$/.test(url.pathname) && route.request().method() === "PATCH") {
        const postId = url.pathname.split("/").at(-1);
        const post = profileGridPosts.find(item => item.id === postId);
        if (!post) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Post not found." }) });
        const body = route.request().postDataJSON();
        post.text = body.text;
        post.place = body.place;
        post.visibility = body.visibility ?? post.visibility ?? "public";
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ post }) });
      }
      if (url.pathname === `/api/posts/${communityPost.id}/repost`) {
        if (route.request().method() === "PUT") {
          communityReposted = true;
          const note = route.request().postDataJSON()?.note || "";
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ reposted: true, repostCount: 1, note }),
          });
        }
        if (route.request().method() === "DELETE") {
          communityReposted = false;
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ reposted: false, repostCount: 0, note: null }),
          });
        }
      }
      if (url.pathname === "/api/account/privacy") {
        storyApiCalls.push(`${route.request().method()} ${url.pathname}`);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isPrivate: false, initialized: true }) });
      }
      if (url.pathname === "/api/relationships/import-legacy" && route.request().method() === "POST") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ imported: true, migratedTargets: 0 }) });
      }
      if (url.pathname === "/api/relationships" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          following: [{ id: "story-member", username: "storymember", displayName: "Story Member" }],
          followers: [], friends: [
            { id: "story-member", username: "storymember", displayName: "Story Member" },
            closeFriendProfile,
          ], incomingFriendRequests: [],
          outgoingFriendRequests: [], incomingFollowRequests: [], outgoingFollowRequests: []
        }) });
      }
      if (url.pathname === "/api/chats" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chats: [] }) });
      }
      if (url.pathname === "/api/chats/preferences" && route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ preferences: { directMessages: "everyone", groupInvites: "everyone", readReceipts: true } }),
        });
      }
      if (url.pathname === "/api/chats/legacy-archives" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ archives: [] }) });
      }
      if (url.pathname === "/api/creative/drafts" && route.request().method() === "DELETE") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ deletedDrafts: 0, mediaIds: [] }),
        });
      }
      if (url.pathname.startsWith("/api/creative/drafts/")) {
        if (route.request().method() === "GET") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ draft: null }) });
        }
        if (route.request().method() === "DELETE") return route.fulfill({ status: 204, body: "" });
        if (route.request().method() === "PUT") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, updatedAt: Date.now() }) });
        }
      }
      if (/^\/api\/stories\/[^/]+\/media$/.test(url.pathname) && route.request().method() === "GET") {
        return route.fulfill({
          status: 200, contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><rect width="400" height="800" fill="#343434"/><circle cx="200" cy="300" r="120" fill="#e5262f"/></svg>'
        });
      }
      if (/^\/api\/stories\/[^/]+\/views$/.test(url.pathname) && route.request().method() === "POST") {
        storyApiCalls.push("POST Story view");
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ recorded: true }) });
      }
      if (/^\/api\/stories\/[^/]+\/reactions$/.test(url.pathname) && route.request().method() === "PUT") {
        storyApiCalls.push("PUT Story reaction");
        const emoji = route.request().postDataJSON().emoji;
        if (url.pathname.includes("/cloud-owner-story/")) {
          return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "You can't react to your own Story." }) });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reaction: { emoji, createdAt: Date.now() } }) });
      }
      if (/^\/api\/stories\/[^/]+\/reactions$/.test(url.pathname) && route.request().method() === "DELETE") {
        storyApiCalls.push("DELETE Story reaction");
        return route.fulfill({ status: 204, body: "" });
      }
      if (/^\/api\/stories\/[^/]+\/activity$/.test(url.pathname) && route.request().method() === "GET") {
        storyApiCalls.push("GET Story activity");
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ viewCount: 1, reactionCount: 1, viewers: [{
            id: "story-member", username: "storymember", displayName: "Story Member", viewedAt: Date.now(), reaction: "😂"
          }] })
        });
      }
      if (/^\/api\/stories\/[^/]+\/comments$/.test(url.pathname) && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ comments: [] }) });
      }
      if (/^\/api\/stories\/[^/]+\/comments$/.test(url.pathname) && route.request().method() === "POST") {
        const body = route.request().postDataJSON().body;
        return route.fulfill({
          status: 201, contentType: "application/json",
          body: JSON.stringify({ comment: {
            id: "browser-story-reply", body, createdAt: Date.now(),
            author: { id: fixture.session, username: "testmember", displayName: "Test Member" }
          } })
        });
      }
      if (/^\/api\/stories\/[^/]+\/comments\/[^/]+$/.test(url.pathname) && route.request().method() === "DELETE") {
        return route.fulfill({ status: 204, body: "" });
      }
      if (/^\/api\/stories\/[^/]+\/media-url$/.test(url.pathname)) {
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC" }),
        });
      }
      if (/^\/api\/media\/[^/]+\/upload$/.test(url.pathname) && route.request().method() === "POST") {
        creationMediaReserved = true;
        return route.fulfill({
          status: 201, contentType: "application/json",
          body: JSON.stringify({ ready: true }),
        });
      }
      if (/^\/api\/media\/[^/]+\/thumbnail$/.test(url.pathname) && route.request().method() === "PUT") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ attached: true }) });
      }
      if (url.pathname === "/api/posts" && route.request().method() === "POST") {
        if (!communityPostPublishingEnabled) {
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "API unavailable in isolated rendering test" }) });
        }
        createdCommunityPostBody = route.request().postDataJSON();
        const post = {
          id: "cloud-community-note",
          sourceId: null,
          text: createdCommunityPostBody.text,
          visibility: "public",
          destination: createdCommunityPostBody.destination,
          media: (createdCommunityPostBody.mediaIds || []).map(id => ({
            id, contentType: "image/png", reference: `oldtime-media:${id}`,
          })),
          createdAt: Date.now(),
          author: { id: fixture.session, username: "testmember", displayName: "Test Member", joinedAt: storyNow - 2_000_000 },
          likeCount: 0, likedByMe: false, likedBy: [], repostCount: 0, repostedByMe: false, repostNote: null,
          place: null, sportsCard: null,
        };
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ post }) });
      }
      if (url.pathname === "/api/stories" && route.request().method() === "GET") {
        storyApiCalls.push("GET /api/stories");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stories: [...browserStories, ...(publishedStory ? [publishedStory] : [])] }) });
      }
      if (/^\/api\/stories\/[^/]+\/media-url$/.test(url.pathname) && route.request().method() === "GET") {
        const storyId = url.pathname.split("/")[3];
        const story = browserStories.find(item => item.id === storyId);
        if (!story?.hasMedia) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Story media is unavailable." }) });
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({
            url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 3'%3E%3Crect width='2' height='3' fill='%23dce0e4'/%3E%3C/svg%3E",
            thumbnailUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 3'%3E%3Crect width='2' height='3' fill='%23dce0e4'/%3E%3C/svg%3E",
          }),
        });
      }
      if (url.pathname === "/api/stories" && route.request().method() === "POST") {
        storyApiCalls.push("POST /api/stories");
        const input = route.request().postDataJSON();
        publishedStory = {
          id: "cloud-created-story", text: input.text, visibility: input.visibility,
          hasMedia: Boolean(input.mediaType), mediaType: input.mediaType,
          savedToProfile: false, createdAt: Date.now(), expiresAt: Date.now() + 86400000,
          author: { id: fixture.session, username: "testmember", displayName: "Test Member", createdAt: Date.now() }
        };
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ story: publishedStory }) });
      }
      if (url.pathname === "/api/stories/cloud-created-story" && route.request().method() === "DELETE") {
        publishedStory = null;
        return route.fulfill({ status: 204, body: "" });
      }
      if (url.pathname.endsWith("/api/users/search")) {
        const query = url.searchParams.get("q")?.toLowerCase() || "";
        const users = [closeFriendProfile, groupMemberProfile]
          .filter(profile => query && profile.username.includes(query))
          .map(profile => ({ ...profile, joinedAt: 1700000000000 }));
        return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({users})});
      }
      return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"API unavailable in isolated rendering test"})});
    };
    await context.route("**/api/**",isolateApi);
    if (process.env.OLDTIME_REPOST_RENDER_ONLY === "1") {
      fixture.users.find(user => user.id === fixture.session).following = ["story-member"];
    }
    await context.addInitScript(state => {
      if (!localStorage.getItem("oldtime-v1")) {
        localStorage.setItem("oldtime-v1", JSON.stringify(state));
      }
      sessionStorage.clear();
      sessionStorage.setItem("oldtime-cloud-session-v1",JSON.stringify({
        account:{id:state.session},accessToken:"a".repeat(43),expiresAt:Date.now()+600_000
      }));
      window.__getUserMediaCalls = 0;
      window.__lastStoryShare = null;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async data => { window.__lastStoryShare = data; }
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            window.__getUserMediaCalls++;
            throw new DOMException("Camera permission denied for this test", "NotAllowedError");
          }
        }
      });
    }, fixture);

    const page = await context.newPage();
    let nextDialogAction = "accept";
    page.on("dialog", async dialog => {
      const action = nextDialogAction;
      nextDialogAction = "accept";
      if (action === "dismiss") await dialog.dismiss();
      else await dialog.accept();
    });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.stack || error.message));
    page.on("console", message => {
      if (message.type() === "error" && message.text().startsWith("An Oldtime screen could not be rendered.")) {
        pageErrors.push(message.text());
      }
    });
    if (process.env.OLDTIME_POST_MENU_ONLY === "1" ||
        process.env.OLDTIME_REPOST_RENDER_ONLY === "1" ||
        process.env.OLDTIME_POST_ENGAGEMENT_ONLY === "1" ||
        process.env.OLDTIME_SHARE_SEND_ICON_ONLY === "1" ||
        process.env.OLDTIME_COMMUNITY_MEDIA_ACTIONS_ONLY === "1" ||
        process.env.OLDTIME_COMMUNITY_ACTION_RENDER_ONLY === "1") showRepostFixture = true;
    if (process.env.OLDTIME_POST_ENGAGEMENT_ONLY === "1") {
      communityPost.likeCount = 2;
      communityPost.measuredViews = 120;
      communityPost.repostCount = 1;
      communityPost.author.avatar = testImageMedia;
    }
    if (process.env.OLDTIME_COMMUNITY_ACTION_RENDER_ONLY === "1" ||
        process.env.OLDTIME_COMMUNITY_MEDIA_ACTIONS_ONLY === "1") {
      communityPost.measuredViews = 120;
    }
    if (process.env.OLDTIME_REPOST_RENDER_ONLY === "1" || process.env.OLDTIME_POST_MENU_ONLY === "1") {
      communityPost.author.avatar = testImageMedia;
    }
    await page.goto(`http://127.0.0.1:${address.port}/?create-editor=v2`, { waitUntil: "networkidle" });
    await assertHomeCreateAvailable(page, pageErrors);
    await page.locator(".home-screen #feed").waitFor({ state: "visible" });
    if (process.env.OLDTIME_NOTIFICATION_STYLE_ONLY === "1") {
      await page.locator("#notifications-open").click();
      await page.locator(".notifications-screen .notifications-header").waitFor({ state: "visible" });
      const notificationStyle = await page.locator(".notifications-screen").evaluate(screen => {
        const page = screen.querySelector(".page");
        const insights = screen.querySelector(".notification-insights-button");
        const buttonColors = [...screen.querySelectorAll("button")].map(button => getComputedStyle(button).color);
        const blueButtonTextColors = buttonColors.filter(color => {
          const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return match && Number(match[3]) - Number(match[1]) > 28 && Number(match[3]) - Number(match[2]) > 10;
        });
        return {
          surface: getComputedStyle(screen).backgroundColor,
          page: getComputedStyle(page).backgroundColor,
          insightsText: getComputedStyle(insights).color,
          blueButtonTextColors,
        };
      });
      assert.equal(notificationStyle.surface, "rgb(255, 255, 255)", JSON.stringify(notificationStyle));
      assert.equal(notificationStyle.page, "rgb(255, 255, 255)", JSON.stringify(notificationStyle));
      assert.equal(notificationStyle.insightsText, "rgb(36, 37, 42)", JSON.stringify(notificationStyle));
      assert.deepEqual(notificationStyle.blueButtonTextColors, [], JSON.stringify(notificationStyle));
      if (process.env.OLDTIME_NOTIFICATION_STYLE_SCREENSHOT === "1") {
        await page.screenshot({ path: "/tmp/oldtime-notifications-white.png", fullPage: true });
      }
      return;
    }
    if (process.env.OLDTIME_CHAT_UI_ONLY === "1") {
      await page.locator('.nav [data-tab="chat"]').click();
      await page.locator(".chat-list-screen").waitFor({ state: "visible" });
      assert.equal(await page.locator(".chat-list-screen .cic, .chat-list-screen #cic-track").count(), 0,
        "Messages has no Story/avatar rail");
      const headerLayout = await page.evaluate(() => {
        const title = document.querySelector(".chat-title").getBoundingClientRect();
        const picker = document.querySelector("#chat-list-picker-toggle");
        const action = picker.getBoundingClientRect();
        return {
          titleCenter: Math.abs(title.left + title.width / 2 - window.innerWidth / 2),
          titleRight: title.right,
          pickerLeft: action.left,
          pickerRight: action.right,
          lineDelta: Math.abs(title.top + title.height / 2 - action.top - action.height / 2),
          icon: picker.querySelector("svg")?.getAttribute("data-icon"),
          color: getComputedStyle(picker).color,
          background: getComputedStyle(picker).backgroundColor,
        };
      });
      assert.ok(headerLayout.titleCenter < 2, `Messages is centered: ${JSON.stringify(headerLayout)}`);
      assert.ok(headerLayout.pickerLeft >= headerLayout.titleRight - 1,
        `the picker sits on the opposite side: ${JSON.stringify(headerLayout)}`);
      assert.ok(headerLayout.lineDelta < 10, `title and picker share one line: ${JSON.stringify(headerLayout)}`);
      assert.equal(headerLayout.icon, "compose", "the message picker uses the compose icon");
      assert.equal(headerLayout.color, "rgb(23, 25, 28)", "the compose icon is black");
      assert.equal(headerLayout.background, "rgba(0, 0, 0, 0)", "the compose icon has no background");
      await page.locator("#chat-list-picker-toggle").click();
      await page.locator("#chat-more-menu").waitFor({ state: "visible" });
      const actionFocus = await page.locator("#newchat").evaluate(element => {
        element.focus();
        const style = getComputedStyle(element);
        return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
      });
      assert.equal(actionFocus.outlineStyle, "none", "Message actions do not show a black focus selector");
      assert.equal(actionFocus.boxShadow, "none");
      if (process.env.OLDTIME_CHAT_SCREENSHOTS) {
        await page.waitForTimeout(300);
        await page.screenshot({ path: "/tmp/oldtime-chat-actions-open.png" });
      }
      assert.equal(await page.locator("#newchat").isVisible(), true);
      assert.equal(await page.locator("#chat-more").isVisible(), true);
      assert.equal(await page.locator("#chat-add-story").isVisible(), true);
      assert.equal(await page.locator("#chat-add-note").isVisible(), true);
      assert.equal(await page.locator(".chat-option, .chat-sheet-folders, .chat-organize-card, [data-more-filter], [data-inbox-folder]").count(), 0,
        "Filters and Folders are removed from the picker");
      const pickerLayer = await page.locator("#chat-more-menu").evaluate(menu => {
        const sheet = document.querySelector("#sheet");
        const nav = document.querySelector(".nav");
        const navBox = nav.getBoundingClientRect();
        const topLayer = document.elementFromPoint(navBox.left + navBox.width / 2, navBox.top + navBox.height / 2);
        return {
          parentId: menu.parentElement?.id,
          sheetZ: Number.parseInt(getComputedStyle(sheet).zIndex, 10),
          navZ: Number.parseInt(getComputedStyle(nav).zIndex, 10),
          navVisibility: getComputedStyle(nav).visibility,
          navCovered: Boolean(topLayer?.closest("#sheet")),
        };
      });
      assert.equal(pickerLayer.parentId, "sheet", "message actions are mounted outside the transformed Messages screen");
      assert.ok(pickerLayer.sheetZ > pickerLayer.navZ, `the sheet stacks above navigation: ${JSON.stringify(pickerLayer)}`);
      assert.equal(pickerLayer.navVisibility, "hidden", "the open modal sheet hides navigation instead of letting it overlap the actions");
      assert.equal(pickerLayer.navCovered, true, "the open message sheet covers the bottom navigation");
      const pickerHandle = await page.locator("#chat-more-menu .chat-filter-sheet-handle").boundingBox();
      assert.ok(pickerHandle);
      const compactPickerHeight = await page.locator("#chat-more-menu").evaluate(menu => menu.getBoundingClientRect().height);
      await page.mouse.move(pickerHandle.x + pickerHandle.width / 2, pickerHandle.y + pickerHandle.height / 2);
      await page.mouse.down();
      await page.mouse.move(pickerHandle.x + pickerHandle.width / 2, pickerHandle.y + pickerHandle.height / 2 - 150, { steps: 6 });
      await page.mouse.up();
      const expandedPicker = await page.locator("#chat-more-menu").evaluate(menu => ({
        expanded: menu.classList.contains("is-expanded"),
        height: menu.getBoundingClientRect().height,
      }));
      assert.equal(expandedPicker.expanded, true, "an upward drag expands the message action sheet");
      assert.ok(expandedPicker.height > compactPickerHeight + 80,
        `the expanded message sheet has visible height: ${JSON.stringify(expandedPicker)}`);
      await page.waitForTimeout(250);
      const expandedPickerHandle = await page.locator("#chat-more-menu .chat-filter-sheet-handle").boundingBox();
      await page.mouse.move(expandedPickerHandle.x + expandedPickerHandle.width / 2, expandedPickerHandle.y + expandedPickerHandle.height / 2);
      await page.mouse.down();
      const pickerDragStarted = await page.locator("#chat-more-menu").evaluate(menu => menu.classList.contains("is-dragging"));
      const pickerDragHit = await page.evaluate(({ x, y }) => {
        const menu = document.querySelector("#chat-more-menu");
        const handle = menu.querySelector(".chat-filter-sheet-handle");
        const target = document.elementFromPoint(x, y);
        const menuRect = menu.getBoundingClientRect();
        const handleRect = handle.getBoundingClientRect();
        return {
          target: target?.className?.baseVal || target?.className || target?.tagName,
          targetInMenu: Boolean(target && menu.contains(target)),
          panelTop: menuRect.top,
          pointerY: y,
          handleTop: handleRect.top,
          handleHeight: handleRect.height,
          computedHeight: getComputedStyle(handle).height,
          computedPosition: getComputedStyle(handle).position,
          computedTransform: getComputedStyle(handle).transform,
          pointerEvents: getComputedStyle(handle).pointerEvents,
          inApp: document.querySelector("#app").contains(handle),
        };
      }, { x: expandedPickerHandle.x + expandedPickerHandle.width / 2, y: expandedPickerHandle.y + expandedPickerHandle.height / 2 });
      await page.mouse.move(expandedPickerHandle.x + expandedPickerHandle.width / 2, expandedPickerHandle.y + expandedPickerHandle.height / 2 + 190, { steps: 6 });
      const pickerDragProgress = await page.locator("#chat-more-menu").evaluate(menu => ({
        dragging: menu.classList.contains("is-dragging"),
        transform: menu.style.transform,
      }));
      await page.mouse.up();
      assert.equal(pickerDragStarted, true, `the action handle starts a drag: ${JSON.stringify(pickerDragHit)}`);
      assert.match(pickerDragProgress.transform, /translateY\(190px\)/, `the sheet tracks downward movement: ${JSON.stringify(pickerDragProgress)}`);
      assert.equal(await page.locator("#chat-more-menu").evaluate(menu => menu.classList.contains("is-expanded")), false,
        "a downward drag collapses an expanded message action sheet before dismissing it");
      await page.waitForTimeout(250);
      const collapsedPickerHandle = await page.locator("#chat-more-menu .chat-filter-sheet-handle").boundingBox();
      await page.mouse.move(collapsedPickerHandle.x + collapsedPickerHandle.width / 2, collapsedPickerHandle.y + collapsedPickerHandle.height / 2);
      await page.mouse.down();
      await page.mouse.move(collapsedPickerHandle.x + collapsedPickerHandle.width / 2, collapsedPickerHandle.y + collapsedPickerHandle.height / 2 + 200, { steps: 6 });
      await page.mouse.up();
      await page.locator("#chat-more-menu").waitFor({ state: "hidden" });
      await page.locator("#chat-list-picker-toggle").click();
      await page.locator("#chat-more").click();
      await page.locator(".chat-settings-choice[data-chat-choice='directMessages']").first().waitFor({ state: "visible" });
      const settingsText = await page.locator(".chat-settings-screen").innerText();
      assert.doesNotMatch(settingsText, /\bFilters\b|\bFolders\b/);
      assert.equal(await page.locator("[data-chat-saved]").count(), 1, "Saved messages remain available without the folder UI");
      return;
    }
    if (process.env.OLDTIME_PROFILE_PAGINATION_ONLY === "1") {
      const profilePageResponses = [];
      page.on("response", response => {
        try {
          const url = new URL(response.url());
          if (url.pathname.startsWith("/api/profiles/testmember/")) {
            profilePageResponses.push({
              path: url.pathname,
              offset: url.searchParams.get("offset"),
              status: response.status(),
            });
          }
        } catch {}
      });
      await openOwnProfile(page);
      const firstPageCards = page.locator("#profile-content-grid .profile-post-card");
      await page.waitForFunction(() => document.querySelectorAll("#profile-content-grid .profile-post-card").length === 8);
      assert.equal(await firstPageCards.count(), 8, "the first profile page renders its first batch");
      await page.locator('#profile-content-grid [data-profile-infinite="posts"]').waitFor({ state: "attached" });
      for (let attempt = 0; attempt < 6 &&
          !profilePageResponses.some(response => response.path.endsWith("/posts") && response.offset === "8"); attempt++) {
        await page.locator(".profile-screen .profile-page").evaluate(element => {
          element.scrollTop = element.scrollHeight;
        });
        await page.waitForTimeout(350);
      }
      await page.waitForFunction(() => document.querySelectorAll("#profile-content-grid .profile-post-card").length >= 12, null, { timeout: 5_000 });
      assert.ok(profilePageResponses.some(response => response.offset === "8" && response.status === 200),
        `scrolling loads the next profile page: ${JSON.stringify(profilePageResponses)}`);
      const profilePostIds = await page.locator("#profile-content-grid [data-open]").evaluateAll(elements =>
        elements.map(element => element.dataset.open)
      );
      assert.deepEqual(profilePostIds.filter(id => id.startsWith("profile-scroll-")),
        profilePaginationPosts.map(post => post.id),
        "the profile timeline appends posts from its own next page in order");
      assert.equal(await page.locator('#profile-content-grid [data-profile-infinite="posts"]').count(), 0,
        "the profile shows no more-posts control after the server reports the end");
      await page.locator('#profile-content-grid [data-open="profile-scroll-1"]').click();
      await page.locator(".post-viewer-screen").waitFor({ state: "visible" });
      const viewerPostIds = await page.locator(".post-viewer-screen .clip[data-id]").evaluateAll(elements =>
        elements.map(element => element.dataset.id)
      );
      assert.ok(viewerPostIds.length > 0 && viewerPostIds.every(id => profilePostIds.includes(id)),
        `profile viewer swipes stay inside that profile: ${JSON.stringify({ profilePostIds, viewerPostIds })}`);
      await page.screenshot({ path: "/tmp/oldtime-profile-infinite-scroll.png" });
      await page.locator("#post-viewer-back").click();
      assert.equal(await page.locator(".profile-screen:visible").count(), 1,
        "closing profile media returns to the same profile");
      assert.deepEqual(pageErrors, [], pageErrors.join("\n"));
      return;
    }
    if (process.env.OLDTIME_SIGNUP_RENDER_ONLY === "1") {
      const signupContext = await browser.newContext({ viewport: { width: 402, height: 874 } });
      await signupContext.route("**/api/**", isolateApi);
      let submittedSignup = null;
      await signupContext.route("**/api/auth/register", async route => {
        submittedSignup = route.request().postDataJSON();
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ verificationRequired: true, message: "Check your email to finish claiming the official account." }),
        });
      });
      const signupPage = await signupContext.newPage();
      await signupPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
      await signupPage.locator("#signup").click();
      await signupPage.locator("#signup-form").waitFor({ state: "visible" });
      await signupPage.locator("#su-first").fill("Oldtime");
      await signupPage.locator("#su-last").fill("Official");
      await signupPage.locator(".signup-step:not([hidden]) .signup-next").click();
      await signupPage.locator("#su-email").fill("starter@example.com");
      await signupPage.locator("#su-user").fill("Oldtime");
      await signupPage.locator(".signup-step:not([hidden]) .signup-next").click();
      await signupPage.locator("#su-birthday").fill("2000-01-01");
      await signupPage.locator(".signup-step:not([hidden]) .signup-next").click();
      await signupPage.locator(".signup-interest-dropdown > summary").click();
      const interests = signupPage.locator("[data-signup-interest]");
      const choices = await interests.evaluateAll(buttons => buttons.slice(0, 3).map(button => button.dataset.signupInterest));
      for (let index = 0; index < choices.length; index++) await interests.nth(index).click();
      await signupPage.locator(".signup-step:not([hidden]) .signup-next").click();
      await signupPage.locator("#su-pass").fill("ValidPass123!");
      await signupPage.locator("#go").click();
      await signupPage.waitForFunction(() =>
        Boolean(document.querySelector("#signup-status")?.textContent.trim() || document.querySelector("#err")?.textContent.trim()),
        null,
        { timeout: 20000 }
      ).catch(() => {});
      const signupState = await signupPage.evaluate(() => ({
        status: document.querySelector("#signup-status")?.textContent.trim() || "",
        error: document.querySelector("#err")?.textContent.trim() || "",
        buttonText: document.querySelector("#go")?.textContent.trim() || "",
      }));
      assert.match(signupState.status, /verification/i,
        `signup did not complete: ${JSON.stringify(signupState)}; payload=${JSON.stringify(submittedSignup)}`);
      assert.deepEqual(submittedSignup?.interests, choices);
      assert.equal(submittedSignup?.followOldtime, false);
      await signupContext.close();
      return;
    }
    assert.equal(await page.locator(".home-hub-shelf,.home-stories,[data-home-story-author]").count(), 0);
    assert.equal(await page.locator(".screen-retry").count(), 0, "Home must render rather than its caught-error fallback");
    assert.equal(await page.locator("#feed").evaluate(element => getComputedStyle(element).transform), "none");
    assert.deepEqual(pageErrors, [], "caught rendering errors must fail the browser regression too");
    if (process.env.OLDTIME_SHARE_SEND_ICON_ONLY === "1") {
      const homePost = await showHomeForYouPost(page, "browser-repost-post");
      await homePost.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(150);
      await homePost.locator(".media-action-row [data-share]").click();
      await page.locator("[data-share-messages]").click();
      const firstContact = page.locator("[data-share-friend]:not(:disabled)").first();
      await firstContact.waitFor({ state: "visible" });
      await firstContact.check({ force: true });
      const sendButton = page.locator("[data-share-submit]");
      await sendButton.waitFor({ state: "visible" });
      const sendGeometry = await sendButton.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const field = button.closest(".srp-compose-field");
        const fieldRect = field.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          insideField: rect.left >= fieldRect.left && rect.right <= fieldRect.right
            && rect.top >= fieldRect.top && rect.bottom <= fieldRect.bottom,
          label: button.getAttribute("aria-label"),
          text: button.innerText.trim(),
          iconCount: button.querySelectorAll(".srp-send-icon .navic").length,
          panelBackground: getComputedStyle(button.closest(".share-recipient-panel")).backgroundColor,
          composeBackground: getComputedStyle(button.closest(".srp-compose")).backgroundColor,
          inputColor: getComputedStyle(field.querySelector("textarea")).color,
        };
      });
      assert.equal(sendGeometry.width, 42, JSON.stringify(sendGeometry));
      assert.equal(sendGeometry.height, 42, JSON.stringify(sendGeometry));
      assert.equal(sendGeometry.insideField, true, JSON.stringify(sendGeometry));
      assert.equal(sendGeometry.label, "Send via chat to 1 person", JSON.stringify(sendGeometry));
      assert.equal(sendGeometry.text, "", JSON.stringify(sendGeometry));
      assert.equal(sendGeometry.iconCount, 1, JSON.stringify(sendGeometry));
      assert.equal(sendGeometry.panelBackground, "rgb(17, 20, 26)", JSON.stringify(sendGeometry));
      assert.equal(sendGeometry.composeBackground, "rgb(17, 20, 26)", JSON.stringify(sendGeometry));
      assert.equal(sendGeometry.inputColor, "rgb(246, 247, 249)", JSON.stringify(sendGeometry));
      if (process.env.OLDTIME_SHARE_SEND_SCREENSHOT === "1") {
        await page.screenshot({ path: "/tmp/oldtime-share-send-preview.png" });
      }
      return;
    }
    if (process.env.OLDTIME_SETTINGS_CLEANUP_ONLY === "1") {
      await openOwnProfile(page);
      await page.locator(".profile-screen").waitFor({ state: "visible" });
      await page.locator("#profile-settings-open").click();
      await page.locator(".settings-home").waitFor({ state: "visible" });
      await page.waitForTimeout(250);
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.locator(".settings-search").count(), 1);
      assert.ok(await page.locator(".settings-group").count() > 0);
      const baseViewport = page.viewportSize() || { width: 402, height: 874 };
      await page.setViewportSize({ width: 320, height: 780 });
      const narrowSettingsWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(narrowSettingsWidth <= 320, `Settings has no horizontal spill at 320px: ${narrowSettingsWidth}`);
      await page.setViewportSize(baseViewport);
      const settingsSurface = await page.locator(".account-settings-screen.settings-home-view").evaluate(screen => ({
        screen: getComputedStyle(screen).backgroundColor,
        scroll: getComputedStyle(screen.querySelector(".settings-scroll")).backgroundColor,
        group: getComputedStyle(screen.querySelector(".settings-group")).backgroundColor,
      }));
      assert.deepEqual(settingsSurface, {
        screen: "rgb(255, 255, 255)",
        scroll: "rgb(255, 255, 255)",
        group: "rgb(255, 255, 255)",
      }, JSON.stringify(settingsSurface));
      if (process.env.OLDTIME_SETTINGS_SCREENSHOTS) {
        await page.screenshot({ path: "/tmp/oldtime-settings-cleanup.png", fullPage: true });
      }
      if (process.env.OLDTIME_SETTINGS_STYLE_ONLY === "1") return;
      await page.locator("#settings-back").click();
      await page.locator(".profile-screen").waitFor({ state: "visible" });
      await page.locator("#edit").click();
      await page.locator(".edit-profile-screen").waitFor({ state: "visible" });
      const profilePhotoActionColor = await page.locator(".profile-editor-photo-action").first()
        .evaluate(element => getComputedStyle(element).color);
      assert.equal(profilePhotoActionColor, "rgb(23, 25, 28)");
      if (process.env.OLDTIME_SETTINGS_SCREENSHOTS) {
        await page.locator(".edit-profile-scroll").evaluate(element => { element.scrollTop = 0; });
        await page.waitForTimeout(250);
        await page.screenshot({ path: "/tmp/oldtime-edit-profile-top.png" });
      }
      const interestDropdown = page.locator(".profile-interest-dropdown");
      assert.equal(await interestDropdown.count(), 1);
      await interestDropdown.locator(":scope > summary").click();
      assert.equal(await interestDropdown.evaluate(element => element.open), true);
      assert.ok(await page.locator(".interest-choice-group").count() >= 6,
        "the expanded interest catalog exposes suggested topics and sport categories");
      assert.equal(await page.locator(".interest-choice-group").first().isVisible(), true);
      assert.ok(await page.locator(".profile-interest-option .interest-option-mark svg").count() > 0);
      assert.equal(await page.locator('[data-profile-interest="los-angeles-lakers"]').count(), 1);
      assert.equal(await page.locator('[data-profile-interest="nfl"]').count(), 1);
      const interestSearch = page.locator(".profile-interest-dropdown [data-interest-search-input]");
      await interestSearch.fill("Barcelona");
      await page.locator('[data-profile-interest="fc-barcelona"]').waitFor({ state: "visible" });
      await interestSearch.fill("Lakers");
      await page.locator('[data-profile-interest="los-angeles-lakers"]').waitFor({ state: "visible" });
      await interestSearch.fill("");
      const interestRowRadius = await page.locator(".profile-interest-option").first()
        .evaluate(element => getComputedStyle(element).borderRadius);
      assert.equal(interestRowRadius, "0px", "interest options remain flat rows inside one dropdown surface");
      await page.setViewportSize({ width: 320, height: 780 });
      const narrowEditorWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(narrowEditorWidth <= 320, `Edit Profile has no horizontal spill at 320px: ${narrowEditorWidth}`);
      await page.setViewportSize({ width: 402, height: 874 });
      const editorSurface = await page.locator(".edit-profile-screen").evaluate(element => ({
        background: getComputedStyle(element).backgroundColor,
        width: element.scrollWidth,
        viewport: window.innerWidth,
      }));
      assert.equal(editorSurface.background, "rgb(255, 255, 255)");
      assert.ok(editorSurface.width <= editorSurface.viewport, JSON.stringify(editorSurface));
      if (process.env.OLDTIME_SETTINGS_SCREENSHOTS) {
        await page.waitForTimeout(250);
        await page.locator(".interest-dropdown-body").scrollIntoViewIfNeeded();
        await page.screenshot({ path: "/tmp/oldtime-edit-profile-interests-open.png" });
      }
      return;
    }
    if (process.env.OLDTIME_PROFILE_INTEREST_ONLY === "1") {
      await openOwnProfile(page);
      await page.locator(".profile-screen").waitFor({ state: "visible" });
      await page.locator("#edit").click();
      await page.locator(".edit-profile-screen").waitFor({ state: "visible" });
      await page.locator(".profile-interest-dropdown > summary").click();
      const interestInput = page.locator(".profile-editor-interests .interest-custom-entry input");
      const addInterest = page.locator('.profile-editor-interests .interest-custom-entry button[aria-label="Add interest"]');
      assert.equal(await addInterest.count(), 1);
      const interestAddSize = await addInterest.evaluate(button => {
        const rect = button.getBoundingClientRect();
        return [rect.width, rect.height];
      });
      assert.ok(interestAddSize.every(size => Math.abs(size - 48) < 1), JSON.stringify(interestAddSize));
      await interestInput.fill("Bird watching");
      await addInterest.click();
      const customInterest = page.locator('.profile-editor-interests [data-profile-interest="Bird watching"]');
      await customInterest.waitFor({ state: "visible" });
      assert.equal(await customInterest.getAttribute("aria-pressed"), "true");
      await page.locator("#savep").click();
      await page.locator(".edit-profile-screen").waitFor({ state: "detached" });
      assert.ok(accountState?.profile?.interests?.includes("Bird watching"),
        JSON.stringify(accountState?.profile?.interests || []));
      await page.reload({ waitUntil: "networkidle" });
      await openOwnProfile(page);
      await page.locator("#edit").click();
      await page.locator(".edit-profile-screen").waitFor({ state: "visible" });
      await page.locator(".profile-interest-dropdown > summary").click();
      await page.locator('.profile-editor-interests [data-profile-interest="Bird watching"][aria-pressed="true"]').waitFor({ state: "visible" });
      return;
    }
    if (process.env.OLDTIME_REPOST_RENDER_ONLY === "1" || process.env.OLDTIME_POST_MENU_ONLY === "1") {
      const homeCard = await homeForYouTimelineCard(page, "browser-repost-post");
      const homeSourceIds = await page.locator("#feed .home-feed-post-card [data-home-feed-open]").evaluateAll(elements =>
        elements.map(element => element.dataset.homeFeedOpen)
      );
      const feedLayout = await page.locator("#feed").evaluate(feed => {
        const card = feed.querySelector('.home-feed-post-card [data-home-feed-open="browser-repost-post"]')?.closest(".home-feed-post-card");
        const media = card?.querySelector(".profile-post-media");
        const cardRect = card?.getBoundingClientRect();
        const mediaRect = media?.getBoundingClientRect();
        const avatar = card?.querySelector(".profile-post-timeline-avatar")?.getBoundingClientRect();
        return {
        posts: feed.querySelectorAll(".home-feed-post-card").length,
        width: cardRect?.width,
        mediaRatio: mediaRect?.width / mediaRect?.height,
        avatarSize: avatar?.width,
        viewport: window.innerWidth,
        feedHeight: feed.clientHeight,
        navVisible: !!document.querySelector(".nav:not(.nav-hidden)"),
        };
      });
      if (process.env.OLDTIME_POST_MENU_ONLY !== "1") {
        assert.ok(feedLayout.posts >= 2, `For You contains multiple vertical posts: ${JSON.stringify(feedLayout)}`);
      }
      assert.ok(feedLayout.width >= feedLayout.viewport - 1, `For You cards fill the list width: ${JSON.stringify(feedLayout)}`);
      assert.ok(Math.abs(feedLayout.mediaRatio - 1.6) < 0.03,
        `Home media rectangles match the Profile timeline ratio: ${JSON.stringify(feedLayout)}`);
      assert.equal(feedLayout.avatarSize, 40, `Home cards use the same avatar size as Profile: ${JSON.stringify(feedLayout)}`);
      assert.equal(feedLayout.navVisible, true, "the Home navigation remains visible on the feed");
      assert.equal(await page.locator("#feed .clip").count(), 0,
        "Home timeline cards are separate from the full-screen viewer");
      assert.equal(await page.locator("#home-share-current").count(), 0,
        "the share shortcut is no longer in the Home header");
      assert.equal(await homeCard.isVisible(), true, "the selected For You card is rendered in its source feed");
      await page.screenshot({ path: "/tmp/oldtime-home-rectangular-feed.png" });
      await homeCard.locator('[data-home-feed-open="browser-repost-post"]').click();
      const post = page.locator('.post-viewer-screen .clip[data-id="browser-repost-post"]');
      await post.waitFor({ state: "visible" });
      const homeViewerSwitcher = page.locator(".post-viewer-screen.home-feed-viewer .home-viewer-switcher");
      await homeViewerSwitcher.waitFor({ state: "visible" });
      assert.deepEqual(
        await homeViewerSwitcher.locator('[role="tab"]').allInnerTexts(),
        ["For You", "Following"],
        "For You offers only Home feeds in the full-screen viewer",
      );
      assert.equal(await homeViewerSwitcher.locator('[data-home-viewer-target="community"]').count(), 0,
        "Community stays out of the full-screen Home feed switcher");
      assert.ok(await homeViewerSwitcher.locator(".home-viewer-follow-avatars img").count() > 0,
        "Following shows real followed-account avatars");
      const switcherAlignment = await homeViewerSwitcher.evaluate(nav => {
        const following = nav.querySelector('[data-home-viewer-target="following"]');
        const avatarStack = following?.querySelector(".home-viewer-follow-avatars");
        const followingBounds = following?.getBoundingClientRect();
        const avatarBounds = avatarStack?.getBoundingClientRect();
        const labelRange = document.createRange();
        if (following?.firstChild) labelRange.selectNodeContents(following.firstChild);
        const labelBounds = labelRange.getBoundingClientRect();
        return {
          stackInsideFollowing: avatarStack?.parentElement === following,
          gap: avatarBounds?.left - labelBounds.right,
          insideTab: avatarBounds?.right <= followingBounds?.right,
        };
      });
      assert.equal(switcherAlignment.stackInsideFollowing, true,
        `the three avatars stay alongside Following: ${JSON.stringify(switcherAlignment)}`);
      assert.equal(switcherAlignment.insideTab, true,
        `the avatar stack stays contained in the Following tab: ${JSON.stringify(switcherAlignment)}`);
      assert.ok(switcherAlignment.gap >= 0 && switcherAlignment.gap <= 8,
        `the avatar stack stays close to the Following label: ${JSON.stringify(switcherAlignment)}`);
      const switcherPointerEvents = await homeViewerSwitcher.evaluate(nav => ({
        container: getComputedStyle(nav).pointerEvents,
        tab: getComputedStyle(nav.querySelector(".home-viewer-switcher-tab")).pointerEvents,
      }));
      assert.deepEqual(switcherPointerEvents, { container: "none", tab: "auto" },
        "empty switcher space cannot intercept taps intended for the full-screen menu");
      const viewerOverflow = post.locator(".post-viewer-actions-menu > summary");
      await viewerOverflow.waitFor({ state: "visible" });
      assert.equal(await viewerOverflow.evaluate(element => getComputedStyle(element).color), "rgb(255, 255, 255)",
        "the white three-dot feed menu remains visible");
      if (process.env.OLDTIME_POST_MENU_ONLY !== "1") {
        await homeViewerSwitcher.locator('[data-home-viewer-target="following"]').click();
        await page.locator('.home-viewer-switcher [data-home-viewer-target="following"][aria-selected="true"]').waitFor({ state: "visible" });
        assert.equal(await page.locator(".post-viewer-screen.home-feed-viewer").count(), 1,
          "switching to Following stays in the full-screen viewer");
        assert.deepEqual(
          await page.locator(".home-viewer-switcher [role='tab']").allInnerTexts(),
          ["Discover", "Following"],
          "Following offers Discover but not Community in the full-screen viewer",
        );
        await page.locator('.home-viewer-switcher [data-home-viewer-target="discover"]').click();
        await page.locator('.home-viewer-switcher [data-home-viewer-target="discover"][aria-selected="true"]').waitFor({ state: "visible" });
        assert.equal(await page.locator(".post-viewer-screen.home-feed-viewer .clip[data-id='browser-repost-post']").count(), 1,
          "Discover switches back to the Home For You source");
        const viewerSourceIds = await page.locator(".post-viewer-feed > .clip[data-id]").evaluateAll(elements =>
          elements.map(element => element.dataset.id)
        );
        assert.ok(viewerSourceIds.every(id => homeSourceIds.includes(id)),
          `the full-screen viewer stays inside the selected Home feed: ${JSON.stringify({ homeSourceIds, viewerSourceIds })}`);
      }
      assert.ok(await post.locator(".meta .feed-author-name").isVisible(), "creator details remain visible on Home");
      assert.ok((await post.locator(".meta .feed-author-name").innerText()).trim().length > 0);
      assert.ok(await post.locator(".meta .cap").isVisible(), "caption remains visible on Home");
      assert.match(await post.locator(".meta .cap").innerText(), /repost interaction/i);
      await post.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(200);
      const controls = post.locator(".post-viewer-media-controls");
      const row = controls.locator(".media-action-row");
      await controls.waitFor({ state: "visible" });
      assert.equal(await post.locator(".post-viewer-comment-overlay, .feed-comment-preview").count(), 0,
        "floating comments are not rendered over media");
      assert.equal(await controls.locator(".post-viewer-media-prompt").innerText(), "Say something");
      for (const action of ["like", "comment", "save", "share"]) {
        assert.equal(await row.locator(`[data-${action}="browser-repost-post"]`).count(), 1,
          `the full-screen viewer keeps ${action} in its shared horizontal row`);
      }
      assert.equal(await row.locator('[data-repost="browser-repost-post"]').count(), 0,
        "Repost stays in the Share menu rather than the action row");
      assert.equal(await homeCard.locator(".home-feed-post-actions-menu").count(), 0,
        "Home post cards do not show three-dot controls");
      const viewerMenu = post.locator(":scope > .media-post-options");
      assert.equal(await viewerMenu.count(), 1,
        "the full-screen post has one three-dot menu without adding dots to its Home card");
      const viewerMenuTrigger = viewerMenu.locator(":scope > summary");
      const triggerHitTest = await viewerMenuTrigger.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          visible: rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== "hidden",
          receivesTap: hit === button || button.contains(hit),
          directTarget: hit === button,
          bounds: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
          viewport: { width: innerWidth, height: innerHeight },
        };
      });
      assert.ok(triggerHitTest.visible && triggerHitTest.receivesTap,
        `the three-dot target is visible and receives a direct touch: ${JSON.stringify(triggerHitTest)}`);
      assert.equal(triggerHitTest.directTarget, true,
        `the icon itself never intercepts the summary tap: ${JSON.stringify(triggerHitTest)}`);
      if (process.env.OLDTIME_POST_MENU_ONLY === "1") {
        await viewerMenu.evaluate(menu => {
          const summary = menu.querySelector(":scope > summary");
          if (summary) summary.replaceWith(summary.cloneNode(true));
        });
      }
      if (emulatePostMenuTouch) await viewerMenuTrigger.tap();
      else await viewerMenuTrigger.click();
      assert.equal(await viewerMenu.getAttribute("open") !== null, true,
        "the full-screen menu opens from its visible top control");
      assert.equal(await viewerMenu.locator(".post-actions-menu-items").isVisible(), true,
        "the full-screen action panel is visible after the tap");
      if (process.env.OLDTIME_POST_MENU_ONLY === "1") {
        for (let cycle = 0; cycle < 3; cycle += 1) {
          if (cycle > 0) {
            if (emulatePostMenuTouch) await viewerMenuTrigger.tap();
            else await viewerMenuTrigger.click();
            assert.equal(await viewerMenu.getAttribute("open") !== null, true,
              `three-dot menu reopens on repeated tap ${cycle + 1}`);
          }
          if (emulatePostMenuTouch) await viewerMenuTrigger.tap();
          else await viewerMenuTrigger.click();
          assert.equal(await viewerMenu.getAttribute("open") !== null, false,
            `three-dot menu closes on repeated tap ${cycle + 1}`);
        }
        assert.deepEqual(pageErrors, []);
        return;
      }
      const menuTypography = await viewerMenu
        .locator(".post-actions-menu-items :is(button, [role='menuitem'], a)")
        .evaluateAll(items => items
          .filter(item => item.innerText.trim())
          .map(item => ({
            text: item.innerText.trim(),
            fontFamily: getComputedStyle(item).fontFamily,
            fontSize: getComputedStyle(item).fontSize,
          })));
      assert.ok(menuTypography.length > 0, "the action panel contains visible text options");
      assert.ok(menuTypography.every(item => item.fontSize === "14px"),
        `all full-screen menu options use the shared 14px size: ${JSON.stringify(menuTypography)}`);
      assert.equal(await viewerMenu.locator('[data-post-engagement-open="browser-repost-post"]').count(), 1);
      assert.equal(await viewerMenu.locator('[data-post-viewer-download="browser-repost-post"]').count(), 1);
      assert.equal(await viewerMenu.locator('[data-audio-open="browser-repost-post"]').count(), 0,
        "Original audio is not duplicated in the three-dot menu");
      assert.equal(await post.locator(".soundbar [data-audio-open='browser-repost-post']").count(), 1,
        "the original sound control remains in the post itself");
      assert.equal(await viewerMenu.locator('[data-post-viewer-why="browser-repost-post"]').count(), 1);
      assert.equal(await viewerMenu.locator('[data-post-report="browser-repost-post"]').count(), 1);
      assert.equal(await viewerMenu.locator('[data-post-not-interested="browser-repost-post"]').count(), 1);
      if (emulatePostMenuTouch) await viewerMenuTrigger.tap();
      else await viewerMenuTrigger.click();
      await viewerMenu.locator('[data-post-viewer-why="browser-repost-post"]').click();
      const whySheet = page.locator(".xe-sheet");
      await whySheet.waitFor({ state: "visible" });
      assert.match(await whySheet.innerText(), /Why you're seeing this post/);
      assert.match(await whySheet.innerText(), /ranked around your interests and activity/i);
      await whySheet.locator("[data-xe-close]").click();
      assert.equal(await page.locator(".post-viewer-topbar").evaluate(header => getComputedStyle(header).backgroundImage), "none",
        "full-screen content keeps the header fade removed");
      const rowLayout = await controls.evaluate(element => {
        const prompt = element.querySelector(".post-viewer-media-prompt")?.getBoundingClientRect();
        const actions = element.querySelector(".media-action-row")?.getBoundingClientRect();
        const icons = [...element.querySelectorAll(".media-action-row [data-like], .media-action-row [data-comment], .media-action-row [data-save], .media-action-row [data-share]")]
          .map(button => button.getBoundingClientRect());
        const nav = document.querySelector(".nav")?.getBoundingClientRect();
        return {
          prompt, actions, icons, nav,
          barGap: nav && actions ? nav.top - actions.bottom : null,
          navHidden: document.querySelector(".nav")?.classList.contains("nav-hidden"),
          viewportHeight: window.innerHeight,
        };
      });
      assert.ok(rowLayout.prompt && rowLayout.actions && rowLayout.actions.left >= rowLayout.prompt.right - 1,
        `the prompt and actions sit in one row: ${JSON.stringify(rowLayout)}`);
      assert.ok(Math.max(...rowLayout.icons.map(box => box.top)) - Math.min(...rowLayout.icons.map(box => box.top)) <= 1,
        `media actions do not stack vertically: ${JSON.stringify(rowLayout.icons)}`);
      assert.equal(rowLayout.navHidden, true, "opening a post hides the Home navigation");
      assert.ok(rowLayout.actions.bottom <= rowLayout.viewportHeight,
        `full-screen actions remain inside the viewport: ${JSON.stringify(rowLayout)}`);
      await controls.locator(".post-viewer-media-prompt").click();
      const commentsPanel = page.locator(".comment-panel");
      await commentsPanel.waitFor({ state: "visible" });
      await page.locator("#cbody").waitFor({ state: "visible" });
       const commentLayout = await commentsPanel.evaluate(panel => {
         const panelBox = panel.getBoundingClientRect();
         const listBox = panel.querySelector(".comment-list").getBoundingClientRect();
         const composerBox = panel.querySelector(".comment-composer").getBoundingClientRect();
         return {
           panelHeight: panelBox.height,
           viewportHeight: window.innerHeight,
           listBottom: listBox.bottom,
           composerTop: composerBox.top,
           composerBottom: composerBox.bottom,
           panelBottom: panelBox.bottom,
         };
       });
        assert.ok(Math.abs(commentLayout.panelHeight - Math.min(commentLayout.viewportHeight * 0.55, 560)) <= 1,
          `the comment thread opens as a compact sheet: ${JSON.stringify(commentLayout)}`);
       assert.ok(commentLayout.composerTop >= commentLayout.listBottom - 1
         && commentLayout.composerBottom <= commentLayout.panelBottom + 1,
       `the composer stays anchored below the scrolling comments: ${JSON.stringify(commentLayout)}`);
       assert.equal(await commentsPanel.locator(".comment-composer-pill").count(), 1,
         "the reference comment input remains visible and interactive");
       assert.equal(await commentsPanel.locator("#comment-expand").count(), 0,
         "comments do not have a separate expand/collapse button");
       const commentGrip = await commentsPanel.locator(".grab").boundingBox();
       assert.ok(commentGrip, "the comment sheet has a visible swipe handle");
       await page.mouse.move(commentGrip.x + commentGrip.width / 2, commentGrip.y + commentGrip.height / 2);
       await page.mouse.down();
       await page.mouse.move(commentGrip.x + commentGrip.width / 2, commentGrip.y + commentGrip.height / 2 - 170, { steps: 6 });
       await page.mouse.up();
       const expandedCommentLayout = await commentsPanel.evaluate(panel => ({
         expanded: panel.classList.contains("is-expanded"),
         height: panel.getBoundingClientRect().height,
       }));
       assert.equal(expandedCommentLayout.expanded, true, "an upward drag expands the compact comment sheet");
       assert.ok(expandedCommentLayout.height > commentLayout.panelHeight + 80,
         `comments slide up into a larger sheet: ${JSON.stringify(expandedCommentLayout)}`);
       await page.waitForTimeout(250);
       const expandedCommentGrip = await commentsPanel.locator(".grab").boundingBox();
       await page.mouse.move(expandedCommentGrip.x + expandedCommentGrip.width / 2, expandedCommentGrip.y + expandedCommentGrip.height / 2);
       await page.mouse.down();
       await page.mouse.move(expandedCommentGrip.x + expandedCommentGrip.width / 2, expandedCommentGrip.y + expandedCommentGrip.height / 2 + 190, { steps: 6 });
       await page.mouse.up();
       assert.equal(await commentsPanel.evaluate(panel => panel.classList.contains("is-expanded")), false,
         "a downward drag first returns comments to their compact height");
       await page.waitForFunction(expectedHeight => {
         const panel = document.querySelector(".comment-panel");
         return panel && Math.abs(panel.getBoundingClientRect().height - expectedHeight) <= 2;
       }, commentLayout.panelHeight);
       const compactCommentGrip = await commentsPanel.locator(".grab").boundingBox();
       await page.mouse.move(compactCommentGrip.x + compactCommentGrip.width / 2, compactCommentGrip.y + compactCommentGrip.height / 2);
       await page.mouse.down();
       await page.mouse.move(compactCommentGrip.x + compactCommentGrip.width / 2, compactCommentGrip.y + compactCommentGrip.height / 2 + 190, { steps: 5 });
       await page.mouse.up();
      await commentsPanel.waitFor({ state: "detached" });
      assert.equal(await page.locator(".post-viewer-comment-overlay, .feed-comment-preview").count(), 0,
        "opening comments does not restore a floating comment overlay");
      await page.locator("#post-viewer-back").click();
      await page.locator('.home-screen[data-rectangle-feed="true"]').waitFor({ state: "visible" });
      const followingResponse = page.waitForResponse(response => feedSurfaceResponse(response, "following"));
      await page.locator('.home-view-tab[data-home-view="following"]').click();
      assert.equal((await followingResponse).status(), 200);
      const followingCard = page.locator("#feed .home-feed-post-card").filter({
        has: page.locator('[data-home-feed-open="browser-repost-post"]'),
      });
      await followingCard.waitFor({ state: "visible" });
      assert.ok(await followingCard.locator(".profile-post-author").isVisible(),
        "Following keeps creator details visible");
      assert.ok(await followingCard.locator(".profile-post-caption").isVisible(),
        "Following keeps captions visible");
      assert.equal(await page.locator('.home-view-tab[data-home-view="following"]').getAttribute("aria-selected"), "true");
      assert.ok(await followingCard.locator(".profile-post-media").isVisible(),
        "Following uses a rectangular media card like For You");
      await followingCard.locator('[data-home-feed-open="browser-repost-post"]').click();
      const followingPost = page.locator('.post-viewer-screen .clip[data-id="browser-repost-post"]');
      await followingPost.waitFor({ state: "visible" });
      const followingActionBounds = await followingPost.locator(".post-viewer-media-controls").evaluate(controls => {
        const actions = controls.querySelector(".media-action-row")?.getBoundingClientRect();
        return {
          actions,
          navHidden: document.querySelector(".nav")?.classList.contains("nav-hidden"),
          viewportHeight: window.innerHeight,
        };
      });
      assert.equal(followingActionBounds.navHidden, true,
        "opening a Following post also hides the Home navigation");
      assert.ok(followingActionBounds.actions.bottom <= followingActionBounds.viewportHeight,
        `the full-screen Following actions remain inside the viewport: ${JSON.stringify(followingActionBounds)}`);
      await page.locator("#post-viewer-back").click();
      await page.locator('.home-screen[data-rectangle-feed="true"]').waitFor({ state: "visible" });
      await page.screenshot({ path: "/tmp/oldtime-following-rectangular-feed.png" });
      assert.deepEqual(pageErrors, []);
      return;
    }
    if (process.env.OLDTIME_POST_ENGAGEMENT_ONLY === "1") {
      const post = await showHomeForYouPost(page, "browser-repost-post");
      assert.equal(await post.locator("[data-post-likes]").count(), 0,
        "the old inline liked-by row is not rendered");
      assert.doesNotMatch(await post.innerText(), /Liked by/,
        "people who liked the post are available from engagement controls, not in the feed");
      assert.equal(await post.locator(".rail .ot-view-metric").count(), 0,
        "views are in engagement details rather than a standalone rail button");
      assert.equal(await post.locator(".rail-avatar-wrap").count(), 0,
        "the creator avatar and follow plus are removed from the media rail");
      assert.equal(await post.locator(".rail [data-follow]").count(), 0,
        "the media rail has no detached follow control");
      assert.equal(await post.locator(".feed-author-handle-main > *").count(), 1,
        "only the author name remains in the bottom byline");
      const likeGeometry = await post.locator(".act-like-group").evaluate(group => {
        const [heart, count] = [...group.children].map(element => element.getBoundingClientRect());
        return {
          heartRight: heart.right,
          countLeft: count.left,
          heartCenter: heart.top + heart.height / 2,
          countCenter: count.top + count.height / 2,
        };
      });
      assert.ok(likeGeometry.countLeft >= likeGeometry.heartRight - 1,
        `the like count sits beside the heart: ${JSON.stringify(likeGeometry)}`);
      assert.ok(Math.abs(likeGeometry.heartCenter - likeGeometry.countCenter) <= 2,
        `the like count aligns with the heart: ${JSON.stringify(likeGeometry)}`);
      const iconSizes = await post.locator(".media-action-row").evaluate(row => ({
        heart: Number.parseFloat(getComputedStyle(row.querySelector(".act-like-group .navic")).width),
        saved: Number.parseFloat(getComputedStyle(row.querySelector("[data-save] .navic")).width),
      }));
      assert.ok(iconSizes.heart >= iconSizes.saved,
        `the heart should visually match or exceed the saved icon: ${JSON.stringify(iconSizes)}`);
      if (process.env.OLDTIME_POST_ENGAGEMENT_SCREENSHOT === "1") {
        await page.screenshot({ path: "/tmp/oldtime-post-feed.png" });
      }
      const likesTrigger = post.locator("[data-likes-open]");
      await likesTrigger.click();
      const panel = page.locator("#sheet [data-post-engagement]");
      await panel.waitFor({ state: "visible" });
      await panel.getByText("Story Member", { exact: true }).waitFor({ state: "visible" });
      assert.match(await panel.innerText(), /Likes and views/);
      assert.match(await panel.innerText(), /Story Member/);
      assert.match(await panel.innerText(), /Miya Fan/);
      assert.equal(await panel.locator(":scope > .grab").count(), 1,
        "the sheet has one drag handle, not duplicate bars");
      assert.deepEqual(await panel.locator(".engagement-metric-label").allTextContents(),
        ["Likes", "Views", "Reposts"], "all three centered metrics show consistent labels");
      const sheetGeometry = await panel.evaluate(element => ({
        heightRatio: element.getBoundingClientRect().height / window.innerHeight,
        metricsDisplay: getComputedStyle(element.querySelector(".engagement-metrics")).display,
        headingAlign: getComputedStyle(element.querySelector(".engagement-header h2")).textAlign,
        listHeadingAlign: getComputedStyle(element.querySelector(".engagement-list-heading h3")).textAlign,
      }));
      assert.ok(sheetGeometry.heightRatio <= .8,
        `engagement opens as a compact sheet: ${JSON.stringify(sheetGeometry)}`);
      assert.equal(sheetGeometry.metricsDisplay, "grid");
      assert.equal(sheetGeometry.headingAlign, "center");
      assert.equal(sheetGeometry.listHeadingAlign, "center");
      const accountTextSizes = await panel.locator(".engagement-person").first().evaluate(row => {
        const name = row.querySelector(".engagement-person-copy b");
        const handle = row.querySelector(".engagement-person-copy small");
        return [getComputedStyle(name).fontSize, getComputedStyle(handle).fontSize];
      });
      assert.deepEqual(accountTextSizes, ["13px", "13px"],
        "display names and handles share one readable size");
      const followColor = await panel.locator(".engagement-follow").first().evaluate(button => getComputedStyle(button).backgroundColor);
      assert.equal(followColor, "rgb(23, 24, 27)", "Follow buttons use Oldtime's dark color, not the blue reference color");
      const search = panel.locator("[data-engagement-search]");
      await search.fill("miya");
      await panel.getByText("Miya Fan", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await panel.locator(".engagement-person").count(), 1);
      await panel.locator('[data-engagement-tab="views"]').click();
      assert.match(await panel.innerText(), /120 views/);
      assert.match(await panel.innerText(), /Viewer names aren’t available/);
      assert.equal(await panel.locator(".engagement-person").count(), 0);
      await panel.locator('[data-engagement-tab="reposts"]').click();
      await panel.getByText("Repost Person", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await panel.locator(".engagement-person").count(), 1);
      if (process.env.OLDTIME_POST_ENGAGEMENT_SCREENSHOT === "1") {
        await page.screenshot({ path: "/tmp/oldtime-engagement-panel.png" });
      }
      for (const width of [402, 320]) {
        await page.setViewportSize({ width, height: 874 });
        const layout = await panel.evaluate(element => ({
          panelWidth: element.getBoundingClientRect().width,
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
        }));
        assert.ok(layout.panelWidth <= layout.viewportWidth, JSON.stringify(layout));
        assert.ok(layout.documentWidth <= layout.viewportWidth, JSON.stringify(layout));
      }
      assert.deepEqual(pageErrors, [], pageErrors.join("\n"));
      return;
    }
    if (process.env.OLDTIME_COMMUNITY_ACTION_RENDER_ONLY === "1" ||
        process.env.OLDTIME_COMMUNITY_MEDIA_ACTIONS_ONLY === "1") {
      const homePost = await showHomeForYouPost(page, "browser-repost-post");
      await homePost.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(150);
      const homeSharePath = await homePost.locator(".media-action-row [data-share] .navic path").getAttribute("d");
      await page.locator("#post-viewer-back").click();
      await page.locator('.home-screen[data-rectangle-feed="true"]').waitFor({ state: "visible" });
      showCommunityActionFixture = true;
      communityPost.measuredViews = 120;
      await page.locator('.nav [data-tab="communities"]').click();
      const communityCard = page.locator('[data-testid="card-community-post-browser-repost-post"]');
      await communityCard.waitFor({ state: "visible" });
      assert.deepEqual(await communityCard.locator(".community-post-actions").evaluate(element =>
        [...element.children].map(child => child.matches("[data-like]") ? "like"
          : child.matches("[data-repost]") ? "repost"
            : child.matches("[data-comment]") ? "comment"
              : child.matches(".ot-view-metric") ? "views"
              : child.matches("[data-save]") ? "save"
                : child.matches("[data-share]") ? "share" : "unknown")
      ), ["like", "repost", "comment", "views", "save", "share"]);
      const actionRow = communityCard.locator(".community-post-actions");
      for (const width of [402, 320]) {
        await page.setViewportSize({ width, height: 874 });
        const actionTops = await actionRow.evaluate(element =>
          [...element.children].map(child => child.getBoundingClientRect().top)
        );
        assert.equal(actionTops.length, 6, "all six actions remain present");
        assert.ok(Math.max(...actionTops) - Math.min(...actionTops) <= 1,
          `all actions stay on one line at ${width}px`);
      }
      await page.setViewportSize({ width: 402, height: 874 });
      assert.equal(
        await communityCard.locator('.community-post-actions [data-share] .navic path').getAttribute("d"),
        homeSharePath,
      );
      const iconStyle = await communityCard.locator(".community-post-actions").evaluate(element =>
        [...element.querySelectorAll("svg")].map(svg => [svg.getAttribute("fill"), svg.getAttribute("stroke-width"), svg.getAttribute("stroke-linecap")])
      );
      assert.equal(iconStyle.length, 6);
      assert.ok(iconStyle.every(([fill, width, cap], index) =>
        (index === 0 || fill === "none") && width === "1.75" && cap === "round"),
      `Community action icons use matching outlined geometry, with the heart's own fill: ${JSON.stringify(iconStyle)}`);
      await communityCard.locator(".community-post-actions [data-share]").click();
      await page.locator("[data-share-messages]").waitFor({ state: "visible" });
      await page.locator("[data-share-story]").waitFor({ state: "visible" });
      assert.equal(await page.locator("[data-share-repost]").count(), 0,
        "Community keeps its existing repost control instead of duplicating it in Share");
      const shareTextReadability = await page.locator(".share-recipient-panel").evaluate(panel => {
        const selectors = [
          ".srp-head h2",
          ".srp-section-label",
          ".srp-destination > span:not(.srp-destination-icon)",
        ];
        return {
          surface: getComputedStyle(panel).backgroundColor,
          labels: selectors.flatMap(selector => [...panel.querySelectorAll(selector)]).map(element => ({
            text: element.textContent.trim(),
            color: getComputedStyle(element).color,
            opacity: getComputedStyle(element).opacity,
          })),
        };
      });
      assert.equal(shareTextReadability.surface, "rgb(255, 255, 255)");
      assert.ok(shareTextReadability.labels.length >= 4 &&
        shareTextReadability.labels.every(label => label.color === "rgb(23, 25, 28)" && label.opacity === "1"),
      `Share sheet labels remain dark and fully opaque on white: ${JSON.stringify(shareTextReadability)}`);
      await page.locator("[data-social-sheet-close]").click();
      const communityMedia = communityCard.locator("[data-stories-post]").first();
      await communityMedia.click();
      const communityViewer = page.locator('.post-viewer-screen.post-viewer-community .clip.post-detail[data-id="browser-repost-post"]');
      await communityViewer.waitFor({ state: "visible" });
      const communityViewerActions = communityViewer.locator(".post-viewer-media-controls .media-action-row");
      for (const action of ["like", "comment", "save", "share"]) {
        assert.equal(await communityViewerActions.locator(`[data-${action}="browser-repost-post"]`).count(), 1,
          `the full-screen Community viewer retains ${action}`);
      }
      assert.equal(await communityViewerActions.locator('[data-repost="browser-repost-post"]').count(), 0,
        "the full-screen Community viewer omits Repost");
      assert.equal(await communityViewerActions.locator(".ot-view-metric").count(), 0,
        "the full-screen Community viewer omits the view-count control");
      await page.locator("#post-viewer-back").click();
      await communityViewer.waitFor({ state: "detached" });
      if (process.env.OLDTIME_COMMUNITY_MEDIA_ACTIONS_ONLY === "1") {
        assert.deepEqual(pageErrors, []);
        return;
      }
      showCommunityActionFixture = false;
      await page.reload({ waitUntil: "networkidle" });
      await assertHomeCreateAvailable(page);
      await page.locator('.nav [data-tab="updates"]').click();
      const reloadedHomePost = await showHomeForYouPost(page, "browser-repost-post");
      await reloadedHomePost.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(150);
      const homeActions = reloadedHomePost.locator(".post-viewer-media-controls .media-action-row");
      assert.equal(await homeActions.locator("[data-repost]").count(), 0);
      assert.equal(await homeActions.locator(".act[data-save]").count(), 1);
      assert.equal(await homeActions.locator("[data-share]").count(), 1,
        "the post's Share action sits beside its other media controls");
      for (const width of [402, 320]) {
        await page.setViewportSize({ width, height: 874 });
        const geometry = await homeActions.evaluate(element =>
          [...element.querySelectorAll("[data-like], [data-comment], [data-save], [data-share]")].map(button => {
            const rect = button.getBoundingClientRect();
            const icon = button.querySelector(".navic")?.getBoundingClientRect();
            return { top: rect.top, left: rect.left, right: rect.right, width: rect.width, height: rect.height, iconWidth: icon?.width, iconHeight: icon?.height };
          })
        );
        assert.equal(geometry.length, 4, "Home media exposes Like, Comment, Save, Share");
        assert.ok(geometry.every(action => action.height >= 44 &&
          Math.abs(action.iconWidth - 28) < 1 && Math.abs(action.iconHeight - 28) < 1),
        `Home uses 44px controls and 28px icons at ${width}px: ${JSON.stringify(geometry)}`);
        assert.ok(Math.max(...geometry.map(action => action.top)) -
          Math.min(...geometry.map(action => action.top)) <= 1,
        `Home actions share one horizontal line at ${width}px: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.every(action => action.left >= 0 && action.right <= width),
          `Home action pills stay inside the screen at ${width}px: ${JSON.stringify(geometry)}`);
      }
      await page.setViewportSize({ width: 402, height: 874 });
      const homeShareAction = homeActions.locator("[data-share]");
      assert.equal(await homeShareAction.locator(".navic path").getAttribute("d"), homeSharePath);
      for (const width of [402, 320]) {
        await page.setViewportSize({ width, height: 874 });
        const headerGeometry = await page.evaluate(() => {
          const rect = selector => {
            const element = document.querySelector(selector);
            const bounds = element?.getBoundingClientRect();
            return bounds && { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
          };
          return {
            search: rect(".app-search-shortcut"),
            tabs: rect(".home-view-tabs"),
            notifications: rect("#notifications-open"),
          };
        });
        assert.ok(headerGeometry.search && headerGeometry.tabs && headerGeometry.notifications,
          `all feed header controls are present at ${width}px: ${JSON.stringify(headerGeometry)}`);
        assert.ok(headerGeometry.search.right <= headerGeometry.tabs.left,
          `Search stays to the left of the feed tabs at ${width}px: ${JSON.stringify(headerGeometry)}`);
        assert.ok(headerGeometry.tabs.right <= headerGeometry.notifications.left,
          `feed tabs do not overlap Notifications at ${width}px: ${JSON.stringify(headerGeometry)}`);
        assert.equal(await page.locator("#home-share-current").count(), 0,
          "Share is not duplicated in the Home header");
      }
      await page.setViewportSize({ width: 402, height: 874 });
      const homeIconStyle = await homeActions.evaluate(element =>
        [...element.querySelectorAll(".act .navic")].map(svg => [svg.getAttribute("fill"), svg.getAttribute("stroke-width"), svg.getAttribute("stroke-linecap")])
      );
      assert.ok(homeIconStyle.every(([fill, width, cap]) => fill === "none" && width === "1.75" && cap === "round"),
        `Home icons should match Community's unfilled outlines: ${JSON.stringify(homeIconStyle)}`);
      await homeShareAction.click();
      await page.locator("[data-share-messages]").waitFor({ state: "visible" });
      await page.locator("[data-share-copylink]").waitFor({ state: "visible" });
      await page.locator("[data-share-story]").waitFor({ state: "visible" });
      assert.equal(await page.locator("[data-share-repost]").count(), 0,
        "feed repost actions stay in the secondary sharing view");
      await page.locator("[data-share-messages]").click();
      await page.locator("[data-share-friends]").click();
      await page.locator("[data-share-search]").waitFor({ state: "visible" });
      assert.equal((await page.locator("[data-sheet-error]").innerText()).trim(), "");
      await page.locator("[data-share-friends]").click();
      await page.locator("[data-share-search]").waitFor({ state: "hidden" });
      await page.locator("[data-share-back]").click();
      await page.locator("[data-share-more]").click();
      await page.locator("[data-share-repost]").waitFor({ state: "visible" });
      const repostResponse = page.waitForResponse(response =>
        response.url().includes("/api/posts/browser-repost-post/repost") &&
        response.request().method() === "PUT"
      );
      await page.locator("[data-share-repost]").click();
      await repostResponse;
      const repostConfirmation = page.locator('.clip[data-id="browser-repost-post"] .rp-confirmation[role="status"]');
      await repostConfirmation.waitFor({ state: "visible", timeout: 3000 });
      assert.equal((await repostConfirmation.innerText()).trim(), "Reposted");
      await repostConfirmation.waitFor({ state: "hidden", timeout: 3000 });
      assert.notEqual((await page.locator('.clip[data-id="browser-repost-post"] .rp-summary').innerText()).trim(), "Reposted");
      return;
    }
    if (process.env.OLDTIME_STORY_NAVIGATION_ONLY === "1") {
      await page.goto(`http://127.0.0.1:${address.port}/?story=cloud-friend-story`, { waitUntil: "networkidle" });
      await page.locator("#storyview.on .story-stage").waitFor({ state: "visible" });
      assert.equal(await page.locator(".story-creator b").innerText(), "Story Member");
      await page.locator(".story-stage").click({ position: { x: 390, y: 400 } });
      await page.waitForFunction(() => document.querySelector(".story-creator b")?.textContent === "Test Member",
        { timeout: 3000 });
      assert.equal(await page.locator(".story-more-open").count(), 1,
        "a resolved right-side tap opens the previous creator without dropping Story controls");
      return;
    }
    if (process.env.OLDTIME_STORY_OWNER_ONLY === "1") {
      await page.goto(`http://127.0.0.1:${address.port}/?story=cloud-owner-story`, { waitUntil: "networkidle" });
      await page.locator("#storyview.on").waitFor({ state: "visible" });
      assert.equal((await page.locator(".story-caption").innerText()).trim(), "",
        "text already present in a composed Story is not repeated as a caption");
      assert.equal(await page.locator(".story-compose").isVisible(), false,
        "the owner cannot see a reply composer on their own Story");
      assert.equal(await page.locator(".story-reply-input").isDisabled(), true);
      assert.equal(await page.locator(".story-reaction-picker").isVisible(), false,
        "the owner cannot see reaction controls on their own Story");
      assert.equal(await page.locator(".story-reaction-picker button:visible").count(), 0,
        "the owner's hidden composer exposes no reaction choices");
      const ownerReactionCount = storyApiCalls.filter(call => call.includes("Story reaction")).length;
      const ownerStage = await page.locator(".story-stage").boundingBox();
      assert.ok(ownerStage);
      const ownerTap = { x: ownerStage.x + ownerStage.width / 2, y: ownerStage.y + ownerStage.height / 2 };
      await page.mouse.click(ownerTap.x, ownerTap.y, { delay: 0 });
      await page.mouse.click(ownerTap.x, ownerTap.y, { delay: 0 });
      await page.waitForTimeout(200);
      assert.equal(await page.locator(".story-burst").count(), 0,
        "a double tap on the owner's Story doesn't create a self-reaction animation");
      assert.equal(storyApiCalls.filter(call => call.includes("Story reaction")).length, ownerReactionCount,
        "double-tapping the owner's Story doesn't send a reaction");
      await page.locator(".story-more-open").click();
      await page.locator(".story-activity-open").click();
      await page.locator(".story-insights-summary").waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelector(".story-insights-summary")?.textContent?.includes("reaction"));
      assert.equal(await page.locator(".story-insights-summary").innerText(), "1 view · 1 reaction",
        "owner views still show reactions from other viewers, with no self reaction");
      return;
    }
    if (process.env.OLDTIME_STORY_REPLY_ONLY === "1") {
      await page.goto(`http://127.0.0.1:${address.port}/?story=cloud-friend-story`, { waitUntil: "networkidle" });
      await page.locator("#storyview.on .story-stage-media").waitFor({ state: "visible" });

      const composer = page.locator(".story-compose");
      assert.ok((await composer.boundingBox())?.width > 250, "the reply pill fills the Story viewer width");
      const avatar = composer.locator(".story-viewer-avatar");
      assert.equal(await avatar.getAttribute("src"), "/app/test-viewer-photo.svg", "the pill uses the signed-in account's actual photo");
      assert.ok(await avatar.evaluate(image => image.complete && image.naturalWidth > 0), "the account photo loads");
      assert.equal(await page.locator(".story-reply-input").getAttribute("placeholder"), "Comment…");

      const composerStyle = await composer.evaluate(element => {
        const style = getComputedStyle(element);
        return {
          border: style.borderTopWidth,
          radius: style.borderRadius,
          background: style.backgroundColor,
          shadow: style.boxShadow,
          blur: style.backdropFilter,
        };
      });
      assert.equal(composerStyle.border, "1px");
      assert.equal(composerStyle.radius, "999px");
      assert.ok(["rgba(0, 0, 0, 0.12)", "rgba(255, 255, 255, 0.18)"].includes(composerStyle.background));
      assert.equal(composerStyle.shadow, "none");
      assert.equal(composerStyle.blur, "none");

      const stage = await page.locator(".story-stage").evaluate(element => ({
        beforeContent: getComputedStyle(element, "::before").content,
        afterContent: getComputedStyle(element, "::after").content,
        mediaFilter: getComputedStyle(element.querySelector(".story-stage-media")).filter,
        mediaOpacity: getComputedStyle(element.querySelector(".story-stage-media")).opacity,
      }));
      assert.deepEqual(stage, {
        beforeContent: "none",
        afterContent: "none",
        mediaFilter: "none",
        mediaOpacity: "1",
      }, "Story media is not dimmed by a stage wash or vignette");

      assert.equal(await page.locator(".story-reaction-picker").count(), 0,
        "the Story composer no longer shows a quick-emoji strip");
      await page.screenshot({ path: "/tmp/oldtime-story-reply-pill.png" });

      await page.locator(".story-reply-input").fill("Hi from the Story pill");
      assert.equal(await page.locator(".story-send").isVisible(), true, "typing shows Send");
      assert.equal(await page.locator(".story-reaction-picker").count(), 0, "typing keeps the compact composer free of a reaction row");
      await page.locator(".story-send").click();
      await page.locator(".story-live-message").filter({ hasText: "Hi from the Story pill" }).waitFor({ state: "visible" });
      const recentReplyStyle = await page.locator(".story-live-message > span").last().evaluate(element => ({
        radius: getComputedStyle(element).borderRadius,
        background: getComputedStyle(element).backgroundColor,
      }));
      assert.notEqual(recentReplyStyle.radius, "0px", "recent replies pop in as note-like bubbles");
      await page.screenshot({ path: "/tmp/oldtime-story-reply-bubbles.png" });
      await page.locator(".story-live-list").dispatchEvent("wheel", { deltaY: -120 });
      assert.equal(await page.locator(".story-live-chat").getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator(".story-live-chat").evaluate(element => getComputedStyle(element).position), "fixed");
      await page.screenshot({ path: "/tmp/oldtime-story-reply-fullscreen.png" });
      await page.locator(".story-replies-toggle").click();
      assert.equal(await page.locator(".story-live-chat").getAttribute("aria-expanded"), "false",
        "viewers can close the full-screen reply history");
      assert.deepEqual(pageErrors, []);
      return;
    }
    if (process.env.OLDTIME_CHAT_LAYOUT_ONLY === "1") {
      const chatProfileStatRequests = [];
      const trackChatProfileRequest = request => {
        const pathname = new URL(request.url()).pathname;
        if (/^\/api\/profiles\/(?:newchatmember|storymember)$/.test(pathname)) chatProfileStatRequests.push(pathname);
      };
      page.on("request", trackChatProfileRequest);
      await page.locator('.nav [data-tab="chat"]').click();
      await page.locator(".chat-list-screen").waitFor({ state: "visible" });
      assert.equal(await page.locator("#chat-search-panel").count(), 0,
        "Messages opens without an unrequested inline search field");
      const headerBottomBorder = await page.locator(".chat-list-heading").evaluate(element => {
        const style = getComputedStyle(element);
        return { width: style.borderBottomWidth, style: style.borderBottomStyle };
      });
      assert.ok(
        (!headerBottomBorder.width || headerBottomBorder.width === "0px") && headerBottomBorder.style !== "solid",
        `Messages header has no divider underneath it (${JSON.stringify(headerBottomBorder)})`,
      );
      if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-inbox-restored.png" });
       const emptyChat = page.locator("#crows .chat-inbox-row").filter({ hasText: "New Chat Member" });
       await emptyChat.waitFor({ state: "visible" });
       await emptyChat.click();
       await page.locator(".chat-empty-intro").waitFor({ state: "visible" });
       await page.locator(".chat-empty-avatar img").waitFor({ state: "visible" });
       await page.waitForFunction(() => {
         const toast = document.querySelector(".toast");
         const screen = document.querySelector(".conversation-screen");
         return (!toast || getComputedStyle(toast).display === "none") && screen && getComputedStyle(screen).opacity === "1";
       }, null, { timeout: 5000 });
       assert.match(await page.locator(".chat-empty-profile").innerText(), /New Chat Member[\s\S]*@newchatmember[\s\S]*Follow/);
       assert.equal(await page.locator(".chat-empty-stats").count(), 0,
         "the main chat intro omits follower and following totals");
       assert.equal(await page.locator("#send-hi-sticker").count(), 1, "the empty main thread keeps its first-message wave sticker");
       const expectedEmptyChatDate = await page.evaluate(() => new Date(1700000000000)
         .toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
       assert.equal(await page.locator(".chat-empty-date").innerText(), expectedEmptyChatDate,
         "the empty-thread date comes from the server-backed conversation creation time");
       if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-empty-thread.png" });
       await page.locator("#back").click();
       await page.locator(".chat-list-screen").waitFor({ state: "visible" });
       const directChat = page.locator("#crows .chat-inbox-row").filter({ hasText: "Story Member" });
       await directChat.waitFor({ state: "visible" });
       await directChat.click();
       await page.locator("#vcall").waitFor({ state: "visible" });
       assert.equal(await page.locator("#vcall").count(), 1, "one-to-one chats expose a single voice-call action");
       assert.equal(await page.locator("#vid").count(), 0, "video is enabled from inside the call rather than duplicating chat actions");
        await page.locator("#chat-more").waitFor({ state: "visible" });
        await page.locator("#chat-more").click();
        const directThreadActions = page.locator(".chat-thread-actions-menu [role='menuitem']");
        assert.deepEqual(await directThreadActions.allTextContents(), ["Mute notifications", "Block"],
          "the one-to-one thread menu contains only mute and block");
        const threadMenuSurface = await page.locator(".chat-thread-actions-menu .post-actions-menu-items").evaluate(element => ({
          background: getComputedStyle(element).backgroundColor,
          radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
        }));
        assert.equal(threadMenuSurface.background, "rgb(255, 255, 255)",
          "thread actions use the shared white menu surface");
        assert.ok(threadMenuSurface.radius >= 14,
          `thread actions use the shared rounded menu shape: ${JSON.stringify(threadMenuSurface)}`);
        await page.locator("[data-chat-thread-mute]").click();
        await page.locator("#sheet [data-l='Unmute']").waitFor({ state: "visible" });
        await page.locator("#sheet [data-l='Unmute']").click();
        await page.locator("#chat-more").waitFor({ state: "visible" });
        await page.locator("#chat-more").click();
        await page.locator("[data-chat-thread-block]").click();
        await page.locator(".conversation-screen").waitFor({ state: "visible" });
        const threadScrollFixture = await page.addStyleTag({ content: `
          .conversation-messages {height:220px!important;max-height:220px!important;overflow-y:auto!important}
          .conversation-messages::after {content:"";display:block;height:900px;flex:0 0 900px}
        ` });
        const savedThreadOffset = await page.locator("#msgs").evaluate(element => {
          element.scrollTop = 180;
          return element.scrollTop;
        });
        assert.ok(savedThreadOffset > 0);
        await page.locator("#info").click();
        await page.locator(".chat-details-screen").waitFor({ state: "visible" });
        await page.locator("#contact-profile-shortcut").waitFor({ state: "visible" });
        await page.locator("#contact-search-shortcut").waitFor({ state: "visible" });
         await page.locator("#contact-create-group-shortcut").waitFor({ state: "visible" });
         assert.equal(await page.locator("#contact-follow").count(), 0, "chat details do not show a duplicate Follow button");
         assert.equal(await page.locator(".contact-stats").count(), 0,
           "chat details omit follower and following totals");
        page.off("request", trackChatProfileRequest);
        assert.deepEqual(chatProfileStatRequests, [],
          "opening conversations and details does not fetch profile stats");
        await page.locator("#back").click();
        await page.locator(".conversation-screen").waitFor({ state: "visible" });
        assert.equal(await page.locator("#msgs").evaluate(element => element.scrollTop), savedThreadOffset,
          "details navigation keeps the previous message-reading position");
        await threadScrollFixture.evaluate(element => element.remove());
       await page.locator("#back").click();
       await page.locator(".chat-list-screen").waitFor({ state: "visible" });
      const generalChat = page.locator("#crows .chat-inbox-row").filter({ hasText: "General test group" });
      await generalChat.waitFor({ state: "visible" });
      await generalChat.click();
       assert.equal(await page.locator("#vcall").count(), 0, "group chats do not expose unsupported calling actions");
       assert.equal(await page.locator("#vid").count(), 0, "group chats do not expose unsupported video calls");
      await page.locator("#chat-more").click();
      assert.deepEqual(
        await page.locator(".chat-thread-actions-menu [role='menuitem']").allTextContents(),
        ["Mute notifications"],
        "group threads expose mute without offering to block an entire group",
      );
      await page.locator("#chat-more").click();
      await page.locator("#msg").waitFor({ state: "visible" });
      const incoming = page.locator("#msgs .bubble-msg").first();
      const outgoing = page.locator("#msgs .bubble-msg.mine").first();
      await incoming.waitFor({ state: "visible" });
      await outgoing.waitFor({ state: "visible" });
      const alignment = await page.evaluate(() => {
        const measure = element => {
          const bubble = element.getBoundingClientRect();
          const row = element.closest(".message-row").getBoundingClientRect();
          const list = document.querySelector("#msgs").getBoundingClientRect();
          return {
            bubbleLeft: bubble.left, bubbleRight: bubble.right,
            rowLeft: row.left, rowRight: row.right,
            listLeft: list.left, listRight: list.right,
            alignSelf: getComputedStyle(element).alignSelf,
            rowAlign: getComputedStyle(element.closest(".message-row")).alignItems,
          };
        };
        return {
          incoming: measure(document.querySelector("#msgs .bubble-msg")),
          outgoing: measure(document.querySelector("#msgs .bubble-msg.mine")),
        };
      });
      assert.ok(alignment.incoming.bubbleLeft < (alignment.incoming.listLeft + alignment.incoming.listRight) / 2,
        `messages from other members stay on the left: ${JSON.stringify(alignment)}`);
      assert.ok(alignment.outgoing.bubbleRight > (alignment.outgoing.listLeft + alignment.outgoing.listRight) / 2,
        `messages from the signed-in sender stay on the right: ${JSON.stringify(alignment)}`);
      const threadDock = await page.evaluate(() => {
        const screen = document.querySelector(".conversation-screen");
        const list = document.querySelector("#msgs");
        const composer = document.querySelector(".chat-composer");
        const lastMessage = list.querySelector(".message-row:last-child");
        return {
          composerPosition: getComputedStyle(composer).position,
          composerBottomGap: screen.getBoundingClientRect().bottom - composer.getBoundingClientRect().bottom,
          lastMessageGap: composer.getBoundingClientRect().top - lastMessage.getBoundingClientRect().bottom,
          messagePaneBottom: list.getBoundingClientRect().bottom,
          composerTop: composer.getBoundingClientRect().top,
          listAtBottom: list.scrollHeight - list.clientHeight - list.scrollTop,
        };
      });
      assert.equal(threadDock.composerPosition, "relative",
        "the composer occupies its own space instead of covering chat messages");
      assert.ok(threadDock.composerBottomGap >= 7 && threadDock.composerBottomGap <= 40,
        `the composer sits just above the device safe area: ${JSON.stringify(threadDock)}`);
      assert.ok(threadDock.lastMessageGap >= 8,
        `the latest message remains fully above the composer: ${JSON.stringify(threadDock)}`);
      assert.ok(threadDock.composerTop >= threadDock.messagePaneBottom - 1,
        `the message pane ends before the composer begins: ${JSON.stringify(threadDock)}`);
      assert.ok(threadDock.listAtBottom <= 2,
        `opening a new conversation shows the latest messages: ${JSON.stringify(threadDock)}`);
      const chatViewport = page.viewportSize();
      if (chatViewport) {
        await page.setViewportSize({ width: chatViewport.width, height: Math.min(chatViewport.height, 620) });
      }
      await page.locator("#msg").evaluate(input => { input.style.height = "112px"; });
      await page.locator("#msgs").evaluate(list => { list.scrollTop = list.scrollHeight; });
      const expandedComposerDock = await page.evaluate(() => {
        const list = document.querySelector("#msgs");
        const composer = document.querySelector(".chat-composer");
        const lastMessage = list.querySelector(".message-row:last-child");
        return {
          listBottom: list.getBoundingClientRect().bottom,
          composerTop: composer.getBoundingClientRect().top,
          composerBottom: composer.getBoundingClientRect().bottom,
          lastMessageBottom: lastMessage.getBoundingClientRect().bottom,
          screenBottom: document.querySelector(".conversation-screen").getBoundingClientRect().bottom,
        };
      });
      assert.ok(expandedComposerDock.composerTop >= expandedComposerDock.listBottom - 1,
        `an expanded composer stays below the scrollable message pane: ${JSON.stringify(expandedComposerDock)}`);
      assert.ok(expandedComposerDock.lastMessageBottom <= expandedComposerDock.composerTop - 4,
        `the latest message stays above a taller composer: ${JSON.stringify(expandedComposerDock)}`);
      assert.ok(expandedComposerDock.composerBottom <= expandedComposerDock.screenBottom,
        `the composer remains inside a shorter mobile viewport: ${JSON.stringify(expandedComposerDock)}`);
      await page.locator("#msg").evaluate(input => input.style.removeProperty("height"));
      if (chatViewport) await page.setViewportSize(chatViewport);
      await page.locator("#info").click();
      await page.locator(".chat-details-screen").waitFor({ state: "visible" });
       await page.locator("#details-more").waitFor({ state: "visible" });
      const locationControls = await page.locator(".details-options").innerText();
      assert.match(locationControls, /Share location[\s\S]*Request location/,
        "Share location and Request location appear together in conversation details");
      await page.locator("#media").click();
      await page.locator('[data-testid="chat-shared-media-empty"]').waitFor({ state: "visible" });
      assert.match(await page.locator(".chat-shared-media-empty").innerText(), /No shared media[\s\S]*Photos, videos, files, and voice messages/i);
      if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-shared-media.png" });
      await page.locator("#back").click();
      await page.locator(".chat-details-screen").waitFor({ state: "visible" });
      await page.locator("#back").click();
      await page.locator(".conversation-screen").waitFor({ state: "visible" });
      await page.locator("#chat-add").click();
      await page.locator("#chat-compose-tools").waitFor({ state: "visible" });
      const actions = await page.locator("#chat-compose-tools button").evaluateAll(buttons => buttons.map(button => ({
        label: button.innerText.trim(),
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
        scrollWidth: button.scrollWidth,
        clientWidth: button.clientWidth,
      })));
       assert.equal(actions.length, 3, "composer tools include attachments, emoji, and message settings");
      for (const action of actions) {
        assert.ok(action.width > 120, `attachment action "${action.label}" has room to wrap by word: ${JSON.stringify(action)}`);
        assert.ok(action.height < 90, `attachment action "${action.label}" doesn't stack one character per line: ${JSON.stringify(action)}`);
        assert.ok(action.scrollWidth <= action.clientWidth + 1, `attachment action "${action.label}" doesn't clip horizontally: ${JSON.stringify(action)}`);
      }
      await page.locator("#attach").click();
      await page.locator(".chat-attachment-panel").waitFor({ state: "visible" });
      const choices = await page.locator("[data-attachment-choice]").evaluateAll(buttons =>
        buttons.map(button => button.dataset.attachmentChoice));
      assert.deepEqual(choices, ["Media", "Document", "Contact", "View once"]);
      assert.doesNotMatch(await page.locator(".chat-attachment-panel").innerText(), /\bGIF\b|\bPoll\b|\bSticker\b/i);
      if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-attachments.png" });
      await page.locator(".chat-attachment-close").click();
      await page.context().grantPermissions(["geolocation"]);
      await page.context().setGeolocation({ latitude: 37.422, longitude: -122.08406, accuracy: 15 });
      await page.locator("#info").click();
      await page.locator(".chat-details-screen").waitFor({ state: "visible" });
      await page.locator("#location-share").click();
      await page.locator(".chat-location-share-panel").waitFor({ state: "visible" });
      assert.match(await page.locator(".chat-location-share-panel").innerText(), /only sent after you confirm/i);
      const bubbleCountBeforeLocation = await page.locator("#msgs .bubble-msg").count();
      await page.locator(".chat-location-get").click();
      await page.locator(".chat-location-confirm").waitFor({ state: "visible" });
      assert.match(await page.locator(".chat-location-share-panel").innerText(), /accuracy/i);
       assert.equal(await page.locator(".chat-location-share-map").count(), 1,
         "the location review includes an inline map before sharing");
      await page.waitForFunction(() => {
        const map = document.querySelector(".chat-location-share-map");
        return map?.dataset.mapReady === "true" || map?.dataset.mapError === "true";
      }, null, { timeout: 20000 });
      assert.equal(await page.locator(".chat-location-share-map").getAttribute("data-map-ready"), "true",
        "the location review displays the loaded map, not a placeholder");
      assert.equal(await page.locator("#msgs .bubble-msg").count(), bubbleCountBeforeLocation,
        "getting a fix does not send it before the separate confirmation");
      if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-location-review.png" });
      await page.locator(".chat-location-cancel").click();
      assert.equal(await page.locator("#msgs .bubble-msg").count(), bubbleCountBeforeLocation,
        "cancel leaves the conversation unchanged");
      await page.locator("#info").click();
      await page.locator(".chat-details-screen").waitFor({ state: "visible" });
      await page.locator("#location-share").click();
      await page.locator(".chat-location-get").click();
      await page.locator(".chat-location-confirm").waitFor({ state: "visible" });
      await page.locator(".chat-location-confirm").click();
      const sharedLocation = page.locator(".chat-location-card").last();
      await sharedLocation.waitFor({ state: "visible" });
      const sharedMap = sharedLocation.locator("[data-chat-location-map]");
      await page.waitForFunction(() => {
        const maps = [...document.querySelectorAll("#msgs .chat-location-card [data-chat-location-map]")];
        return maps.some(map => map.dataset.mapReady === "true" || map.dataset.mapError === "true");
      }, null, { timeout: 20000 });
      assert.equal(await sharedMap.getAttribute("data-map-ready"), "true",
        "the sent location card displays the loaded map, not a placeholder");
       assert.equal(await sharedLocation.locator("[data-open-chat-location]").count(), 1,
          "the location preview opens an in-app map instead of redirecting to an external map");
       assert.equal(await sharedLocation.locator("[data-chat-location-map]").getAttribute("data-latitude"), "37.422");
       assert.equal(await sharedLocation.locator("[data-chat-location-map]").getAttribute("data-longitude"), "-122.08406");
       await sharedLocation.locator("[data-open-chat-location]").click();
       await page.locator(".chat-location-map-panel").waitFor({ state: "visible" });
       await page.waitForFunction(() => {
         const map = document.querySelector(".chat-location-full-map");
         return map?.dataset.mapReady === "true" || map?.dataset.mapError === "true";
       }, null, { timeout: 20000 });
       assert.equal(await page.locator(".chat-location-full-map").getAttribute("data-map-ready"), "true",
         "the expanded shared map loads inside Oldtime");
       if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-location-in-app-map.png" });
       await page.locator(".chat-location-map-close").click();
       await page.locator(".conversation-screen").waitFor({ state: "visible" });
        await page.locator("#info").click();
        await page.locator(".chat-details-screen").waitFor({ state: "visible" });
        await page.locator("#location-request").click();
      const locationRequest = page.locator(".chat-location-request-card").last();
      await locationRequest.waitFor({ state: "visible" });
      assert.match(await locationRequest.innerText(), /Location requested|Waiting for their choice/);
      assert.equal(await locationRequest.locator("[data-location-request]").count(), 0,
        "the sender cannot use their own request card to share a location");
      if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-location-request.png" });
      await page.locator("#back").click();
      await page.locator(".chat-list-screen").waitFor({ state: "visible" });
      await page.locator("#chat-list-picker-toggle").click();
      await page.locator("#newchat").click();
      await page.locator(".chat-compose-panel").waitFor({ state: "visible" });
      assert.equal(await page.locator(".chat-compose-header h2").innerText(), "New chat");
      assert.equal(await page.locator("#chat-compose-create-group").isVisible(), true);
      await page.locator("#chat-contact-search").fill("storymember");
      await page.locator("[data-pick]").first().waitFor({ state: "visible" });
      assert.equal(await page.locator("[data-pick]").first().locator(".chat-compose-avatar img").count(), 1);
      if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-new-message.png" });
      await page.locator("#chat-compose-create-group").click();
      await page.locator(".chat-compose-panel.is-group-mode").waitFor({ state: "visible" });
      assert.equal(await page.locator("#chat-compose-switch").isVisible(), true);
      await page.locator("#chat-compose-switch").click();
      await page.locator(".chat-compose-panel.is-message-mode").waitFor({ state: "visible" });
      assert.equal(await page.locator(".chat-compose-header h2").innerText(), "New chat");
      await page.locator("#chat-compose-cancel").click();
      return;
    }
    if (process.env.OLDTIME_VIDEO_STORY_SHARE_ONLY === "1") {
      communityPost.text = "A cloud-backed video for the Story sharing test";
      communityPost.destination = "home";
      communityPost.kind = "video";
      communityPost.mediaTypes = ["video/webm"];
      communityPost.mediaPosters = [testImageMedia];
      communityPost.media = [{
        id: "browser-repost-video",
        contentType: "video/webm",
        reference: testVideoMedia,
        thumbnailReference: testImageMedia,
      }];
      showRepostFixture = true;
      creationMediaReserved = false;
      publishedStory = null;
      const feedResponse = page.waitForResponse(response =>
        response.url().includes("/api/feed") && response.request().method() === "GET"
      );
      await page.reload({ waitUntil: "networkidle" });
      await feedResponse;
      const post = page.locator('.clip[data-id="browser-repost-post"]');
      await post.waitFor({ state: "visible" });
      await post.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(150);
      await post.locator(".media-action-row [data-share]").click();
      await page.locator("[data-share-story]").click();
      const sendButton = page.locator('[data-testid="button-send-status"]');
      await sendButton.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const button = document.querySelector('[data-testid="button-send-status"]');
        return button && !button.disabled;
      });
      const audienceSettingsButton = page.locator('[data-testid="button-story-audience-settings"]');
      await audienceSettingsButton.click();
      const audienceSheet = page.locator('[data-testid="story-audience-sheet"]');
      await audienceSheet.waitFor({ state: "visible" });
      const sheetCloseFriends = page.locator('[data-testid="button-settings-audience-close-friends"]');
      await sheetCloseFriends.click();
      assert.equal(await sheetCloseFriends.getAttribute("aria-checked"), "true",
        "the top Story settings control selects Close Friends");
      const closeFriendsAudience = page.locator('[data-testid="button-audience-close-friends"]');
      await closeFriendsAudience.waitFor({ state: "visible" });
      assert.equal(await closeFriendsAudience.getAttribute("aria-checked"), "true",
        "the existing audience control stays synchronized with Story settings");
      assert.equal(await page.locator('[data-testid="button-audience-public"]').getAttribute("aria-checked"), "false",
        "Everyone is not selected at the same time");
      const friendSearch = page.locator('[data-testid="input-close-friends-search"]');
      const friendResults = page.locator("[data-cf-results]");
      await friendSearch.fill("groupmember");
      await page.waitForFunction(() => document.querySelector("[data-cf-results]")?.textContent?.includes("No confirmed Friends match"));
      assert.doesNotMatch(await friendResults.innerText(), /Group Member Online/,
        "search results exclude accounts who are not confirmed Friends");
      await friendSearch.fill("storymember");
      const currentFriend = page.locator(`[data-cf-current] [data-close-friend-id="${closeFriendProfile.id}"]`);
      await currentFriend.waitFor({ state: "visible" });
      await currentFriend.click();
      const saveFriends = page.locator('[data-testid="button-save-close-friends"]');
      const removeFriendResponse = page.waitForResponse(response =>
        response.url().endsWith("/api/close-friends") && response.request().method() === "PUT"
      );
      await saveFriends.click();
      await removeFriendResponse;
      assert.deepEqual(closeFriendIds, [], "removing a member persists to the server");
      const addFriend = page.locator(`[data-cf-results] [data-close-friend-id="${closeFriendProfile.id}"]`);
      await addFriend.waitFor({ state: "visible" });
      await addFriend.click();
      const restoreFriendResponse = page.waitForResponse(response =>
        response.url().endsWith("/api/close-friends") && response.request().method() === "PUT"
      );
      await saveFriends.click();
      await restoreFriendResponse;
      assert.deepEqual(closeFriendIds, [closeFriendProfile.id], "saving keeps the selected Close Friend on the server");
      await page.locator('[data-testid="button-done-audience"]').click();
      await audienceSheet.waitFor({ state: "hidden" });
      const storyResponse = page.waitForResponse(response =>
        response.url().endsWith("/api/stories") && response.request().method() === "POST",
      { timeout: 25000 }).then(() => "published").catch(() => "timeout");
      const sendError = page.locator('[data-testid="text-send-error"]')
        .waitFor({ state: "visible", timeout: 25000 }).then(() => "error").catch(() => "timeout");
      await sendButton.click();
      const publishOutcome = await Promise.race([storyResponse, sendError]);
      if (publishOutcome !== "published") {
        throw new Error(`Feed video Story publish ${publishOutcome}; detail=${await page.locator('[data-testid="text-send-error"]').textContent().catch(() => "")}; button=${await sendButton.textContent().catch(() => "")}; API calls=${storyApiCalls.join(", ")}`);
      }
      assert.ok(publishedStory?.hasMedia && (publishedStory.mediaType === "video" || publishedStory.mediaType?.startsWith("video/")) && creationMediaReserved,
        `Feed video must publish as Story media; story=${JSON.stringify(publishedStory)} reserved=${creationMediaReserved}`);
      assert.equal(publishedStory?.visibility, "close-friends",
        "the selected Close Friends audience is sent to the Cloudflare Story API");
      assert.deepEqual(pageErrors, []);
      return;
    }
    if (process.env.OLDTIME_PROFILE_POSTS_ONLY === "1") {
      await openOwnProfile(page);
      await page.locator('#profile-content-grid [data-open="profile-grid-image"]').waitFor({ state: "visible" });
      assert.equal(await page.locator('#profile-content-grid [data-open="profile-grid-video"]').count(), 1,
        "Posts includes photos and videos loaded directly from the profile API, even when Home failed to load");
      assert.equal(await page.locator('#profile-content-grid [data-open="profile-grid-note"]').count(), 0,
        "Community text remains in its separate profile tab");
      await page.locator("#profile-tab-videos").click();
      assert.equal(await page.locator('#profile-content-grid [data-open="profile-grid-image"]').count(), 0);
      assert.equal(await page.locator('#profile-content-grid [data-open="profile-grid-video"]').count(), 1);
      await page.locator("#profile-tab-posts").click();
      assert.equal(await page.locator("#profile-content-grid .profile-content-post-actions-menu").count(), 0,
        "Profile post cards do not show three-dot controls");
      await page.locator('#profile-content-grid [data-open="profile-grid-video"]').click();
      await page.locator('.post-viewer-screen.post-viewer-media .clip.post-detail[data-id="profile-grid-video"]').waitFor({ state: "visible" });
       const profileViewerClip = page.locator('.post-viewer-screen.post-viewer-profile .clip.post-detail[data-id="profile-grid-video"]');
       const profileViewerControls = profileViewerClip.locator(".post-viewer-media-controls");
       const profileViewerRow = profileViewerControls.locator(".media-action-row");
       const soundControl = profileViewerControls.locator(".media-action-sound-toggle");
       const profileViewerMeta = profileViewerClip.locator(".post-viewer-media-info > .meta");
       await profileViewerMeta.waitFor({ state: "visible" });
       assert.equal(await profileViewerMeta.locator(".feed-author-name").innerText(), "Test Member",
         "the full-screen viewer keeps the creator's name visible");
       assert.match(await profileViewerMeta.locator(".cap").innerText(), /video in the community timeline/i,
         "the full-screen viewer keeps the post caption visible");
       const soundAppearance = await soundControl.evaluate(button => ({
         width: button.getBoundingClientRect().width,
         height: button.getBoundingClientRect().height,
         borderWidth: getComputedStyle(button).borderWidth,
         borderRadius: getComputedStyle(button).borderRadius,
         background: getComputedStyle(button).backgroundColor,
         iconWidth: button.querySelector("svg")?.getBoundingClientRect().width,
         iconHeight: button.querySelector("svg")?.getBoundingClientRect().height,
       }));
       assert.deepEqual(soundAppearance, {
         width: 36, height: 36, borderWidth: "0px", borderRadius: "0px",
         background: "rgba(0, 0, 0, 0)", iconWidth: 16, iconHeight: 16,
       }, `the sound glyph is small and unboxed: ${JSON.stringify(soundAppearance)}`);
       await page.screenshot({ path: "/tmp/oldtime-unified-profile-media.png" });
       assert.equal(await profileViewerClip.locator(":scope > .rail").count(), 0,
         "the old vertical media rail is absent from profile posts");
        for (const action of ["like", "comment", "save"]) {
          assert.equal(await profileViewerRow.locator(`[data-${action}="profile-grid-video"]`).count(), 1,
           `the profile full-screen viewer exposes its ${action} action`);
       }
        assert.equal(await profileViewerRow.locator('[data-repost="profile-grid-video"]').count(), 0,
          "the profile action row does not add Repost");
        const profilePrompt = profileViewerControls.locator(".post-viewer-media-prompt");
       assert.equal(await profilePrompt.innerText(), "Say something",
         "the profile viewer keeps the Say something prompt");
       await profilePrompt.click();
       await page.locator(".comment-panel").waitFor({ state: "visible" });
       await page.locator("#cbody").waitFor({ state: "visible" });
       assert.equal(await page.locator("#cbody").evaluate(element => document.activeElement === element), true,
         "tapping Say something opens and focuses the comment input");
       await page.locator("#comment-close").click();
       for (const width of [402, 320]) {
         await page.setViewportSize({ width, height: 874 });
         const row = await page.evaluate(() => {
            const controls = document.querySelector('.clip.post-detail[data-id="profile-grid-video"] .post-viewer-media-controls');
            const composer = controls?.querySelector(".post-viewer-media-prompt")?.getBoundingClientRect();
            const actions = controls?.querySelector(".media-action-row")?.getBoundingClientRect();
            const bounds = controls?.getBoundingClientRect();
            const prompt = controls?.querySelector(".post-viewer-media-prompt");
             const buttons = [...(controls?.querySelectorAll(".media-action-row [data-like], .media-action-row [data-comment], .media-action-row [data-save], .media-action-row [data-share]") || [])];
            const counts = [...(controls?.querySelectorAll(".media-action-row .act-count") || [])].map(element => ({
             text: element.textContent.trim(), width: element.getBoundingClientRect().width,
             scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
           }));
           return composer && actions && bounds ? {
             composerRight: composer.right, composerCenter: composer.top + composer.height / 2,
             actionsLeft: actions.left, actionsRight: actions.right, actionsCenter: actions.top + actions.height / 2,
             footerLeft: bounds.left, footerRight: bounds.right,
             promptFlexShrink: getComputedStyle(prompt).flexShrink,
             buttonHeights: buttons.map(button => button.getBoundingClientRect().height),
             promptHeight: composer.height, counts,
           } : null;
         });
         assert.ok(row, `the bottom action row renders at ${width}px`);
         assert.ok(row.actionsLeft >= row.composerRight - 1, `icons sit to the right of Say something at ${width}px`);
         assert.ok(row.actionsRight <= row.footerRight + 1 && row.actionsLeft >= row.footerLeft - 1,
           `the bottom action row fits at ${width}px`);
         assert.ok(Math.abs(row.composerCenter - row.actionsCenter) <= 2,
           `composer and icons share one horizontal row at ${width}px`);
         assert.equal(row.promptFlexShrink, "1", `the prompt gives up space before numbers at ${width}px`);
         assert.ok(row.buttonHeights.every(height => Math.abs(height - 44) <= 1),
            `Like, Comment, and Save tap targets are 44px at ${width}px`);
          assert.deepEqual(row.counts.slice(0, 2).map(count => count.text), ["123.4m", "9.8m"],
            `large like and comment counts stay visible at ${width}px`);
          assert.equal(row.counts.length, 3, "the Save count appears beside the other actions");
         assert.ok(row.counts.every(count => count.scrollWidth <= count.clientWidth && count.width > 0),
           `large counts are not clipped at ${width}px`);
       }
        const profileViewerMenu = profileViewerClip.locator(":scope > .media-post-options");
        assert.equal(await profileViewerMenu.count(), 1,
          "full-screen Profile posts keep the post-options menu");
        await profileViewerMenu.locator(":scope > summary").click();
        for (const action of ["data-post-engagement-open", "data-post-viewer-download", "data-post-edit",
          "data-post-archive", "data-delete-post", "data-post-cover-edit"]) {
          assert.equal(await profileViewerMenu.locator(`[${action}="profile-grid-video"]`).count(), 1,
            `the owner menu includes ${action}`);
        }
        assert.equal(await profileViewerMenu.locator("[data-post-report], [data-post-not-interested]").count(), 0,
          "owner posts do not show viewer-only actions");
        await profileViewerMenu.locator(":scope > summary").click();
       assert.equal(await profileViewerClip.locator(":scope > .media-action-row").count(), 0,
         "the old action rail is not duplicated beside the new horizontal row");
      await page.locator("#post-viewer-back").click();
      await page.locator('#profile-content-grid [data-open="profile-grid-image"]').waitFor({ state: "visible" });
      await page.screenshot({ path: "/tmp/oldtime-profile-published-posts.png" });
      await page.locator("#profile-tab-community").click();
      const communityTextCard = page.locator('#profile-content-grid [data-testid="card-community-post-profile-grid-note"]');
      await communityTextCard.waitFor({ state: "visible" });
        const communityPostMenu = communityTextCard.locator(".community-post-actions-menu");
        assert.equal(await communityPostMenu.count(), 1, "Community post menus remain available");
        await communityPostMenu.locator(":scope > summary").click();
        assert.equal(await communityPostMenu.locator(".post-actions-menu-items").isVisible(), true,
          "Community post menu actions stay functional");
        await communityPostMenu.locator(":scope > summary").click();
      const communityText = communityTextCard.locator(".community-post-copy");
      assert.equal(await communityText.evaluate(element => element.tagName), "P");
      assert.equal(await communityText.getAttribute("data-stories-post"), null);
      await communityTextCard.locator("[data-share]").click();
      await page.locator(".srp-main-view .srp-text-snapshot").waitFor({ state: "visible" });
      const preview = page.locator(".srp-main-view .srp-text-snapshot");
      assert.match(await preview.innerText(), /A thought from the test profile/);
      assert.equal(await page.locator(".srp-main-view .srp-section-label").evaluate(element => getComputedStyle(element).color),
        "rgb(23, 25, 29)", "share labels use readable dark text on white");
      assert.equal(await page.locator(".srp-main-view").evaluate(element => element.classList.contains("srp-community-share")), true);
      if (process.env.OLDTIME_SHARE_TEXT_SCREENSHOT === "1") {
        await page.screenshot({ path: "/tmp/oldtime-community-share-preview.png" });
      }
      if (process.env.OLDTIME_COMMUNITY_TEXT_STORY_ONLY === "1") {
        await page.locator("[data-share-story]").click();
        const storyCanvas = page.locator('[data-testid="canvas-status"]');
        await page.waitForTimeout(1200);
        if (!await storyCanvas.isVisible().catch(() => false)) {
          await page.screenshot({ path: "/tmp/oldtime-community-text-story-failed.png" }).catch(() => {});
          const state = await page.evaluate(() => ({
            notice: document.querySelector(".toast")?.textContent || "",
            body: document.body.innerText.slice(-500),
            canvas: (() => {
              const element = document.querySelector('[data-testid="canvas-status"]');
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              return { display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
            })(),
          }));
          throw new Error(`Community Story editor did not open: ${JSON.stringify({ ...state, pageErrors })}`);
        }
        await page.waitForFunction(() => {
          const button = document.querySelector('[data-testid="button-send-status"]');
          return button && !button.disabled;
        });
        const box = await storyCanvas.boundingBox();
        assert.ok(box, "the Story editor canvas is available");
        await storyCanvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
        await page.locator(".sc-ov-ctl").waitFor({ state: "visible" });
        if (process.env.OLDTIME_COMMUNITY_TEXT_STORY_SCREENSHOT === "1") {
          await page.screenshot({ path: "/tmp/oldtime-community-text-story-initial.png" });
        }
        const beforePinch = await storyCanvas.evaluate(canvas => canvas.toDataURL("image/png"));
        await storyCanvas.evaluate(canvas => {
          const bounds = canvas.getBoundingClientRect();
          const x = bounds.left + bounds.width / 2;
          const y = bounds.top + bounds.height / 2;
          const dispatch = (type, pointerId, clientX) => canvas.dispatchEvent(new PointerEvent(type, {
            bubbles: true, pointerId, pointerType: "touch", isPrimary: pointerId === 1,
            button: 0, buttons: type === "pointerup" ? 0 : 1, clientX, clientY: y,
          }));
          dispatch("pointerdown", 1, x - 14);
          dispatch("pointerdown", 2, x + 14);
          dispatch("pointermove", 1, x - 38);
          dispatch("pointermove", 2, x + 38);
          dispatch("pointerup", 1, x - 38);
          dispatch("pointerup", 2, x + 38);
        });
        await page.waitForTimeout(100);
        const afterPinch = await storyCanvas.evaluate(canvas => canvas.toDataURL("image/png"));
        assert.notEqual(afterPinch, beforePinch, "the shared post snapshot responds to a pinch resize");
        if (process.env.OLDTIME_COMMUNITY_TEXT_STORY_SCREENSHOT === "1") {
          await page.screenshot({ path: "/tmp/oldtime-community-text-story.png" });
        }
        assert.deepEqual(pageErrors, []);
        return;
      }
      await page.locator("[data-social-sheet-close]").click();
      await page.locator(".srp-main-view").waitFor({ state: "detached" });
      await communityText.click();
      assert.equal(await page.locator('.clip.post-detail[data-id="profile-grid-note"]').count(), 0,
        "a text-only Community post in Profile never opens as a full-screen picture");
      await page.locator(".community-original-post-panel").waitFor({ state: "visible" });
      assert.match(await page.locator(".community-original-post-card").innerText(), /A thought from the test profile/);
      await page.locator("[data-original-post-close]").click();
      await page.locator(".community-original-post-panel").waitFor({ state: "detached" });
      assert.deepEqual(pageErrors, []);
      return;
    }
    if (process.env.OLDTIME_PEOPLE_LAYOUT_ONLY === "1") {
      await page.evaluate(async () => {
        const community = await import("/app/community-feeds.js");
        const root = document.querySelector("#app");
        const posts = [1, 2, 3, 4].map(id => ({ id: String(id) }));
        const deps = {
          api: {
            cloudAccountId: () => "people-layout-fixture",
            me: () => ({ id: "people-layout-fixture", following: [], friends: [] }),
            cloudPost: id => posts.find(post => post.id === id),
            cacheCloudExplorePosts: value => value, blocked: () => false,
            db: () => ({ requests: [], blocks: [] }),
          },
          requestCloudApi: async path => path.endsWith("/preferences")
            ? { preferences: { pinned: ["discover"], filters: {}, mutedWords: [], mutedAccounts: [], caughtUp: {} }, mutedAccounts: [] }
            : path.includes("/lists") ? { lists: [] }
              : path.includes("/people") ? { suggestions: [
                { profile: { id: "one", username: "one", displayName: "Short name" } },
                { profile: { id: "two", username: "two", displayName: "A much longer creator name" }, reason: "mutual-followers" },
                { profile: { id: "three", username: "three", displayName: "Shared interest" }, sharedInterests: ["Art"] },
              ] } : { posts, hasMore: false, nextOffset: 4 },
          app: root, shell: html => { root.innerHTML = `<div class="phone">${html}</div>`; },
          esc: value => String(value ?? ""), icon: () => "", toast() {},
          renderPost: post => `<article data-fixture-post="${post.id}" style="padding:24px">Post ${post.id}</article>`,
          bindPosts() {}, isActive: () => false, refresh() {},
          onCompose() {}, onSearch() {}, onProfile() {}, onFollow() {},
        };
        for (let pass = 0; pass < 3; pass++) {
          community.renderCommunityFeeds(deps);
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      });
      const rows = page.locator(".cf-suggestions");
      assert.equal(await rows.count(), 2);
      const firstRowCards = rows.first().locator("article");
      const alignment = await firstRowCards.evaluateAll(cards => cards.map(card => ({
        profile: card.querySelector(".cf-view-profile").getBoundingClientRect().top,
        follow: card.querySelector(".cf-follow").getBoundingClientRect().top,
        height: card.getBoundingClientRect().height,
      })));
      assert.deepEqual(alignment[0], alignment[1], "different name and reason lengths must not shift actions");
      const placement = await page.evaluate(() => ({
        lastPost: document.querySelector('[data-fixture-post="4"]').getBoundingClientRect().bottom,
        interestRow: document.querySelector('.cf-suggestions[aria-label="People who share your interests"]').getBoundingClientRect().top,
        lastSection: document.querySelector(".stories-feed-scroll").lastElementChild.getAttribute("aria-label"),
      }));
      assert.ok(placement.interestRow >= placement.lastPost);
      assert.equal(placement.lastSection, "People who share your interests");
      await page.screenshot({ path: "/tmp/oldtime-people-rows.png" });
      assert.deepEqual(pageErrors, []);
      return;
    }
    if (process.env.OLDTIME_VIEWER_GEOMETRY_ONLY === "1") {
      // Exercise the real application stylesheet cascade, including the older
      // post-detail rules, without reading or mutating any member content.
      const poster = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960"><rect width="540" height="960" fill="#1456d9"/><circle cx="270" cy="480" r="180" fill="#fff"/></svg>')}`;
      for (const size of [{ width: 471, height: 820 }, { width: 390, height: 700 }]) {
        await page.setViewportSize(size);
        for (const kind of ["photo", "video", "carousel-video"]) {
          await page.evaluate(({ kind, poster }) => {
            const media = kind === "photo" ? `<img class="fullimg" src="${poster}" alt="">`
              : kind === "video" ? `<video poster="${poster}" playsinline></video>`
                : `<div class="post-carousel"><video class="fullimg carousel-video" poster="${poster}" playsinline></video></div>`;
            document.querySelector("#app").innerHTML = `<div class="phone"><section class="screen on post-viewer-screen post-viewer-media post-viewer-explore">
              <header class="post-viewer-topbar"><button class="post-viewer-back">←</button><button class="post-viewer-identity"><b>Test creator</b></button></header>
              <div class="post-viewer-feed" tabindex="0"><article class="clip post-detail" data-id="current">${media}
                <div class="post-viewer-media-info"><div class="soundbar">Original sound</div></div>
                <div class="rail"><button class="act">Like</button><button class="act">Share</button></div>
              </article><article class="clip post-detail" data-id="next"><div class="shade"></div></article></div>
              <footer class="post-viewer-footer post-viewer-composer"><form id="post-viewer-composer" class="post-viewer-composer-form"><input id="post-viewer-composer-input" placeholder="Add a comment..."></form></footer>
            </section></div>`;
          }, { kind, poster });
          const geometry = await page.evaluate(() => {
            const box = selector => {
              const rect = document.querySelector(selector).getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            };
            const media = document.querySelector(".clip.post-detail img,.clip.post-detail video");
            const feed = document.querySelector(".post-viewer-feed");
            const feedStyle = getComputedStyle(feed);
            const feedScroll = {
              overflowY: feedStyle.overflowY,
              snap: feedStyle.scrollSnapType,
              touchAction: feedStyle.touchAction,
              clientHeight: feed.clientHeight,
              scrollHeight: feed.scrollHeight,
            };
            const cardRects = [...feed.querySelectorAll(":scope > .clip")].map(card => {
              const rect = card.getBoundingClientRect();
              return { top: rect.top, height: rect.height };
            });
            const mediaBox = box(".clip.post-detail img,.clip.post-detail video");
            const infoBox = box(".post-viewer-media-info");
            const railBox = box(".rail");
            const composerBox = box(".post-viewer-footer");
            const fit = getComputedStyle(media).objectFit;
            const radius = getComputedStyle(media).borderRadius;
            feed.scrollTop = feed.clientHeight + 1;
            return {
              fit,
              media: mediaBox,
              info: infoBox, rail: railBox,
              composer: composerBox,
              radius,
              feedScroll,
              cardRects,
              scrolledTop: feed.scrollTop,
            };
          });
          assert.equal(geometry.fit, "cover", `${kind} must fill, not letterbox inside the viewer`);
          assert.equal(geometry.radius, "0px");
          assert.deepEqual(geometry.media, { left: 0, right: size.width, top: 0, bottom: size.height },
            `${kind} must reach every viewer edge`);
          assert.ok(geometry.info.bottom <= geometry.composer.top, JSON.stringify(geometry));
          assert.ok(geometry.rail.bottom <= geometry.composer.top, JSON.stringify(geometry));
          assert.ok(geometry.composer.top - geometry.info.bottom < 20, "sound stays beside the bottom actions");
          assert.ok(geometry.composer.top - geometry.rail.bottom <= 24, "actions stay just above the composer");
          assert.equal(geometry.feedScroll.overflowY, "auto");
          assert.ok(geometry.feedScroll.snap.includes("y mandatory"));
          assert.ok(geometry.feedScroll.touchAction.includes("pan-y"));
          assert.ok(geometry.feedScroll.scrollHeight >= geometry.feedScroll.clientHeight * 2);
          assert.ok(geometry.scrolledTop > 0, "native scroll advances to the next full-screen post");
           assert.equal(geometry.cardRects.length, 2);
           assert.ok(geometry.cardRects[0].height >= size.height - 1);
           assert.ok(geometry.cardRects[1].height >= size.height - 1);
           assert.ok(geometry.cardRects[1].top - geometry.cardRects[0].top >= size.height - 1,
             "neighbor posts must occupy separate snap pages, not overlap");
        }
      }
      await page.screenshot({ path: "/tmp/oldtime-viewer-edge-to-edge.png" });
      assert.deepEqual(pageErrors, []);
      return;
    }
    if (process.env.OLDTIME_NAV_RENDER_ONLY === "1") {
      for (const target of ["communities", "chat", "search", "updates"]) {
        const button = page.locator(`.nav [data-tab="${target}"]`);
        await button.hover();
        await page.mouse.down();
        const pressedOpacity = await button.evaluate(element => getComputedStyle(element).opacity);
        assert.equal(pressedOpacity, "1", "pressing a tab must not dim it");
        await page.mouse.up();
        const nav = page.locator(".phone > nav.nav");
        await nav.waitFor({ state: "visible" });
        const appearance = await nav.evaluate(element => ({
          background: getComputedStyle(element).backgroundColor,
          gradient: getComputedStyle(element).backgroundImage,
          activeColor: getComputedStyle(element.querySelector("button.on")).color,
          activeBackground: getComputedStyle(element.querySelector("button.on")).backgroundColor,
          inactiveColor: getComputedStyle([...element.querySelectorAll("button")].find(button =>
            !button.classList.contains("on") && !button.classList.contains("nav-create-button"))).color,
          createBackground: getComputedStyle(element.querySelector(".nav-create-icon")).backgroundColor,
          items: [element, ...element.querySelectorAll("*")].map(item => {
            const css = getComputedStyle(item);
            return { opacity: css.opacity, duration: css.transitionDuration, animation: css.animationName, filter: css.filter };
          }),
        }));
        assert.equal(appearance.background, "rgb(9, 10, 12)");
        assert.equal(appearance.gradient, "none");
        assert.equal(appearance.activeColor, "rgb(255, 255, 255)");
        assert.equal(appearance.activeBackground, "rgba(0, 0, 0, 0)");
        assert.equal(appearance.inactiveColor, "rgb(183, 187, 194)");
        assert.equal(appearance.createBackground, "rgba(0, 0, 0, 0)");
        for (const item of appearance.items) {
          assert.deepEqual(item, { opacity: "1", duration: "0s", animation: "none", filter: "none" });
        }
      }
      assert.deepEqual(pageErrors, []);
      await page.screenshot({ path: "/tmp/oldtime-navigation.png" });
      return;
    }
    assert.equal(await page.locator(".feed-recommendation-menu").count(), 0);
    if (process.env.OLDTIME_MEDIA_CONTROLS_ONLY === "1") {
      const { verifyMediaBrowsingControls } = await import("./media-browsing-check.js");
      await verifyMediaBrowsingControls(page);
      assert.deepEqual(pageErrors, []);
      await page.screenshot({ path: "/tmp/oldtime-media-controls.png" });
      return;
    }
    if (process.env.OLDTIME_HOME_RENDER_ONLY === "1") {
      await page.locator('.nav button[aria-label="Search"]').click();
      assert.equal(await page.locator("#search-new-post").count(), 0, "Search header has no compose button");
      await page.locator(".search-landing").waitFor({ state: "visible" });
      assert.equal(await page.locator('.xe-chips[aria-label="Result type"]').count(), 0,
        "Search has no result-type pills");
      assert.equal(await page.locator(".search-hub-tabs").count(), 0,
        "Search has no Videos/Places landing tabs");
      assert.equal(await page.locator(".search-suggestion-list").count(), 1,
        "Search shows plain public-topic suggestions");
      assert.equal(await page.locator("[data-voice-search]").count(), 1,
        "Search keeps the hold-to-speak button");
      assert.equal(await page.locator(".search-back-button").count(), 1,
        "Search includes a back button");
      await page.setViewportSize({ width: 320, height: 780 });
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        searchRight: document.querySelector(".search-header-control")?.getBoundingClientRect().right ?? Infinity,
        voiceRight: document.querySelector(".search-voice-search")?.getBoundingClientRect().right ?? Infinity,
      }));
      assert.ok(layout.document <= layout.viewport, `Search fits a 320px viewport: ${JSON.stringify(layout)}`);
      assert.ok(layout.searchRight <= layout.viewport && layout.voiceRight <= layout.viewport);
      await page.screenshot({ path: "/tmp/oldtime-search-320.png" });
       assert.deepEqual(pageErrors, []);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(async () => {
        const { renderPromptCard } = await import("/app/help-prompt-view.js");
        const layer = document.createElement("div");
        layer.className = "cta-backdrop";
        layer.innerHTML = renderPromptCard({
          id: "help-communities", category: "Communities",
          title: "Shared interests. Real conversations.",
          description: "Explore a community that interests you. Read its rules, then join the conversation when you're ready.",
          primaryRoute: "help-communities", primaryLabel: "Explore communities", image: "communities.webp",
        }, { esc: value => String(value).replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]), id: "tip-preview" });
        document.body.append(layer);
      });
      const art = page.locator(".hp-card .hp-art");
      await art.waitFor({ state: "visible" });
      const artwork = await art.evaluate(element => ({
        height: element.getBoundingClientRect().height,
        background: getComputedStyle(element).backgroundColor,
        svg: !!element.querySelector("svg"),
      }));
      assert.ok(artwork.height >= 180, "tips use large illustrations");
      assert.equal(artwork.background, "rgba(0, 0, 0, 0)");
      assert.equal(artwork.svg, true);
      await page.screenshot({ path: "/tmp/oldtime-tip-preview.png" });
      return;
    }
    const openStatusFromHome = async authorId => {
      await page.locator('.nav [data-tab="updates"]').click();
      await page.locator(`[data-home-story-group="${authorId}"]`).click();
    };
    if (process.env.OLDTIME_CAPTURE_REFERENCE_ONLY === "1") {
      await checkCameraReference(page).catch(failure => {
        throw new Error(`${failure.message}\nBrowser errors: ${JSON.stringify(pageErrors)}`, { cause: failure });
      });
      assert.deepEqual(pageErrors, []);
      return;
    }
    const createTestImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
    const choosePhotos = async count => {
      await page.locator("#create-open").click();
      await page.locator(".create-flow-picker").waitFor({ state: "visible" });
      const chooser = page.waitForEvent("filechooser");
      await page.locator('[data-create-choice="photos"]').click();
      await (await chooser).setFiles(Array.from({ length: count }, (_, index) => ({
        name: `create-photo-${index + 1}.png`, mimeType: "image/png", buffer: createTestImage,
      })));
      await page.locator("[data-create-share]").waitFor({ state: "visible" });
    };
    if (process.env.OLDTIME_THREAD_COMPOSER_ONLY === "1") {
      await page.locator("#create-open").click();
      await page.locator(".create-flow-picker").waitFor({ state: "visible" });
      assert.equal(await page.locator('[data-create-choice="thread"]').count(), 1);
      await page.locator('[data-create-choice="thread"]').click();
      const composer = page.locator(".thread-composer");
      await composer.waitFor({ state: "visible" });
      assert.equal(await page.locator("[data-thread-input]").count(), 2, "a thread starts with two connected posts");
      assert.equal(await page.locator("[data-thread-submit]").isDisabled(), true, "Post All requires both parts");
      await page.locator('[data-thread-input="0"]').fill("First thread post");
      await page.locator('[data-thread-input="1"]').fill("Second thread post");
      assert.equal(await page.locator("[data-thread-submit]").isEnabled(), true);
      await page.locator("[data-thread-add]").click();
      assert.equal(await page.locator("[data-thread-input]").count(), 3);
      await page.locator('[data-thread-input="2"]').fill("Third thread post");
      await page.locator('[data-thread-remove="2"]').click();
      assert.equal(await page.locator("[data-thread-input]").count(), 2);
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        titleSize: getComputedStyle(document.querySelector("#thread-composer-title")).fontSize,
        counterSize: getComputedStyle(document.querySelector("[data-thread-count]")).fontSize,
        sheetMaxHeight: getComputedStyle(document.querySelector(".thread-composer")).maxHeight,
      }));
      assert.ok(layout.document <= layout.viewport, `thread sheet fits the viewport: ${JSON.stringify(layout)}`);
      assert.equal(layout.titleSize, "17px");
      assert.equal(layout.counterSize, "14px");
      assert.notEqual(layout.sheetMaxHeight, "none");
      await page.locator("[data-thread-cancel]").click();
      assert.equal(await page.locator(".thread-composer").count(), 0);
      assert.deepEqual(pageErrors, []);
      await page.screenshot({ path: "/tmp/oldtime-thread-composer.png" });
      return;
    }
    await choosePhotos(1);
    assert.equal(await page.locator(".create-flow-media-summary b").innerText(), "1 photo");
    await page.locator("[data-create-share]").click();
    await page.locator("#ce-details").waitFor({ state: "visible" });
    assert.equal(await page.locator(".creative-editor.is-create-v2").isVisible(), true,
      "Share as-is opens the existing share step without requiring edits");
    await page.locator("#ce-details-back").click();
    await page.locator("#ce-close").click();
    await page.locator(".creative-editor").waitFor({ state: "detached" });

    await choosePhotos(7);
    assert.equal(await page.locator(".create-flow-media-summary b").innerText(), "7 photos");
    await page.locator("[data-create-edit]").click();
    await page.locator(".creative-editor.is-create-v2").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelectorAll("#ce-pages option").length === 7);
    await page.locator("#ce-close").click();
    await page.locator(".creative-editor").waitFor({ state: "detached" });

    await page.locator("#create-open").click();
    await page.locator(".create-flow-picker").waitFor({ state: "visible" });
    await page.locator('[data-create-choice="text"]').click();
    await page.locator("#create-flow-text-input").fill("A text post on my color");
    await page.locator('[data-create-color="#e5262f"]').click();
    await page.locator("[data-create-continue]").click();
    await page.locator(".creative-editor.is-create-v2").waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const next = document.querySelector("#ce-next-action");
      return next && !next.disabled;
    });
    await page.locator("#ce-close").click();
    await page.locator(".creative-editor").waitFor({ state: "detached" });

    await page.locator("#create-open").click();
    await page.locator(".create-flow-picker").waitFor({ state: "visible" });
    assert.deepEqual(await page.locator("[data-create-choice]").evaluateAll(buttons =>
      buttons.map(button => button.dataset.createChoice)), ["photos", "video", "text", "thread", "camera"]);
    const videoChooser = page.waitForEvent("filechooser");
    await page.locator('[data-create-choice="video"]').click();
    await (await videoChooser).setFiles({
      name: "create-video.mp4", mimeType: "video/mp4", buffer: Buffer.from("video fixture"),
    });
    await page.locator("[data-create-share]").waitFor({ state: "visible" });
    assert.equal(await page.locator(".create-flow-media-summary b").innerText(), "Video");
    await page.locator("[data-create-close]").click();

    await page.locator("#create-open").click();
    await page.locator(".create-flow-picker").waitFor({ state: "visible" });
    await page.locator('[data-create-choice="camera"]').click();
    await page.locator(".creative-editor.is-create-v2").waitFor({ state: "visible" });
    await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible" });
    assert.equal(await page.locator('.creative-editor[data-destination="post"]').isVisible(), true);
    assert.equal(await page.locator("#ce-shutter").isVisible(), true);
    assert.equal(await page.locator(".cs-gallery").isVisible(), true);
    await page.waitForFunction(() => window.__getUserMediaCalls > 0);
    await page.locator("#ce-close").click();
    await page.locator(".creative-editor").waitFor({ state: "detached" });

    if (process.env.OLDTIME_CREATE_LAYOUT_ONLY === "1") {
      await openCreatePreview(page);
      await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible" });
      const chooser = page.waitForEvent("filechooser");
      await page.locator("#ce-camera-gallery-slot button[aria-label='Library']").click();
      await (await chooser).setFiles({
        name: "compact-layout.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAmElEQVR4nO3QMREAIBDAsJeNDWxgEmRkoEP2Xmftc382OkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAO0BARgihnO/GDoAAAAASUVORK5CYII=", "base64"),
      });
      await page.waitForFunction(() => {
        const editor = document.querySelector(".creative-editor"), canvas = document.querySelector("#ce-canvas");
        return editor && !editor.classList.contains("is-camera-open") && canvas?.width > 0 && canvas?.height > 0;
      });
      assert.equal(await page.locator("#ce-sound-suggestion").count(), 0, "no automatic trending sound suggestion");
      await openPublishReview(page);
      await assertCompactShareLayout(page);
      return;
    }

    const backplateAudit = await page.evaluate(() => {
      const fixtures = [
        ["Common icon", '<button class="icon">Icon</button>'],
        ["Community search", '<button class="community-story-find">Find people</button>'],
        ["Create shortcut", '<span class="ch-primary-icon">Create</span>'],
        ["Settings icon", '<span class="settings-entry-icon">Settings</span>'],
        ["Explore search", '<div class="discovery-search-wrap">Search</div>'],
        ["Profile action", '<button class="profile-action-close">Close</button>'],
        ["Chat action", '<button class="chat-action">Search</button>'],
        ["Emoji search", '<div class="emoji-search-row">Search emoji</div>'],
        ["Creator icon", '<span class="ct-icon">Creator</span>'],
        ["Business icon", '<span class="ap-icon">Business</span>'],
        ["Selected professional tab", '<div class="ap-tabs"><button class="on">Selected</button></div>'],
        ["Activity action", '<button class="ap-post-action">Activity</button>'],
        ["Audio close", '<div class="audio-panel"><button class="ap-close">Close</button></div>'],
        ["Share action", '<div class="share-recipient-panel"><span class="srp-actic">Share</span></div>'],
        ["Saved close", '<div class="saved-social-panel"><button class="ss-close">Close</button></div>'],
        ["Place close", '<div class="pp-header"><button data-close>Close</button></div>'],
        ["Comment close", '<button class="comment-close">Close</button>'],
        ["Chat filter", '<button class="chat-inbox-filter">Filter</button>'],
        ["Disabled save", '<div class="settings-save-bar"><button disabled>Save</button></div>'],
        ["Drawer close", '<button class="drawer-close">Close</button>'],
        ["Old community search", '<button class="blast-search-submit">Search</button>'],
      ];
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden";
      document.querySelector("#app").append(host);
      try {
        return fixtures.map(([name, html]) => {
          host.innerHTML = html;
          const node = host.querySelector("button,span") || host.firstElementChild;
          const style = getComputedStyle(node);
          return { name, background: style.backgroundColor, color: style.color, borderWidth: style.borderTopWidth, borderRadius: style.borderTopLeftRadius };
        });
      } finally { host.remove(); }
    });
    for (const item of backplateAudit) {
      if (item.name === "Explore search") {
        assert.equal(item.background, "rgb(241, 242, 244)", "Search uses the soft neutral pill from the reference");
        assert.equal(item.borderWidth, "0px", "Search has no square border");
        assert.equal(item.borderRadius, "999px", "Search remains a capsule");
      } else {
        assert.ok(["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"].includes(item.background), `${item.name} has no gray backplate: ${item.background}`);
      }
      assert.notEqual(item.color, "rgb(255, 255, 255)", `${item.name} keeps readable text on its unboxed white surface`);
    }
    const assertScrollRestoredAfterRefresh = async label => {
      const scrollerSelector = label === "Community"
        ? ".community-screen .stories-feed-scroll"
        : ".screen.on .scroll,.screen.on .feed,.screen.on .stories-feed-scroll,.screen.on .edit-profile-scroll";
      const style = await page.addStyleTag({ content: `
        .screen.on :is(.scroll,.feed,.stories-feed-scroll,.edit-profile-scroll) {
          height:220px!important;max-height:220px!important;overflow-y:auto!important;
        }
        .screen.on :is(.scroll,.feed,.stories-feed-scroll,.edit-profile-scroll)::after {
          content:"";display:block;height:900px;flex:0 0 900px;pointer-events:none;
        }
      ` });
      try {
        const initial = await page.evaluate(selector => {
          const scroller = document.querySelector(selector);
          if (!scroller) return null;
          scroller.scrollTop = 180;
          return {
            top: scroller.scrollTop,
            clientHeight: scroller.clientHeight,
            scrollHeight: scroller.scrollHeight,
            overflowY: getComputedStyle(scroller).overflowY,
            afterHeight: getComputedStyle(scroller, "::after").height,
          };
        }, scrollerSelector);
        assert.ok(initial?.top > 0, `${label} should have a scrollable screen container: ${JSON.stringify(initial)}`);
        await page.evaluate(() => window.dispatchEvent(new Event("oldtime-data")));
        await page.waitForTimeout(50);
        const restored = await page.evaluate(selector => {
          const screen = document.querySelector(".screen.on");
          const scroller = document.querySelector(selector);
          return {
            top: scroller?.scrollTop ?? null,
            context: screen?.dataset.scrollContext || "",
            screen: screen?.className || "",
            scroller: scroller?.className || "",
            height: scroller?.clientHeight || 0,
            scrollHeight: scroller?.scrollHeight || 0,
          };
        }, scrollerSelector);
        assert.equal(restored.top, initial.top, `${label} scroll restoration failed: ${JSON.stringify(restored)}`);
        await page.evaluate(selector => {
          const scroller = document.querySelector(selector);
          if (scroller) scroller.scrollTop = 0;
        }, scrollerSelector);
      } finally {
        await style.evaluate(element => element.remove());
      }
    };
    assert.deepEqual(
      await page.locator(".nav:not(.nav-hidden) > button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label"))),
      ["Home", "Community", "Create", "Messages", "Profile"],
      "Profile replaces Search in the bottom navigation"
    );
    await page.locator('.nav:not(.nav-hidden) > button[data-tab="updates"]').click();
    await page.locator(".home-primary-row").waitFor({ state: "visible" });
    const homeSearchStyle = await page.locator('[data-testid="button-header-search"]').evaluate(button => ({
      display: getComputedStyle(button).display,
      visibility: getComputedStyle(button).visibility,
      opacity: getComputedStyle(button).opacity,
      iconWidth: button.querySelector("svg")?.getBoundingClientRect().width || 0,
    }));
    assert.deepEqual(
      { display: homeSearchStyle.display, visibility: homeSearchStyle.visibility, opacity: homeSearchStyle.opacity },
      { display: "grid", visibility: "visible", opacity: "1" },
      "Home header Search remains visible and accessible"
    );
    assert.ok(homeSearchStyle.iconWidth >= 22 && homeSearchStyle.iconWidth <= 24,
      `Search icon stays within the shared 22–24px scale, got ${homeSearchStyle.iconWidth}px`);
    const homeStoryRail = page.locator(".home-stories-track");
    const initialStoryRail = await homeStoryRail.evaluate(track => {
      const bubble = track.querySelector(".home-story-bubble");
      const avatar = bubble?.querySelector(".home-story-avatar")?.getBoundingClientRect();
      const badge = bubble?.querySelector(".home-story-new")?.getBoundingClientRect();
      const viewport = track.getBoundingClientRect();
      return {
        canSwipe: track.scrollWidth > track.clientWidth,
        avatarFullyVisible: Boolean(avatar && avatar.left >= viewport.left && avatar.right <= viewport.right),
        badgeFullyVisible: !badge || badge.right <= viewport.right,
      };
    });
    assert.equal(initialStoryRail.canSwipe, true, "Home Story avatars are horizontally swipeable");
    assert.equal(initialStoryRail.avatarFullyVisible, true, `the first Story avatar is not clipped: ${JSON.stringify(initialStoryRail)}`);
    assert.equal(initialStoryRail.badgeFullyVisible, true, `the first Story badge fits its rail: ${JSON.stringify(initialStoryRail)}`);
    await homeStoryRail.evaluate(track => { track.scrollLeft = track.scrollWidth; });
    await page.waitForTimeout(150);
    const lastStory = await homeStoryRail.evaluate(track => {
      const bubbles = [...track.querySelectorAll(".home-story-bubble")];
      const last = bubbles.at(-1);
      const avatar = last?.querySelector(".home-story-avatar")?.getBoundingClientRect();
      const badge = last?.querySelector(".home-story-new")?.getBoundingClientRect();
      const viewport = track.getBoundingClientRect();
      return {
        avatarFullyVisible: Boolean(avatar && avatar.left >= viewport.left && avatar.right <= viewport.right),
        badgeFullyVisible: !badge || badge.right <= viewport.right,
      };
    });
    assert.equal(lastStory.avatarFullyVisible, true, `the last Story avatar is not clipped after swiping: ${JSON.stringify(lastStory)}`);
    assert.equal(lastStory.badgeFullyVisible, true, `the last Story badge fits after swiping: ${JSON.stringify(lastStory)}`);
    await homeStoryRail.evaluate(track => { track.scrollLeft = 0; });
    if (process.env.OLDTIME_HOME_STORY_RAIL_ONLY === "1") {
      const modernHome = await page.locator('.home-screen[data-rectangle-feed="true"]').evaluate(screen => {
        const header = screen.querySelector(".home-discovery-header");
        return {
          background: getComputedStyle(screen).backgroundColor,
          feedColor: getComputedStyle(screen.querySelector("#feed")).color,
          headerBackground: getComputedStyle(header).backgroundColor,
          headerColor: getComputedStyle(header).color,
          headerImage: getComputedStyle(header).backgroundImage,
          headerShadow: getComputedStyle(header).boxShadow,
          glowCount: screen.querySelectorAll(".home-content-glow").length,
          ring: getComputedStyle(screen.querySelector(".home-story-avatar")).borderTopColor,
        };
      });
      assert.deepEqual(modernHome, {
        background: "rgb(255, 255, 255)",
        feedColor: "rgb(23, 25, 28)",
        headerBackground: "rgba(0, 0, 0, 0)",
        headerColor: "rgb(23, 25, 28)",
        headerImage: "none",
        headerShadow: "none",
        glowCount: 0,
        ring: "rgb(246, 214, 70)",
      }, "Home stays white and lightweight with a transparent header and yellow Story ring");
      await page.screenshot({ path: "/tmp/oldtime-home-story-rail.png" });
      assert.deepEqual(pageErrors, []);
      return;
    }
    if (process.env.OLDTIME_COMMUNITY_HEADER_ONLY !== "1") {
      await page.locator('[data-testid="button-header-search"]').click();
      await page.locator(".search-landing").waitFor({ state: "visible" });
    }
    await page.locator('.nav:not(.nav-hidden) > button[data-tab="updates"]').click();
    await page.locator(".home-primary-row").waitFor({ state: "visible" });
    assert.equal(await page.locator(".nav:not(.nav-hidden) > button .nav-label").first().evaluate(label => getComputedStyle(label).display), "block",
      "full-screen Home navigation keeps the shared visible labels");
    assert.equal(await page.locator(".nav:not(.nav-hidden) > button .nav-label").first().innerText(), "Home");
    assert.equal(await page.locator('.nav [data-tab="communities"]').getAttribute("aria-label"), "Community");
    assert.equal(await page.locator('.nav [data-tab="search"]').count(), 0, "Search is not in the bottom navigation");
    assert.equal(await page.locator('.nav [data-tab="profile"]').count(), 1, "Profile replaces Search in the bottom navigation");
    assert.equal(await page.locator('[data-testid="button-nav-profile"]').isVisible(), true);
    assert.equal(await page.locator('[data-testid="button-header-search"]').isVisible(), true, "Search opens from the Home header top-left");
    assert.equal(await page.locator('[data-testid="button-header-profile"]').count(), 0, "Home no longer duplicates Profile in the header");
    const expectedNavBackground = "rgb(9, 10, 12)";
    assert.equal(await page.locator(".nav").evaluate(element => getComputedStyle(element).backgroundColor), expectedNavBackground,
      "bottom navigation keeps its restored black surface across interface themes");
    const navItemColors = await page.locator(".nav").evaluate(element => ({
      active: getComputedStyle(element.querySelector('button[data-tab="updates"]')).color,
      activeBackground: getComputedStyle(element.querySelector('button[data-tab="updates"]')).backgroundColor,
      inactive: getComputedStyle(element.querySelector('button[data-tab="communities"]')).color,
    }));
    assert.deepEqual(navItemColors, {
      active: "rgb(255, 255, 255)",
      activeBackground: "rgba(0, 0, 0, 0)",
      inactive: "rgb(183, 187, 194)",
    }, "navigation icons and labels use the restored white/gray treatment without a selected tile");
    await assertScrollRestoredAfterRefresh("Home");

    assert.equal(await page.locator("#menu-open").count(), 0, "Home has no hamburger");
    await page.locator("#notifications-open").click();
    await page.locator(".notifications-header").waitFor({ state: "visible" });
    await assertScrollRestoredAfterRefresh("Notifications");
    await page.locator(".notification-insights-button").click();
    await page.locator('[data-ap-view="personal-activity"] .ap-overview-rail').waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-ap-overview-metric="views"] b').innerText(), "12",
      "Analytics renders the account view count rather than the app menu or Home");
    assert.match(await page.locator("#ap-body").innerText(), /Profile visits[\s\S]*Engagement rate/);
    await page.locator('[data-ap-tab="audience"]').click();
    assert.match(await page.locator("#ap-body").innerText(), /Demographics/);
    await page.locator('[data-ap-tab="trends"]').click();
    assert.match(await page.locator("#ap-body").innerText(), /Views trends/);
    await page.locator('[data-ap-tab="content"]').click();
    await page.locator(".ap-item").waitFor({ state: "visible" });
    assert.match(await page.locator(".ap-item").innerText(), /7 Views/);
    await page.locator("[data-ap-back]").click();
    await page.locator(".notifications-header").waitFor({ state: "visible" });
    await page.locator("#back").click();
    await page.locator(".home-screen").waitFor({ state: "visible" });
    await openOwnProfile(page);
    await page.locator(".profile-page").waitFor({ state: "visible" });
    assert.equal(await page.locator("#profile-actions-open").count(), 0,
      "the owner has no top-right menu because Settings is in the action row");
    await assertScrollRestoredAfterRefresh("Profile");
    const profileViewport = page.viewportSize();
    assert.ok(profileViewport, "the profile browser test has a bounded mobile viewport");
    await page.setViewportSize({ width: 320, height: 780 });
    const compactProfileBounds = await page.evaluate(() => {
      const actionButton = [...document.querySelectorAll(".profile-screen .profile-primary-actions > button")]
        .find(element => element.getClientRects().length);
      const actions = actionButton?.closest(".profile-primary-actions")?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        actionsLeft: actions?.left ?? Infinity,
        actionsRight: actions?.right ?? Infinity,
      };
    });
    assert.ok(compactProfileBounds.documentWidth <= compactProfileBounds.viewportWidth,
      "the compact profile layout has no horizontal page spill at 320px");
    assert.ok(compactProfileBounds.actionsLeft >= 0 && compactProfileBounds.actionsRight <= compactProfileBounds.viewportWidth,
      "the shared profile actions remain within a 320px screen");
    await page.setViewportSize(profileViewport);
    await page.waitForFunction(() => {
      const actions = [...document.querySelectorAll(".profile-screen .profile-primary-actions.profile-owner-actions")]
        .find(row => row.getClientRects().length > 0);
      return Boolean(actions && [...actions.querySelectorAll("button")].every(button =>
        button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0
      ));
    }, null, { timeout: 5000 });
    assert.equal(await page.locator('[data-testid="collection-shelf"], [data-collection-create], [data-collection-open]').count(), 0,
      "Albums & Memories and its profile entry points are removed");
    assert.doesNotMatch(await page.locator(".profile-page").innerText(), /Albums & Memories|Little chapters from real life/);
    assert.equal(await page.locator(".profile-screen:visible .profile-primary-actions.profile-owner-actions button").count(), 3,
      "the owner sees Edit profile, Settings, and Share");
    assert.equal(await page.locator("#profile-dashboard").count(), 0,
      "the profile header does not contain a dashboard action");
    assert.doesNotMatch(await page.locator(".profile-stats").innerText(), /\bviews?\b/i,
      "view totals are not shown in the profile header");
    assert.match(await page.locator(".profile-stats").innerText(), /following[\s\S]*followers[\s\S]*likes\s*&\s*saves/i);
    assert.equal(await page.locator("#edit").isVisible(), true, "the owner has an Edit profile button");
    assert.equal(await page.locator("#profile-settings-open").getAttribute("aria-label"), "Settings");
    const ownerActionGeometry = await page.waitForFunction(() => {
      const element = [...document.querySelectorAll(".profile-screen .profile-primary-actions.profile-owner-actions")]
        .find(item => item.getClientRects().length > 0);
      if (!element) return false;
      const buttons = [...element.querySelectorAll("button")].map(button => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, height: box.height };
      });
      if (buttons.length !== 3 || !buttons.every(button =>
        button.width > 0 && button.height >= 44 && button.left >= 0 && button.right <= window.innerWidth
      )) return false;
      return { width: element.getBoundingClientRect().width, buttons, viewport: window.innerWidth };
    }, null, { timeout: 5000 }).then(handle => handle.jsonValue());
    assert.equal(ownerActionGeometry.buttons.length, 3);
    assert.ok(ownerActionGeometry.buttons.every(button => button.left >= 0 && button.right <= ownerActionGeometry.viewport && button.height >= 44),
      `the shared action row fits without clipped controls: ${JSON.stringify(ownerActionGeometry)}`);
    if (process.env.OLDTIME_NAVIGATION_ONLY === "1") {
      await page.screenshot({ path: "/tmp/oldtime-profile-no-albums.png" });
    }
    await page.locator("#edit").click();
    await page.locator(".edit-profile-screen").waitFor({ state: "visible" });
    await page.locator(".profile-interest-dropdown > summary").click();
    if (process.env.OLDTIME_SETTINGS_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-edit-profile-interests.png", fullPage: true });
    }
    await page.locator(".profile-interest-dropdown > summary").click();
    await page.locator("#profile-editor-back").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    await page.locator("#profile-settings-open").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    assert.equal(await page.locator(".settings-header").evaluate(element => getComputedStyle(element).display), "grid",
      "Settings home keeps its redesigned title header");
    assert.equal((await page.locator(".settings-home-header h1").innerText()).trim(), "Settings");
    assert.match(await page.locator(".settings-home-header").innerText(), /@/);
    assert.equal((await page.locator(".settings-home-done").innerText()).trim(), "Done",
      "the Done action returns to the profile");
    assert.equal(await page.locator(".settings-account-card").count(), 0,
      "the old profile summary card is removed");
    assert.equal(await page.locator(".settings-search").count(), 1,
      "Settings home keeps its real settings search");
    if (process.env.OLDTIME_SETTINGS_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-settings-home-header.png", fullPage: true });
    }
    assert.equal(await page.locator("[data-profile-activity]").count(), 0,
      "Analytics is not shown as a duplicate profile action");
    await page.locator("#settings-back").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator(".home-screen").waitFor({ state: "visible" });
    if (process.env.OLDTIME_NAVIGATION_ONLY === "1") {
      assert.equal(await page.locator('[data-testid="button-header-search"]').count(), 1,
        "Home Search stays in its header");
      const profileNavAvatar = page.locator('.nav [data-testid="button-nav-profile"] .nav-profile-avatar');
      assert.equal(await profileNavAvatar.count(), 1,
        "the bottom Profile control shows the account avatar");
      assert.equal(await profileNavAvatar.isVisible(), true, "the account avatar is visible in the bottom navigation");
      await page.setViewportSize({ width: 320, height: 780 });
      const compact = await page.locator(".home-primary-row").evaluate(element => {
        const box = selector => {
          const rect = element.querySelector(selector)?.getBoundingClientRect();
          return rect ? { left: rect.left, right: rect.right } : null;
        };
        const tabsRect = box(".home-view-tabs");
        const actions = box(".home-header-actions");
        const stories = box(".home-stories-inline");
        const search = box(".app-search-shortcut");
        const tabItems = [...element.querySelectorAll(".home-view-tab")].map(tab => {
          const rect = tab.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });
        return {
          fits: Boolean(tabsRect && actions && tabsRect.left >= 0 && tabsRect.right <= actions.left &&
            actions.right <= window.innerWidth &&
            (!stories || stories.right <= tabsRect.left) &&
            (!search || search.right <= (stories?.left ?? tabsRect.left)) &&
            tabItems.every(tab => tab.left >= tabsRect.left && tab.right <= tabsRect.right && tab.right <= window.innerWidth)),
          tabs: tabsRect, actions, stories, search, tabItems, viewport: window.innerWidth,
        };
      });
      assert.equal(compact.fits, true, `Home Stories, tabs, Search, and bell fit at 320px: ${JSON.stringify(compact)}`);
      assert.equal(await page.locator(".home-story-count").count(), 0, "Story bubbles do not show the confusing black count badge");
      assert.deepEqual(await page.locator(".home-view-tabs [role=tab]").allTextContents(), ["Following", "For You"]);
      assert.equal(await page.locator(".home-topic-tabs").count(), 0, "Home no longer repeats discovery categories");
      const ownerStoryBubble = page.locator('[data-home-story-group="camera-quotes-test"]');
      await ownerStoryBubble.waitFor({ state: "visible" });
      await ownerStoryBubble.click();
      await page.locator("#storyview.on .story-stage").waitFor({ state: "visible" });
      await page.locator("#storyview .story-header").getByText("Test Member").waitFor({ state: "visible" });
      assert.equal(await page.locator(".home-story-slides").count(), 0, "tapping a Home avatar opens the full-screen Story directly");
      await page.locator("#sclose").click();
      await page.locator("#storyview.on").waitFor({ state: "detached" });
      await page.locator('.nav [data-tab="chat"]').click();
      const friendStory = page.locator('[data-story-author="story-member"]');
      await friendStory.waitFor({ state: "visible" });
      await friendStory.click();
      await page.locator("#storyview.on .story-stage-media").waitFor({ state: "visible" });
      await page.locator("#storyview .story-stage").click({ position: { x: 280, y: 400 } });
      await page.locator("#storyview .story-header").getByText("Test Member").waitFor({ state: "visible" });
      await page.locator("#storyview .story-stage").click({ position: { x: 24, y: 400 } });
      await page.locator("#storyview .story-header").getByText("Story Member").waitFor({ state: "visible" });
      await page.locator("#storyview .story-stage").click({ position: { x: 280, y: 400 } });
      await page.locator("#storyview .story-header").getByText("Test Member").waitFor({ state: "visible" });
      const swipeStoryAuthors = (fromY, toY) => page.evaluate(({ fromY, toY }) => {
        const view = document.querySelector("#storyview");
        const stage = view?.querySelector(".story-stage");
        if (!view || !stage || typeof Touch !== "function" || typeof TouchEvent !== "function") {
          throw new Error("Touch events are unavailable in the Story browser test.");
        }
        const touch = y => new Touch({
          identifier: 7, target: stage, clientX: window.innerWidth / 2, clientY: y,
        });
        const start = touch(fromY);
        const end = touch(toY);
        view.dispatchEvent(new TouchEvent("touchstart", {
          bubbles: true, cancelable: true, touches: [start], targetTouches: [start], changedTouches: [start],
        }));
        view.dispatchEvent(new TouchEvent("touchend", {
          bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [end],
        }));
      }, { fromY, toY });
      await swipeStoryAuthors(520, 420);
      await page.locator("#storyview .story-header").getByText("Story Member").waitFor({ state: "visible" });
      await swipeStoryAuthors(420, 520);
      await page.locator("#storyview .story-header").getByText("Test Member").waitFor({ state: "visible" });
      await page.locator("#sclose").click();
      await page.locator("#storyview.on").waitFor({ state: "detached" });
      await page.locator('.nav [data-tab="updates"]').click();
      if (process.env.OLDTIME_COMMUNITY_HEADER_ONLY !== "1") {
        await page.locator('[data-testid="button-header-search"]').click();
        await page.locator(".search-landing").waitFor({ state: "visible" });
        await page.screenshot({ path: "/tmp/oldtime-search-landing-check.png" });
      }
      await openOwnProfile(page);
        await page.locator(".profile-screen:visible .profile-reference-header").waitFor({ state: "visible" });
        const profileHeader = await page.locator(".profile-screen:visible .profile-reference-header").evaluate(element => {
         const rect = selector => {
           const target = element.querySelector(selector);
           if (!target) return null;
           const box = target.getBoundingClientRect();
           return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
         };
         const cover = element.querySelector(".profile-cover");
         const coverImage = cover?.querySelector(".profile-cover-landscape");
         return {
           coverDisplay: cover ? getComputedStyle(cover).display : "missing",
            coverLoaded: !!coverImage && coverImage.complete && coverImage.naturalWidth > 0,
           avatar: rect(".profile-avatar-wrap"),
            identity: rect(".profile-name-row"),
           stats: rect(".profile-stats"),
             actions: rect(".profile-visitor-actions,.profile-owner-actions"),
             actionCount: element.querySelectorAll(".profile-visitor-actions button,.profile-owner-actions button").length,
           viewportWidth: document.documentElement.clientWidth,
         };
       });
        assert.equal(profileHeader.coverDisplay, "block", "the profile header uses the saved cover as its background");
        assert.equal(profileHeader.coverLoaded, true, "the saved cover image is available");
        assert.ok(profileHeader.avatar && profileHeader.avatar.width >= 58 && profileHeader.avatar.x < profileHeader.viewportWidth / 3,
          "the real avatar stays aligned with the compact cover identity");
        assert.ok(profileHeader.identity.x > profileHeader.avatar.right, "name and handle align beside the avatar");
        assert.ok(profileHeader.stats.y >= profileHeader.avatar.bottom, "Following, Followers, and Likes & Saves follow the identity");
        assert.ok(profileHeader.actions.y >= profileHeader.stats.bottom, "the shared action row sits below profile totals");
        assert.equal(profileHeader.actionCount, 3, "the same Follow, Message, and Add Friend row is present");
        await page.screenshot({ path: "/tmp/oldtime-rednote-profile-header.png" });
      assert.deepEqual(pageErrors, []);
      await page.screenshot({ path: "/tmp/oldtime-navigation-check.png" });
      return;
    }

    await openStatusFromHome("story-member");
    await page.locator("#storyview.on .story-stage-media").waitFor({ state: "visible" });
    assert.equal(await page.locator("#storyview #sclose").count(), 1, "the viewer has one X close action");
    const closeControlStyle = await page.locator("#storyview #sclose").evaluate(element => {
      const style = getComputedStyle(element);
      return {
        borderWidth: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        borderRadius: style.borderRadius,
        background: style.backgroundColor,
        boxShadow: style.boxShadow,
        backdropFilter: style.backdropFilter,
      };
    });
    assert.deepEqual(closeControlStyle, {
      borderWidth: "0px",
      borderStyle: "none",
      borderRadius: "0px",
      background: "rgba(0, 0, 0, 0)",
      boxShadow: "none",
      backdropFilter: "none",
    }, "the close X has no circle, border, or background");
    assert.match(await page.locator(".story-creator-copy").innerText(), /^Story Member[\s\S]*ago/);
    const viewerComposer = await page.locator(".story-compose").boundingBox();
    assert.ok(viewerComposer?.width > 250, "viewers get a full-width message composer when replies are enabled");
    assert.equal(await page.locator(".story-compose").count(), 1, "the viewer has one reply composer");
    assert.equal(await page.locator(".story-profile-mini").count(), 0,
      "the creator avatar is not duplicated beside the reply composer");
    const viewerAvatar = page.locator(".story-compose .story-viewer-avatar");
    assert.equal(await viewerAvatar.getAttribute("src"), "/app/test-viewer-photo.svg",
      "the reply pill uses the logged-in viewer's existing profile photo");
    assert.ok(await viewerAvatar.evaluate(image => image.complete && image.naturalWidth > 0),
      "the viewer's real profile photo loads inside the reply pill");
    const composerStyle = await page.locator(".story-compose").evaluate(element => {
      const style = getComputedStyle(element);
      return {
        borderWidth: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        borderRadius: style.borderRadius,
        background: style.backgroundColor,
        boxShadow: style.boxShadow,
        backdropFilter: style.backdropFilter,
      };
    });
    assert.deepEqual(composerStyle, {
      borderWidth: "1px",
      borderStyle: "solid",
      borderRadius: "999px",
      background: "rgba(0, 0, 0, 0.12)",
      boxShadow: "none",
      backdropFilter: "none",
    }, "the reply pill is a single slim translucent outline without glow or heavy blur");
    const stageOverlayStyle = await page.locator(".story-stage").evaluate(element => {
      const before = getComputedStyle(element, "::before");
      const after = getComputedStyle(element, "::after");
      const media = getComputedStyle(element.querySelector(".story-stage-media"));
      return {
        beforeContent: before.content,
        beforeBackground: before.backgroundImage,
        afterContent: after.content,
        afterShadow: after.boxShadow,
        mediaFilter: media.filter,
        mediaOpacity: media.opacity,
      };
    });
    assert.deepEqual(stageOverlayStyle, {
      beforeContent: "none",
      beforeBackground: "none",
      afterContent: "none",
      afterShadow: "none",
      mediaFilter: "none",
      mediaOpacity: "1",
    }, "the Story stage adds no gray/black wash, gradient, or vignette over original media");
    assert.equal(await page.locator(".story-header .story-more-open").count(), 1,
      "the existing Oldtime options control sits in the Story header");
    const moreControlStyle = await page.locator(".story-more-open").evaluate(element => {
      const style = getComputedStyle(element);
      return {
        borderWidth: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        borderRadius: style.borderRadius,
        background: style.backgroundColor,
        boxShadow: style.boxShadow,
        backdropFilter: style.backdropFilter,
      };
    });
    assert.deepEqual(moreControlStyle, {
      borderWidth: "0px",
      borderStyle: "none",
      borderRadius: "0px",
      background: "rgba(0, 0, 0, 0)",
      boxShadow: "none",
      backdropFilter: "none",
    }, "the existing three-line Story control is unboxed");
    assert.equal(await page.locator(".story-reaction-picker").count(), 0,
      "the Story composer does not add a row of emoji controls");
    assert.equal(await page.locator(".story-side-actions, .story-heart").count(), 0,
      "the viewer has no persistent heart or share side buttons");
    assert.equal(await page.locator(".story-more-menu .story-share").count(), 1,
      "Story sharing stays available from the options menu");
    const storyGeometry = await page.locator(".story-stage").evaluate(element => {
      const rect = element.getBoundingClientRect();
      const media = element.querySelector(".story-stage-media");
      return {
        width: rect.width, height: rect.height,
        viewWidth: element.parentElement.getBoundingClientRect().width,
        viewHeight: element.parentElement.getBoundingClientRect().height,
        objectFit: getComputedStyle(media).objectFit
      };
    });
    assert.ok(Math.abs(storyGeometry.width - storyGeometry.viewWidth) <= 1,
      `Story media spans the full viewer width within device-pixel rounding (${storyGeometry.width}px of ${storyGeometry.viewWidth}px)`);
    assert.ok(Math.abs(storyGeometry.height - storyGeometry.viewHeight) <= 1,
      `Story media spans the full viewer height within device-pixel rounding (${storyGeometry.height}px of ${storyGeometry.viewHeight}px)`);
    assert.equal(storyGeometry.objectFit, "cover", "full-screen media retains its crop instead of letterboxing");
    assert.equal(await page.locator(".story-owner-controls .story-activity-open").count(), 0,
      "only the Story owner gets the viewer list control");
    await page.locator(".story-reply-input").fill("Looking good");
    assert.equal(await page.locator(".story-send").isVisible(), true,
      "typing a reply reveals the send icon");
    assert.equal(await page.locator(".story-reaction-picker").count(), 0,
      "the compact composer stays free of an emoji row while Send appears");
    await page.locator(".story-send").click();
    const postedReply = page.locator(".story-live-message").filter({ hasText: "Looking good" }).last();
    await postedReply.waitFor({ state: "visible" });
    assert.match(await postedReply.innerText(), /Looking good/);
    const replyStyle = await postedReply.evaluate(element => {
      const message = element.querySelector(":scope > span");
      return {
        radius: getComputedStyle(message).borderRadius,
        background: getComputedStyle(message).backgroundColor,
      };
    });
    assert.notEqual(replyStyle.radius, "0px", "recent Story replies appear in compact side bubbles");
    assert.notEqual(replyStyle.background, "rgba(0, 0, 0, 0)", "reply bubbles use a readable dark surface");
    assert.equal(await page.locator(".story-reply-input").getAttribute("placeholder"), "Comment…",
      "the reply composer keeps its readable Comment prompt");
    await page.locator(".story-live-list").dispatchEvent("wheel", { deltaY: -120 });
    assert.equal(await page.locator(".story-live-chat").getAttribute("aria-expanded"), "true",
      "scrolling the reply chat opens the complete history");
    assert.equal(await page.locator(".story-replies-toggle").getAttribute("aria-label"), "Close Story replies");
    assert.equal(await page.locator(".story-live-chat").evaluate(element => getComputedStyle(element).position), "fixed",
      "the complete reply history fills the screen");
    await page.locator(".story-replies-toggle").click();
    assert.equal(await page.locator(".story-live-chat").getAttribute("aria-expanded"), "false",
      "the message history can be collapsed back to the fading recent replies");
    await page.locator(".story-more-open").click();
    await page.locator(".story-more-menu .story-share").click();
    assert.equal(await page.evaluate(() => window.__lastStoryShare?.url?.includes("story=cloud-friend-story")), true,
      "native sharing uses a URL that opens this Story");
    assert.ok(storyApiCalls.includes("POST Story view"), "opening another person's Story records the view through the API");
    await page.locator("#sclose").click();
    await page.locator("#storyview.on").waitFor({ state: "detached" });

    await openStatusFromHome("story-member");
    await page.locator("#storyview.on .story-stage-media").waitFor({ state: "visible" });
    await page.locator("#story-profile").click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    await page.locator("#back").click();
    await page.locator(".home-screen").waitFor({ state: "visible" });

    await openStatusFromHome("camera-quotes-test");
    await page.locator(".story-owner-controls .story-more-open").waitFor({ state: "visible" });
    assert.equal(await page.locator(".story-compose").isVisible(), false,
      "the owner cannot see a reply composer on their own Story");
    assert.equal(await page.locator(".story-reply-input").isDisabled(), true,
      "the owner cannot submit a reply through the hidden composer");
    assert.equal(await page.locator(".story-owner-controls .story-activity-open").count(), 0,
      "views are inside the shared panel rather than beside its trigger");
    assert.equal(await page.locator(".story-reaction-picker button:visible").count(), 0,
      "the owner cannot see any inline reaction choices");
    if (process.env.OLDTIME_CHAT_UI_ONLY === "1") {
      await page.locator("#sclose").click();
      await page.locator("#storyview.on").waitFor({ state: "detached" });
      await page.locator('.nav [data-tab="chat"]').click();
      await page.locator(".chat-list-screen").waitFor({ state: "visible" });
      assert.equal(await page.locator(".chat-title").innerText(), "Messages");
      assert.equal(await page.locator("#newchat, #chat-more").isVisible().catch(() => false), false,
        "the inbox header has no new-chat or settings buttons");
      assert.equal(await page.locator(".chat-list-screen .cic, .chat-list-screen #cic-track").count(), 0,
        "Messages has no avatar rail");
      const railStyle = await page.evaluate(() => {
        const title = document.querySelector(".chat-list-heading .chat-title").getBoundingClientRect();
        const picker = document.querySelector("#chat-list-picker-toggle");
        const action = picker.getBoundingClientRect();
        return {
          titleCenterDelta: Math.abs(title.left + title.width / 2 - window.innerWidth / 2),
          titleRight: title.right,
          pickerLeft: action.left,
          pickerRight: action.right,
          lineDelta: Math.abs(title.top + title.height / 2 - action.top - action.height / 2),
          icon: picker.querySelector("svg")?.getAttribute("data-icon"),
          color: getComputedStyle(picker).color,
          background: getComputedStyle(picker).backgroundColor,
        };
      });
      assert.ok(railStyle.titleCenterDelta < 2, `Messages remains centered: ${JSON.stringify(railStyle)}`);
      assert.ok(railStyle.pickerLeft >= railStyle.titleRight - 1,
        `the compose picker stays on the right: ${JSON.stringify(railStyle)}`);
      assert.ok(railStyle.lineDelta < 10, `title and picker share one row: ${JSON.stringify(railStyle)}`);
      assert.equal(railStyle.icon, "compose", "the right control uses the compose icon");
      const pickerStyle = await page.locator("#chat-list-picker-toggle").evaluate(element => ({
        color: getComputedStyle(element).color,
        background: getComputedStyle(element).backgroundColor,
        border: getComputedStyle(element).borderStyle,
      }));
      assert.equal(pickerStyle.color, "rgb(23, 25, 28)");
      assert.equal(pickerStyle.background, "rgba(0, 0, 0, 0)");
      await page.locator("#chat-list-picker-toggle").click();
      assert.equal(await page.locator("#newchat").isVisible(), true);
      assert.equal(await page.locator("#chat-more").isVisible(), true);
      assert.equal(await page.locator(".chat-option, .chat-sheet-folders, .chat-organize-card, [data-more-filter], [data-inbox-folder]").count(), 0,
        "the action picker has no Filters or Folders");
      const actionHandle = await page.locator("#chat-more-menu .chat-filter-sheet-handle").boundingBox();
      assert.ok(actionHandle);
      await page.mouse.move(actionHandle.x + actionHandle.width / 2, actionHandle.y + actionHandle.height / 2);
      await page.mouse.down();
      await page.mouse.move(actionHandle.x + actionHandle.width / 2, actionHandle.y + actionHandle.height / 2 + 200, { steps: 6 });
      await page.mouse.up();
      await page.locator("#chat-more-menu").waitFor({ state: "hidden" });
      await page.locator("#chat-list-picker-toggle").click();
      await page.locator("#chat-more").click();
      await page.locator(".chat-settings-screen").waitFor({ state: "visible" });
      await page.locator("#chat-settings-back").click();
      await page.locator(".chat-list-screen").waitFor({ state: "visible" });
      await page.locator("#chat-list-picker-toggle").click();
      await page.locator("#newchat").click();
      await page.locator(".chat-compose-panel").waitFor({ state: "visible" });
      await page.locator("#chat-compose-cancel").click();
      await page.locator(".chat-list-screen").waitFor({ state: "visible" });
      await page.locator("#crows .chat-inbox-row").first().click();
      await page.locator("#msg").waitFor({ state: "visible" });
      await page.locator("#chat-add").click();
      await page.locator("#chat-compose-settings").click();
      await page.locator(".chat-settings-screen").waitFor({ state: "visible" });
      await page.locator("#chat-settings-back").click();
      await page.locator("#msg").waitFor({ state: "visible" });
      const plusStyle = await page.locator("#chat-add").evaluate(element => ({
        background: getComputedStyle(element).backgroundColor,
        color: getComputedStyle(element).color,
      }));
      assert.equal(plusStyle.background, "rgba(0, 0, 0, 0)");
      assert.equal(plusStyle.color, "rgb(23, 25, 28)");
      return;
    }
    const storyOptionDots = await page.locator(".story-more-open svg").evaluate(svg =>
      [...svg.querySelectorAll("circle")].map(circle => [circle.getAttribute("cx"), circle.getAttribute("cy")])
    );
    assert.deepEqual(storyOptionDots, [["12", "5"], ["12", "12"], ["12", "19"]],
      "Story options display Oldtime's visible three-dot action icon");
    assert.equal(await page.locator(".story-reaction-picker").isVisible(), false,
      "the owner cannot see reaction controls on their own Story");
    await page.locator(".story-more-open").click();
    await page.locator(".story-insights-list").waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const summary = document.querySelector(".story-insights-summary")?.textContent?.trim();
      return summary && summary !== "Loading…";
    });
    assert.equal(await page.locator(".story-insights-summary").innerText(), "1 view · 1 reaction");
    assert.match(await page.locator(".story-insights-list").innerText(), /@storymember[\s\S]*😂/);
    await page.locator(".story-options-open").click();
    const selectedOptionsStyle = await page.locator(".story-options-open").evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      underline: getComputedStyle(element, "::after").backgroundColor,
    }));
    assert.deepEqual(selectedOptionsStyle, {
      background: "rgba(0, 0, 0, 0)",
      underline: "rgb(255, 255, 255)",
    }, "the selected Story tab has no blue fill and only a white underline");
    const optionsBounds = await page.locator(".story-more-menu").boundingBox();
    const ownerStoryBounds = await page.locator("#storyview").boundingBox();
    assert.ok(optionsBounds && ownerStoryBounds);
    assert.ok(optionsBounds.width <= ownerStoryBounds.width, "Story controls stay bounded");
    assert.ok(optionsBounds.x >= ownerStoryBounds.x && optionsBounds.x + optionsBounds.width <= ownerStoryBounds.x + ownerStoryBounds.width,
      "the options dropdown stays within the Story viewer horizontally");
    assert.ok(optionsBounds.y >= ownerStoryBounds.y && optionsBounds.y + optionsBounds.height <= ownerStoryBounds.y + ownerStoryBounds.height,
      "the options dropdown stays within the Story viewer vertically");
    assert.doesNotMatch(await page.locator(".story-more-menu").innerText(), /Close Story/i);
    await page.locator("#sclose").click();
    await page.locator("#storyview.on").waitFor({ state: "detached" });

    assert.equal(await page.locator("#menu-open").count(), 0);
    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator(".home-screen").waitFor({ state: "visible" });
    await page.locator("#notifications-open").click();
    await page.locator(".notifications-header").waitFor({ state: "visible" });
    assert.equal(await page.locator(".notifications-header .h1").innerText(), "Notifications");
    assert.equal(await page.locator(".notification-category").count(), 5);
    assert.ok(["rgb(255, 255, 255)", "rgba(0, 0, 0, 0)", ""].includes(
      await page.locator(".notification-category").first().evaluate(el=>getComputedStyle(el).backgroundColor)
    ), "notification categories may be white or transparent, but not gray");
    await page.locator('[data-notification-filter="requests"]').click();
    assert.match(await page.locator(".screen.on").innerText(), /No follow or Friend requests right now/);
    await page.locator("#back").click();
    assert.equal(await page.locator(".notifications-header .h1").innerText(), "Notifications");
    await page.locator("#back").click();
    await page.locator(".home-screen").waitFor({ state: "visible" });

    await openOwnProfile(page);
    await page.locator("#profile-settings-open").click();
    await page.locator(".account-settings-screen").waitFor({ state: "visible" });
    assert.match(await page.locator(".account-settings-screen").innerText(), /Settings/);
    await page.locator('[data-settings="notifications"]').click();
    await page.locator("#notifs-toggle").waitFor({ state: "visible" });
    await assertScrollRestoredAfterRefresh("Settings");
    await page.locator("#settings-back").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    assert.equal(await page.locator(".settings-home img").count(), 0,
      "Settings uses text and unboxed line icons rather than decorative images");
    if (process.env.OLDTIME_SETTINGS_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-settings-home.png", fullPage: true });
    }
    if (process.env.OLDTIME_SOUND_SETTINGS_ONLY === "1") {
      await page.locator('[data-settings="sound-reuse"]').click();
      const soundReuseToggle = page.locator("#sound-reuse-toggle");
      await soundReuseToggle.waitFor({ state: "visible" });
      assert.equal(await soundReuseToggle.getAttribute("aria-checked"), "true",
        "sound reuse defaults to on for newly eligible posts");
      await soundReuseToggle.click();
      await page.waitForFunction(() => document.querySelector("#sound-reuse-toggle")?.getAttribute("aria-checked") === "false");
      assert.equal(accountState.soundReuseEnabled, false, "the opt-out is persisted through account settings");
      await soundReuseToggle.click();
      await page.waitForFunction(() => document.querySelector("#sound-reuse-toggle")?.getAttribute("aria-checked") === "true");
      assert.equal(accountState.soundReuseEnabled, true, "the owner can restore the default");
      await page.locator("#settings-back").click();
      await page.locator(".settings-home").waitFor({ state: "visible" });
      return;
    }
    await page.locator('[data-settings="close-friends"]').click();
    const closeFriendSearch = page.locator("#close-friends-search");
    const closeFriendRow = page.locator('[data-close-friend="52a126f3-8f2b-4c15-b45f-07af2853d821"]');
    await closeFriendSearch.fill("not-a-friend");
    await page.locator("#close-friends-list .empty").filter({ hasText: "No accounts match that search" }).waitFor({ state: "visible" });
    assert.match(await page.locator("#close-friends-list").innerText(), /No accounts match that search/);
    await closeFriendSearch.fill("story");
    await closeFriendRow.waitFor({ state: "visible" });
    assert.equal(await closeFriendRow.getAttribute("aria-pressed"), "true");
    const saveCloseFriends = async () => {
      const response = page.waitForResponse(result =>
        new URL(result.url()).pathname === "/api/close-friends" && result.request().method() === "PUT",
      { timeout: 5000 });
      await page.locator("#settings-save").click();
      assert.equal((await response).status(), 200);
      await page.waitForFunction(() => document.querySelector("#settings-save")?.disabled === true);
    };
    assert.equal(await page.locator("#settings-save").isDisabled(), true,
      "Save stays disabled until a Close Friends change is made");
    await closeFriendRow.click();
    assert.equal(await page.locator("#settings-save").isEnabled(), true,
      "selecting a confirmed Friend enables Save");
    await saveCloseFriends();
    assert.equal(await page.locator("#settings-save").isDisabled(), true,
      "saving a Close Friends change resets the dirty state");
    assert.equal(closeFriendIds.length, 0, "the server confirms the removal");
    await closeFriendSearch.fill("story");
    await closeFriendRow.waitFor({ state: "visible" });
    assert.equal(await closeFriendRow.getAttribute("aria-pressed"), "false");
    await closeFriendRow.click();
    assert.equal(await page.locator("#settings-save").isEnabled(), true,
      "a second change after saving is recognized as unsaved");
    await saveCloseFriends();
    assert.deepEqual(closeFriendIds, [closeFriendProfile.id], "the server confirms the addition");
    await closeFriendSearch.fill("story");
    await closeFriendRow.waitFor({ state: "visible" });
    await closeFriendRow.click();
    nextDialogAction = "dismiss";
    await page.locator("#settings-back").click();
    assert.equal(await page.locator(".settings-header h1").innerText(), "Close Friends",
      "canceling the discard prompt keeps the user on Close Friends");
    assert.equal(await page.locator("#settings-save").isEnabled(), true);
    await page.locator("#settings-back").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    await page.locator('[data-settings="close-friends"]').click();
    await page.locator("#close-friends-search").fill("story");
    await closeFriendRow.waitFor({ state: "visible" });
    assert.equal(await closeFriendRow.getAttribute("aria-pressed"), "true",
      "discarding a change leaves the last saved selection intact");
    await page.locator("#settings-back").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });

    await page.locator('[data-settings="help-guides"]').click();
    await page.locator(".guide-library").waitFor({ state: "visible" });
    assert.equal(await page.locator(".guide-item").count(), 13,
      "the guide library keeps every existing tip");
    const tipArtwork = await page.locator(".guide-artwork svg").evaluateAll(async scenes =>
      Promise.all(scenes.map(async svg => {
        const markup = new XMLSerializer().serializeToString(svg);
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, 320, 180);
        return {
          loaded: image.complete && image.naturalWidth > 0,
          markup,
          transparentCorner: context.getImageData(0, 0, 1, 1).data[3] === 0
        };
      }))
    );
    assert.ok(tipArtwork.every(image => image.loaded), "every guide card image loads");
    assert.equal(new Set(tipArtwork.map(image => image.markup)).size, 13,
      "every guide card shows distinct artwork");
    assert.ok(tipArtwork.every(image => image.markup.includes("<svg") && !image.markup.includes("<image")),
      "guide cards use lightweight editorial SVG artwork");
    assert.ok(tipArtwork.every(image => image.transparentCorner),
      "guide artwork has transparent surroundings, not an image tile");
    if (process.env.OLDTIME_SETTINGS_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-settings-guides.png", fullPage: true });
    }
    await page.locator(".guide-item").first().click();
    await page.locator(".hp-card .hp-art svg").waitFor({ state: "visible" });
    assert.equal(await page.locator(".hp-card .hp-art svg").count(), 1,
      "the walkthrough card renders its original inline illustration");
    await page.locator(".hp-card [data-cta='not-now']").last().click();
    await page.locator(".hp-card").waitFor({ state: "detached" });
    await page.locator("#settings-back").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    await page.locator('[data-settings="help"]').click();
    await page.locator(".settings-home").waitFor({ state: "detached" });
    assert.match(await page.locator(".account-settings-screen").innerText(), /Help & Support/);
    assert.equal(await page.locator(".account-settings-screen img").count(), 0,
      "Help and Support stays text-led without decorative images");
    if (process.env.OLDTIME_SETTINGS_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-settings-help.png", fullPage: true });
    }
    await page.locator('[data-exp-nav="privacy-center"]').click();
    assert.match(await page.locator(".account-settings-screen").innerText(), /Privacy Center/);
    assert.equal(await page.locator(".account-settings-screen img").count(), 0,
      "Privacy Center stays text-led without decorative images");
    if (process.env.OLDTIME_SETTINGS_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-settings-privacy.png", fullPage: true });
    }
    await page.locator("#settings-back").click();
    assert.match(await page.locator(".account-settings-screen").innerText(), /Help & Support/,
      "Privacy Center returns to the Help page that opened it");
    await page.locator("#settings-back").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    await page.locator("#settings-back").click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });

    if (process.env.OLDTIME_COMMUNITY_HEADER_ONLY === "1") showRepostFixture = true;
    await page.locator('.nav [data-tab="communities"]').click();
    await page.locator(".community-screen").waitFor({ state: "visible" });
    await page.locator(".community-screen .stories-feed-scroll").waitFor({ state: "visible" });
    await assertScrollRestoredAfterRefresh("Community");
    if (process.env.OLDTIME_COMMUNITY_HEADER_ONLY === "1") {
      await page.evaluate(() => { document.querySelector(".stories-feed-scroll").scrollTop = 180; });
      await page.waitForTimeout(120);
    }
    assert.equal(await page.locator(".community-header h1").innerText(), "Community",
      "Community has a clear title row");
    const communityCompose=page.locator(".community-header [data-cf-compose], .community-header #community-note-open");
    assert.equal((await communityCompose.getAttribute("aria-label")||await communityCompose.innerText()).toLowerCase(),"new post");
    assert.equal(await communityCompose.locator("svg").getAttribute("data-icon"), "compose",
      "Community uses the pencil-and-line compose icon instead of a plus");
    assert.equal(await page.locator(".community-header .community-feed-tabs").count(), 0);
    await page.waitForTimeout(500);
    assert.equal(await page.locator(".edit-profile-screen").count(), 0,
      "switching to Community must not open or flash the profile interest editor");
    assert.equal(await page.locator('[data-testid="button-edit-match-interests"], [data-testid="button-add-match-interests"]').count(), 0,
      "Community does not surface an automatic interest-edit prompt");
    assert.equal(await page.locator(".community-header [data-tab='chat'], .community-header [aria-label='Chat']").count(), 0,
      "Community itself has no embedded private-chat control");
    const communityTabLabels = (await page.locator(
      ".cf-feed-tabs [data-cf-feed], .community-feed-tabs [role=tab], [data-community-fallback-tabs] [data-community-view], [data-community-fallback-tabs] [data-community-unavailable-feed]"
    ).allInnerTexts()).map(label => label.trim());
    assert.ok(
      JSON.stringify(communityTabLabels) === JSON.stringify(["Following", "For You"]) ||
      JSON.stringify(communityTabLabels) === JSON.stringify(["Following", "Discover", "Popular", "Mutuals / Friends"]),
      `Community shows its supported feed tabs: ${JSON.stringify(communityTabLabels)}`
    );
    assert.equal(await page.locator(".community-story-section, .community-story-rail").count(), 0,
      "Community has no Stories rail");
    const communityHeaderLayout = await page.evaluate(() => {
      const header=document.querySelector(".community-header").getBoundingClientRect();
      const tabs=document.querySelector(".cf-feed-tabs, .community-feed-tabs, [data-community-fallback-tabs]").getBoundingClientRect();
      const search=document.querySelector("#community-search-open");
      const publish=document.querySelector(".community-header #community-note-open, .community-header [data-cf-compose]");
      return {
        height:header.height,
        top:header.top,
        bottom:header.bottom,
        tabsTop:tabs.top,
        tabsBelowHeader:tabs.top>=header.bottom,
        searchVisible:!!search && getComputedStyle(search).display!=="none",
        searchBesidePublish:!!search && Math.abs(
          search.getBoundingClientRect().top+search.getBoundingClientRect().height/2
          -publish.getBoundingClientRect().top-publish.getBoundingClientRect().height/2
        )<2,
        publishHasNoFrame:!!publish && getComputedStyle(publish).backgroundColor==="rgba(0, 0, 0, 0)" &&
          getComputedStyle(publish).borderTopWidth==="0px" && getComputedStyle(publish).borderRadius==="0px" &&
          getComputedStyle(publish).color==="rgb(23, 25, 28)" &&
          publish.querySelector("svg")?.dataset.icon==="compose",
      };
    });
    assert.ok(communityHeaderLayout.height >= 64);
    assert.ok(communityHeaderLayout.top <= 1);
    assert.ok(Math.abs(communityHeaderLayout.tabsTop - communityHeaderLayout.bottom) < 1);
    assert.ok(communityHeaderLayout.tabsBelowHeader);
    assert.equal(communityHeaderLayout.searchVisible, false, "Community header has no Search");
    assert.equal(await page.locator(".community-nav [data-tab='profile']").count(), 1, "Profile replaces Search in the bottom navigation");
    assert.equal(await page.locator(".community-nav [data-tab='search']").count(), 0, "Search is not in the bottom navigation");
    assert.equal(((await communityCompose.getAttribute("aria-label")) ||
      await communityCompose.innerText()).trim().toLowerCase(), "new post");
    assert.ok(communityHeaderLayout.publishHasNoFrame,
      "Community shows only the black pencil icon without a round border or fill");
    const communityViewport = page.viewportSize();
    assert.ok(communityViewport, "the Community test has a bounded viewport");
    await page.setViewportSize({ width: 320, height: 780 });
    const communityCompactLayout = await page.evaluate(() => {
      const search = document.querySelector("#community-search-open")?.getBoundingClientRect();
      const publish = document.querySelector(".community-header #community-note-open, .community-header [data-cf-compose]")?.getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        searchHeight: search?.height ?? 0,
        publishHeight: publish?.height ?? 0,
        headerBottom: document.querySelector(".community-header")?.getBoundingClientRect().bottom ?? Infinity,
        tabsTop: document.querySelector(".cf-feed-header, .community-feed-tabs, [data-community-fallback-tabs]")?.getBoundingClientRect().top ?? -Infinity,
        headerRight: document.querySelector(".community-header")?.getBoundingClientRect().right ?? Infinity,
      };
    });
    assert.ok(communityCompactLayout.document <= communityCompactLayout.viewport,
      "Community does not spill horizontally on a narrow phone");
    assert.ok(communityCompactLayout.headerRight <= communityCompactLayout.viewport);
    assert.ok(Math.abs(communityCompactLayout.tabsTop - communityCompactLayout.headerBottom) < 1,
      "the sticky Community tabs begin directly below the safe-area-aware header");
    assert.equal(communityCompactLayout.publishHeight, 44);
    if (process.env.OLDTIME_COMMUNITY_SEARCH_SCREENSHOTS === "1") {
      await page.screenshot({ path: "/tmp/oldtime-community-320.png", fullPage: true });
    }
    await page.setViewportSize(communityViewport);
    if(process.env.OLDTIME_COMMUNITY_HEADER_ONLY==="1"){
      const followingFeed = page.locator('[data-cf-feed="following"], [data-community-view="following"]');
      await followingFeed.click();
      assert.ok(["page", "true"].includes((await followingFeed.getAttribute("aria-current")) || (await followingFeed.getAttribute("aria-selected"))));
      const discoverFeed = page.locator('[data-cf-feed="discover"]');
      await discoverFeed.click();
      assert.equal(await discoverFeed.getAttribute("aria-current"), "page");
      const tabLayout=await page.locator(".cf-feed-tabs").evaluate(nav=>{
        const rect=nav.getBoundingClientRect(),items=[...nav.querySelectorAll("button")];
        return {
          scrolls:nav.scrollWidth>nav.clientWidth+1,
          center:(items[0].getBoundingClientRect().left+items.at(-1).getBoundingClientRect().right)/2,
          navCenter:rect.left+rect.width/2,
        };
      });
      assert.equal(tabLayout.scrolls,false,"the default Community subbar fits instead of clipping feed names");
      assert.ok(Math.abs(tabLayout.center-tabLayout.navCenter)<2,"the Community feed labels are centered");
      const controls=page.locator(".cf-controls[data-cf-controls]");
      assert.equal(await controls.locator("svg").getAttribute("data-icon"),"more",
        "Community feed controls use a clear three-dot action");
      if (emulatePostMenuTouch) await controls.tap();
      else await controls.click();
      const sheet=page.locator(".cf-dialog");
      await sheet.waitFor({state:"visible"});
      assert.equal(await sheet.locator(".cf-menu [data-cf-menu='pins'] svg").getAttribute("data-icon"),"pin");
      assert.equal(await sheet.locator(".cf-menu [data-cf-menu='filter'] svg").getAttribute("data-icon"),"feedPreferences");
      const sheetBounds=await sheet.evaluate(element=>{
        const rect=element.getBoundingClientRect();
        return {top:rect.top,right:rect.right,viewportWidth:window.innerWidth,popover:element.classList.contains("cf-dialog-popover")};
      });
      const triggerBounds=await controls.boundingBox();
      assert.equal(sheetBounds.popover,true,"Community controls use the shared contextual menu");
      assert.ok(sheetBounds.top>=triggerBounds.y+triggerBounds.height&&sheetBounds.top-triggerBounds.y-triggerBounds.height<=12,
        "Community controls open directly beneath their three-dot trigger");
      assert.ok(sheetBounds.right<=sheetBounds.viewportWidth&&sheetBounds.right>0,
        "the contextual menu stays inside the phone viewport");
      const typeSizes=await sheet.locator(".cf-menu [data-cf-menu='pins']").evaluate(button=>({
        label:getComputedStyle(button.querySelector("span")).fontSize,
        description:getComputedStyle(button.querySelector("small")).fontSize,
      }));
      assert.equal(typeSizes.label,"14px");
      assert.equal(typeSizes.description,typeSizes.label,"dropdown descriptions use the same compact type size");
      await sheet.locator("[data-cf-close]").click();
      await sheet.waitFor({state:"hidden"});
      await page.screenshot({path:"/tmp/oldtime-community-header-verified.png"});
      assert.deepEqual(pageErrors,[]);
      return;
    }
    assert.equal(await page.locator("#community-more-open").count(), 0);
    assert.equal(await page.locator(".community-feed-heading .community-note-open").count(), 0,
      "the separate Create pill is removed from below Stories");
    if(process.env.OLDTIME_MEDIA_CONTROLS_ONLY==="1"){
      const { verifyMediaBrowsingControls } = await import("./media-browsing-check.js");
      await verifyMediaBrowsingControls(page);
      assert.deepEqual(pageErrors,[]);
      return;
    }
    const communityPostComposer = page.locator(".community-header [data-cf-compose], .community-header #community-note-open");
    assert.equal(await communityPostComposer.count(), 1,
      "Community has its own compact post composer entry point");
    await communityPostComposer.click();
    await page.locator(".community-note-panel").waitFor({ state: "visible" });
    assert.doesNotMatch(await page.locator(".community-note-panel").innerText(), /\bGIF\b/i,
      "the Community composer does not offer unsupported GIF search");
    await page.locator("#community-note-input").fill("A short note for my community");
    await page.locator("#community-note-image").setInputFiles({
      name: "community-note.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"),
    });
    await page.locator("#community-note-attachments").waitFor({ state: "visible" });
    await page.locator("[data-attach-edit=\"0\"]").click();
    await page.locator(".creative-editor.is-create-v2").waitFor({ state: "visible" });
    await page.locator(".ce-header-menu summary").click();
    await page.locator("#ce-save-exit").click();
    await page.locator(".creative-editor").waitFor({ state: "hidden" });
    await page.locator(".community-note-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator("#community-note-input").inputValue(), "A short note for my community",
      "editing the photo keeps the unsent Community text");
    assert.equal(await page.locator("#community-note-attachments img").count(), 1,
      "the edited photo returns to the Community composer");
    communityPostPublishingEnabled = true;
    await page.locator("#community-note-submit").click();
    await page.locator(".community-note-panel").waitFor({ state: "hidden" });
    assert.equal(createdCommunityPostBody.destination, "community");
    assert.equal(createdCommunityPostBody.mediaIds.length, 1);
    await page.getByText("A short note for my community").waitFor({ state: "visible" });
    if (process.env.OLDTIME_COMMUNITY_COMPOSER_ONLY === "1") {
      assert.deepEqual(pageErrors, []);
      return;
    }
    await page.locator('.nav [data-tab="updates"]').click();
    showExploreFixture = true;
    await page.locator('[data-testid="button-header-search"]').click();
    await page.locator("#q").waitFor({ state: "visible" });
    assert.equal(await page.locator(".search-hub-tabs").count(), 0,
      "Search has no separate Videos/Places tabs");
    assert.equal(await page.locator('.xe-chips[aria-label="Result type"]').count(), 0,
      "Search has no result-type filter pills");
    assert.equal(await page.locator("[data-xe-type]").count(), 0,
      "no result-type controls are rendered");
    await page.locator("#q").fill("Miami Beach");
    await page.locator('.xe-tile[data-xe-post="explore-dating-humor"]').waitFor({ state: "visible" });
    await page.locator("[data-xe-open-places]").waitFor({ state: "visible" });
    assert.ok(exploreRequests.some(search => search.includes("type=all")),
      "a search uses unified results rather than a selected content type");
    assert.ok(exploreRequests.some(search => search.includes("q=Miami+Beach")),
      "search queries the server");
    const exploreViewport = page.viewportSize();
    assert.ok(exploreViewport, "the Search test has a bounded viewport");
    await page.setViewportSize({ width: 320, height: 780 });
    const searchCompactLayout = await page.evaluate(() => {
      const search = document.querySelector(".search-header-control")?.getBoundingClientRect();
      const voice = document.querySelector(".search-voice-search")?.getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        searchRight: search?.right ?? Infinity,
        searchHeight: search?.height ?? 0,
        voiceRight: voice?.right ?? 0,
      };
    });
    assert.ok(searchCompactLayout.document <= searchCompactLayout.viewport,
      `Search fits a 320px phone: ${JSON.stringify(searchCompactLayout)}`);
    assert.ok(searchCompactLayout.searchRight <= searchCompactLayout.viewport);
    assert.ok(searchCompactLayout.searchHeight >= 44);
    assert.ok(searchCompactLayout.voiceRight <= searchCompactLayout.viewport);
    if (process.env.OLDTIME_COMMUNITY_SEARCH_SCREENSHOTS === "1") {
      await page.screenshot({ path: "/tmp/oldtime-search-320.png", fullPage: true });
    }
    await page.setViewportSize(exploreViewport);
    await page.locator("#q").fill("no matching post");
    await page.locator(".xe-empty").waitFor({ state: "visible" });
    await page.locator("#q").fill("Miami Beach");
    await page.locator("[data-xe-open-places]").waitFor({ state: "visible" });
    if (process.env.OLDTIME_COMMUNITY_SEARCH_ONLY === "1") {
      assert.deepEqual(pageErrors, []);
      return;
    }
    await page.locator('.xe-open[data-xe-post="explore-dating-humor"]').click();
    await page.locator(".post-viewer-screen").waitFor({ state: "visible" });
    await page.locator(
      '.post-viewer-media-controls .post-viewer-media-prompt[data-post-viewer-comment-prompt="explore-dating-humor"]',
    ).waitFor({ state: "visible" });
    assert.equal(await page.locator("#post-viewer-place-profile").count(), 0,
      "Explore uses its media viewer, not the Places-specific footer");
    assert.equal(await page.locator("#post-viewer-comment").count(), 0,
      "the media viewer uses the shared bottom prompt instead of a second comment launcher");
    assert.equal(await page.locator(".post-viewer-media-controls [data-comment='explore-dating-humor']").count(), 1,
      "the Explore media viewer keeps the comment action for a place-tagged post");
    assert.equal(await page.locator(".post-viewer-media-controls [data-like='explore-dating-humor']").count(), 1,
      "place-tagged posts keep their like action");
    assert.equal(await page.locator(".post-viewer-media-controls [data-save='explore-dating-humor']").count(), 1,
      "the Explore viewer keeps the same Save action as Home");
    assert.equal(await page.locator('.post-viewer-media-controls [data-share="explore-dating-humor"]').count(), 1,
      "Explore keeps Share beside Like, Comment, and Save");
    await page.locator("#post-viewer-back").click();
    await page.locator("[data-xe-open-places]").click();
    await page.locator(".discovery-places").waitFor({ state: "visible" });
    const searchPlacesMap = page.locator(".discovery-place-map-container .places-map");
    await searchPlacesMap.waitFor({ state: "visible" });
    const mapBox = await searchPlacesMap.boundingBox();
    assert.ok(mapBox && mapBox.height >= 300, "Places opens with a full map immediately visible");
    assert.equal(await page.locator(".discovery-place-map-container .places-map-toggle").count(), 0,
      "the map does not require a separate expansion control");
    assert.equal(await page.locator(".places-reason").count(), 0,
      "place cards have no Loved or For you labels");
    await page.locator(".search-back-button").click();
    await page.locator('.xe-tile[data-xe-post="explore-dating-humor"]').waitFor({ state: "visible" });
    assert.equal(await page.locator("#q").inputValue(), "Miami Beach",
      "the Search back button restores the previous results and query");
    await page.locator("[data-xe-open-places]").click();
    await page.locator(".discovery-places").waitFor({ state: "visible" });
    assert.equal(await page.locator("#q").getAttribute("placeholder"), "Search places, people, posts, or topics",
      "the shared top search bar remains available when Places is selected");
    await page.locator("#q").fill("Miami");
    const miamiPlace = page.locator('.discovery-places .places-card[data-place-label="Miami Beach"]');
    const miamiPlaceLoaded = await miamiPlace.waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true, () => false);
    if (!miamiPlaceLoaded) {
      const discoveryState = await page.evaluate(() => ({
        query: document.querySelector("#q")?.value || "",
        section: document.querySelector(".discovery-places")?.innerText || "",
        cardLabels: Array.from(document.querySelectorAll(".discovery-places .places-card"), card => card.dataset.placeLabel),
      }));
      assert.fail(`Miami place search did not render: ${JSON.stringify({ discoveryState, placeDiscoveryQueries, pageErrors })}`);
    }
    await page.waitForFunction(() => {
      const image = document.querySelector('.discovery-places .places-card[data-place-label="Miami Beach"] .places-card-image');
      return image?.dataset.localMedia === "oldtime-media:11111111-1111-4111-8111-111111111111" &&
        image.complete && image.naturalWidth > 0;
    });
    assert.ok(placeDiscoveryQueries.includes("Miami"), "place discovery queries the public tags instead of geocoding arbitrary places");
    assert.match(await miamiPlace.innerText(), /Miami Beach[\s\S]*12 posts/);
    const placeRowWidth = await miamiPlace.evaluate(element => element.getBoundingClientRect().width);
    assert.ok(placeRowWidth <= 390, "place rows stay within the compact mobile discovery screen");
    assert.equal(await miamiPlace.locator(".places-card-image").evaluate(image => getComputedStyle(image).objectFit), "cover");
    const placeTextColors = await miamiPlace.evaluate(element => ({
      button: getComputedStyle(element).color,
      surface: getComputedStyle(element.closest(".places-view")).color,
    }));
    assert.equal(placeTextColors.button, placeTextColors.surface,
      "place result text inherits the shared Oldtime text color");
    assert.notEqual(placeTextColors.button, "rgb(255, 255, 255)",
      "place results stay readable on the white discovery surface");
    showExploreFixture = false;
    const togglePlaceMap = async selector => {
      const handle = page.locator(selector);
      assert.ok(await handle.isVisible(), `the map sheet handle is visible: ${selector}`);
      await handle.click({ force: true });
    };
    const swipePlaceMap = async (selector, deltaY) => {
      const handle = page.locator(selector);
      const box = await handle.boundingBox();
      assert.ok(box, `the map sheet handle has a touch target: ${selector}`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + deltaY, { steps: 6 });
      await page.mouse.up();
    };
    await miamiPlace.click();
    await page.locator("#place-detail-heading").waitFor({ state: "visible" });
    assert.equal(await page.locator("#place-detail-heading").innerText(), "Miami Beach");
    assert.equal(await page.locator(".home-discovery-header").count(), 0,
      "the full-screen place page hides the Places/Following/notifications home header");
    await page.locator('.place-feed-card[data-post-id="miami-place-post"]').waitFor({ state: "visible" });
    assert.match(await page.locator(".place-feed-author").innerText(), /Test Member/);
    assert.equal(await page.locator(".place-feed-list .place-feed-card").count(), 1,
      "the selected place shows its tagged posts in the post list");
    assert.equal(await page.locator(".places-people, .places-related").count(), 0,
      "the Top place section does not add a separate people or recommendation strip");
    assert.equal(await page.locator("[data-place-detail-map]").count(), 1,
      "the map layer sits behind the full-screen place feed");
    assert.equal(await page.locator(".place-detail-heading .places-map-toggle").count(), 0,
      "the selected place has no Map button");
    assert.equal(await page.locator(".places-detail .places-map-backdrop").getAttribute("aria-hidden"), "true",
      "the map starts covered by the post grid");
    await togglePlaceMap(".places-detail [data-place-map-handle]");
    const placeMapRevealed = await page.locator(".places-detail.is-map-revealed")
      .waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false);
    if (!placeMapRevealed) {
      const mapRevealState = await page.evaluate(() => ({
        detailClass: document.querySelector(".places-detail")?.className || "",
        handleExpanded: document.querySelector(".places-detail [data-place-map-handle]")?.getAttribute("aria-expanded") || "",
        mapHidden: document.querySelector(".places-detail .places-map-backdrop")?.hidden ?? null,
        screenError: document.querySelector("#screen-retry")?.innerText || "",
      }));
      assert.fail(`place map handle did not reveal its map: ${JSON.stringify({ mapRevealState, pageErrors })}`);
    }
    assert.equal(await page.locator(".places-detail .places-map-backdrop").getAttribute("aria-hidden"), "false");
    await page.waitForFunction(() => {
      const status = document.querySelector(".places-detail .places-map-status");
      return status && (status.hidden || !status.textContent.includes("Loading map"));
    }, null, { timeout: 12_000 });
    const placeMapStatus = page.locator(".places-detail .places-map-status");
    assert.ok(await placeMapStatus.isHidden() ||
      /unavailable|taking too long/i.test(await placeMapStatus.innerText()),
    "the optional map either renders or reports a clear fallback instead of spinning indefinitely");
    await togglePlaceMap(".places-detail [data-place-map-handle]");
    await page.locator(".places-detail:not(.is-map-revealed)").waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const image = document.querySelector(".places-detail .places-post-media img");
      return image?.dataset.localMedia === "oldtime-media:11111111-1111-4111-8111-111111111111" &&
        image.complete && image.naturalWidth > 0;
    });
    const taggedPlaceLink = page.locator(".places-detail .place-feed-chips .place-feed-chip").first();
    assert.equal(await taggedPlaceLink.getAttribute("data-place-lat"), "25.7907",
      "a tag keeps numeric-string coordinates returned by the API");
    assert.equal(await taggedPlaceLink.getAttribute("data-place-lon"), "-80.13");
    await taggedPlaceLink.click();
    await page.locator("#place-detail-heading").waitFor({ state: "visible" });
    assert.equal(await page.locator(".home-discovery-header").count(), 0,
      "a tagged place opened directly from a post lands on the full-screen location page");
    await page.locator('[data-action="open-post"][data-post-id="miami-place-post"]').click();
    await page.locator(".post-viewer-place").waitFor({ state: "visible" });
    const viewerBox = await page.locator(".post-viewer-place .clip.post-detail").boundingBox();
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    assert.ok(viewerBox && viewerBox.height >= viewportHeight * 0.9,
      `opening a Places post fills the screen instead of leaving a blank lower half: ${JSON.stringify({ viewerBox, viewportHeight })}`);
    await page.waitForFunction(() => {
      const image = document.querySelector(".post-viewer-place .clip.post-detail img.fullimg");
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(await page.locator("#post-viewer-place-profile").count(), 0,
      "the Places viewer no longer has a separate View Profile footer button");
    assert.equal(await page.locator(".post-viewer-place-footer").count(), 0,
      "the non-Community Places viewer does not render the old footer");
    assert.equal(await page.locator(".post-viewer-place-title").count(), 0,
      "Places media opens in the same full-screen viewer without a separate Post title");
    const placeViewerControls = page.locator(".post-viewer-place .clip.post-detail > .post-viewer-media-controls");
    assert.equal(await placeViewerControls.locator(".post-viewer-media-prompt").innerText(), "Say something");
    const placeViewerMeta = page.locator(".post-viewer-place .clip.post-detail .meta");
    const placeViewerName = page.locator(".post-viewer-place-creator");
    const placeViewerRail = placeViewerControls.locator(".media-action-row");
    const placeViewerRailBox = await placeViewerRail.boundingBox();
    const placeViewerMetaBox = await placeViewerMeta.boundingBox();
    const placeViewerNameBox = await placeViewerName.boundingBox();
    await page.screenshot({ path: "/tmp/oldtime-unified-places-media.png" });
    assert.ok(placeViewerMetaBox && placeViewerMetaBox.y > viewportHeight * .5,
      "creator and location details sit low on the full-screen media");
    assert.ok(placeViewerRailBox && placeViewerNameBox &&
      placeViewerNameBox.y + placeViewerNameBox.height <= placeViewerRailBox.y,
      `the creator name clears the horizontal action row: ${JSON.stringify({ placeViewerNameBox, placeViewerRailBox })}`);
    assert.equal(await placeViewerName.innerText(), "Test Member");
    assert.equal(await placeViewerRail.locator("[data-like]").count(), 1);
    assert.equal(await page.locator(".post-viewer-place .media-action-row [data-share]").count(), 1,
      "Places media keeps Share in the shared horizontal action row");
    assert.equal(await placeViewerRail.locator("[data-comment]").count(), 1,
      "the Places post viewer keeps the post’s comment action available");
    assert.equal(await placeViewerRail.locator("[data-save]").count(), 1,
      "the Places post viewer has the same Save action as Home");
    assert.equal(await page.locator(".post-viewer-place [data-repost]").count(), 0,
      "the Places post viewer does not add Repost");
    assert.equal(await page.locator(".post-viewer-place [data-profile], .post-viewer-place [data-avatar-profile]").count(), 0,
      "the author name remains the only route to their profile inside the viewer");
    assert.equal(await page.locator("#post-viewer-avatar").count(), 0,
      "opening a Places post does not route through the author's Story");
    const placeActionGeometry = await placeViewerControls.evaluate(element => ({
      prompt: (() => {
        const box = element.querySelector(".post-viewer-media-prompt")?.getBoundingClientRect();
        return box && { left: box.left, right: box.right, top: box.top, height: box.height };
      })(),
      row: (() => {
        const box = element.querySelector(".media-action-row")?.getBoundingClientRect();
        return box && { left: box.left, right: box.right, top: box.top, height: box.height };
      })(),
      actions: [...element.querySelectorAll("[data-like], [data-comment], [data-save], [data-share]")].map(button => {
        const rect = button.getBoundingClientRect();
        const icon = button.querySelector(".navic")?.getBoundingClientRect();
        return { top: rect.top, width: rect.width, height: rect.height, iconWidth: icon?.width, iconHeight: icon?.height };
      }),
    }));
    const placeOptions = page.locator(".post-viewer-place .media-post-options");
    assert.equal(await placeOptions.count(), 1,
      "Places full-screen posts show the same three-dot control");
    await placeOptions.locator(":scope > summary").click();
    assert.equal(await placeOptions.locator('[data-post-engagement-open="miami-place-post"]').count(), 1,
      "Places keeps engagement details in the full-screen menu");
    assert.equal(await placeOptions.locator("[data-post-report]").count(), 0,
      "the post's author cannot report their own post from Places");
    assert.equal(await placeOptions.locator("[data-post-not-interested]").count(), 0,
      "Not interested is reserved for For You recommendations");
    await placeOptions.locator(":scope > summary").click();
    assert.equal(placeActionGeometry.actions.length, 4);
    assert.ok(placeActionGeometry.prompt && placeActionGeometry.row &&
      placeActionGeometry.row.left >= placeActionGeometry.prompt.right - 1 &&
      Math.abs(placeActionGeometry.prompt.top - placeActionGeometry.row.top) <= 1,
    `the prompt and actions share one horizontal bar: ${JSON.stringify(placeActionGeometry)}`);
    assert.ok(placeActionGeometry.actions.every(action => action.height >= 44 &&
      Math.abs(action.iconWidth - 28) < 1 && Math.abs(action.iconHeight - 28) < 1),
    `Like, Comment, Save, Share icons use 28px glyphs and 44px controls: ${JSON.stringify(placeActionGeometry.actions)}`);
    assert.ok(Math.max(...placeActionGeometry.actions.map(action => action.top)) -
      Math.min(...placeActionGeometry.actions.map(action => action.top)) <= 1,
    `all three actions share one horizontal line: ${JSON.stringify(placeActionGeometry.actions)}`);
    const placeLikeButton = placeViewerRail.locator("[data-like]");
    await placeLikeButton.click();
    await page.waitForFunction(() =>
      document.querySelector(".post-viewer-place .media-action-row [data-like]")?.getAttribute("aria-pressed") === "true");
    assert.deepEqual(placeLikeCalls, ["PUT"], "the Like button saves a server-confirmed reaction");
    assert.equal(await page.locator(".post-viewer-place .clip .post-heart-burst").count(), 1,
      "liking shows immediate on-screen heart feedback");
    await placeLikeButton.click();
    await page.waitForFunction(() =>
      document.querySelector(".post-viewer-place .media-action-row [data-like]")?.getAttribute("aria-pressed") === "false");
    assert.deepEqual(placeLikeCalls, ["PUT", "DELETE"], "the Like button can undo the reaction");
    await page.locator(".post-viewer-place .clip.post-detail img.fullimg").click({ clickCount: 2 });
    await page.waitForFunction(() =>
      document.querySelector(".post-viewer-place .media-action-row [data-like]")?.getAttribute("aria-pressed") === "true");
    assert.equal(placeLikeCalls.at(-1), "PUT", "double-tapping the media likes it through the same server action");
    assert.ok(await page.locator(".post-viewer-place .clip .post-heart-burst").count() > 0,
      "double-tap shows the floating heart reaction");
    await placeViewerName.click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    assert.equal(await page.locator("#profile-tab-posts").getAttribute("aria-selected"), "true",
      "the clickable author name opens the regular posts section");
    assert.equal(await page.locator("#storyview.on").count(), 0, "the Places profile path never opens Stories");
    await page.locator("#back").click();
    await page.locator(".post-viewer-place").waitFor({ state: "visible" });
    await page.locator("#post-viewer-back").evaluate(button => {
      const handler = button.onclick;
      window.__placeViewerBackObserved = { hasHandler: typeof handler === "function", invoked: false };
      if (handler) button.onclick = function(event) {
        window.__placeViewerBackObserved.invoked = true;
        return handler.call(this, event);
      };
    });
    await page.locator("#post-viewer-back").click();
    const returnedToPlace = await page.locator("#place-detail-heading")
      .waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false);
    if (!returnedToPlace) {
      const returnState = await page.evaluate(() => ({
        screen: document.querySelector(".screen.on")?.className || "",
        placesView: document.querySelector(".home-screen")?.dataset.placesView || "",
        viewerOpen: Boolean(document.querySelector(".post-viewer-place")),
        heading: document.querySelector("#place-detail-heading")?.textContent || "",
        screenText: document.querySelector(".screen.on")?.innerText.slice(0, 500) || "",
        backHandler: window.__placeViewerBackObserved || null,
      }));
      assert.fail(`post viewer did not return to its selected place: ${JSON.stringify({ returnState, pageErrors })}`);
    }
    assert.equal(await page.locator("#place-detail-heading").innerText(), "Miami Beach",
      "back navigation returns from the post to the selected place");
    await page.locator('[data-action="back-to-places"]').click();
    await page.locator('.home-screen[data-places-view="true"]').waitFor({ state: "visible" });
    assert.equal(await page.locator(".home-discovery-header").count(), 0,
      "Places browse also omits the global Places/Following/notifications header");
    if (process.env.OLDTIME_PLACES_MEDIA_ONLY === "1") {
      assert.deepEqual(pageErrors, []);
      return;
    }
    await page.locator(".places-browse").waitFor({ state: "visible" });
    assert.equal(await page.locator(".places-search-icon").count(), 1,
      "Places has one compact icon-only search action");
    assert.equal((await page.locator(".places-search-icon").innerText()).trim(), "",
      "the search icon replaces the redundant text button");
    assert.equal(await page.locator(".places-search-submit").count(), 0);
    await page.locator("#places-search-input").fill("Miami");
    await page.locator(".places-search-icon").click();
    await page.locator('.places-search-results [data-place-label="Miami Beach"]').waitFor({ state: "visible" });
    assert.equal(placeDiscoveryQueries.at(-1), "Miami", "the icon submits place search");
    await page.locator("#places-search-input").fill("");
    await page.locator(".places-search-icon").click();
    await page.locator('.places-browse .place-feed-card[data-post-id="miami-place-post"]').waitFor({ state: "visible" });
    await page.locator('.places-browse .place-feed-card[data-post-id="wynwood-place-post"]').waitFor({ state: "visible" });
    assert.equal(await page.locator(".places-browse [data-place-discovery-map]").count(), 1,
      "the discovery map stays behind the full-screen tagged-post feed");
    assert.equal(await page.locator(".places-browse .places-map-toggle").count(), 0,
      "the discovery feed has no separate Map button");
    assert.equal(await page.locator(".places-browse .places-map-backdrop").getAttribute("aria-hidden"), "true");
    const placeFeedLayout = await page.evaluate(() => ({
      sections: [...document.querySelectorAll(".places-browse")].map(section => {
        const list = section.querySelector(".place-feed-list");
        const feed = section.closest("#feed");
        const cards = [...(list?.querySelectorAll(".place-feed-card") || [])].slice(0, 2).map(card => {
          const rect = card.getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width };
        });
        return {
          section: { display: getComputedStyle(section).display, rect: section.getBoundingClientRect().toJSON() },
          feed: feed ? { display: getComputedStyle(feed).display, rect: feed.getBoundingClientRect().toJSON() } : null,
          list: list ? { display: getComputedStyle(list).display, rect: list.getBoundingClientRect().toJSON() } : null,
          cards,
        };
      }),
    }));
    const activePlaceFeed = placeFeedLayout.sections.find(section =>
      section.list && section.list.rect.width > 0 && section.list.rect.height > 0);
    assert.ok(
      activePlaceFeed?.cards.length === 2 &&
      activePlaceFeed.cards.every(card => card.left >= 0 && card.right <= 390 && card.width > 0) &&
      activePlaceFeed.cards[1].top >= activePlaceFeed.cards[0].bottom - 1,
      `Places opens as a compact, vertically scrolling tagged-post feed: ${JSON.stringify({ placeFeedLayout, placeFeedQueries })}`,
    );
    assert.equal(await page.locator(".places-browse .place-feed-card").count(), 2,
      "the full Places feed shows multiple tagged posts");
    assert.equal(await page.locator(".places-browse .place-feed-chip[data-place-label]").first().innerText(), "Miami Beach",
      "a post shows its plain place label");
    await swipePlaceMap(".places-browse [data-place-map-handle]", 120);
    await page.locator(".places-browse.is-map-revealed").waitFor({ state: "visible" });
    assert.equal(await page.locator(".places-browse .places-map-backdrop").getAttribute("aria-hidden"), "false");
    await swipePlaceMap(".places-browse [data-place-map-handle]", -120);
    await page.locator(".places-browse:not(.is-map-revealed)").waitFor({ state: "visible" });
    await page.locator("#places-search-input").fill("Miami");
    await page.locator("#places-search-input").press("Enter");
    await page.locator(".places-search-result[data-place-label='Miami Beach']").waitFor({ state: "visible" });
    assert.ok(placeFeedQueries.some(item => item.query === "Miami"),
      "place search filters the tagged-post feed as well as finding tagged locations");
    assert.equal(await page.locator(".places-browse .place-feed-card").count(), 1);
    await page.locator(".places-browse .place-feed-chip[data-place-label]").click();
    await page.locator("#place-detail-heading").waitFor({ state: "visible" });
    assert.equal(await page.locator("#place-detail-heading").innerText(), "Miami Beach");
    await page.locator('[data-action="back-to-places"]').click();
    await page.locator(".places-browse .place-feed-list").waitFor({ state: "visible" });
    await page.locator("#places-search-input").fill("#food");
    await page.locator("#places-search-input").press("Enter");
    await page.locator('.place-feed-card[data-post-id="miami-place-post"]').waitFor({ state: "visible" });
    assert.ok(placeFeedQueries.some(item => item.query === "#food"),
      "hashtag searches can narrow the same place-tagged content feed");
    await page.locator('button[data-tab="updates"]').click();
    await page.locator('[data-home-view="following"]').waitFor({ state: "visible" });
    await page.locator('[data-home-view="following"]').click();
    await page.locator('[data-home-view="explore"]').click();
    await page.locator('.home-screen[data-places-view="false"]').waitFor({ state: "visible" });
    await page.evaluate(() => {
      const clip = document.createElement("div");
      clip.className = "clip";
      const tag = document.createElement("button");
      tag.type = "button";
      tag.dataset.placeExplore = "Miami Beach";
      tag.dataset.placeId = "osm:relation:miami-beach";
      tag.dataset.placeSource = "osm";
      tag.dataset.placeLat = "25.7907";
      tag.dataset.placeLon = "-80.13";
      clip.append(tag);
      document.querySelector("#feed")?.append(clip);
    });
    await page.evaluate(() => document.querySelector('.clip [data-place-explore="Miami Beach"]')?.click());
    await page.locator("#place-detail-heading").waitFor({ state: "visible" });
    await page.locator('[data-action="back-to-home"]').click();
    await page.locator('.home-screen[data-places-view="false"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="button-header-search"]').click();
    await page.locator("#q").waitFor({ state: "visible" });
    assert.equal(await page.locator(".search-hub-tabs").count(), 0,
      "Search opens without the removed Videos/Places tabs");
    await assertScrollRestoredAfterRefresh("Search");
    assert.equal(await page.locator("#q").getAttribute("placeholder"), "Search Oldtime");
    await page.locator("#q").fill("@StoryMember");
    await page.locator('[data-xe-profile="52a126f3-8f2b-4c15-b45f-07af2853d821"]').waitFor({ state: "visible" });
    assert.match(await page.locator('[data-xe-profile="52a126f3-8f2b-4c15-b45f-07af2853d821"]').innerText(), /@storymember/,
      "username search should use authenticated unified discovery and accept @handles");
    await page.locator('[data-xe-profile="52a126f3-8f2b-4c15-b45f-07af2853d821"]').click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    assert.match(await page.locator(".profile-name").innerText(), /Story Member Online/);
    assert.deepEqual(
      await page.locator(".profile-screen:visible .profile-primary-actions.profile-visitor-actions button").allInnerTexts(),
      ["Follow", "Message", "Share"],
      "visitor profiles show Follow, Message, and Share in the shared action row",
    );
    assert.doesNotMatch(await page.locator(".profile-stats").innerText(), /\bviews?\b/i,
      "view totals are not shown in a visitor profile header");
    assert.equal(await page.locator("#pfollow").isVisible(), true);
    const followingLabelColor = await page.locator("#pfollow").evaluate(button => {
      button.setAttribute("aria-pressed", "true");
      const color = getComputedStyle(button.querySelector("span")).color;
      button.setAttribute("aria-pressed", "false");
      return color;
    });
    assert.equal(followingLabelColor, "rgb(32, 35, 41)",
      "the light Following profile button keeps dark, readable text");
    assert.match(await page.locator("#pmsg").getAttribute("aria-label"), /Message @storymember/);
    assert.equal(await page.locator(".profile-relationship-actions, .profile-actions").count(), 0,
      "relationship, block, and report controls stay out of the profile header");
    await page.locator("#profile-actions-open").click();
    await page.locator("#profile-actions-sheet").waitFor({ state: "visible" });
    assert.deepEqual(await page.locator("#profile-actions-sheet [role='menuitem'] span:not(.profile-action-selected)").allInnerTexts(),
      ["Restrict", "Block", "Report"]);
    assert.equal(await page.locator("#pfriend").count(), 0);
    assert.equal(await page.locator("#pclosefriend").count(), 0);
    await page.locator("#prestrict").click();
    await page.locator("#profile-actions-open").click();
    assert.equal(await page.locator("#prestrict").getAttribute("aria-pressed"), "true",
      "Restrict hides the owner's Stories without changing the follow relationship");
    await page.keyboard.press("Escape");
    await page.locator("#profile-actions-sheet").waitFor({ state: "hidden" });
    await page.locator('.nav [data-tab="updates"]').click();
    await assertHomeCreateAvailable(page);

    assert.equal(await page.locator('[data-drawer-route="chat"]').count(), 0,
      "Messages is not duplicated in the navigation drawer");
    assert.equal(await page.locator('.nav [data-tab="chat"]').count(), 1,
      "Messages remains available from the primary navigation");
    if (await page.locator('.nav [data-tab="chat"]').count()) {
    await page.locator('.nav [data-tab="chat"]').click();
    await page.locator(".chat-list-screen").waitFor({ state: "visible" });
    await assertScrollRestoredAfterRefresh("Chat inbox");
    const expectedChatIds = fixture.convos.map(conversation => conversation.id).sort();
    const visibleChatIds = () => page.locator("#crows .chat-inbox-row")
      .evaluateAll(rows => rows.map(row => row.dataset.inboxRow).sort());
    assert.deepEqual(await visibleChatIds(), expectedChatIds,
      "All chats includes every fixture conversation, including the empty new chat");
    assert.equal(await page.locator("#saved").count(), 0, "Saved should not duplicate the Saved option in inbox settings");
    assert.equal(await page.locator('[data-testid="button-nav-profile"]').isVisible(), true, "Messages keeps Profile in the bottom navigation");
    assert.equal(await page.locator('[data-testid="button-header-profile"]').count(), 0, "Messages does not duplicate Profile in its header");
    assert.equal(await page.locator("#chat-search-panel").count(), 0, "Messages has no extra inline search field");
    assert.equal(await page.locator("#chat-more").count(), 1, "Message settings should appear once inside the action picker");
    assert.equal(await page.locator("#chat-more").isVisible(), false, "Message settings are not in the Messages header");
    assert.equal(await page.locator("#chat-list-picker-toggle").isVisible(), true, "the compose picker sits on the Messages title row");
    const openInboxPicker = async () => {
      await page.locator("#chat-list-picker-toggle").click();
      await page.locator("#chat-more-menu").waitFor({ state: "visible" });
    };
    const openMessageSettings = async () => {
      await openInboxPicker();
      await page.locator("#chat-more").click();
      await page.locator(".chat-settings-screen").waitFor({ state: "visible" });
    };
    await openInboxPicker();
    assert.equal(await page.locator("#newchat").isVisible(), true, "new message is inside the action picker");
    assert.equal(await page.locator("#chat-more").getAttribute("aria-label"), "Message settings");
    const messageActionFocus = await page.locator("#newchat").evaluate(element => {
      element.focus();
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
    });
    assert.equal(messageActionFocus.outlineStyle, "none", "Message actions do not show the black focus selector");
    assert.equal(messageActionFocus.boxShadow, "none");
    const pickerHandle = await page.locator("#chat-more-menu .chat-filter-sheet-handle").boundingBox();
    assert.ok(pickerHandle, "the action picker has a visible swipe handle");
    await page.mouse.move(pickerHandle.x + pickerHandle.width / 2, pickerHandle.y + pickerHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(pickerHandle.x + pickerHandle.width / 2, pickerHandle.y + pickerHandle.height / 2 + 200, { steps: 6 });
    await page.mouse.up();
    await page.locator("#chat-more-menu").waitFor({ state: "hidden" });
    if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-inbox.png" });
    await page.setViewportSize({ width: 470, height: 874 });
    const initialInboxMenu = await page.locator("#chat-more-menu").evaluate(element => ({
      hidden: element.hidden,
      display: getComputedStyle(element).display,
      menuTextVisible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
    }));
    assert.equal(initialInboxMenu.hidden, true, "message actions must start closed on the Messages landing screen");
    assert.equal(initialInboxMenu.display, "none", "closed message actions must not leak into the Messages header");
    assert.equal(initialInboxMenu.menuTextVisible, false, "closed message actions must not be visible");
    for (const width of [320, 402, 430, 470, 980]) {
      await page.setViewportSize({ width, height: 874 });
      await openMessageSettings();
      await page.locator('.chat-settings-choice[data-chat-choice="directMessages"]').first().waitFor({ state: "visible" });
      assert.equal(await page.locator(".chat-settings-title").textContent(), "Chat Settings");
      const settingsText = await page.locator(".chat-settings-screen").innerText();
      assert.doesNotMatch(settingsText, /\bFilters\b|\bFolders\b/);
      assert.equal(await page.locator("[data-chat-saved]").count(), 1);
      const settingsGeometry = await page.locator(".chat-settings-screen").evaluate(element => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        contentWidth: element.querySelector(".chat-settings-content").clientWidth,
        contentScrollWidth: element.querySelector(".chat-settings-content").scrollWidth
      }));
      assert.ok(settingsGeometry.scrollWidth <= settingsGeometry.width + 1,
        `Chat Settings should fit at ${width}px: ${JSON.stringify(settingsGeometry)}`);
      assert.ok(settingsGeometry.contentScrollWidth <= settingsGeometry.contentWidth + 1,
        `Chat Settings content should not spill horizontally at ${width}px: ${JSON.stringify(settingsGeometry)}`);
      if (process.env.OLDTIME_CHAT_SCREENSHOTS && width === 402) {
        await page.screenshot({ path: "/tmp/oldtime-chat-settings.png" });
      }
      await page.locator("#chat-settings-back").click();
      await page.locator(".chat-list-screen").waitFor({ state: "visible" });
    }

    await page.setViewportSize({ width: 402, height: 874 });
    assert.equal(await page.locator(".chat-list-screen .chat-inbox-tab").count(), 0,
      "folder categories do not occupy the Messages page");
    assert.deepEqual(await visibleChatIds(), expectedChatIds,
      "Messages shows every conversation without Filters or Folders");
    await page.locator("#crows .chat-inbox-row").first().click();
    await page.locator("#msg").waitFor({ state: "visible" });
    await page.locator("#chat-add").click();
    await page.locator("#chat-compose-tools").waitFor({ state: "visible" });
    const attachmentActions = await page.locator("#chat-compose-tools button").evaluateAll(buttons => buttons.map(button => ({
      label: button.innerText.trim(),
      width: button.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
      scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth,
    })));
    assert.equal(attachmentActions.length, 3);
    assert.deepEqual(attachmentActions.map(action => action.label), [
      "Photos and attachments",
      "Emoji",
      "Message settings",
    ]);
    for (const action of attachmentActions) {
      assert.ok(action.width > 120, `attachment action "${action.label}" must have enough room to wrap by word: ${JSON.stringify(action)}`);
      assert.ok(action.height < 90, `attachment action "${action.label}" must not stack one character per line: ${JSON.stringify(action)}`);
      assert.ok(action.scrollWidth <= action.clientWidth + 1, `attachment action "${action.label}" must not clip horizontally: ${JSON.stringify(action)}`);
    }
    const composerAddStyle = await page.locator("#chat-add").evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
    }));
    assert.equal(composerAddStyle.background, "rgba(0, 0, 0, 0)",
      "the conversation plus action stays transparent");
    assert.equal(composerAddStyle.color, "rgb(23, 25, 28)",
      "the conversation plus action stays black");
    await page.locator("#chat-compose-settings").click();
    await page.locator(".chat-settings-screen").waitFor({ state: "visible" });
    await page.locator("#chat-settings-back").click();
    await page.locator("#msg").waitFor({ state: "visible" });
    await page.locator("#chat-add").click();
    await page.locator("#chat-compose-tools").waitFor({ state: "visible" });
    await page.locator("#attach").click();
    await page.locator(".chat-attachment-panel").waitFor({ state: "visible" });
    const attachmentChoices = await page.locator("[data-attachment-choice]").evaluateAll(buttons =>
      buttons.map(button => button.dataset.attachmentChoice));
    assert.deepEqual(attachmentChoices, ["Media", "Document", "Contact", "View once"]);
    assert.doesNotMatch(await page.locator(".chat-attachment-panel").innerText(), /\bGIF\b|\bPoll\b|\bSticker\b/i,
      "the streamlined attachment sheet removes the redundant GIF, poll and sticker actions");
    await page.locator(".chat-attachment-close").click();
    if (await page.locator("#chat-compose-tools").isVisible()) await page.locator("#chat-add").click();
    if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-thread.png" });
    const renderedBubble = await page.locator("#msgs .bubble-msg").first().evaluate(element => ({
      height: element.getBoundingClientRect().height,
      messageHeight: element.querySelector(".message-body").getBoundingClientRect().height,
      text: element.querySelector(".message-body").innerText,
      metadataInsideBubble: !!element.querySelector(".meta-line"),
      rowAlignment: getComputedStyle(element.closest(".message-row")).alignItems,
      rowBackground: getComputedStyle(element.closest(".message-row")).backgroundColor,
      bubbleBackground: getComputedStyle(element).backgroundColor,
      timestamp: element.closest(".message-row").querySelector(".message-time")?.textContent,
      timestampInsideBubble: !!element.querySelector(".message-time"),
      timestampAlignedLeft: element.closest(".message-row").querySelector(".message-footer")?.getBoundingClientRect().left
    }));
    assert.ok(renderedBubble.height < 90,
      `a short rendered chat bubble should not retain template whitespace, got ${renderedBubble.height}px`);
    assert.ok(renderedBubble.messageHeight < 45,
      `the message body should occupy only its text lines, got ${renderedBubble.messageHeight}px`);
    assert.equal(renderedBubble.metadataInsideBubble, false,
      "time and delivery checks should sit below the bubble, not inside it");
    assert.equal(renderedBubble.rowAlignment, "flex-start",
      "incoming bubble should align to the left");
    assert.equal(renderedBubble.rowBackground, "rgba(0, 0, 0, 0)",
      "incoming message rows should not paint a gray backing panel");
    assert.equal(renderedBubble.bubbleBackground, "rgb(246, 244, 239)",
      "incoming message bubbles use pearly white with a hairline outline, not a gray fill");
    assert.match(renderedBubble.timestamp, /^[0-9]{1,2}:[0-9]{2}/,
      "one timestamp should appear below the last message in a cluster");
    assert.equal(renderedBubble.timestampInsideBubble, false,
      "timestamps should sit outside the bubble");
    const incomingBubbleLeft = await page.locator("#msgs .bubble-msg").first().evaluate(element => element.getBoundingClientRect().left);
    assert.ok(Math.abs(renderedBubble.timestampAlignedLeft - incomingBubbleLeft) < 8,
      `incoming timestamp should align with its bubble (${renderedBubble.timestampAlignedLeft}px vs ${incomingBubbleLeft}px)`);
    const outgoingBubble = await page.locator("#msgs .bubble-msg.mine").first().evaluate(element => {
      const row = element.closest(".message-row");
      const footer = row.querySelector(".message-footer");
      return {
        height: element.getBoundingClientRect().height,
        text: element.querySelector(".message-body").innerText,
        rowAlignment: getComputedStyle(row).alignItems,
        rowBackground: getComputedStyle(row).backgroundColor,
        bubbleBackground: getComputedStyle(element).backgroundColor,
        statusInsideBubble: !!element.querySelector(".message-status"),
        status: footer?.textContent.trim(),
        time: footer?.querySelector(".message-time")?.textContent,
        footerRight: footer?.getBoundingClientRect().right,
        bubbleRight: element.getBoundingClientRect().right,
        timeInsideBubble: !!element.querySelector(".message-time")
      };
    });
    assert.equal(outgoingBubble.text, "hey");
    assert.ok(outgoingBubble.height < 70,
      `a one-word sent message should fit a compact bubble, got ${outgoingBubble.height}px`);
    assert.equal(outgoingBubble.rowAlignment, "flex-end",
      "sent bubbles should align to the right on mobile");
    assert.equal(outgoingBubble.rowBackground, "rgba(0, 0, 0, 0)",
      "sent message rows should not paint a gray backing panel");
    assert.equal(outgoingBubble.bubbleBackground, "rgb(23, 25, 28)",
      "the actual sent bubble should use the requested black surface");
    assert.equal(outgoingBubble.statusInsideBubble, false,
      "delivery checks should not be drawn inside the sent bubble");
    assert.equal(outgoingBubble.timeInsideBubble, false);
    assert.equal(outgoingBubble.time, undefined,
      "the first message in a same-sender cluster should not repeat the timestamp");
    assert.equal(outgoingBubble.status, undefined,
      "the middle message in a cluster should not repeat the delivery label");
    const outgoingClusterEnd = await page.locator("#msgs .bubble-msg.mine").last().evaluate(element => {
      const row = element.closest(".message-row");
      const footer = row.querySelector(".message-footer");
      return {
        time: footer?.querySelector(".message-time")?.textContent,
        status: footer?.querySelector(".message-status")?.textContent,
        timeInsideBubble: !!element.querySelector(".message-time"),
        hasCheckmark: /✓/.test(footer?.textContent || ""),
        footerRight: footer?.getBoundingClientRect().right,
        bubbleRight: element.getBoundingClientRect().right
      };
    });
    assert.match(outgoingClusterEnd.time, /^[0-9]{1,2}:[0-9]{2}/,
      "show one timestamp at the end of the same-sender cluster");
    assert.equal(outgoingClusterEnd.status, "Delivered",
      "show Apple's text receipt under the latest sent message");
    assert.equal(outgoingClusterEnd.hasCheckmark, false,
      "text receipts should not include checkmark glyphs");
    assert.equal(outgoingClusterEnd.timeInsideBubble, false);
    assert.ok(Math.abs(outgoingClusterEnd.footerRight - outgoingClusterEnd.bubbleRight) < 8);
    const incomingMessage = page.locator("#msgs .bubble-msg").first();
    await incomingMessage.click();
    const quickActions = page.locator(".chat-message-quick-actions");
    await quickActions.waitFor({ state: "visible" });
    assert.equal(await quickActions.locator("[data-chat-quick-reaction]").count(), 4,
      "tapping a message should show a compact row of common reactions");
    assert.equal(await quickActions.locator("[data-chat-quick-reply]").count(), 1,
      "reply is available directly from the compact message actions");
    await quickActions.locator("[data-chat-quick-reply]").click();
    await page.locator(".replybar").waitFor({ state: "visible" });
    await page.locator("#clearrep").click();
    await incomingMessage.click();
    await quickActions.locator("[data-chat-quick-reaction]").first().click();
    assert.equal(await quickActions.count(), 0, "choosing a reaction closes the quick actions");
    assert.ok(await page.locator("#msgs [data-react-msg]").count() > 0,
      "the chosen reaction is reflected on the message");
    assert.equal(await page.locator("#msg").evaluate(element => element.tagName), "TEXTAREA",
      "the message composer should grow vertically instead of clipping long text");
    await page.locator("#msg").fill("First message line\nSecond message line\nThird message line");
    const expandedComposer = await page.locator("#msg").evaluate(element => ({
      height: parseFloat(getComputedStyle(element).height),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }));
    assert.ok(expandedComposer.height > 45, "multiline drafts should expand the composer");
    assert.ok(expandedComposer.clientHeight >= expandedComposer.scrollHeight - 1,
      "short multiline drafts should remain fully visible");
    await page.locator("#msg").fill("");
    await page.locator("#back").click();
    await page.locator(".chat-list-screen").waitFor({ state: "visible" });
    await page.locator("#chat-list-picker-toggle").click();
    await page.locator("#newchat").click();
    const previousComposeViewport = page.viewportSize();
    await page.setViewportSize({ width: 402, height: 874 });
    await page.locator(".chat-compose-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator(".chat-compose-header h2").innerText(), "New chat");
    assert.equal(await page.locator("#chat-compose-cancel").isVisible(), true);
    assert.equal(await page.locator("#chat-contact-search").getAttribute("placeholder"), "Search");
    assert.equal(await page.locator("#chat-compose-create-group").innerText(), "Create group");
    const pickerStyle = await page.locator(".chat-compose-panel").evaluate(panel => ({
      radius: getComputedStyle(panel).borderTopLeftRadius,
      overlay: getComputedStyle(document.querySelector(".sheet.on")).backgroundColor,
      searchHeight: document.querySelector(".chat-compose-search").getBoundingClientRect().height,
      groupIcon: document.querySelector(".chat-compose-group-icon").getBoundingClientRect().width,
    }));
    assert.equal(pickerStyle.radius, "24px");
    assert.ok(pickerStyle.overlay.includes("rgba"));
    assert.ok(pickerStyle.searchHeight >= 50);
    assert.ok(pickerStyle.groupIcon >= 56);
    if (process.env.OLDTIME_CHAT_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-new-message.png" });
    }
    await page.setViewportSize(previousComposeViewport);
    await page.locator("#chat-contact-search").fill("storymember");
    await page.locator("[data-pick]").first().waitFor({ state: "visible" });
    assert.equal(await page.locator("#start").count(), 0, "direct-message mode should not show a redundant Start chat button");
    await page.locator("[data-pick]").first().click();
    await page.locator("#msgs").waitFor({ state: "visible" });
    await assertScrollRestoredAfterRefresh("Chat thread");
    assert.equal(await page.locator(".chat-identity-name").innerText(), "Story Member Online",
      "tapping a person should open their one-to-one inbox directly");
    const chatScrollStyle = await page.addStyleTag({ content: `
      .screen.on .scroll {height:220px!important;max-height:220px!important;overflow-y:auto!important}
      .screen.on .scroll::after {content:"";display:block;height:900px;flex:0 0 900px}
    ` });
    const chatThreadOffset = await page.locator("#msgs").evaluate(element => {
      element.scrollTop = 180;
      return element.scrollTop;
    });
    assert.ok(chatThreadOffset > 0, "the chat thread fixture should be scrollable");
    await page.locator("#info").click();
    await page.locator(".chat-details-screen").waitFor({ state: "visible" });
    await page.locator("#back").click();
    await page.locator("#msgs").waitFor({ state: "visible" });
    assert.equal(await page.locator("#msgs").evaluate(element => element.scrollTop), chatThreadOffset,
      "returning from chat details restores the thread's previous position");
    await page.locator("#msgs").evaluate(element => { element.scrollTop = 0; });
    await chatScrollStyle.evaluate(element => element.remove());
    await page.locator("#back").click();
    await page.locator(".chat-list-screen").waitFor({ state: "visible" });
    await page.locator("#chat-list-picker-toggle").click();
    await page.locator("#newchat").click();
    await page.locator("#chat-compose-create-group").click();
    await page.locator(".chat-compose-panel.is-group-mode").waitFor({ state: "visible" });
    assert.equal(await page.locator(".chat-compose-header h2").innerText(), "New group");
    assert.equal(await page.locator("#chat-compose-switch").isVisible(), true);
    assert.equal(await page.locator("#gtitle").isVisible(), true);
    await page.locator("#chat-contact-search").fill("storymember");
    await page.locator("[data-pick]").first().waitFor({ state: "visible" });
    await page.locator("[data-pick]").first().click();
    await page.locator("#start").waitFor({ state: "visible" });
    assert.equal(await page.locator("#start").isDisabled(), true,
      "a group needs at least two other members before it can be created");
    assert.equal(await page.locator("#chat-compose-selected .chat-compose-chip").count(), 1,
      "group selection should be shown as a removable chip");
    await page.locator("#chat-compose-selected [data-remove-pick]").click();
    assert.equal(await page.locator("#start").count(), 0, "removing the last selected person should hide Create group");
    await page.locator("[data-pick]").first().click();
    await page.locator("#chat-contact-search").fill("groupmember");
    await page.locator("[data-pick]").first().waitFor({ state: "visible" });
    await page.locator("[data-pick]").first().click();
    assert.equal(await page.locator("#chat-compose-selected .chat-compose-chip").count(), 2,
      "a group can be created after selecting two other online members");
    assert.equal(await page.locator("#start").isEnabled(), true);
    await page.locator("#start").click();
    await page.locator("#msgs").waitFor({ state: "visible" });
    assert.equal(await page.locator(".chat-identity-name").innerText(), "Group",
      "Create group should open the newly created group conversation");
    await page.locator("#back").click();
    await page.locator(".chat-list-screen").waitFor({ state: "visible" });
    }
    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator("#create-open").click();
    await page.locator(".create-flow-picker").waitFor({ state: "visible" });
    assert.deepEqual(await page.locator("[data-create-choice]").evaluateAll(buttons =>
      buttons.map(button => button.dataset.createChoice)), ["photos", "video", "text", "camera"]);
    await page.locator('[data-create-choice="camera"]').click();
    await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible" });
    const cameraControlOrder = await page.locator(".cs-capture-row").evaluate(row =>
      [...row.querySelectorAll("#ce-camera-gallery-slot,#ce-shutter,#ce-camera-reset")].map(item => item.id)
    );
    assert.deepEqual(cameraControlOrder, ["ce-camera-gallery-slot", "ce-shutter", "ce-camera-reset"]);
    assert.equal(await page.locator(".ce-stage #ce-flash").count(),1);
    assert.equal(await page.locator(".ce-stage #ce-flip").count(),1);
    assert.equal(await page.locator("#ce-filter-button").count(), 0, "Capture has no filter tool");
    assert.equal(await page.locator("#ce-camera-gallery-slot button[aria-label='Library']").getAttribute("aria-label"), "Library");
    assert.equal(await page.locator("#ce-camera-gallery-slot .ce-library-label").textContent(), "Library");
    assert.equal(await page.locator("#ce-camera-gallery-slot button[aria-label='Library']").evaluate(button =>
      getComputedStyle(button, "::after").content), "none");
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-technologies-create.png" });
    }
    try {
      await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible", timeout: 5000 });
    } catch (error) {
      const state = await page.locator(".creative-editor").evaluateAll(elements => elements.map(element => ({
        classes: element.className, message: element.querySelector("#ce-error")?.textContent,
      })));
      throw new Error(`Camera editor did not open; editors=${JSON.stringify(state)}; pageErrors=${pageErrors.join(" | ")}`, { cause: error });
    }
    await page.waitForFunction(() => document.querySelector("#ce-error")?.textContent.trim());
    assert.equal(await page.locator("#ce-canvas").evaluate(canvas => canvas.getBoundingClientRect().width <= innerWidth), true,
      "the full-screen canvas stays inside the phone viewport");
    await page.locator("#ce-close").click();
    if (await page.locator("#ce-exit-dialog").isVisible()) await page.locator("#ce-exit-discard").click();
    await page.locator(".creative-editor").waitFor({ state: "detached" });
    await page.evaluate(({ testImageMedia, testVideoMedia }) => {
      const state = JSON.parse(localStorage.getItem("oldtime-v1"));
      state.posts = [{
        id: "profile-grid-image", author: state.session, kind: "image", caption: "",
        media: [testImageMedia], likes: ["story-member"], comments: [], reposts: [], saves: [], views: 26, created: 1700000000000
      }, {
        id: "profile-grid-note", author: state.session, kind: "text", caption: "A thought from the test profile",
        text: "A thought from the test profile", media: [], likes: [], comments: [], reposts: [], saves: [], views: 0, created: 1700000001000
      }, {
        id: "profile-grid-video", author: state.session, kind: "video", caption: "A video in the community timeline",
        media: [testVideoMedia], likes: [], comments: [], reposts: [], saves: [], views: 0, created: 1700000002000
      }];
      localStorage.setItem("oldtime-v1", JSON.stringify(state));
    }, { testImageMedia, testVideoMedia });
    showProfileGridFixture = true;
    await page.reload({ waitUntil: "networkidle" });
    try {
      await assertHomeCreateAvailable(page);
    } catch (error) {
      console.error("Profile grid reload diagnostic", {
        body: await page.locator("body").innerText().catch(() => ""),
        pageErrors
      });
      throw error;
    }
    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator('.clip[data-id="profile-grid-image"]').waitFor({ state: "visible" });
    await page.locator('.clip[data-id="profile-grid-video"] .soundbar [data-audio-open]').waitFor({ state: "visible" });
    assert.equal(await page.locator('.clip[data-id="profile-grid-video"] [data-post-edit]').count(), 0,
      "published feed media opens for viewing; Edit remains in Community's post menu");
    assert.equal(await page.locator('.clip[data-id="profile-grid-video"] [data-audio-action]').count(), 0,
      "the compact sound label does not add duplicate reuse or remix actions");
    assert.equal(await page.locator('.clip[data-id="profile-grid-video"] [data-delete-post]').count(), 0,
      "post deletion is not a large feed-rail action");
    assert.equal(await page.locator('.clip[data-id="profile-grid-note"]').count(), 0,
      "text-only Notes do not enter the Home media feed");
    await openOwnProfile(page);
    assert.equal(await page.locator(".profile-content-post-actions-menu").count(), 0,
      "Profile post cards do not show three-dot controls");
    await page.locator('[data-open="profile-grid-video"]').click();
    await page.locator(".post-viewer-screen.post-viewer-media").waitFor({ state: "visible" });
    const ownerPostOptions = page.locator(".post-viewer-screen.post-viewer-media .media-post-options");
    assert.equal(await ownerPostOptions.count(), 1,
      "full-screen Profile posts show their post options");
    await ownerPostOptions.locator(":scope > summary").click();
    for (const action of ["data-post-engagement-open", "data-post-edit", "data-post-archive",
      "data-delete-post", "data-post-cover-edit"]) {
      assert.equal(await ownerPostOptions.locator(`[${action}]`).count(), 1,
        `owner post menu includes ${action}`);
    }
    await ownerPostOptions.locator(":scope > summary").click();
    assert.equal(await page.locator('.post-viewer-screen.post-viewer-media .rail [data-save="profile-grid-video"]').count(), 1,
      "Save is available in the same action rail as Home");
    await page.locator("#post-viewer-back").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    await page.locator('.nav [data-tab="communities"]').click();
    await page.locator('[data-testid="card-community-post-profile-grid-note"]').waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-testid^="card-community-post-profile-grid-"]').count(), 3,
      "Community keeps text, photo, and video posts together while showing separate recommendations");
    const communityVideoMenu = page.locator('[data-testid="card-community-post-profile-grid-video"] .community-post-actions-menu');
    await communityVideoMenu.locator(":scope > summary").click();
    await communityVideoMenu.locator('[data-post-edit="profile-grid-video"]').click();
    await page.locator(".post-edit-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator(".post-edit-panel [data-edit-caption]").count(), 1,
      "Community post actions still open the editor");
    assert.equal(await page.locator(".post-edit-panel [data-edit-place]").count(), 1,
      "the post editor includes the location picker");
    assert.equal(await page.locator(".post-edit-panel [data-edit-visibility]").count(), 1,
      "the post editor lets its owner change the audience after publishing");
    const editPlace = page.locator(".post-edit-panel [data-edit-place]");
    const placeWidths = await editPlace.evaluate(button => ({
      button: button.getBoundingClientRect().width,
      row: button.parentElement.getBoundingClientRect().width,
    }));
    assert.ok(placeWidths.button < placeWidths.row,
      "the location control stays compact instead of stretching across the editor");
    assert.equal(await editPlace.locator("svg").count(), 1,
      "the location button keeps its pin icon");
    assert.equal(await page.locator(".post-edit-panel .post-edit-menu [data-delete-post]").count(), 1,
      "permanent deletion stays in the compact post options menu");
    assert.equal(await page.locator(".post-edit-panel .post-edit-menu [data-post-archive]").count(), 1,
      "the owner can archive the post from the Community post menu");
    assert.equal(await page.locator(".post-edit-panel .post-edit-actions [data-delete-post]").count(), 0,
      "there is no oversized delete button in the editor actions");
    await page.locator(".post-edit-panel [data-edit-caption]").fill("Updated by the owner");
    await page.locator(".post-edit-panel [data-edit-visibility]").selectOption("close-friends");
    await page.locator(".post-edit-panel [data-edit-save]").click();
    await page.locator(".post-edit-panel").waitFor({ state: "hidden" });
    assert.equal(profileGridPosts.find(post => post.id === "profile-grid-video").visibility, "close-friends",
      "the Community Edit action persists the selected audience");
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-note"] [data-post-edit]').count(), 1,
      "the owner can edit their Community post");
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-note"] [data-share]').count(), 1,
      "the owner can share a published post again");
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-note"] [data-repost]').count(), 1,
      "the owner can repost a published post");
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-note"] [data-delete-post]').count(), 0,
      "Community does not put Delete on the post card");
    assert.match(await page.locator('[data-testid="card-community-post-profile-grid-video"]').innerText(), /Updated by the owner/,
      "the edited caption is reflected in the Community copy");
    assert.match(await page.locator('[data-testid="card-community-post-profile-grid-note"]').innerText(), /A thought from the test profile/);
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-note"] .community-attachment-grid, [data-testid="card-community-post-profile-grid-note"] .cvc-stage').count(), 0,
      "text Notes remain uncluttered when they have no attached media");
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-image"] .community-attachment-grid img').count(), 1,
      "photo posts display inline in the Community timeline");
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-video"] video').count(), 1,
      "video posts display inline in the mixed X-style timeline");
    assert.equal(await page.locator(".community-story-section, .community-story-rail").count(), 0,
      "Community does not show Stories");
    assert.equal(await page.locator('[data-testid="community-story-own"]').count(), 0,
      "Community has no Story avatar action");
    assert.equal(await page.locator(".community-nav [data-tab='profile']").count(), 1,
      "Profile replaces Search in the bottom navigation");
    assert.equal(await page.locator(".community-nav [data-tab='search']").count(), 0,
      "Search is not in the bottom navigation");
    assert.equal(await page.locator("#community-search-open").count(), 0,
      "Community header has no Search");
    assert.equal(await page.locator("#stories-more").count(), 0,
      "Community has no hamburger menu button");
    assert.equal(await page.getByText("Photos from Notes", { exact: true }).count(), 0,
      "the photo-strip label is removed from Community");
    if (process.env.OLDTIME_COMMUNITY_SCREENSHOT) await page.screenshot({ path: "/tmp/oldtime-community-notes.png" });

    await page.waitForFunction(() => document.querySelectorAll(".community-post-card.motion-feed-entry").length === 0);
    const followingFeed = page.locator('[data-cf-feed="following"]');
    await followingFeed.click();
    assert.equal(await followingFeed.getAttribute("aria-current"), "page",
      "the Community Following feed tab is wired");
    assert.equal(await page.locator(".community-screen").evaluate(screen => screen.classList.contains("motion-screen-enter")), false,
      "switching Community feeds does not fade the whole screen from transparent");
    assert.equal(await page.locator(".community-post-card.motion-feed-entry").count(), 0,
      "Community tab switches do not re-run staggered opacity animations");
    assert.deepEqual(await page.locator(".community-screen, .stories-feed-scroll").evaluateAll(
      surfaces => surfaces.map(surface => getComputedStyle(surface).backgroundColor)
    ), ["rgb(255, 255, 255)", "rgb(255, 255, 255)"], "Community and its scrolling surface remain opaque white");
    const discoverFeed = page.locator('[data-cf-feed="discover"]');
    await discoverFeed.click();
    assert.equal(await discoverFeed.getAttribute("aria-current"), "page",
      "the Community Discover feed tab is wired");
    assert.equal(await page.locator(".community-screen").evaluate(screen => screen.classList.contains("motion-screen-enter")), false,
      "switching back to For You does not replay the full-screen fade");
    await page.locator('[data-like="profile-grid-note"]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-like="profile-grid-note"]')?.getAttribute("aria-pressed") === "true"
    );
    assert.equal(await page.locator('[data-like="profile-grid-note"]').getAttribute("aria-pressed"), "true",
      "the Community post action row is wired to the existing like behavior");
    await page.locator('[data-testid="card-community-post-profile-grid-note"] [data-share]').click();
    await page.locator(".srp-main-view").waitFor({ state: "visible" });
    const shareSnapshot = page.locator(".srp-main-view .srp-text-snapshot");
    await shareSnapshot.waitFor({ state: "visible" });
    const sharePreviewState = await page.locator(".srp-main-view").evaluate(panel => ({
      title: panel.querySelector("#share-sheet-title")?.textContent.trim(),
      titleColor: getComputedStyle(panel.querySelector("#share-sheet-title")).color,
      panelBackground: getComputedStyle(panel).backgroundColor,
      snapshotColor: getComputedStyle(panel.querySelector(".srp-text-snapshot")).color,
      snapshotBackground: getComputedStyle(panel.querySelector(".srp-text-snapshot")).backgroundColor,
      snapshot: panel.querySelector(".srp-text-snapshot")?.innerText || "",
      metrics: [...panel.querySelectorAll("[data-snapshot-metric]")].map(metric => metric.dataset.snapshotMetric),
      metricColors: Object.fromEntries([...panel.querySelectorAll("[data-snapshot-metric]")].map(metric => [
        metric.dataset.snapshotMetric,
        getComputedStyle(metric).color,
      ])),
    }));
    assert.equal(sharePreviewState.title, "Share post");
    assert.equal(sharePreviewState.titleColor, "rgb(23, 25, 29)", JSON.stringify(sharePreviewState));
    assert.equal(sharePreviewState.panelBackground, "rgb(255, 255, 255)", JSON.stringify(sharePreviewState));
    assert.equal(sharePreviewState.snapshotColor, "rgb(23, 25, 29)", JSON.stringify(sharePreviewState));
    assert.equal(sharePreviewState.snapshotBackground, "rgb(255, 255, 255)", JSON.stringify(sharePreviewState));
    assert.match(sharePreviewState.snapshot, /A thought from the test profile/);
    assert.ok(sharePreviewState.metrics.includes("comment"), JSON.stringify(sharePreviewState));
    assert.ok(sharePreviewState.metrics.includes("views"), JSON.stringify(sharePreviewState));
    assert.equal(sharePreviewState.metricColors.like, "rgb(217, 31, 91)", JSON.stringify(sharePreviewState));
    assert.equal(sharePreviewState.metricColors.views, "rgb(112, 119, 130)", JSON.stringify(sharePreviewState));
    if (process.env.OLDTIME_SHARE_TEXT_SCREENSHOT === "1") {
      await page.screenshot({ path: "/tmp/oldtime-community-share-preview.png" });
    }
    await page.locator("[data-social-sheet-close]").click();
    await page.locator(".srp-main-view").waitFor({ state: "detached" });
    await openOwnProfile(page);
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    assert.match(await page.locator(".profile-name").innerText(), /Test Member/);
    assert.deepEqual(await page.locator(".profile-section-tab").evaluateAll(tabs => tabs.map(tab => tab.getAttribute("aria-label"))),
      ["Posts", "Videos", "Community", "Reposts"], "profile content sections use a compact, labeled icon row");
    assert.equal(await page.locator(".profile-post-card").count(), 2,
      "the Posts timeline contains the profile's media posts");
    assert.equal(await page.locator(".profile-post-grid").evaluate(grid => getComputedStyle(grid).display), "flex");
    assert.equal(await page.locator(".profile-post-grid").evaluate(grid => getComputedStyle(grid).flexDirection), "column",
      "profile posts keep their existing single-column timeline on phone widths");
    assert.equal(await page.locator(".profile-post-timeline-avatar").count(), 2,
      "each timeline post keeps its creator's actual avatar");
    assert.equal(await page.locator(".profile-post-media").first().locator(".profile-post-views, .profile-post-video-mark, .profile-repost-mark, .profile-post-menu").count(), 0,
      "profile media previews contain no floating badges or menu");
    assert.equal(await page.locator(".profile-post-card .profile-post-stats, .profile-post-card .profile-post-likes, .profile-post-card .profile-post-views").count(), 0,
      "engagement counters stay off profile tiles");
    assert.ok(await page.locator(".profile-post-byline").count() > 0,
      "creator details remain above profile media in the timeline");
    assert.equal(await page.locator(".profile-content-post-actions-menu").count(), 0,
      "Profile post cards do not show three-dot controls");
    assert.equal(await page.locator(".profile-body").getByText("Quotes", { exact: true }).count(), 0,
      "text posts appear once in the Posts timeline instead of a duplicate Quotes shelf");
    assert.equal(await page.locator('[data-quote-open]').count(), 0, "legacy text posts do not expose a Quote viewer");
    await page.locator('[data-m="community"]').click();
    await page.locator('[data-testid="card-community-post-profile-grid-note"]').waitFor({ state: "visible" });
    assert.equal(await page.locator(".profile-community-timeline [data-testid^='card-community-post-profile-grid-']").count(), 1,
      "text posts appear in the dedicated profile Community section");
    const profileCommunityText = page.locator('.profile-community-timeline .community-post-copy').first();
    assert.equal(await profileCommunityText.evaluate(element => element.tagName), "P",
      "text-only Community posts stay readable text, not media-viewer buttons");
    assert.equal(await profileCommunityText.getAttribute("data-stories-post"), null,
      "Community text is never routed into the full-screen media viewer");
    await profileCommunityText.click();
    assert.equal(await page.locator('.clip.post-detail[data-id="profile-grid-note"]').count(), 0,
      "tapping a profile Community text post does not open it as a picture");
    assert.equal(await page.locator(".profile-screen").isVisible(), true,
      "the profile remains in place after reading a Community text post");
    await page.locator(".community-original-post-panel").waitFor({ state: "visible" });
    assert.match(await page.locator(".community-original-post-card").innerText(),
      /A thought from the test profile/,
      "the text post opens its original content in the existing readable sheet");
    await page.locator("[data-original-post-close]").click();
    await page.locator(".community-original-post-panel").waitFor({ state: "detached" });
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.locator(".profile-page").evaluate(element => {
        const tabs = element.querySelector(".profile-section-tabs");
        if (tabs) element.scrollTop = tabs.offsetTop - 100;
      });
      await page.screenshot({ path: "/tmp/oldtime-profile-grid.png" });
    }
    for (const mode of ["reposts", "videos", "community"]) {
      await page.locator(`[data-m="${mode}"]`).click();
      assert.equal(await page.locator(`[data-m="${mode}"]`).getAttribute("class").then(value => value.includes("on")), true,
        `profile ${mode} tab should become active`);
    }
    await page.locator('[data-m="posts"]').click();
    assert.equal(await page.locator("#profile-content-grid [data-open='profile-grid-image']").isVisible(), true,
      "the Posts tab returns to the profile timeline");
    await page.locator('[data-m="posts"]').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator('[data-m="videos"]').getAttribute("aria-selected"), "true",
      "profile icon tabs support keyboard arrow navigation");
    await page.waitForFunction(() => document.activeElement?.id === "profile-tab-videos");
    assert.equal(await page.locator('[data-m="videos"]').evaluate(element => element === document.activeElement),
      true, "keyboard tab selection keeps focus on the newly selected section");
    await page.locator("#edit").click();
    await page.locator(".edit-profile-screen").waitFor({ state: "visible" });
    await assertScrollRestoredAfterRefresh("Edit profile");
    await page.locator('[data-testid="input-profile-name"]').waitFor({ state: "visible" });
    await page.locator("#profile-editor-back").click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    showProfileGridFixture = false;
    await page.locator('.nav [data-tab="updates"]').click();

    await openCreatePreview(page);
    await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible" });
    await assertCreateSurfaceFillsViewport(page, "camera capture");
    assert.equal(await page.locator(".ch-page").count(), 0, "the old Create hub is retired");
    const libraryPicker = page.locator("#ce-upload");
    assert.equal(await libraryPicker.getAttribute("accept"), "image/*,video/*");
    const cameraCallsBeforeGallery = await page.evaluate(() => window.__getUserMediaCalls);
    const galleryChooser = page.waitForEvent("filechooser");
    await page.locator("#ce-camera-gallery-slot button[aria-label='Library']").click();

    await (await galleryChooser).setFiles({
      name: "library-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAmElEQVR4nO3QMREAIBDAsJeNDWxgEmRkoEP2Xmftc382OkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAO0BARgihnO/GDoAAAAASUVORK5CYII=", "base64")
    });
    // Authoritative success state: the camera is closed and a background photo is loaded; Create has no center fallback panel.
    await page.waitForFunction(() => {
      const editor = document.querySelector(".creative-editor"), canvas = document.querySelector("#ce-canvas");
      return editor && !editor.classList.contains("is-camera-open") && !document.querySelector("#ce-empty") && canvas?.width > 0 && canvas?.height > 0;
    }).catch(async error => {
      throw new Error(`Photo did not become ready. Camera open: ${await page.locator(".creative-editor").evaluate(element => element.classList.contains("is-camera-open"))}; error: ${await page.locator("#ce-error").textContent()}`, { cause: error });
    });
    assert.equal(await page.locator(".creative-editor").evaluate(element => element.classList.contains("is-camera-open")), false);
    await assertCreateSurfaceFillsViewport(page, "uploaded media editor");
    assert.ok(await page.locator("#ce-canvas").evaluate(canvas=>canvas.width>0&&canvas.height>0));
    assert.equal(await page.locator(".ce-dock").isVisible(),false,"media review uses the reference side rail instead of the capture dock");
    if (await studioWorkspaceActive(page)) {
      for (const tool of ["edit","audio","text","overlay","filters","adjust","canvas"]) assert.equal(await page.locator(`[data-cs-tool="${tool}"]`).isVisible(),true,tool);
      for (const lane of ["media","text","overlay","audio"]) {
        assert.equal(await page.locator(`.cs-tl-lane[data-lane="${lane}"]`).isVisible(), true, lane);
      }
      assert.equal(await page.locator("#ce-studio-publish").isVisible(),true);
    } else {
      assert.equal(await page.locator(".cs-rail").isVisible(),true);
      assert.equal(await page.locator("#ce-next-action").isVisible(),true);
    }
    let prematurePostRequests=0;
    const auditPostRequest=request=>{
      if(request.method()==="POST"&&new URL(request.url()).pathname==="/api/posts")prematurePostRequests++;
    };
    page.on("request",auditPostRequest);
    await openPublishReview(page);
    await assertCreateSurfaceFillsViewport(page, "share details");
    assert.equal((await page.locator("#ce-details-title").innerText()).trim(),"New post");
    await assertCompactShareLayout(page);
    await page.locator('[data-ce-audience="connections"]').click();
    assert.equal(await page.locator("#ce-visibility").inputValue(),"connections");
    assert.equal(prematurePostRequests,0,"Next and audience selection must not publish");
    if(process.env.OLDTIME_THEME_SCREENSHOTS)await page.screenshot({path:"/tmp/oldtime-create-details.png"});
    await page.locator("#ce-details-back").click();
    page.off("request",auditPostRequest);
    assert.equal(await page.locator("#ce-details").isVisible(),false);
    assert.equal(await page.locator("#ce-visibility").inputValue(),"connections");
    assert.equal(await page.locator("#ce-empty").count(),0,
      "The Create editor has no center fallback panel");
    if (await studioWorkspaceActive(page)) await chooseStudioAction(page, "audio", "sound", "sound");
    else await page.locator("#ce-sound-chip").click();
    await page.locator("#ce-sound-picker").waitFor({ state: "visible" });
    const soundPickerLayout = await page.locator("#ce-sound-picker").evaluate(panel => {
      const rect = panel.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        background: getComputedStyle(panel).backgroundColor,
      };
    });
    assert.ok(soundPickerLayout.width < soundPickerLayout.viewportWidth,
      "the sound picker stays inset from the screen edges");
    assert.ok(soundPickerLayout.height <= 320,
      "the sound picker remains compact and scrolls internally when needed");
    assert.equal(soundPickerLayout.background, "rgb(23, 24, 27)",
      "the sound picker is opaque instead of ghosting the editor underneath");
    await page.locator("#ce-sound-close").click();
    assert.ok(await page.evaluate(() => window.__getUserMediaCalls) >= cameraCallsBeforeGallery,
      "choosing media from the camera screen remains available");
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-create-theme.png" });
    }

    await page.locator("#ce-close").click();
    await page.locator(".creative-editor").waitFor({state:"detached"});

    await openCreatePreview(page);
    await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#ce-error")?.textContent.trim());
    assert.equal(await page.locator("#ce-canvas").evaluate(canvas => getComputedStyle(canvas).objectFit), "cover", "the full-screen camera preview fills the screen without letterboxing");
    await page.locator("#ce-close").click();
    if (await page.locator("#ce-exit-dialog").isVisible()) await page.locator("#ce-exit-discard").click();
    await page.locator(".creative-editor").waitFor({state:"detached"});

    await openCreatePreview(page);
    await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible" });
    assert.equal(await page.locator(".ch-page").count(), 0, "Create keeps its direct-to-camera entry");
    await page.locator("#ce-close").click();
    if (await page.locator("#ce-exit-dialog").isVisible()) await page.locator("#ce-exit-discard").click();
    await page.locator(".creative-editor").waitFor({ state: "detached" });

    await openOwnProfile(page);
    assert.equal(await page.locator('[data-testid="button-nav-profile"]').count(), 1,
      "Profile remains available in the bottom navigation");
    assert.equal(await page.locator(".nav-label").first().evaluate(label => getComputedStyle(label).display), "block",
      "regular screens use the same visible navigation labels");
    assert.equal(await page.locator(".profile-screen:visible .profile-primary-actions.profile-owner-actions button").count(), 3,
      "the owner sees Edit profile, Settings, and Share");
    assert.equal(await page.locator("#profile-dashboard").count(), 0,
      "no dashboard appears in the owner profile header");
    assert.doesNotMatch(await page.locator(".profile-stats").innerText(), /\bviews?\b/i,
      "view totals stay off the owner profile header");
    assert.match(await page.locator(".profile-stats").innerText(), /likes\s*&\s*saves/i,
      "the owner header combines actual Likes and Saves totals");
    assert.equal(await page.locator("#profile-actions-open").count(), 0,
      "the owner does not have a redundant top-right menu");
    assert.equal(await page.locator(".profile-primary-actions.profile-owner-actions button").count(), 3,
      "Edit profile, Settings, and Share are the complete owner action row");
    await page.locator("#edit").click();
    await page.locator(".edit-profile-screen").waitFor({ state: "visible" });
    await page.locator("#profile-editor-back").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    await page.locator("#profile-settings-open").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    await page.locator("#settings-back").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    assert.equal(await page.locator("#profile-note").count(), 0,
      "Add a note is not displayed as a bubble on the cover");
    assert.equal(await page.locator("[data-profile-note]").count(), 0,
      "the owner menu does not expose the removed cover note prompt");
    assert.equal(await page.locator(".profile-screen").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
    assert.equal(await page.locator('[data-testid="quote-strip"], [data-testid="quote-viewer"], [data-quote-open]').count(), 0,
      "the profile has no Quote shelf or Quote viewer");
    assert.equal(await page.locator('[data-collection-create], [data-collection-open]').count(), 0);
    await page.locator(".profile-post-card [data-open]").first().click();
    await page.locator(".post-viewer-screen.post-viewer-media").waitFor({ state: "visible" });
    const fullScreenOwnerMenu = page.locator(".post-viewer-screen.post-viewer-media .media-post-options");
    assert.equal(await fullScreenOwnerMenu.count(), 1,
      "full-screen Profile posts show their own post-options menu");
    await fullScreenOwnerMenu.locator(":scope > summary").click();
    for (const action of ["data-post-edit", "data-post-archive", "data-delete-post", "data-post-cover-edit"]) {
      assert.equal(await fullScreenOwnerMenu.locator(`[${action}]`).count(), 1,
        `owner options include ${action}`);
    }
    await fullScreenOwnerMenu.locator(":scope > summary").click();
    await page.locator("#post-viewer-back").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    await page.locator("#profile-settings-open").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    await assertScrollRestoredAfterRefresh("Open profile settings");
    assert.doesNotMatch(await page.locator(".settings-home").innerText(), /App menu/);
    assert.equal(await page.locator("#profile-actions-sheet").count(), 0,
      "the owner has no profile dropdown");
    await page.locator("#settings-back").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    assert.equal(await page.locator(".profile-page").evaluate(element => element.scrollWidth <= element.clientWidth), true);
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-profile-theme.png" });
    }
    await page.locator("#profile-settings-open").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-settings="data-transfer"]').count(), 0);
    assert.doesNotMatch(await page.locator(".settings-home").innerText(), /Transfer old data/);
    await page.locator("#settings-back").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    await openOwnProfile(page);
    await page.locator(".profile-page").waitFor({ state: "visible" });

    await page.setViewportSize({ width:402, height:650 });
    await page.locator("#edit").click();
    assert.equal(await page.locator("#profile-email-status").count(), 0, "profile editing stays clear of the old verification notice");
    for (const selector of ["#savep"]) {
      const placement = await page.locator(selector).evaluate(button => {
        const rect = button.getBoundingClientRect();
        const nav = document.querySelector(".nav").getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          visible: rect.top >= 0 && rect.bottom <= nav.top,
          clickable: hit === button || button.contains(hit),
          backgroundImage: getComputedStyle(button).backgroundImage,
          backgroundColor: getComputedStyle(button).backgroundColor,
          color: getComputedStyle(button).color
        };
      });
      assert.ok(placement.visible, `${selector} must stay above bottom navigation on a short phone`);
      assert.ok(placement.clickable, `${selector} must not be covered by another element`);
      assert.equal(placement.backgroundImage, "none");
      assert.equal(placement.backgroundColor, "rgb(23, 25, 28)");
      assert.equal(placement.color, "rgb(255, 255, 255)");
    }
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-profile-editor-save.png" });
    }
    await page.locator("#nm").fill("Profile Save Test");
    await page.locator("#bio").fill("Saved from the editor");
    await page.locator("#savep").click();
    await page.locator(".edit-profile-screen").waitFor({ state: "detached" });
    const profileSaveResult = await page.evaluate(() => ({
      name: document.querySelector(".profile-name")?.textContent.trim(),
      toast: document.querySelector(".toast")?.textContent.trim(),
      editorStillOpen: Boolean(document.querySelector(".edit-profile-screen")),
      saveDisabled: document.querySelector("#savep")?.disabled,
    }));
    assert.equal(profileSaveResult.name, "Profile Save Test", JSON.stringify(profileSaveResult));
    assert.equal(await page.locator(".profile-name").innerText(), "Profile Save Test");
    await page.reload();
    await openOwnProfile(page);
    await page.locator(".profile-screen").waitFor({ state:"visible" });
    await page.waitForFunction(() => document.querySelector(".profile-name")?.textContent.trim() === "Profile Save Test");
    const profileAfterReload = await page.evaluate(() => {
      const cached = JSON.parse(localStorage.getItem("oldtime-v1") || "{}");
      const user = cached.users?.find(item => item.id === "camera-quotes-test");
      const session = JSON.parse(sessionStorage.getItem("oldtime-cloud-session-v1") || "null");
      return {
        visible: document.querySelector(".profile-name")?.textContent.trim(),
        cachedName: user?.name,
        sessionDisplayName: session?.account?.displayName,
      };
    });
    assert.equal(profileAfterReload.visible, "Profile Save Test", JSON.stringify(profileAfterReload));
    await page.locator("#edit").click();
    assert.equal(await page.locator("#bio").inputValue(), "Saved from the editor");
    await page.locator("#city").fill("Test City");
    await page.locator("#savep").click();
    await page.locator(".profile-screen").waitFor({ state:"visible" });
    assert.match(await page.locator(".profile-city").innerText(), /Test City/);
    await page.setViewportSize({ width:402, height:874 });

    await page.locator('.nav [data-tab="updates"]').click();
    await openCreatePreview(page);
    await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible" });
    await page.locator("#ce-upload").setInputFiles({
      name: "friends-only-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAmElEQVR4nO3QMREAIBDAsJeNDWxgEmRkoEP2Xmftc382OkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAO0BARgihnO/GDoAAAAASUVORK5CYII=", "base64")
    });
    await page.waitForFunction(() => !document.querySelector("#ce-empty"));
    await assertCreateSurfaceFillsViewport(page, "second uploaded-media session");
    assert.equal(await page.locator("#ce-media-share-destinations").isVisible(), false,
      "legacy destination switching is not shown in the new fixed-destination flow");
    assert.equal(await page.locator("#ce-next-action").getAttribute("aria-label"), "Next");
    await chooseStudioAction(page, "text", "Add text", "text");
    await page.locator("#ce-inline-text").fill("Only my Close Friends should see this");
    await assertCreateSurfaceFillsViewport(page, "on-canvas text editing");
    await page.locator('#ce-text-presets [data-cs-preset="outline"]').click();
    await page.locator('#ce-text-colors [data-color="#e5262f"]').click();
    assert.equal(await page.locator("#ce-color").inputValue(),"#e5262f");
    assert.equal(await page.locator("#ce-text-bar").isVisible(),true);
    assert.equal(await page.locator("#ce-inline-text").evaluate(element=>document.activeElement===element),true,
      "styling text keeps the on-canvas editor focused");
    if(process.env.OLDTIME_THEME_SCREENSHOTS)await page.screenshot({path:"/tmp/oldtime-create-text.png"});
    await page.locator("#ce-text-done").click();
    await clickVisibleCreate(page, "#ce-ws-undo", "#ce-undo");
    assert.equal(await page.locator((await studioWorkspaceActive(page)) ? "#ce-ws-redo" : "#ce-redo").isEnabled(), true);
    await clickVisibleCreate(page, "#ce-ws-redo", "#ce-redo");
    const canvasBounds=await page.locator("#ce-canvas").boundingBox();
    await page.mouse.click(canvasBounds.x+canvasBounds.width/2,canvasBounds.y+canvasBounds.height/2);
    await chooseStudioAction(page, "text", "Styles", "templates");
    await assertCreateSurfaceFillsViewport(page, "text style controls");
    await page.locator("#ce-behind-subject").waitFor({state:"visible"});
    assert.equal(await page.locator("#ce-behind-subject").getAttribute("aria-pressed"),"false");
    await chooseStudioAction(page, "overlay", "Draw", "draw");
    await assertCreateSurfaceFillsViewport(page, "drawing tools");
    await page.locator("#ce-draw-controls").waitFor({state:"visible"});
    assert.equal(await page.locator("#ce-draw").getAttribute("aria-pressed"),"true");
    await chooseStudioAction(page, "overlay", "Draw", "draw");
    assert.equal(await page.locator("#ce-draw").getAttribute("aria-pressed"),"false");
    await page.locator("#ce-panel .ce-sheet-handle").evaluate(handle=>handle.click());
    await page.waitForFunction(()=>document.querySelector("#ce-panel")?.dataset.sheet!=="open");
    if (await studioWorkspaceActive(page)) {
      // Adjust is now the workspace sheet (11 sliders + per-item and global reset), replacing the old color panel.
      await openStudioTool(page, "adjust");
      await assertCreateSurfaceFillsViewport(page, "media adjustment controls");
      for (const key of ["exposure","brightness","contrast","highlights","shadows","saturation","warmth","tint","sharpen","vignette","grain"]) await page.locator(`#ce-ws-adj-${key}`).waitFor({state:"visible",timeout:5000});
      await page.locator("#ce-ws-sheet-close").click();
      await page.locator("#ce-ws-sheet").waitFor({state:"hidden"});
    } else {
      await page.locator('[data-ce-rail="adjust"]').click();
      await assertCreateSurfaceFillsViewport(page, "media adjustment controls");
      await page.locator('[data-ce-media-panel="color"]').waitFor({state:"visible",timeout:5000});
      await page.locator("#ce-media-close").click();
    }
    await chooseStudioAction(page, "canvas", "Canvas colour", "canvas-color");
    await assertCreateSurfaceFillsViewport(page, "canvas color controls");
    await page.locator(".ce-source").waitFor({state:"visible"});
    await page.locator("#ce-panel .ce-sheet-handle").evaluate(handle=>handle.click());
    await page.waitForFunction(()=>document.querySelector("#ce-panel")?.dataset.sheet!=="open");
    await openPublishReview(page);
    await assertCreateSurfaceFillsViewport(page, "Story audience details");
    assert.equal(publishedStory, null, "Next never publishes the composition");
    await page.locator('[data-ce-destination="story"]').click();
    assert.equal(await page.locator("#ce-destination").inputValue(),"story");
    await page.locator('[data-ce-audience="close-friends"]:visible').click();
    assert.equal(await page.locator("#ce-visibility").inputValue(), "close-friends");
    await page.locator("#ce-details-back").click();
    assert.equal(await page.locator("#ce-details").isVisible(), false);
    assert.equal(await page.locator("#ce-visibility").inputValue(), "close-friends",
      "going back preserves the explicitly selected audience");
    assert.equal(await page.locator('[data-ce-rail="stickers"]').count(),0);
    assert.equal(await page.locator('[data-ce-add="sticker"]').count(),0);
    assert.equal(await page.locator("#ce-sticker-flow").count(),0);
    await chooseStudioAction(page, "audio", "sound", "sound");
    await page.locator("#ce-sound-picker").waitFor({state:"visible"});
    await assertCreateSurfaceFillsViewport(page, "sound selection");
    assert.equal(await page.locator("#ce-sound-upload").getAttribute("accept"),"audio/*");
    assert.equal(await page.locator("#ce-sound-list").isVisible(),true);
    await page.locator("#ce-sound-close").click();
    await openPublishReview(page);
    assert.equal(await page.locator('[data-ce-audience="close-friends"]:visible').getAttribute("aria-pressed"), "true");
    const storyCreatesBefore = storyApiCalls.filter(call => call === "POST /api/stories").length;
    await page.locator("#ce-details-publish").evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => !document.querySelector(".creative-editor") ||
      Boolean(document.querySelector("#ce-error")?.textContent.trim()), null, { timeout: 15000 });
    const editorError = await page.locator("#ce-error").textContent().catch(() => "");
    assert.ok(!editorError?.trim(), `Story publish error: ${editorError}; API calls: ${storyApiCalls.join(", ")}`);
    await page.waitForFunction(() => !document.querySelector(".creative-editor"), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("oldtime-v1")).stories.length), 0,
      "a cloud Story must not be copied into device-local Story storage");
    assert.ok(publishedStory?.hasMedia && creationMediaReserved,
      `the rendered Story should use a confirmed Cloudflare media asset; story=${JSON.stringify(publishedStory)} reserved=${creationMediaReserved} calls=${storyApiCalls.join(",")}`);
    assert.equal(storyApiCalls.filter(call => call === "POST /api/stories").length, storyCreatesBefore + 1,
      "repeated Publish taps create exactly one Story");

    showProfileGridFixture = false;
    showExploreFixture = false;
    showRepostFixture = true;
    await page.evaluate(() => {
      const cached = localStorage.getItem("oldtime-v1");
      if (!cached) return;
      const state = JSON.parse(cached);
      if (Array.isArray(state.posts)) {
        state.posts = [];
        localStorage.setItem("oldtime-v1", JSON.stringify(state));
      }
    });
    await page.reload({ waitUntil: "networkidle" });
    await assertHomeCreateAvailable(page);
    await page.locator('.nav [data-tab="updates"]').click();
    const homePost = await showHomeForYouPost(page, "browser-repost-post");
    assert.equal(await homePost.locator(".feed-top-comment").count(), 0,
      "Home feed never displays animated top-comment overlays");
    const homeSharePath = await homePost.locator(".media-action-row [data-share] .navic path").getAttribute("d");
    showCommunityActionFixture = true;
    const communityFeedResponse = page.waitForResponse(response => {
      try {
        const url = new URL(response.url());
        return url.pathname.endsWith("/api/community/feed") && response.request().method() === "GET";
      } catch {
        return false;
      }
    });
    await page.locator('.nav [data-tab="communities"]').click();
    const communityFeed = await communityFeedResponse;
    assert.equal(communityFeed.status(), 200);
    assert.ok((await communityFeed.json()).posts?.some(post => post.id === "browser-repost-post"));
    await page.locator('[data-testid="card-community-post-browser-repost-post"]').waitFor({ state: "visible" });
    const remixCounter = page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-remix-count');
    assert.equal(await remixCounter.count(), 0,
      "Community cards omit the diagonal Remix badge shown in the attached screenshot");
    assert.deepEqual(await page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-actions').evaluate(element =>
      [...element.children].map(child => child.matches("[data-like]") ? "like"
        : child.matches("[data-repost]") ? "repost"
          : child.matches("[data-comment]") ? "comment"
            : child.matches(".ot-view-metric") ? "views"
            : child.matches("[data-save]") ? "save"
              : child.matches("[data-share]") ? "share" : "unknown")
    ), ["like", "repost", "comment", "views", "save", "share"],
    "Community action positions include the visible view count");
    const communitySharePath = await page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-actions [data-share] .navic path').getAttribute("d");
    assert.equal(communitySharePath, homeSharePath,
      "Community posts use the same curved forward-arrow share icon as Home");
    const communityIconStyle = await page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-actions').evaluate(element =>
      [...element.querySelectorAll("svg")].map(svg => [svg.getAttribute("fill"), svg.getAttribute("stroke-width"), svg.getAttribute("stroke-linecap")])
    );
    assert.equal(communityIconStyle.length, 6);
    assert.ok(communityIconStyle.every(([fill, width, cap]) => fill === "none" && width === "1.75" && cap === "round"),
      "Community social icons and view indicator use consistent thin rounded outlines while unselected");
    const communitySave = page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-actions [data-save]');
    const initialCommunitySaved = await communitySave.getAttribute("aria-pressed");
    const communitySaveColors = await communitySave.evaluate(button => ({
      icon: getComputedStyle(button.querySelector("svg")).color,
    }));
    await communitySave.click();
    await page.waitForFunction(({ initial }) =>
      document.querySelector('[data-testid="card-community-post-browser-repost-post"] [data-save]')?.getAttribute("aria-pressed") === String(initial !== "true"),
    { initial: initialCommunitySaved });
    const savedCommunityColors = await communitySave.evaluate(button => ({
      icon: getComputedStyle(button.querySelector("svg")).color,
    }));
    assert.notEqual(savedCommunityColors.icon, communitySaveColors.icon,
      "the saved bookmark icon updates its selected color");
    assert.equal(savedCommunityColors.icon, "rgb(23, 25, 28)", "the saved bookmark uses the black action color");
    await page.locator('.nav [data-tab="updates"]').click();
    const homeSaveAfterCommunity = page.locator('.clip[data-id="browser-repost-post"] [data-save]');
    await homeSaveAfterCommunity.waitFor({ state: "visible" });
    assert.equal(await homeSaveAfterCommunity.getAttribute("aria-pressed"), String(initialCommunitySaved !== "true"),
      "a Community save is reflected in the Home feed");
    await page.locator('.nav [data-tab="communities"]').click();
    await page.locator('[data-testid="card-community-post-browser-repost-post"] [data-save]').waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-testid="card-community-post-browser-repost-post"] [data-save]').getAttribute("aria-pressed"),
      String(initialCommunitySaved !== "true"), "returning to Community keeps the saved state");
    await communitySave.click();
    await page.waitForFunction(({ initial }) =>
      document.querySelector('[data-testid="card-community-post-browser-repost-post"] [data-save]')?.getAttribute("aria-pressed") === initial,
    { initial: initialCommunitySaved });
    showCommunityActionFixture = false;
    await page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-actions [data-share]').click();
    assert.equal(await page.locator("[data-share-collection]").count(), 0,
      "Community share actions do not expose collection organization");
    await page.locator("#sheet [data-social-sheet-close]").click();
    const communityBounds = await page.locator(".community-screen").evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width, viewport: window.innerWidth };
    });
    assert.ok(communityBounds.left <= 1 && communityBounds.width >= communityBounds.viewport - 1,
      "Community feed extends to the full iPhone viewport width");
    const homeFeedReload = page.waitForResponse(response =>
      response.url().includes("/api/feed") && response.request().method() === "GET"
    );
    await page.reload({ waitUntil: "networkidle" });
    await homeFeedReload;
    await assertHomeCreateAvailable(page);
    await page.locator('.nav [data-tab="updates"]').click();
    const repostButton = page.locator('.clip[data-id="browser-repost-post"] .act[data-repost]');
    const homeActions = page.locator('.clip[data-id="browser-repost-post"] .post-viewer-media-controls .media-action-row');
    assert.equal(await repostButton.count(), 0,
      "The full-screen Home rail has no direct Repost button");
    assert.equal(await homeActions.locator(".act[data-save]").count(), 1,
      "the Home feed keeps its bookmark action beside the other social actions");
    const homeShareAction = homeActions.locator("[data-share]");
    const renderedSharePath = await homeShareAction.locator(".navic path").getAttribute("d");
    assert.equal(renderedSharePath, homeSharePath,
      "Home keeps the same curved forward-arrow share icon in the action row after reload");
    const homeIconStyle = await homeActions.evaluate(element =>
      [...element.querySelectorAll(".act .navic")].map(svg => [svg.getAttribute("fill"), svg.getAttribute("stroke-width"), svg.getAttribute("stroke-linecap")])
    );
    assert.equal(homeIconStyle.length, 4);
    assert.ok(homeIconStyle.every(([fill, width, cap]) => fill === "none" && width === "1.75" && cap === "round"),
      "Home feed social icons use the same thin rounded outline style as Community");
    const homeIconPresentation = await homeActions.evaluate(element => {
      const save = element.querySelector("[data-save]");
      return {
        iconSize: Number(element.querySelector("[data-like] .navic").getBoundingClientRect().width),
        saveColor: getComputedStyle(save).color,
        countColors: [...element.querySelectorAll(".act-count")].map(node => getComputedStyle(node).color),
      };
    });
    assert.equal(homeIconPresentation.iconSize, 28,
      "the Home heart matches the other 28px media action icons");
    assert.equal(homeIconPresentation.saveColor, "rgb(255, 255, 255)");
    assert.ok(homeIconPresentation.countColors.every(color => color === "rgb(255, 255, 255)"));
    assert.equal(await homeShareAction.getAttribute("aria-label"), "Share post",
      "the row Share action remains accessible without a visible label");
    const homeSave = homeActions.locator(".act[data-save]");
    const initialSavedState = await homeSave.getAttribute("aria-pressed");
    const homeSaveColors = await homeSave.evaluate(button => ({
      button: getComputedStyle(button).color,
      count: getComputedStyle(button.querySelector(".act-count")).color,
    }));
    const initialScroll = await page.evaluate(() => ({
      page: window.scrollY,
      feed: document.querySelector("#feed")?.scrollTop || 0,
    }));
    await homeSave.click();
    await page.waitForFunction(({ initial }) =>
      document.querySelector('.clip[data-id="browser-repost-post"] [data-save]')?.getAttribute("aria-pressed") === String(initial !== "true"),
    { initial: initialSavedState });
    assert.equal(await page.locator("#sheet [data-social-sheet-close]").count(), 0,
      "one-tap Save does not open the collection sheet");
    assert.deepEqual(await page.evaluate(() => ({
      page: window.scrollY,
      feed: document.querySelector("#feed")?.scrollTop || 0,
    })), initialScroll, "one-tap Save keeps the user at the same feed position");
    const savedHomeColors = await homeSave.evaluate(button => ({
      button: getComputedStyle(button).color,
      icon: getComputedStyle(button.querySelector(".navic")).color,
      count: getComputedStyle(button.querySelector(".act-count")).color,
    }));
    assert.equal(savedHomeColors.button, homeSaveColors.button);
    assert.equal(savedHomeColors.icon, "rgb(255, 255, 255)", "the Home bookmark stays white on dark media");
    assert.equal(savedHomeColors.count, homeSaveColors.count, "saving does not recolor the Home count");
    await homeSave.click();
    await page.waitForFunction(({ initial }) =>
      document.querySelector('.clip[data-id="browser-repost-post"] [data-save]')?.getAttribute("aria-pressed") === initial,
    { initial: initialSavedState });
    const fullScreenBounds = await page.locator("#feed .clip:not(.post-detail)").first().evaluate(element => {
      const clip = element.getBoundingClientRect();
      const feed = document.querySelector("#feed").getBoundingClientRect();
      return { clipWidth: clip.width, feedWidth: feed.width, clipHeight: clip.height, feedHeight: feed.height, viewport: window.innerWidth };
    });
    assert.ok(fullScreenBounds.clipWidth >= fullScreenBounds.viewport - 1, JSON.stringify(fullScreenBounds));
    assert.ok(Math.abs(fullScreenBounds.clipHeight - fullScreenBounds.feedHeight) < 2,
      "Home feed remains full-screen and the snap page fills its viewport");
    await homeShareAction.click();
    for (const action of ["data-share-messages", "data-share-copylink", "data-share-more"]) {
      await page.locator(`[${action}]`).waitFor({ state: "visible" });
    }
    await page.locator("[data-share-story]").waitFor({ state: "visible" });
    assert.match(await page.locator("#sheet").innerText(), /Copy link/);
    assert.equal(await page.locator("[data-share-repost]").count(), 0,
      "secondary repost actions stay out of the primary destination row");
    await page.locator("[data-share-messages]").click();
    await page.locator("[data-share-friends]").waitFor({ state: "visible" });
    await page.locator("[data-share-friends]").click();
    await page.locator("[data-share-search]").waitFor({ state: "visible", timeout: 5000 }).catch(async failure => {
      const state = await page.evaluate(() => ({
        search: !!document.querySelector("[data-share-search]"),
        error: document.querySelector("[data-sheet-error]")?.textContent?.trim() || "",
        sheetText: document.querySelector("#sheet")?.innerText || document.querySelector(".sheet")?.innerText || "",
      }));
      throw new Error(`Friends picker did not open: ${JSON.stringify(state)}; ${failure.message}`);
    });
    assert.equal((await page.locator("[data-sheet-error]").innerText()).trim(), "",
      "Opening the Friends picker does not show a missing Share-handler error");
    await page.locator("[data-share-friends]").click();
    await page.locator("[data-share-search]").waitFor({ state: "hidden" });
    await page.locator("[data-share-back]").click();
    await page.locator("[data-share-more]").click();
    await page.locator("[data-share-repost]").waitFor({ state: "visible" });
    const repostResponse = page.waitForResponse(response =>
      response.url().includes("/api/posts/browser-repost-post/repost") &&
      response.request().method() === "PUT"
    );
    await page.locator("[data-share-repost]").click();
    await repostResponse;
    assert.equal(await page.locator(".reposted-float").count(), 0,
      "Reposting does not add a black animated badge");
    const repostSummary = page.locator('.clip[data-id="browser-repost-post"] .rp-summary');
    await repostSummary.waitFor({ state: "visible", timeout: 3000 });
    const repostConfirmation = page.locator('.clip[data-id="browser-repost-post"] .rp-confirmation[role="status"]');
    await repostConfirmation.waitFor({ state: "visible", timeout: 3000 });
    assert.equal((await repostConfirmation.innerText()).trim(), "Reposted",
      "The main-feed repost confirmation appears only after the server confirms it");
    await repostConfirmation.waitFor({ state: "hidden", timeout: 3000 });
    assert.notEqual((await repostSummary.locator(".rp-count").innerText()).trim(), "Reposted",
      "The temporary confirmation clears back to the persistent repost attribution");
    assert.equal(await page.locator('.clip[data-id="browser-repost-post"] .act[data-repost]').count(), 0);
    await page.locator('.clip[data-id="browser-repost-post"] .media-action-row [data-share]').click();
    await page.locator("[data-share-more]").click();
    await page.locator('[data-share-repost][aria-pressed="true"]').waitFor({ state: "visible" });
    const removeRepostResponse = page.waitForResponse(response =>
      response.url().includes("/api/posts/browser-repost-post/repost") &&
      response.request().method() === "DELETE"
    );
    await page.locator("[data-share-repost]").click();
    await removeRepostResponse;
    assert.equal(await page.locator(".reposted-float").count(), 0);
    communityPost.text = "A cloud-backed video for the Story sharing test";
    communityPost.media = [{
      id: "browser-repost-video",
      contentType: "video/webm",
      reference: testVideoMedia,
      thumbnailReference: testImageMedia,
    }];
    creationMediaReserved = false;
    publishedStory = null;
    const videoFeedResponse = page.waitForResponse(response =>
      response.url().includes("/api/feed") && response.request().method() === "GET"
    );
    await page.reload({ waitUntil: "networkidle" });
    await videoFeedResponse;
    const videoShareAction = page.locator('.clip[data-id="browser-repost-post"] .media-action-row [data-share]');
    await videoShareAction.waitFor({ state: "visible" });
    const storyCreatesBeforeVideoShare = storyApiCalls.filter(call => call === "POST /api/stories").length;
    await videoShareAction.click();
    await page.locator("[data-share-story]").click();
    await page.locator('[data-testid="canvas-status"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="button-add-text"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="button-stickers"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="button-add-text"]').click();
    await page.locator('[data-color-scope="background"]').click();
    const canvasColorPicker = page.locator(".sc-color-popover");
    await canvasColorPicker.waitFor({ state: "visible" });
    assert.equal(await canvasColorPicker.locator("[data-bg-color]").count(), 4,
      "canvas/text background picker shows four quick colors instead of a scrolling color rail");
    await canvasColorPicker.locator('[data-bg-color="#ffffff"]').click();
    assert.equal(await page.locator(".sc-textarea").evaluate(input => input.style.background), "rgb(255, 255, 255)",
      "the selected canvas/text-box color is applied immediately");
    await page.locator('[data-color-scope="text"]').click();
    assert.equal(await canvasColorPicker.locator("[data-text-color]").count(), 4,
      "text color uses the same compact four-color picker");
    await page.locator("[data-custom-color]").evaluate(input => {
      input.value = "#d14984";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.locator(".sc-textarea").evaluate(input => input.style.color), "rgb(209, 73, 132)",
      "custom color selection updates the text");
    await page.locator('[data-testid="button-text-done"]').click();
    const sendStatus = page.locator('[data-testid="button-send-status"]');
    await sendStatus.waitFor({ state: "visible" });
    const videoStoryResponse = page.waitForResponse(response =>
      response.url().endsWith("/api/stories") && response.request().method() === "POST"
    );
    await sendStatus.click();
    const videoStoryResult = await videoStoryResponse;
    assert.equal(videoStoryResult.status(), 201, "Status publishes through the story endpoint");
    await sendStatus.waitFor({ state: "hidden" });
    const videoShareError = await page.locator('[data-testid="text-send-error"]').textContent().catch(() => "");
    assert.ok(!videoShareError?.trim(), `Sharing the feed video to Story failed: ${videoShareError}; API calls: ${storyApiCalls.join(", ")}`);
    assert.equal(await page.locator('[data-testid="button-send-status"]').count(), 0,
      "The Status composer closes after the confirmed publish");
    assert.ok(publishedStory?.hasMedia && (publishedStory.mediaType === "video" || publishedStory.mediaType?.startsWith("video/")) && creationMediaReserved,
      `the shared Story must publish rendered video media; story=${JSON.stringify(publishedStory)} reserved=${creationMediaReserved} calls=${storyApiCalls.join(",")}`);
    assert.equal(storyApiCalls.filter(call => call === "POST /api/stories").length, storyCreatesBeforeVideoShare + 1,
      "sharing a feed video publishes exactly one Story");

    const signupContext = await browser.newContext({ viewport: { width: 402, height: 874 } });
    await signupContext.route("**/api/**", isolateApi);
    let submittedSignup = null;
    await signupContext.route("**/api/auth/register", async route => {
      submittedSignup = route.request().postDataJSON();
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          verificationRequired: true,
          message: "Check your email to finish claiming the official account.",
        }),
      });
    });
    const signupPage = await signupContext.newPage();
    await signupPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await signupPage.locator("#signup").click();
    await signupPage.locator("#signup-form").waitFor({ state: "visible" });
    assert.deepEqual(await signupPage.locator("#signup-form input").evaluateAll(inputs => inputs.map(input => input.id).filter(Boolean)),
      ["su-first", "su-last", "su-email", "su-user", "su-birthday", "su-follow-oldtime", "su-pass"],
      "registration keeps the optional follow choice and interests before password");
    assert.equal(await signupPage.locator("#su-user").getAttribute("pattern"), "[A-Za-z0-9_]{3,24}");
    assert.equal(await signupPage.locator("#su-user").getAttribute("autocomplete"), "off",
      "signup should not autofill a saved username such as the reserved @oldtime handle");
    assert.equal(await signupPage.locator("#su-user").inputValue(), "");
    assert.equal(await signupPage.locator("#su-pass").getAttribute("minlength"), "8");
    assert.equal(await signupPage.locator("#back").textContent(), "Log in");
    assert.equal(await signupPage.locator("#back").evaluate(button => getComputedStyle(button).textAlign), "center");
    await signupPage.locator("#su-first").fill("Oldtime");
    await signupPage.locator("#su-last").fill("Official");
    await signupPage.locator("#signup-form .signup-step:not([hidden]) .signup-next").click();
    await signupPage.locator("#su-email").fill("starter@example.com");
    await signupPage.locator("#su-user").fill("Oldtime");
    await signupPage.locator("#signup-form .signup-step:not([hidden]) .signup-next").click();
    const birthdayLayout = await signupPage.evaluate(() => {
      const field = document.querySelector("#su-birthday").getBoundingClientRect();
      const next = document.querySelector("#signup-form .signup-step:not([hidden]) .signup-next").getBoundingClientRect();
      const login = document.querySelector("#back").getBoundingClientRect();
      const error = document.querySelector("#err").getBoundingClientRect();
      const status = document.querySelector("#signup-status").getBoundingClientRect();
      return {
        fieldRight: field.right,
        viewportWidth: window.innerWidth,
        nextBottom: next.bottom,
        loginTop: login.top,
        emptyErrorHeight: error.height,
        emptyStatusHeight: status.height,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(birthdayLayout.fieldRight <= birthdayLayout.viewportWidth + 0.5,
      `native date field stays inside the viewport: ${JSON.stringify(birthdayLayout)}`);
    assert.ok(birthdayLayout.loginTop - birthdayLayout.nextBottom <= 24,
      "the empty feedback region no longer leaves a large gap before Log in");
    assert.equal(birthdayLayout.emptyErrorHeight, 0);
    assert.equal(birthdayLayout.emptyStatusHeight, 0);
    assert.ok(birthdayLayout.pageWidth <= birthdayLayout.viewportWidth,
      "signup has no horizontal page overflow");
    await signupPage.setViewportSize({ width: 320, height: 700 });
    const narrowBirthday = await signupPage.locator("#su-birthday").evaluate(field => ({
      right: field.getBoundingClientRect().right,
      viewport: window.innerWidth,
      rootWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(narrowBirthday.right <= narrowBirthday.viewport + 0.5,
      `date field border stays visible on narrow screens: ${JSON.stringify(narrowBirthday)}`);
    assert.ok(narrowBirthday.rootWidth <= narrowBirthday.viewport,
      "the narrow signup layout does not scroll horizontally");
    await signupPage.setViewportSize({ width: 402, height: 874 });
    await signupPage.locator("#su-birthday").fill("2000-01-01");
    await signupPage.locator("#signup-form .signup-step:not([hidden]) .signup-next").click();
    await signupPage.locator(".signup-interests-step:not([hidden])").waitFor({ state: "visible" });
    assert.match(await signupPage.locator(".signup-follow-oldtime").innerText(), /Optional/,
      "the @oldtime follow is clearly optional");
    await signupPage.locator(".signup-interest-dropdown > summary").click();
    const signupInterestChoices = signupPage.locator("[data-signup-interest]");
    const selectedSignupInterests = await signupInterestChoices.evaluateAll(buttons =>
      buttons.slice(0, 3).map(button => button.dataset.signupInterest)
    );
    for (let index = 0; index < selectedSignupInterests.length; index++) {
      await signupInterestChoices.nth(index).click();
    }
    assert.equal((await signupPage.locator("#su-interest-count").innerText()).trim(), "3 selected");
    await signupPage.locator(".signup-step:not([hidden]) .signup-next").click();
    await signupPage.locator("#su-pass").waitFor({ state: "visible" });
    await signupPage.locator("#su-pass").fill("ValidPass123!");
    assert.equal(await signupPage.locator("#go").isDisabled(), false);
    await signupPage.locator("#go").click();
    await signupPage.waitForFunction(() =>
      /verification link/i.test(document.querySelector("#signup-status")?.textContent || "")
    );
    assert.match(await signupPage.locator("#signup-status").textContent(), /verification link.*@oldtime/i);
    assert.equal(submittedSignup?.username, "oldtime",
      "the browser should let the verified official claim reach the Cloudflare API");
    assert.equal(submittedSignup?.birthday, "2000-01-01");
    assert.deepEqual(submittedSignup?.interests, selectedSignupInterests);
    assert.equal(submittedSignup?.followOldtime, false);
    assert.equal(await signupPage.locator("#go").isDisabled(), true);
    assert.equal(await signupPage.locator("#go").textContent(), "Email sent");
    const feedbackColors = await signupPage.evaluate(() => ({
      status: getComputedStyle(document.querySelector("#signup-status")).color,
      sentLabel: getComputedStyle(document.querySelector("#go")).color,
      loginLabel: getComputedStyle(document.querySelector("#back")).color,
    }));
    for (const [label, color] of Object.entries(feedbackColors)) {
      assert.notEqual(color, "rgb(255, 255, 255)", `${label} must remain readable on the white signup screen`);
    }
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await signupPage.screenshot({ path: "/tmp/oldtime-technologies-signup.png" });
    }
    await signupContext.close();

    assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join("; ")}`);
    await context.close();
  } finally {
    await browser?.close();
    await server.close();
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalBasePath === undefined) delete process.env.BASE_PATH;
    else process.env.BASE_PATH = originalBasePath;
  }
});

