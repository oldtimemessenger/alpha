import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasPlaceMapCoordinates, initialPlaceMapView, normalizePlaceSearchResults, placesFeatureCollection } from "./places-map.js";

const placesMapSource = readFileSync(new URL("./places-map.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const sheetStyles = readFileSync(new URL("./interface-cleanup.css", import.meta.url), "utf8");
const menuStyles = readFileSync(new URL("./shared-menu-consistency.css", import.meta.url), "utf8");

test("place maps only receive named places with valid saved coordinates", () => {
  const places = [
    { id: "osm:node:1", label: "Biscayne Bay", source: "osm", lat: 25.7617, lon: -80.1918 },
    { id: "custom:typed", label: "A typed-only location", source: "custom" },
    { id: "osm:node:2", label: "Invalid latitude", source: "osm", lat: 91, lon: 0 },
    { id: "osm:node:3", label: "Invalid longitude", source: "osm", lat: 0, lon: 181 },
    { id: "osm:node:4", label: "Biscayne Bay duplicate", source: "osm", lat: 25.76, lon: -80.19 },
    { id: "osm:node:1", label: "Duplicate identity", source: "osm", lat: 25.7617, lon: -80.1918 },
  ];
  const collection = placesFeatureCollection(places);
  assert.equal(collection.features.length, 2);
  assert.deepEqual(collection.features[0].geometry.coordinates, [-80.1918, 25.7617]);
  assert.equal(hasPlaceMapCoordinates(places[0]), true);
  assert.equal(hasPlaceMapCoordinates(places[1]), false);
  assert.equal(hasPlaceMapCoordinates({ lat: null, lon: null }), false);
  assert.equal(hasPlaceMapCoordinates({ lat: 0, lon: 0 }), true);
  assert.equal(hasPlaceMapCoordinates({ lat: "25.7617", lon: "-80.1918" }), true);
});

test("map clusters represent tagged-post totals for each public place", () => {
  const collection = placesFeatureCollection([{
    place: { id: "osm:node:posts", label: "Biscayne Bay", source: "osm", lat: 25.76, lon: -80.19 },
    postCount: 17,
  }]);
  assert.equal(collection.features[0].properties.postCount, 17);
  assert.match(placesMapSource, /clusterProperties:\s*\{\s*postCount:\s*\["\+",\s*\["get",\s*"postCount"\]\]\s*\}/);
});

test("selecting a place-map pin opens its existing profile and tagged-post feed", () => {
  const mapSetup = appSource.slice(appSource.indexOf("function mountPlaceDetailMap("), appSource.indexOf("let placesLocationCoordinates"));
  assert.match(mapSetup, /onSelect:\s*isDiscoveryMap\s*\?\s*place\s*=>\s*selectPlace\(place\)\s*:\s*undefined/);
  const selectPlace = appSource.slice(appSource.indexOf("function selectPlace(place)"), appSource.indexOf("async function loadPlaceProfile"));
  assert.match(selectPlace, /loadPlaceFeed\(\);[\s\S]*void loadPlaceProfile\(\);/);
});

test("Search Places uses the existing map and bounded public-post feed endpoint", () => {
  const mapSetup = appSource.slice(appSource.indexOf("function mountPlaceDetailMap("), appSource.indexOf("let placesLocationCoordinates"));
  assert.match(mapSetup, /isSearchPlaceMap \? discoveryPlaces\.places\.filter\(item => Number\(item\?\.postCount\) > 0\)/);
  assert.match(appSource, /mountPlaceDetailMap\(discoveryPlaceMapVisible \? app\.querySelector\("\[data-search-place-map\]"\) : null\)/);
  const feedLoader = appSource.slice(appSource.indexOf("async function loadDiscoveryPlaceFeed("), appSource.indexOf("function isCommunitySurfaceMediaPost"));
  assert.match(feedLoader, /\/api\/places\/feed/);
  assert.match(feedLoader, /limit: "18"/);
  assert.match(feedLoader, /params\.set\("q", serverQuery\)/);
});

test("place search suggestions keep usable names and pins for the saved post tag", () => {
  const results = normalizePlaceSearchResults([
    { id: "osm:relation:miami", label: "Miami", source: "osm", lat: 25.7617, lon: -80.1918 },
    { id: "osm:relation:beach", label: "Miami Beach", source: "osm", lat: 25.7907, lon: -80.13 },
    { id: "osm:node:no-pin", label: "No pin", source: "osm" },
    { id: "osm:node:blank", label: " ", source: "osm", lat: 25.76, lon: -80.19 },
  ]);
  assert.deepEqual(results.map(place => place.label), ["Miami", "Miami Beach"]);
  assert.deepEqual(results[1], {
    id: "osm:relation:beach",
    label: "Miami Beach",
    source: "osm",
    lat: 25.7907,
    lon: -80.13,
  });
});

test("the selected place is marked on the map without changing its saved coordinates", () => {
  const selected = { id: "osm:way:900", label: "Biscayne Bay", source: "osm", lat: 25.76, lon: -80.19 };
  const collection = placesFeatureCollection([selected], selected.id);
  assert.equal(collection.features[0].properties.selected, true);
  assert.deepEqual(collection.features[0].geometry.coordinates, [-80.19, 25.76]);
});

test("a tagged place map centers and zooms to its selected pin, not the worldwide feed extent", () => {
  const miami = { id: "osm:relation:miami", label: "Miami", source: "osm", lat: "25.7617", lon: "-80.1918" };
  const london = { id: "osm:relation:london", label: "London", source: "osm", lat: 51.5072, lon: -0.1276 };
  assert.deepEqual(initialPlaceMapView([miami, london], miami.id), {
    center: [-80.1918, 25.7617],
    zoom: 15,
    selected: true,
  });
});

test("Places rerenders retain the map canvas and update its pins instead of remounting", () => {
  const lifecycle = appSource.slice(
    appSource.indexOf("function mountPlaceDetailMap("),
    appSource.indexOf("let placesLocationCoordinates"),
  );
  const retainHost = lifecycle.indexOf("host.replaceWith(retainedHost)");
  const destructiveRemount = lifecycle.indexOf("disposePlaceDetailMap();", lifecycle.indexOf("// Search and Places rerender"));
  assert.ok(retainHost >= 0, "a same-screen rerender should move the existing map canvas into the new view");
  assert.ok(destructiveRemount > retainHost, "only maps that cannot be reused should be destroyed");
  assert.match(lifecycle, /updatePlaceDetailMapInput\(places,\s*selectedId\)/);
});

test("Places map loading can be cancelled and failed loads expose a retry", () => {
  assert.match(placesMapSource, /withAbort\(loadMapLibre\(\),\s*signal\)/);
  assert.match(placesMapSource, /openFreeMapProvider\.load\("light",\s*\{\s*signal\s*\}\)/);
  assert.match(appSource, /placeDetailMapLoadTimer\s*=\s*setTimeout/);
  assert.match(appSource, /className\s*=\s*"places-map-retry"/);
});

test("sheets fit their contents and dropdown options share a compact text and row scale", () => {
  assert.match(sheetStyles, /height:\s*max-content/);
  assert.match(sheetStyles, /max-height:\s*min\(88dvh,\s*760px\)/);
  assert.match(menuStyles, /min-height:\s*44px/);
  assert.match(menuStyles, /font-size:\s*var\(--ot-font-menu\)/);
  assert.match(menuStyles, /row-gap:\s*2px/);
});
