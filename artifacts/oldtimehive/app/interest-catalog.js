const baseInterests = [
  ["fitness", "Fitness"], ["running", "Running"], ["basketball", "Basketball"], ["yoga", "Yoga"],
  ["college", "College life"], ["nursing", "Nursing"], ["cybersecurity", "Cybersecurity"], ["study-groups", "Study groups"],
  ["gaming", "Gaming"], ["cars", "Cars"], ["music", "Music"], ["photography", "Photography"],
  ["fashion", "Fashion"], ["food", "Food"], ["tech", "Tech"], ["travel", "Travel"],
  ["art", "Art & design"], ["pets", "Pets"], ["beauty", "Beauty"],
];

export const NBA_TEAMS = [
  ["atlanta-hawks","Atlanta Hawks","ATL","#C8102E"], ["boston-celtics","Boston Celtics","BOS","#007A33"],
  ["brooklyn-nets","Brooklyn Nets","BKN","#111111"], ["charlotte-hornets","Charlotte Hornets","CHA","#00788C"],
  ["chicago-bulls","Chicago Bulls","CHI","#CE1141"], ["cleveland-cavaliers","Cleveland Cavaliers","CLE","#6F263D"],
  ["dallas-mavericks","Dallas Mavericks","DAL","#00538C"], ["denver-nuggets","Denver Nuggets","DEN","#0E2240"],
  ["detroit-pistons","Detroit Pistons","DET","#C8102E"], ["golden-state-warriors","Golden State Warriors","GSW","#1D428A"],
  ["houston-rockets","Houston Rockets","HOU","#CE1141"], ["indiana-pacers","Indiana Pacers","IND","#002D62"],
  ["la-clippers","LA Clippers","LAC","#C8102E"], ["los-angeles-lakers","Los Angeles Lakers","LAL","#552583"],
  ["memphis-grizzlies","Memphis Grizzlies","MEM","#5D76A9"], ["miami-heat","Miami Heat","MIA","#98002E"],
  ["milwaukee-bucks","Milwaukee Bucks","MIL","#00471B"], ["minnesota-timberwolves","Minnesota Timberwolves","MIN","#0C2340"],
  ["new-orleans-pelicans","New Orleans Pelicans","NOP","#0C2340"], ["new-york-knicks","New York Knicks","NYK","#006BB6"],
  ["oklahoma-city-thunder","Oklahoma City Thunder","OKC","#007AC1"], ["orlando-magic","Orlando Magic","ORL","#0077C0"],
  ["philadelphia-76ers","Philadelphia 76ers","PHI","#006BB6"], ["phoenix-suns","Phoenix Suns","PHX","#1D1160"],
  ["portland-trail-blazers","Portland Trail Blazers","POR","#E03A3E"], ["sacramento-kings","Sacramento Kings","SAC","#5A2D81"],
  ["san-antonio-spurs","San Antonio Spurs","SAS","#111111"], ["toronto-raptors","Toronto Raptors","TOR","#CE1141"],
  ["utah-jazz","Utah Jazz","UTA","#002B5C"], ["washington-wizards","Washington Wizards","WAS","#002B5C"],
];

export const NFL_TEAMS = [
  ["arizona-cardinals","Arizona Cardinals","ARI","#97233F"], ["atlanta-falcons","Atlanta Falcons","ATL","#A71930"],
  ["baltimore-ravens","Baltimore Ravens","BAL","#241773"], ["buffalo-bills","Buffalo Bills","BUF","#00338D"],
  ["carolina-panthers","Carolina Panthers","CAR","#0085CA"], ["chicago-bears","Chicago Bears","CHI","#0B162A"],
  ["cincinnati-bengals","Cincinnati Bengals","CIN","#FB4F14"], ["cleveland-browns","Cleveland Browns","CLE","#311D00"],
  ["dallas-cowboys","Dallas Cowboys","DAL","#003594"], ["denver-broncos","Denver Broncos","DEN","#FB4F14"],
  ["detroit-lions","Detroit Lions","DET","#0076B6"], ["green-bay-packers","Green Bay Packers","GB","#203731"],
  ["houston-texans","Houston Texans","HOU","#03202F"], ["indianapolis-colts","Indianapolis Colts","IND","#002C5F"],
  ["jacksonville-jaguars","Jacksonville Jaguars","JAX","#006778"], ["kansas-city-chiefs","Kansas City Chiefs","KC","#E31837"],
  ["las-vegas-raiders","Las Vegas Raiders","LV","#111111"], ["los-angeles-chargers","Los Angeles Chargers","LAC","#0080C6"],
  ["los-angeles-rams","Los Angeles Rams","LAR","#003594"], ["miami-dolphins","Miami Dolphins","MIA","#008E97"],
  ["minnesota-vikings","Minnesota Vikings","MIN","#4F2683"], ["new-england-patriots","New England Patriots","NE","#002244"],
  ["new-orleans-saints","New Orleans Saints","NO","#D3BC8D"], ["new-york-giants","New York Giants","NYG","#0B2265"],
  ["new-york-jets","New York Jets","NYJ","#125740"], ["philadelphia-eagles","Philadelphia Eagles","PHI","#004C54"],
  ["pittsburgh-steelers","Pittsburgh Steelers","PIT","#FFB612"], ["san-francisco-49ers","San Francisco 49ers","SF","#AA0000"],
  ["seattle-seahawks","Seattle Seahawks","SEA","#002244"], ["tampa-bay-buccaneers","Tampa Bay Buccaneers","TB","#D50A0A"],
  ["tennessee-titans","Tennessee Titans","TEN","#0C2340"], ["washington-commanders","Washington Commanders","WAS","#5A1414"],
];

export const SOCCER_CLUBS = [
  ["fc-barcelona","FC Barcelona","FCB","#A50044"], ["real-madrid","Real Madrid","RMA","#00529F"],
  ["atletico-madrid","Atlético Madrid","ATM","#CB3524"], ["manchester-city","Manchester City","MCI","#6CABDD"],
  ["manchester-united","Manchester United","MUN","#DA291C"], ["arsenal","Arsenal","ARS","#EF0107"],
  ["liverpool","Liverpool","LIV","#C8102E"], ["chelsea","Chelsea","CHE","#034694"],
  ["tottenham-hotspur","Tottenham Hotspur","TOT","#132257"], ["bayern-munich","Bayern Munich","BAY","#DC052D"],
  ["borussia-dortmund","Borussia Dortmund","BVB","#FDE100"], ["paris-saint-germain","Paris Saint-Germain","PSG","#004170"],
  ["juventus","Juventus","JUV","#111111"], ["ac-milan","AC Milan","ACM","#FB090B"],
  ["inter-milan","Inter Milan","INT","#0068A8"], ["ajax","Ajax","AJA","#D2122E"],
  ["benfica","Benfica","BEN","#E83030"], ["porto","Porto","FCP","#0033A0"],
  ["inter-miami","Inter Miami CF","IMCF","#F7B5CD"], ["la-galaxy","LA Galaxy","LAG","#00245D"],
  ["club-america","Club América","AME","#FFCD00"],
];

const sportInterests = [
  ["american-football","American football"], ["nfl","NFL"], ["nba","NBA"], ["wnba","WNBA"],
  ["college-basketball","College basketball"], ["ncaa-football","College football"], ["soccer","Soccer"],
  ["premier-league","Premier League"], ["laliga","LaLiga"], ["champions-league","UEFA Champions League"],
  ["mls","MLS"], ["nwsl","NWSL"], ["fifa-world-cup","FIFA World Cup"],
  ["baseball","Baseball"], ["mlb","MLB"], ["hockey","Hockey"], ["nhl","NHL"], ["tennis","Tennis"],
  ["formula-1","Formula 1"], ["golf","Golf"], ["ufc","UFC"], ["volleyball","Volleyball"],
  ["swimming","Swimming"], ["cycling","Cycling"], ["cricket","Cricket"], ["rugby","Rugby"],
];

export const PROFILE_INTERESTS = [
  ...baseInterests.map(([id, label]) => ({ id, label })),
  ...sportInterests.map(([id, label]) => ({ id, label })),
  ...NBA_TEAMS.map(([id, label]) => ({ id, label })),
  ...NFL_TEAMS.map(([id, label]) => ({ id, label })),
  ...SOCCER_CLUBS.map(([id, label]) => ({ id, label })),
];

const teamMarkRows = [...NBA_TEAMS, ...NFL_TEAMS, ...SOCCER_CLUBS];
export const INTEREST_TEAM_MARKS = Object.fromEntries(teamMarkRows.map(([id, , abbr, color]) => [id, { abbr, color }]));

const terms = {
  fitness: ["fitness", "workout", "gym", "exercise"], running: ["running", "run", "runner"],
  basketball: ["basketball", "hoops", "nba"], "american-football": ["american football", "football", "nfl"],
  nba: ["nba", "basketball", "hoops"], wnba: ["wnba", "women's basketball", "women basketball"],
  "college-basketball": ["college basketball", "ncaa basketball"], "ncaa-football": ["college football", "ncaa football"],
  soccer: ["soccer", "football"], "premier-league": ["premier league", "epl"],
  laliga: ["laliga", "la liga"], "champions-league": ["champions league", "uefa"],
  mls: ["mls", "major league soccer"], nwsl: ["nwsl", "women's soccer"],
  "fifa-world-cup": ["world cup", "fifa world cup"], baseball: ["baseball", "mlb"],
  mlb: ["mlb", "baseball"], hockey: ["hockey", "nhl"], nhl: ["nhl", "hockey"],
  tennis: ["tennis"], "formula-1": ["formula 1", "formula one", "f1"], golf: ["golf"],
  ufc: ["ufc", "mma", "mixed martial arts"], volleyball: ["volleyball"],
  swimming: ["swimming", "swim"], cycling: ["cycling", "bike"],
  cricket: ["cricket"], rugby: ["rugby"],
  yoga: ["yoga"], college: ["college", "campus", "university", "school"],
  nursing: ["nursing", "nurse"], cybersecurity: ["cybersecurity", "cyber security", "infosec"],
  "study-groups": ["study group", "study", "learning", "learn"], gaming: ["gaming", "game", "gamer"],
  cars: ["cars", "car", "drive", "driving", "automotive"], music: ["music", "song", "singer", "band", "concert"],
  photography: ["photography", "photo", "camera"], fashion: ["fashion", "style", "outfit"],
  food: ["food", "recipe", "cooking", "restaurant", "cafe"], tech: ["tech", "technology", "software", "gadgets"],
  travel: ["travel", "trip", "roadtrip", "vacation"], art: ["art", "design", "drawing", "illustration"],
  pets: ["pets", "pet", "dog", "cat", "animal"], beauty: ["beauty", "makeup", "skincare", "hair"],
};
for (const [id, label, abbr] of teamMarkRows) {
  const words = label.toLowerCase().split(/\s+/);
  terms[id] = [...new Set([label.toLowerCase(), words.at(-1), abbr.toLowerCase()])];
}
export const INTEREST_SEARCH_TERMS = terms;

const ids = rows => rows.map(([id]) => id);
const NBA_IDS = ids(NBA_TEAMS);
const NFL_IDS = ids(NFL_TEAMS);
const SOCCER_IDS = ids(SOCCER_CLUBS);

export const INTEREST_GROUPS = [
  {
    id: "movement", label: "Sports & activities", icon: "activity", subgroups: [
      { id: "quick-picks", label: "Suggested topics", icon: "activity", defaultOpen: true,
        items: ["nba", "los-angeles-lakers", "nfl", "soccer", "fc-barcelona", "premier-league"] },
      { id: "basketball", label: "Basketball", icon: "basketball",
        items: ["basketball", "nba", "wnba", "college-basketball", ...NBA_IDS] },
      { id: "football", label: "American football", icon: "football",
        items: ["american-football", "nfl", "ncaa-football", ...NFL_IDS] },
      { id: "soccer", label: "Soccer", icon: "soccer",
        items: ["soccer", "premier-league", "laliga", "champions-league", "mls", "nwsl", "fifa-world-cup", ...SOCCER_IDS] },
      { id: "other-sports", label: "More sports & activities", icon: "activity",
        items: ["fitness", "running", "yoga", "baseball", "mlb", "hockey", "nhl", "tennis", "formula-1", "golf", "ufc", "volleyball", "swimming", "cycling", "cricket", "rugby"] },
    ],
  },
  {
    id: "learning", label: "Learning & careers", icon: "document",
    items: ["college", "nursing", "cybersecurity", "study-groups"],
  },
  {
    id: "lifestyle", label: "Lifestyle & creative", icon: "camera",
    items: ["gaming", "cars", "music", "photography", "fashion", "food", "tech", "travel", "art", "pets", "beauty"],
  },
];
