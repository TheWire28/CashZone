// One sync = pull the feed, store games, rate teams, store picks for games that
// have not started, grade picks for games that finished. Safe to run as often
// as you like: every step is an upsert or skips work that is already done.
import { fetchScoreboard, normalizeEvent } from './espn.js';
import { Ratings, gradeGame, MODEL_VERSION } from './model.js';

const byStart = (a, b) => a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id);

async function pull(lg, store, fetchJson, log) {
  const head = await fetchScoreboard(lg, {}, fetchJson);
  const year = head?.season?.year;
  const type = head?.season?.type;
  const week = head?.week?.number;
  if (!year) throw new Error('Feed response had no season; its format may have changed.');

  const boards = [head];
  const haveHistory = (await store.countFinals(lg.key)) > 0;
  const want = [];
  if (!haveHistory) {
    // First run: last season plus this season so far, so ratings start informed.
    for (let w = 1; w <= lg.regularWeeks; w++) want.push({ year: year - 1, type: 2, week: w });
    const upTo = type === 2 ? week : type > 2 ? lg.regularWeeks : 0;
    for (let w = 1; w <= Math.min(upTo + 1, lg.regularWeeks); w++) {
      if (!(type === 2 && w === week)) want.push({ year, type: 2, week: w }); // current week is already loaded
    }
    log(`First run: loading ${want.length} weeks of history.`);
  } else if (type === 2 && week) {
    // Normal run: last week (late finals) and next week (early lines).
    for (const w of [week - 1, week + 1]) if (w >= 1 && w <= lg.regularWeeks) want.push({ year, type: 2, week: w });
  }
  for (const p of want) boards.push(await fetchScoreboard(lg, p, fetchJson));

  const teams = new Map(), games = new Map();
  for (const b of boards) {
    for (const e of b?.events || []) {
      const n = normalizeEvent(lg, e);
      if (!n) continue;
      for (const t of n.teams) teams.set(t.id, t);
      games.set(n.game.id, n.game);
    }
  }
  return { teams: [...teams.values()], games: [...games.values()] };
}

export async function sync(lg, store, { now = new Date(), fetchJson, log = () => {} } = {}) {
  const started = new Date().toISOString();
  const fresh = await pull(lg, store, fetchJson, log);
  const lines = new Map(fresh.games.map((g) => [g.id, g.line]));
  await store.upsertTeams(fresh.teams);
  await store.upsertGames(fresh.games.map(({ line, ...row }) => row));

  const games = (await store.listGames(lg.key)).sort(byStart);
  const finals = games.filter((g) => g.status === 'final');
  const ratings = new Ratings(lg);
  for (const g of finals) ratings.add(g);

  // Picks: only for games that have not kicked off. Once a game starts its
  // pick is never touched again, which is what makes the record trustworthy.
  const nowIso = now.toISOString();
  const upcoming = games.filter((g) => g.status === 'scheduled' && g.start_time > nowIso);
  const picks = upcoming.map((g) => {
    ratings.ensureSeason(g.season);
    return {
      game_id: g.id, league: g.league, model_version: MODEL_VERSION,
      ...ratings.predict({ ...g, line: lines.get(g.id) }),
      updated_at: nowIso,
    };
  });
  await store.upsertPredictions(picks);

  // Grades: finished games that had a pick and are not graded yet.
  const preds = await store.listPredictions(lg.key);
  const graded = await store.listGradedIds(lg.key);
  const grades = finals
    .filter((g) => preds.has(g.id) && !graded.has(g.id))
    .map((g) => ({ ...gradeGame(g, preds.get(g.id)), graded_at: nowIso }));
  await store.insertGrades(grades);

  await store.upsertRatings(ratings.snapshot(lg.key).map((r) => ({ ...r, updated_at: nowIso })));

  const summary = {
    league: lg.key, games_seen: fresh.games.length, finals: finals.length,
    picks_stored: picks.length, picks_graded: grades.length,
  };
  await store.logRun({ job: `sync:${lg.key}`, started_at: started, finished_at: new Date().toISOString(), ok: true, detail: summary });
  return summary;
}
