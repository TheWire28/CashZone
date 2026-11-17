import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Game, RecordRow, Team } from './data';

export const timeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
export const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
export const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const odds = (n: number) => (n > 0 ? `+${n}` : `${n}`);
export const line = (n: number) => (n === 0 ? 'PK' : n > 0 ? `+${n}` : `${n}`);
export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const one = (n: number) => n.toFixed(1);

export function Badge({ t, small }: { t: Team; small?: boolean }) {
  return <span className={`badge${small ? ' sm' : ''}`} style={{ background: `#${t.color || '24304d'}` }}>{t.abbr}</span>;
}

export function Notice({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="card notice">
      {title ? <strong>{title}</strong> : null}
      {children ? <span>{children}</span> : null}
    </div>
  );
}

export function Mark({ r }: { r: 'win' | 'loss' | 'push' | null }) {
  if (!r) return <span className="mark none">—</span>;
  return <span className={`mark ${r}`}>{r === 'win' ? 'W' : r === 'loss' ? 'L' : 'P'}</span>;
}

export function recordFor(rows: RecordRow[], market: RecordRow['market'], win: RecordRow['win'], league?: string) {
  const hit = rows.filter((r) => r.market === market && r.win === win && (!league || r.league === league));
  const wins = hit.reduce((s, r) => s + r.wins, 0), losses = hit.reduce((s, r) => s + r.losses, 0), pushes = hit.reduce((s, r) => s + r.pushes, 0);
  return { wins, losses, pushes, rate: wins + losses ? wins / (wins + losses) : null };
}

// The model's line from the home team's side, e.g. -5.5 when it has the home team by 5.5.
export const modelSpreadHome = (g: Game) => -(g.prediction!.proj_home - g.prediction!.proj_away);
export const modelTotal = (g: Game) => g.prediction!.proj_home + g.prediction!.proj_away;
export const spreadEdge = (g: Game) =>
  g.prediction?.market_spread_home == null ? null : Math.abs(modelSpreadHome(g) - g.prediction.market_spread_home);
export const totalEdge = (g: Game) =>
  g.prediction?.market_total == null ? null : Math.abs(modelTotal(g) - g.prediction.market_total);
export const spreadLabel = (g: Game, homeNumber: number) =>
  homeNumber <= 0 ? `${g.home.abbr} ${line(homeNumber === 0 ? 0 : Math.round(homeNumber * 10) / 10)}` : `${g.away.abbr} ${line(-Math.round(homeNumber * 10) / 10)}`;

// Load data for a page. Only the latest request may update the screen, so a slow answer
// for a league you already switched away from is ignored.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async (keep = false) => {
    const mine = ++latest.current;
    if (!keep) setData(null);
    setLoading(true);
    try {
      const v = await run();
      if (mine === latest.current) { setData(v); setError(null); }
    } catch (e) {
      if (mine === latest.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

export function LoadState({ error, loading, what }: { error: string | null; loading: boolean; what: string }) {
  if (error === 'not-configured') return <Notice title="Not connected yet.">The app isn’t connected to its database.</Notice>;
  if (error) return <div className="card notice" role="alert"><strong>Couldn’t load {what}.</strong><span>{error}</span></div>;
  if (loading) return <Notice>Loading {what}…</Notice>;
  return null;
}
