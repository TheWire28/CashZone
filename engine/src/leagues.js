// One entry per league. Adding a league later means adding a block here;
// the rest of the engine is league-agnostic.
export const LEAGUES = {
  nfl: {
    key: 'nfl',
    name: 'NFL',
    espnPath: 'football/nfl',
    regularWeeks: 18,
    k: 20,            // how fast ratings react to a result
    hfa: 48,          // home-field edge, in rating points (~1.9 game points)
    eloPerPoint: 25,  // rating points per projected point of margin
    regress: 1 / 3,   // pull toward average at each new season
    avgPoints: 22.5,  // fallback points per team before there is data
    priorGames: 4,    // shrink scoring averages toward league average
  },
};

export function getLeague(key) {
  const lg = LEAGUES[key];
  if (!lg) throw new Error(`Unknown league "${key}". Known: ${Object.keys(LEAGUES).join(', ')}`);
  return lg;
}
