import { useMemo, useState } from 'react';
import type { Board, Game, LeagueKey } from '../data';
import { Badge, Notice, one, pct, recordFor, spreadEdge, spreadLabel, modelSpreadHome, modelTotal, timeFmt, totalEdge } from '../ui';
import { upcomingGames } from './Board';

type Market = 'spread' | 'total';

export function SpreadsView({ board, league, leagueName }: { board: Board; league: LeagueKey; leagueName: string }) {
  const [market, setMarket] = useState<Market>('spread');
  const spreadWord = league === 'nhl' ? 'Puck line' : 'Spread';
  const rows = useMemo(() => {
    const edge = market === 'spread' ? spreadEdge : totalEdge;
    return upcomingGames(board)
      .map((g) => ({ g, edge: edge(g) }))
      .filter((r): r is { g: Game; edge: number } => r.edge !== null)
      .sort((a, b) => b.edge - a.edge);
  }, [board, market]);
  const noLine = upcomingGames(board).length - rows.length;
  const rec = recordFor(board.record, market, 'all', league);

  return (
    <main>
      <section aria-labelledby="h-spreads">
        <div className="row">
          <h2 id="h-spreads">Model vs the line · {leagueName}</h2>
          <div className="seg" role="group" aria-label="Market">
            <button className={market === 'spread' ? 'on' : ''} aria-pressed={market === 'spread'} onClick={() => setMarket('spread')}>{spreadWord}</button>
            <button className={market === 'total' ? 'on' : ''} aria-pressed={market === 'total'} onClick={() => setMarket('total')}>Total</button>
          </div>
        </div>
        <p className="hint lead">
          Sorted by how far the model’s number is from the sportsbook’s. A bigger gap is a stronger lean, not a sure thing.
          {' '}{market === 'spread' ? spreadWord : 'Total'} record so far: <b>{rec.wins}-{rec.losses}{rec.pushes ? `-${rec.pushes}` : ''}</b>{rec.rate === null ? '' : ` (${pct(rec.rate)})`}; break-even is about 52.4%.
        </p>
        {rows.length ? (
          <div className="card list">
            <div className="line-row head">
              <span>Game</span><span>Line</span><span>Model</span><span>Gap</span>
            </div>
            {rows.map(({ g, edge }) => <LineRow key={g.id} g={g} market={market} edge={edge} />)}
          </div>
        ) : (
          <Notice>No {leagueName} lines posted for upcoming games yet. Sportsbooks usually post them a few days out.</Notice>
        )}
        {rows.length && noLine > 0 ? <p className="hint">{noLine} more upcoming {noLine === 1 ? 'game has' : 'games have'} no line yet.</p> : null}
      </section>
    </main>
  );
}

function LineRow({ g, market, edge }: { g: Game; market: Market; edge: number }) {
  const p = g.prediction!;
  let book: string, model: string, lean: string;
  if (market === 'spread') {
    book = spreadLabel(g, p.market_spread_home!);
    model = spreadLabel(g, modelSpreadHome(g));
    const team = p.pick_spread === g.home_team ? g.home : g.away;
    const num = p.pick_spread === g.home_team ? p.market_spread_home! : -p.market_spread_home!;
    lean = p.pick_spread ? `${team.abbr} ${num > 0 ? '+' : ''}${num === 0 ? 'PK' : num}` : 'No lean';
  } else {
    book = String(p.market_total);
    model = one(modelTotal(g));
    lean = p.pick_total ? `${p.pick_total === 'over' ? 'Over' : 'Under'} ${p.market_total}` : 'No lean';
  }
  const strong = edge >= (g.league === 'nhl' ? 0.5 : g.league === 'nba' || g.league === 'ncaab' ? 4 : 3);
  return (
    <a className="line-row" href={`#/game/${g.id}`}>
      <span className="matchup">
        <span className="teams"><Badge t={g.away} small /> <span className="at">@</span> <Badge t={g.home} small /></span>
        <span className="sub">{timeFmt.format(new Date(g.start_time))} · <b className={strong ? 'lean strong' : 'lean'}>{lean}</b></span>
      </span>
      <span className="num">{book}</span>
      <span className="num">{model}</span>
      <span className={`gap ${strong ? 'strong' : ''}`}>{one(edge)}</span>
    </a>
  );
}
