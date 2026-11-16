// Database access for the scheduled job. Uses the service-role key, which can
// write; that key lives only in Render's environment, never in the phone app.
import { createClient } from '@supabase/supabase-js';

const CHUNK = 500;

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
  async function all(table, columns, league, orderBy) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data } = check(
        await db.from(table).select(columns).eq('league', league).order(orderBy).range(from, from + 999),
        `read ${table}`,
      );
      out.push(...data);
      if (data.length < 1000) return out;
    }
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
    upsertGames: (rows) => upsert('games', rows, 'id'),
    listGames: (league) => all('games', '*', league, 'id'),
    // created_at is left out on purpose: the database sets it on first insert
    // and an update never changes it, so it records when a pick first appeared.
    upsertPredictions: (rows) => upsert('predictions', rows, 'game_id'),
    async listPredictions(league) {
      return new Map((await all('predictions', '*', league, 'game_id')).map((p) => [p.game_id, p]));
    },
    async listGradedIds(league) {
      return new Set((await all('grades', 'game_id', league, 'game_id')).map((g) => g.game_id));
    },
    insertGrades: (rows) => upsert('grades', rows, 'game_id', { ignoreDuplicates: true }),
    upsertRatings: (rows) => upsert('team_ratings', rows, 'team_id'),
    async logRun(row) { check(await db.from('runs').insert(row), 'write runs'); },
  };
}
