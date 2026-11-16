import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadBoard, type Board, type Game, type RecordRow, type Team } from './data';

type Tab = 'board' | 'record';
type Sort = 'time' | 'confidence';

const timeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const odds = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const line = (n: number) => (n === 0 ? 'PK' : n > 0 ? `+${n}` : `${n}`);
const pct = (p: number) => `${Math.round(p * 100)}%`;
const one = (n: number) => n.toFixed(1);

export default function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('board');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await loadBoard());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Reopening the app from the home screen should show fresh picks.
    const onShow = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [refresh]);

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="eyebrow">Prediction terminal</p>
          <h1>The Cash<span>Zone</span></h1>
        </div>
        <button className="btn3d" onClick={refresh} disabled={loading} aria-label="Refresh picks">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {error === 'not-configured' ? <Setup /> : null}
      {error && error !== 'not-configured' ? (
        <div className="card notice" role="alert">
          <strong>Couldn’t load picks.</strong>
          <span>{board ? 'Showing the last board that loaded. ' : ''}{error}</span>
        </div>
      ) : null}
      {!board && loading ? <div className="card notice">Loading the board…</div> : null}

      {board && tab === 'board' ? <BoardView board={board} /> : null}
      {board && tab === 'record' ? <RecordView board={board} /> : null}

      <footer className="fine">
        {board?.last_run ? <p>Model last ran {dayFmt.format(new Date(board.last_run))} at {clockFmt.format(new Date(board.last_run))}.</p> : null}
        <p>Informational analysis only, not betting advice. Picks lock at kickoff and are graded on the final score.</p>
      </footer>

      <nav className="tabs" aria-label="Sections">
        {(['board', 'record'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {t === 'board' ? 'Board' : 'Record'}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Setup() {
  return (
    <div className="card notice">
      <strong>Almost there.</strong>
      <span>The app is running but isn’t connected to its database yet. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in Netlify’s environment variables, then redeploy.</span>
    </div>
  );
}

function recordFor(rows: RecordRow[], market: RecordRow['market'], win: RecordRow['win']) {
  const hit = rows.filter((r) => r.market === market && r.win === win);
  const wins = hit.reduce((s, r) => s + r.wins, 0), losses = hit.reduce((s, r) => s + r.losses, 0), pushes = hit.reduce((s, r) => s + r.pushes, 0);
  return { wins, losses, pushes, rate: wins + losses ? wins / (wins + losses) : null };
}

function BoardView({ board }: { board: Board }) {
  const [sort, setSort] = useState<Sort>('time');
  const upcoming = useMemo(() => {
    const list = board.games.filter((g) => (g.status === 'scheduled' || g.status === 'in_progress') && g.prediction);
    return sort === 'time' ? list : [...list].sort((a, b) => b.prediction!.confidence - a.prediction!.confidence);
  }, [board, sort]);
  const results = useMemo(() => board.games.filter((g) => g.status === 'final' && g.prediction && g.grade).reverse(), [board]);
  const windows: RecordRow['win'][] = ['7d', '30d', '90d', 'all'];
  const anyGraded = recordFor(board.record, 'winner', 'all').wins + recordFor(board.record, 'winner', 'all').losses > 0;

  return (
    <main>
      <section aria-labelledby="h-check">
        <h2 id="h-check">How the model is doing</h2>
        {anyGraded ? (
          <div className="stats">
            {windows.map((w) => {
              const r = recordFor(board.record, 'winner', w);
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
          <div className="card notice">
            <strong>The record starts clean.</strong>
            <span>Every pick below is stored before kickoff. Results show up here as soon as the first game goes final.</span>
          </div>
        )}
      </section>

      <section aria-labelledby="h-next">
        <div className="row">
          <h2 id="h-next">Next up · NFL</h2>
          <div className="seg" role="group" aria-label="Sort games">
            <button className={sort === 'time' ? 'on' : ''} aria-pressed={sort === 'time'} onClick={() => setSort('time')}>Time</button>
            <button className={sort === 'confidence' ? 'on' : ''} aria-pressed={sort === 'confidence'} onClick={() => setSort('confidence')}>Confidence</button>
          </div>
        </div>
        {upcoming.length ? (
          <div className="grid">{upcoming.map((g) => <GameCard key={g.id} g={g} />)}</div>
        ) : (
          <div className="card notice">No upcoming games with picks right now. The model checks for new games every 30 minutes.</div>
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

function Badge({ t }: { t: Team }) {
  return <span className="badge" style={{ background: `#${t.color || '24304d'}` }}>{t.abbr}</span>;
}

function GameCard({ g }: { g: Game }) {
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
        <span>{g.status === 'in_progress' ? 'In progress' : timeFmt.format(new Date(g.start_time))}{g.neutral_site ? ' · neutral site' : ''}</span>
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
          <dt>Spread</dt>
          <dd>{spreadTeam && spreadNum !== null ? <><b>{spreadTeam.abbr} {line(spreadNum)}</b> · model {margin < 0.05 ? 'even' : `${leader.abbr} by ${one(margin)}`}</> : <span className="muted">{p.market_spread_home === null ? 'No line yet' : `No edge at ${g.home.abbr} ${line(p.market_spread_home)}`} · model {leader.abbr} by {one(margin)}</span>}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{p.pick_total && p.market_total !== null ? <><b>{p.pick_total === 'over' ? 'Over' : 'Under'} {p.market_total}</b> · model {one(p.proj_home + p.proj_away)}</> : <span className="muted">{p.market_total === null ? 'No line yet' : `No edge at ${p.market_total}`} · model {one(p.proj_home + p.proj_away)}</span>}</dd>
        </div>
      </dl>
      <p className="hint">Only worth a bet on {pick.abbr} at a better price than {odds(p.fair_odds)}.</p>
    </article>
  );
}

function Mark({ r }: { r: 'win' | 'loss' | 'push' | null }) {
  if (!r) return <span className="mark none">—</span>;
  return <span className={`mark ${r}`}>{r === 'win' ? 'W' : r === 'loss' ? 'L' : 'P'}</span>;
}

function ResultRow({ g }: { g: Game }) {
  const p = g.prediction!, gr = g.grade!;
  const pick = p.pick_winner === g.home_team ? g.home : g.away;
  return (
    <div className="result">
      <span className="when">{dayFmt.format(new Date(g.start_time))}</span>
      <span className="score">{g.away.abbr} {g.away_score} @ {g.home.abbr} {g.home_score}</span>
      <span className="picked">Pick {pick.abbr}</span>
      <span className="marks" aria-label="Winner, spread, total">
        <Mark r={gr.winner_correct === null ? 'push' : gr.winner_correct ? 'win' : 'loss'} />
        <Mark r={gr.spread_result} />
        <Mark r={gr.total_result} />
      </span>
    </div>
  );
}

function RecordView({ board }: { board: Board }) {
  const markets: [RecordRow['market'], string][] = [['winner', 'Winner'], ['spread', 'Spread'], ['total', 'Total']];
  const windows: [RecordRow['win'], string][] = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['all', 'All time']];
  const results = board.games.filter((g) => g.status === 'final' && g.prediction && g.grade).reverse();
  return (
    <main>
      <section aria-labelledby="h-rec">
        <h2 id="h-rec">Track record</h2>
        <div className="card tablewrap">
          <table>
            <thead>
              <tr><th scope="col">Market</th>{windows.map(([, l]) => <th scope="col" key={l}>{l}</th>)}</tr>
            </thead>
            <tbody>
              {markets.map(([m, label]) => (
                <tr key={m}>
                  <th scope="row">{label}</th>
                  {windows.map(([w]) => {
                    const r = recordFor(board.record, m, w);
                    return (
                      <td key={w}>
                        <b>{r.wins}-{r.losses}{r.pushes ? `-${r.pushes}` : ''}</b>
                        <small>{r.rate === null ? 'no picks yet' : pct(r.rate)}</small>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Spread and total picks need to win about 52.4% of the time to break even at standard −110 pricing.</p>
      </section>
      <section aria-labelledby="h-graded">
        <h2 id="h-graded">Graded picks, last 10 days</h2>
        {results.length ? (
          <div className="card list">
            <div className="result head"><span>Date</span><span>Final</span><span>Pick</span><span className="marks"><i>W</i><i>S</i><i>T</i></span></div>
            {results.map((g) => <ResultRow key={g.id} g={g} />)}
          </div>
        ) : (
          <div className="card notice">Nothing graded yet. The first results land after the next game goes final.</div>
        )}
      </section>
    </main>
  );
}
