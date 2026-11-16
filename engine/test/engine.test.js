import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAGUES } from '../src/leagues.js';
import { normalizeEvent } from '../src/espn.js';
import { Ratings, gradeGame, fairAmericanOdds } from '../src/model.js';
import { sync } from '../src/pipeline.js';
import { createMemoryStore } from '../src/store-memory.js';

const lg = LEAGUES.nfl;
const DAY = 864e5;

// Builds a feed event in the same shape the real scoreboard returns.
function event({ id, date, week, year = 2026, state = 'post', home, away, hs = '0', as = '0', odds }) {
  const comp = (t, homeAway, score) => ({ homeAway, score, team: { id: t, abbreviation: `T${t}`, displayName: `Team ${t}`, shortDisplayName: `T${t}`, color: '112233' } });
  return {
    id, date, season: { year, type: 2 }, week: { number: week },
    status: { type: { state, completed: state === 'post' } },
    competitions: [{ neutralSite: false, venue: { fullName: 'Test Field' }, odds: odds ? [odds] : undefined, competitors: [comp(home, 'home', hs), comp(away, 'away', as)] }],
  };
}

test('normalizeEvent maps a final and reads the line', () => {
  const n = normalizeEvent(lg, event({ id: '9', date: '2026-11-17T01:15Z', week: 10, state: 'pre', home: '33', away: '24', odds: { spread: -4.5, overUnder: 39.5 } }));
  assert.equal(n.game.id, 'nfl:9');
  assert.equal(n.game.status, 'scheduled');
  assert.equal(n.game.home_score, null);
  assert.deepEqual(n.game.line, { spreadHome: -4.5, total: 39.5 });
  assert.equal(n.game.start_time, '2026-11-17T01:15:00.000Z');
  assert.equal(normalizeEvent(lg, { ...event({ id: '1', date: '2026-08-10T00:00Z', week: 1, home: '1', away: '2' }), season: { year: 2026, type: 1 } }), null, 'preseason is skipped');
});

test('fair odds', () => {
  assert.equal(fairAmericanOdds(0.5), -100);
  assert.equal(fairAmericanOdds(0.75), -300);
  assert.equal(fairAmericanOdds(0.25), 300);
});

test('ratings reward winners and home field shows up in the pick', () => {
  const r = new Ratings(lg);
  const even = r.predict({ home_team: 'a', away_team: 'b', neutral_site: false, season: 2026 });
  assert.ok(even.home_win_prob > 0.5 && even.home_win_prob < 0.6);
  r.add({ home_team: 'a', away_team: 'b', home_score: 10, away_score: 31, neutral_site: false, season: 2026 });
  assert.ok(r.team('b').elo > 1500 && r.team('a').elo < 1500);
  assert.equal(Math.round(r.team('a').elo + r.team('b').elo), 3000, 'ratings are zero-sum');
});

test('grading: winner, spread and total, including pushes', () => {
  const g = { id: 'g', league: 'nfl', home_team: 'h', away_team: 'a', home_score: 24, away_score: 20 };
  const base = { pick_winner: 'h', proj_home: 27, proj_away: 20 };
  assert.equal(gradeGame(g, base).winner_correct, true);
  assert.equal(gradeGame(g, { ...base, pick_winner: 'a' }).winner_correct, false);
  // Home favored by 4.5, won by 4: home did not cover.
  assert.equal(gradeGame(g, { ...base, market_spread_home: -4.5, pick_spread: 'h' }).spread_result, 'loss');
  assert.equal(gradeGame(g, { ...base, market_spread_home: -4.5, pick_spread: 'a' }).spread_result, 'win');
  assert.equal(gradeGame(g, { ...base, market_spread_home: -4, pick_spread: 'h' }).spread_result, 'push');
  assert.equal(gradeGame(g, { ...base, market_total: 43.5, pick_total: 'over' }).total_result, 'win');
  assert.equal(gradeGame(g, { ...base, market_total: 44, pick_total: 'under' }).total_result, 'push');
  assert.equal(gradeGame({ ...g, away_score: 24 }, base).winner_correct, null, 'tie has no winner grade');
});

test('sync: picks lock at kickoff and are graded once the game is final', async () => {
  const store = createMemoryStore();
  let phase = 'before';
  const upcoming = () => event({
    id: '500', date: '2026-11-22T18:00Z', week: 11, home: '1', away: '2',
    state: phase === 'before' ? 'pre' : 'post', hs: '30', as: '10',
    odds: phase === 'before' ? { spread: -3, overUnder: 44.5 } : undefined,
  });
  const fetchJson = async (url) => {
    const u = new URL(url);
    const year = Number(u.searchParams.get('dates') || 2026);
    const week = Number(u.searchParams.get('week') || 10);
    const events = [];
    if (year === 2026 && week === 11) events.push(upcoming());
    else if (week <= 10) events.push(event({ id: `${year}${week}`, date: `${year}-09-${String(week + 5).padStart(2, '0')}T18:00Z`, week, year, home: '1', away: '2', hs: '27', as: '17' }));
    return { season: { year: 2026, type: 2 }, week: { number: 10 }, events };
  };

  const first = await sync(lg, store, { now: new Date('2026-11-16T22:00Z'), fetchJson });
  assert.equal(first.picks_stored, 1, 'next week is picked on the very first run');
  assert.equal(first.picks_graded, 0, 'history is never graded: the record starts clean');
  const pick = (await store.getPredictions(['nfl:500'])).get('nfl:500');
  assert.equal(pick.pick_winner, 'nfl:1');
  assert.equal(pick.market_spread_home, -3);

  phase = 'after';
  const later = await sync(lg, store, { now: new Date('2026-11-23T02:00Z'), fetchJson });
  assert.equal(later.picks_stored, 0, 'a finished game is not re-picked');
  assert.equal(later.picks_graded, 1);
  assert.deepEqual((await store.getPredictions(['nfl:500'])).get('nfl:500'), pick, 'the stored pick did not change after kickoff');
  assert.equal(later.games_rated, 1, 'only the newly finished game is added to the ratings');
  const snap = store.snapshot(new Date('2026-11-23T02:00Z'));
  assert.deepEqual(snap.record.find((r) => r.market === 'winner' && r.win === 'all'), { league: 'nfl', win: 'all', market: 'winner', wins: 1, losses: 0, pushes: 0 });

  const again = await sync(lg, store, { now: new Date('2026-11-23T03:00Z'), fetchJson });
  assert.equal(again.picks_graded, 0, 'a game is graded only once');
  assert.equal(again.games_rated, 0, 'a game is rated only once');
});

test('ratings saved and reloaded continue exactly where they left off', () => {
  const games = Array.from({ length: 12 }, (_, i) => ({ home_team: `t${i % 4}`, away_team: `t${(i + 1 + (i % 3)) % 4}`, home_score: 20 + (i * 7) % 13, away_score: 14 + (i * 5) % 17, neutral_site: false, season: i < 6 ? 2025 : 2026 }));
  const straight = new Ratings(lg);
  for (const g of games) straight.add(g);
  const first = new Ratings(lg);
  for (const g of games.slice(0, 7)) first.add(g);
  const resumed = Ratings.fromState(lg, JSON.parse(JSON.stringify(first.toState('nfl'))));
  for (const g of games.slice(7)) resumed.add(g);
  const next = { home_team: 't0', away_team: 't2', neutral_site: false, season: 2026 };
  assert.deepEqual(resumed.predict(next), straight.predict(next));
});

test('college: games against teams outside the division are skipped', () => {
  const e = event({ id: '7', date: '2026-11-14T18:00Z', week: 11, home: '1', away: '2' });
  assert.equal(normalizeEvent(LEAGUES.ncaab, e), null, 'no conference on either team');
  for (const c of e.competitions[0].competitors) c.team.conferenceId = '4';
  assert.equal(normalizeEvent(LEAGUES.ncaab, e).game.league, 'ncaab');
  e.competitions[0].type = { abbreviation: 'ALLSTAR' };
  assert.equal(normalizeEvent(LEAGUES.ncaab, e), null, 'all-star games are skipped');
});

test('day leagues: first run loads history, later runs ask only for nearby days', async () => {
  const store = createMemoryStore();
  const asked = [];
  const now = new Date('2026-11-16T22:00Z');
  const fetchJson = async (url) => {
    const d = new URL(url).searchParams.get('dates');
    asked.push(d);
    const events = [];
    if (d === '202610') events.push({ ...event({ id: '1', date: '2026-10-20T23:00Z', home: '1', away: '2', hs: '110', as: '99' }), season: { year: 2027, type: 2 } });
    if (d === '20261117') events.push({ ...event({ id: '2', date: '2026-11-18T00:00Z', home: '2', away: '1', state: 'pre', odds: { spread: -2.5, overUnder: 221.5 } }), season: { year: 2027, type: 2 } });
    return { events };
  };
  const first = await sync(LEAGUES.nba, store, { now, fetchJson });
  assert.ok(asked.includes('202610') && asked.includes('202510'), 'history is requested by month');
  assert.deepEqual([first.games_rated, first.picks_stored], [1, 1]);
  asked.length = 0;
  await sync(LEAGUES.nba, store, { now: new Date(now.getTime() + 30 * 60e3), fetchJson });
  assert.deepEqual(asked.sort(), ['20261115', '20261116', '20261117', '20261118', '20261119'], 'yesterday through three days ahead, in US Eastern days');
});
