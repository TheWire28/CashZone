// Schedule and score feed. ESPN's public scoreboard JSON: free, no key.
// It is unofficial, so everything that touches its shape lives in this file.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

// params: { year, type, week } for week-based leagues, { date: 'YYYYMMDD' | 'YYYYMM' } for
// day-based ones, plus { group } for college divisions. The feed rejects date ranges.
export async function fetchScoreboard(lg, params = {}, fetchJson = defaultFetchJson) {
  const qs = new URLSearchParams();
  if (params.date) qs.set('dates', String(params.date));
  else if (params.year) qs.set('dates', String(params.year));
  if (params.type) qs.set('seasontype', String(params.type));
  if (params.week) qs.set('week', String(params.week));
  if (params.group) qs.set('groups', String(params.group));
  if (lg.limit) qs.set('limit', String(lg.limit));
  const q = qs.toString();
  return fetchJson(`${BASE}/${lg.espnPath}/scoreboard${q ? `?${q}` : ''}`);
}

async function defaultFetchJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`Feed request failed (${url}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// One feed event -> { teams: [home, away], game } in our own shape, or null to skip it.
export function normalizeEvent(lg, e) {
  const c = e?.competitions?.[0];
  const home = c?.competitors?.find((x) => x.homeAway === 'home');
  const away = c?.competitors?.find((x) => x.homeAway === 'away');
  const type = e?.season?.type;
  if (!c || !home?.team?.id || !away?.team?.id || !e.id || !e.date) return null;
  if (!(lg.seasonTypes || [2, 3]).includes(type)) return null; // no preseason
  if (c.type?.abbreviation === 'ALLSTAR') return null;           // exhibition teams
  // College: a team with no conference is outside the division we rate (e.g. a
  // Division II opponent). Those games would distort the ratings, so skip them.
  if (lg.requireConference && !(home.team.conferenceId && away.team.conferenceId)) return null;

  const st = e.status?.type || {};
  const status = st.completed ? 'final' : st.state === 'in' ? 'in_progress' : st.state === 'pre' ? 'scheduled' : 'canceled';
  const live = status === 'final' || status === 'in_progress';
  const team = (x) => ({
    id: `${lg.key}:${x.team.id}`,
    league: lg.key,
    abbr: x.team.abbreviation || '',
    name: x.team.displayName || x.team.abbreviation || '',
    short_name: x.team.shortDisplayName || x.team.displayName || '',
    color: /^[0-9a-f]{6}$/i.test(x.team.color || '') ? x.team.color.toLowerCase() : null,
  });
  const odds = c.odds?.[0] || {};
  const game = {
    id: `${lg.key}:${e.id}`,
    league: lg.key,
    season: e.season.year,
    season_type: type,
    week: e.week?.number ?? null,
    start_time: new Date(e.date).toISOString(),
    status,
    home_team: `${lg.key}:${home.team.id}`,
    away_team: `${lg.key}:${away.team.id}`,
    home_score: live ? num(home.score) : null,
    away_score: live ? num(away.score) : null,
    neutral_site: !!c.neutralSite,
    venue: c.venue?.fullName || null,
    // Not a database column: the betting line, only meaningful before the game starts.
    line: { spreadHome: num(odds.spread), total: num(odds.overUnder) },
  };
  if (status === 'final' && (game.home_score === null || game.away_score === null)) return null;
  return { teams: [team(home), team(away)], game };
}
