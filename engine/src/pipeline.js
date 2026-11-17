// One sync = pull the feed, store games, update team ratings, store picks for games that
// have not started, grade picks for games that finished. Safe to run as often as you like:
// every step is an upsert or skips work that is already done.
//
// Ratings are kept in the database and only *new* finished games are applied to them, so a
// normal run reads a few hundred rows no matter how much history a league has.
import { pull } from './pull.js';
import { Ratings, gradeGame, MODEL_VERSION } from './model.js';
import { collectDvp } from './box.js';

const DAY = 864e5;
const byStart = (a, b) => a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id);

export async function sync(lg, store, { now = new Date(), fetchJson, log = () => {} } = {}) {
  const started = new Date().toISOString();
  const nowIso = now.toISOString();

  const firstRun = (await store.countFinals(lg.key)) === 0;
  const fresh = await pull(lg, { firstRun, now, fetchJson, log });
  const lines = new Map(fresh.games.map((g) => [g.id, g.line]));
  await store.upsertTeams(fresh.teams);
  await store.upsertGames(fresh.games.map(({ line, ...row }) => row));

  // Ratings: load where we left off, apply finished games not yet counted, save.
  const ratings = Ratings.fromState(lg, await store.loadRatingState(lg.key));
  const unrated = (await store.listUnratedFinals(lg.key)).sort(byStart);
  for (const g of unrated) ratings.add(g);
  if (unrated.length) await store.saveRatingState(lg.key, ratings.toState(lg.key), unrated.map((g) => g.id));

  // Picks: only for games that have not started. Once a game starts its pick is never
  // touched again, which is what makes the record trustworthy.
  const recent = (await store.listGamesBetween(lg.key, new Date(now - 5 * DAY).toISOString(), new Date(now.getTime() + 10 * DAY).toISOString())).sort(byStart);
  const upcoming = recent.filter((g) => g.status === 'scheduled' && g.start_time > nowIso);
  const picks = [];
  for (const g of upcoming) {
    // A team the model has barely seen gets no pick rather than a guess.
    if (Math.min(ratings.team(g.home_team).games, ratings.team(g.away_team).games) < (lg.minGames || 0)) continue;
    ratings.ensureSeason(g.season);
    picks.push({
      game_id: g.id, league: g.league, model_version: MODEL_VERSION,
      ...ratings.predict({ ...g, line: lines.get(g.id) }),
      updated_at: nowIso,
    });
  }
  await store.upsertPredictions(picks);

  // Grades: recently finished games that had a pick and are not graded yet.
  const finals = recent.filter((g) => g.status === 'final');
  const ids = finals.map((g) => g.id);
  const preds = await store.getPredictions(ids);
  const graded = await store.getGradedIds(ids);
  const grades = finals
    .filter((g) => preds.has(g.id) && !graded.has(g.id))
    .map((g) => ({ ...gradeGame(g, preds.get(g.id)), graded_at: nowIso }));
  await store.insertGrades(grades);

  // Box scores for defense-vs-position. A failure here never costs the picks above.
  let dvp = {};
  try {
    dvp = await collectDvp(lg, store, ratings.season, { fetchJson, log });
  } catch (err) {
    dvp = { dvp_error: err.message };
    log(`[${lg.key}] DvP skipped this run: ${err.message}`);
  }

  const summary = {
    league: lg.key, games_seen: fresh.games.length, games_rated: unrated.length,
    picks_stored: picks.length, picks_graded: grades.length, ...dvp,
  };
  await store.logRun({ job: `sync:${lg.key}`, started_at: started, finished_at: new Date().toISOString(), ok: true, detail: summary });
  return summary;
}
