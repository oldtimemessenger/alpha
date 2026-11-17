import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function moduleUnderTest(label) {
  const source=(await readFile(new URL("./community-feeds.js",import.meta.url),"utf8")).replace(/^import "\.\/community-feeds\.css";\s*/,"");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${label}`);
}
const account="11111111-1111-4111-8111-111111111111";
const preferences={pinned:["following","discover","popular","friends","media"],filters:{},mutedWords:[],mutedAccounts:[],caughtUp:{}};
function dependencies(module,respond){
  const node={addEventListener(){},setAttribute(){},dataset:{},style:{}};
  const state={html:"",renders:0,unavailable:0,calls:[]};
  const deps={
    api:{
      cloudAccountId:()=>account,me:()=>({id:account,following:[],friends:[]}),
      cloudPost:()=>null,cacheCloudExplorePosts:posts=>posts,blocked:()=>false,
      db:()=>({requests:[],blocks:[]}),
    },
    requestCloudApi:async(path,options)=>{state.calls.push(path);return respond(path,options);},
    app:{querySelector:()=>node,querySelectorAll:()=>[]},
    shell:html=>{state.html=html;},esc:value=>String(value??""),icon:()=>"",toast(){},
    renderPost:()=>"<article>Fixture post</article>",bindPosts(){},isActive:()=>true,
    onCompose(){},onSearch(){},onProfile(){},onFollow(){},
    onUnavailable(){state.unavailable++;},
    refresh(){
      state.renders++;
      assert.ok(state.renders<12,"render must not refetch continuously when a cached post is absent");
      if(!state.unavailable)module.renderCommunityFeeds(deps);
    },
  };
  return {deps,state};
}
const settled=()=>new Promise(resolve=>setTimeout(resolve,25));

test("The default Community header keeps exactly four core tabs through loading and network errors",async()=>{
  const module=await moduleUnderTest("four-default-tabs");
  const {deps,state}=dependencies(module,async()=>{throw new Error("Offline");});
  const pinned=()=>[...state.html.matchAll(/data-cf-feed="([^"]+)"/g)].map(match=>match[1]);
  module.renderCommunityFeeds(deps);
  assert.deepEqual(pinned(),["following","discover","popular","friends"]);
  await settled();
  assert.deepEqual(pinned(),["following","discover","popular","friends"]);
});

test("unavailable preferences never switch to the legacy screen or loop requests",async()=>{
  const module=await moduleUnderTest("older-server");
  const {deps,state}=dependencies(module,async path=>{
    if(path.endsWith("/preferences"))throw Object.assign(new Error("Not found"),{status:404});
    if(path.includes("/lists"))return {lists:[]};
    if(path.includes("/people"))return {suggestions:[]};
    return {posts:[],hasMore:false,nextOffset:0};
  });
  module.renderCommunityFeeds(deps);await settled();
  assert.equal(state.unavailable,0);
  assert.equal(state.calls.filter(path=>path.endsWith("/preferences")).length,1);
});

test("Discover is the starting feed and missing cached posts cannot start a refetch loop",async()=>{
  const module=await moduleUnderTest("bounded-cache-miss");
  const {deps,state}=dependencies(module,async path=>{
    if(path.endsWith("/preferences"))return {preferences,mutedAccounts:[]};
    if(path.includes("/lists"))return {lists:[]};
    if(path.includes("/people"))return {suggestions:[{profile:{id:"other",username:"genuine_member",displayName:"Genuine Member"}}]};
    return {posts:[{id:"cache-missing",author:{id:"other"},text:"Fixture"}],hasMore:false,nextOffset:1};
  });
  module.renderCommunityFeeds(deps);await settled();
  assert.equal(state.calls.filter(path=>path.includes("/community/feed?")).length,1);
  assert.match(state.calls.find(path=>path.includes("/community/feed?"))||"",/feed=discover/);
  assert.match(state.html,/People you may like/);
  assert.match(state.html,/Genuine Member/);
});

test("Community feed selector is centered with a three-dot controls trigger",async()=>{
  const module=await moduleUnderTest("centered-community-selector");
  const {deps,state}=dependencies(module,async path=>{
    if(path.endsWith("/preferences"))return {preferences,mutedAccounts:[]};
    if(path.includes("/lists"))return {lists:[]};
    if(path.includes("/people"))return {suggestions:[]};
    return {posts:[],hasMore:false,nextOffset:0};
  });
  deps.icon=name=>`<svg data-icon="${name}"></svg>`;
  module.renderCommunityFeeds(deps);await settled();
  assert.match(state.html,/<div class="cf-feed-header"><nav class="cf-feed-tabs"/);
  assert.match(state.html,/<button class="cf-controls" data-cf-controls aria-label="Community feed controls"><svg data-icon="more"><\/svg><\/button>/);
});

test("shared-interest suggestions have their own row without duplicating general suggestions",async()=>{
  const module=await moduleUnderTest("separate-interest-row");
  const {deps,state}=dependencies(module,async path=>{
    if(path.endsWith("/preferences"))return {preferences,mutedAccounts:[]};
    if(path.includes("/lists"))return {lists:[]};
    if(path.includes("/people"))return {suggestions:[
      {profile:{id:"general",username:"general_member"},reason:"mutual-followers"},
      {profile:{id:"shared",username:"shared_member"},sharedInterests:["Music"]},
      {profile:{id:"matching",username:"matching_member"},sharedInterests:[],matchingInterests:["Art"]},
      {profile:{id:"blocked",username:"blocked_member"},sharedInterests:["Music"]},
      {profile:{id:"followed",username:"followed_member"},sharedInterests:["Music"]},
    ]};
    return {posts:[],hasMore:false,nextOffset:0};
  });
  deps.api.blocked=(_,id)=>id==="blocked";
  deps.api.me=()=>({id:account,following:["followed"],friends:[]});
  module.renderCommunityFeeds(deps);await settled();
  const sections=[...state.html.matchAll(/<section class="cf-suggestions"[^>]*>[\s\S]*?<\/section>/g)].map(match=>match[0]);
  assert.equal(sections.length,2);
  assert.match(sections[0],/People you may like/);
  assert.match(sections[0],/@general_member/);
  assert.doesNotMatch(sections[0],/@shared_member|@matching_member/);
  assert.match(sections[1],/People who share your interests/);
  assert.match(sections[1],/@shared_member/);
  assert.match(sections[1],/@matching_member/);
  assert.doesNotMatch(state.html,/@blocked_member|@followed_member/);
  assert.ok(state.html.indexOf('class="cf-footer"')<state.html.indexOf("People who share your interests"));
});

test("shared-interest row appears once at the very bottom after all posts and feed controls",async()=>{
  const module=await moduleUnderTest("interest-row-in-feed");
  const {deps,state}=dependencies(module,async path=>{
    if(path.endsWith("/preferences"))return {preferences,mutedAccounts:[]};
    if(path.includes("/lists"))return {lists:[]};
    if(path.includes("/people"))return {suggestions:[{profile:{id:"shared",username:"shared_member"},sharedInterests:["Music"]}]};
    return {posts:[1,2,3,4].map(id=>({id:String(id)})),hasMore:false,nextOffset:4};
  });
  deps.api.cloudPost=id=>({id});
  deps.renderPost=post=>`<article>Post ${post.id}</article>`;
  module.renderCommunityFeeds(deps);await settled();
  assert.equal((state.html.match(/aria-label="People who share your interests"/g)||[]).length,1);
  assert.ok(state.html.indexOf("Post 4")<state.html.indexOf("People who share your interests"));
  assert.ok(state.html.indexOf("Mark caught up")<state.html.indexOf("People who share your interests"));
});

test("Community people suggestions can be dismissed temporarily and return after seven days",async()=>{
  const module=await moduleUnderTest("temporary-suggestion-dismissal");
  const storage=new Map();
  const originalStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{
    getItem:key=>storage.get(key)||null,
    setItem:(key,value)=>storage.set(key,String(value)),
  }});
  try{
    const {deps,state}=dependencies(module,async path=>{
      if(path.endsWith("/preferences"))return {preferences,mutedAccounts:[]};
      if(path.includes("/lists"))return {lists:[]};
      if(path.includes("/people"))return {suggestions:[
        {profile:{id:"general",username:"general_member"},reason:"mutual-followers"},
        {profile:{id:"shared",username:"shared_member"},sharedInterests:["Music"]},
      ]};
      return {posts:[],hasMore:false,nextOffset:0};
    });
    const buttons=["people","shared-interests"].map(section=>({dataset:{cfSuggestionsDismiss:section}}));
    deps.app.querySelectorAll=selector=>selector==="[data-cf-suggestions-dismiss]"?buttons:[];
    module.renderCommunityFeeds(deps);
    await settled();
    assert.match(state.html,/People you may like/);
    assert.match(state.html,/People who share your interests/);
    assert.match(state.html,/data-cf-suggestions-dismiss="people"/);
    assert.match(state.html,/Dismiss for 7 days/);
    buttons[0].onclick();
    assert.doesNotMatch(state.html,/aria-label="People you may like"/);
    assert.match(state.html,/People who share your interests/,"dismissing one row leaves the other row available");

    module.renderCommunityFeeds(deps);
    assert.doesNotMatch(state.html,/aria-label="People you may like"/,"the dismissal persists across rerenders");
    const key=`oldtime-community-suggestion-dismissals:${account}`;
    const dismissed=JSON.parse(storage.get(key));
    dismissed.people=Date.now()-7*24*60*60*1000-1;
    storage.set(key,JSON.stringify(dismissed));
    module.renderCommunityFeeds(deps);
    assert.match(state.html,/aria-label="People you may like"/,"the row returns after its temporary dismissal expires");
  }finally{
    if(originalStorage)Object.defineProperty(globalThis,"localStorage",originalStorage);
    else delete globalThis.localStorage;
  }
});

test("a server-confirmed Community post appears immediately in Discover",async()=>{
  const module=await moduleUnderTest("published-post-discover");
  const {deps,state}=dependencies(module,async path=>{
    if(path.endsWith("/preferences"))return {preferences,mutedAccounts:[]};
    if(path.includes("/lists"))return {lists:[]};
    if(path.includes("/people"))return {suggestions:[]};
    return {posts:[],hasMore:false,nextOffset:0};
  });
  const post={id:"new-community-post",author:{id:account},destination:"community",text:"Newly published Community post"};
  deps.api.cloudPost=id=>id===post.id?post:null;
  deps.renderPost=item=>`<article>${item.text}</article>`;
  module.renderCommunityFeeds(deps);await settled();
  assert.equal(module.showPublishedPost(post),true);
  module.renderCommunityFeeds(deps);
  assert.match(state.html,/Newly published Community post/);
  assert.match(state.html,/data-cf-feed="discover" aria-current="page"/);
  assert.equal(module.showPublishedPost({...post,id:"main-only-post",destination:"main"}),false);
});

test("Clubs live inside Community and open directly into their shared chat",async t=>{
  const module=await moduleUnderTest("community-club-chat");
  t.after(()=>module.retryCommunityFeeds());
  const club={id:"33333333-3333-4333-8333-333333333333",name:"Garden Friends",topic:"Gardening",
    description:"A shared place to talk about plants.",privacy:"public",memberCount:2,
    membershipStatus:"active",membershipRole:"owner",
    owner:{id:account,username:"owner",displayName:"Owner"},
    members:[{id:account,username:"owner",displayName:"Owner"}]};
  const discoverClub={id:"44444444-4444-4444-8444-444444444444",name:"Backyard Seeds",topic:"Gardening",
    description:"Share growing tips with neighbors.",privacy:"public",memberCount:4,
    membershipStatus:"none",membershipRole:null,
    owner:{id:"22222222-2222-4222-8222-222222222222",username:"gardener",displayName:"Gardener"},
    members:[]};
  const {deps,state}=dependencies(module,async(path,options)=>{
    if(path.endsWith("/preferences"))return {preferences,mutedAccounts:[]};
    if(path.endsWith("/lists"))return {lists:[]};
    if(path.includes("/people"))return {suggestions:[]};
    if(path==="/api/clubs")return {clubs:[club,discoverClub]};
    if(path===`/api/clubs/${club.id}/messages`)return {messages:[],cursor:null};
    if(path===`/api/clubs/${club.id}/join`)return {status:"active"};
    return {posts:[],hasMore:false,nextOffset:0};
  });
  const modes=["posts","clubs"].map(cfMode=>({dataset:{cfMode},onclick:null}));
  const openClub={dataset:{cfClubOpen:club.id},onclick:null};
  deps.app.querySelectorAll=selector=>{
    if(selector==="[data-cf-mode]")return modes;
    if(selector==="[data-cf-club-open]")return [openClub];
    return [];
  };
  module.renderCommunityFeeds(deps);
  await settled();
  assert.match(state.html,/data-cf-mode="clubs"/);
  modes.find(button=>button.dataset.cfMode==="clubs").onclick();
  await settled();
  assert.match(state.html,/aria-label="Community Clubs"/);
  assert.match(state.html,/data-cf-club-topic="gardening"/);
  assert.match(state.html,/cf-club-section--yours/);
  assert.match(state.html,/cf-club-grid--yours/);
  assert.match(state.html,/cf-club-grid--discover/);
  assert.match(state.html,/Garden Friends/);
  assert.match(state.html,/Backyard Seeds/);
  assert.match(state.html,/data-cf-club-join="44444444-4444-4444-8444-444444444444"/);
  const discoverCard=state.html.match(/<article class="cf-club-card[^]*?data-cf-club-join="44444444-4444-4444-8444-444444444444"[^]*?<\/article>/)?.[0]||"";
  assert.match(discoverCard,/<div class="cf-club-card-visual">[\s\S]*<div class="cf-club-card-action">[\s\S]*data-cf-club-join=/);
  assert.match(discoverCard,/<div class="cf-club-card-cover cf-club-cover">/,"cover controls stay accessible to assistive technology");
  const styles=await readFile(new URL("./community-feeds.css",import.meta.url),"utf8");
  assert.match(styles,/\.cf-club-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(styles,/\.cf-club-card-overlay\s*\{[^}]*position:absolute/s);
  assert.match(styles,/@media \(min-width:760px\)\s*\{\s*\.cf-club-section--discover \.cf-club-grid \{[^}]*repeat\(3,minmax\(0,1fr\)\)/);
  openClub.onclick();
  await settled();
  assert.match(state.html,/aria-label="Community Club chat"/);
  assert.match(state.html,/Start the conversation/);
  assert.match(state.html,/data-cf-club-manage/,"Club creators can manage the cover and shared chat");
  assert.match(state.html,/textarea id="cf-club-message"[^>]*required/);
  assert.match(state.html,/data-cf-club-composer/);
  assert.match(state.calls.join("|"),/\/api\/clubs\/33333333-3333-4333-8333-333333333333\/messages/);
  const source=await readFile(new URL("./community-feeds.js",import.meta.url),"utf8");
  assert.match(source,/\/cover`,\{\s*method:"PATCH"/,"cover changes use the authenticated Club API");
  assert.match(source,/method:"DELETE",body:\{confirmation:/,"deletion requires typing the Club name");
  assert.match(source,/clubMessagesCursor/,"chat refresh uses incremental message cursors");
  assert.match(source,/pending:true/,"new messages appear optimistically while saving");
});
