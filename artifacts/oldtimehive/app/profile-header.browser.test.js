import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";

// Isolated owner/visitor profile layout fixture. Fake local data only; every /api request is blocked.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = resolve(tmpdir(), "oldtime-profile-header");
const chromiumPath = [process.env.CHROMIUM_PATH, "/repl/tools/bin/chromium", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
const profileHeaderCss = readFileSync(new URL("./profile-header-refinement.css", import.meta.url), "utf8");
const profileHeaderViewports = [
  { width: 320, height: 844 }, { width: 390, height: 844 }, { width: 512, height: 439 },
  { width: 768, height: 844 }, { width: 1280, height: 844 },
];
const requestedProfileWidth = process.env.OLDTIME_PROFILE_HEADER_WIDTH
  ? Number(process.env.OLDTIME_PROFILE_HEADER_WIDTH)
  : null;
const selectedProfileViewports = requestedProfileWidth == null
  ? profileHeaderViewports
  : profileHeaderViewports.filter(viewport => viewport.width === requestedProfileWidth);

test("profile refinement leaves built-in avatar artwork visible", () => {
  assert.doesNotMatch(profileHeaderCss, /img\[src\*="\/brand\/avatars\/"\][^{]*\{[^}]*visibility\s*:\s*hidden/i);
  assert.doesNotMatch(profileHeaderCss, /linearGradient[^}]*visibility\s*:\s*hidden/i);
});

const person = (id, extra = {}) => ({
  id, username: id.replace(/-/g, ""), name: id.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" "),
  avatar: "/app/avatar.svg", private: false, followers: [], following: [], friends: [], closeFriends: [],
  interests: [], profileVisibility: { city: true, interests: true }, ...extra,
});
const fixture = {
  session: "fixture-owner",
  settings: { readReceipts: true, lastSeen: "everyone" },
  users: [
    person("fixture-owner", { name: "Fixture Owner With A Longer Display Name", city: "Philadelphia, US",
      interests: ["basketball", "music", "photography"], followers: ["fan-one", "fan-two", "fan-three", "fan-four"],
      following: ["fan-one", "fan-two", "fan-three"], bio: "Fixture bio for layout checks.", cover: "/app/test-profile-cover.svg",
       stats: { followerCount: 1284, followingCount: 317, viewCount: 9, likeCount: 600, saveCount: 42, postCount: 6 } }),
       person("visitor-target", { city: "Lisbon", interests: ["travel"], followers: [], following: [], cover: null,
        stats: { followerCount: 0 }, statsFetchedAt: Date.now() }),
    person("fan-one"), person("fan-two"), person("fan-three"), person("fan-four"),
  ],
  posts: Array.from({ length: 6 }, (_, index) => ({
    id: `fixture-owner-post-${index}`, author: "fixture-owner", kind: "image",
    media: ["/app/avatar.svg"], caption: `Profile grid item ${index + 1}`,
    destination: "main", visibility: "public", likes: [], comments: [], reposts: [], saves: [], views: index + 1,
    created: 1_700_000_000_000 + index,
  })),
  stories: [], chats: [], requests: [], friendRequests: [], notifications: [],
};

test("profile header owner and visitor layouts at phone, tablet, and desktop widths", { skip: !chromiumPath && "Chromium unavailable", timeout: 240_000 }, async () => {
  process.env.PORT ||= "5173"; process.env.BASE_PATH ||= "/";
  const server = await createServer({ configFile: resolve(packageRoot, "vite.config.ts"), logLevel: "silent", server: { host: "127.0.0.1", port: 0, strictPort: false } });
  let browser;
  try {
    await server.listen();
    const { port } = server.httpServer.address();
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    mkdirSync(shotDir, { recursive: true });
    const writes = [];
    for (const { width, height } of selectedProfileViewports) {
      const context = await browser.newContext({ serviceWorkers: "block", viewport: { width, height } });
      await context.route("**/api/**", route => {
        if (route.request().method() !== "GET") writes.push(route.request().url());
         const stats = { fixtureowner: ["fixture-owner", 1284, 317, 600, 42], visitortarget: ["visitor-target", 7, 5, 28, 10] };
        const profilePath = new URL(route.request().url()).pathname;
        const hit = Object.entries(stats).find(([name]) => profilePath.endsWith(`/api/profiles/${name}`));
        if (hit && route.request().method() === "GET") {
           const [, [id, followerCount, followingCount, likeCount, saveCount]] = hit;
          const user = fixture.users.find(person => person.id === id);
          const followerPreviews = id === "fixture-owner"
            ? ["fan-one", "fan-two", "fan-three"].map(memberId => fixture.users.find(person => person.id === memberId))
            : [];
          const followingPreviews = id === "fixture-owner"
            ? ["fan-one", "fan-two", "fan-three"].map(memberId => fixture.users.find(person => person.id === memberId))
            : id === "visitor-target" ? [fixture.users.find(person => person.id === "fixture-owner")] : [];
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
            profile: {
              id, username: hit[0], displayName: user.name, avatar: user.avatar,
              cover: user.cover || null, bio: user.bio || "", profileNote: user.profileNote || "",
              city: user.city || "", interests: user.interests || [],
              profileVisibility: user.profileVisibility,
              }, stats: { followerCount, followingCount, viewCount: 9, likeCount, saveCount, followerPreviews, followingPreviews },
             postCount: id === "fixture-owner" ? 6 : 3,
            posts: fixture.posts.filter(post => post.author === id),
          }) });
        }
        return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"blocked in fixture"}' });
      });
      await context.addInitScript(state => {
        const initial = structuredClone(state);
        const visitor = initial.users.find(person => person.id === "visitor-target");
        visitor.stats = { followerCount: 0 };
        visitor.statsFetchedAt = Date.now();
        if (!localStorage.getItem("oldtime-v1")) localStorage.setItem("oldtime-v1", JSON.stringify(initial));
        sessionStorage.clear();
        sessionStorage.setItem("oldtime-cloud-session-v1", JSON.stringify({ account: { id: initial.session }, accessToken: "a".repeat(43), expiresAt: Date.now() + 600_000 }));
      }, fixture);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(() => typeof window.__oldtimeOpenProfilePreview === "function", null, { timeout: 60_000 });
      for (const [label, id] of [["owner", "fixture-owner"], ["visitor", "visitor-target"]]) {
        await page.evaluate(target => window.__oldtimeOpenProfilePreview(target), id);
        await page.locator(".profile-screen .profile-stats").waitFor({ state: "visible" });
        try {
          await page.waitForFunction(expected => {
            const stats = document.querySelector(".profile-stats")?.innerText || "";
            const posts = document.querySelector("[data-testid='profile-post-count']")?.innerText || "";
            return expected === "owner" ? /1\.2k/i.test(stats) && /317/.test(stats) && /642\s+Likes\s*&\s*Saves/i.test(stats)
              : /7/.test(stats) && /5/.test(stats) && /38\s+Likes\s*&\s*Saves/i.test(stats);
          }, label, { timeout: 15_000 });
        } catch (error) {
          const stats = await page.locator(".profile-stats").innerText().catch(() => "");
          const posts = await page.locator("[data-testid='profile-post-count']").innerText().catch(() => "");
          throw new Error(`${label} profile stats did not load as expected; stats=${JSON.stringify(stats)} postCount=${JSON.stringify(posts)}; ${error.message}`);
        }
        await page.waitForTimeout(1200); // let entrance motion and stats refresh settle
        const m = await page.evaluate(() => {
          const r = s => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
          return {
            vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight, docW: document.documentElement.scrollWidth,
            cards: [...document.querySelectorAll(".profile-count-card[data-profile-list]")].map(c => { const b = c.getBoundingClientRect(); return { kind: c.dataset.profileList, l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, faces: c.querySelectorAll(".profile-count-faces img").length, text: c.innerText }; }),
            stats: document.querySelector(".profile-stats").innerText,
            postCount: (document.querySelector("[data-testid='profile-post-count']")?.innerText || "").replace(/\s+/g, " ").trim(),
            intro: r(".profile-intro"), header: r(".profile-screen.on .profile-simple-hero"), overview: r(".profile-overview-row"), details: r(".profile-details-copy"), statsRow: r(".profile-stats"),
            bio: r(".profile-intro > .cap"),
            bioColor: document.querySelector(".profile-intro > .cap") ? getComputedStyle(document.querySelector(".profile-intro > .cap")).color : null,
            meta: r(".profile-meta-row"), actions: r(".profile-primary-actions"), name: r(".profile-name"),
            nameRow: r(".profile-name-row"), handleRow: r(".profile-handle"), avatar: r(".profile-avatar-wrap"), topbar: r(".profile-topbar"),
            back: r(".profile-topbar > #back"),
            handle: document.querySelector(".profile-handle")?.innerText,
            bioText: document.querySelector(".profile-reference-header .profile-intro > .cap")?.innerText || "",
            note: r(".profile-note-inline"),
            more: r("#profile-actions-open"),
            moreIcon: r("#profile-actions-open .profile-more-icon"),
            notificationBell: r("#profile-notifications-open"),
            moreBackground: document.querySelector("#profile-actions-open") ? getComputedStyle(document.querySelector("#profile-actions-open")).backgroundColor : null,
            moreBorderWidth: document.querySelector("#profile-actions-open") ? getComputedStyle(document.querySelector("#profile-actions-open")).borderTopWidth : null,
            bellColor: document.querySelector("#profile-notifications-open") ? getComputedStyle(document.querySelector("#profile-notifications-open")).color : null,
            coverImageOpacity: document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover-landscape")
              ? getComputedStyle(document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover-landscape")).opacity : null,
             coverImageFilter: document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover-landscape")
               ? getComputedStyle(document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover-landscape")).filter : null,
             coverBackgroundFilter: document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover-background")
               ? getComputedStyle(document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover-background")).filter : null,
             coverImageMask: document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover-landscape")
               ? getComputedStyle(document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover-landscape")).maskImage : null,
             shareIcon: r("#sharep svg, #sharep .navic"),
              shareText: document.querySelector("#sharep")?.innerText.trim(),
             shareBound: typeof document.querySelector("#sharep")?.onclick === "function",
             shareBackground: getComputedStyle(document.querySelector("#sharep"), "::before").backgroundColor,
             editBackground: document.querySelector("#edit") ? getComputedStyle(document.querySelector("#edit"), "::before").backgroundColor : "",
             settingsBackground: document.querySelector("#profile-settings-open") ? getComputedStyle(document.querySelector("#profile-settings-open"), "::before").backgroundColor : "",
             messageBackground: document.querySelector("#pmsg") ? getComputedStyle(document.querySelector("#pmsg"), "::before").backgroundColor : "",
             shareFont: document.querySelector("#sharep span") ? getComputedStyle(document.querySelector("#sharep span")).fontSize : "",
             messageFont: document.querySelector("#pmsg span") ? getComputedStyle(document.querySelector("#pmsg span")).fontSize : "",
             shareWeight: document.querySelector("#sharep span") ? getComputedStyle(document.querySelector("#sharep span")).fontWeight : "",
             messageWeight: document.querySelector("#pmsg span") ? getComputedStyle(document.querySelector("#pmsg span")).fontWeight : "",
             editText: document.querySelector("#edit span")?.innerText.trim() || "",
             settingsIcon: r("#profile-settings-open svg, #profile-settings-open .navic"),
             settingsText: document.querySelector("#profile-settings-open span")?.innerText.trim() || "",
             editFont: document.querySelector("#edit span") ? getComputedStyle(document.querySelector("#edit span")).fontSize : "",
             settingsFont: document.querySelector("#profile-settings-open span") ? getComputedStyle(document.querySelector("#profile-settings-open span")).fontSize : "",
             editWeight: document.querySelector("#edit span") ? getComputedStyle(document.querySelector("#edit span")).fontWeight : "",
             settingsWeight: document.querySelector("#profile-settings-open span") ? getComputedStyle(document.querySelector("#profile-settings-open span")).fontWeight : "",
             backBackground: document.querySelector(".profile-topbar > #back") ? getComputedStyle(document.querySelector(".profile-topbar > #back")).backgroundColor : "",
            backFont: document.querySelector(".profile-topbar > #back") ? getComputedStyle(document.querySelector(".profile-topbar > #back")).fontSize : "",
             moreDisplay: document.querySelector("#profile-actions-open") ? getComputedStyle(document.querySelector("#profile-actions-open")).display : null,
            topShareAction: !!document.querySelector(".profile-topbar #sharep"),
            menuShareAction: !!document.querySelector("[data-profile-share]"),
            nameColor: getComputedStyle(document.querySelector(".profile-name")).color,
              hasUploadedCover: !document.querySelector(".profile-screen.on .profile-simple-hero")?.classList.contains("profile-no-cover"),
              coverDisplay: document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover") ? getComputedStyle(document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover")).display : "missing",
               profileBackground: getComputedStyle(document.querySelector(".profile-screen.on .profile-simple-hero")).backgroundImage,
               coverOverlay: document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover") ? getComputedStyle(document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover"), "::after").backgroundImage : "",
            avatarLoaded: [...document.querySelectorAll(".profile-avatar")].every(img => img.complete && img.naturalWidth > 0),
              edit: r("#edit"), follow: r("#pfollow"), msg: r("#pmsg"), cover: r(".profile-screen.on .profile-simple-hero .profile-cover"),
             editBound: typeof document.querySelector("#edit")?.onclick === "function",
             settingsBound: typeof document.querySelector("#profile-settings-open")?.onclick === "function",
             actionButtons: [...document.querySelectorAll(".profile-primary-actions > button")].map(button => { const b = button.getBoundingClientRect(); return { id: button.id, w: b.width, h: b.height }; }),
            coverImageLoaded: (() => {
               const image = document.querySelector(".profile-screen.on .profile-simple-hero .profile-cover-landscape");
              return !!image && image.complete && image.naturalWidth > 0;
            })(),
             followBackground: document.querySelector("#pfollow") ? getComputedStyle(document.querySelector("#pfollow"), "::before").backgroundColor : "",
            settingsAction: !!document.querySelector("#profile-actions-open"),
            settingsGear: r("#profile-settings-open"),
            menuLabel: document.querySelector("#profile-actions-open")?.getAttribute("title"),
            shareAction: !!document.querySelector("#sharep, [data-profile-share]"),
            shareButton: r("#sharep"),
            tabCount: document.querySelectorAll(".profile-section-tab").length,
            tabLayout: (() => {
              const row = document.querySelector(".profile-section-tabs");
              const active = document.querySelector(".profile-section-tab.on");
              return row && active ? {
                display: getComputedStyle(row).display,
                gridColumns: getComputedStyle(row).gridTemplateColumns,
                activeUnderline: getComputedStyle(active).borderBottomColor,
              } : null;
            })(),
            overflow: [...document.querySelectorAll(".profile-intro *")].filter(el => { const b = el.getBoundingClientRect(); return b.width && (b.right > innerWidth + 1 || b.left < -1); }).map(el => el.className || el.tagName).slice(0, 5),
          };
        });
        await page.screenshot({ path: resolve(shotDir, `${label}-${width}.png`) });
        assert.equal(m.cards.length, 2, `${label}@${width}: relationship totals`);
        assert.match(m.stats, /following[\s\S]*followers[\s\S]*likes\s*&\s*saves/i);
        assert.equal(m.postCount || "", "", `${label}@${width}: the header uses only available profile metrics`);
        assert.ok(m.cards[1].r <= m.vw + 0.5 && m.docW <= m.vw, `${label}@${width}: no horizontal overflow`);
        assert.ok(m.avatar.l < m.vw / 3, `${label}@${width}: both profile types use the same left-aligned avatar layout`);
        if (width < 700) {
          assert.ok(Math.abs(m.avatar.w / m.vw - 0.18) < 0.015, `${label}@${width}: avatar matches the reference proportions`);
          assert.ok(m.details.l - m.avatar.r >= 8 && m.details.l - m.avatar.r <= 16, `${label}@${width}: identity spacing matches the avatar`);
        }
        assert.ok(m.statsRow.t >= m.overview.b, `${label}@${width}: totals follow the identity row`);
        assert.ok(!m.bio || m.bio.t >= m.statsRow.b, `${label}@${width}: biography follows the totals`);
        if (m.bioColor) assert.match(m.bioColor, /rgba?\(255,\s*255,\s*255/, `${label}@${width}: biography stays legible over the cover`);
         assert.deepEqual(m.actionButtons.map(button => button.id),
           label === "owner" ? ["edit", "profile-settings-open", "sharep"] : ["pfollow", "pmsg", "sharep"],
           `${label}@${width}: owner and viewer get their intended three header actions`);
         assert.ok(Math.max(...m.actionButtons.map(button => button.w)) - Math.min(...m.actionButtons.map(button => button.w)) <= 2,
           `${label}@${width}: all three buttons use the same rectangular size; got ${JSON.stringify(m.actionButtons)}`);
         assert.ok(Math.min(...m.actionButtons.map(button => button.h)) >= 44,
           `${label}@${width}: every action remains an accessible tap target`);
         assert.ok(m.shareIcon.w >= 18 && m.shareIcon.w <= 24, `${label}@${width}: share glyph remains clear and proportional`);
         assert.equal(m.shareText, "Share", `${label}@${width}: share has a clear visible label`);
         assert.equal(m.shareBound, true, `${label}@${width}: share has a profile-share action`);
         if (label === "owner") {
           assert.equal(m.editText, "Edit profile", `${label}@${width}: owner sees the Edit profile label`);
           assert.equal(m.settingsText, "Settings", `${label}@${width}: owner sees the Settings label`);
           assert.ok(Math.abs(m.settingsIcon.w - 20) < 1, `${label}@${width}: Settings uses the gear icon`);
           assert.equal(m.shareBackground, m.editBackground, `${label}@${width}: owner buttons share one visual style`);
           assert.equal(m.shareBackground, m.settingsBackground, `${label}@${width}: owner buttons share one visual style`);
           assert.equal(m.shareFont, m.editFont, `${label}@${width}: owner labels use the same text size`);
           assert.equal(m.shareFont, m.settingsFont, `${label}@${width}: owner labels use the same text size`);
           assert.equal(m.shareWeight, m.editWeight, `${label}@${width}: owner labels use the same text weight`);
           assert.equal(m.shareWeight, m.settingsWeight, `${label}@${width}: owner labels use the same text weight`);
         } else {
           assert.equal(m.shareBackground, m.messageBackground, `${label}@${width}: share and message use the same fill`);
           assert.equal(m.shareFont, m.messageFont, `${label}@${width}: share and message use the same text size`);
           assert.equal(m.shareWeight, m.messageWeight, `${label}@${width}: share and message use the same text weight`);
            const followStates = await page.evaluate(() => {
              const follow = document.querySelector("#pfollow");
              const message = document.querySelector("#pmsg");
              const capture = button => {
                const rect = button.getBoundingClientRect();
                const label = button.querySelector("span");
                const surface = getComputedStyle(button, "::before");
                const labelStyle = getComputedStyle(label);
                const buttonStyle = getComputedStyle(button);
                return {
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                  buttonColor: buttonStyle.backgroundColor,
                  buttonBorderWidth: buttonStyle.borderTopWidth,
                  labelColor: labelStyle.color,
                  labelSize: labelStyle.fontSize,
                  labelWeight: labelStyle.fontWeight,
                  surfaceColor: surface.backgroundColor,
                  surfaceBorder: surface.borderColor,
                  surfaceRadius: surface.borderRadius,
                };
              };
              const originalState = follow.getAttribute("aria-pressed");
              const messageStyle = capture(message);
              const states = {};
              for (const state of ["false", "true"]) {
                follow.setAttribute("aria-pressed", state);
                states[state] = capture(follow);
              }
              if (originalState === null) follow.removeAttribute("aria-pressed");
              else follow.setAttribute("aria-pressed", originalState);
              return { states, messageStyle };
            });
            assert.deepEqual(followStates.states.false, followStates.messageStyle,
              `${label}@${width}: Follow matches Message in size, fill, border, and text`);
            assert.deepEqual(followStates.states.true, followStates.messageStyle,
              `${label}@${width}: Following matches Message in size, fill, border, and text`);
         }
         assert.match(m.backBackground, /rgba?\(10,\s*15,\s*25/i, `${label}@${width}: back control stays visible over bright photos`);
          assert.ok(m.back && Math.abs(m.back.w - 36) < 1 && Math.abs(m.back.h - 36) < 1,
            `${label}@${width}: profile-page back control is compact`);
          assert.equal(m.backFont, "20px", `${label}@${width}: profile-page back arrow is smaller`);
        assert.ok(m.cards.every(card => Math.abs(card.t - m.cards[0].t) < 1), `${label}@${width}: relationship totals stay on one line`);
        assert.ok(m.nameRow.t >= m.overview.t && m.nameRow.b <= m.overview.b, `${label}@${width}: name and handle sit beside the avatar`);
        assert.equal(m.handle, label === "owner" ? "@fixtureowner" : "@visitortarget", `${label}@${width}: account handle remains visible`);
        assert.ok(m.name && m.name.w > 0, `${label}@${width}: display name remains visible`);
         assert.ok(m.avatar.t >= m.topbar.b - 1, `${label}@${width}: avatar starts below the top controls`);
         assert.equal(m.topShareAction, false, `${label}@${width}: share stays out of the topbar`);
        assert.equal(m.nameColor, "rgb(255, 255, 255)",
          `${label}@${width}: profile text remains legible over its cover state`);
        assert.deepEqual(m.overflow, [], `${label}@${width}: no header element escapes the viewport`);
        assert.ok(m.cards.every(c => c.h >= 30), `${label}@${width}: relationship totals remain tappable`);
        assert.equal(m.avatarLoaded, true, `${label}@${width}: primary avatar loads and is visible`);
        if (label === "owner") {
          assert.equal(m.hasUploadedCover, true, `${label}@${width}: saved profile cover remains present`);
          assert.equal(m.coverDisplay, "block", `${label}@${width}: uploaded cover fills the profile header`);
          assert.ok(m.cover.h > 0, `${label}@${width}: cover background has visible height`);
           if (width >= 500) {
             assert.ok(m.cover.h >= m.vh * 0.95 && m.cover.h <= m.vh * 1.3,
               `${label}@${width}: larger cover matches the landscape reference scale`);
             assert.ok(m.actions.t / m.vh >= (width === 512 ? 0.75 : 0.5) && m.actions.t / m.vh <= 0.98,
               `${label}@${width}: full-size actions sit below the profile details`);
             assert.match(m.coverOverlay, /linear-gradient/i,
               `${label}@${width}: the photo blends beneath the readability layer`);
           } else {
             assert.ok(m.cover.h >= m.vh * 0.34 && m.cover.h <= m.vh * 0.55,
               `${label}@${width}: phone cover stays compact above the profile tabs`);
             assert.ok(m.actions.t / m.vh >= 0.25 && m.actions.t / m.vh <= 0.46,
               `${label}@${width}: phone action row follows the profile details`);
           }
          assert.equal(m.coverImageLoaded, true, `${label}@${width}: uploaded cover image loads`);
           assert.equal(Number(m.coverImageOpacity), 1, `${label}@${width}: the cover photo remains clear instead of faint`);
           const coverBlur = Number(m.coverBackgroundFilter?.match(/blur\(([\d.]+)px\)/)?.[1]);
           assert.ok(Number.isFinite(coverBlur) && coverBlur <= 2,
             `${label}@${width}: the cover background stays sharp, got ${m.coverBackgroundFilter}`);
           assert.match(m.coverImageMask, /linear-gradient/i,
             `${label}@${width}: the cover still fades into the profile header`);
          assert.match(m.bioText, /Fixture bio/);
           assert.equal(m.note, null, `${label}@${width}: no Add a note bubble is shown on the cover`);
        } else {
          assert.equal(m.hasUploadedCover, false, `${label}@${width}: no cover is fabricated`);
          assert.equal(m.coverDisplay, "none", `${label}@${width}: no-cover state keeps the cover hidden`);
          assert.equal(m.cover.h, 0, `${label}@${width}: no-cover header has no cover frame`);
           if (width >= 500) {
             assert.ok(m.header.h / m.vh >= 0.95 && m.header.h / m.vh <= 1.3,
               `${label}@${width}: fallback uses the larger landscape reference scale`);
           } else {
             assert.ok(m.header.h / m.vh >= 0.34 && m.header.h / m.vh <= 0.44,
               `${label}@${width}: phone fallback ends just above the profile tabs`);
           }
          assert.match(m.profileBackground, /linear-gradient/i, `${label}@${width}: missing cover uses the reference slate gradient`);
        }
         if (label === "visitor") {
            assert.equal(m.followBackground, m.messageBackground,
              `${label}@${width}: Follow shares the Message surface`);
         }
        assert.doesNotMatch(m.stats, /views|posts/i, `${label}@${width}: no unsupported profile metrics`);
        assert.match(m.stats, label === "owner" ? /642\s+Likes\s*&\s*Saves/i : /38\s+Likes\s*&\s*Saves/i);
        assert.equal(m.tabCount, 4, `${label}@${width}: existing profile sections remain available`);
        if (label === "owner") {
          assert.deepEqual(m.cards.map(c => c.faces), [0, 0], "owner relation preview faces are intentionally omitted");
            assert.ok(m.edit && m.settingsGear && m.shareButton, "owner sees Edit profile, Settings, and Share");
           assert.equal(m.follow, null, "owners do not see Follow in their own action row");
           assert.equal(m.msg, null, "owners do not see Message in their own action row");
           assert.equal(m.editBound, true, "Edit profile opens the existing profile editor");
           assert.equal(m.settingsBound, true, "Settings opens the existing settings screen");
           assert.ok(m.actions.t >= m.statsRow.b, "the common action row sits under the profile totals");
           assert.equal(await page.locator(".profile-owner-actions button").count(), 3);
           assert.equal(await page.locator(".profile-owner-actions #pfollow, .profile-owner-actions #pmsg").count(), 0,
             "owner actions do not include viewer-only controls");
           assert.equal(m.more, null, "the owner has no redundant top-right menu");
            assert.equal(m.notificationBell, null, "the owner has no viewer notification bell");
           assert.equal(m.settingsAction, false);
           assert.equal(m.menuShareAction, false);
        } else {
          assert.deepEqual(m.cards.map(c => c.faces), [0, 0], "visitor totals do not depend on relation previews");
          assert.match(m.cards.find(c => c.kind === "followers")?.text || "", /^7\s+Followers$/i, `${label}@${width}: visitor follower count replaces incomplete cached totals`);
          assert.match(m.cards.find(c => c.kind === "following")?.text || "", /^5\s+Following$/i, `${label}@${width}: visitor following count replaces incomplete cached totals`);
             assert.ok(m.follow && m.msg && m.shareButton, "visitor sees Follow, Message, and Share");
           assert.ok(m.actions.t >= m.statsRow.b, "viewer actions sit below profile totals");
            assert.ok(Math.abs(m.follow.w - m.msg.w) < 1.5 && Math.abs(m.msg.w - m.shareButton.w) < 1.5,
              "Follow, Message, and Share use matching rectangles");
          assert.match(await page.locator("#pfollow").innerText(), /^Follow$/i, "visitor sees Follow state");
           assert.ok(m.follow.h >= 44 && m.msg.h >= 44, `${label}@${width}: viewer actions remain easy to tap`);
           assert.equal(m.edit, null, "visitor does not see Edit profile");
           assert.ok(m.shareButton, "visitor can share from the action row");
           assert.equal(m.settingsGear, null, "visitor does not see owner Settings");
            assert.ok(m.more && m.more.w >= 38 && m.moreIcon?.w >= 16 && m.moreDisplay !== "none",
              `${label}@${width}: visitor has a visible, tappable more-options control`);
            assert.equal(m.moreBackground, "rgba(0, 0, 0, 0)",
              `${label}@${width}: more-options has no square or filled background`);
            assert.equal(m.moreBorderWidth, "0px", `${label}@${width}: more-options has no surrounding border`);
           assert.ok(m.notificationBell, "visitor has a notification bell beside the more-options control");
            assert.equal(m.bellColor, "rgb(255, 255, 255)", `${label}@${width}: bell matches the white header controls`);
            assert.ok(Number(m.coverImageOpacity) >= 0.3, `${label}@${width}: cover photo stays visible through the fade`);
           assert.equal(m.menuLabel, "More options");
           await page.locator("#profile-actions-open").click();
           await page.locator("#profile-actions-sheet[aria-hidden='false']").waitFor({ state: "visible" });
           assert.deepEqual(await page.locator("#profile-actions-sheet [role='menuitem'] span:not(.profile-action-selected)").allInnerTexts(),
             ["Restrict", "Block", "Report"]);
           assert.equal(await page.locator("[data-profile-share], #pfriend, #pclosefriend").count(), 0,
             "the viewer dropdown contains only Restrict, Block, and Report");
           await page.keyboard.press("Escape");
           await page.locator("#profile-actions-sheet[aria-hidden='true']").waitFor({ state: "hidden" });
            if (width === 390) {
              await page.locator("#profile-notifications-open").click();
              await page.locator("#profile-notifications-sheet.on").waitFor({ state: "visible" });
               assert.match(await page.locator("#profile-notifications-sheet").innerText(), /Follow .* to set up notifications/);
              await page.locator("#profile-notification-close").click();
              await page.locator("#profile-notifications-sheet").waitFor({ state: "hidden" });
              await page.locator("#sharep").click();
              await page.locator(".ps-card").waitFor({ state: "visible" });
              const codeCard = await page.evaluate(() => {
                const avatar = document.querySelector(".ps-avatar img");
                const identity = document.querySelector(".ps-ident");
                const share = document.querySelector('[data-act="share"]');
                return {
                  avatarSrc: avatar?.getAttribute("src") || "",
                  avatarLoaded: (avatar?.naturalWidth || 0) > 0,
                  identityDisplay: identity ? getComputedStyle(identity).display : "",
                  identityAlignment: identity ? getComputedStyle(identity).justifyItems : "",
                  hasShareArrow: !!share?.querySelector("svg"),
                  shareText: share?.textContent?.trim() || "",
                };
              });
              assert.ok(codeCard.avatarSrc.endsWith("/app/avatar.svg") && codeCard.avatarLoaded,
                "the profile code uses the account's actual avatar");
              assert.equal(codeCard.identityDisplay, "grid");
              assert.equal(codeCard.identityAlignment, "center");
              assert.equal(codeCard.hasShareArrow, false, "Share has no stray arrow icon");
              assert.equal(codeCard.shareText, "Share");
              await page.screenshot({ path: "/tmp/oldtime-profile-code-390.png" });
              await page.locator('.ps-icon-btn[data-act="back"]').click();
              await page.locator(".ps-dialog").waitFor({ state: "detached" });
            }
        }
        if (m.meta?.h) {
          assert.ok(m.meta.b <= m.statsRow.t, `${label}@${width}: public profile details appear before the totals`);
        }
        assert.equal(m.tabLayout?.display, "grid", `${label}@${width}: profile tabs are centered in equal columns`);
        assert.equal(m.tabLayout?.activeUnderline, "rgb(23, 25, 29)",
          `${label}@${width}: the selected profile tab uses a neutral underline, not blue`);
        if (label === "owner" && width === 390) {
          assert.equal(await page.locator("#profile-actions-open, [data-profile-note]").count(), 0,
            "owner profile has neither a redundant ellipsis nor a cover note action");
        }
      }
      assert.deepEqual(errors, [], "no page errors");
      await context.close();
    }
    // Every non-GET was intercepted with 503 (nothing reached a server). Analytics collection and realtime tickets are expected.
    assert.deepEqual([...new Set(writes.map(u => new URL(u).pathname))]
      .filter(path => !["/api/realtime/ticket", "/api/analytics/resources"].includes(path)), [], "no profile/relationship writes attempted");
  } finally {
    await browser?.close();
    await server.close();
  }
});
