import test from "node:test";
import assert from "node:assert/strict";
import { renderInterestDropdown } from "./interest-picker.js";
import { INTEREST_GROUPS, PROFILE_INTERESTS } from "./interest-catalog.js";

test("interest catalog provides distinct sports, leagues and teams", () => {
  const ids = PROFILE_INTERESTS.map(interest => interest.id);
  assert.equal(new Set(ids).size, ids.length, "interest IDs stay unique for signup and profile settings");
  for (const id of ["nba", "nfl", "soccer", "los-angeles-lakers", "fc-barcelona"]) {
    assert.ok(ids.includes(id), `${id} is available`);
  }
  const searchableIds = INTEREST_GROUPS.flatMap(group => [
    ...(group.items || []),
    ...(group.subgroups || []).flatMap(subgroup => subgroup.items || []),
  ]);
  for (const id of ["los-angeles-lakers", "buffalo-bills", "fc-barcelona"]) {
    assert.ok(searchableIds.includes(id), `${id} is in a searchable category`);
  }
});

test("interest dropdown renders search and transparent league/team marks", () => {
  const markup = renderInterestDropdown(PROFILE_INTERESTS, {
    selected: new Set(),
    max: 24,
    accessibleLabel: "Choose your interests",
    pickerClass: "profile-interest-picker",
    optionClass: "profile-interest-option",
    attribute: "data-profile-interest",
  });
  assert.match(markup, /data-interest-search-input/);
  assert.match(markup, /Search interests, teams or leagues/);
  assert.match(markup, /data-profile-interest="los-angeles-lakers"/);
  assert.match(markup, /data-profile-interest="nfl"/);
  assert.match(markup, />LAKERS</);
  assert.match(markup, />NBA</);
});
