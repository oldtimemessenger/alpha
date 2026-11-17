const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

const getAuthorName = author => author?.displayName || author?.name || author?.username || "You";

function avatarMarkup(author) {
  const name = getAuthorName(author);
  const image = author?.avatar || author?.photoUrl || author?.profilePhoto;
  return image
    ? `<img class="thread-composer-avatar" src="${escapeHtml(image)}" alt="">`
    : `<span class="thread-composer-avatar thread-composer-avatar-initial" aria-hidden="true">${escapeHtml([...name.trim()][0] || "Y").toUpperCase()}</span>`;
}

export function openThreadComposer({
  host,
  author = {},
  icons = {},
  onClose = () => {},
  onSubmit = async () => { throw new Error("Thread publishing is not connected yet."); },
} = {}) {
  if (!host) return;

  let parts = ["", ""];
  let closed = false;
  let busy = false;
  let cancelWarningArmed = false;
  const publishedPartIndexes = new Set();
  const authorName = escapeHtml(getAuthorName(author));

  const close = ({ notify = true } = {}) => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown);
    host.classList.remove("on");
    host.replaceChildren();
    host.onclick = null;
    if (notify) onClose();
  };

  const rowMarkup = (text, index) => `
    <section class="thread-composer-row" data-thread-row="${index}">
      <div class="thread-composer-row-avatar">${avatarMarkup(author)}</div>
      <div class="thread-composer-row-main">
        <div class="thread-composer-row-head">
          <span class="thread-composer-author">${authorName}</span>
          <span class="thread-composer-part-label">Post ${index + 1} of 10</span>
          ${parts.length > 2 && index > 0 ? `<button class="thread-composer-remove" type="button" data-thread-remove="${index}" aria-label="Remove post ${index + 1}" title="Remove post">${icons.close || "×"}</button>` : ""}
        </div>
        <textarea maxlength="1000" rows="2" data-thread-input="${index}" aria-label="${index === 0 ? "First post" : `Thread post ${index + 1}`}" aria-describedby="thread-count-${index}" placeholder="${index === 0 ? "Write the first post…" : "Add another post…"}">${escapeHtml(text)}</textarea>
        <div class="thread-composer-row-meta"><small id="thread-count-${index}" data-thread-count="${index}" aria-live="polite">${[...text].length.toLocaleString()} / 1,000</small></div>
      </div>
    </section>`;

  host.innerHTML = `<section class="panel thread-composer" role="dialog" aria-modal="true" aria-labelledby="thread-composer-title" tabindex="-1">
    <div class="grab"></div>
    <header class="thread-composer-head">
      <button type="button" class="thread-composer-cancel" data-thread-cancel>Cancel</button>
      <h2 id="thread-composer-title">New thread</h2>
      <button type="button" class="thread-composer-submit" data-thread-submit>Post All</button>
    </header>
    <div class="thread-composer-list" data-thread-list aria-label="Thread posts"></div>
    <button class="thread-composer-add" type="button" data-thread-add>
      <span class="thread-composer-add-mark" aria-hidden="true">＋</span>
      <span>Add another post</span>
      <small data-thread-total aria-live="polite">1 / 10</small>
    </button>
    <p class="thread-composer-status" data-thread-status role="status" aria-live="polite"></p>
    <p class="thread-composer-error" data-thread-error role="alert"></p>
  </section>`;
  host.classList.add("on");

  const dialog = host.querySelector(".thread-composer");
  const list = host.querySelector("[data-thread-list]");
  const addButton = host.querySelector("[data-thread-add]");
  const submitButton = host.querySelector("[data-thread-submit]");
  const status = host.querySelector("[data-thread-status]");
  const error = host.querySelector("[data-thread-error]");

  const syncButtons = () => {
    addButton.disabled = busy || parts.length >= 10;
    submitButton.disabled = busy || parts.length < 2 || parts.some(part => !part.trim());
    submitButton.textContent = busy ? "Posting…" : "Post All";
    host.querySelectorAll("[data-thread-remove]").forEach(button => {
      const input = list.querySelector(`[data-thread-input="${button.dataset.threadRemove}"]`);
      button.disabled = busy || input?.dataset.threadLocked === "true";
    });
    host.querySelectorAll("[data-thread-input]").forEach(input => {
      input.readOnly = busy || input.dataset.threadLocked === "true";
    });
    host.querySelector("[data-thread-cancel]").disabled = busy;
    host.querySelector("[data-thread-total]").textContent = `${parts.length} / 10`;
  };

  const requestClose = () => {
    if (publishedPartIndexes.size && !cancelWarningArmed) {
      cancelWarningArmed = true;
      status.textContent = `${publishedPartIndexes.size} ${publishedPartIndexes.size === 1 ? "post is" : "posts are"} already published. Retry Post All to connect them, or close again to leave them separate.`;
      host.querySelector("[data-thread-cancel]").textContent = "Close anyway";
      return;
    }
    close();
  };

  const renderRows = (focusIndex = null) => {
    list.innerHTML = parts.map(rowMarkup).join("");
    list.querySelectorAll("[data-thread-input]").forEach(input => {
      input.addEventListener("input", () => {
        const index = Number(input.dataset.threadInput);
        parts[index] = input.value;
        list.querySelector(`[data-thread-count="${index}"]`).textContent = `${[...input.value].length.toLocaleString()} / 1,000`;
        input.removeAttribute("aria-invalid");
        error.textContent = "";
        syncButtons();
      });
    });
    list.querySelectorAll("[data-thread-remove]").forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.threadRemove);
        parts.splice(index, 1);
        renderRows(Math.max(0, index - 1));
        syncButtons();
      });
    });
    if (focusIndex !== null) list.querySelector(`[data-thread-input="${focusIndex}"]`)?.focus();
    syncButtons();
  };

  const onKeydown = event => {
    if (event.key === "Escape" && !busy && host.classList.contains("on")) {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab" || closed) return;
    const controls = [...dialog.querySelectorAll("button:not(:disabled), textarea:not([readonly])")];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  renderRows();
  addButton.addEventListener("click", () => {
    if (busy || parts.length >= 10) return;
    parts.push("");
    error.textContent = "";
    renderRows(parts.length - 1);
  });
  submitButton.addEventListener("click", async () => {
    if (busy) return;
    const fields = [...list.querySelectorAll("[data-thread-input]")];
    parts = fields.map(field => field.value);
      if (parts.length < 2) {
        error.textContent = "A thread needs at least two posts.";
        addButton.focus();
        return;
      }
      const emptyIndex = parts.findIndex(part => !part.trim());
    if (emptyIndex !== -1) {
      error.textContent = "Add text to every post before publishing the thread.";
      fields[emptyIndex]?.setAttribute("aria-invalid", "true");
      fields[emptyIndex]?.focus();
      return;
    }
    busy = true;
    cancelWarningArmed = false;
    host.querySelector("[data-thread-cancel]").textContent = "Cancel";
    error.textContent = "";
    status.textContent = "Publishing your thread…";
    syncButtons();
    const markPartLocked = index => {
      const input = list.querySelector(`[data-thread-input="${index}"]`);
      if (!input) return;
      input.dataset.threadLocked = "true";
      input.readOnly = true;
      const remove = host.querySelector(`[data-thread-remove="${index}"]`);
      if (remove) remove.disabled = true;
    };
    const markPartPublished = index => {
      markPartLocked(index);
      publishedPartIndexes.add(index);
      status.textContent = `${publishedPartIndexes.size} ${publishedPartIndexes.size === 1 ? "post" : "posts"} published. Completing the thread…`;
    };
    try {
      await onSubmit(parts.map(part => part.trim()), { markPartLocked, markPartPublished });
      close();
    } catch (failure) {
      if (closed) return;
      busy = false;
      status.textContent = publishedPartIndexes.size
        ? `${publishedPartIndexes.size} ${publishedPartIndexes.size === 1 ? "post is" : "posts are"} already published. Retry to connect the thread.`
        : "";
      error.textContent = failure?.message || "Your thread could not be posted. Your text is still here — try again.";
      if (publishedPartIndexes.size) {
        status.textContent += " Closing now will leave them as separate posts.";
        cancelWarningArmed = false;
        host.querySelector("[data-thread-cancel]").textContent = "Cancel";
      }
      syncButtons();
    }
  });
  host.querySelector("[data-thread-cancel]").onclick = requestClose;
  host.onclick = event => {
    if (event.target === host && !busy) requestClose();
  };
  document.addEventListener("keydown", onKeydown);
  requestAnimationFrame(() => {
    if (!closed) list.querySelector("[data-thread-input='0']")?.focus({ preventScroll: true });
  });

  return {
    close,
    dispose() {
      close({ notify: false });
    },
  };
}
