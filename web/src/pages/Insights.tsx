import { loadInsights, leagueInfo, LEAGUES, type CalibrationRow, type Game, type LeagueKey, type Stats } from '../data';
import { Badge, LoadState, Notice, one, pct, spreadEdge, timeFmt, totalEdge, useLoad } from '../ui';

type Bucket = { key: number; games: number; said: number; won: number };

function historyBuckets(s: Stats | null | undefined): Bucket[] {
  if (!s) return [];
  return Object.entries(s.buckets)
    .map(([k, [games, correct, sumConf]]) => ({ key: Number(k), games, said: sumConf / games, won: correct / games }))
    .filter((b) => b.games >= 5)
    .sort((a, b) => a.key - b.key);
}
function liveBuckets(rows: CalibrationRow[]): Bucket[] {
  return rows
    .map((r) => ({ key: r.bucket, games: Number(r.games), said: Number(r.avg_conf), won: Number(r.correct) / Number(r.games) }))
    .sort((a, b) => a.key - b.key);
}

// One bar per confidence level: the bar is how often picks there actually won, the tick
// is what the model said on average. Numbers sit beside each bar, so nothing relies on color.
function CalibrationChart({ buckets, label }: { buckets: Bucket[]; label: string }) {
  const lo = 0.4, hi = 1;
  const x = (v: number) => `${((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 100}%`;
  return (
    <figure className="calib" aria-label={label}>
      <div className="calib-legend" aria-hidden="true">
        <span><i className="sw bar" /> How often it won</span>
        <span><i className="sw tick" /> What the model said</span>
      </div>
      {buckets.map((b) => (
        <div className="calib-row" key={b.key} title={`${b.key}–${b.key + 9}% picks: model said ${pct(b.said)}, won ${pct(b.won)} of ${b.games}`}>
          <span className="calib-k">{b.key === 90 ? '90%+' : `${b.key}s`}</span>
          <span className="calib-track">
            <i className="calib-bar" style={{ width: x(b.won) }} />
            <i className="calib-tick" style={{ left: x(b.said) }} />
          </span>
          <span className="calib-v"><b>{pct(b.won)}</b> won · said {pct(b.said)} · {b.games}</span>
        </div>
      ))}
      <div className="calib-axis" aria-hidden="true"><span>40%</span><span>70%</span><span>100%</span></div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th>Confidence</th><th>Games</th><th>Model said</th><th>Won</th></tr></thead>
        <tbody>{buckets.map((b) => <tr key={b.key}><td>{b.key}%</td><td>{b.games}</td><td>{pct(b.said)}</td><td>{pct(b.won)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

function PickLine({ g, right }: { g: Game; right: string }) {
  return (
    <a className="pick-line" href={`#/game/${g.id}`}>
      <span className="lg">{leagueInfo(g.league).name}</span>
      <span className="teams"><Badge t={g.away} small /> <span className="at">@</span> <Badge t={g.home} small /></span>
      <span className="sub">{timeFmt.format(new Date(g.start_time))}</span>
      <span className="right">{right}</span>
    </a>
  );
}

export function InsightsView({ league, leagueName }: { league: LeagueKey; leagueName: string }) {
  const { data, error, loading } = useLoad(() => loadInsights(league), [league]);
  if (!data) return <main><LoadState error={error} loading={loading} what="insights" /></main>;
  const { state, calibration, upcoming } = data;
  const hist = historyBuckets(state?.stats);
  const live = liveBuckets(calibration);
  const unit = league === 'nhl' ? 'goals' : 'points';

  const confident = [...upcoming].sort((a, b) => b.prediction!.confidence - a.prediction!.confidence).slice(0, 8);
  const edgesBy = LEAGUES.map((lg) => {
    const games = upcoming.filter((g) => g.league === lg.key);
    const top = games
      .flatMap((g) => [
        { g, kind: 'spread' as const, edge: spreadEdge(g) },
        { g, kind: 'total' as const, edge: totalEdge(g) },
      ])
      .filter((e): e is { g: Game; kind: 'spread' | 'total'; edge: number } => e.edge !== null && e.edge > 0)
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 3);
    return { lg, top };
  }).filter((x) => x.top.length);

  const leanText = (g: Game, kind: 'spread' | 'total', edge: number) => {
    const p = g.prediction!;
    if (kind === 'total') return `${p.pick_total === 'over' ? 'Over' : 'Under'} ${p.market_total} · gap ${one(edge)}`;
    const team = p.pick_spread === g.home_team ? g.home : g.away;
    const num = p.pick_spread === g.home_team ? p.market_spread_home! : -p.market_spread_home!;
    return `${team.abbr} ${num > 0 ? '+' : ''}${num === 0 ? 'PK' : num} · gap ${one(edge)}`;
  };

  return (
    <main>
      <section aria-labelledby="h-calib">
        <h2 id="h-calib">Can you trust the percentages? · {leagueName}</h2>
        <p className="hint lead">When the model says 70%, a well-calibrated model wins about 70% of those games. Bars near their tick mean the percentages are honest.</p>
        {live.length ? (
          <div className="card pad"><h3>Live picks</h3><CalibrationChart buckets={live} label={`${leagueName} live picks: model confidence vs how often it won`} /></div>
        ) : null}
        {hist.length ? (
          <div className="card pad">
            <h3>Past games</h3>
            <CalibrationChart buckets={hist} label={`${leagueName} past games: model confidence vs how often it won`} />
            <p className="hint">Predicted one game at a time before each result was known; settings were tuned on these games.</p>
          </div>
        ) : !live.length ? <Notice>Calibration appears after the next model run.</Notice> : null}
      </section>

      {state?.stats?.n ? (
        <section aria-labelledby="h-trend">
          <h2 id="h-trend">League trends · {leagueName}</h2>
          <div className="stats three">
            <div className="card stat"><span className="label">Home teams win</span><span className="big">{pct(state.stats.home_wins / state.stats.n)}</span><span className="sub">of games</span></div>
            <div className="card stat"><span className="label">Scoring</span><span className="big">{one(state.lg_pts / state.lg_n)}</span><span className="sub">{unit} per team per game</span></div>
            <div className="card stat"><span className="label">Typical miss</span><span className="big">{one(state.stats.abs_margin / state.stats.n)}</span><span className="sub">{unit} on the margin</span></div>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="h-conf">
        <h2 id="h-conf">Most confident picks · next 48 hours, all leagues</h2>
        {confident.length ? (
          <div className="card list">
            {confident.map((g) => {
              const p = g.prediction!;
              const pick = p.pick_winner === g.home_team ? g.home : g.away;
              return <PickLine key={g.id} g={g} right={`${pick.abbr} ${pct(p.confidence)}`} />;
            })}
          </div>
        ) : <Notice>No picks in the next 48 hours.</Notice>}
        <p className="hint">High confidence usually comes with a steep price; check the fair price on the game before betting.</p>
      </section>

      <section aria-labelledby="h-edges">
        <h2 id="h-edges">Biggest gaps with the sportsbook · by league</h2>
        {edgesBy.length ? edgesBy.map(({ lg, top }) => (
          <div className="card list edge-group" key={lg.key}>
            <h3>{lg.name}</h3>
            {top.map(({ g, kind, edge }) => <PickLine key={`${g.id}-${kind}`} g={g} right={leanText(g, kind, edge)} />)}
          </div>
        )) : <Notice>No lines posted for games in the next 48 hours.</Notice>}
        <p className="hint">Gaps are in each league’s own units, so compare within a league, not across.</p>
      </section>
    </main>
  );
}
