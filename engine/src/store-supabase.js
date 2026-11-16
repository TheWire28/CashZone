// Database access for the scheduled job. Uses the service-role key, which can
// write; that key lives only in Render's environment, never in the phone app.
import { createClient } from '@supabase/supabase-js';

const CHUNK = 500;      // rows per write
const ID_CHUNK = 150;   // ids per lookup (they travel in the URL)
const GAME_COLS = 'id,league,season,season_type,week,start_time,status,home_team,away_team,home_score,away_score,neutral_site';

export function createSupabaseStore({ url, serviceKey }) {
  if (!url || !serviceKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or run with --local to try the engine without a database).');
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const check = ({ error, data, count }, what) => {
    if (error) throw new Error(`${what}: ${error.message}`);
    return { data, count };
  };
  async function upsert(table, rows, onConflict, extra = {}) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      check(await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict, ...extra }), `write ${table}`);
    }
  }
  // Supabase returns at most 1000 rows per request, so read in pages.
  async function pages(build, what) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data } = check(await build().range(from, from + 999), what);
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }
  async function byIds(table, columns, ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data } = check(await db.from(table).select(columns).in('game_id', ids.slice(i, i + ID_CHUNK)), `read ${table}`);
      out.push(...data);
    }
    return out;
  }

  return {
    async countFinals(league) {
      const { count } = check(
        await db.from('games').select('id', { count: 'exact', head: true }).eq('league', league).eq('status', 'final'),
        'count games',
      );
      return count || 0;
    },
    upsertTeams: (rows) => upsert('teams', rows, 'id'),
    // `rated` is never sent, so an update leaves it alone.
    upsertGames: (rows) => upsert('games', rows, 'id'),
    listGamesBetween: (league, from, to) => pages(
      () => db.from('games').select(GAME_COLS).eq('league', league).gte('start_time', from).lte('start_time', to).order('id'),
      'read games',
    ),
    listUnratedFinals: (league) => pages(
      () => db.from('games').select(GAME_COLS).eq('league', league).eq('status', 'final').eq('rated', false).order('id'),
      'read unrated games',
    ),
    async loadRatingState(league) {
      const { data } = check(await db.from('league_state').select('season,lg_pts,lg_n').eq('league', league).maybeSingle(), 'read league_state');
      if (!data) return null;
      const teams = await pages(
        () => db.from('team_ratings').select('team_id,rating,games,pf,pa,n').eq('league', league).order('team_id'),
        'read team_ratings',
      );
      return { league: data, teams };
    },
    // One database transaction: new ratings and "these games are counted" land together,
    // so a crash can never count a game twice.
    async saveRatingState(league, state, gameIds) {
      check(await db.rpc('apply_ratings', { p_league: league, p_state: state.league, p_teams: state.teams, p_game_ids: gameIds }), 'save ratings');
    },
    // created_at is left out on purpose: the database sets it on first insert
    // and an update never changes it, so it records when a pick first appeared.
    upsertPredictions: (rows) => upsert('predictions', rows, 'game_id'),
    async getPredictions(ids) {
      return new Map((await byIds('predictions', '*', ids)).map((p) => [p.game_id, p]));
    },
    async getGradedIds(ids) {
      return new Set((await byIds('grades', 'game_id', ids)).map((g) => g.game_id));
    },
    insertGrades: (rows) => upsert('grades', rows, 'game_id', { ignoreDuplicates: true }),
    async logRun(row) { check(await db.from('runs').insert(row), 'write runs'); },
  };
}
