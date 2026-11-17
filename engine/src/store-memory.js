// In-memory stand-in for the database. Used by `--local` runs and the tests:
// same interface as the Supabase store, nothing is saved anywhere.
export function recordRows(games, grades, now = new Date()) {
  const windows = [['7d', 7], ['30d', 30], ['90d', 90], ['all', null]];
  const markets = [
    ['winner', (g) => (g.winner_correct === null ? null : g.winner_correct ? 'win' : 'loss')],
    ['spread', (g) => g.spread_result],
    ['total', (g) => g.total_result],
  ];
  const rows = new Map();
  for (const gr of grades) {
    const game = games.get(gr.game_id);
    if (!game) continue;
    const ageDays = (now - new Date(game.start_time)) / 864e5;
    for (const [win, days] of windows) {
      if (days !== null && ageDays > days) continue;
      for (const [market, read] of markets) {
        const res = read(gr);
        if (!res) continue;
        const key = `${gr.league}|${win}|${market}`;
        const row = rows.get(key) || { league: gr.league, win, market, wins: 0, losses: 0, pushes: 0 };
        row[res === 'win' ? 'wins' : res === 'loss' ? 'losses' : 'pushes']++;
        rows.set(key, row);
      }
    }
  }
  return [...rows.values()];
}

export function createMemoryStore() {
  const teams = new Map(), games = new Map(), predictions = new Map(), grades = new Map();
  const ratingState = new Map(), rated = new Set();
  const boxed = new Set(), dvp = new Map(), players = new Map();
  const unboxed = (league, season) => [...games.values()]
    .filter((g) => g.league === league && g.season === season && g.status === 'final' && !boxed.has(g.id));
  const runs = [];
  const inLeague = (league) => [...games.values()].filter((g) => g.league === league);
  return {
    async countFinals(league) { return inLeague(league).filter((g) => g.status === 'final').length; },
    async upsertTeams(rows) { for (const r of rows) teams.set(r.id, { ...teams.get(r.id), ...r }); },
    async upsertGames(rows) { for (const r of rows) games.set(r.id, { ...games.get(r.id), ...r }); },
    async listGamesBetween(league, from, to) { return inLeague(league).filter((g) => g.start_time >= from && g.start_time <= to); },
    async listUnratedFinals(league) { return inLeague(league).filter((g) => g.status === 'final' && !rated.has(g.id)); },
    async loadRatingState(league) { return ratingState.get(league) || null; },
    async saveRatingState(league, state, gameIds) {
      ratingState.set(league, JSON.parse(JSON.stringify(state)));
      for (const id of gameIds) rated.add(id);
    },
    async upsertPredictions(rows) {
      for (const r of rows) predictions.set(r.game_id, { created_at: r.updated_at, ...predictions.get(r.game_id), ...r });
    },
    async getPredictions(ids) { return new Map(ids.filter((id) => predictions.has(id)).map((id) => [id, predictions.get(id)])); },
    async getGradedIds(ids) { return new Set(ids.filter((id) => grades.has(id))); },
    async insertGrades(rows) { for (const r of rows) if (!grades.has(r.game_id)) grades.set(r.game_id, r); },
    async listUnboxedFinals(league, season, limit) {
      return unboxed(league, season).sort((a, b) => b.start_time.localeCompare(a.start_time)).slice(0, limit);
    },
    async countUnboxedFinals(league, season) { return unboxed(league, season).length; },
    async saveDvp(rows, gameIds) {
      for (const r of rows) dvp.set(`${r.game_id}|${r.def_team}|${r.pos}`, r);
      for (const id of gameIds) boxed.add(id);
    },
    async getPlayerPositions(league, ids) {
      return new Map(ids.filter((id) => players.has(`${league}:${id}`)).map((id) => [id, players.get(`${league}:${id}`).pos]));
    },
    async upsertPlayers(rows) { for (const r of rows) players.set(r.id, r); },
    async logRun(row) { runs.push(row); },

    // What the phone app reads, in the same shape the database gives it.
    snapshot(now = new Date()) {
      const from = new Date(now - 4 * 864e5).toISOString(), to = new Date(now.getTime() + 8 * 864e5).toISOString();
      return {
        games: [...games.values()]
          .filter((g) => g.start_time >= from && g.start_time <= to)
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
          .map((g) => ({
            ...g,
            home: teams.get(g.home_team), away: teams.get(g.away_team),
            prediction: predictions.get(g.id) || null, grade: grades.get(g.id) || null,
          })),
        record: recordRows(games, [...grades.values()], now),
        last_run: runs.at(-1)?.finished_at || null,
      };
    },
    _raw: { teams, games, predictions, grades, ratingState, rated, runs, boxed, dvp, players },
  };
}
