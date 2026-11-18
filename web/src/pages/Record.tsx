import type { Board, LeagueKey, RecordRow } from '../data';
import { Notice, pct, recordFor } from '../ui';
import { ResultRow } from './Board';
import { ConfidenceRecord } from './Confidence';

export function RecordView({ board, league, leagueName }: { board: Board; league: LeagueKey; leagueName: string }) {
  const markets: [RecordRow['market'], string][] = [['winner', 'Winner'], ['spread', league === 'nhl' ? 'Puck line' : 'Spread'], ['total', 'Total']];
  const windows: [RecordRow['win'], string][] = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['all', 'All time']];
  const results = board.games.filter((g) => g.status === 'final' && g.prediction && g.grade).reverse();
  const cell = (r: ReturnType<typeof recordFor>, key: string) => (
    <td key={key}>
      <b>{r.wins}-{r.losses}{r.pushes ? `-${r.pushes}` : ''}</b>
      <small>{r.rate === null ? 'no picks yet' : pct(r.rate)}</small>
    </td>
  );
  return (
    <main>
      <section aria-labelledby="h-rec">
        <h2 id="h-rec">Track record · {leagueName}</h2>
        <div className="card tablewrap">
          <table>
            <thead>
              <tr><th scope="col">Market</th>{windows.map(([, l]) => <th scope="col" key={l}>{l}</th>)}</tr>
            </thead>
            <tbody>
              {markets.map(([m, label]) => (
                <tr key={m}>
                  <th scope="row">{label}</th>
                  {windows.map(([w]) => cell(recordFor(board.record, m, w, league), w))}
                </tr>
              ))}
              <tr>
                <th scope="row">All leagues, winner</th>
                {windows.map(([w]) => cell(recordFor(board.record, 'winner', w), w))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="hint">Spread and total picks need to win about 52.4% of the time to break even at standard −110 pricing.</p>
      </section>
      <ConfidenceRecord board={board} league={league} leagueName={leagueName} />
      <section aria-labelledby="h-graded">
        <h2 id="h-graded">Recently graded · {leagueName}</h2>
        {results.length ? (
          <div className="card list">
            <div className="result head"><span>Date</span><span>Final</span><span>Pick</span><span className="marks"><i>W</i><i>S</i><i>T</i></span></div>
            {results.slice(0, 60).map((g) => <ResultRow key={g.id} g={g} />)}
          </div>
        ) : (
          <Notice>Nothing graded yet. The first results land after the next game goes final.</Notice>
        )}
      </section>
    </main>
  );
}
