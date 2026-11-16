import { createClient } from '@supabase/supabase-js';

export type Team = { id: string; abbr: string; name: string; short_name: string; color: string | null };
export type Prediction = {
  home_win_prob: number; proj_home: number; proj_away: number;
  pick_winner: string; confidence: number; fair_odds: number;
  market_spread_home: number | null; market_total: number | null;
  pick_spread: string | null; pick_total: 'over' | 'under' | null;
};
export type Grade = {
  winner_correct: boolean | null;
  spread_result: 'win' | 'loss' | 'push' | null;
  total_result: 'win' | 'loss' | 'push' | null;
};
export type Game = {
  id: string; league: string; week: number | null; start_time: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'canceled';
  home_team: string; away_team: string; home_score: number | null; away_score: number | null;
  neutral_site: boolean; venue: string | null;
  home: Team; away: Team; prediction: Prediction | null; grade: Grade | null;
};
export type RecordRow = { league: string; win: '7d' | '30d' | '90d' | 'all'; market: 'winner' | 'spread' | 'total'; wins: number; losses: number; pushes: number };
export type Board = { games: Game[]; record: RecordRow[]; last_run: string | null };

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(url && key);

// Supabase returns a one-to-one relation as an object or a one-item list depending on version.
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export const LEAGUES = [
  { key: 'nfl', name: 'NFL', back: 8, ahead: 8 },
  { key: 'ncaaf', name: 'NCAAF', back: 8, ahead: 8 },
  { key: 'nhl', name: 'NHL', back: 2, ahead: 3 },
  { key: 'nba', name: 'NBA', back: 2, ahead: 3 },
  { key: 'ncaab', name: 'NCAAB', back: 1, ahead: 2 },
] as const;
export type LeagueKey = (typeof LEAGUES)[number]['key'];

export async function loadBoard(league: LeagueKey): Promise<Board> {
  const lg = LEAGUES.find((l) => l.key === league)!;
  const from = new Date(Date.now() - lg.back * 864e5).toISOString();
  const to = new Date(Date.now() + lg.ahead * 864e5).toISOString();
  if (!configured) {
    // Local development only: a snapshot written by `npm run sync:local` in /engine.
    if (import.meta.env.DEV) {
      const res = await fetch('/dev-snapshot.json');
      if (res.ok) {
        const snap: Board = await res.json();
        return { ...snap, games: snap.games.filter((g) => g.league === league && g.start_time >= from && g.start_time <= to) };
      }
    }
    throw new Error('not-configured');
  }
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  const [games, record, runs] = await Promise.all([
    db.from('games')
      .select('*, home:teams!games_home_team_fkey(*), away:teams!games_away_team_fkey(*), prediction:predictions(*), grade:grades(*)')
      .eq('league', league).gte('start_time', from).lte('start_time', to).order('start_time').order('id').limit(1000),
    db.from('v_record').select('*'),
    db.from('runs').select('finished_at').eq('ok', true).order('finished_at', { ascending: false }).limit(1),
  ]);
  const failed = games.error || record.error || runs.error;
  if (failed) throw new Error(failed.message);
  return {
    games: (games.data || []).map((g: any) => ({ ...g, prediction: one(g.prediction), grade: one(g.grade) })),
    record: (record.data || []) as RecordRow[],
    last_run: runs.data?.[0]?.finished_at ?? null,
  };
}
