import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ecosystem = readFileSync(new URL("./explore-ecosystem.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("./search-discovery.css", import.meta.url), "utf8");

test("Search uses mixed results without result-type pills", () => {
  const search = app.slice(app.indexOf("function search()"), app.indexOf("\nfunction notes()", app.indexOf("function search()")));
  assert.doesNotMatch(ecosystem, /data-xe-type|Result type/);
  assert.match(ecosystem, /let type = "videos"/);
  assert.doesNotMatch(search, /showTypeFilters|data-local-search-type|data-search-hub/);
  assert.match(app, /function localSearchResultsMarkup\(query\)/);
  assert.match(ecosystem, /data-xe-open-places/);
  assert.match(search, /showMap: true/);
  assert.doesNotMatch(search, /data-search-section="people"/);
});

test("Place map is visible immediately and spans the Search content width", () => {
  assert.match(styles, /\.search-screen \.discovery-place-map-section\s*\{[^}]*margin:0/);
  assert.match(styles, /\.search-screen \.discovery-place-map-container \.places-map\s*\{[^}]*height:min\(50vh, 460px\)/);
  assert.doesNotMatch(styles, /search-hub-tabs/);
});
