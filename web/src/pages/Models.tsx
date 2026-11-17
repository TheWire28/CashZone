import { useState } from 'react';
import { loadModels, type LeagueKey } from '../data';
import { Badge, LoadState, Notice, one, pct, useLoad } from '../ui';

const TOP = 25;

export function ModelsView({ league, leagueName }: { league: LeagueKey; leagueName: string }) {
  const { data, error, loading } = useLoad(() => loadModels(league), [league]);
  const [showAll, setShowAll] = useState(false);
  if (!data) return <main><LoadState error={error} loading={loading} what="the model" /></main>;

  const { ratings, state } = data;
  const s = state?.stats;
  const cfg = state?.config;
  const unit = league === 'nhl' ? 'goals' : 'points';
  const shown = showAll ? ratings : ratings.slice(0, TOP);

  return (
    <main>
      <section aria-labelledby="h-how">
        <h2 id="h-how">How the model works</h2>
        <div className="card steps">
          <ol>
            <li><b>Pull</b> schedules, final scores and the sportsbook line every 30 minutes.</li>
            <li><b>Rate</b> every team from its results. Winning moves a rating up, more so for a big win or a win over a strong team.</li>
            <li><b>Project</b> each game: win chance from the rating gap plus home edge, and the score from each team’s points for and against.</li>
            <li><b>Lock</b> the pick when the game starts, then <b>grade</b> it against the final score.</li>
          </ol>
          {cfg ? (
            <dl className="facts">
              <div><dt>Home edge</dt><dd>{one(cfg.home_edge)} {unit}</dd></div>
              <div><dt>Season carryover</dt><dd>{pct(1 - cfg.regress)} of last year’s rating</dd></div>
              <div><dt>Reaction speed</dt><dd>{cfg.k} (higher moves faster)</dd></div>
              <div><dt>Version</dt><dd>{state?.model_version}</dd></div>
            </dl>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="h-past">
        <h2 id="h-past">Past games · {leagueName}</h2>
        {s && s.decided ? (
          <>
            <div className="stats">
              <div className="card stat"><span className="label">Winner right</span><span className="big">{pct(s.correct / s.decided)}</span><span className="sub">{s.correct} of {s.decided} games</span></div>
              <div className="card stat"><span className="label">Margin missed by</span><span className="big">{one(s.abs_margin / s.n)}</span><span className="sub">{unit} per game, on average</span></div>
              <div className="card stat"><span className="label">Total missed by</span><span className="big">{one(s.abs_total / s.n)}</span><span className="sub">{unit} per game, on average</span></div>
              <div className="card stat"><span className="label">Home teams won</span><span className="big">{pct(s.home_wins / s.n)}</span><span className="sub">of these games</span></div>
            </div>
            <p className="hint">Each game was predicted with only the games before it, starting from the second season loaded. The settings were tuned on these same games, so treat this as a little flattering; the Record page is the honest number.</p>
          </>
        ) : (
          <Notice>The scorecard fills in after the next model run.</Notice>
        )}
      </section>

      <section aria-labelledby="h-power">
        <h2 id="h-power">Power rankings · {leagueName}</h2>
        {ratings.length ? (
          <>
            <div className="card tablewrap">
              <table className="rank">
                <thead>
                  <tr>
                    <th scope="col">#</th><th scope="col">Team</th><th scope="col">Rating</th>
                    <th scope="col"><abbr title={`${unit} scored per game`}>For</abbr></th>
                    <th scope="col"><abbr title={`${unit} allowed per game`}>Against</abbr></th>
                    <th scope="col">Games</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.team_id}>
                      <td className="muted">{i + 1}</td>
                      <th scope="row"><span className="teamcell"><Badge t={r.team} small /> <span>{r.team.short_name || r.team.name}</span></span></th>
                      <td><b>{Math.round(r.rating)}</b></td>
                      <td>{one(r.off)}</td>
                      <td>{one(r.def)}</td>
                      <td className="muted">{r.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ratings.length > TOP && !showAll ? (
              <p className="more"><button className="btn3d" onClick={() => setShowAll(true)}>Show all {ratings.length} teams</button></p>
            ) : null}
            <p className="hint">1500 is average. 100 rating points is worth about {cfg ? one(100 / cfg.elo_per_point) : '—'} {unit} on a neutral field. For and Against count this season more than last.</p>
          </>
        ) : (
          <Notice>No ratings yet for {leagueName}.</Notice>
        )}
      </section>
    </main>
  );
}
