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
  const teams = new Map(), games = new Map(), predictions = new Map(), grades = new Map(), ratings = new Map();
  const runs = [];
  return {
    async countFinals(league) { return [...games.values()].filter((g) => g.league === league && g.status === 'final').length; },
    async upsertTeams(rows) { for (const r of rows) teams.set(r.id, { ...teams.get(r.id), ...r }); },
    async upsertGames(rows) { for (const r of rows) games.set(r.id, { ...games.get(r.id), ...r }); },
    async listGames(league) { return [...games.values()].filter((g) => g.league === league); },
    async upsertPredictions(rows) {
      for (const r of rows) predictions.set(r.game_id, { created_at: r.updated_at, ...predictions.get(r.game_id), ...r });
    },
    async listPredictions(league) { return new Map([...predictions].filter(([, p]) => p.league === league)); },
    async listGradedIds(league) { return new Set([...grades.values()].filter((g) => g.league === league).map((g) => g.game_id)); },
    async insertGrades(rows) { for (const r of rows) if (!grades.has(r.game_id)) grades.set(r.game_id, r); },
    async upsertRatings(rows) { for (const r of rows) ratings.set(r.team_id, r); },
    async logRun(row) { runs.push(row); },

    // What the phone app reads, in the same shape the database gives it.
    snapshot(now = new Date()) {
      const cutoff = new Date(now - 10 * 864e5).toISOString();
      return {
        games: [...games.values()]
          .filter((g) => g.start_time >= cutoff)
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
    _raw: { teams, games, predictions, grades, ratings, runs },
  };
}
