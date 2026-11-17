import { openThreadComposer } from "./thread-composer.js";

const STATUS_COLORS = [
  ["#ffffff", "White"],
  ["#17191c", "Black"],
  ["#e5262f", "Red"],
  ["#f27a2b", "Orange"],
  ["#f2c94c", "Yellow"],
  ["#2f855a", "Green"],
  ["#1456d9", "Blue"],
  ["#7351a6", "Purple"],
  ["#d14984", "Pink"],
];

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

function buttonIcon(icons, name, fallback) {
  return icons?.[name] || `<span aria-hidden="true">${fallback}</span>`;
}

export function openCreateFlowPicker({
  host,
  icons = {},
  onCamera = () => {},
  onMedia = () => {},
  onText = () => {},
  onThread = async () => { throw new Error("Thread publishing is not connected yet."); },
  author = {},
  onClose = () => {},
  toast = () => {},
} = {}) {
  if (!host) return;
  host.classList.add("on");
  let removeEscapeListener = () => {};

  const close = ({ notify = true } = {}) => {
    host.classList.remove("on");
    host.replaceChildren();
    removeEscapeListener();
    if (notify) onClose();
  };

  const choice = (kind, label, help, glyph) => `
    <button type="button" class="create-flow-choice" data-create-choice="${kind}">
      <span class="create-flow-choice-icon">${buttonIcon(icons, glyph, glyph === "thread" ? "↳" : "•")}</span>
      <span><b>${label}</b><small>${help}</small></span>
      <span class="create-flow-choice-arrow" aria-hidden="true">›</span>
    </button>`;

  const header = (title, back = false) => `
    <header class="create-flow-picker-head">
      ${back
        ? `<button type="button" data-create-back aria-label="Back">${buttonIcon(icons, "back", "‹")}</button>`
        : `<span></span>`}
      <b>${title}</b>
      <button type="button" data-create-close aria-label="Close">${buttonIcon(icons, "close", "×")}</button>
    </header>`;

  const bindDismissal = () => {
    host.querySelector("[data-create-close]")?.addEventListener("click", () => close());
    host.querySelector("[data-create-back]")?.addEventListener("click", showChoices);
    host.onclick = event => {
      if (event.target === host) close();
    };
  };

  const showChoices = () => {
    host.innerHTML = `<section class="panel create-flow-picker" role="dialog" aria-modal="true" aria-labelledby="create-flow-title">
      <div class="grab"></div>
      ${header("New post")}
      <p class="create-flow-intro" id="create-flow-title">Choose what you want to share.</p>
      ${choice("photos", "Photo carousel", "Choose one photo or up to 10 swipeable photos.", "image")}
      ${choice("video", "Video", "Choose a video to share.", "video")}
      ${choice("text", "Text post", "Write on a solid color canvas.", "quote")}
       ${choice("thread", "Thread", "Connect up to 10 text posts.", "compose")}
      ${choice("camera", "Camera", "Take a photo or record a video.", "camera")}
      <input type="file" accept="image/*" multiple hidden data-create-photo-input>
      <input type="file" accept="video/*" hidden data-create-video-input>
    </section>`;
    bindDismissal();
    host.querySelector('[data-create-choice="photos"]').onclick = () => {
      const input = host.querySelector("[data-create-photo-input]");
      input.value = "";
      input.click();
    };
    host.querySelector('[data-create-choice="video"]').onclick = () => {
      const input = host.querySelector("[data-create-video-input]");
      input.value = "";
      input.click();
    };
    host.querySelector('[data-create-choice="text"]').onclick = showText;
    host.querySelector('[data-create-choice="thread"]').onclick = () => {
      close({ notify: false });
      openThreadComposer({
        host,
        author,
        icons,
        onClose,
        onSubmit: (parts, progress) => onThread(parts, progress),
      });
    };
    host.querySelector('[data-create-choice="camera"]').onclick = () => {
      close({ notify: false });
      onCamera();
    };
    host.querySelector("[data-create-photo-input]").onchange = event => {
      const files = [...(event.target.files || [])];
      if (!files.length) return;
      if (files.length > 10) {
        toast("Choose up to 10 photos for one post.");
        return;
      }
      if (files.some(file => !file.type.startsWith("image/"))) {
        toast("Choose photos for a swipeable post.");
        return;
      }
      showMediaReview(files, "photo");
    };
    host.querySelector("[data-create-video-input]").onchange = event => {
      const files = [...(event.target.files || [])];
      if (!files.length) return;
      if (files.length !== 1 || !files[0].type.startsWith("video/")) {
        toast("Choose one video.");
        return;
      }
      showMediaReview(files, "video");
    };
  };

  const showMediaReview = (files, kind) => {
    const count = files.length;
    const title = kind === "video" ? "Video ready" : count === 1 ? "Photo ready" : `${count} photos ready`;
    const detail = kind === "video"
      ? escapeHtml(files[0].name || "Selected video")
      : count === 1 ? escapeHtml(files[0].name || "Selected photo") : "One swipeable post";
    host.innerHTML = `<section class="panel create-flow-picker" role="dialog" aria-modal="true" aria-labelledby="create-flow-title">
      <div class="grab"></div>
      ${header(title, true)}
      <div class="create-flow-media-summary" aria-live="polite">
        <span class="create-flow-media-icon">${buttonIcon(icons, kind === "video" ? "video" : "image", "•")}</span>
        <span><b>${kind === "video" ? "Video" : `${count} ${count === 1 ? "photo" : "photos"}`}</b><small>${detail}</small></span>
      </div>
      <p class="create-flow-intro" id="create-flow-title">You can share it now or open the editor first.</p>
      <button type="button" class="create-flow-primary" data-create-share>Share as-is</button>
      <button type="button" class="create-flow-secondary" data-create-edit>Edit in Studio</button>
      <button type="button" class="create-flow-text-button" data-create-repick>Choose different media</button>
    </section>`;
    bindDismissal();
    host.querySelector("[data-create-share]").onclick = () => {
      close({ notify: false });
      onMedia(files, { kind, startShare: true });
    };
    host.querySelector("[data-create-edit]").onclick = () => {
      close({ notify: false });
      onMedia(files, { kind, startShare: false });
    };
    host.querySelector("[data-create-repick]").onclick = showChoices;
  };

  const showText = () => {
    const defaultColor = "#1456d9";
    const swatches = STATUS_COLORS.map(([color, name]) => `
      <button type="button" class="create-flow-swatch" data-create-color="${color}" aria-label="${name} canvas" aria-pressed="${color === defaultColor}" style="--create-swatch:${color}"></button>`).join("");
    host.innerHTML = `<section class="panel create-flow-picker create-flow-text" role="dialog" aria-modal="true" aria-labelledby="create-flow-title">
      <div class="grab"></div>
      ${header("Text post", true)}
      <label class="create-flow-label" for="create-flow-text-input">Write your post</label>
      <textarea id="create-flow-text-input" maxlength="1000" rows="4" placeholder="Write something..." aria-describedby="create-flow-text-hint"></textarea>
      <p class="create-flow-hint" id="create-flow-text-hint">The text opens on a canvas in Studio. Double-tap it there to edit.</p>
      <div class="create-flow-color-heading"><b>Canvas color</b><label class="create-flow-custom-color" aria-label="Choose a custom canvas color"><input type="color" value="${defaultColor}" data-create-custom-color></label></div>
      <div class="create-flow-swatches" role="group" aria-label="Canvas color">${swatches}</div>
      <button type="button" class="create-flow-primary" data-create-continue>Continue to Studio</button>
    </section>`;
    bindDismissal();
    let color = defaultColor;
    const setColor = next => {
      color = next;
      host.querySelectorAll("[data-create-color]").forEach(button =>
        button.setAttribute("aria-pressed", String(button.dataset.createColor === color)));
      const picker = host.querySelector("[data-create-custom-color]");
      if (picker && picker.value !== color) picker.value = color;
    };
    host.querySelectorAll("[data-create-color]").forEach(button =>
      button.onclick = () => setColor(button.dataset.createColor));
    host.querySelector("[data-create-custom-color]").oninput = event => setColor(event.target.value);
    host.querySelector("[data-create-continue]").onclick = () => {
      const text = host.querySelector("#create-flow-text-input").value.trim();
      if (!text) {
        toast("Write something before continuing.");
        host.querySelector("#create-flow-text-input").focus();
        return;
      }
      close({ notify: false });
      onText({ text, color });
    };
  };

  showChoices();
  host.querySelector("[data-create-choice='photos']")?.focus({ preventScroll: true });
  const onKeydown = event => {
    if (event.key !== "Escape" || !host.classList.contains("on")) return;
    event.preventDefault();
    close();
  };
  document.addEventListener("keydown", onKeydown);
  removeEscapeListener = () => document.removeEventListener("keydown", onKeydown);
  return {
    close,
    dispose() {
      removeEscapeListener();
      host.classList.remove("on");
      host.replaceChildren();
    },
  };
}
