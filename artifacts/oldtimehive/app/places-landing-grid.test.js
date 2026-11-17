import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const code = readFileSync(new URL("./places-view.js", import.meta.url), "utf8").replace(/^import .*$/gm, "").replace(/^/, "const isDefaultAvatarMediaReference = () => false;\n");
const { renderPlacesLanding, renderDiscoveryPlaces, mixLandingPlaces } = await import("data:text/javascript," + encodeURIComponent(code));
const it = (id, n = 3) => ({ place: { id, label: `Venue ${id}`, category: "Cafe" }, postCount: n, placeRating: { averageRating: 4.3, ratingCount: 7 } });
test("landing mixes buckets into one de-duplicated grid", { skip: !renderPlacesLanding }, () => {
  const landing = { loved: [it("a"), it("b")], trending: [it("a"), it("c")], suggested: [it("d")], nearby: [] };
  assert.deepEqual(mixLandingPlaces(landing).map(e => e.item.place.id), ["a", "d", "b", "c"]);
  const html = renderPlacesLanding({ landing, location: { status: "idle" } });
  assert.match(html, /places-landing-grid/);
  assert.match(html, /data-places-nearby/);
  assert.equal((html.match(/data-action="select-place"/g) || []).length, 4);
  assert.match(html, /4\.3 \(7\)/);
  assert.doesNotMatch(html, /places-landing-row/);
  assert.doesNotMatch(html, /places-reason|data-places-reason|>Loved<|>For you</);
});
test("no location still renders grid", { skip: !renderPlacesLanding }, () => {
  const html = renderPlacesLanding({ landing: { loved: [it("x")] }, location: { status: "denied" } });
  assert.match(html, /Location is off/); assert.match(html, /Venue x/);
});
test("Search Places shows a full map first and recent tagged posts as Home cards", { skip: !renderDiscoveryPlaces }, () => {
  const html = renderDiscoveryPlaces({
    places: [{ place: { id: "lisbon", label: "Lisbon", lat: 38.7223, lon: -9.1393 }, postCount: 1 }],
    feed: { status: "ready", posts: [{ id: "post-1" }], hasMore: false },
    mapVisible: true,
    showMap: true,
    showMapToggle: false,
    showLanding: false,
    showPlaceResults: false,
    renderPostCard: post => `<article class="home-feed-post-card" data-search-post="${post.id}">Home card</article>`,
  });
  assert.match(html, /discovery-place-feed-list--home/);
  assert.match(html, /class="home-feed-post-card" data-search-post="post-1"/);
  assert.match(html, /data-search-place-map/);
  assert.match(html, /Latest tagged posts/);
  assert.ok(html.indexOf("discovery-place-map-section") < html.indexOf("discovery-places-feed"));
  assert.doesNotMatch(html, /data-discovery-place-map-toggle|place-feed-card|places-landing-grid/);
});

test("Search Places renders the base map while place pins are still loading", { skip: !renderDiscoveryPlaces }, () => {
  const html = renderDiscoveryPlaces({
    mapVisible: true,
    showMap: true,
    showMapToggle: false,
    showLanding: false,
    showPlaceResults: false,
    feed: { status: "loading", posts: [] },
  });
  assert.match(html, /data-search-place-map/);
  assert.match(html, /aria-label="Map of places with public posts"/);
});
