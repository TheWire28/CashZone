import { useMemo, useState } from 'react';
import type { Board, Game, LeagueKey, Team } from '../data';
import { Badge, Mark, Notice, dayFmt, line, odds, one, pct, recordFor, timeFmt } from '../ui';

type Sort = 'time' | 'confidence';
const PAGE = 30;

// A game still marked "scheduled" long after its start time was postponed; leave it off.
export const upcomingGames = (board: Board) => {
  const cutoff = new Date(Date.now() - 6 * 3600e3).toISOString();
  return board.games.filter((g) => (g.status === 'scheduled' || g.status === 'in_progress') && g.prediction && g.start_time > cutoff);
};

export function BoardView({ board, league, leagueName }: { board: Board; league: LeagueKey; leagueName: string }) {
  const [sort, setSort] = useState<Sort>('time');
  const [showAll, setShowAll] = useState(false);
  const upcoming = useMemo(() => {
    const list = upcomingGames(board);
    return sort === 'time' ? list : [...list].sort((a, b) => b.prediction!.confidence - a.prediction!.confidence);
  }, [board, sort]);
  const results = useMemo(() => board.games.filter((g) => g.status === 'final' && g.prediction && g.grade).reverse(), [board]);
  const windows = ['7d', '30d', '90d', 'all'] as const;
  const all = recordFor(board.record, 'winner', 'all', league);
  const shown = showAll ? upcoming : upcoming.slice(0, PAGE);

  return (
    <main>
      <section aria-labelledby="h-check">
        <h2 id="h-check">How the model is doing · {leagueName}</h2>
        {all.wins + all.losses > 0 ? (
          <div className="stats">
            {windows.map((w) => {
              const r = recordFor(board.record, 'winner', w, league);
              return (
                <div className="card stat" key={w}>
                  <span className="label">{w === 'all' ? 'All time' : `Last ${w.replace('d', ' days')}`}</span>
                  <span className="big">{r.rate === null ? '—' : pct(r.rate)}</span>
                  <span className="sub">{r.wins}-{r.losses} winners</span>
                </div>
              );
            })}
          </div>
        ) : (
          <Notice title="The record starts clean.">
            Every {leagueName} pick below is stored before the game starts. Results show up here as soon as the first one goes final.
          </Notice>
        )}
      </section>

      <section aria-labelledby="h-next">
        <div className="row">
          <h2 id="h-next">Next up · {leagueName}</h2>
          <div className="seg" role="group" aria-label="Sort games">
            <button className={sort === 'time' ? 'on' : ''} aria-pressed={sort === 'time'} onClick={() => setSort('time')}>Time</button>
            <button className={sort === 'confidence' ? 'on' : ''} aria-pressed={sort === 'confidence'} onClick={() => setSort('confidence')}>Confidence</button>
          </div>
        </div>
        {upcoming.length ? (
          <>
            <div className="grid">{shown.map((g) => <GameCard key={g.id} g={g} />)}</div>
            {upcoming.length > PAGE && !showAll ? (
              <p className="more"><button className="btn3d" onClick={() => setShowAll(true)}>Show all {upcoming.length} games</button></p>
            ) : null}
          </>
        ) : (
          <Notice>No upcoming {leagueName} games with picks right now. The model checks for new games every 30 minutes.</Notice>
        )}
      </section>

      {results.length ? (
        <section aria-labelledby="h-results">
          <h2 id="h-results">Latest results</h2>
          <div className="card list">{results.slice(0, 16).map((g) => <ResultRow key={g.id} g={g} />)}</div>
        </section>
      ) : null}
    </main>
  );
}

export function GameCard({ g, linked = true }: { g: Game; linked?: boolean }) {
  const p = g.prediction!;
  const homePick = p.pick_winner === g.home_team;
  const pick = homePick ? g.home : g.away;
  const margin = Math.abs(p.proj_home - p.proj_away);
  const leader = p.proj_home >= p.proj_away ? g.home : g.away;
  const spreadTeam = p.pick_spread ? (p.pick_spread === g.home_team ? g.home : g.away) : null;
  const spreadNum = p.market_spread_home === null ? null : p.pick_spread === g.home_team ? p.market_spread_home : -p.market_spread_home;
  const side = (t: Team, prob: number, proj: number, picked: boolean) => (
    <div className={`side ${picked ? 'picked' : ''}`}>
      <Badge t={t} />
      <span className="name">{t.short_name || t.name}</span>
      <span className="prob">{pct(prob)}</span>
      <span className="proj">{one(proj)}</span>
    </div>
  );

  return (
    <article className="card game">
      <div className="meta">
        <span>{g.status === 'in_progress' ? <span className="live">Live</span> : timeFmt.format(new Date(g.start_time))}{g.neutral_site ? ' · neutral site' : ''}</span>
        <span className={`conf ${p.confidence >= 0.7 ? 'hi' : ''}`}>{pct(p.confidence)} confidence</span>
      </div>
      <div className="cols"><span>Win chance</span><span>Proj.</span></div>
      {side(g.away, 1 - p.home_win_prob, p.proj_away, !homePick)}
      {side(g.home, p.home_win_prob, p.proj_home, homePick)}
      <div className="bar" aria-hidden="true"><i style={{ width: pct(1 - p.home_win_prob) }} /></div>

      <dl className="picks">
        <div>
          <dt>Winner</dt>
          <dd><b>{pick.abbr}</b> · fair price {odds(p.fair_odds)}</dd>
        </div>
        <div>
          <dt>{g.league === 'nhl' ? 'Puck line' : 'Spread'}</dt>
          <dd>{spreadTeam && spreadNum !== null ? <><b>{spreadTeam.abbr} {line(spreadNum)}</b> · model {margin < 0.05 ? 'even' : `${leader.abbr} by ${one(margin)}`}</> : <span className="muted">{p.market_spread_home === null ? 'No line yet' : `No edge at ${g.home.abbr} ${line(p.market_spread_home)}`} · model {leader.abbr} by {one(margin)}</span>}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{p.pick_total && p.market_total !== null ? <><b>{p.pick_total === 'over' ? 'Over' : 'Under'} {p.market_total}</b> · model {one(p.proj_home + p.proj_away)}</> : <span className="muted">{p.market_total === null ? 'No line yet' : `No edge at ${p.market_total}`} · model {one(p.proj_home + p.proj_away)}</span>}</dd>
        </div>
      </dl>
      <div className="foot">
        <p className="hint">Only worth a bet on {pick.abbr} at a better price than {odds(p.fair_odds)}.</p>
        {linked ? <a className="link" href={`#/game/${g.id}`}>Full breakdown →</a> : null}
      </div>
    </article>
  );
}

export function ResultRow({ g }: { g: Game }) {
  const p = g.prediction!, gr = g.grade!;
  const pick = p.pick_winner === g.home_team ? g.home : g.away;
  return (
    <a className="result" href={`#/game/${g.id}`}>
      <span className="when">{dayFmt.format(new Date(g.start_time))}</span>
      <span className="score">{g.away.abbr} {g.away_score} @ {g.home.abbr} {g.home_score}</span>
      <span className="picked">Pick {pick.abbr}</span>
      <span className="marks" aria-label="Winner, spread, total">
        <Mark r={gr.winner_correct === null ? 'push' : gr.winner_correct ? 'win' : 'loss'} />
        <Mark r={gr.spread_result} />
        <Mark r={gr.total_result} />
      </span>
    </a>
  );
}
