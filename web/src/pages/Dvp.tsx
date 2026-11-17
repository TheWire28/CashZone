import { useMemo, useState } from 'react';
import { loadDvp, leagueInfo, type LeagueKey } from '../data';
import { Badge, LoadState, Notice, useLoad } from '../ui';

export function DvpView({ league, leagueName }: { league: LeagueKey; leagueName: string }) {
  const cfg = leagueInfo(league).dvp;
  if (!cfg) {
    return (
      <main>
        <h2>Defense vs position · {leagueName}</h2>
        <Notice title="Not available for college football.">
          College box scores don’t list player positions, and rosters for 250+ teams would be needed to fill them in. DvP covers the NFL, NHL, NBA and men’s college basketball.
        </Notice>
      </main>
    );
  }
  return <DvpTable key={league} league={league} leagueName={leagueName} positions={cfg.positions as readonly string[]} cols={cfg.cols as readonly (readonly [string, string])[]} />;
}

function DvpTable({ league, leagueName, positions, cols }: { league: LeagueKey; leagueName: string; positions: readonly string[]; cols: readonly (readonly [string, string])[] }) {
  const [pos, setPos] = useState(positions[0]);
  const [sortKey, setSortKey] = useState('fpts');
  const [desc, setDesc] = useState(true);
  const [q, setQ] = useState('');
  const { data, error, loading } = useLoad(() => loadDvp(league, pos), [league, pos]);

  const rows = useMemo(() => {
    if (!data) return [];
    const ranked = [...data].sort((a, b) => (b.per_game.fpts ?? 0) - (a.per_game.fpts ?? 0)).map((r, i) => ({ ...r, rank: i + 1 }));
    const sorted = ranked.sort((a, b) => ((a.per_game[sortKey] ?? 0) - (b.per_game[sortKey] ?? 0)) * (desc ? -1 : 1));
    const needle = q.trim().toLowerCase();
    return needle ? sorted.filter((r) => `${r.team.abbr} ${r.team.name}`.toLowerCase().includes(needle)) : sorted;
  }, [data, sortKey, desc, q]);
  const n = data?.length ?? 0;
  const max = Math.max(1, ...((data || []).map((r) => r.per_game[sortKey] ?? 0)));

  const sortBy = (k: string) => {
    if (k === sortKey) setDesc(!desc);
    else { setSortKey(k); setDesc(true); }
  };

  return (
    <main>
      <div className="row">
        <h2>Defense vs position · {leagueName}</h2>
      </div>
      <div className="chips" role="group" aria-label="Opposing position">
        {positions.map((p) => (
          <button key={p} className={p === pos ? 'on' : ''} aria-pressed={p === pos} onClick={() => setPos(p)}>vs {p}</button>
        ))}
      </div>
      <p className="hint lead">
        What each defense allows per game to opposing {pos === 'W' ? 'wingers' : pos === 'D' ? 'defensemen' : `${pos}s`}, this season.
        Rank 1 gives up the most fantasy points: the softest matchup.
      </p>
      {n > 40 ? (
        <input className="search" type="search" placeholder="Find a team" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a team" />
      ) : null}
      {!data ? <LoadState error={error} loading={loading} what="defense vs position" /> : n === 0 ? (
        <Notice title="Box scores are still loading.">The engine reads this season’s box scores a few hundred games per run; this fills in over the next couple of runs.</Notice>
      ) : (
        <div className="card tablewrap">
          <table className="dvp">
            <thead>
              <tr>
                <th scope="col">Rk</th>
                <th scope="col">Defense</th>
                {cols.map(([k, label]) => (
                  <th scope="col" key={k} aria-sort={k === sortKey ? (desc ? 'descending' : 'ascending') : 'none'}>
                    <button className="sort" onClick={() => sortBy(k)}>{label}{k === sortKey ? (desc ? ' ↓' : ' ↑') : ''}</button>
                  </th>
                ))}
                <th scope="col">GP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.def_team}>
                  <td className={r.rank <= 5 ? 'soft' : r.rank > n - 5 ? 'tough' : 'muted'}>{r.rank}</td>
                  <th scope="row"><span className="teamcell"><Badge t={r.team} small /> <span>{r.team.short_name || r.team.name}</span></span></th>
                  {cols.map(([k]) => {
                    const v = r.per_game[k] ?? 0;
                    return (
                      <td key={k} className={k === sortKey ? 'sorted' : ''} style={k === sortKey ? { ['--heat' as string]: String(v / max) } : undefined}>
                        {v.toFixed(k === 'fpts' || v % 1 ? 1 : 0)}
                      </td>
                    );
                  })}
                  <td className="muted">{r.games}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">FPTS uses common daily-fantasy scoring ({league === 'nfl' ? 'PPR' : league === 'nhl' ? 'goals 8.5, assists 5, shots 1.5, blocks 1.3' : 'points, 1.25 per rebound, 1.5 per assist, 2 per steal or block'}). Ranks 1–5 are marked as the softest defenses, the last five as the toughest.</p>
    </main>
  );
}
