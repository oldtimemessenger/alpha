import { icons } from "./icons.js";
import { INTEREST_GROUPS, INTEREST_SEARCH_TERMS, INTEREST_TEAM_MARKS, PROFILE_INTERESTS } from "./interest-catalog.js";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

const customIcons = {
  basketball: '<svg class="navic interest-sport-mark" viewBox="0 0 24 24" fill="none" stroke="#d87318" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-3 2.2-4.5 5.2-4.5 9s1.5 6.8 4.5 9M12 3c3 2.2 4.5 5.2 4.5 9s-1.5 6.8-4.5 9"/></svg>',
  soccer: '<svg class="navic interest-sport-mark" viewBox="0 0 24 24" fill="none" stroke="#1e7b48" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m12 7 3.1 2.3-1.2 3.7h-3.8l-1.2-3.7L12 7Zm-3.1 2.3-3.6-.7M8.1 13l-1.3 3.6m7.1-3.6 3.4 2.3m-2.2-6 2.6-2.4M10.1 13l-.8 4.1 2.7 1.7m2-5.8 3.5-.3 1 3.6"/></svg>',
  football: '<svg class="navic interest-sport-mark" viewBox="0 0 24 24" fill="none" stroke="#593c25" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5c4-3 10-3 14 0s3 10 0 14-10 3-14 0S2 9 5 5Z"/><path d="m7 7 10 10m-7-12-6 6m13-4-6 6m0-8-6 6m13-4-6 6"/></svg>',
  baseball: '<svg class="navic interest-sport-mark" viewBox="0 0 24 24" fill="none" stroke="#b53d36" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M7 5c3 2 4 4.5 4 7s-1 5-4 7M17 5c-3 2-4 4.5-4 7s1 5 4 7"/></svg>',
  hockey: '<svg class="navic interest-sport-mark" viewBox="0 0 24 24" fill="none" stroke="#4d667e" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M4 8v6c0 1.7 3.6 3 8 3s8-1.3 8-3V8M4 14c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  tennis: '<svg class="navic interest-sport-mark" viewBox="0 0 24 24" fill="none" stroke="#6b8420" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.5 5.5c4.3 1.5 7 4.2 8.5 8.5s1 6.6 1 6.6M18.5 5.5C14.2 7 11.5 9.7 10 14s-1 6.6-1 6.6"/></svg>',
  runner: '<svg class="navic interest-sport-mark" viewBox="0 0 24 24" fill="none" stroke="#4c657c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="15.5" cy="4.5" r="2"/><path d="m12.5 8 3.5 2 2 4m-5.5-6-3 4-4 1m7-2-1 5-4 5m5-5 5 4 3 1"/></svg>',
  formula1: '<svg class="navic interest-sport-mark" viewBox="0 0 32 24" fill="none" stroke="#d21f32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18 11 6h7l-4 6h13L23 18H3Zm10-12 8 0m-5 6 7 0"/></svg>',
  car: '<svg class="navic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15v-3l2-5h12l2 5v3"/><path d="M4 12h16M5 15v3h14v-3"/><circle cx="7" cy="15" r=".8"/><circle cx="17" cy="15" r=".8"/></svg>',
  food: '<svg class="navic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v7m3-7v7M5 10v11M6.5 10V3M17 3v18M17 3c2 2 3 4.4 3 7h-3"/></svg>',
  pet: '<svg class="navic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="15.5" rx="4.2" ry="3.2"/><ellipse cx="5.5" cy="9" rx="1.5" ry="2"/><ellipse cx="10" cy="5.5" rx="1.5" ry="2"/><ellipse cx="15" cy="5.5" rx="1.5" ry="2"/><ellipse cx="18.5" cy="9" rx="1.5" ry="2"/></svg>',
  hanger: '<svg class="navic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7V5.5a2 2 0 1 0-2-2"/><path d="m3 18 9-8 9 8H3Z"/></svg>',
};

const specialMarks = {
  nba: '<svg class="navic interest-league-mark" viewBox="0 0 36 30" aria-hidden="true"><path d="M8 3h20v24H8z" fill="none" stroke="#17408b" stroke-width="1.6"/><path d="M9 4h8v22H9z" fill="#c9082a"/><path d="M19 4h8v22h-8z" fill="#17408b"/><text x="18" y="17" fill="#fff" font-size="7" font-weight="900" text-anchor="middle" font-family="system-ui">NBA</text></svg>',
  nfl: '<svg class="navic interest-league-mark" viewBox="0 0 36 30" aria-hidden="true"><path d="M18 2 31 6v9c0 6-5 10-13 13C10 25 5 21 5 15V6l13-4Z" fill="none" stroke="#013369" stroke-width="1.8"/><text x="18" y="14" fill="#013369" font-size="8" font-weight="900" text-anchor="middle" font-family="system-ui">NFL</text><path d="M12 19c3-3 9-3 12 0-3 3-9 3-12 0Zm5-1 2 2m-4-2 2 2" fill="none" stroke="#d50a0a" stroke-width="1"/></svg>',
  "los-angeles-lakers": '<svg class="navic interest-team-wordmark" viewBox="0 0 42 30" aria-hidden="true"><path d="M4 23h34" stroke="#fdb927" stroke-width="2"/><text x="21" y="19" fill="#552583" font-size="8" font-style="italic" font-weight="900" text-anchor="middle" font-family="system-ui">LAKERS</text></svg>',
  "fc-barcelona": '<svg class="navic interest-club-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 4h22v14c0 5-5 8-11 10-6-2-11-5-11-10V4Z" fill="none" stroke="#a50044" stroke-width="1.8"/><path d="M6 10h20" stroke="#edbb00" stroke-width="1.4"/><path d="M8 6h6v4H8z" fill="none" stroke="#17408b" stroke-width="1.2"/><text x="19" y="9" fill="#a50044" font-size="5" font-weight="900" text-anchor="middle" font-family="system-ui">FCB</text><path d="M10 16h12m-10 4h8" stroke="#17408b" stroke-width="2"/></svg>',
};

const iconByInterest = {
  fitness: "activity", running: "runner", basketball: "basketball", "american-football": "football",
  soccer: "soccer", baseball: "baseball", mlb: "baseball", hockey: "hockey", nhl: "hockey",
  tennis: "tennis", "formula-1": "formula1", golf: "activity", ufc: "activity", volleyball: "activity",
  swimming: "activity", cycling: "activity", cricket: "activity", rugby: "activity", "college-basketball": "basketball",
  "ncaa-football": "football", nba: "basketball", wnba: "basketball",
};

function teamMark(id) {
  const team = INTEREST_TEAM_MARKS[id];
  if (!team) return "";
  const color = escapeHtml(team.color);
  const abbr = escapeHtml(team.abbr);
  return `<svg class="navic interest-team-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 4h22v14c0 5-5 9-11 11C10 27 5 23 5 18V4Z" fill="none" stroke="${color}" stroke-width="1.8"/><text x="16" y="18" fill="${color}" font-size="${abbr.length > 3 ? "6.5" : "8"}" font-weight="900" text-anchor="middle" font-family="system-ui">${abbr}</text></svg>`;
}

function icon(name, fallback = "activity") {
  return customIcons[name] || icons[name] || icons[fallback] || "";
}

function interestMark(id, fallback) {
  return specialMarks[id] || teamMark(id) || icon(iconByInterest[id] || id, fallback);
}

export function renderInterestDropdown(catalog, {
  attribute,
  optionClass,
  pickerClass,
  testIdPrefix = "",
  selected = new Set(),
  max,
  variantClass = "",
  accessibleLabel = "Choose interests",
} = {}) {
  const byId = new Map((Array.isArray(catalog) ? catalog : []).map(item => [item.id, item]));
  const renderOption = id => {
    const item = byId.get(id);
    if (!item) return "";
    const isSelected = selected.has(item.id);
    const terms = INTEREST_SEARCH_TERMS[item.id] || [];
    const searchable = [item.label, item.id, ...terms].join(" ");
    return `<button type="button" class="${escapeHtml(optionClass)} interest-option-button ${isSelected ? "selected" : ""}" ${escapeHtml(attribute)}="${escapeHtml(item.id)}" data-interest-search="${escapeHtml(searchable)}" ${testIdPrefix ? `data-testid="${escapeHtml(testIdPrefix + item.id)}"` : ""} aria-pressed="${isSelected}">
      <span class="interest-option-mark" aria-hidden="true">${interestMark(item.id)}</span>
      <span class="interest-option-label">${escapeHtml(item.label)}</span>
      <span class="interest-option-check" aria-hidden="true">${icon("check")}</span>
    </button>`;
  };
  const groups = INTEREST_GROUPS.map(group => {
    const subgroupMarkup = (group.subgroups || []).map(subgroup => {
      const options = subgroup.items.map(renderOption).filter(Boolean).join("");
      if (!options) return "";
      const count = subgroup.items.filter(id => byId.has(id)).length;
      return `<details class="interest-topic-subgroup" data-interest-subgroup="${escapeHtml(subgroup.id)}" data-default-open="${subgroup.defaultOpen === true}" ${subgroup.defaultOpen ? "open" : ""}>
        <summary><span class="interest-subgroup-mark" aria-hidden="true">${interestMark(subgroup.id, subgroup.icon)}</span><span class="interest-subgroup-label">${escapeHtml(subgroup.label)}</span><small>${count}</small><span class="interest-subgroup-chevron" aria-hidden="true">${icon("chevronRight")}</span></summary>
        <div class="interest-topic-options">${options}</div>
      </details>`;
    }).join("");
    const flatOptions = (group.items || []).map(renderOption).filter(Boolean).join("");
    if (!subgroupMarkup && !flatOptions) return "";
    return `<section class="interest-choice-group" aria-label="${escapeHtml(group.label)}">
      <h3 class="interest-group-heading"><span class="interest-group-mark" aria-hidden="true">${icon(group.icon)}</span><span>${escapeHtml(group.label)}</span></h3>
      ${subgroupMarkup}<div class="interest-group-options">${flatOptions}</div>
    </section>`;
  }).filter(Boolean).join("");
  const count = selected.size;
  const selectionLabel = count ? `${count} selected` : `Choose up to ${max} interests`;

  return `<details class="interest-dropdown ${escapeHtml(variantClass)}">
    <summary class="interest-dropdown-summary" aria-label="${escapeHtml(accessibleLabel)}">
      <span class="interest-dropdown-mark" aria-hidden="true">${icon("group", "users")}</span>
      <span class="interest-dropdown-copy"><b>${escapeHtml(accessibleLabel)}</b><small data-interest-summary>${escapeHtml(selectionLabel)}</small></span>
      <span class="interest-dropdown-chevron" aria-hidden="true">${icon("chevronRight")}</span>
    </summary>
    <div class="interest-dropdown-body">
      <label class="interest-search-wrap">${icon("search")}<input type="search" data-interest-search-input aria-label="Search interests, teams and leagues" placeholder="Search interests, teams or leagues" autocomplete="off" /></label>
      <p class="interest-search-empty" data-interest-search-empty hidden>No interests match that search.</p>
      <div class="${escapeHtml(pickerClass)} interest-choice-groups" role="group" aria-label="${escapeHtml(accessibleLabel)}">${groups}</div>
    </div>
  </details>
  <div class="interest-selected-preview" data-interest-selected-preview aria-live="polite" ${count ? "" : "hidden"}></div>`;
}

function bindInterestSearch(dropdown) {
  const input = dropdown.querySelector("[data-interest-search-input]");
  if (!input || input.dataset.bound === "true") return;
  input.dataset.bound = "true";
  input.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase();
    const options = [...dropdown.querySelectorAll(".interest-option-button,.signup-interest,.profile-interest-option")];
    for (const option of options) {
      const label = option.querySelector(".interest-option-label")?.textContent || option.textContent || "";
      const terms = option.dataset.interestSearch || "";
      option.hidden = Boolean(query && !`${label} ${terms}`.toLocaleLowerCase().includes(query));
    }
    for (const subgroup of dropdown.querySelectorAll(".interest-topic-subgroup")) {
      const hasMatch = [...subgroup.querySelectorAll(".interest-option-button,.signup-interest,.profile-interest-option")].some(option => !option.hidden);
      subgroup.hidden = Boolean(query && !hasMatch);
      if (query && hasMatch) subgroup.open = true;
      else if (!query) subgroup.open = subgroup.dataset.defaultOpen === "true";
    }
    for (const group of dropdown.querySelectorAll(".interest-choice-group")) {
      const hasMatch = [...group.querySelectorAll(".interest-option-button,.signup-interest,.profile-interest-option")].some(option => !option.hidden);
      group.hidden = Boolean(query && !hasMatch);
    }
    const hasMatch = options.some(option => !option.hidden);
    const empty = dropdown.querySelector("[data-interest-search-empty]");
    if (empty) empty.hidden = hasMatch || !query;
  });
}

export function updateInterestDropdown(dropdown, selected, catalog, max) {
  if (!dropdown) return;
  bindInterestSearch(dropdown);
  const summary = dropdown.querySelector("[data-interest-summary]");
  if (summary) summary.textContent = selected.size ? `${selected.size} selected` : `Choose up to ${max} interests`;

  const preview = dropdown.parentElement?.querySelector(":scope > .interest-selected-preview");
  if (!preview) return;
  const labels = [...selected].map(value =>
    catalog.find(item => item.id === value || item.label.toLowerCase() === String(value).toLowerCase())?.label || value,
  );
  preview.hidden = labels.length === 0;
  preview.textContent = labels.length > 3
    ? `${labels.slice(0, 3).join(" · ")} · +${labels.length - 3} more`
    : labels.join(" · ");
}
