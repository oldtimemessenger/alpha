import { api, requestCloudApi } from "./store.js";

export const ENGAGEMENT_PAGE_SIZE = 20;
export const ENGAGEMENT_MAX_PEOPLE = 1000;

const fallbackEsc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const escapeText = (value, esc) => (esc || fallbackEsc)(value);
const formatCount = value => new Intl.NumberFormat().format(Math.max(0, Math.floor(Number(value) || 0)));

export function mergeEngagementPeople(current, page) {
  const seen = new Set((Array.isArray(current) ? current : []).map(person => person?.id).filter(Boolean));
  const merged = Array.isArray(current) ? [...current] : [];
  for (const person of Array.isArray(page) ? page : []) {
    if (!person?.id || seen.has(person.id) || merged.length >= ENGAGEMENT_MAX_PEOPLE) continue;
    seen.add(person.id);
    merged.push(person);
  }
  return merged;
}

export function filterEngagementPeople(people, query) {
  const normalized = String(query || "").trim().toLocaleLowerCase();
  if (!normalized) return Array.isArray(people) ? people : [];
  return (Array.isArray(people) ? people : []).filter(person =>
    `${person?.displayName || ""} ${person?.username || ""}`.toLocaleLowerCase().includes(normalized));
}

export const canLoadMoreEngagementPeople = (people, hasMore) =>
  hasMore === true && people.length < ENGAGEMENT_MAX_PEOPLE;

export function openPostEngagement(postId, {
  sheet,
  esc,
  icons = {},
  counts = {},
  initialTab = "likes",
  getFollowState,
  onFollow,
  onProfile,
  onClose,
} = {}) {
  if (!sheet || !postId) return;

  const ownerId = api.me()?.id;
  const post = api.post(postId);
  const canSeeLikeCount = post?.likesVisible !== false || post?.author === ownerId;
  const validTabs = new Set(["likes", "views", "reposts"]);
  let tab = validTabs.has(initialTab) ? initialTab : "likes";
  let people = [];
  let offset = 0;
  let hasMore = false;
  let loading = false;
  let error = "";
  let query = "";
  let generation = 0;
  let live = true;
  const totals = {
    likes: Math.max(0, Number(counts.likes) || 0),
    views: Math.max(0, Number(counts.views) || 0),
    reposts: Math.max(0, Number(counts.reposts) || 0),
  };
  const returnFocus = document.activeElement;
  const e = value => escapeText(value, esc);
  const current = () => live && sheet.querySelector("[data-post-engagement]");
  const close = () => {
    if (!live) return;
    live = false;
    sheet.classList.remove("on");
    sheet.innerHTML = "";
    sheet.onclick = sheet.onkeydown = null;
    onClose?.();
    if (returnFocus?.isConnected) returnFocus.focus?.();
  };

  const selectedLabel = () => tab === "reposts" ? "Reposted by" : "Liked by";
  const metric = (name, label, icon) => `<button type="button" class="engagement-metric${tab === name ? " is-selected" : ""}"
    role="tab" id="engagement-tab-${name}" aria-selected="${tab === name}" aria-controls="engagement-content"
    data-engagement-tab="${name}" aria-label="${name === "likes" && !canSeeLikeCount ? "Likes hidden" : `${label}, ${formatCount(totals[name])}`}">
    <span class="engagement-metric-value">${icon}<b data-engagement-count="${name}">${name === "likes" && !canSeeLikeCount ? "" : formatCount(totals[name])}</b></span>
    <span class="engagement-metric-label">${label}</span></button>`;

  function drawPanel() {
    if (!live) return;
    const isViews = tab === "views";
    sheet.innerHTML = `<section class="panel comment-panel engagement-panel" data-post-engagement="${e(postId)}"
       role="dialog" aria-modal="true" aria-label="${tab === "reposts" ? "Reposts" : "Likes and views"}" tabindex="-1">
      <div class="grab" aria-hidden="true"></div>
      <div class="engagement-header">
        <h2>${tab === "reposts" ? "Reposts" : "Likes and views"}</h2>
        <button type="button" class="comment-close" data-engagement-close aria-label="Close engagement">${icons.close || ""}</button>
      </div>
      <div class="engagement-metrics" role="tablist" aria-label="Post engagement">
        ${metric("likes", "Likes", icons.mediaHeart || icons.heart || "")}
        ${metric("views", "Views", icons.viewBars || "")}
        ${metric("reposts", "Reposts", icons.repost || "")}
      </div>
      <div id="engagement-content" class="engagement-content" role="tabpanel" aria-labelledby="engagement-tab-${tab}">
        ${isViews
          ? `<section class="engagement-view-summary"><b>${formatCount(totals.views)} views</b><p>Viewer names aren’t available; only the total is shown.</p></section>`
          : `<div class="engagement-list-heading"><h3>${selectedLabel()}</h3></div>
             <label class="comment-search-wrap engagement-search">${icons.search || ""}<input type="search" data-engagement-search
               placeholder="Search" aria-label="Search people who ${tab === "reposts" ? "reposted" : "liked"} this post" value="${e(query)}"></label>
             <div class="comment-list likes-list engagement-list" data-engagement-list aria-live="polite"></div>`}
      </div>
    </section>`;

    sheet.querySelector("[data-engagement-close]")?.addEventListener("click", close);
    sheet.querySelectorAll("[data-engagement-tab]").forEach(button => {
      button.addEventListener("click", () => selectTab(button.dataset.engagementTab));
    });
    sheet.querySelector("[data-engagement-search]")?.addEventListener("input", event => {
      query = event.currentTarget.value;
      drawPeople();
    });
    if (isViews) return;
    drawPeople();
  }

  function personMarkup(person) {
    const localId = person.localId || api.cloudAuthorId(person);
    const username = String(person.username || "member");
    const displayName = String(person.displayName || username);
    const avatar = api.user(localId)?.avatar || person.avatar || person.avatarUrl || "";
    const initial = [...displayName.trim()][0]?.toUpperCase() || username[0]?.toUpperCase() || "?";
    const avatarMarkup = avatar
      ? `<img class="engagement-avatar" src="${e(avatar)}" alt="" loading="lazy" />`
      : `<span class="engagement-avatar engagement-avatar-fallback" aria-hidden="true">${e(initial)}</span>`;
    const relationship = getFollowState?.(localId) || {};
    const followLabel = relationship.following ? "Following" : relationship.requested ? "Requested" : "Follow";
    const followMarkup = onFollow && !relationship.self
      ? `<button type="button" class="engagement-follow${relationship.following ? " is-following" : ""}"
          data-engagement-follow="${e(localId)}" aria-pressed="${Boolean(relationship.following)}"
          aria-label="${followLabel} @${e(username)}">${followLabel}</button>`
      : "";
    return `<div class="engagement-person">
      <button type="button" class="engagement-profile" data-engagement-profile="${e(localId)}" aria-label="Open @${e(username)}’s profile">
        ${avatarMarkup}<span class="engagement-person-copy"><b>${e(displayName)}</b><small>@${e(username)}</small></span>
      </button>${followMarkup}</div>`;
  }

  function drawPeople() {
    const list = sheet.querySelector("[data-engagement-list]");
    if (!list || !current()) return;
    const matchingPeople = filterEngagementPeople(people, query);
    const rows = matchingPeople.map(personMarkup).join("");
    const tail = loading
      ? `<div class="likes-skel" aria-hidden="true"></div><div class="likes-skel" aria-hidden="true"></div>`
      : error
        ? `<div class="comment-status" role="alert">${e(error)}</div><button type="button" class="comment-retry" data-engagement-retry>Try again</button>`
        : canLoadMoreEngagementPeople(people, hasMore)
          ? `<button type="button" class="comment-retry" data-engagement-more>View more</button>`
          : "";
    const empty = query
      ? hasMore ? "No matches yet. Load more people to continue searching." : "No people match your search."
      : tab === "reposts" ? "No reposts yet." : "No likes yet.";
    const emptyMarkup = !matchingPeople.length && !loading && !error
      ? `<div class="comment-empty">${e(empty)}</div>` : "";
    list.innerHTML = emptyMarkup + rows + tail;
    list.querySelectorAll("[data-engagement-profile]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.engagementProfile;
        close();
        onProfile?.(id);
      });
    });
    list.querySelectorAll("[data-engagement-follow]").forEach(button => {
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        button.disabled = true;
        try {
          await onFollow?.(button.dataset.engagementFollow);
        } finally {
          if (current()) {
            button.disabled = false;
            drawPeople();
          }
        }
      });
    });
    list.querySelector("[data-engagement-more]")?.addEventListener("click", () => void load());
    list.querySelector("[data-engagement-retry]")?.addEventListener("click", () => void load());
  }

  async function load() {
    if (loading || !current() || tab === "views") return;
    const requestGeneration = generation;
    const currentTab = tab;
    loading = true;
    error = "";
    drawPeople();
    try {
      const response = await requestCloudApi(
        `/api/posts/${encodeURIComponent(postId)}/${currentTab}?limit=${ENGAGEMENT_PAGE_SIZE}&offset=${offset}`,
      );
      if (!current() || requestGeneration !== generation) return;
      if (api.me()?.id !== ownerId) { close(); return; }
      const key = currentTab === "reposts" ? "reposts" : "likes";
      if (!Array.isArray(response?.[key])) throw new Error(`The ${currentTab} list response was invalid.`);
      const page = response[key]
        .filter(person => person?.id && person?.username)
        .map(person => ({
          ...person,
          localId: api.cloudAuthorId(person),
          avatar: api.user(api.cloudAuthorId(person))?.avatar || person.avatar || "",
        }));
      people = mergeEngagementPeople(people, page);
      totals[currentTab] = Number.isInteger(response.total) && response.total >= 0
        ? response.total
        : totals[currentTab];
      hasMore = response.hasMore === true;
      offset = Number.isInteger(response.nextOffset) && response.nextOffset > offset
        ? response.nextOffset
        : offset + page.length;
      if (!page.length) hasMore = false;
      sheet.querySelector(`[data-engagement-count="${currentTab}"]`)?.replaceChildren(formatCount(totals[currentTab]));
      sheet.querySelector(`[data-engagement-tab="${currentTab}"]`)?.setAttribute(
        "aria-label", `${currentTab === "reposts" ? "Reposts" : "Likes"}, ${formatCount(totals[currentTab])}`,
      );
    } catch (failure) {
      if (current() && requestGeneration === generation) error = failure?.message || `${currentTab} could not load.`;
    } finally {
      if (requestGeneration === generation) {
        loading = false;
        drawPeople();
      }
    }
  }

  function selectTab(nextTab) {
    if (!validTabs.has(nextTab) || nextTab === tab) return;
    tab = nextTab;
    generation += 1;
    people = [];
    offset = 0;
    hasMore = false;
    loading = false;
    error = "";
    query = "";
    drawPanel();
    if (tab !== "views") void load();
  }

  sheet.classList.add("on");
  sheet.onclick = event => { if (event.target === sheet) close(); };
  sheet.onkeydown = event => { if (event.key === "Escape") close(); };
  drawPanel();
  sheet.querySelector("[data-post-engagement]")?.focus();
  if (tab !== "views") void load();
}
