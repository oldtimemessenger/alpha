import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drawStatusStickers, ART_HOLES, STICKER_ART, loadStickerArt } from "./status-sticker-art.js";
import { DEFAULT_PROMPTS, PICKER_KINDS, STICKER_CTA, STICKER_LABELS, displayStickerLabel, displayStickerPrompt } from "./status-sticker-editor.js";

const captureSource = readFileSync(new URL("./status-capture.js", import.meta.url), "utf8");
const captureCss = readFileSync(new URL("./status-capture.css", import.meta.url), "utf8");
const interactionSource = readFileSync(new URL("./story-sticker-interactions.js", import.meta.url), "utf8");
const stickerArtSource = readFileSync(new URL("./status-sticker-art.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");

function recordingContext() {
  const calls = [];
  let ctx;
  const target = {
    canvas: { width: 540, height: 960 },
    getContext: null,
    measureText(value) {
      const size = Number(/([\d.]+)px/.exec(ctx.font)?.[1] || 12);
      return { width: [...String(value)].length * size * .52 };
    },
    fillText(value, x, y) {
      calls.push({ value: String(value), x, y, font: ctx.font, baseline: ctx.textBaseline, align: ctx.textAlign });
    },
    rotate(angle) { calls.push({ type: "rotate", angle }); },
    drawImage(image, ...args) { calls.push({ type: "image", image, args }); }
  };
  ctx = new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      return () => {};
    },
    set(object, key, value) { object[key] = value; return true; }
  });
  return { ctx, calls };
}

let artReady;
async function ensureArtLoaded() {
  if (artReady) return artReady;
  const originalImage = globalThis.Image;
  globalThis.Image = class {
    set src(value) { this._src = value; this.width = 1; this.height = 1; this.onload?.(); }
    get src() { return this._src; }
  };
  artReady = loadStickerArt(PICKER_KINDS, { required: true });
  try { await artReady; }
  finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
}

async function assertPromptFits(kind, prompt) {
  await ensureArtLoaded();
  const { ctx, calls } = recordingContext();
  drawStatusStickers(ctx, [{
    id: "sticker", kind, x: .5, y: .5, width: .44, height: .25,
    rotation: 0, title: kind === "questions" ? "Ask me a question" : "Prompt", prompt
  }], 540, 960);

  const textCalls = calls.filter(call => call.type !== "image");
  const actionIndex = textCalls.findIndex(call => call.value === "Add yours");
  const promptText = textCalls.slice(0, actionIndex < 0 ? undefined : actionIndex).map(call => call.value).join("");
  assert.ok(promptText.replace(/\s/g, "").includes(prompt.replace(/\s/g, "")), "the complete edited text is drawn inside the artwork");
  assert.equal(calls.some(call => call.type === "image"), false, "new templates use clean card artwork");
  if (kind !== "questions") assert.ok(actionIndex > 0, "Add yours follows the editable prompt");
  if (kind === "questions") assert.ok(!textCalls.some(call => call.value === "Send a question"));
}

test("long edited prompts fit the classic templates and stay separate from Add yours", async () => {
  const prompt = "This is an edited Story prompt that should wrap cleanly and remain readable without colliding with its action button.";
  await assertPromptFits("questions", prompt);
  await assertPromptFits("trendsetters", prompt);
});

test("long unbroken edited text wraps instead of being cut at the artwork edge", async () => {
  await assertPromptFits("questions", "Question".repeat(15));
});

test("owners can tap a story addition once to edit its prompt without a title field", () => {
  assert.match(captureSource, /if \(s\) \{ selectSticker\(s\.id\); openStickerForm\(s\); return; \}/);
  assert.match(captureSource, /data-testid="input-sticker-prompt"/);
  assert.doesNotMatch(captureSource, /input-sticker-title|name="title"|form\.elements\.title|data-ed="stk-edit"/);
  assert.match(stickerArtSource, /return \{ main: displayStickerLabel\("questions", s\.title\), sub: prompt, hint:/);
  assert.match(stickerArtSource, /return \{ main: prompt \|\| "Let's chat", join: STICKER_CTA \}/);
  assert.match(captureSource, /form\.addEventListener\("submit", event => \{ event\.preventDefault\(\); saveStickerForm\(\); \}\)/);
  assert.match(captureSource, /form\.addEventListener\("input", \(\) => \{[\s\S]*?updateStickerText\(sticker,[\s\S]*?paint\(\);/);
  assert.match(captureSource, /closeStickerForm\(\{ restore = false \} = \{\}\)/);
  assert.match(captureSource, /closeStickerForm\(\{ restore: true \}\)/);
  assert.match(captureSource, /form\.elements\.prompt\.readOnly = answering \|\| sharedPrompt/);
  assert.match(captureSource, /sharedPrompt \? "Original prompt"/);
  assert.match(captureSource, /form\.querySelector\('\[data-testid="button-sticker-save"\]'\)\.hidden = sharedPrompt/);
});

test("viewers can tap the question card itself to ask without a Send button", () => {
  assert.match(interactionSource, /button\.onclick = e => \{[\s\S]{0,220}sticker\.kind === "questions"[\s\S]{0,80}ask\(sticker\)/);
  assert.doesNotMatch(captureSource, /Send a question/);
  assert.doesNotMatch(stickerArtSource, /Send a question/);
});

test("Story templates use a compact horizontal tray with clean previews", () => {
  assert.match(captureSource, /aria-label="Story templates"/);
  assert.match(captureSource, /<b>Story templates<\/b>/);
  assert.doesNotMatch(captureSource, />Stickers</);
  assert.match(captureCss, /\.sc-stk-picker\{[^}]*background:transparent[^}]*border:0[^}]*box-shadow:none/);
  assert.match(captureCss, /\.sc-stk-row\{[^}]*overflow-x:auto[^}]*touch-action:pan-x/);
  assert.match(captureCss, /\.sc-root \.sc-stk-card\{[^}]*width:min\(144px,36vw\)/);
  assert.match(captureSource, /sc-stk-preview-art sc-preview-question/);
  assert.doesNotMatch(captureSource, /src="\$\{esc\(STICKER_ART\[kind\] \|\| ""\)\}"/);
  assert.equal(ART_HOLES.trendsetters.join[1], .70);
  assert.equal(ART_HOLES["hey-world"].join[3], .88);
  assert.ok(Object.values(STICKER_ART).every(Boolean));
});

test("new Story templates remove old Trendsetter, Add Yours and emoji copy", () => {
  assert.deepEqual(PICKER_KINDS, ["questions", "trendsetters"]);
  assert.deepEqual(STICKER_LABELS, { questions: "Question", trendsetters: "Let's chat", "hey-world": "Let's chat", answer: "Answer" });
  assert.equal(displayStickerLabel("trendsetters", "Trendsetters"), "Let's chat");
  assert.equal(displayStickerLabel("trendsetters", "Prompt"), "Let's chat");
  assert.equal(displayStickerLabel("questions", "Questions"), "Ask a question");
  assert.equal(displayStickerLabel("questions", "Ask me anything"), "Ask a question");
  assert.equal(DEFAULT_PROMPTS.trendsetters, "Let's chat");
  assert.equal(DEFAULT_PROMPTS.questions, "Let's chat");
  assert.equal(STICKER_CTA, "Add yours");
  assert.equal(displayStickerPrompt("Write a prompt"), "Let's chat");
  assert.equal(displayStickerPrompt("Ask me anything"), "Let's chat");
  assert.equal(displayStickerPrompt("Join the trend 🔥"), "Let's chat");
  assert.equal(displayStickerPrompt("Say hello to the world"), "Let's chat");
  assert.equal(displayStickerPrompt("What did you make today?"), "What did you make today?");
  assert.doesNotMatch(captureSource, /Invite people to join in|Let people ask you/);
  assert.match(appSource, /openStatusCapture\(\{\s*source: options\.source \|\| "landing", \.\.\.options/);
});

test("Story colors use a compact quick-picker with a custom color wheel", () => {
  assert.match(captureSource, /"#e5262f": "Red"/);
  assert.match(captureSource, /"#f27a2b": "Orange"/);
  assert.match(captureSource, /"#1456d9": "Blue"/);
  assert.match(captureSource, /STATUS_QUICK_COLORS = \["#17191c", "#ffffff", "#e5262f", "#1456d9"\]/);
  assert.match(captureSource, /data-color-scope="text"/);
  assert.match(captureSource, /data-color-scope="background"/);
  assert.match(captureSource, /data-color-popover/);
  assert.match(captureSource, /type="color" data-custom-color/);
  assert.match(captureSource, /statusQuickColorMarkup\(t\.dataset\.colorScope === "text" \? "text-color" : "bg-color"\)/);
  assert.match(captureSource, /project\.background = \{ kind: "color", color: "#17191c", media: "" \}/);
  assert.match(captureSource, /if \(t\.dataset\.colorScope\)/);
  assert.match(captureCss, /\.sc-color-popover\{[^}]*position:absolute/);
  assert.match(captureCss, /\.sc-color-wheel\{[^}]*conic-gradient/);
  assert.doesNotMatch(captureCss, /\.sc-color-palette/);
});

test("template renderer draws clean editable cards and keeps legacy answer artwork", async () => {
  await ensureArtLoaded();
  assert.match(stickerArtSource, /function drawClassicCard/);
  assert.match(stickerArtSource, /scale = box\.iw \/ aw/);
  assert.match(stickerArtSource, /holeText\(ctx, ART_HOLES\.questions\.main/);
  assert.match(stickerArtSource, /ctx\.drawImage\(entry\.img, 0, sy, nw, sh/);
  assert.equal(ART_HOLES.questions.main[1], .18);
});

test("all editable template text stays level and centered within its artwork", async () => {
  await ensureArtLoaded();
  for (const kind of ["questions", "trendsetters", "hey-world"]) {
    const { ctx, calls } = recordingContext();
    drawStatusStickers(ctx, [{
      id: `alignment-${kind}`, kind, x: .5, y: .5, width: .44, height: .25,
      rotation: 0, title: "Ignored title", prompt: "A balanced prompt with even spacing",
    }], 540, 960);
    const text = calls.filter(call => typeof call.value === "string");
    assert.ok(text.length >= 2, `${kind} renders its prompt and action text`);
    assert.ok(text.every(call => call.x === 0 && call.align === "center"), `${kind} text lines share a centered baseline`);
    assert.ok(calls.filter(call => call.type === "rotate").every(call => Math.abs(call.angle) < .001),
      `${kind} text stays horizontal`);
  }
});
