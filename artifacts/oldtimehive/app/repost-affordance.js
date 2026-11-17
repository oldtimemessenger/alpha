import { api } from "./store.js";
import { icon } from "./icons.js";

const note = (post, id) => String(post?.repostNotes?.[id] || "").trim().slice(0, 140);

function pick(post, account) {
  const me = account.me();
  const ids = [...new Set(Array.isArray(post?.reposts) ? post.reposts : [])];
  if (me && (post?.repostedByMe || ids.includes(me.id))) return { mine: true, user: me };
  const candidates = Array.isArray(post?.repostedByPreview)
    ? post.repostedByPreview
    : Array.isArray(post?.repostedByFriends) ? post.repostedByFriends : [];
  for (const person of candidates) {
    const id = String(person?.id || "");
    const user = account.user(id) || person;
    if (id && user?.username && account.canSee(id)) return { mine: false, user };
  }
  for (const id of ids) {
    if (id === me?.id) continue;
    const u = account.user(id);
    if (u && account.canSee(id)) return { mine: false, user: u };
  }
  return null;
}

export function renderRepostAffordance(post, { esc, account = api, renderIcon = icon, confirming = false } = {}) {
  if (!post?.id) return "";
  const me = account.me();
  const mine = Boolean(me && (post.repostedByMe || (post.reposts || []).includes(me.id)));
  const hasPreview = Array.isArray(post.repostedByPreview);
  const preview = (hasPreview ? post.repostedByPreview : post.repostedByFriends || [])
    .filter(person => person?.id && person?.username && account.canSee(person.id));
  const friends = (Array.isArray(post.repostedByFriends) ? post.repostedByFriends : [])
    .filter(person => person?.id && person?.username && account.canSee(person.id));
  const count = Math.max(0, Number(post.repostCount) || 0, mine ? 1 : 0, friends.length, preview.length);
  const canToggleRepost = Boolean(me && (mine || (post.author && post.author !== me.id)));
  const profiles = [];
  if (mine && me) profiles.push({ ...me, mine: true });
  const reposterCandidates = hasPreview ? preview : friends;
  for (const person of reposterCandidates) {
    if (profiles.length >= 2) break;
    if (profiles.some(profile => String(profile.id) === String(person.id))) continue;
    const user = account.user(person.id) || person;
    profiles.push({ ...user, ...person, mine: person.id === me?.id });
  }
  let picked = null;
  if (!profiles.length && count) {
    picked = pick(post, account);
    if (picked?.user) profiles.push({ ...picked.user, mine: picked.mine });
  }
  if (!count && canToggleRepost && me) profiles.push({ ...me, viewerPreview: true });
  if (!count && !canToggleRepost) return "";
  const firstReposter = preview[0] || (!hasPreview ? friends[0] || picked?.user : null);
  const firstName = String(firstReposter?.name || firstReposter?.displayName || firstReposter?.username || "").trim();
  const label = count > 1 ? `${new Intl.NumberFormat().format(count)} reposted`
    : mine ? "You repost..."
      : count === 0 ? "Repost to followers"
        : firstName ? `${firstName} reposted` : "1 repost";
  const noteText = mine && me ? note(post, me.id) : "";
  let bubble = "";
  if (noteText) bubble = `<button type="button" class="rp-bubble" data-repost-note="${esc(post.id)}" aria-label="Edit your repost note: ${esc(noteText)}"><span class="rp-text">${esc(noteText)}</span></button>`;
  const faces = profiles.slice(0, 2).map(profile => {
    const username = profile.username || "member";
    const avatar = profile.avatar || profile.avatarUrl || "";
    const name = String(profile.name || profile.displayName || username).trim();
    const initial = Array.from(name)[0]?.toLocaleUpperCase() || "M";
    const isMine = profile.mine === true;
    const action = profile.viewerPreview
      ? `data-avatar-profile="${esc(profile.id)}" aria-label="Open your profile"`
      : isMine
      ? `data-repost-note="${esc(post.id)}" aria-label="${noteText ? "Edit your repost note" : "Add a note to your repost"}"`
      : `data-avatar-profile="${esc(profile.id)}" aria-label="@${esc(username)} reposted this post"`;
    const portrait = avatar
      ? `<img src="${esc(avatar)}" alt="">`
      : `<span class="rp-avatar-fallback" aria-hidden="true">${esc(initial)}</span>`;
    return `<button type="button" class="rp-face rp-face-compact" ${action}>${portrait}</button>`;
  }).join("");
  const actionLabel = mine ? "Remove repost" : "Repost to followers";
  const action = canToggleRepost
    ? `<button type="button" class="rp-action rp-action-icon-only${mine ? " is-active" : ""}" data-repost="${esc(post.id)}" aria-label="${actionLabel}" aria-pressed="${mine}">${renderIcon("repost")}</button>`
    : "";
  const countMarkup = count
    ? `<button type="button" class="rp-count" data-reposters-open="${esc(post.id)}" aria-label="See who reposted this post" aria-haspopup="dialog">${esc(label)}</button>`
    : `<span class="rp-count">${esc(label)}</span>`;
  const confirmationMarkup = confirming ? '<span class="rp-confirmation" role="status">Reposted</span>' : "";
  const summaryMarkup = count || canToggleRepost
    ? `<span class="rp-summary">${faces ? `<span class="rp-avatars">${faces}</span>` : ""}${countMarkup}</span>`
    : "";
  const rowClass = action ? "rp-row" : "rp-row rp-row-no-action";
  return `<div class="rp-aff" data-rp-post="${esc(post.id)}" data-rp-note="${noteText ? "1" : "0"}">
    ${confirmationMarkup}
    ${bubble}
    <div class="${rowClass}">${summaryMarkup}${action}</div>
  </div>`;
}

export function mountRepostAffordances(root) {
  if (!root) return;
  root.querySelectorAll(".rp-aff [data-rn-read]").forEach(button => button.addEventListener("click", e => {
    const aff = button.closest(".rp-aff");
    const open = aff.classList.toggle("rp-open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "Less" : "Read";
  }));
}
