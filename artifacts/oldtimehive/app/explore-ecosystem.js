// Unqueried Discover opens as "explore" (swipeable); any typed query opens as "search".
export function exploreViewerSource(query) {
  return String(query || "").trim() ? "search" : "explore";
}
// Cloud Explore: one server-backed surface for For You + Search.
// All results come from GET /api/discovery/explore; nothing is persisted in the browser.
import { isDefaultAvatarMediaReference } from "./story-media.js";
import { renderMentionText } from "./mention-autocomplete.js";
import { isFeedHomePost } from "./post-surfaces.js";
import { createVideoStillQueue, stillPlaceholderMarkup, bindStillPlaceholders, saveDataOn } from "./video-still.js";
const POST_TYPES = new Set(["all", "videos"]);
const CACHE_MS = 30_000;
const CACHE_MAX = 24;
const PAGE = 24;
const SORT_MODES = [["top", "For You"], ["recent", "Newest"], ["engagement", "Most interacted"], ["shuffle", "Shuffle"]];

const emptyData = () => ({
  posts: [], people: [], places: [], hashtags: [], topics: [], topicOptions: [], emergingTopics: [],
  relatedSearches: [], postTopics: new Map(), preferences: { hiddenTopics: [], personalize: true },
  correctedQuery: null,selectedTopic:null,
});

export function createExploreEcosystem(deps) {
  const { api, requestCloudApi, esc, ic, renderMediaUrl, isLocalMedia, rerender, openPostViewer, navigateToProfile,
    renderSuggestedPerson,
    selectPlace, openPlaces, toast, onTopicSelect, isActive, matchesHomeTopic = () => true } = deps;
  let owner = "";
  let query = "";
  let searchOpen = false;
  let resultsQuery = "";
  let type = "videos";
  let topic = "";
  let sort = "top";
  let shuffleSeed = "";
  let shuffleSequence = 0;
  const sentSignals=new Set();
  let state = { status: "idle", error: "", hasMore: false, nextOffset: 0, loadingMore: false, moreError: "", data: emptyData() };
  let requestId = 0;
  let timer = null;
  let started = false;
  const cache = new Map();
  let preferences = null; // latest known preferences, survives result refreshes
  let sheet = null;
  const dismissed = new Set(); // "Hide for now": in-memory only, cleared on account change/reset
  const viewedPostIds = new Set(); // session-only novelty signal; never sent to the server
  let warmed = "";
  let warmedMedia = null;
  let pageObserver=null;
  const clearWarm = () => {
    warmed = "";
    if (warmedMedia?.tagName === "VIDEO") { warmedMedia.removeAttribute("src"); try { warmedMedia.load(); } catch {} }
    else if (warmedMedia) warmedMedia.src = "";
    warmedMedia = null;
  };

  const compact = n => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(Number(n) || 0);
  const currentOwner = () => api.cloudAccountId() || "";
  const keyFor = offset => JSON.stringify([owner, query.trim().toLowerCase(), type, topic, sort,
    sort === "shuffle" ? shuffleSeed : "", offset, searchOpen && !query.trim()]);
  function nextShuffleSeed() {
    shuffleSequence += 1;
    return `${Date.now().toString(36)}-${shuffleSequence.toString(36)}`;
  }
  // Poster-less public videos: one real first-frame decode at a time, reusing cloud media URL resolution.
  const stills = createVideoStillQueue({ resolveUrl: async ref => (await import("./local-media.js")).mediaUrl(ref) });
  let unbindStills = null;
  function videoStillMarkup(post, className = "") {
    const id = String(post.id || "");
    const ref = post.media?.[0];
    return stillPlaceholderMarkup({ id, ref, owner: post.author, still: stills.get(id), error: stills.error(id), esc, className, saveData: saveDataOn() });
  }
  const mediaAttributes = (reference, ownerId) => isLocalMedia(reference)
    ? `data-local-media="${esc(reference)}" data-local-media-owner="${esc(ownerId || "")}"`
    : `src="${esc(renderMediaUrl(reference))}"`;
  function avatarMarkup(profile, ownerId, name, size = "person") {
    const reference = [profile?.avatar, profile?.avatarReference, profile?.avatarUrl]
      .find(value => value && !isDefaultAvatarMediaReference(value));
    const initial = Array.from(String(name || "").trim())[0]?.toLocaleUpperCase() || "?";
    const image = reference
      ? `<img data-xe-avatar-image ${mediaAttributes(reference, ownerId)} alt="" loading="lazy" decoding="async" />`
      : "";
    return `<span class="xe-avatar xe-avatar--${size}" aria-hidden="true"><span class="xe-avatar-initial">${esc(initial)}</span>${image}</span>`;
  }

  function syncOwner() {
    const next = currentOwner();
    if (next === owner) return;
    owner = next;
    stills.clear();
    requestId++;
    if (timer) clearTimeout(timer);
    timer = null;
    cache.clear();
    closeSheet();
    dismissed.clear(); viewedPostIds.clear(); clearWarm();
    query = ""; type = "videos"; topic = ""; sort="top"; shuffleSeed = ""; sentSignals.clear(); preferences = null; started = false;
    searchOpen = false; resultsQuery = "";
    state = { status: "idle", error: "", hasMore: false, nextOffset: 0, loadingMore: false, moreError: "", data: emptyData() };
  }

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_MS) { cache.delete(key); return null; }
    return hit.result;
  }
  function cacheSet(key, result) {
    cache.set(key, { at: Date.now(), result });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  function apply(result, append) {
    resultsQuery = query.trim();
    const incoming = api.cacheCloudExplorePosts(result.posts).filter(isFeedHomePost);
    const prev = state.data;
    const seen = new Set(append ? prev.posts.map(post => post.id) : []);
    const posts = (append ? prev.posts : []).concat(incoming.filter(post => !seen.has(post.id) && seen.add(post.id)));
    const postTopics = new Map(append ? prev.postTopics : []);
    for (const entry of result.postTopics || []) if (entry?.postId) postTopics.set(entry.postId, entry);
    const first = append ? prev : null;
    if (result.preferences) preferences = result.preferences;
    state = {
      status: "success", error: "", moreError: "", loadingMore: false,
      hasMore: result.hasMore === true, nextOffset: Number(result.nextOffset) || posts.length,
      data: {
        posts, postTopics,
        people: first ? [...prev.people,...(result.people||[]).filter(p=>!prev.people.some(old=>old.id===p.id))] : result.people || [],
        places: first ? prev.places : result.places || [],
        hashtags: first ? prev.hashtags : result.hashtags || [],
        topics: first ? prev.topics : result.topics || [],
        topicOptions: result.topicOptions || prev.topicOptions,
        emergingTopics: first ? prev.emergingTopics : result.emergingTopics || [],
        relatedSearches: first ? prev.relatedSearches : result.relatedSearches || [],
        preferences: result.preferences || prev.preferences,
        correctedQuery: first ? prev.correctedQuery : result.correctedQuery || null,
        selectedTopic:first?prev.selectedTopic:result.selectedTopic||null,
      },
    };
    if(result.selectedTopic?.id)signal(result.selectedTopic.id,query.trim()?"search":"visit");
  }
  function signal(id,kind,extra={}){
    if(!owner||preferences?.personalize===false)return;
    const key=`${owner}:${Math.floor(Date.now()/86400000)}:${id}:${kind}`;
    if(sentSignals.has(key))return;sentSignals.add(key);
    requestCloudApi("/api/discovery/topic-events",{method:"POST",body:{topicId:id,kind,...extra},timeoutMs:7000})
      .catch(error=>{sentSignals.delete(key);console.warn("[discovery signal]",error);});
  }

  function load({ append = false, force = false, immediate = true } = {}) {
    syncOwner();
    if(append && (state.loadingMore || !state.hasMore)) return;
    if (timer) clearTimeout(timer);
    timer = null;
    started = true;
    const offset = append ? state.nextOffset : 0;
    const key = keyFor(offset);
    const myOwner = owner;
    if (!force) {
      const hit = cacheGet(key);
      if (hit) {
        requestId++;
        apply(hit, append);
        if(!deps.isViewing?.())rerender();
        return;
      }
    }
    const myId = ++requestId;
    if (append) state = { ...state, loadingMore: true, moreError: "" };
    else state = { ...state, status: "loading", error: "", hasMore: false, nextOffset: 0, loadingMore: false };
    const run = async () => {
      timer = null;
      try {
        const q = query.trim().slice(0, 120);
        const requestType = type;
        const params = new URLSearchParams({ type: requestType, sort, limit: String(PAGE), offset: String(offset) });
        if (q) params.set("q", q);
        if (topic) params.set("topic", topic);
        if (sort === "shuffle" && shuffleSeed) params.set("shuffleSeed", shuffleSeed);
        const result = await requestCloudApi(`/api/discovery/explore?${params}`, { timeoutMs: 15_000 });
        if (myId !== requestId || myOwner !== currentOwner()) return;
        if (!result || !Array.isArray(result.posts)) throw new Error("Explore returned an invalid response.");
        cacheSet(key, result);
        apply(result, append);
      } catch (error) {
        if (myId !== requestId || myOwner !== currentOwner()) return;
        console.warn("[discovery results]",error);
        if (append) state = { ...state, loadingMore: false, moreError: "We couldn't load more results. Please try again." };
        else state = { ...state, status: "error", error: "We couldn't load these results right now." };
      }
      if (isActive()&&!deps.isViewing?.()) rerender();
    };
    if (immediate) return run();
    else timer = setTimeout(run, 240);
  }

  function ensure() {
    syncOwner();
    if (!started) load();
  }

  function reset() {
    pageObserver?.disconnect();pageObserver=null;
    requestId++;
    if (timer) clearTimeout(timer);
    timer = null;
    cache.clear();
    closeSheet();
    dismissed.clear(); viewedPostIds.clear(); clearWarm();
    owner = ""; query = ""; type = "videos"; topic = ""; sort="top"; shuffleSeed = ""; sentSignals.clear(); preferences = null; started = false;
    searchOpen = false; resultsQuery = "";
    state = { status: "idle", error: "", hasMore: false, nextOffset: 0, loadingMore: false, moreError: "", data: emptyData() };
  }

  // ---------- markup ----------
  function tile(post) {
    const mine = post.author === api.me()?.id;
    const rawMedia = post.media?.[0];
    const media = isDefaultAvatarMediaReference(rawMedia) ? "" : rawMedia;
    const rawPoster = post.mediaPosters?.[0];
    const poster = isDefaultAvatarMediaReference(rawPoster) ? "" : rawPoster;
    const isVideo = Boolean(media) && (post.kind === "video" || (post.mediaTypes || []).some(t => String(t).startsWith("video/")));
    const text = String(post.caption || "").trim();
    const topics = state.data.postTopics.get(post.id)?.topics || [];
    const label = text ? text.slice(0, 100) : isVideo ? "Open video post" : media ? "Open photo post" : "Open post";
    let inner;
    if (isVideo) {
      inner = poster
        ? `<img ${mediaAttributes(poster, post.author)} alt="" loading="lazy" decoding="async" />`
        : videoStillMarkup(post);
    } else if (media) {
      inner = `<img ${mediaAttributes(media, post.author)} alt="" loading="lazy" decoding="async" />`;
    } else {
      inner = `<span class="xe-text"><span class="xe-text-body">${esc(text || "Shared a post")}</span>${topics[0] ? `<small>${esc(topics[0].label)}</small>` : ""}</span>`;
    }
    const authorId = typeof post.author === "object" ? post.author?.id : post.author;
    const author = (typeof api.user === "function" && api.user(authorId)) || (typeof post.author === "object" ? post.author : {});
    const authorName = author.name || author.displayName || author.username || "Oldtime member";
    const likes = Number.isFinite(post.likeCount) ? post.likeCount : Array.isArray(post.likes) ? post.likes.length : null;
    const caption = media && text ? `<span class="xe-cap-text">${esc(text.slice(0, 80))}</span>` : "";
    const topicChips = topics.slice(0, 2).map(item =>
      `<button type="button" class="xe-cap-topic" data-xe-topic="${esc(item.id)}" aria-label="See more about ${esc(item.label)}">${esc(item.label)}</button>`
    ).join("");
    return `<article class="xe-card" aria-label="${esc(label)}"><div class="xe-tile ${isVideo ? "is-video" : media ? "is-photo" : "is-text"}">
      <button type="button" class="xe-open" data-xe-post="${esc(post.id)}" aria-label="${esc(label + (isVideo ? ", video" : ""))}">${inner}
        ${isVideo ? `<span class="xe-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg></span>` : ""}
      </button>
      ${mine ? `<button type="button" class="xe-adjust" data-xe-adjust="${esc(post.id)}" aria-label="Adjust topics for this post">Topics</button>` : ""}
    </div>
    <div class="xe-cap">${caption}<span class="xe-cap-meta"><button type="button" class="xe-cap-author" data-xe-profile="${esc(authorId)}">${avatarMarkup(author, author.id || authorId, authorName, "small")}<span>${esc(authorName)}</span></button>
      ${likes !== null && likes > 0 ? `<span class="xe-cap-likes" aria-label="${likes} likes">${ic.mediaHeartOn}${compact(likes)}</span>` : ""}
      ${mine ? "" : `<button type="button" class="xe-cap-more" data-xe-why="${esc(post.id)}" aria-label="Why this post and Not interested">${ic.more}</button>`}</span>${topicChips ? `<div class="xe-cap-topics" aria-label="Post topics">${topicChips}</div>` : ""}</div></article>`;
  }

  function videoPreviewRailMarkup(limit = 12) {
    if (searchOpen || query.trim() || topic) return "";
    const count = Math.max(0, Math.floor(Number(limit) || 12));
    const videos = state.data.posts.filter(post => {
      const media = post.media?.[0];
      return Boolean(media) && !isDefaultAvatarMediaReference(media) &&
        (post.kind === "video" || (post.mediaTypes || []).some(value => String(value).startsWith("video/")));
    }).slice(0, count);
    if (!videos.length) return "";
    const cards = videos.map(post => {
      const rawPoster = post.mediaPosters?.[0];
      const poster = isDefaultAvatarMediaReference(rawPoster) ? "" : rawPoster || "";
      const preview = poster
        ? `<img class="discovery-video-poster" ${mediaAttributes(poster, post.author)} alt="" loading="lazy" decoding="async" />`
        : videoStillMarkup(post, "discovery-video-poster");
      const authorId = typeof post.author === "object" ? post.author?.id : post.author;
      const author = (typeof api.user === "function" ? api.user(authorId) : null) || (typeof post.author === "object" ? post.author : {});
      const authorName = author.displayName || author.name || author.username || "Oldtime member";
      const caption = String(post.caption || post.text || "").trim();
      const likes = Array.isArray(post.likes) ? post.likes.length : Number(post.likeCount ?? 0);
      const likesMarkup = Number.isFinite(likes) && likes > 0
        ? `<span class="places-post-stats" aria-label="${compact(likes)} likes"><span aria-hidden="true">♡</span> ${compact(likes)}</span>`
        : "";
      return `<article class="discovery-video-card places-post">
        <button type="button" class="places-post-main discovery-video-open" data-xe-post="${esc(post.id)}" aria-label="Open video by ${esc(authorName)}">
          <span class="places-post-media">
            ${preview}
            <span class="places-post-type" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg></span>
          </span>
        </button>
        <div class="places-post-detail">
          ${caption ? `<p class="places-post-caption">${renderMentionText(caption, { tag: "span" })}</p>` : ""}
          <div class="places-post-byline">
            <button type="button" class="places-post-author" data-xe-profile="${esc(authorId)}">
              ${avatarMarkup(author, author.id || authorId, authorName, "small")}
              <span>${esc(authorName)}</span>
            </button>
            ${likesMarkup}
          </div>
        </div>
      </article>`;
    }).join("");
    return `<section class="discovery-video-rail" aria-label="Video previews"><div class="discovery-video-track">${cards}</div></section>`;
  }

  function personRow(person, card = true) {
    const profile = person.profile || person;
    if (card && typeof renderSuggestedPerson === "function") {
      return renderSuggestedPerson({
        ...person,
        profile,
      });
    }
    const id = api.cloudAuthorId(profile);
    const name = profile.displayName || profile.username || "Oldtime member";
    return `<button type="button" class="xe-person" data-xe-profile="${esc(id)}">
      ${avatarMarkup(profile, id, name)}
      <span class="xe-person-copy"><b>${esc(name)}</b><small>@${esc(profile.username || "member")}</small></span>
    </button>`;
  }

  function placeRow(item) {
    const p = item.place || {};
    return `<button type="button" class="xe-row" data-xe-place="${esc(p.id)}" data-place-label="${esc(p.label || p.name || "")}"
      data-place-source="${esc(p.source || "")}" data-place-lat="${esc(p.lat ?? "")}" data-place-lon="${esc(p.lon ?? "")}">
      <span class="xe-row-main"><b>${esc(p.label || p.name || "Place")}</b><small>${compact(item.postCount)} public ${item.postCount === 1 ? "post" : "posts"}</small></span><i aria-hidden="true">›</i></button>`;
  }
  function topicCard(item) {
    const count = Number(item.postCount) || 0;
    const creators = Number(item.creatorCount) || 0;
    const detail = count ? `${compact(count)} posts${creators ? ` · ${compact(creators)} creators` : ""}` : "Public topic";
    const label = item.label || item.id || "Topic";
    return `<button type="button" class="xe-topic-card" data-xe-topic="${esc(item.id)}" aria-label="Open ${esc(label)} topic">
      <span class="xe-topic-card-copy"><b>${esc(label)}</b><small>${detail}</small></span><i aria-hidden="true">›</i></button>`;
  }
  function hashtagRow(item) {
    return `<button type="button" class="xe-row" data-xe-hashtag="${esc(item.tag)}">
      <span class="xe-row-main"><b>#${esc(item.tag)}</b><small>${compact(item.postCount)} ${item.postCount === 1 ? "post" : "posts"}</small></span><i aria-hidden="true">›</i></button>`;
  }
  const section = (title, inner) => `<section class="xe-section"><h2>${esc(title)}</h2>${inner}</section>`;

  function diversifySearchPosts(posts, searchQuery) {
    const normalized = String(searchQuery || "").trim().toLowerCase();
    if (!normalized || posts.length < 2) return posts;
    const terms = normalized.split(/\s+/).filter(Boolean);
    const interests = (api.me()?.interests || []).map(value => String(value).toLowerCase()).filter(Boolean);
    const candidates = posts.map((post, index) => {
      const caption = String(post.caption || post.text || "").toLowerCase();
      const tags = (post.tags || []).map(tag => String(typeof tag === "object" ? tag.label || tag.name || "" : tag).replace(/^#/, "").toLowerCase()).filter(Boolean);
      const authorId = typeof post.author === "object" ? post.author?.id : post.author;
      const author = (api.user && api.user(authorId)) || (typeof post.author === "object" ? post.author : {});
      const authorText = `${author?.name || ""} ${author?.displayName || ""} ${author?.username || ""}`.toLowerCase();
      const placeText = String(post.place?.label || post.place?.name || "").toLowerCase();
      const searchable = `${caption} ${tags.join(" ")} ${authorText} ${placeText}`;
      let score = caption.includes(normalized) || placeText.includes(normalized) || authorText.includes(normalized) ? 8 : 0;
      for (const term of terms) {
        if (caption.includes(term)) score += 2;
        if (tags.some(tag => tag.includes(term))) score += 3;
        if (placeText.includes(term) || authorText.includes(term)) score += 2;
      }
      for (const interest of interests) if (searchable.includes(interest)) score += 1.5;
      const created = Date.parse(post.createdAt || post.created || "") || Number(post.createdAt || post.created || 0);
      const ageHours = created > 0 ? Math.max(0, (Date.now() - created) / 3_600_000) : 168;
      score += Math.max(0, 1 - ageHours / 168);
      const engagement = Number(post.likeCount ?? post.likes?.length ?? 0) +
        Number(post.saveCount ?? post.savedCount ?? 0);
      score += Math.min(1.25, Math.log1p(Math.max(0, engagement)) / 4);
      if (viewedPostIds.has(String(post.id))) score -= 2.5;
      return { post, index, score, authorId: String(authorId || ""), tags };
    });
    const ranked = [];
    while (candidates.length) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        let score = candidate.score - candidate.index * 0.0001;
        const recent = ranked.slice(-2);
        if (candidate.authorId && recent.some(item => item.authorId === candidate.authorId)) score -= 2.5;
        if (candidate.tags.some(tag => recent.some(item => item.tags.includes(tag)))) score -= 1.25;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      ranked.push(candidates.splice(bestIndex, 1)[0]);
    }
    return ranked.map(item => item.post);
  }

  function markup({ homeTopic = "all", searching = false } = {}) {
    syncOwner();
    if (searchOpen !== searching) {
      searchOpen = searching;
      started = false;
      if (searching && !query.trim()) type = "all";
      else if (!searching && !query.trim()) type = "videos";
    }
    ensure();
    const q = query.trim();
    const d = resultsQuery === q ? state.data : emptyData();
    const loading = state.status === "loading";
    const input = `<div class="xe-bar"><label class="xe-search">${ic.search}<input class="search discovery-search" id="q" type="search" maxlength="120" placeholder="Search Oldtime" value="${esc(query)}" aria-label="Search Oldtime" autocomplete="off" /></label></div>`;
    let body = "";
    if (state.status === "error") {
      body = `<div class="xe-state" role="alert">${esc(state.error)} <button type="button" class="xe-link" data-xe-retry>Try again</button></div>`;
    } else if (loading && !d.posts.length && !d.people.length && !d.places.length && !d.hashtags.length) {
      body = `<div class="xe-loading" role="status">Loading Explore…</div>`;
    } else {
      const parts = [];
      const matchesType = post => {
        const video = post.kind === "video" || (post.mediaTypes || []).some(value => String(value).startsWith("video/"));
        const hasMedia = Array.isArray(post.media) && post.media.length > 0;
        if (type === "videos") return video && hasMedia;
        if (type === "all") return q ? hasMedia || Boolean(String(post.caption || post.text || "").trim()) : video && hasMedia;
        return false;
      };
      const topicPosts = d.posts.filter(post =>
        !dismissed.has(post.id) && matchesType(post) && (q || matchesHomeTopic(post, homeTopic)));
      const visualDiscovery = !q && !topic && type === "videos";
      const visiblePosts = visualDiscovery
        ? topicPosts.filter(post => Array.isArray(post.media) && post.media.length > 0)
        : q && POST_TYPES.has(type) ? diversifySearchPosts(topicPosts, q) : topicPosts;
      if (d.correctedQuery && d.correctedQuery.toLowerCase() !== q.toLowerCase()) {
        parts.push(`<p class="xe-note" role="status">Showing results for <button type="button" class="xe-link" data-xe-search="${esc(d.correctedQuery)}">${esc(d.correctedQuery)}</button></p>`);
      }
      if (!q && !topic && (type === "videos" || type === "all") && d.emergingTopics.length) {
        parts.push(section(type === "all" ? "Trending topics" : "Emerging now", `<div class="xe-emerging">${d.emergingTopics.map(t =>
          `<button type="button" class="xe-row" data-xe-search="${esc(t.label)}"><span class="xe-row-main"><b>${esc(t.label)}</b><small>${compact(t.postCount)} posts · ${compact(t.creatorCount)} creators</small></span><i aria-hidden="true">›</i></button>`).join("")}</div>`));
      }
      const showAll = type === "all";
      if (searchOpen && !q && showAll && d.people.length) {
        parts.push(section("Suggested names", `<div class="xe-people-list xe-search-name-grid">${d.people.map(person => personRow(person, false)).join("")}</div>`));
      }
      if (q && (showAll || type === "people") && d.people.length) {
        const peopleClass = showAll ? "xe-people-list xe-search-name-grid" : "xe-people-list xe-people-card-grid";
        parts.push(section("People", `<div class="${peopleClass}">${(showAll ? d.people.slice(0, 8) : d.people)
          .map(person => personRow(person, !showAll)).join("")}</div>`));
      }
      if (q && (showAll || type === "hashtags") && (d.topics.length || d.hashtags.length)) {
        const selectedId = String(d.selectedTopic?.id || "");
        const topics = (showAll ? d.topics.slice(0, 4) : d.topics)
          .filter(item => !selectedId || String(item.id) !== selectedId).map(topicCard);
        const hashtags = (showAll ? d.hashtags.slice(0, 4) : d.hashtags).map(hashtagRow);
        if (topics.length || hashtags.length) {
          parts.push(section("Topics", `${topics.length ? `<div class="xe-topic-grid">${topics.join("")}</div>` : ""}${hashtags.join("")}`));
        }
      }
      if (q && (showAll || type === "places") && d.places.length) {
        parts.push(section("Places", `${(showAll ? d.places.slice(0, 3) : d.places).map(placeRow).join("")}<button type="button" class="xe-link xe-open-places" data-xe-open-places>Explore all places</button>`));
      }
      if (!q && type === "people" && d.people.length) parts.push(section("People", `<div class="xe-people-list xe-people-card-grid" aria-label="People">${d.people.map(person => personRow(person)).join("")}</div>`));
      if (!q && (type === "hashtags" || showAll) && (d.topics.length || d.hashtags.length)) {
        const topics = (showAll ? d.topics.slice(0, 4) : d.topics).map(topicCard);
        const hashtags = (showAll ? d.hashtags.slice(0, 4) : d.hashtags).map(hashtagRow);
        parts.push(section("Topics", `${topics.length ? `<div class="xe-topic-grid">${topics.join("")}</div>` : ""}${hashtags.join("")}`));
      }
      if (!q && (type === "places" || showAll) && d.places.length) {
        parts.push(section("Places", `${(showAll ? d.places.slice(0, 3) : d.places).map(placeRow).join("")}<button type="button" class="xe-link xe-open-places" data-xe-open-places>Explore all places</button>`));
      }
      if (POST_TYPES.has(type) && visiblePosts.length) {
        const heading = q ? (showAll ? "Videos" : "Video results") : !q && type === "videos" ? "Videos for you" : showAll ? "Videos for you" : "";
        const postsToShow = showAll ? visiblePosts.slice(0, 6) : visiblePosts;
        parts.push(`${heading ? `<h2 class="xe-grid-title">${heading}</h2>` : ""}<div class="xe-grid ${loading ? "is-refreshing" : ""}" aria-label="Search videos">${postsToShow.map(tile).join("")}</div>`);
      }
      if (q && d.relatedSearches.length) {
        parts.push(section("Related searches", `<div class="xe-chips xe-related">${d.relatedSearches.map(s =>
          `<button type="button" class="xe-chip" data-xe-search="${esc(s)}">${esc(s)}</button>`).join("")}</div>`));
      }
      const anything = POST_TYPES.has(type) ? visiblePosts.length : type === "people" ? d.people.length : type === "hashtags" ? d.hashtags.length + d.topics.length : d.places.length;
      const anyAll = showAll && (d.people.length || d.topics.length || d.hashtags.length || d.places.length || (!q && d.emergingTopics.length));
      if (!loading && !anything && !anyAll) {
        parts.push(`<div class="xe-empty"><b>${q ? `Nothing found for “${esc(q)}”` : type === "videos" ? "No public videos yet" : "Nothing to show yet"}</b><p>${q
          ? "Try another name, topic, video, or place." : type === "all" ? "Search for a name, topic, video, or place." : "Try another search."}</p></div>`);
      }
      body = parts.join("");
      if (loading && d.posts.length) body += `<div class="xe-state" role="status">Refreshing your results…</div>`;
      if (state.loadingMore) body += `<div class="xe-more-skeletons" aria-label="Loading more posts" role="status"><span></span><span></span><span></span></div>`;
      if (state.moreError) body += `<div class="xe-state" role="alert">${esc(state.moreError)} <button type="button" class="xe-link" data-xe-more>Try again</button></div>`;
      if (state.hasMore && (POST_TYPES.has(type)||type==="people")) body += `<button type="button" class="xe-more" data-xe-more ${state.loadingMore ? "disabled" : ""}>${state.loadingMore ? "Loading more…" : "Keep exploring"}</button>`;
    }
    return {
      input,
      body: `<div class="xe">${d.selectedTopic?topicPage(d.selectedTopic):""}${body}</div>`,
      topics: state.data.topics,
      topicOptions: state.data.topicOptions,
      hiddenTopics: preferences?.hiddenTopics || state.data.preferences.hiddenTopics || [],
      activeTopic: topic,
    };
  }
  function topicPage(selected){
    const selectedTab=sort==="recent"?"recent":"top";
    return `<section class="xe-topic-page" aria-label="${esc(selected.label)} topic" data-testid="automatic-topic-page">
      <div class="xe-topic-heading"><div><h2>${esc(selected.label)}</h2><p>${compact(selected.postCount)}${selected.postCountIsLowerBound?"+":""} posts · ${compact(selected.creatorCount)} people</p></div></div>
      <nav class="xe-topic-tabs" role="tablist" aria-label="Topic video order">${[["top","Top"],["recent","Latest"]]
        .map(([id,label])=>`<button class="xe-chip ${id===selectedTab?"on":""}" role="tab" aria-selected="${id===selectedTab}" data-xe-topic-tab="${id}">${label}</button>`).join("")}</nav>
      ${selected.relatedTopics?.length?`<section class="xe-topic-related-section" aria-label="Related topics"><h3>Related topics</h3>
        <div class="xe-topic-grid">${selected.relatedTopics.map(topicCard).join("")}</div></section>`:""}</section>`;
  }

  // ---------- interactions ----------
  function setQuery(value, { immediate = false } = {}) {
    syncOwner();
    if (!searchOpen) {
      searchOpen = true;
      type = "all";
    }
    query = String(value || "").slice(0, 120);
    topic="";sort="top";shuffleSeed="";
    load({ immediate, force: false });
  }

  function clearSearch() {
    searchOpen = false;
    query = ""; type = "videos"; topic = ""; sort = "top"; shuffleSeed = "";
    load({ immediate: true });
  }

  function openSearch(value) {
    syncOwner();
    searchOpen = true;
    if (typeof value === "string") query = value.slice(0, 120);
    type = "all"; topic = ""; sort = "top"; shuffleSeed = "";
    load({ immediate: true });
  }

  function setTopic(value) {
    const next = String(value || "").trim();
    if (topic === next && type === "videos") return false;
    topic = next;
    query="";sort="top";shuffleSeed="";
    type = "videos";
    load({ force: false });
    return true;
  }

  function setSort(value) {
    const next = String(value || "");
    if (!SORT_MODES.some(([id]) => id === next)) return false;
    if (sort === next && next !== "shuffle") return false;
    sort = next;
    shuffleSeed = next === "shuffle" ? nextShuffleSeed() : "";
    load({ force: true });
    rerender();
    return true;
  }
  function selectTopic(value) {
    const next = String(value || "").trim();
    if (!next || !setTopic(next)) return;
    onTopicSelect?.(next);
    rerender();
  }

  function bind(root, { bindQuery = true } = {}) {
    root.querySelectorAll("[data-xe-topic-tab]").forEach(button=>button.onclick=()=>{
      const tab=button.dataset.xeTopicTab;
      type="videos";
      sort=tab==="recent"?"recent":"top";
      shuffleSeed="";
      load();rerender();
    });
    root.querySelectorAll("[data-xe-sort]").forEach(button => button.onclick = () => {
      setSort(button.dataset.xeSort);
    });
    pageObserver?.disconnect();
    pageObserver=null;
    const more=root.querySelector("[data-xe-more]");
    if(more && !state.loadingMore && !state.moreError && typeof IntersectionObserver==="function"){
      pageObserver=new IntersectionObserver(entries=>{
        if(!more.isConnected){pageObserver?.disconnect();return;}
        if(entries.some(entry=>entry.isIntersecting)&&isActive()){
          pageObserver?.disconnect();
          const pending = load({append:true});
          rerender();
          void pending;
        }
      },{root:root.querySelector(".search-screen .page"),rootMargin:"500px"});
      pageObserver.observe(more);
    }
    unbindStills?.();
    unbindStills = bindStillPlaceholders(root, stills, { saveData: saveDataOn(), esc });
    root.querySelectorAll("[data-xe-avatar-image]").forEach(image => {
      const hideBrokenImage = () => { image.hidden = true; };
      image.addEventListener("error", hideBrokenImage, { once: true });
      if (image.complete && image.currentSrc && !image.naturalWidth) hideBrokenImage();
    });
    const input = bindQuery ? root.querySelector("#q") : null;
    if (input) {
      input.oninput = event => {
        query = event.target.value.slice(0, 120);
        // Debounced; the field is never re-created while typing.
        requestId++;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; load({ immediate: true }); }, 240);
      };
    }
    root.querySelectorAll("[data-xe-open-places]").forEach(button => button.onclick = () => openPlaces?.(query));
    root.querySelectorAll("[data-xe-topic]").forEach(b => b.onclick = () => selectTopic(b.dataset.xeTopic));
    root.querySelectorAll("[data-xe-search]").forEach(b => b.onclick = () => {
    query = b.dataset.xeSearch; type = "videos"; topic = "";
      load();
      rerender();
      const el = root.ownerDocument.querySelector("#q");
      if (el) el.value = query;
    });
    root.querySelectorAll("[data-xe-hashtag]").forEach(b => b.onclick = () => {
      query = `#${b.dataset.xeHashtag}`; type = "videos"; topic = "";
      load();
      rerender();
    });
    root.querySelectorAll("[data-xe-retry]").forEach(b => b.onclick = () => load({ force: true }));
    root.querySelectorAll("[data-xe-more]").forEach(b => b.onclick = () => {
      if (state.loadingMore) return;
      const pending = load({ append: true, force: true });
      rerender();
      void pending;
    });
    root.querySelectorAll("[data-xe-profile]").forEach(b => b.onclick = () => navigateToProfile(b.dataset.xeProfile));
    root.querySelectorAll("[data-xe-place]").forEach(b => b.onclick = () => selectPlace({
      id: b.dataset.xePlace, label: b.dataset.placeLabel, source: b.dataset.placeSource,
      lat: b.dataset.placeLat, lon: b.dataset.placeLon,
    }));
    root.querySelectorAll("[data-xe-post]").forEach(b => b.onclick = async () => {
      const id = b.dataset.xePost;
      viewedPostIds.add(String(id));
      openPostViewer(id, "", { source: exploreViewerSource(query), searchQuery: query });
    });
    root.querySelectorAll("[data-xe-adjust]").forEach(b => b.onclick = () => openTopicsSheet(b.dataset.xeAdjust, b));
    root.querySelectorAll("[data-xe-why]").forEach(b => b.onclick = event => { event.stopPropagation(); openWhySheet(b.dataset.xeWhy, b); });
    root.querySelectorAll("[data-xe-tune]").forEach(b => b.onclick = () => openTuneSheet(b));
  }

  // ---------- sheets ----------
  function closeSheet() {
    if (!sheet) return;
    const { el, onKey, opener } = sheet;
    sheet = null;
    document.removeEventListener("keydown", onKey, true);
    el.remove();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  function openSheet(title, intro, content, opener) {
    closeSheet();
    const el = document.createElement("div");
    el.className = "xe-backdrop";
    el.innerHTML = `<div class="xe-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="xe-sheet-head"><h2>${esc(title)}</h2><button type="button" class="xe-sheet-close" data-xe-close aria-label="Close">×</button></div>
      <p class="xe-sheet-intro">${esc(intro)}</p>${content}</div>`;
    document.body.appendChild(el);
    const onKey = event => { if (event.key === "Escape") { event.stopPropagation(); closeSheet(); } };
    document.addEventListener("keydown", onKey, true);
    sheet = { el, onKey, opener };
    el.onclick = event => { if (event.target === el) closeSheet(); };
    el.querySelector("[data-xe-close]").onclick = closeSheet;
    el.querySelector("input,button.xe-save")?.focus({ preventScroll: true });
    return el;
  }

  function openTuneSheet(opener) {
    const prefs = preferences || state.data.preferences;
    const hidden = new Set(prefs.hiddenTopics || []);
    const options = state.data.topicOptions || [];
    const el = openSheet("Customize Discover", "Choose which topics you see more or less. These settings are saved to your account.", `
      <label class="xe-switch"><span><b>Personalize Discover and For You</b><small>Topic searches and actions shape recommendations. Turn off to stop topic signals from shaping For You; selected profile interests still guide it.</small></span>
        <input type="checkbox" role="switch" data-xe-personalize ${prefs.personalize ? "checked" : ""} /></label>
      <h3>Show less of</h3>
      ${options.length ? `<div class="xe-options">${options.map(o => `<label class="xe-check"><input type="checkbox" value="${esc(o.id)}" ${hidden.has(o.id) ? "checked" : ""} /><span>${esc(o.label)}</span></label>`).join("")}</div>`
        : `<p class="xe-sheet-intro">Topics appear here once public posts have them.</p>`}
      <p class="xe-sheet-error" role="alert" hidden></p>
      <div class="xe-sheet-actions"><button type="button" class="xe-ghost" data-xe-close2>Cancel</button><button type="button" class="xe-save">Save</button></div>`, opener);
    el.querySelector("[data-xe-close2]").onclick = closeSheet;
    const save = el.querySelector(".xe-save");
    save.onclick = async () => {
      const body = {
        hiddenTopics: [...el.querySelectorAll(".xe-options input:checked")].map(i => i.value),
        personalize: el.querySelector("[data-xe-personalize]").checked,
      };
      const myOwner = owner;
      save.disabled = true; save.textContent = "Saving…";
      try {
        const result = await requestCloudApi("/api/discovery/preferences", { method: "PUT", body, timeoutMs: 15_000 });
        if (myOwner !== currentOwner()) return;
        preferences = result?.preferences || body;
        cache.clear();
        closeSheet();
        load({ force: true });
        rerender();
        toast("Discover updated.");
      } catch (error) {
        save.disabled = false; save.textContent = "Save";
        const err = el.querySelector(".xe-sheet-error");
        err.hidden = false; err.textContent = error?.message || "Preferences could not be saved.";
      }
    };
  }

  function openWhySheet(postId, opener) {
    const topics = state.data.postTopics.get(postId)?.topics || [];
    const prefs = preferences || state.data.preferences;
    const hidden = new Set(prefs.hiddenTopics || []);
    const el = openSheet("Why you're seeing this", topics.length
      ? "This public post matched these topics. Discover ranks recent public posts by topic" + (prefs.personalize ? " and the interests on your profile." : ". Personal ranking is off.")
      : "This is a recent public post. It did not match any specific topic.", `
      ${topics.length ? `<div class="xe-why-topics">${topics.map(t => `<span>${esc(t.label)}</span>`).join("")}</div>` : ""}
      <h3>Not interested</h3>
      <p class="xe-sheet-intro">"Show less about" is saved to your account and shapes Discover going forward.</p>
      <button type="button" class="xe-why-row" data-xe-hide-post>Hide for now<small>Temporary: only until you reload or switch accounts. Not saved to your account.</small></button>
      ${topics.filter(t => !hidden.has(t.id)).map(t => `<button type="button" class="xe-why-row" data-xe-hide-topic="${esc(t.id)}">Show less about ${esc(t.label)}<small>Saved to your account. Undo any time in Customize feed.</small></button>`).join("")}
      <p class="xe-sheet-error" role="alert" hidden></p>`, opener);
    el.querySelector("[data-xe-hide-post]").onclick = () => {
      dismissed.add(postId); closeSheet(); rerender(); toast("Hidden until you reload.");
    };
    el.querySelectorAll("[data-xe-hide-topic]").forEach(b => b.onclick = async () => {
      const myOwner = owner;
      const body = { hiddenTopics: [...new Set([...hidden, b.dataset.xeHideTopic])], personalize: prefs.personalize !== false };
      b.disabled = true;
      try {
        const result = await requestCloudApi("/api/discovery/preferences", { method: "PUT", body, timeoutMs: 15_000 });
        if (myOwner !== currentOwner()) return;
        preferences = result?.preferences || body;
        dismissed.add(postId);
        cache.clear(); closeSheet(); load({ force: true }); rerender();
        toast("You'll see less of this topic.");
      } catch (error) {
        b.disabled = false;
        const err = el.querySelector(".xe-sheet-error");
        err.hidden = false; err.textContent = error?.message || "Preference could not be saved.";
      }
    });
  }

  function openHomeWhySheet(postId, opener) {
    if (!api.post(postId)) return;
    openSheet("Why you're seeing this post",
      "Your For You feed shows public posts from creators across Oldtime, ranked around your interests and activity.",
      `<p class="xe-sheet-intro">Choose Not interested from the post menu if you want fewer recommendations like this.</p>`,
      opener);
  }

  // Next post in the current Discover order, skipping hidden ones.
  function neighbor(id, direction = 1) {
    syncOwner();
    const list = state.data.posts.filter(post => !dismissed.has(post.id));
    const index = list.findIndex(post => post.id === id);
    return index >= 0 ? list[index + (direction < 0 ? -1 : 1)]?.id || "" : "";
  }
  const nextAfter = id => neighbor(id, 1);
  const previousBefore = id => neighbor(id, -1);
  async function ensureNext(id){
    if(!nextAfter(id)&&state.hasMore&&!state.loadingMore)await load({append:true});
    if(state.moreError)throw new Error(state.moreError);
    return nextAfter(id);
  }
  // Bounded warm-up: only the single next post's still image (photo or video poster) is fetched.
  function preloadNext(id) {
    const nextId = nextAfter(id);
    if (!nextId || warmed === nextId) return nextId;
    clearWarm(); // at most ONE warmed media at any time
    if (typeof navigator !== "undefined" && navigator.connection?.saveData) return nextId;
    const post = state.data.posts.find(item => item.id === nextId);
    const isVideo = post?.kind === "video" || (post?.mediaTypes || []).some(t => String(t).startsWith("video/"));
    const ref = post?.media?.[0];
    if (!ref || isLocalMedia(ref) || isDefaultAvatarMediaReference(ref) || typeof document === "undefined") return nextId;
    warmed = nextId;
    if (isVideo) {
      // Metadata only: detached, muted, never played, so no offscreen playback or audio.
      const video = document.createElement("video");
      video.muted = true; video.preload = "metadata"; video.playsInline = true;
      video.src = renderMediaUrl(ref);
      warmedMedia = video;
    } else {
      const img = new Image(); img.decoding = "async"; img.src = renderMediaUrl(ref);
      warmedMedia = img;
    }
    return nextId;
  }

  function openTopicsSheet(postId, opener) {
    const entry = state.data.postTopics.get(postId);
    const topics = entry?.topics || [];
    const excluded = entry?.excludedTopics || [];
    const label = id => topics.find(t => t.id === id)?.label || state.data.topicOptions.find(o => o.id === id)?.label || id;
    const rows = [...topics.map(t => ({ id: t.id, label: t.label, on: true })),
      ...excluded.filter(id => !topics.some(t => t.id === id)).map(id => ({ id, label: label(id), on: false }))];
    const el = openSheet("Adjust topics", "Topics come from the words, hashtags and place in your post. Uncheck any that don’t fit.", rows.length
      ? `<div class="xe-options">${rows.map(r => `<label class="xe-check"><input type="checkbox" value="${esc(r.id)}" ${r.on ? "checked" : ""} /><span>${esc(r.label)}</span></label>`).join("")}</div>`
      : `<p class="xe-sheet-intro">No topics were found in this post’s text.</p>`, opener);
    el.querySelector(".xe-sheet-intro").insertAdjacentHTML("afterend", "");
    el.querySelector(".xe-sheet").insertAdjacentHTML("beforeend", `<p class="xe-sheet-error" role="alert" hidden></p>
      <div class="xe-sheet-actions"><button type="button" class="xe-ghost" data-xe-close2>Cancel</button><button type="button" class="xe-save" ${rows.length ? "" : "disabled"}>Save</button></div>`);
    el.querySelector("[data-xe-close2]").onclick = closeSheet;
    const save = el.querySelector(".xe-save");
    save.onclick = async () => {
      const excludedTopics = [...el.querySelectorAll(".xe-options input:not(:checked)")].map(i => i.value);
      const myOwner = owner;
      save.disabled = true; save.textContent = "Saving…";
      try {
        const result = await requestCloudApi(`/api/discovery/posts/${encodeURIComponent(postId)}/topics`, {
          method: "PUT", body: { excludedTopics }, timeoutMs: 15_000 });
        if (myOwner !== currentOwner()) return;
        if (result?.postId) state.data.postTopics.set(result.postId, result);
        cache.clear();
        closeSheet();
        load({ force: true });
        rerender();
        toast("Topics updated.");
      } catch (error) {
        save.disabled = false; save.textContent = "Save";
        const err = el.querySelector(".xe-sheet-error");
        err.hidden = false; err.textContent = error?.message || "Topics could not be saved.";
      }
    };
  }

  return {
    markup, bind, reset, ensure, closeSheet, setQuery, clearSearch, openSearch,
    isSearching: () => !!query.trim(), setTopic, setSort, currentSort: () => sort, currentTopic: () => topic,
    sortModes: () => SORT_MODES.map(([value, label]) => [value, label]),
    videoPreviewRailMarkup, nextAfter, previousBefore, neighbor, preloadNext, ensureNext, videoStillMarkup,
    openWhy: openWhySheet, openHomeWhy: openHomeWhySheet,
  };
}
