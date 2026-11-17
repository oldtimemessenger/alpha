import "./community-feeds.css";

const FEEDS = [
  ["following", "Following"], ["discover", "Discover"], ["popular", "Popular"],
  ["friends", "Mutuals / Friends"], ["media", "Photos & Video"],
];
const DEFAULT_PINS = ["following", "discover", "popular", "friends"];
const DEFAULTS = { hideReplies:false, hideReposts:false, hideQuotes:false, onlyFollowing:false, language:"all", includeUnlabelled:true };
const LANGUAGES = [["all","All languages"],["und","Unlabelled"],["en","English"],["es","Spanish"],["fr","French"],["ht","Haitian Creole"],["pt","Portuguese"],["ar","Arabic"],["hi","Hindi"],["zh","Chinese"],["ja","Japanese"]];
const SUGGESTION_DISMISS_MS=7*24*60*60*1000;
let owner="", active="discover", generation=0, dependencies, dialog=null, communityDialogAnchor=null;
let preferences, lists=[], mutedAccounts=[], settingsError="", settingsLoading=false;
let feed={posts:[],loading:false,error:"",hasMore:false,nextOffset:0,loadedAt:0,reason:null,caughtUpAt:null};
let relationshipKey="";
let deferredPaint=false;
let suggestions={people:[],loading:false,error:"",loadedAt:0};
let clubsMode=false, clubs=[], clubsLoading=false, clubsError="", clubsLoadedAt=0, clubFilter="all", clubSearch="";
let selectedClub=null, clubMessages=[], clubMessagesLoading=false, clubMessagesError="", clubMessagesLoadedAt=0;
let clubMessagesCursor=null, clubDraft="", clubSending=false;
let clubPollTimer=null, clubPolling=false, clubStickToBottom=true;
const freshPreferences=()=>({pinned:[...DEFAULT_PINS],filters:{},mutedWords:[],mutedAccounts:[],caughtUp:{}});
const label=id=>FEEDS.find(([key])=>key===id)?.[1] || lists.find(list=>`list:${list.id}`===id)?.name || "Curated list";
const e=value=>dependencies.esc(String(value??""));
const ic=name=>dependencies.icon(name);
const CLUB_COVER_PRESETS=[
  ["marbled-red","Marbled Red"],["minimal-mesh","Minimal Mesh"],["misty-forest","Misty Forest"],
  ["urban-motion","Urban Motion"],["fluid-fusion","Fluid Fusion"],["concert-crowd","Concert Crowd"],
  ["creator-desk","Creator Desk"],["faithful-rays","Faithful Rays"],["geometric-glass","Geometric Glass"],
  ["warm-grid","Warm Grid"],["love-letters","Love Letters"],["love-together","Love Together"],
  ["sex-intimacy","Sex & Intimacy"],["faith-light","Faith"],["gods-grace","God’s Grace"],
  ["quiet-prayer","Quiet Prayer"],["tech-circuit","Tech Circuit"],["code-studio","Code Studio"],
  ["basketball-court","Basketball"],["courtside","Courtside"],["music-night","Music Night"],
  ["creator-studio","Creator Studio"],
];
const CLUB_COVER_DEFAULT="minimal-mesh";
const clubCoverPath=id=>`./club-covers/${encodeURIComponent(id)}.webp`;
function clubCoverMarkup(club,className="cf-club-cover",hideFromAssistiveTech=true){
  const preset=CLUB_COVER_PRESETS.some(([id])=>id===club.coverPresetId)?club.coverPresetId:CLUB_COVER_DEFAULT;
  const reference=club.coverMediaReference||"";
  const source=reference?`data-cf-club-cover-media="${e(reference)}"`:`src="${e(clubCoverPath(preset))}"`;
  const caption=reference?"Your cover":CLUB_COVER_PRESETS.find(([id])=>id===preset)?.[1]||"Club cover";
  return `<div class="${className} cf-club-cover"${hideFromAssistiveTech?' aria-hidden="true"':""}><img ${source} alt="" loading="lazy" decoding="async"><span>${e(caption)}</span></div>`;
}
function loadClubCoverMedia(root){
  const images=[...root.querySelectorAll("[data-cf-club-cover-media]")];
  if(!images.length)return;
  void import("./local-media.js").then(async({mediaUrl})=>{
    for(const image of images){
      try{
        const url=await mediaUrl(image.dataset.cfClubCoverMedia);
        if(image.isConnected&&url)image.src=url;
      }catch{
        image.closest(".cf-club-cover")?.classList.add("is-unavailable");
      }
    }
  }).catch(()=>images.forEach(image=>image.closest(".cf-club-cover")?.classList.add("is-unavailable")));
}
const suggestionDismissalStorageKey=()=>`oldtime-community-suggestion-dismissals:${owner}`;
function readSuggestionDismissals(){
  try{
    const storage=globalThis.localStorage;
    const parsed=JSON.parse(storage?.getItem(suggestionDismissalStorageKey())||"{}");
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return {};
    const now=Date.now();
    const active=Object.fromEntries(Object.entries(parsed).filter(([,timestamp])=>
      Number.isFinite(timestamp)&&timestamp<=now&&now-timestamp<SUGGESTION_DISMISS_MS));
    if(Object.keys(active).length!==Object.keys(parsed).length)
      storage?.setItem(suggestionDismissalStorageKey(),JSON.stringify(active));
    return active;
  }catch{return {};}
}
function dismissSuggestionsForNow(section){
  if(!owner||!section)return;
  const dismissals=readSuggestionDismissals();
  dismissals[section]=Date.now();
  try{globalThis.localStorage?.setItem(suggestionDismissalStorageKey(),JSON.stringify(dismissals));}catch{}
}
async function request(path,options) {
  const account=owner,result=await dependencies.requestCloudApi(`/api/community/${path}`,options);
  if(account!==owner)throw new Error("Your account changed. Open Community again.");
  return result;
}
async function requestClub(path="",options) {
  const account=owner,result=await dependencies.requestCloudApi(`/api/clubs${path}`,options);
  if(account!==owner)throw new Error("Your account changed. Open Community again.");
  return result;
}
const editable=source=>({pinned:source.pinned,filters:source.filters,mutedWords:source.mutedWords,mutedAccounts:source.mutedAccounts});
const repaint=()=>{
  if(!dependencies.isActive())return;
  if(dialog?.open){deferredPaint=true;return;}
  deferredPaint=false;dependencies.refresh();
};
const errorMessage=error=>error?.message || "This action couldn’t be completed. Try again.";
const feedCache=new Map();
function invalidateFeeds(){
  generation++;feedCache.clear();
  feed={...feed,posts:[],loading:false,error:"",loadedAt:0,hasMore:false};
}
let restoreScroll=0;

function reset(next) {
  stopClubPolling();closeDialog();owner=next;active="discover";generation++;preferences=freshPreferences();lists=[];mutedAccounts=[];
  feed={posts:[],loading:false,error:"",hasMore:false,nextOffset:0,loadedAt:0,reason:null,caughtUpAt:null};
  settingsError="";settingsLoading=false;relationshipKey="";feedCache.clear();restoreScroll=0;
  suggestions={people:[],loading:false,error:"",loadedAt:0};
  clubsMode=false;clubs=[];clubsLoading=false;clubsError="";clubsLoadedAt=0;clubFilter="all";clubSearch="";
  selectedClub=null;clubMessages=[];clubMessagesLoading=false;clubMessagesError="";clubMessagesLoadedAt=0;
  clubMessagesCursor=null;clubDraft="";clubSending=false;clubPolling=false;
}
async function loadSuggestions(){
  if(suggestions.loading)return;
  const account=owner;suggestions.loading=true;
  try{
    const result=await dependencies.requestCloudApi("/api/discovery/people?limit=12");
    if(account!==owner)return;
    if(!Array.isArray(result.suggestions))throw new Error("Account suggestions returned an incomplete response.");
    suggestions.people=result.suggestions; suggestions.error=""; suggestions.loadedAt=Date.now();
  }catch(error){if(account===owner){suggestions.error=errorMessage(error);suggestions.loadedAt=Date.now();}}
  finally{if(account===owner){suggestions.loading=false;repaint();}}
}
const sharesInterests=suggestion=>[suggestion.sharedInterests,suggestion.matchingInterests].some(value=>Array.isArray(value)&&value.length>0);
function suggestedPeopleMarkup(items,title,sectionKey,dismissed){
  if(!items.length||dismissed[sectionKey])return "";
  return `<section class="cf-suggestions" aria-label="${e(title)}"><header><h2>${e(title)}</h2><div class="cf-suggestion-actions"><button type="button" data-cf-search>Find more</button><button type="button" data-cf-suggestions-dismiss="${e(sectionKey)}" aria-label="Dismiss ${e(title)} for now" title="Dismiss for 7 days">Not now</button></div></header><div class="cf-people-rail">${items.map(suggestion=>{
    const person=suggestion.profile||suggestion.person||suggestion;
    const name=person.displayName||person.name||person.username||"Member";
    const reason=sharesInterests(suggestion)?"Shared interests":suggestion.reason==="mutual-followers"?"Connected through people you follow":"Suggested public account";
    const avatar=person.avatar||person.avatarReference||person.avatarUrl||"";
    const source=String(avatar).startsWith("oldtime-media:")?`data-local-media="${e(avatar)}"`:`src="${e(avatar)}"`;
    return `<article><button class="cf-person" data-cf-profile="${e(person.id)}"><span class="cf-person-avatar">${avatar?`<img ${source} alt="${e(name)}" width="56" height="56" loading="lazy" decoding="async">`:ic("user")}</span><b>${e(name)}</b><small>@${e(person.username)}</small></button><p>${e(reason)}</p><div class="cf-person-actions"><button class="cf-view-profile" data-cf-profile="${e(person.id)}">View profile</button><button class="cf-follow" data-cf-follow="${e(person.id)}">Follow</button></div></article>`;
  }).join("")}</div></section>`;
}
async function loadSettings() {
  if(settingsLoading)return;
  settingsLoading=true;const account=owner;
  try{
    const [settings,catalog]=await Promise.all([request("preferences"),request("lists")]);
    if(owner!==account)return;
    preferences=settings.preferences;mutedAccounts=settings.mutedAccounts||[];lists=catalog.lists||[];settingsError="";
    invalidateFeeds();
  }catch(error){
    if(owner===account){
      settingsError="Couldn't load your feed controls. Try again.";
    }
  }
  finally{if(owner===account){settingsLoading=false;repaint();}}
}
async function loadFeed(append=false) {
  if(feed.loading)return;
  const account=owner,selected=active,sequence=++generation;
  feed.loading=true;feed.error="";
  try{
    const result=await request(`feed?feed=${encodeURIComponent(selected)}&limit=20&offset=${append?feed.nextOffset:0}`);
    if(account!==owner||selected!==active||sequence!==generation)return;
    if(!Array.isArray(result.posts)||!Number.isSafeInteger(result.nextOffset))throw new Error("The server returned an incomplete feed.");
    const posts=dependencies.api.cacheCloudExplorePosts(result.posts),seen=new Set(append?feed.posts.map(p=>p.id):[]);
    feed.posts=(append?feed.posts:[]).concat(posts.filter(p=>!seen.has(p.id)&&seen.add(p.id)));
    feed.hasMore=result.hasMore===true;feed.nextOffset=result.nextOffset;feed.loadedAt=Date.now();
    feed.reason=result.reason;feed.reasons={...(append?feed.reasons:{}),...(result.reasons||{})};feed.caughtUpAt=result.caughtUpAt;
   }catch(error){if(sequence===generation)feed.error="Couldn't load posts.";}
  finally{if(sequence===generation){feed.loading=false;repaint();}}
}
function selectFeed(id) {
  const scroller=dependencies.app.querySelector(".stories-feed-scroll");
  feedCache.set(active,{...feed,loading:false,scrollTop:scroller?.scrollTop||0});
  active=id;generation++;
  const cached=feedCache.get(id);
  feed=cached?{...cached,loading:false}:{posts:[],loading:false,error:"",hasMore:false,nextOffset:0,loadedAt:0,reason:null,caughtUpAt:null};
  restoreScroll=cached?.scrollTop||0;
  repaint();
  requestAnimationFrame(()=>{const target=dependencies.app.querySelector(".stories-feed-scroll");if(target)target.scrollTop=restoreScroll;});
}
async function save(next) {
  const account=owner,result=await request("preferences",{method:"PUT",body:editable(next)});
  if(account!==owner)throw new Error("Your account changed. Open these controls again.");
  preferences=result.preferences;generation++;feedCache.clear();
  feed={posts:[],loading:false,error:"",hasMore:false,nextOffset:0,loadedAt:0,reason:null,caughtUpAt:preferences.caughtUp?.[active]||null};
}
function closeDialog({preserveAnchor=false}={}) {
  if(dialog){
    const old=dialog;dialog=null;old.close();old.remove();
    if(deferredPaint)queueMicrotask(repaint);
  }
  if(!preserveAnchor)communityDialogAnchor=null;
}
function positionCommunityDialog(current,anchor) {
  if(!current.isConnected||!anchor?.isConnected)return;
  const margin=12,gap=6,viewportWidth=window.innerWidth,viewportHeight=window.innerHeight;
  const bounds=anchor.getBoundingClientRect(),width=Math.min(360,viewportWidth-margin*2);
  const right=Math.max(margin,Math.min(viewportWidth-bounds.right,viewportWidth-width-margin));
  const below=Math.max(0,viewportHeight-bounds.bottom-gap-margin);
  const above=Math.max(0,bounds.top-gap-margin);
  const heightCap=Math.min(560,viewportHeight*.78);
  current.style.width=`${width}px`;
  current.style.left="auto";
  current.style.right=`${right}px`;
  current.style.bottom="auto";
  const contentHeight=current.scrollHeight;
  const placeAbove=contentHeight>Math.min(heightCap,below)&&above>below;
  const space=placeAbove?above:below;
  current.style.maxHeight=`${Math.max(120,Math.min(heightCap,space))}px`;
  current.style.top=`${bounds.bottom+gap}px`;
  const panelHeight=current.getBoundingClientRect().height;
  current.style.top=placeAbove
    ?`${Math.max(margin,bounds.top-panelHeight-gap)}px`
    :`${Math.max(margin,Math.min(bounds.bottom+gap,viewportHeight-panelHeight-margin))}px`;
}
function openDialog(title,body,bind,anchor=communityDialogAnchor) {
  const nextAnchor=anchor?.isConnected?anchor:null;
  closeDialog({preserveAnchor:true});
  communityDialogAnchor=nextAnchor;
  const returnTo=document.activeElement;
  dialog=document.createElement("dialog");dialog.className=`cf-dialog${nextAnchor?" cf-dialog-popover":""}`;
  dialog.innerHTML=`<header><span class="cf-sheet-handle" aria-hidden="true"></span><div class="cf-dialog-title"><h2>${e(title)}</h2><button type="button" data-cf-close aria-label="Close">${ic("close")}</button></div></header><div class="cf-dialog-body">${body}</div><p class="cf-form-error" role="alert"></p>`;
  document.body.append(dialog);dialog.querySelector("[data-cf-close]").onclick=closeDialog;
  const current=dialog;
  if(!nextAnchor){
    let swipeStart=null;
    current.querySelector(".cf-sheet-handle").addEventListener("pointerdown",event=>{
      swipeStart=event.clientY;current.querySelector(".cf-sheet-handle").setPointerCapture?.(event.pointerId);
    });
    current.querySelector(".cf-sheet-handle").addEventListener("pointerup",event=>{
      if(swipeStart!==null&&event.clientY-swipeStart>48)closeDialog();
      swipeStart=null;
    });
    current.querySelector(".cf-sheet-handle").addEventListener("pointercancel",()=>{swipeStart=null;});
  }else{
    const updatePosition=()=>positionCommunityDialog(current,nextAnchor);
    window.addEventListener("resize",updatePosition);
    window.addEventListener("scroll",updatePosition,true);
    current.addEventListener("close",()=>{
      window.removeEventListener("resize",updatePosition);
      window.removeEventListener("scroll",updatePosition,true);
    },{once:true});
    current.addEventListener("click",event=>{
      if(event.target!==current)return;
      const rect=current.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();
    });
  }
  current.addEventListener("close",()=>{
    if(dialog===current){dialog=null;communityDialogAnchor=null;}
    current.remove();
    if(!dialog?.open&&returnTo?.isConnected)returnTo.focus({preventScroll:true});
    if(deferredPaint)repaint();
  });
  dialog.showModal();
  if(nextAnchor)positionCommunityDialog(current,nextAnchor);
  bind?.(dialog);
}
function failInDialog(error) { if(dialog)dialog.querySelector(".cf-form-error").textContent=errorMessage(error); }
function pending(button,action) {
  button.disabled=true;
  return Promise.resolve().then(action).catch(failInDialog).finally(()=>{if(button.isConnected)button.disabled=false;});
}
function settingsMenu(anchor) {
  openDialog("Community controls",`<p>Your settings are private and saved to your account. They change Community only.</p>
    <div class="cf-menu">
      <button data-cf-menu="pins">${ic("pin")}<span>Pinned feeds<small>Choose and reorder your feeds</small></span></button>
      <button data-cf-menu="filter">${ic("feedPreferences")}<span>${e(label(active))} preferences<small>Replies, reposts, languages and following</small></span></button>
      <button data-cf-menu="mutes">${ic("mute")}<span>Muted words and accounts<small>Hide content without notifying anyone</small></span></button>
      <button data-cf-menu="lists">${ic("users")}<span>Curated lists<small>Create, follow, edit and pin a list feed</small></span></button>
      <button data-cf-menu="language">${ic("document")}<span>Label your post language<small>Help other people use language filters</small></span></button>
    </div>`,root=>{
      root.querySelectorAll("[data-cf-menu]").forEach(button=>button.onclick=()=>({
        pins:pinSettings,filter:filterSettings,mutes:muteSettings,lists:listSettings,language:languageSettings,
      })[button.dataset.cfMenu]());
    },anchor);
}
function pinSettings() {
  let order=[...preferences.pinned];
  const options=[...FEEDS.map(([id,name])=>({id,name})),...lists.filter(l=>l.owned||l.followed||preferences.pinned.includes(`list:${l.id}`)).map(l=>({id:`list:${l.id}`,name:l.name}))];
  function paint(){
    const markup=`<p>Use the arrows to reorder. At least one feed must stay pinned.</p>
      <div class="cf-pin-list">${order.map((id,index)=>`<div><b>${e(label(id))}</b>
        <button data-cf-up="${index}" ${index===0?"disabled":""} aria-label="Move ${e(label(id))} earlier">${ic("up")}</button>
        <button data-cf-down="${index}" ${index===order.length-1?"disabled":""} aria-label="Move ${e(label(id))} later">${ic("down")}</button>
        <button data-cf-unpin="${index}" ${order.length===1?"disabled":""} aria-label="Unpin ${e(label(id))}">${ic("close")}</button></div>`).join("")}</div>
      <div class="cf-menu">${options.filter(item=>!order.includes(item.id)).map(item=>`<button data-cf-pin="${e(item.id)}">${ic("plus")}<span>${e(item.name)}</span></button>`).join("")}</div>
      <button class="cf-primary" data-cf-save-pins>Save pinned feeds</button>`;
    const bind=root=>{
      root.querySelectorAll("[data-cf-up]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.cfUp);[order[i-1],order[i]]=[order[i],order[i-1]];paint();root.querySelector(`[data-cf-down="${i-1}"]`)?.focus({preventScroll:true});});
      root.querySelectorAll("[data-cf-down]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.cfDown);[order[i],order[i+1]]=[order[i+1],order[i]];paint();root.querySelector(`[data-cf-up="${i+1}"]`)?.focus({preventScroll:true});});
      root.querySelectorAll("[data-cf-unpin]").forEach(b=>b.onclick=()=>{order.splice(Number(b.dataset.cfUnpin),1);paint();});
      root.querySelectorAll("[data-cf-pin]").forEach(b=>b.onclick=()=>{order.push(b.dataset.cfPin);paint();});
      root.querySelector("[data-cf-save-pins]").onclick=event=>pending(event.currentTarget,async()=>{
        await save({...preferences,pinned:order});closeDialog();if(!order.includes(active))selectFeed(order[0]);else repaint();
      });
    };
    if(dialog?.dataset.cfPins==="true"){
      const scroll=dialog.scrollTop;dialog.querySelector(".cf-dialog-body").innerHTML=markup;bind(dialog);dialog.scrollTop=scroll;
    }else{
      openDialog("Pinned Community feeds",markup,bind);dialog.dataset.cfPins="true";
    }
  }paint();
}
function filterSettings() {
  const selected=active,filter={...DEFAULTS,...preferences.filters[selected]};
  openDialog(`${label(selected)} preferences`,`<form id="cf-filter-form">
    <p>Only this feed changes. Following is always chronological, with no recommended posts.</p>
    ${[["hideReplies","Hide replies"],["hideReposts","Hide reposts"],["hideQuotes","Hide quote posts"],["onlyFollowing","Only people I follow"]].map(([key,text])=>
      `<label class="cf-toggle"><span>${text}</span><input type="checkbox" name="${key}" ${filter[key]?"checked":""}></label>`).join("")}
    <p class="cf-note">Replies remain inside conversations. Quote-post filtering applies to posts labelled as quotes.</p>
    <label class="cf-field">Language<select name="language">${LANGUAGES.map(([id,name])=>`<option value="${id}" ${filter.language===id?"selected":""}>${name}</option>`).join("")}</select></label>
    <label class="cf-toggle"><span>Include unlabelled posts</span><input type="checkbox" name="includeUnlabelled" ${filter.includeUnlabelled?"checked":""}></label>
    <p class="cf-note">Language labels come from creators. We do not guess language from images or audio.</p>
    <button type="submit" class="cf-primary">Save preferences</button></form>`,root=>{
    root.querySelector("form").onsubmit=event=>{
      event.preventDefault();const form=event.currentTarget;
      void pending(form.querySelector("button[type=submit]"),async()=>{
        const value={language:form.elements.language.value};
        for(const key of ["hideReplies","hideReposts","hideQuotes","onlyFollowing","includeUnlabelled"])value[key]=form.elements[key].checked;
        await save({...preferences,filters:{...preferences.filters,[selected]:value}});
        closeDialog();generation++;feed.loading=false;void loadFeed();repaint();
      });
    };
  });
}
function accountPicker(root,selected,onChange) {
  const input=root.querySelector("[data-cf-account-query]"),results=root.querySelector("[data-cf-account-results]");
  let timer,sequence=0;
  input.oninput=()=>{
    clearTimeout(timer);const query=input.value.trim(),id=++sequence;
    if(query.length<2){results.replaceChildren();return;}
    timer=setTimeout(async()=>{
      try{
        const result=await dependencies.requestCloudApi(`/api/users/search?q=${encodeURIComponent(query)}`);
        if(!root.isConnected||id!==sequence)return;
        const users=(result.users||[]).filter(user=>user.id!==owner&&!selected.some(item=>item.id===user.id));
        results.innerHTML=users.slice(0,8).map(user=>`<button type="button" data-cf-pick="${e(user.id)}"><span>${e(user.displayName||user.username)}<small>@${e(user.username)}</small></span>${ic("plus")}</button>`).join("")||"<p>No matching accounts.</p>";
        results.querySelectorAll("[data-cf-pick]").forEach(button=>button.onclick=()=>{
          const user=users.find(item=>item.id===button.dataset.cfPick);selected.push(user);input.value="";results.replaceChildren();onChange();
        });
      }catch(error){if(id===sequence&&root.isConnected)results.textContent=errorMessage(error);}
    },250);
  };
}
const pickerMarkup=`<label class="cf-field">Find an account<input type="search" data-cf-account-query placeholder="Search name or username" autocomplete="off"></label><div class="cf-menu" data-cf-account-results></div>`;
function muteSettings() {
  const selected=preferences.mutedAccounts.map(id=>mutedAccounts.find(a=>a.id===id)||dependencies.api.user(id)||{id,username:"Muted account"});
  openDialog("Muted words and accounts",`<form id="cf-mutes">
    <label class="cf-field">Muted words or phrases<textarea name="words" rows="4" placeholder="One word or phrase per line">${e(preferences.mutedWords.join("\n"))}</textarea></label>
    <p class="cf-note">Matches hide Community posts containing the phrase. Muting is private, and does not unfollow or block an account.</p>
    ${pickerMarkup}<div class="cf-selected" data-cf-selected></div>
    <button type="submit" class="cf-primary">Save mutes</button></form>`,root=>{
    const paint=()=>{
      root.querySelector("[data-cf-selected]").innerHTML=selected.map(user=>`<button type="button" data-cf-remove="${e(user.id)}">@${e(user.username)} ${ic("close")}</button>`).join("");
      root.querySelectorAll("[data-cf-remove]").forEach(b=>b.onclick=()=>{selected.splice(selected.findIndex(u=>u.id===b.dataset.cfRemove),1);paint();});
    };paint();accountPicker(root,selected,paint);
    root.querySelector("form").onsubmit=event=>{
      event.preventDefault();const form=event.currentTarget;
      void pending(form.querySelector("button[type=submit]"),async()=>{
        const words=[...new Set(form.elements.words.value.split("\n").map(s=>s.trim()).filter(Boolean))];
        await save({...preferences,mutedWords:words,mutedAccounts:selected.map(u=>u.id)});
        mutedAccounts=selected;closeDialog();generation++;feed.loading=false;void loadFeed();repaint();
      });
    };
  });
}
function listSettings() {
  openDialog("Curated lists",`<p>Follow a public list without following every member. Lists never change anyone’s post visibility.</p>
    <form class="cf-search" data-cf-list-search><input type="search" name="q" placeholder="Find public lists" aria-label="Find public lists"><button>${ic("search")}</button></form>
    <button class="cf-primary" data-cf-create-list>Create a list</button><div data-cf-list-results></div>`,root=>{
    root.querySelector("[data-cf-create-list]").onclick=()=>editList(null);
    const paint=items=>{
      root.querySelector("[data-cf-list-results]").innerHTML=items.map(list=>`<article class="cf-list-card">
        <h3>${e(list.name)}</h3><p>${e(list.description)}</p><small>${list.isPublic?"Public":"Private"} · ${list.members.length} visible members</small>
        <div>${list.owned?`<button data-cf-edit-list="${e(list.id)}">Edit</button>`:
          `<button data-cf-follow-list="${e(list.id)}">${list.followed?"Unfollow list":"Follow list"}</button>`}
        <button data-cf-pin-list="${e(list.id)}">${preferences.pinned.includes(`list:${list.id}`)?"Open feed":"Pin as feed"}</button></div></article>`).join("")||"<p>No lists yet. Create one or search for a public list.</p>";
      root.querySelectorAll("[data-cf-edit-list]").forEach(b=>b.onclick=()=>editList(items.find(l=>l.id===b.dataset.cfEditList)));
      root.querySelectorAll("[data-cf-follow-list]").forEach(b=>b.onclick=()=>pending(b,async()=>{
        const list=items.find(l=>l.id===b.dataset.cfFollowList);
        await request(`lists/${list.id}/follow`,{method:list.followed?"DELETE":"PUT"});
        list.followed=!list.followed;lists=Array.from(new Map([...lists,...items].map(l=>[l.id,l])).values());paint(items);
      }));
      root.querySelectorAll("[data-cf-pin-list]").forEach(b=>b.onclick=()=>pending(b,async()=>{
        const list=items.find(l=>l.id===b.dataset.cfPinList),id=`list:${list.id}`;
        if(!preferences.pinned.includes(id))await save({...preferences,pinned:[...preferences.pinned,id]});
        lists=Array.from(new Map([...lists,list].map(l=>[l.id,l])).values());closeDialog();selectFeed(id);
      }));
    };paint(lists);
    root.querySelector("form").onsubmit=event=>{
      event.preventDefault();const form=event.currentTarget;
      void pending(form.querySelector("button"),async()=>{const result=await request(`lists?q=${encodeURIComponent(form.elements.q.value.trim())}`);if(root.isConnected)paint(result.lists||[]);});
    };
  });
}
function editList(list) {
  const selected=[...(list?.members||[])];
  openDialog(list?"Edit list":"Create a list",`<form id="cf-list-editor">
    <label class="cf-field">Name<input name="name" maxlength="60" value="${e(list?.name)}" required></label>
    <label class="cf-field">Description<textarea name="description" maxlength="400">${e(list?.description)}</textarea></label>
    <label class="cf-toggle"><span>Public list</span><input type="checkbox" name="public" ${list?.isPublic?"checked":""}></label>
    <p class="cf-note">Public lists can be found and followed. Private lists are only available to you.</p>
    ${pickerMarkup}<div class="cf-selected" data-cf-selected></div><button type="submit" class="cf-primary">Save list</button>
    ${list?'<button type="button" class="cf-danger" data-cf-delete-list>Delete list</button>':""}</form>`,root=>{
    const paint=()=>{
      root.querySelector("[data-cf-selected]").innerHTML=selected.map(user=>`<button type="button" data-cf-remove="${e(user.id)}">@${e(user.username)} ${ic("close")}</button>`).join("");
      root.querySelectorAll("[data-cf-remove]").forEach(b=>b.onclick=()=>{selected.splice(selected.findIndex(u=>u.id===b.dataset.cfRemove),1);paint();});
    };paint();accountPicker(root,selected,paint);
    root.querySelector("form").onsubmit=event=>{
      event.preventDefault();const form=event.currentTarget;
      void pending(form.querySelector("button[type=submit]"),async()=>{
        const result=await request(list?`lists/${list.id}`:"lists",{method:list?"PUT":"POST",body:{
          name:form.elements.name.value.trim(),description:form.elements.description.value.trim(),
          isPublic:form.elements.public.checked,members:selected.map(u=>u.id),
        }});
        lists=[result.list,...lists.filter(l=>l.id!==result.list.id)];feed.loadedAt=0;listSettings();
      });
    };
    root.querySelector("[data-cf-delete-list]")?.addEventListener("click",event=>{
      if(!window.confirm("Delete this list? The members’ accounts and posts will not be deleted."))return;
      void pending(event.currentTarget,async()=>{
        await request(`lists/${list.id}`,{method:"DELETE"});lists=lists.filter(l=>l.id!==list.id);
        const pinned=preferences.pinned.filter(id=>id!==`list:${list.id}`);
        await save({...preferences,pinned:pinned.length?pinned:["following"]});
        if(active===`list:${list.id}`)selectFeed("following");listSettings();
      });
    });
  });
}
function languageSettings() {
  const own=feed.posts.filter(post=>(typeof post.author==="string"?post.author:post.author?.id)===dependencies.api.me()?.id);
  openDialog("Label your post language",`<p>Labels are optional and change filtering only, not the published content. Choose one of your posts on this page.</p>
    ${own.length?`<form><label class="cf-field">Your post<select name="post">${own.map(post=>`<option value="${e(post.id)}">${e((post.text||"Photo or video post").slice(0,70))}</option>`).join("")}</select></label>
    <label class="cf-field">Language<select name="language">${LANGUAGES.filter(([id])=>id!=="all").map(([id,name])=>`<option value="${id}">${name}</option>`).join("")}</select></label>
    <button class="cf-primary" type="submit">Save language label</button></form>`:"<p>Open a feed containing your Community posts, then return here.</p>"}`,root=>{
    root.querySelector("form")?.addEventListener("submit",event=>{
      event.preventDefault();const form=event.currentTarget;
      void pending(form.querySelector("button"),async()=>{
        await request(`posts/${encodeURIComponent(form.elements.post.value)}/language`,{method:"PUT",body:{language:form.elements.language.value}});
        feed.loadedAt=0;closeDialog();void loadFeed();repaint();
      });
    });
  });
}

function communityModeTabs() {
  return `<nav class="cf-community-modes" aria-label="Community sections">
    <button type="button" data-cf-mode="posts" aria-current="${clubsMode?"false":"page"}">Posts</button>
    <button type="button" data-cf-mode="clubs" aria-current="${clubsMode?"page":"false"}">Clubs</button>
  </nav>`;
}

function avatarMarkup(profile, className="") {
  const name=profile?.displayName||profile?.username||"Member";
  return profile?.avatar
    ? `<span class="${className}"><img src="${e(profile.avatar)}" alt=""></span>`
    : `<span class="${className} cf-avatar-initial" aria-hidden="true">${e(name.trim().charAt(0).toUpperCase()||"M")}</span>`;
}

function clubAvatarStack(club) {
  const people=(club.members?.length?club.members:[club.owner]).slice(0,3);
  return `<span class="cf-club-avatar-stack" aria-hidden="true">${people.map(person=>avatarMarkup(person,"cf-club-avatar")).join("")}</span>`;
}

function clubCardMarkup(club) {
  const activeMember=club.membershipStatus==="active";
  const pendingMember=club.membershipStatus==="pending";
  const memberCount=Number(club.memberCount)||0;
  const action=activeMember
    ? `<button type="button" class="cf-club-action" data-cf-club-open="${e(club.id)}">Open chat</button>`
    : pendingMember
      ? `<button type="button" class="cf-club-action" disabled>Requested</button>`
      : `<button type="button" class="cf-club-action" data-cf-club-join="${e(club.id)}">${club.privacy==="public"?"Join":"Request to join"}</button>`;
  const visibility=club.privacy==="public"?"Public":"Private";
  const mainAction=activeMember?"Open chat for":pendingMember?"View request for":club.privacy==="public"?"Join":"Request to join";
  return `<article class="cf-club-card ${activeMember?"is-joined":pendingMember?"is-pending":"is-discoverable"}">
    <div class="cf-club-card-visual">
      ${clubCoverMarkup(club,"cf-club-card-cover",false)}
      <div class="cf-club-card-topline"><span>${memberCount} ${memberCount===1?"member":"members"}</span><span>${visibility}</span></div>
      <div class="cf-club-card-overlay">
        <button type="button" class="cf-club-card-main" data-cf-club-open="${e(club.id)}" aria-label="${mainAction} ${e(club.name)}">
          <span class="cf-club-card-copy"><small>${e(club.topic)}</small><b>${e(club.name)}</b>
            ${club.description?`<span>${e(club.description)}</span>`:""}</span>
        </button>
        <div class="cf-club-card-action">${action}</div>
      </div>
    </div>
  </article>`;
}

function visibleClubs() {
  const query=clubSearch.trim().toLowerCase();
  return clubs.filter(club=>{
    const matchesTopic=clubFilter==="all"||club.topic.toLowerCase()===clubFilter;
    const matchesQuery=!query||`${club.name} ${club.topic} ${club.description}`.toLowerCase().includes(query);
    return matchesTopic&&matchesQuery;
  });
}

async function loadClubs() {
  if(clubsLoading||!owner)return;
  const account=owner;clubsLoading=true;clubsError="";
  try{
    const result=await requestClub();
    if(account!==owner)return;
    if(!Array.isArray(result.clubs))throw new Error("The server returned an incomplete Club list.");
    clubs=result.clubs;clubsLoadedAt=Date.now();
  }catch(error){if(account===owner){clubsError=errorMessage(error);clubsLoadedAt=Date.now();}}
  finally{if(account===owner){clubsLoading=false;repaint();}}
}

async function loadClubMessages(poll=false) {
  if(!selectedClub||clubMessagesLoading||clubPolling)return;
  const account=owner,clubId=selectedClub.id;
  if(poll){
    const scroller=dependencies.app.querySelector(".cf-club-messages");
    if(scroller)clubStickToBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<80;
    clubPolling=true;
  }else clubMessagesLoading=true;
  try{
    const cursorQuery=poll&&clubMessagesCursor?`?after=${encodeURIComponent(clubMessagesCursor)}`:"";
    const result=await requestClub(`/${encodeURIComponent(clubId)}/messages${cursorQuery}`);
    if(account!==owner||selectedClub?.id!==clubId)return;
    if(!Array.isArray(result.messages))throw new Error("The server returned an incomplete chat.");
    const previous=new Set(clubMessages.map(message=>message.id));
    const merged=new Map([...clubMessages,...result.messages].map(message=>[message.id,message]));
    clubMessages=[...merged.values()].sort((a,b)=>Number(a.createdAt)-Number(b.createdAt)||String(a.id).localeCompare(String(b.id))).slice(-120);
    clubMessagesCursor=result.cursor||clubMessagesCursor;
    clubMessagesLoadedAt=Date.now();clubMessagesError="";
    if(!poll)clubMessagesLoading=false;
    if(!poll||result.messages.some(message=>!previous.has(message.id)))repaint();
  }catch(error){
    if(account===owner&&selectedClub?.id===clubId&&!poll){clubMessagesLoading=false;clubMessagesError=errorMessage(error);repaint();}
  }finally{
    if(account===owner&&selectedClub?.id===clubId){
      if(poll)clubPolling=false;else clubMessagesLoading=false;
    }
  }
}

function advanceClubMessagesCursor(message) {
  if(!message?.createdAt||!message?.id)return;
  const current=clubMessagesCursor?/^(\d{1,16}):([a-f0-9-]{36})$/i.exec(clubMessagesCursor):null;
  const nextTime=Number(message.createdAt),currentTime=Number(current?.[1]||0);
  if(!current||nextTime>currentTime||(nextTime===currentTime&&String(message.id)>current[2])){
    clubMessagesCursor=`${nextTime}:${message.id}`;
  }
}

function stopClubPolling() {
  if(clubPollTimer)clearInterval(clubPollTimer);
  clubPollTimer=null;clubPolling=false;
}

function startClubPolling() {
  if(clubPollTimer)return;
  clubPollTimer=setInterval(()=>{
    if(clubsMode&&selectedClub&&(typeof document==="undefined"||document.visibilityState==="visible"))void loadClubMessages(true);
  },3000);
}

function openClubChat(club) {
  stopClubPolling();clubsMode=true;selectedClub=club;clubMessages=[];clubMessagesError="";
  clubMessagesLoading=false;clubMessagesLoadedAt=0;clubMessagesCursor=null;clubDraft="";clubSending=false;clubStickToBottom=true;
  void loadClubMessages();startClubPolling();repaint();
}

async function joinClub(club) {
  try{
    const result=await requestClub(`/${encodeURIComponent(club.id)}/join`,{method:"POST"});
    if(result.status==="active"){
      clubs=clubs.map(item=>item.id===club.id?{...item,membershipStatus:"active",membershipRole:"member",
        memberCount:(Number(item.memberCount)||0)+(item.membershipStatus==="active"?0:1)}:item);
      openClubChat({...club,membershipStatus:"active",membershipRole:"member",
        memberCount:(Number(club.memberCount)||0)+(club.membershipStatus==="active"?0:1)});
    }else{
      clubs=clubs.map(item=>item.id===club.id?{...item,membershipStatus:"pending"}:item);
      dependencies.toast("Request sent. The Club owner can approve it.");
      repaint();
    }
  }catch(error){dependencies.toast(errorMessage(error));}
}

function createClubDialog() {
  const topics=[...new Set(clubs.map(club=>club.topic).filter(Boolean))];
  const selectedCover=CLUB_COVER_DEFAULT;
  openDialog("Create a Club",`<p>Start a shared conversation around something you care about.</p>
    <form data-cf-club-editor>
      <fieldset class="cf-cover-picker">
        <legend>Club cover</legend>
        <div class="cf-cover-preview">${clubCoverMarkup({coverPresetId:selectedCover},"cf-club-cover-preview")}<span data-cf-cover-preview-label>Minimal Mesh</span></div>
        <label class="cf-cover-upload"><input name="coverFile" type="file" accept="image/jpeg,image/png,image/webp"><span>Upload your own cover</span></label>
        <div class="cf-cover-grid" role="group" aria-label="Choose a Club cover">
          ${CLUB_COVER_PRESETS.map(([id,title])=>`<button type="button" class="cf-cover-option" data-cf-cover-preset="${e(id)}" aria-label="Choose ${e(title)} cover" aria-pressed="${id===selectedCover}">
            <img src="${e(clubCoverPath(id))}" alt="" loading="lazy" decoding="async"><span>${e(title)}</span></button>`).join("")}
        </div>
        <input type="hidden" name="coverPresetId" value="${e(selectedCover)}">
        <p class="cf-note" data-cf-cover-status>Choose a preset or upload a JPG, PNG, or WebP image up to 10 MB.</p>
      </fieldset>
      <label class="cf-field">Club name <span class="cf-note">Optional</span><input name="name" maxlength="48" placeholder="New Club"></label>
      <label class="cf-field">Category <span class="cf-note">Optional</span><input name="topic" maxlength="48" list="cf-club-topics" placeholder="General">
        <datalist id="cf-club-topics">${topics.map(topic=>`<option value="${e(topic)}"></option>`).join("")}</datalist></label>
      <label class="cf-field">Description <span class="cf-note">Optional</span><textarea name="description" maxlength="400" placeholder="What brings people together?"></textarea></label>
      <label class="cf-field">Who can join?<select name="privacy">
        <option value="public">Public — anyone can join</option>
        <option value="request_to_join">Private — people request to join</option>
      </select></label>
      <p class="cf-note">Private Clubs remain discoverable, but only approved members can read or send messages.</p>
      <button type="submit" class="cf-primary">Create Club</button>
    </form>`,root=>{
    root.classList.add("cf-dialog-club-create");
    const form=root.querySelector("[data-cf-club-editor]");
    const coverFile=form.elements.coverFile;
    const coverPreset=form.elements.coverPresetId;
    const preview=form.querySelector(".cf-cover-preview img");
    const previewLabel=form.querySelector("[data-cf-cover-preview-label]");
    const coverStatus=form.querySelector("[data-cf-cover-status]");
    let customCover=null,previewObjectUrl="";
    const revokePreview=()=>{
      if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl="";
    };
    const choosePreset=id=>{
      const preset=CLUB_COVER_PRESETS.find(([key])=>key===id);
      if(!preset)return;
      customCover=null;coverFile.value="";revokePreview();
      coverPreset.value=id;preview.src=clubCoverPath(id);previewLabel.textContent=preset[1];
      coverStatus.textContent="Choose a preset or upload a JPG, PNG, or WebP image up to 10 MB.";
      form.querySelectorAll("[data-cf-cover-preset]").forEach(button=>{
        button.setAttribute("aria-pressed",String(button.dataset.cfCoverPreset===id));
      });
    };
    form.querySelectorAll("[data-cf-cover-preset]").forEach(button=>{
      button.onclick=()=>choosePreset(button.dataset.cfCoverPreset);
    });
    coverFile.addEventListener("change",()=>{
      const file=coverFile.files?.[0];
      if(!file)return;
      if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>10*1024*1024){
        coverFile.value="";customCover=null;
        failInDialog(new Error("Choose a JPG, PNG, or WebP image smaller than 10 MB."));
        return;
      }
      customCover=file;coverPreset.value="";revokePreview();
      previewObjectUrl=URL.createObjectURL(file);preview.src=previewObjectUrl;
      previewLabel.textContent=file.name||"Your uploaded cover";
      coverStatus.textContent="Your photo will be uploaded securely when you create the Club.";
      form.querySelectorAll("[data-cf-cover-preset]").forEach(button=>button.setAttribute("aria-pressed","false"));
    });
    root.addEventListener("close",revokePreview,{once:true});
    form.onsubmit=event=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      const selectedUpload=customCover;
      const selectedPreset=coverPreset.value;
      const clubDetails={
        name:form.elements.name.value.trim(),topic:form.elements.topic.value.trim(),
        description:form.elements.description.value.trim(),privacy:form.elements.privacy.value,
      };
      void pending(button,async()=>{
        let uploadedReference="";
        if(selectedUpload){
          coverStatus.textContent="Uploading your cover…";
          const {putLocalMedia}=await import("./local-media.js");
          uploadedReference=await putLocalMedia(selectedUpload,undefined,undefined,{scope:"public",role:"media"});
        }
        let result;
        try{
          result=await requestClub("",{method:"POST",body:{
            ...clubDetails,
            ...(selectedUpload?{coverMediaId:uploadedReference.replace(/^oldtime-media:/,"")}:{coverPresetId:selectedPreset}),
          }});
        }catch(error){
          if(uploadedReference){
            try{
              const {deleteLocalMedia}=await import("./local-media.js");
              await deleteLocalMedia(uploadedReference);
            }catch{}
          }
          throw error;
        }
        if(!result.club)throw new Error("The Club could not be created.");
        clubs=[result.club,...clubs.filter(item=>item.id!==result.club.id)];
        clubsLoadedAt=Date.now();closeDialog();openClubChat(result.club);
      });
    };
  });
}

function clubJoinRequestsDialog(club) {
  openDialog("Join requests",`<p>Approve people to add them to the shared chat.</p><div class="cf-club-request-list" data-cf-club-requests-list>Loading requests…</div>`,root=>{
    const list=root.querySelector("[data-cf-club-requests-list]");
    const paint=requests=>{
      list.innerHTML=requests.length?requests.map(person=>`<article class="cf-club-request">
        ${avatarMarkup(person,"cf-club-avatar")}<span><b>${e(person.displayName||person.username)}</b><small>@${e(person.username)}</small></span>
        <button type="button" data-cf-club-decision="approve" data-member-id="${e(person.id)}">Approve</button>
        <button type="button" data-cf-club-decision="decline" data-member-id="${e(person.id)}">Decline</button>
      </article>`).join(""):"<p>No pending requests.</p>";
      root.querySelectorAll("[data-cf-club-decision]").forEach(button=>button.onclick=()=>void pending(button,async()=>{
        await requestClub(`/${encodeURIComponent(club.id)}/requests/${encodeURIComponent(button.dataset.memberId)}`,{
          method:"POST",body:{decision:button.dataset.cfClubDecision},
        });
        if(button.dataset.cfClubDecision==="approve")club.memberCount=(Number(club.memberCount)||0)+1;
        const result=await requestClub(`/${encodeURIComponent(club.id)}/requests`);
        paint(result.requests||[]);clubsLoadedAt=0;repaint();
      }));
    };
    void requestClub(`/${encodeURIComponent(club.id)}/requests`)
      .then(result=>{if(root.isConnected)paint(result.requests||[]);})
      .catch(error=>{if(root.isConnected)list.textContent=errorMessage(error);});
  });
}

function clubCoverEditDialog(club) {
  const currentPreset=CLUB_COVER_PRESETS.some(([id])=>id===club.coverPresetId)?club.coverPresetId:"";
  openDialog("Change Club cover",`<p>Choose a preset or upload a new cover image.</p>
    <form data-cf-club-cover-editor>
      <div class="cf-cover-preview">${clubCoverMarkup(club,"cf-club-cover-preview")}<span data-cf-cover-preview-label>${e(currentPreset?CLUB_COVER_PRESETS.find(([id])=>id===currentPreset)?.[1]:"Current cover")}</span></div>
      <label class="cf-cover-upload"><input name="coverFile" type="file" accept="image/jpeg,image/png,image/webp"><span>Upload a new cover</span></label>
      <div class="cf-cover-grid" role="group" aria-label="Choose a Club cover">
        ${CLUB_COVER_PRESETS.map(([id,title])=>`<button type="button" class="cf-cover-option" data-cf-cover-preset="${e(id)}" aria-label="Choose ${e(title)} cover" aria-pressed="${id===currentPreset}">
          <img src="${e(clubCoverPath(id))}" alt="" loading="lazy" decoding="async"><span>${e(title)}</span></button>`).join("")}
      </div>
      <input type="hidden" name="coverPresetId" value="${e(currentPreset)}">
      <p class="cf-note" data-cf-cover-status>Save to apply the new cover to this Club.</p>
      <button type="submit" class="cf-primary">Save cover</button>
    </form>`,root=>{
    root.classList.add("cf-dialog-club-create");
    const form=root.querySelector("[data-cf-club-cover-editor]");
    const coverFile=form.elements.coverFile,coverPreset=form.elements.coverPresetId;
    const preview=form.querySelector(".cf-cover-preview img");
    const previewLabel=form.querySelector("[data-cf-cover-preview-label]");
    const status=form.querySelector("[data-cf-cover-status]");
    let customCover=null,previewObjectUrl="";
    const revokePreview=()=>{
      if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl="";
    };
    const choosePreset=id=>{
      const preset=CLUB_COVER_PRESETS.find(([key])=>key===id);
      if(!preset)return;
      customCover=null;coverFile.value="";revokePreview();
      coverPreset.value=id;preview.removeAttribute("data-cf-club-cover-media");
      preview.src=clubCoverPath(id);previewLabel.textContent=preset[1];
      status.textContent="Preset selected. Save to apply it.";
      form.querySelectorAll("[data-cf-cover-preset]").forEach(button=>{
        button.setAttribute("aria-pressed",String(button.dataset.cfCoverPreset===id));
      });
    };
    form.querySelectorAll("[data-cf-cover-preset]").forEach(button=>{
      button.onclick=()=>choosePreset(button.dataset.cfCoverPreset);
    });
    coverFile.addEventListener("change",()=>{
      const file=coverFile.files?.[0];
      if(!file)return;
      if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>10*1024*1024){
        coverFile.value="";customCover=null;
        failInDialog(new Error("Choose a JPG, PNG, or WebP image smaller than 10 MB."));
        return;
      }
      customCover=file;coverPreset.value="";revokePreview();
      preview.removeAttribute("data-cf-club-cover-media");
      previewObjectUrl=URL.createObjectURL(file);preview.src=previewObjectUrl;
      previewLabel.textContent=file.name||"Your uploaded cover";
      status.textContent="Your photo will be uploaded securely when you save.";
      form.querySelectorAll("[data-cf-cover-preset]").forEach(button=>button.setAttribute("aria-pressed","false"));
    });
    root.addEventListener("close",revokePreview,{once:true});
    loadClubCoverMedia(root);
    form.onsubmit=event=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      const selectedUpload=customCover,selectedPreset=coverPreset.value;
      if(!selectedUpload&&!selectedPreset){
        failInDialog(new Error("Choose a preset or upload a new cover."));
        return;
      }
      void pending(button,async()=>{
        let uploadedReference="";
        if(selectedUpload){
          status.textContent="Uploading your cover…";
          const {putLocalMedia}=await import("./local-media.js");
          uploadedReference=await putLocalMedia(selectedUpload,undefined,undefined,{scope:"public",role:"media"});
        }
        try{
          const result=await requestClub(`/${encodeURIComponent(club.id)}/cover`,{
            method:"PATCH",body:selectedUpload
              ?{coverMediaId:uploadedReference.replace(/^oldtime-media:/,"")}
              :{coverPresetId:selectedPreset},
          });
          if(!result.club)throw new Error("The Club cover could not be updated.");
          clubs=clubs.map(item=>item.id===club.id?result.club:item);
          if(selectedClub?.id===club.id)selectedClub=result.club;
          closeDialog();repaint();dependencies.toast("Club cover updated.");
        }catch(error){
          if(uploadedReference){
            try{
              const {deleteLocalMedia}=await import("./local-media.js");
              await deleteLocalMedia(uploadedReference);
            }catch{}
          }
          throw error;
        }
      });
    };
  },null);
}

function clubDeleteConfirmationDialog(club) {
  openDialog("Delete group chat",`<p>This permanently deletes the Club, its shared messages, members, and requests for everyone. Any existing posts remain, but are detached from the Club. This cannot be undone.</p>
    <form data-cf-club-delete-form>
      <label class="cf-field">Type <b>${e(club.name)}</b> to confirm<input name="confirmation" maxlength="48" autocomplete="off" placeholder="Club name" required></label>
      <button type="submit" class="cf-danger" disabled>Delete group chat</button>
      <button type="button" class="cf-club-cancel-delete" data-cf-club-cancel-delete>Cancel</button>
    </form>`,root=>{
    const form=root.querySelector("[data-cf-club-delete-form]");
    const input=form.elements.confirmation;
    const button=form.querySelector('button[type="submit"]');
    input.addEventListener("input",()=>{button.disabled=input.value.trim()!==club.name;});
    root.querySelector("[data-cf-club-cancel-delete]").onclick=closeDialog;
    form.onsubmit=event=>{
      event.preventDefault();
      if(input.value.trim()!==club.name)return;
      void pending(button,async()=>{
        const result=await requestClub(`/${encodeURIComponent(club.id)}`,{
          method:"DELETE",body:{confirmation:input.value.trim()},
        });
        if(result.deleted!==true)throw new Error("The Club could not be deleted.");
        clubs=clubs.filter(item=>item.id!==club.id);clubsLoadedAt=Date.now();
        if(selectedClub?.id===club.id){
          selectedClub=null;clubMessages=[];clubMessagesCursor=null;clubDraft="";clubSending=false;
          stopClubPolling();
        }
        closeDialog();repaint();dependencies.toast("The Club and its shared chat were deleted.");
      });
    };
  },null);
}

function clubManageDialog(club) {
  const isOwner=club.membershipRole==="owner";
  const canReview=["owner","admin"].includes(club.membershipRole);
  openDialog("Club settings",`<p>Manage this shared Club chat.</p>
    <div class="cf-menu">
      <button type="button" data-cf-club-change-cover>${ic("image")}<span>Change Club cover<small>Choose another preset or upload your own</small></span></button>
      ${canReview?`<button type="button" data-cf-club-open-requests>${ic("users")}<span>Join requests<small>Review people waiting to join</small></span></button>`:""}
      ${isOwner?`<button type="button" class="cf-club-delete-setting" data-cf-club-delete>${ic("trash")}<span>Delete group chat<small>Remove this Club and its messages for everyone</small></span></button>`:""}
    </div>`,root=>{
    root.querySelector("[data-cf-club-change-cover]").onclick=()=>{
      closeDialog();clubCoverEditDialog(club);
    };
    root.querySelector("[data-cf-club-open-requests]")?.addEventListener("click",()=>{
      closeDialog();clubJoinRequestsDialog(club);
    });
    root.querySelector("[data-cf-club-delete]")?.addEventListener("click",()=>{
      closeDialog();clubDeleteConfirmationDialog(club);
    });
  },null);
}

function renderClubsView(deps) {
  const modeTabs=communityModeTabs();
  if(selectedClub){
    const ownId=deps.api.me()?.id;
    const canReview=["owner","admin"].includes(selectedClub.membershipRole);
    const messages=clubMessages.map(message=>{
      const mine=message.author?.id===ownId;
      const time=new Date(Number(message.createdAt)||Date.now()).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
      return `<article class="cf-club-message ${mine?"is-own":""} ${message.pending?"is-pending":""}">
        ${avatarMarkup(message.author,"cf-club-avatar")}
        <div class="cf-club-message-body"><header><b>${e(message.author?.displayName||message.author?.username||"Member")}</b><time>${e(time)}</time></header><p>${e(message.body)}</p></div>
      </article>`;
    }).join("");
    deps.shell(`<section class="screen on community-screen cf-screen" aria-label="Community Club chat" data-scroll-context="community:clubs:${e(selectedClub.id)}">
      <div class="stories-feed-scroll" data-scroll-preserve="community-club-chat">
        <header class="community-header"><h1>Community</h1><div class="community-header-actions">
          <button class="community-search-button" data-cf-search aria-label="Search">${ic("search")}</button>
          <button type="button" class="community-new-post compose-trigger" data-cf-compose aria-label="New post">${ic("compose")}</button></div></header>
        ${modeTabs}
        <header class="cf-club-chat-header">
          <button type="button" class="cf-club-back" data-cf-club-back><span aria-hidden="true">&larr;</span><span>Clubs</span></button>
          <div><h2>${e(selectedClub.name)}</h2><p>${e(selectedClub.topic)} · ${Number(selectedClub.memberCount)||0} ${Number(selectedClub.memberCount)===1?"member":"members"}</p></div>
          ${selectedClub.membershipRole==="owner"?`<button type="button" class="cf-club-requests-button" data-cf-club-manage>Manage</button>`:
            canReview?`<button type="button" class="cf-club-requests-button" data-cf-club-requests>Requests</button>`:""}
        </header>
        <div class="cf-club-chat-cover">${clubCoverMarkup(selectedClub,"cf-club-cover-banner")}</div>
        ${clubMessagesError?`<div class="cf-error" role="alert">${e(clubMessagesError)} <button data-cf-club-retry>Try again</button></div>`:""}
        <div class="cf-club-messages" aria-label="Messages" aria-live="polite">
          ${clubMessagesLoading&&!clubMessages.length?`<div class="cf-club-chat-empty">Loading chat…</div>`:
            messages||`<div class="cf-club-chat-empty"><h3>Start the conversation</h3><p>Send the first message to your Club.</p></div>`}
        </div>
        <form class="cf-club-composer" data-cf-club-composer>
          <label class="sr-only" for="cf-club-message">Message ${e(selectedClub.name)}</label>
          <textarea id="cf-club-message" name="body" maxlength="2000" rows="1" placeholder="Message the Club" required>${e(clubDraft)}</textarea>
          <button type="submit" aria-label="Send message" ${clubSending?"disabled":""}>Send</button>
        </form>
      </div></section>`,"light");
    loadClubCoverMedia(deps.app);
    if(clubStickToBottom){
      const scrollToBottom=()=>{const scroller=deps.app.querySelector(".cf-club-messages");if(scroller)scroller.scrollTop=scroller.scrollHeight;clubStickToBottom=false;};
      if(typeof requestAnimationFrame==="function")requestAnimationFrame(scrollToBottom);else clubStickToBottom=false;
    }
    deps.app.querySelectorAll("[data-cf-mode]").forEach(button=>button.onclick=()=>{
      if(button.dataset.cfMode==="posts"){clubsMode=false;stopClubPolling();repaint();}
    });
    deps.app.querySelector("[data-cf-search]")?.addEventListener("click",deps.onSearch);
    deps.app.querySelector("[data-cf-compose]")?.addEventListener("click",()=>{invalidateCommunityFeeds();deps.onCompose();});
    deps.app.querySelector("[data-cf-club-back]")?.addEventListener("click",()=>{
      selectedClub=null;clubMessages=[];clubMessagesCursor=null;clubDraft="";clubSending=false;
      stopClubPolling();clubsLoadedAt=0;repaint();
    });
    deps.app.querySelector("[data-cf-club-manage]")?.addEventListener("click",()=>clubManageDialog(selectedClub));
    deps.app.querySelector("[data-cf-club-requests]")?.addEventListener("click",()=>clubJoinRequestsDialog(selectedClub));
    deps.app.querySelector("[data-cf-club-retry]")?.addEventListener("click",()=>{clubMessagesLoadedAt=0;void loadClubMessages();});
    const form=deps.app.querySelector("[data-cf-club-composer]");
    form?.elements?.body?.addEventListener("input",()=>{clubDraft=form.elements.body.value;});
    form?.addEventListener("submit",event=>{
      event.preventDefault();
      const content=form.elements.body.value.trim(),club=selectedClub;
      if(!content||!club||clubSending)return;
      const id=crypto.randomUUID(),me=deps.api.me()||{};
      const optimistic={id,body:content,createdAt:Date.now(),pending:true,author:{
        id:me.id,username:me.username||"you",displayName:me.displayName||me.name||"You",
        avatar:me.avatar||me.avatarUrl||me.profileImage||"",
      }};
      clubMessages=[...clubMessages,optimistic];clubDraft="";clubSending=true;
      clubMessagesError="";clubStickToBottom=true;repaint();
      void (async()=>{
        try{
          const result=await requestClub(`/${encodeURIComponent(club.id)}/messages`,{
            method:"POST",body:{id,body:content},
          });
          if(selectedClub?.id!==club.id)return;
          if(!result.message)throw new Error("The message could not be confirmed.");
          clubMessages=[...clubMessages.filter(message=>message.id!==id),result.message];
          clubMessages.sort((a,b)=>Number(a.createdAt)-Number(b.createdAt)||String(a.id).localeCompare(String(b.id)));
          advanceClubMessagesCursor(result.message);
          clubMessagesError="";clubMessagesLoadedAt=Date.now();clubStickToBottom=true;
        }catch(error){
          if(selectedClub?.id!==club.id)return;
          clubMessages=clubMessages.filter(message=>message.id!==id);
          if(!clubDraft)clubDraft=content;
          clubMessagesError=errorMessage(error);clubStickToBottom=true;
        }finally{
          if(selectedClub?.id===club.id){
            clubSending=false;repaint();
            if(!clubMessagesError&&typeof requestAnimationFrame==="function"){
              requestAnimationFrame(()=>deps.app.querySelector("#cf-club-message")?.focus({preventScroll:true}));
            }
          }
        }
      })();
    });
    return;
  }

  const filtered=visibleClubs(),topics=[...new Set(clubs.map(club=>club.topic).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const categories=`<div class="cf-club-categories" aria-label="Club categories">
    <button type="button" data-cf-club-topic="all" aria-pressed="${clubFilter==="all"}"><span class="cf-club-avatar-stack cf-category-stack">${clubs.slice(0,3).map(club=>avatarMarkup(club.owner,"cf-club-avatar")).join("")}</span><b>All</b></button>
    ${topics.map(topic=>{
      const group=clubs.filter(club=>club.topic.toLowerCase()===topic.toLowerCase());
      return `<button type="button" data-cf-club-topic="${e(topic.toLowerCase())}" aria-pressed="${clubFilter===topic.toLowerCase()}">
        <span class="cf-club-avatar-stack cf-category-stack">${group.slice(0,3).map(club=>avatarMarkup(club.owner,"cf-club-avatar")).join("")}</span><b>${e(topic)}</b></button>`;
    }).join("")}
  </div>`;
  const yours=filtered.filter(club=>club.membershipStatus==="active");
  const discover=filtered.filter(club=>club.membershipStatus!=="active");
  const yourMarkup=yours.map(clubCardMarkup).join("");
  const discoverMarkup=discover.map(clubCardMarkup).join("");
  deps.shell(`<section class="screen on community-screen cf-screen" aria-label="Community Clubs" data-scroll-context="community:clubs">
    <div class="stories-feed-scroll" data-scroll-preserve="community-clubs">
      <header class="community-header"><h1>Community</h1><div class="community-header-actions">
        <button class="community-search-button" data-cf-search aria-label="Search">${ic("search")}</button>
        <button type="button" class="community-new-post compose-trigger" data-cf-compose aria-label="New post">${ic("compose")}</button></div></header>
      ${modeTabs}
      <section class="cf-club-library">
        <header class="cf-club-library-heading"><div><h2>Clubs</h2><p>${clubs.length} ${clubs.length===1?"space":"spaces"} to talk</p></div>
          <button type="button" class="cf-primary" data-cf-club-create>Create Club</button></header>
        ${categories}
        <form class="cf-club-search" data-cf-club-search><input type="search" name="query" value="${e(clubSearch)}" placeholder="Search Clubs and categories" aria-label="Search Clubs and categories"><button type="submit">${ic("search")}</button></form>
        ${clubsError?`<div class="cf-error" role="alert">Clubs couldn’t load. <button data-cf-club-reload>Try again</button></div>`:""}
        ${clubsLoading&&!clubs.length?`<div class="cf-skeletons" role="status" aria-label="Loading Clubs">${[1,2,3].map(()=>'<div><i></i><span></span><span></span></div>').join("")}</div>`:""}
        ${(!clubsLoading&&!clubsError)||clubs.length?`<section class="cf-club-section cf-club-section--yours"><header><h3>Your Clubs</h3><span>${yours.length}</span></header>
          <div class="cf-club-grid cf-club-grid--yours">${yourMarkup||`<p class="cf-club-section-empty">Clubs you join will appear here and open straight into their shared chats.</p>`}</div></section>
          <section class="cf-club-section cf-club-section--discover"><header><h3>Discover Clubs</h3><span>${discover.length}</span></header>
          <div class="cf-club-grid cf-club-grid--discover">${discoverMarkup||`<p class="cf-club-section-empty">${filtered.length?"You’re in every matching Club.":"No Clubs match this search or category yet."}</p>`}</div></section>`:""}
      </section>
    </div></section>`,"light");
  loadClubCoverMedia(deps.app);
  deps.app.querySelectorAll("[data-cf-mode]").forEach(button=>button.onclick=()=>{
    if(button.dataset.cfMode==="posts"){clubsMode=false;stopClubPolling();repaint();}
  });
  deps.app.querySelector("[data-cf-search]")?.addEventListener("click",deps.onSearch);
  deps.app.querySelector("[data-cf-compose]")?.addEventListener("click",()=>{invalidateCommunityFeeds();deps.onCompose();});
  deps.app.querySelectorAll("[data-cf-club-create]").forEach(button=>button.onclick=createClubDialog);
  deps.app.querySelectorAll("[data-cf-club-topic]").forEach(button=>button.onclick=()=>{
    clubFilter=button.dataset.cfClubTopic||"all";repaint();
  });
  deps.app.querySelector("[data-cf-club-search]")?.addEventListener("submit",event=>{
    event.preventDefault();clubSearch=event.currentTarget.elements.query.value.trim();repaint();
  });
  deps.app.querySelectorAll("[data-cf-club-open]").forEach(button=>button.onclick=()=>{
    const club=clubs.find(item=>item.id===button.dataset.cfClubOpen);if(!club)return;
    if(club.membershipStatus==="active")openClubChat(club);
    else if(club.membershipStatus==="pending")dependencies.toast("Your request is waiting for Club approval.");
    else void joinClub(club);
  });
  deps.app.querySelectorAll("[data-cf-club-join]").forEach(button=>button.onclick=()=>{
    const club=clubs.find(item=>item.id===button.dataset.cfClubJoin);if(club)void joinClub(club);
  });
  deps.app.querySelector("[data-cf-club-reload]")?.addEventListener("click",()=>{clubsLoadedAt=0;void loadClubs();});
}

export function renderCommunityFeeds(deps) {
  dependencies=deps;
  const id=deps.api.cloudAccountId()||"";
  if(owner!==id){reset(id);if(id)void loadSettings();}
  if(!id)return;
  const me=deps.api.me(),relationships=JSON.stringify([me?.following,me?.friends,deps.api.db()?.blocks]);
  if(relationshipKey!==relationships){relationshipKey=relationships;invalidateFeeds();}
  if(clubsMode){
    if(selectedClub){
      if(!clubMessagesLoading&&!clubMessagesLoadedAt)void loadClubMessages();
      startClubPolling();
    }else if(!clubsLoading&&Date.now()-clubsLoadedAt>30000)void loadClubs();
    renderClubsView(deps);return;
  }
  if(!settingsLoading&&!feed.loading&&!feed.error&&Date.now()-feed.loadedAt>30000)void loadFeed();
  const recommended=["discover","popular","media"].includes(active)&&!settingsLoading&&!settingsError&&!preferences.filters?.[active]?.onlyFollowing;
  if(recommended&&!suggestions.loading&&Date.now()-suggestions.loadedAt>60000)void loadSuggestions();
  const dismissedSuggestions=readSuggestionDismissals();
  const people=recommended?suggestions.people.filter(suggestion=>{
    const person=suggestion.profile||suggestion.person||suggestion,id=person.id;
    return id&&id!==owner&&id!==me?.id&&!me?.following?.includes(id)&&!preferences.mutedAccounts.includes(id)&&!deps.api.blocked(me.id,id);
  }):[];
  const sharedInterestPeople=people.filter(sharesInterests);
  const otherPeople=people.filter(person=>!sharesInterests(person));
  const description=active==="following"?"Chronological posts and optional reposts from people you follow. No recommendations.":
    active==="discover"?"Public Community posts from people you don’t follow, ranked by your interests, engagement and recency. Your filters always apply.":
    active==="popular"?"Community posts from the past 7 days, ordered by likes, comments and reposts.":
    active==="friends"?"Posts from your mutual follows and accepted friends, newest first.":
    active==="media"?"Community photo and video posts, newest first.":"Posts from this list’s members, newest first.";
  const posts=feed.posts.map(post=>deps.api.cloudPost(post.id)).filter(Boolean);
  const stamp=feed.caughtUpAt, newer=stamp?posts.filter(post=>Number(post.createdAt)>stamp).length:0;
  deps.shell(`<section class="screen on community-screen cf-screen" aria-label="Community" data-scroll-context="community:${e(active)}">
      <div class="stories-feed-scroll" data-scroll-preserve="community-feed">
      <header class="community-header"><h1>Community</h1><div class="community-header-actions">
        <button class="community-search-button" data-cf-search aria-label="Search">${ic("search")}</button>
        <button type="button" class="community-new-post compose-trigger" data-cf-compose aria-label="New post">${ic("compose")}</button></div></header>
      ${communityModeTabs()}
      <div class="cf-feed-header"><nav class="cf-feed-tabs" aria-label="Pinned Community feeds">${preferences.pinned.map(id=>`<button type="button" data-cf-feed="${e(id)}" aria-current="${active===id?"page":"false"}">${e(label(id))}</button>`).join("")}</nav>
      <button class="cf-controls" data-cf-controls aria-label="Community feed controls">${ic("more")}</button></div>
      ${stamp?`<div class="cf-caught-up">${ic("check")}<span>${newer?`${newer} newer ${newer===1?"post":"posts"} on this page`:"You’re caught up on this page"}</span></div>`:""}
      ${suggestedPeopleMarkup(otherPeople.slice(0,6),"People you may like","people",dismissedSuggestions)}
      ${recommended&&suggestions.error?`<div class="cf-suggestion-error" role="status">People suggestions couldn’t load. <button data-cf-people-retry>Retry</button></div>`:""}
      ${feed.error?`<div class="cf-error" role="alert">${e(feed.error)} <button data-cf-reload>Try again</button></div>`:""}
       <div class="community-content-grid">${posts.map((post,index)=>`${feed.reason?`<details class="cf-why"><summary>Why am I seeing this?</summary><p>${e(feed.reasons?.[post.id]||feed.reason)}</p></details>`:""}${deps.renderPost(post)}${index===5?suggestedPeopleMarkup(otherPeople.slice(6),"More people to discover","more-people",dismissedSuggestions):""}`).join("")}</div>
      ${feed.loading&&!posts.length?`<div class="cf-skeletons" role="status" aria-label="Loading Community posts">${[1,2,3].map(()=>'<div><i></i><span></span><span></span></div>').join("")}</div>`:""}
      ${!feed.loading&&!posts.length&&!feed.error?`<section class="cf-empty">${ic("users")}<h2>${active==="friends"?"No posts from mutuals yet":"No posts in this feed yet"}</h2><p>${active==="friends"?"Follow people who follow you back to see them here.":active==="discover"&&preferences.filters[active]?.onlyFollowing?"Discover excludes followed accounts. Turn off “Only people I follow” to see recommendations.":"Try another feed, follow more people, or adjust this feed’s preferences."}</p><button data-cf-controls>Adjust preferences</button><button data-cf-search>Find people and posts</button></section>`:""}
      <div class="cf-footer">${feed.hasMore?`<button data-cf-more ${feed.loading?"disabled":""}>${feed.loading?"Loading…":"Load more"}</button>`:""}
      ${posts.length?`<button data-cf-catch-up>${ic("check")}Mark caught up</button>`:""}</div>
       ${suggestedPeopleMarkup(sharedInterestPeople,"People who share your interests","shared-interests",dismissedSuggestions)}
    </div></section>`,"light");
  deps.bindPosts();
  const pull=deps.app.querySelector(".stories-feed-scroll");
  let pullStart=null;
  pull?.addEventListener("touchstart",event=>{
    const touch=event.touches[0];
    pullStart=pull.scrollTop<=0&&touch&&!feed.loading?{x:touch.clientX,y:touch.clientY}:null;
  },{passive:true});
  pull?.addEventListener("touchend",event=>{
    const touch=event.changedTouches[0],start=pullStart;pullStart=null;
    if(start&&touch&&touch.clientY-start.y>75&&Math.abs(touch.clientX-start.x)<40&&!feed.loading)void loadFeed();
  },{passive:true});
  deps.app.querySelectorAll("[data-cf-mode]").forEach(button=>button.onclick=()=>{
    if(button.dataset.cfMode==="clubs"){clubsMode=true;clubsLoadedAt=0;repaint();}
  });
  deps.app.querySelectorAll("[data-cf-feed]").forEach(b=>b.onclick=()=>selectFeed(b.dataset.cfFeed));
  deps.app.querySelectorAll("[data-cf-search]").forEach(b=>b.onclick=deps.onSearch);
  deps.app.querySelectorAll("[data-cf-suggestions-dismiss]").forEach(button=>button.onclick=()=>{
    dismissSuggestionsForNow(button.dataset.cfSuggestionsDismiss);
    repaint();
  });
  deps.app.querySelectorAll("[data-cf-profile]").forEach(b=>b.onclick=()=>deps.onProfile(b.dataset.cfProfile));
  deps.app.querySelectorAll("[data-cf-follow]").forEach(b=>b.onclick=async()=>{
    b.disabled=true;const account=owner;
    try{await deps.onFollow(b.dataset.cfFollow);if(account===owner){feed.loadedAt=0;suggestions.loadedAt=0;repaint();}}
    catch(error){deps.toast(errorMessage(error));}
    finally{if(b.isConnected)b.disabled=false;}
  });
  deps.app.querySelector("[data-cf-people-retry]")?.addEventListener("click",()=>{void loadSuggestions();repaint();});
  deps.app.querySelector("[data-cf-compose]").onclick=()=>{invalidateCommunityFeeds();deps.onCompose();};
  deps.app.querySelectorAll("[data-cf-controls]").forEach(b=>b.onclick=()=>{
    if(settingsLoading)return deps.toast("Your feed controls are loading.");
    if(settingsError){void loadSettings();return deps.toast("Retrying your feed controls.");}
    settingsMenu(b);
  });
  deps.app.querySelectorAll("[data-cf-reload]").forEach(b=>b.onclick=()=>{feed.loadedAt=0;feed.error="";void loadFeed();repaint();});
  deps.app.querySelector("[data-cf-settings-retry]")?.addEventListener("click",()=>{void loadSettings();});
  deps.app.querySelector("[data-cf-more]")?.addEventListener("click",()=>{void loadFeed(true);repaint();});
  deps.app.querySelector("[data-cf-catch-up]")?.addEventListener("click",async event=>{
    const button=event.currentTarget,account=owner,selected=active;button.disabled=true;
    try{const result=await request("catch-up",{method:"POST",body:{feed:selected}});if(owner===account&&active===selected){feed.caughtUpAt=result.caughtUpAt;repaint();}}
    catch(error){deps.toast(errorMessage(error));}finally{if(button.isConnected)button.disabled=false;}
  });
}
export function invalidateCommunityFeeds() { feed.loadedAt=0;feed.error=""; }
export function retryCommunityFeeds() { reset(""); }
export function showPublishedPost(post) {
  const currentUser=dependencies?.api.me();
  const authorId=typeof post?.author==="string"?post.author:post?.author?.id;
  if(!post?.id||!["community","both"].includes(post.destination)||authorId!==currentUser?.id)return false;
  if(clubsMode){clubsMode=false;stopClubPolling();}
  if(active!=="discover"){
    const scroller=dependencies.app.querySelector(".stories-feed-scroll");
    feedCache.set(active,{...feed,loading:false,scrollTop:scroller?.scrollTop||0});
    active="discover";
    feed=feedCache.get(active)||{posts:[],loading:false,error:"",hasMore:false,nextOffset:0,loadedAt:0,reason:null,caughtUpAt:null};
  }
  const alreadyListed=feed.posts.some(item=>item.id===post.id);
  feed={...feed,posts:[post,...feed.posts.filter(item=>item.id!==post.id)],loading:false,
    nextOffset:Math.max(0,Number(feed.nextOffset)||0)+(alreadyListed?0:1),loadedAt:Date.now()};
  restoreScroll=0;
  feedCache.set(active,{...feed});
  return true;
}
if(typeof window!=="undefined")window.addEventListener("oldtime-cloud-session-changed",()=>reset(""));
if(typeof window!=="undefined")window.addEventListener("oldtime-data",()=>invalidateCommunityFeeds());
