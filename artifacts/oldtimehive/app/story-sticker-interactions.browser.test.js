import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromiumPath = [process.env.CHROMIUM_PATH, "/repl/tools/bin/chromium", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
const cases = [
  { kind: "trendsetters", artWidth: 900, artHeight: 529, prompt: "Let's chat", x: .5, y: .79, rotation: 29 },
  { kind: "hey-world", artWidth: 601, artHeight: 648, prompt: "Let's chat", x: .5, y: .79, rotation: -17 },
];

test("viewer response actions open a linked Status composition", {
  skip: !chromiumPath && "Chromium unavailable",
  timeout: 120_000,
}, async () => {
  const server = await createServer({
    configFile: resolve(packageRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  let browser;
  try {
    await server.listen();
    const { port } = server.httpServer.address();
    browser = await chromium.launch({
      executablePath: chromiumPath, headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("**/api/**", route => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({
        participants: [{ storyId: "00000000-0000-4000-8000-000000000202", author: {
          id: "reply-member", username: "replymember", displayName: "Reply member", avatar: "",
        } }],
        nextOffset: null,
        hasMore: false,
      }),
    }));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.setContent("<!doctype html><html><head></head><body style='margin:0'></body></html>");
    await page.evaluate(() => sessionStorage.setItem("oldtime-cloud-session-v1", JSON.stringify({
      accessToken: "browser-test-token",
      account: { id: "00000000-0000-4000-8000-000000000303" },
      expiresAt: Date.now() + 60_000,
    })));

    for (const [index, action] of cases.entries()) {
      const stickerId = `00000000-0000-4000-8000-00000000000${index + 1}`;
      const point = await page.evaluate(async ({ action, stickerId }) => {
        const { mountStoryStickerInteractions } = await import("/app/story-sticker-interactions.js");
        const view = document.createElement("div");
        view.id = "storyview";
        view.className = "storyview on";
        view.style.cssText = "display:block;position:relative;width:390px;height:844px;overflow:hidden";
        const stage = document.createElement("div");
        stage.className = "story-stage";
        stage.style.cssText = "position:relative;width:390px;height:844px";
        view.append(stage);
        document.body.replaceChildren(view);
        window.joinResult = null;
        mountStoryStickerInteractions(view, {
          id: "00000000-0000-4000-8000-000000000101",
          author: "another-member",
          hasMedia: true,
          stickers: [{
            id: stickerId, kind: action.kind, prompt: action.prompt,
            x: .5, y: .53, width: .78, height: .34, rotation: action.rotation,
          }],
        }, {
          onCreate: options => { window.joinResult = options; },
          toast: () => {},
          onOpenStory: () => {},
        });
        const button = view.querySelector(".ss-respond-hit");
        const bounds = button.getBoundingClientRect();
        return {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
          stickerId,
          width: button.offsetWidth, height: button.offsetHeight, buttonCount: view.querySelectorAll(".ss-hit").length,
        };
      }, { action, stickerId });

      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && point.width > 0 && point.height > 0,
        `Response target geometry is valid: ${JSON.stringify(point)}`);
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(() => window.joinResult !== null, null, { timeout: 4_000 });
      const joined = await page.evaluate(() => window.joinResult.initialStickers[0]);
      const source = await page.evaluate(() => window.joinResult.source);
      assert.equal(joined.kind, action.kind);
      assert.equal(joined.prompt, action.prompt);
      assert.equal(joined.sourceStickerId, point.stickerId);
      assert.equal(source, "camera", "the Add yours action opens the camera-first Story creator");

      await page.evaluate(() => { window.joinResult = null; });
      const promptPoint = await page.evaluate(() => {
        const card = document.querySelector(".ss-hit:not(.ss-respond-hit)");
        const bounds = card.getBoundingClientRect();
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height * .2 };
      });
      await page.mouse.click(promptPoint.x, promptPoint.y);
      await page.waitForFunction(() => document.querySelector("[data-ss-join]")?.textContent.trim() === "Add yours");
      await page.waitForFunction(() => document.querySelectorAll(".ss-person").length === 1);
      assert.equal(await page.locator(".ss-person b").innerText(), "Reply member");
      await page.locator("[data-ss-join]").click();
      await page.waitForFunction(() => window.joinResult !== null, null, { timeout: 4_000 });
      const replyJoined = await page.evaluate(() => window.joinResult.initialStickers[0]);
      assert.equal(replyJoined.sourceStickerId, point.stickerId, "joining from the replies view keeps the original prompt linked");
      assert.equal((await page.evaluate(() => window.joinResult.source)), "camera");
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});
