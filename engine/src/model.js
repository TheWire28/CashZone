// The prediction model. Pure functions and one small class, no I/O, so the
// same code runs in the scheduled job, the backtest and the tests.
//
// v1 is deliberately simple and honest:
//   - who wins and by how much: Elo ratings with margin of victory + home field
//   - how many points: each team's scoring for/against, shrunk toward league average
export const MODEL_VERSION = 'elo-pts-v1';

const round1 = (x) => Math.round(x * 10) / 10;

export function fairAmericanOdds(p) {
  const q = Math.min(Math.max(p, 0.01), 0.99);
  return q >= 0.5 ? -Math.round((100 * q) / (1 - q)) : Math.round((100 * (1 - q)) / q);
}

export class Ratings {
  constructor(cfg) {
    this.cfg = cfg;
    this.teams = new Map();
    this.season = null;
    this.lgPts = 0;
    this.lgN = 0;
  }

  team(id) {
    let t = this.teams.get(id);
    if (!t) {
      t = { elo: 1500, pf: 0, pa: 0, n: 0, games: 0 };
      this.teams.set(id, t);
    }
    return t;
  }

  leagueAvg() {
    return this.lgN >= 20 ? this.lgPts / this.lgN : this.cfg.avgPoints;
  }

  // New season: ratings drift back toward average and last year's scoring
  // numbers count for a quarter of what they did.
  rollover() {
    for (const t of this.teams.values()) {
      t.elo = 1500 + (t.elo - 1500) * (1 - this.cfg.regress);
      t.pf *= 0.25; t.pa *= 0.25; t.n *= 0.25;
    }
    this.lgPts *= 0.25; this.lgN *= 0.25;
  }

  eloDiff(g) {
    return this.team(g.home_team).elo - this.team(g.away_team).elo + (g.neutral_site ? 0 : this.cfg.hfa);
  }

  predict(g) {
    const { cfg } = this;
    const h = this.team(g.home_team), a = this.team(g.away_team);
    const diff = this.eloDiff(g);
    const p = 1 / (1 + 10 ** (-diff / 400));
    const margin = diff / cfg.eloPerPoint;

    const lg = this.leagueAvg();
    const shrunk = (sum, n) => (sum + lg * cfg.priorGames) / (n + cfg.priorGames);
    const total = Math.max(
      shrunk(h.pf, h.n) + shrunk(a.pa, a.n) - lg + (shrunk(a.pf, a.n) + shrunk(h.pa, h.n) - lg),
      lg,
    );
    const home = Math.max((total + margin) / 2, 3);
    const away = Math.max((total - margin) / 2, 3);

    const homeWins = p >= 0.5;
    const out = {
      home_win_prob: Math.round(p * 1000) / 1000,
      proj_home: round1(home),
      proj_away: round1(away),
      pick_winner: homeWins ? g.home_team : g.away_team,
      confidence: Math.round(Math.max(p, 1 - p) * 1000) / 1000,
      fair_odds: fairAmericanOdds(Math.max(p, 1 - p)),
      market_spread_home: null, market_total: null, pick_spread: null, pick_total: null,
    };
    const line = g.line || {};
    if (typeof line.spreadHome === 'number') {
      // spreadHome is the home team's number, e.g. -4.5 when the home team is favored.
      out.market_spread_home = line.spreadHome;
      const edge = (out.proj_home - out.proj_away) + line.spreadHome;
      if (edge !== 0) out.pick_spread = edge > 0 ? g.home_team : g.away_team;
    }
    if (typeof line.total === 'number') {
      out.market_total = line.total;
      const t = out.proj_home + out.proj_away;
      if (t !== line.total) out.pick_total = t > line.total ? 'over' : 'under';
    }
    return out;
  }

  // Call before predicting or adding a game so a new season is handled once.
  ensureSeason(season) {
    if (this.season !== null && season !== this.season) this.rollover();
    this.season = season;
  }

  add(g) {
    const { cfg } = this;
    this.ensureSeason(g.season);
    const h = this.team(g.home_team), a = this.team(g.away_team);
    const diff = this.eloDiff(g);
    const expected = 1 / (1 + 10 ** (-diff / 400));
    const margin = g.home_score - g.away_score;
    const result = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    const winnerDiff = margin >= 0 ? diff : -diff;
    // Blowouts count for more, but less so when the favorite did the blowing out.
    const mov = Math.log(Math.max(Math.abs(margin), 1) + 1) * (2.2 / (winnerDiff * 0.001 + 2.2));
    const delta = cfg.k * mov * (result - expected);
    h.elo += delta; a.elo -= delta;
    h.pf += g.home_score; h.pa += g.away_score; h.n += 1; h.games += 1;
    a.pf += g.away_score; a.pa += g.home_score; a.n += 1; a.games += 1;
    this.lgPts += g.home_score + g.away_score; this.lgN += 2;
  }

  snapshot(league) {
    const lg = this.leagueAvg();
    return [...this.teams.entries()].map(([team_id, t]) => ({
      team_id, league,
      rating: round1(t.elo),
      off: round1(t.n ? t.pf / t.n : lg),
      def: round1(t.n ? t.pa / t.n : lg),
      games: t.games,
    }));
  }
}

export function gradeGame(g, p) {
  const margin = g.home_score - g.away_score;
  const total = g.home_score + g.away_score;
  const out = {
    game_id: g.id, league: g.league,
    winner_correct: margin === 0 ? null : (margin > 0 ? g.home_team : g.away_team) === p.pick_winner,
    spread_result: null, total_result: null,
    margin_error: round1(Math.abs((p.proj_home - p.proj_away) - margin)),
    total_error: round1(Math.abs((p.proj_home + p.proj_away) - total)),
  };
  if (p.pick_spread && typeof p.market_spread_home === 'number') {
    const homeCover = margin + p.market_spread_home;
    out.spread_result = homeCover === 0 ? 'push' : (homeCover > 0) === (p.pick_spread === g.home_team) ? 'win' : 'loss';
  }
  if (p.pick_total && typeof p.market_total === 'number') {
    out.total_result = total === p.market_total ? 'push' : (total > p.market_total) === (p.pick_total === 'over') ? 'win' : 'loss';
  }
  return out;
}

// Walk-forward backtest: every game is predicted using only games before it.
export function backtest(finals, cfg, { fromSeason } = {}) {
  const r = new Ratings(cfg);
  const s = { games: 0, correct: 0, ties: 0, brier: 0, marginErr: 0, totalErr: 0, buckets: {} };
  for (const g of finals) {
    r.ensureSeason(g.season);
    if (!fromSeason || g.season >= fromSeason) {
      const p = r.predict(g);
      const gr = gradeGame(g, p);
      s.games++;
      if (gr.winner_correct === null) s.ties++; else if (gr.winner_correct) s.correct++;
      const homeWon = g.home_score > g.away_score ? 1 : g.home_score < g.away_score ? 0 : 0.5;
      s.brier += (p.home_win_prob - homeWon) ** 2;
      s.marginErr += gr.margin_error; s.totalErr += gr.total_error;
      const b = `${Math.floor(p.confidence * 10) * 10}s`;
      s.buckets[b] ??= { n: 0, correct: 0 };
      s.buckets[b].n++; if (gr.winner_correct) s.buckets[b].correct++;
    }
    r.add(g);
  }
  const decided = s.games - s.ties;
  return {
    games: s.games,
    winner_pct: decided ? round1((100 * s.correct) / decided) : null,
    brier: s.games ? Math.round((s.brier / s.games) * 1000) / 1000 : null,
    avg_margin_error: s.games ? round1(s.marginErr / s.games) : null,
    avg_total_error: s.games ? round1(s.totalErr / s.games) : null,
    by_confidence: Object.fromEntries(Object.entries(s.buckets).sort().map(([k, v]) => [k, `${v.correct}/${v.n}`])),
  };
}
