import "./post-people-picker.css";

function profileRow(profile, esc, action, active = false) {
  const name = profile.displayName || profile.username || "Member";
  const state = profile.avatar
    ? `<img class="post-people-avatar" src="${esc(profile.avatar)}" alt="" loading="lazy" />`
    : `<span class="post-people-avatar post-people-avatar-fallback" aria-hidden="true">${esc(String(name).slice(0, 1).toUpperCase())}</span>`;
  return `<div class="post-people-row">
    ${state}
    <span class="post-people-copy"><b>${esc(profile.username || name)}</b><small>${esc(profile.displayName || "")}</small></span>
    <button type="button" class="post-people-action${active ? " is-active" : ""}" data-person-id="${esc(profile.id)}" aria-pressed="${active}">${action}</button>
  </div>`;
}

function createOverlay(sheet, title, esc) {
  const trigger = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "post-people-overlay";
  overlay.innerHTML = `<section class="panel post-people-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="grab" aria-hidden="true"></div>
    <header class="post-people-header"><h2>${esc(title)}</h2><button type="button" data-picker-close aria-label="Close">${iconsClose(esc)}</button></header>
    <label class="post-people-search"><span class="sr-only">Search people</span><input type="search" data-picker-search placeholder="Search people" autocomplete="off" /></label>
    <p class="post-people-status" data-picker-status role="status">Search by username or name.</p>
    <div class="post-people-results" data-picker-results></div>
    <button type="button" class="post-people-done" data-picker-done>Done</button>
  </section>`;
  sheet.appendChild(overlay);
  const close = () => {
    overlay.remove();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
  overlay.querySelector("[data-picker-close]").onclick = close;
  overlay.querySelector("[data-picker-done]").onclick = close;
  overlay.onclick = event => { if (event.target === overlay) close(); };
  return {
    overlay,
    close,
    search: overlay.querySelector("[data-picker-search]"),
    status: overlay.querySelector("[data-picker-status]"),
    results: overlay.querySelector("[data-picker-results]"),
  };
}

function iconsClose(esc) {
  void esc;
  return `<svg class="navic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`;
}

export function openCollaboratorPicker({ sheet, post, selectedIds = [], api, esc, onChange = () => {} }) {
  if (!sheet || !post?.cloud) return;
  const picker = createOverlay(sheet, "Collaborators", esc);
  const selected = new Set(selectedIds);
  const existing = new Map((post.collaborators || []).map(item => [
    item.user?.cloudAccountId || item.user?.id, item.status,
  ]));
  let generation = 0;
  let matches = [];
  const render = () => {
    picker.results.innerHTML = matches.map(person => {
      const active = selected.has(person.id);
      const status = active && existing.get(person.id) === "accepted" ? "On post"
        : active && existing.get(person.id) === "pending" ? "Invited"
          : active ? "Invited" : "Invite";
      return profileRow(person, esc, status, active);
    }).join("") || (picker.search.value.trim().length >= 2
      ? `<p class="post-people-empty">No eligible accounts found.</p>`
      : "");
    picker.results.querySelectorAll("[data-person-id]").forEach(button => {
      button.onclick = () => {
        const id = button.dataset.personId;
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        onChange([...selected]);
        render();
      };
    });
  };
  picker.search.oninput = async () => {
    const query = picker.search.value.trim();
    const request = ++generation;
    matches = [];
    if (query.length < 2) {
      picker.status.textContent = "Search by username or name.";
      render();
      return;
    }
    picker.status.textContent = "Searching…";
    try {
      const results = await api.searchCloudMentionUsers(query);
      if (!picker.overlay.isConnected || request !== generation) return;
      matches = results.filter(person => person?.id && person.id !== api.cloudAccountId());
      picker.status.textContent = matches.length ? "Choose people to invite. They must accept before appearing on the post." : "No eligible accounts found.";
      render();
    } catch (error) {
      if (!picker.overlay.isConnected || request !== generation) return;
      picker.status.textContent = error.message || "People could not be searched.";
    }
  };
  picker.search.focus({ preventScroll: true });
}

export function openPhotoTagEditor({ sheet, post, tags = [], api, esc, mediaUrl, onChange = () => {} }) {
  if (!sheet || !post?.cloud) return;
  const media = (post.mediaIds || []).map((mediaId, index) => ({
    mediaId,
    reference: post.media?.[index],
    type: post.mediaTypes?.[index] || "",
  })).filter(item => item.mediaId && item.reference && item.type.startsWith("image/"));
  const picker = createOverlay(sheet, "Tag people in photos", esc);
  const photoTags = tags.map(tag => ({ ...tag }));
  let activePerson = null;
  let activeMedia = 0;
  let matches = [];
  let generation = 0;
  const render = () => {
    picker.results.innerHTML = !media.length
      ? `<p class="post-people-empty">Photo tagging is available on posts with cloud photos.</p>`
      : `<div class="post-tag-instructions">${activePerson
          ? `Tap a photo to place @${esc(activePerson.username)}. Tap a tag to remove it.`
          : "Search for someone, then tap a photo to place their tag."}</div>
        ${matches.length ? `<div class="post-tag-suggestions">${matches.map(person => profileRow(
          person, esc, activePerson?.id === person.id ? "Selected" : "Select", activePerson?.id === person.id,
        )).join("")}</div>` : ""}
        <div class="post-tag-photo-tabs">${media.map((item, index) => `<button type="button" data-photo-index="${index}" aria-pressed="${index === activeMedia}">Photo ${index + 1}</button>`).join("")}</div>
        <div class="post-tag-stage" data-tag-stage tabindex="0" role="button" aria-label="${activePerson ? `Place tag for ${esc(activePerson.username)}` : "Select a person, then tap the photo"}">
          <img src="${esc(mediaUrl(media[activeMedia].reference))}" alt="Photo ${activeMedia + 1}" draggable="false" />
          ${photoTags.map((tag, index) => tag.mediaId === media[activeMedia].mediaId
            ? `<button type="button" class="post-tag-marker" data-tag-remove="${index}" style="left:${tag.x * 100}%;top:${tag.y * 100}%" aria-label="Remove tag for @${esc(tag.user?.username || "member")}">@${esc(tag.user?.username || "member")}</button>`
            : "").join("")}
        </div>`;
    picker.results.querySelectorAll("[data-person-id]").forEach(button => {
      button.onclick = () => {
        activePerson = matches.find(person => person.id === button.dataset.personId) || null;
        picker.status.textContent = activePerson ? `Selected @${activePerson.username}. Tap the photo to place the tag.` : "";
        render();
      };
    });
    picker.results.querySelectorAll("[data-photo-index]").forEach(button => {
      button.onclick = () => { activeMedia = Number(button.dataset.photoIndex) || 0; render(); };
    });
    picker.results.querySelectorAll("[data-tag-remove]").forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        photoTags.splice(Number(button.dataset.tagRemove), 1);
        onChange(photoTags);
        render();
      };
    });
    const stage = picker.results.querySelector("[data-tag-stage]");
    if (stage) {
      const place = event => {
        if (!activePerson || event.target.closest("[data-tag-remove]")) return;
        const bounds = stage.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
        const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
        const current = { mediaId: media[activeMedia].mediaId, userId: activePerson.id, x, y, user: activePerson };
        const existingIndex = photoTags.findIndex(tag => tag.mediaId === current.mediaId && tag.userId === current.userId);
        if (existingIndex >= 0) photoTags.splice(existingIndex, 1, current);
        else photoTags.push(current);
        activePerson = null;
        picker.status.textContent = "Tag added. Search for another person or tap a tag to remove it.";
        onChange(photoTags);
        render();
      };
      stage.onclick = place;
      stage.onkeydown = event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const bounds = stage.getBoundingClientRect();
        place({ clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, target: stage });
      };
    }
  };
  if (!media.length) picker.status.textContent = "Photo tagging is available on posts with cloud photos.";
  picker.search.oninput = async () => {
    const query = picker.search.value.trim();
    const request = ++generation;
    matches = [];
    if (query.length < 2) { render(); return; }
    picker.status.textContent = "Searching…";
    try {
      const results = await api.searchCloudMentionUsers(query);
      if (!picker.overlay.isConnected || request !== generation) return;
      matches = results.filter(person => person?.id && person.id !== api.cloudAccountId());
      picker.status.textContent = matches.length ? "Select a person, then tap the photo." : "No eligible accounts found.";
      render();
    } catch (error) {
      if (!picker.overlay.isConnected || request !== generation) return;
      picker.status.textContent = error.message || "People could not be searched.";
    }
  };
  render();
  picker.search.focus({ preventScroll: true });
}
