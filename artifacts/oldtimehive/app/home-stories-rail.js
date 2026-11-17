const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_INTERACTION_BOOST_MS = 30 * 60 * 1000;

function idOf(value) {
  if (value && typeof value === "object") value = value.id;
  return value == null ? "" : String(value);
}

function timestamp(story) {
  const value = Number(story?.created ?? story?.createdAt ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Build Home's story bubbles from the already-loaded, privacy-filtered story cache. */
export function buildHomeStoryGroups({
  stories = [],
  me,
  user = () => null,
  isStoryActive = () => false,
  canSeeStory = () => false,
  blocked = () => false,
  interactionAt = () => 0,
  now = Date.now(),
  limit = 30,
} = {}) {
  if (!me?.id) return [];
  const ownerId = String(me.id);
  const following = new Set(Array.isArray(me.following) ? me.following.map(String) : []);
  const groups = new Map();

  for (const story of Array.isArray(stories) ? stories : []) {
    const authorId = idOf(story?.author);
    const storyId = idOf(story?.id);
    if (!authorId || !storyId || !isStoryActive(story)) continue;
    if (authorId !== ownerId && !following.has(authorId)) continue;
    if (authorId !== ownerId) {
      let isBlocked = true;
      try { isBlocked = blocked(ownerId, authorId) || blocked(authorId, ownerId); }
      catch { isBlocked = true; }
      if (isBlocked) continue;
    }
    let visible = false;
    try { visible = canSeeStory(story) === true; } catch { visible = false; }
    if (!visible) continue;

    let group = groups.get(authorId);
    if (!group) {
      const person = authorId === ownerId ? me : user(authorId);
      if (!person && authorId !== ownerId) continue;
      group = {
        authorId,
        isMine: authorId === ownerId,
        name: authorId === ownerId
          ? "Your story"
          : String(person?.name || person?.displayName || person?.username || "Member"),
        person: person || me,
        items: [],
      };
      groups.set(authorId, group);
    }
    const created = timestamp(story);
    if (group.items.some(item => item.id === storyId)) continue;
    group.items.push({
      id: storyId,
      authorId,
      created,
      fresh: created > 0 && now >= created && now - created < DAY_MS,
      text: String(story.text || story.caption || "").trim(),
    });
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      items: group.items.sort((a, b) => b.created - a.created),
      freshCount: group.items.filter(item => item.fresh).length,
      latest: Math.max(0, ...group.items.map(item => item.created)),
      interaction: (() => {
        try {
          const value = Number(interactionAt(group.authorId));
          return Number.isFinite(value) && value > 0 ? value : 0;
        } catch { return 0; }
      })(),
    }))
    .map(group => {
      const age = now - group.interaction;
      const boost = group.interaction > 0 && age >= 0 && age < DAY_MS
        ? MAX_INTERACTION_BOOST_MS * (1 - age / DAY_MS)
        : 0;
      return { ...group, orderScore: group.latest + boost };
    })
    .sort((a, b) => Number(b.isMine) - Number(a.isMine) ||
      b.orderScore - a.orderScore || b.latest - a.latest || a.authorId.localeCompare(b.authorId))
    .slice(0, Math.max(1, limit));
}

export function renderHomeStoryRail(groups, {
  esc = value => String(value ?? ""),
  avatarMarkup = () => "",
} = {}) {
  if (!Array.isArray(groups) || !groups.length) return "";
  const bubbles = groups.map(group => {
    const newest = group.items[0];
    const label = `${group.name}, ${group.items.length} ${group.items.length === 1 ? "story" : "stories"}${group.freshCount ? `, ${group.freshCount} new` : ""}. Open newest Story`;
    return `<button type="button" class="home-story-bubble" data-home-story-group="${esc(group.authorId)}" data-home-story-open="${esc(newest?.id || "")}" aria-label="${esc(label)}">
      <span class="home-story-avatar">${avatarMarkup(group.person)}${group.freshCount ? '<span class="home-story-new">New</span>' : ""}</span>
    </button>`;
  }).join("");
  return `<div class="home-stories-inline" aria-label="Stories from people you follow">
    <div class="home-stories-track" role="group" aria-label="Swipe through Stories">${bubbles}</div>
  </div>`;
}
