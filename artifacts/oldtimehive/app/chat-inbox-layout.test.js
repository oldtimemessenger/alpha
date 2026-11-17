import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const chat = read("chat.js");
const styles = read("styles.css");
const icons = read("icons.js");
const inboxStyles = read("chat-reference-refinement.css");
const inbox = chat.slice(chat.indexOf('<section class="screen on light chat-list-screen"'), chat.indexOf("  const renderRows ="));
const header = inbox.slice(inbox.indexOf('<div class="chat-list-topline">'), inbox.indexOf('<div class="chat-list-body">'));

test("Messages title is centered beside the right-side compose picker", () => {
  assert.match(header, /<span class="chat-list-leading-space" aria-hidden="true"><\/span>/);
  assert.match(header, /<h1 class="chat-title">Messages<\/h1>/);
  assert.match(header, /class="chat-list-picker-trigger" id="chat-list-picker-toggle" aria-label="Message actions" aria-expanded="false">\$\{ic\.compose\}/);
  assert.doesNotMatch(header, /renderConsole|cic-track|Stories and notes/);
  assert.match(inboxStyles, /grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(inboxStyles, /\.chat-list-picker-trigger\s*\{[^}]*grid-column:3[^}]*background:transparent/);
  assert.match(inboxStyles, /\.chat-list-screen \.chat-title\s*\{[^}]*grid-column:2[^}]*text-align:center/);
  assert.doesNotMatch(header, /id="chat-more"|id="newchat"|chat-head-actions/);
  assert.match(inbox, /id="newchat"[^>]*aria-label="New message or group"/);
  assert.match(inbox, /id="chat-more"[^>]*aria-label="Message settings"[^>]*>\$\{ic\.gear\}/);
  assert.match(inbox, /id="chat-add-story"[^>]*aria-label="Add a story"/);
  assert.match(inbox, /id="chat-add-note"[^>]*aria-label="Add a note"/);
  assert.doesNotMatch(header, /chat-search-trigger|toggle-chat-search/);
  assert.doesNotMatch(inbox, /chat-filter-control|chat-filter-label|>All</);
  assert.doesNotMatch(inbox, /data-more-filter|data-inbox-folder|chat-filter-section-title|chat-folder-options|chat-organize-card|chat-see-more|more-folders/);
  assert.doesNotMatch(inbox, /chat-search-wrap|chat-search-panel|Search messages/);
});

test("Messages header has no divider underneath it", () => {
  const heading = inboxStyles.match(/#app \.chat-list-screen \.chat-list-heading\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(heading, /border-bottom:0!important/);
});

test("message bubbles use black and pearl without changing the app-wide brand", () => {
  const unboxed = read("unboxed-interface.css");
  const refinement = read("chat-conversation-refinement.css");
  const messagePresentation = refinement.slice(
    refinement.indexOf("#app .conversation-screen .bubble-msg"),
    refinement.indexOf("#app .conversation-screen .meta-line"),
  );
  assert.match(unboxed, /#app \.conversation-screen \.bubble-msg\.mine\s*\{[^}]*background:\s*#17191c!important[^}]*color:\s*#f8f7f3!important/);
  assert.match(unboxed, /#app \.conversation-screen \.bubble-msg\.theirs\s*\{[^}]*background:\s*#f6f4ef!important[^}]*color:\s*#17191c!important/);
  assert.match(refinement, /\.bubble-msg\.mine\s*\{[^}]*background:#17191c[^}]*color:#f8f7f3/);
  assert.match(refinement, /\.bubble-msg\.theirs\s*\{[^}]*background:#f6f4ef[^}]*color:#17191c/);
  assert.doesNotMatch(messagePresentation, /linear-gradient|backdrop-filter/);
  assert.match(refinement, /\.chat-header\s*\{[^}]*box-shadow:none/);
  assert.match(refinement, /\.composer\s*\{[^}]*box-shadow:none/);
});

test("Messages removes filters and folders but keeps Saved messages accessible", () => {
  assert.doesNotMatch(header, /chat-search-trigger|toggle-chat-search/);
  assert.match(chat, /settingsButton\.onclick = \(\) => \{ setMenu\(false\); showInboxSettings\(ctx, "list"\); \}/);
  const settings = read("chat-settings.js");
  assert.match(settings, /Allow direct messages from/);
  assert.match(settings, /Allow group chat invites from/);
  assert.match(settings, /data-chat-saved/);
  assert.doesNotMatch(settings, /Filter conversations|More filters|Folders|Inbox folder/);
  assert.doesNotMatch(header, /id="saved"|id="chat-filter-open"/);
  // New message/group creation stays in the Messages picker.
  assert.doesNotMatch(header, /id="newchat"|id="chat-more"/);
  assert.equal((header.match(/<button type="button" class="chat-(?:search-trigger|head-icon)"/g) || []).length, 0);
  assert.doesNotMatch(inbox, /chat-inbox-tabs|chat-inbox-tab/);
  assert.doesNotMatch(inbox, /Filters|Folders|Organize your messages|data-more-filter|data-inbox-folder/);
  assert.match(icons, /sendUp: '<path d="M12 19V5m-7 7 7-7 7 7"/);
});

test("new-chat picker keeps Oldtime styling and the reference contact layout", () => {
  const refinement = read("chat-reference-refinement.css");
  assert.match(chat, /class="chat-compose-header"[\s\S]*?id="chat-compose-cancel"[\s\S]*?New chat/);
  assert.match(chat, /id="chat-contact-search" type="text" inputmode="search"[^>]*placeholder="Search"/);
  assert.match(chat, /class="chat-compose-create-group" id="chat-compose-create-group"/);
  assert.match(chat, /class="chat-compose-group-icon"/);
  assert.match(chat, /class="chat-compose-avatar"/);
  assert.match(chat, /ctx\.\$\("#chat-compose-cancel"\)\.onclick = \(\) => sheet\.classList\.remove\("on"\)/);
  assert.match(chat, /ctx\.\$\("#chat-compose-create-group"\)/);
  assert.match(refinement, /#sheet \.chat-compose-panel\s*\{[^}]*border-radius:24px 24px 0 0/);
  assert.match(refinement, /#sheet \.chat-compose-person\s*\{[^}]*min-height:82px/);
  assert.match(refinement, /#sheet \.chat-compose-avatar\s*\{[^}]*width:64px/);
});

test("Messages inbox has no extra inline Search field", () => {
  assert.doesNotMatch(chat, /chat-search-wrap|chat-search-panel|Search messages|id="cq"/);
  assert.match(chat, /id="chat-contact-search" type="text" inputmode="search"[^>]*placeholder="Search"/,
    "New chat keeps its separate contact picker search");
});

test("chat refresh failures only notify on the active signed-in message screen", () => {
  const refresh = chat.slice(chat.indexOf("function refreshActiveChat"), chat.indexOf("subscribeChatUpdates(refreshActiveChat)"));
  assert.match(refresh, /view\.owner !== api\.cloudAccountId\(\)/);
  assert.match(refresh, /activeChatView === view/);
  assert.match(refresh, /current\.owner === api\.cloudAccountId\(\)/);
  assert.match(refresh, /Messages could not refresh\. Check your connection and reopen the chat\./);
  assert.doesNotMatch(refresh, /error\??\.message/);
});

test("Messages picker contains direct actions, not an inbox organizer", () => {
  assert.match(inbox, /id="newchat"[^>]*aria-label="New message or group"/);
  assert.match(inbox, /id="chat-more"[^>]*aria-label="Message settings"/);
  assert.match(inbox, /id="chat-add-story"[^>]*aria-label="Add a story"/);
  assert.match(inbox, /id="chat-add-note"[^>]*aria-label="Add a note"/);
  assert.doesNotMatch(inbox, /class="chat-option(?:\s|")|chat-sheet-folders|chat-folder-options|chat-organize-card|data-more-filter|data-inbox-folder/);
  assert.match(read("chat-settings.js"), /data-chat-saved/);
});

test("empty inbox offers a working, compact New chat action", () => {
  assert.match(chat, /Say hi to someone/);
  assert.match(chat, /id="empty-newchat"[^>]*><span>New message<\/span>/);
  assert.match(chat, /emptyNewChat\.onclick = \(\) => pick\(ctx, false\)/);
  assert.match(icons, /messagePlus: '<path d=/);
});

test("Discovery search keeps a borderless rounded search capsule", () => {
  const unboxed = read("unboxed-interface.css");
  assert.doesNotMatch(unboxed, /\.chat-search-wrap|\.chatsearch/);
  assert.match(unboxed, /#app \.discovery-search-wrap\s*\{[^}]*border-radius:999px!important[^}]*background:#f1f2f4!important/);
  assert.match(unboxed, /#app \.discovery-search\s*\{[^}]*background:transparent!important/);
});

test("empty chats show the profile introduction and a working waving-hand sticker", () => {
  const refinement = read("chat-conversation-refinement.css");
  const store = read("store.js");
  assert.match(chat, /class="chat-empty-intro \$\{c\.group \? "is-group" : "is-contact"\}"/);
  assert.match(chat, /class="chat-empty-profile"/);
  assert.match(chat, /class="chat-empty-avatar"/);
  assert.match(chat, /class="chat-empty-date"/);
  assert.match(store, /createdAt:Number\(room\.createdAt\) \|\| 0/);
  assert.match(chat, /Say hi by sending a sticker/);
  assert.match(chat, /id="send-hi-sticker" class="chat-hello-sticker" aria-label="Send waving hand sticker"/);
  assert.match(chat, /pushMsg\(id, \{ kind: "sticker", body: "👋" \}, ownerId\)/);
  assert.match(chat, /id="empty-chat-follow"/);
  assert.match(refinement, /#app \.conversation-screen \.chat-empty-intro\s*\{[^}]*padding:clamp\(28px,6vh,56px\)/);
  assert.match(refinement, /#app \.conversation-screen \.chat-empty-date\s*\{[^}]*margin:auto 0 0/);
  assert.match(refinement, /#app \.conversation-screen \.chat-hello-sticker\s*\{[^}]*border-radius:50%[^}]*box-shadow:none/);
  assert.match(chat, /<textarea id="msg" rows="1"/);
  assert.match(chat, /e\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(styles, /\.chat-composer textarea \{[^}]*max-height:112px/);
  assert.match(styles, /\.conversation-screen \.message-body \{[^}]*white-space:pre-wrap/);
  assert.match(styles, /\.conversation-screen \.composer \{[^}]*position:relative[^}]*bottom:auto[^}]*flex:0 0 auto/);
  assert.match(styles, /\.conversation-messages \{[^}]*min-height:0[^}]*padding:10px 12px 12px/);
  assert.match(styles, /\.chat-option-icon \{[^}]*border-radius:0[^}]*background:transparent/);
});

test("thread keeps its header actions and details page shortcuts", () => {
  const detailsStyles = read("chat-reference-refinement.css");
  const refinement = read("chat-conversation-refinement.css");
  assert.match(chat, /class="post-actions-menu chat-thread-actions-menu" data-post-actions-menu/);
  assert.match(chat, /id="chat-more" class="chat-action" aria-label="More chat actions"/);
  assert.match(chat, /data-chat-thread-mute/);
  assert.match(chat, /data-chat-thread-block/);
  assert.match(refinement, /#app \.conversation-screen > \.chat-composer\s*\{[^}]*position:relative!important[^}]*inset:auto!important/s);
  assert.match(refinement, /#app \.conversation-screen > \.conversation-messages\s*\{[^}]*flex:1 1 0%[^}]*overflow-y:auto/s);
  assert.match(chat, /id="contact-profile-shortcut"/);
  assert.match(chat, /id="contact-search-shortcut"/);
  assert.match(chat, /ctx\.\$\("#contact-profile-shortcut"\)\.onclick = \(\) => ctx\.openProfile\?\.\(other\.id\)/);
  assert.match(chat, /ctx\.\$\("#contact-search-shortcut"\)\.onclick = \(\) => \{ ui\.screen = "search"; ctx\.render\(\); \}/);
  assert.match(chat, /id="location-share"/);
  assert.match(chat, /id="location-request"/);
  assert.match(chat, /id="details-dis"/);
  assert.match(chat, /id="details-hide"/);
  assert.match(chat, /id="block"/);
  assert.match(chat, /id="report"/);
  assert.match(detailsStyles, /#app \.chat-details-screen \.contact-shortcuts\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test("message bubbles size to their content and keep sender and receiver alignment", () => {
  assert.match(styles, /\.conversation-screen \.bubble-msg \{[^}]*height:auto[^}]*min-height:0[^}]*flex:0 0 auto/);
  assert.match(styles, /\.conversation-screen \.bubble-msg\.mine \{[^}]*align-self:flex-end/);
  assert.match(styles, /\.conversation-screen \.bubble-msg\.theirs \{[^}]*align-self:flex-start/);
  assert.match(styles, /\.conversation-screen \.message-row \{[^}]*background:transparent/);
  assert.match(chat, /<div class="message-body">\$\{body\(m, c\.legacyArchive, mine\)\}<\/div>/);
  assert.match(chat, /<div \$\{messageRow\}><div class="bubble-msg/);
  assert.match(chat, /messageDayLabel\(m\.created\)/);
  assert.match(chat, /const time = cluster\.endsCluster \? `<span class="message-time">/);
  assert.match(chat, /const metadata = flags \|\| footer \?/);
  assert.match(chat, /messageDetails = \[messageDateTime\(m\.created\), m\.edited \? "Edited" : ""\]/);
  assert.match(chat, /<div \$\{messageRow\}><div class="bubble-msg[\s\S]*\$\{metadata\}<\/div>`;/);
  assert.match(chat, /String\(m\.body \|\| ""\)\.replace\(\/\\r\\n\?\/g, "\\n"\)\.trim\(\)/);
});
