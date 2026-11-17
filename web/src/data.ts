import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Team = { id: string; abbr: string; name: string; short_name: string; color: string | null };
export type Prediction = {
  game_id?: string; league?: string;
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
  id: string; league: LeagueKey; week: number | null; start_time: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'canceled';
  home_team: string; away_team: string; home_score: number | null; away_score: number | null;
  neutral_site: boolean; venue: string | null;
  home: Team; away: Team; prediction: Prediction | null; grade: Grade | null;
};
export type RecordRow = { league: string; win: '7d' | '30d' | '90d' | 'all'; market: 'winner' | 'spread' | 'total'; wins: number; losses: number; pushes: number };
export type Board = { games: Game[]; record: RecordRow[]; last_run: string | null };

export type Stats = {
  seasons: number; n: number; decided: number; correct: number; brier: number;
  abs_margin: number; abs_total: number; home_wins: number;
  buckets: Record<string, [number, number, number]>;
};
export type LeagueState = {
  league: string; season: number | null; lg_pts: number; lg_n: number;
  stats: Stats | null; model_version: string | null; updated_at: string;
  config: { k: number; hfa: number; elo_per_point: number; regress: number; home_edge: number } | null;
};
export type RatingRow = { team_id: string; rating: number; off: number; def: number; games: number; team: Team };
export type CalibrationRow = { league: string; bucket: number; games: number; correct: number; avg_conf: number };
export type DvpRow = { def_team: string; pos: string; games: number; season: number; per_game: Record<string, number> };

// Everything league-specific the app needs. `path` is the feed path used for play-by-play;
// `dvp` lists the positions and columns for the DvP page (null: not collected).
export const LEAGUES = [
  {
    key: 'nfl', name: 'NFL', back: 8, ahead: 8, path: 'football/nfl', periods: 4, periodName: 'Q',
    dvp: { positions: ['QB', 'RB', 'WR', 'TE'], cols: [['fpts', 'FPTS'], ['pass_yds', 'Pass yds'], ['pass_td', 'Pass TD'], ['rush_yds', 'Rush yds'], ['rec', 'Rec'], ['rec_yds', 'Rec yds'], ['rec_td', 'Rec TD']] },
  },
  { key: 'ncaaf', name: 'NCAAF', back: 8, ahead: 8, path: 'football/college-football', periods: 4, periodName: 'Q', dvp: null },
  {
    key: 'nhl', name: 'NHL', back: 2, ahead: 3, path: 'hockey/nhl', periods: 3, periodName: 'P',
    dvp: { positions: ['C', 'W', 'D'], cols: [['fpts', 'FPTS'], ['g', 'G'], ['a', 'A'], ['pts', 'PTS'], ['sog', 'SOG'], ['blk', 'BLK']] },
  },
  {
    key: 'nba', name: 'NBA', back: 2, ahead: 3, path: 'basketball/nba', periods: 4, periodName: 'Q',
    dvp: { positions: ['G', 'F', 'C'], cols: [['fpts', 'FPTS'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3', '3PM'], ['stl', 'STL'], ['blk', 'BLK']] },
  },
  {
    key: 'ncaab', name: 'NCAAB', back: 1, ahead: 2, path: 'basketball/mens-college-basketball', periods: 2, periodName: 'H',
    dvp: { positions: ['G', 'F', 'C'], cols: [['fpts', 'FPTS'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3', '3PM'], ['stl', 'STL'], ['blk', 'BLK']] },
  },
] as const;
export type LeagueKey = (typeof LEAGUES)[number]['key'];
export type LeagueInfo = (typeof LEAGUES)[number];
export const leagueInfo = (k: string): LeagueInfo => LEAGUES.find((l) => l.key === k) ?? LEAGUES[0];

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(url && key);
let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!configured) throw new Error('not-configured');
  return (client ||= createClient(url!, key!, { auth: { persistSession: false } }));
}
function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// Supabase returns a one-to-one relation as an object or a one-item list depending on version.
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const GAME_SELECT = '*, home:teams!games_home_team_fkey(*), away:teams!games_away_team_fkey(*), prediction:predictions(*), grade:grades(*)';
const shapeGame = (g: any): Game => ({ ...g, prediction: one(g.prediction), grade: one(g.grade) });

export async function loadBoard(league: LeagueKey): Promise<Board> {
  const lg = leagueInfo(league);
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
  const [games, record, runs] = await Promise.all([
    db().from('games').select(GAME_SELECT)
      .eq('league', league).gte('start_time', from).lte('start_time', to).order('start_time').order('id').limit(1000),
    db().from('v_record').select('*'),
    db().from('runs').select('finished_at').eq('ok', true).order('finished_at', { ascending: false }).limit(1),
  ]);
  return {
    games: must(games).map(shapeGame),
    record: must(record) as RecordRow[],
    last_run: must(runs)[0]?.finished_at ?? null,
  };
}

export async function loadGame(id: string): Promise<Game | null> {
  const rows = must(await db().from('games').select(GAME_SELECT).eq('id', id).limit(1));
  return rows[0] ? shapeGame(rows[0]) : null;
}

export async function loadModels(league: LeagueKey) {
  const [ratings, state] = await Promise.all([
    db().from('team_ratings').select('team_id,rating,off,def,games,team:teams(*)').eq('league', league).order('rating', { ascending: false }).limit(1000),
    db().from('league_state').select('*').eq('league', league).maybeSingle(),
  ]);
  return {
    ratings: must(ratings).map((r: any) => ({ ...r, rating: Number(r.rating), off: Number(r.off), def: Number(r.def), team: one(r.team) })) as RatingRow[],
    state: must(state) as LeagueState | null,
  };
}

export async function loadInsights(league: LeagueKey) {
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 2 * 864e5).toISOString();
  const [state, calib, upcoming] = await Promise.all([
    db().from('league_state').select('*').eq('league', league).maybeSingle(),
    db().from('v_calibration').select('*').eq('league', league),
    db().from('games').select(GAME_SELECT).eq('status', 'scheduled').gte('start_time', now).lte('start_time', soon).order('start_time').limit(1000),
  ]);
  return {
    state: must(state) as LeagueState | null,
    calibration: must(calib) as CalibrationRow[],
    upcoming: must(upcoming).map(shapeGame).filter((g) => g.prediction),
  };
}

export async function loadDvp(league: LeagueKey, pos: string) {
  const [rows, teams] = await Promise.all([
    db().from('v_dvp').select('*').eq('league', league).eq('pos', pos).limit(1000),
    db().from('teams').select('*').eq('league', league).limit(1000),
  ]);
  const byId = new Map((must(teams) as Team[]).map((t) => [t.id, t]));
  return (must(rows) as DvpRow[]).map((r) => ({ ...r, team: byId.get(r.def_team) })).filter((r) => r.team) as (DvpRow & { team: Team })[];
}

// Play-by-play and box score come straight from the public feed, so they are always current.
export async function loadSummary(game: Pick<Game, 'id' | 'league'>): Promise<any> {
  const lg = leagueInfo(game.league);
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${lg.path}/summary?event=${game.id.split(':')[1]}`);
  if (!res.ok) throw new Error(`Play-by-play is unavailable right now (HTTP ${res.status}).`);
  return res.json();
}
