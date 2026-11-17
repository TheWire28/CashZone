import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { leagueInfo, loadGame, loadSummary, type Game } from '../data';
import { Badge, LoadState, Mark, Notice, useLoad } from '../ui';
import { GameCard } from './Board';

type Play = { id: string; text: string; period: number; clock: string; away: number | null; home: number | null; scoring: boolean; team: string | null };
type Drive = { id: string; team: string | null; desc: string; result: string; plays: Play[] };

const toPlay = (p: any): Play => ({
  id: String(p.id ?? p.sequenceNumber ?? Math.random()),
  text: p.text || p.shortDescription || p.type?.text || '',
  period: p.period?.number ?? 0,
  clock: p.clock?.displayValue ?? '',
  away: p.awayScore ?? null,
  home: p.homeScore ?? null,
  scoring: Boolean(p.scoringPlay),
  team: p.team?.id ? String(p.team.id) : null,
});

function readPlays(s: any): { drives: Drive[] | null; plays: Play[] } {
  if (s?.drives) {
    const list = [...(s.drives.previous || []), ...(s.drives.current ? [s.drives.current] : [])];
    const seen = new Set<string>();
    const drives: Drive[] = [];
    for (const d of list) {
      const id = String(d.id);
      if (seen.has(id)) continue;
      seen.add(id);
      drives.push({
        id, team: d.team?.id ? String(d.team.id) : null,
        desc: d.description || '', result: d.displayResult || d.result || '',
        plays: (d.plays || []).map(toPlay),
      });
    }
    return { drives, plays: drives.flatMap((d) => d.plays) };
  }
  return { drives: null, plays: (s?.plays || []).map(toPlay) };
}

export function GameView({ id, fromBoard }: { id: string; fromBoard: Game | undefined }) {
  const game = useLoad(async () => fromBoard ?? (await loadGame(id)), [id, fromBoard?.id]);
  const g = game.data;
  if (!g) return <main><BackLink /><LoadState error={game.error} loading={game.loading} what="this game" />{!game.loading && !game.error ? <Notice>That game isn’t in the database.</Notice> : null}</main>;
  return <GameDetail g={g} />;
}

function BackLink() {
  const back = (e: MouseEvent) => {
    if (window.history.length > 1) { e.preventDefault(); window.history.back(); }
  };
  return <a className="back" href="#/pbp" onClick={back}>‹ Back</a>;
}

function GameDetail({ g }: { g: Game }) {
  const lg = leagueInfo(g.league);
  const summary = useLoad(() => loadSummary(g), [g.id]);
  const s = summary.data;
  const comp = s?.header?.competitions?.[0];
  const status = comp?.status?.type;
  const live = status?.state === 'in';
  const [filter, setFilter] = useState<'all' | 'scoring'>('all');
  const [limit, setLimit] = useState(120);

  // Live games refresh every 30 seconds while this page is open.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => summary.reload(true), 30_000);
    return () => clearInterval(t);
  }, [live, summary.reload]);

  const homeId = g.home_team.split(':')[1], awayId = g.away_team.split(':')[1];
  const teamFor = (espnId: string | null) => (espnId === homeId ? g.home : espnId === awayId ? g.away : null);
  const comps = comp?.competitors || [];
  const side = (ha: 'home' | 'away') => comps.find((c: any) => c.homeAway === ha);
  const scoreOf = (ha: 'home' | 'away') => side(ha)?.score ?? (ha === 'home' ? g.home_score : g.away_score);
  const lines = (ha: 'home' | 'away'): string[] => (side(ha)?.linescores || []).map((l: any) => l.displayValue ?? String(l.value ?? ''));
  const nPeriods = Math.max(lines('home').length, lines('away').length);
  const periodLabel = (p: number) => {
    if (p <= lg.periods) return `${lg.periodName}${p}`;
    if (g.league === 'nhl') return p === lg.periods + 1 ? 'OT' : 'SO';
    return p === lg.periods + 1 ? 'OT' : `${p - lg.periods}OT`;
  };

  const { drives, plays } = useMemo(() => readPlays(s), [s]);
  const filtered = (filter === 'scoring' ? plays.filter((p) => p.scoring) : plays).slice().reverse();
  const leaders = (s?.leaders || []).map((t: any) => ({
    team: teamFor(t.team?.id ? String(t.team.id) : null),
    cats: (t.leaders || []).slice(0, 3).map((c: any) => ({ name: c.displayName || c.name, who: c.leaders?.[0]?.athlete?.shortName || c.leaders?.[0]?.athlete?.displayName, val: c.leaders?.[0]?.displayValue })).filter((c: any) => c.who),
  })).filter((t: any) => t.team && t.cats.length);
  const driveById = new Map((drives || []).flatMap((d) => d.plays.map((p) => [p.id, d] as const)));

  return (
    <main>
      <BackLink />
      <section className="card scoreboard" aria-label="Score">
        <div className="sb-status">{status ? (live ? <span className="live">{status.shortDetail || 'Live'}</span> : status.shortDetail || status.detail) : g.status}{g.venue ? <span className="muted"> · {g.venue}</span> : null}</div>
        {nPeriods ? (
          <div className="sb-team sb-head" aria-hidden="true">
            <span /><span />
            <span className="sb-lines">{Array.from({ length: nPeriods }, (_, i) => <span key={i}>{periodLabel(i + 1)}</span>)}</span>
            <span className="sb-score">T</span>
          </div>
        ) : null}
        {(['away', 'home'] as const).map((ha) => {
          const t = ha === 'home' ? g.home : g.away;
          const sc = scoreOf(ha);
          return (
            <div className="sb-team" key={ha}>
              <Badge t={t} />
              <span className="name">{t.name}</span>
              {nPeriods ? <span className="sb-lines">{lines(ha).map((v, i) => <span key={i}>{v}</span>)}</span> : null}
              <span className="sb-score">{sc ?? '–'}</span>
            </div>
          );
        })}
      </section>

      {g.prediction ? (
        <section>
          <h2>The model’s pick</h2>
          {g.grade ? (
            <div className="card graded">
              <span>Graded:</span>
              <span>Winner <Mark r={g.grade.winner_correct === null ? 'push' : g.grade.winner_correct ? 'win' : 'loss'} /></span>
              <span>{g.league === 'nhl' ? 'Puck line' : 'Spread'} <Mark r={g.grade.spread_result} /></span>
              <span>Total <Mark r={g.grade.total_result} /></span>
            </div>
          ) : null}
          <GameCard g={g} linked={false} />
        </section>
      ) : null}

      {leaders.length ? (
        <section>
          <h2>Leaders</h2>
          <div className="leaders">
            {leaders.map((t: any) => (
              <div className="card leader-team" key={t.team.id}>
                <div className="lt-head"><Badge t={t.team} small /> {t.team.short_name}</div>
                {t.cats.map((c: any) => (
                  <div className="lt-row" key={c.name}><span className="muted">{c.name}</span><span>{c.who}</span><b>{c.val}</b></div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="h-pbp">
        <div className="row">
          <h2 id="h-pbp">Play-by-play</h2>
          {plays.length ? (
            <div className="seg" role="group" aria-label="Which plays">
              <button className={filter === 'all' ? 'on' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
              <button className={filter === 'scoring' ? 'on' : ''} aria-pressed={filter === 'scoring'} onClick={() => setFilter('scoring')}>Scoring</button>
            </div>
          ) : null}
        </div>
        {!s ? <LoadState error={summary.error} loading={summary.loading} what="play-by-play" /> : !plays.length ? (
          <Notice>{status?.state === 'pre' ? 'Play-by-play starts when the game does.' : 'No play-by-play for this game.'}</Notice>
        ) : (
          <>
            <ol className="card plays">
              {filtered.slice(0, limit).map((p, i, arr) => {
                const t = teamFor(p.team);
                const d = drives ? driveById.get(p.id) : undefined;
                const prev = i > 0 ? arr[i - 1] : undefined;
                const newDrive = d && (!prev || driveById.get(prev.id) !== d);
                return (
                  <li key={`${p.id}-${i}`} className={p.scoring ? 'scoring' : ''}>
                    {newDrive && filter === 'all' ? <div className="drive">{teamFor(d!.team)?.abbr ?? ''} drive · {d!.desc}{d!.result ? ` · ${d!.result}` : ''}</div> : null}
                    <div className="play">
                      <span className="pc">{periodLabel(p.period)} {p.clock}</span>
                      <span className="dot" style={{ background: t ? `#${t.color || '24304d'}` : 'transparent' }} aria-hidden="true" />
                      <span className="txt">{p.text}</span>
                      {p.scoring && p.away !== null ? <span className="sc">{g.away.abbr} {p.away}–{p.home} {g.home.abbr}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
            {filtered.length > limit ? <p className="more"><button className="btn3d" onClick={() => setLimit(limit + 200)}>Show earlier plays</button></p> : null}
            {live ? <p className="hint">Updating every 30 seconds.</p> : null}
          </>
        )}
      </section>
    </main>
  );
}
