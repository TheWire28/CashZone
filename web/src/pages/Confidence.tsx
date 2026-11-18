import { useState } from 'react';
import type { Board, ConfidenceRow, LeagueKey } from '../data';
import { pct } from '../ui';

type Market = ConfidenceRow['market'];
type Scope = 'league' | 'all';
const BUCKETS = [50, 60, 70, 80, 90];
const MIN = 10;              // fewer graded picks than this: too few to read anything into
const BREAK_EVEN = 0.524;    // spread and total picks at standard -110 pricing

type Line = { bucket: number; wins: number; losses: number; pushes: number; n: number; rate: number | null; expected: number | null; past: number | null; pastN: number };

// How far a hit rate is from what was expected, measured in "normal luck" units for that
// many picks. Beyond 2, the gap is bigger than chance usually produces.
function zScore(rate: number, expected: number, n: number) {
  return (rate - expected) / Math.sqrt((expected * (1 - expected)) / n);
}

function lines(board: Board, market: Market, league: LeagueKey | null): Line[] {
  const rows = board.confidence.filter((r) => r.market === market && (!league || r.league === league));
  const hist = board.history.filter((h) => !league || h.league === league);
  return BUCKETS.map((bucket) => {
    const mine = rows.filter((r) => r.bucket === bucket);
    const wins = mine.reduce((s, r) => s + r.wins, 0);
    const losses = mine.reduce((s, r) => s + r.losses, 0);
    const pushes = mine.reduce((s, r) => s + r.pushes, 0);
    const n = wins + losses;
    const confSum = mine.reduce((s, r) => s + r.avg_conf * (r.wins + r.losses + r.pushes), 0);
    const confN = wins + losses + pushes;
    let past: number | null = null, pastN = 0;
    if (market === 'winner') {
      let c = 0;
      for (const h of hist) {
        const b = h.stats?.buckets?.[String(bucket)];
        if (b) { pastN += b[0]; c += b[1]; }
      }
      past = pastN ? c / pastN : null;
    }
    return {
      bucket, wins, losses, pushes, n,
      rate: n ? wins / n : null,
      expected: market === 'winner' ? (confN ? confSum / confN : null) : BREAK_EVEN,
      past, pastN,
    };
  });
}

function read(l: Line, market: Market): { text: string; tone: 'hot' | 'cold' | 'even' | 'few' } {
  if (l.n < MIN || l.rate === null || l.expected === null) return { text: l.n ? `Too few picks (${l.n} of ${MIN})` : 'No picks yet', tone: 'few' };
  const z = zScore(l.rate, l.expected, l.n);
  if (market === 'winner') {
    if (z >= 2) return { text: 'Hitting more than expected', tone: 'hot' };
    if (z <= -2) return { text: 'Missing more than expected', tone: 'cold' };
    return { text: 'In line with expected', tone: 'even' };
  }
  if (z >= 2) return { text: 'Clearly above break-even', tone: 'hot' };
  if (z <= -2) return { text: 'Clearly below break-even', tone: 'cold' };
  return { text: l.rate >= BREAK_EVEN ? 'Above break-even, not yet proven' : 'Below break-even, not yet proven', tone: 'even' };
}

export function ConfidenceRecord({ board, league, leagueName }: { board: Board; league: LeagueKey; leagueName: string }) {
  const [market, setMarket] = useState<Market>('winner');
  const [scope, setScope] = useState<Scope>('league');
  const data = lines(board, market, scope === 'league' ? league : null);
  const total = data.reduce((s, l) => s + l.n, 0);
  const readable = data.filter((l) => l.n >= MIN && l.rate !== null && l.expected !== null);
  const gap = (l: Line) => (l.rate ?? 0) - (l.expected ?? 0);
  const best = readable.length ? readable.reduce((a, b) => (gap(b) > gap(a) ? b : a)) : null;
  const worst = readable.length ? readable.reduce((a, b) => (gap(b) < gap(a) ? b : a)) : null;
  const label = (b: number) => (b === 90 ? '90%+' : `${b}–${b + 9}%`);
  const spreadWord = scope === 'league' && league === 'nhl' ? 'Puck line' : 'Spread';
  const where = scope === 'league' ? leagueName : 'all leagues';

  return (
    <section aria-labelledby="h-byconf">
      <h2 id="h-byconf">By confidence</h2>
      <div className="row wrap">
        <div className="seg" role="group" aria-label="Market">
          {(['winner', 'spread', 'total'] as Market[]).map((m) => (
            <button key={m} className={market === m ? 'on' : ''} aria-pressed={market === m} onClick={() => setMarket(m)}>
              {m === 'winner' ? 'Winner' : m === 'spread' ? spreadWord : 'Total'}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Which leagues">
          <button className={scope === 'league' ? 'on' : ''} aria-pressed={scope === 'league'} onClick={() => setScope('league')}>{leagueName}</button>
          <button className={scope === 'all' ? 'on' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All leagues</button>
        </div>
      </div>

      <p className="hint lead">
        {market === 'winner'
          ? 'Confidence is the win chance the model gave the team it picked. A 70% pick should win about 7 times in 10.'
          : `${market === 'spread' ? spreadWord : 'Total'} picks grouped by the confidence of that game’s winner pick. Break-even is 52.4% at standard −110 pricing.`}
        {' '}{total} graded {market} {total === 1 ? 'pick' : 'picks'} in {where}.
      </p>

      {best && worst && best !== worst && (gap(best) > 0 || gap(worst) < 0) ? (
        <div className="card conf-summary">
          {gap(best) > 0 ? <p><span className="tone hot">Best</span> {label(best.bucket)} picks: {pct(best.rate!)} hit vs {pct(best.expected!)} {market === 'winner' ? 'expected' : 'break-even'} ({best.wins}-{best.losses}).</p> : null}
          {gap(worst) < 0 ? <p><span className="tone cold">Weakest</span> {label(worst.bucket)} picks: {pct(worst.rate!)} hit vs {pct(worst.expected!)} {market === 'winner' ? 'expected' : 'break-even'} ({worst.wins}-{worst.losses}).</p> : null}
        </div>
      ) : null}

      <div className="card tablewrap">
        <table className="conf">
          <thead>
            <tr>
              <th scope="col">Confidence</th>
              <th scope="col">Hit–Miss</th>
              <th scope="col">Hit rate</th>
              <th scope="col">{market === 'winner' ? 'Expected' : 'Break-even'}</th>
              <th scope="col">Gap</th>
              {market === 'winner' ? <th scope="col"><abbr title="How often picks at this confidence won on past games, each predicted before the result was known">Past games</abbr></th> : null}
              <th scope="col">Read</th>
            </tr>
          </thead>
          <tbody>
            {data.map((l) => {
              const r = read(l, market);
              const g = l.rate !== null && l.expected !== null ? l.rate - l.expected : null;
              return (
                <tr key={l.bucket}>
                  <th scope="row">{label(l.bucket)}</th>
                  <td><b>{l.wins}-{l.losses}{l.pushes ? `-${l.pushes}` : ''}</b></td>
                  <td>{l.rate === null ? '—' : pct(l.rate)}</td>
                  <td className="muted">{l.expected === null ? '—' : pct(l.expected)}</td>
                  <td className={g === null || l.n < MIN ? 'muted' : g > 0 ? 'up' : g < 0 ? 'down' : ''}>
                    {g === null ? '—' : `${g > 0 ? '+' : g < 0 ? '−' : ''}${Math.abs(Math.round(g * 100))} pts`}
                  </td>
                  {market === 'winner' ? <td className="muted">{l.past === null ? '—' : <>{pct(l.past)} <small>of {l.pastN.toLocaleString()}</small></>}</td> : null}
                  <td><span className={`tone ${r.tone}`}>{r.text}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        A level needs {MIN}+ graded picks before it gets a read. “More” or “less than expected” means the gap is bigger than luck usually explains for that many picks; anything smaller is called in line.
      </p>
    </section>
  );
}
