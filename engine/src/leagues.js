// One entry per league. The rest of the engine is league-agnostic.
//
// Feed settings
//   calendar          'week' (football) or 'day' (everything else)
//   groups            college division ids in the feed; each is requested separately
//   requireConference skip games against teams outside the division (college)
//   seasonTypes       2 regular season, 3 playoffs, 5 NBA play-in
// Model settings (k, hfa and eloPerPoint were fitted on last season's results; see README)
//   k                 how fast ratings react to a result
//   hfa               home edge, in rating points
//   eloPerPoint       rating points per projected point (or goal) of margin
//   regress           pull toward average at each new season
//   minGames          no pick until both teams have this many rated games
//   dvp               which box-score reader to use for defense vs position (none: not collected)
const football = { calendar: 'week', seasonTypes: [2, 3], minScore: 3, priorGames: 4 };
const daily = { calendar: 'day', limit: 1000, daysAhead: 3 };

export const LEAGUES = {
  nfl: {
    ...football, key: 'nfl', name: 'NFL', espnPath: 'football/nfl',
    regularWeeks: 18, postWeeks: 5, dvp: 'football',
    k: 24, hfa: 36, eloPerPoint: 25, regress: 1 / 3, avgPoints: 23,
  },
  ncaaf: {
    ...football, key: 'ncaaf', name: 'NCAAF', espnPath: 'football/college-football',
    regularWeeks: 16, postWeeks: 1, groups: [80, 81], limit: 400, requireConference: true,
    k: 35, hfa: 70, eloPerPoint: 16, regress: 0.25, avgPoints: 26, minGames: 4,
  },
  nhl: {
    ...daily, key: 'nhl', name: 'NHL', espnPath: 'hockey/nhl', backfill: 'month', seasonTypes: [2, 3], dvp: 'hockey',
    k: 8, hfa: 20, eloPerPoint: 90, regress: 0.25, avgPoints: 3.1, priorGames: 10,
  },
  nba: {
    ...daily, key: 'nba', name: 'NBA', espnPath: 'basketball/nba', backfill: 'month', seasonTypes: [2, 3, 5], dvp: 'basketball',
    k: 13, hfa: 40, eloPerPoint: 20.5, regress: 0.3, avgPoints: 114, priorGames: 8,
  },
  ncaab: {
    ...daily, key: 'ncaab', name: 'NCAAB', espnPath: 'basketball/mens-college-basketball',
    backfill: 'day', activeMonths: [11, 12, 1, 2, 3, 4], groups: [50], limit: 500, daysAhead: 2,
    requireConference: true, seasonTypes: [2, 3], dvp: 'basketball',
    k: 22, hfa: 70, eloPerPoint: 21, regress: 0.25, avgPoints: 74, priorGames: 6, minGames: 5,
  },
};

export function getLeague(key) {
  const lg = LEAGUES[key];
  if (!lg) throw new Error(`Unknown league "${key}". Known: ${Object.keys(LEAGUES).join(', ')}`);
  return lg;
}
