import type { Board, Game } from '../data';
import { Badge, Notice, dayFmt, timeFmt } from '../ui';

// Game picker for play-by-play: live games first, then recent finals, then what's next.
export function PbpView({ board, leagueName }: { board: Board; leagueName: string }) {
  const now = Date.now();
  const live = board.games.filter((g) => g.status === 'in_progress');
  const recent = board.games.filter((g) => g.status === 'final' && now - new Date(g.start_time).getTime() < 3 * 864e5).reverse();
  const next = board.games.filter((g) => g.status === 'scheduled' && new Date(g.start_time).getTime() > now - 6 * 3600e3).slice(0, 20);

  const group = (title: string, games: Game[], empty?: string) => (
    <section>
      <h2>{title}</h2>
      {games.length ? <div className="card list">{games.slice(0, 40).map((g) => <PbpRow key={g.id} g={g} />)}</div> : empty ? <Notice>{empty}</Notice> : null}
    </section>
  );

  return (
    <main>
      <p className="hint lead">Pick a game for the full play-by-play, box score leaders and the model’s pick. Live games refresh every 30 seconds.</p>
      {group(`Live now · ${leagueName}`, live, `No ${leagueName} games in progress right now.`)}
      {recent.length ? group('Recent finals', recent) : null}
      {next.length ? group('Coming up', next) : null}
    </main>
  );
}

function PbpRow({ g }: { g: Game }) {
  const done = g.status === 'final' || g.status === 'in_progress';
  return (
    <a className="pbp-row" href={`#/game/${g.id}`}>
      <span className="when">{g.status === 'in_progress' ? <span className="live">Live</span> : g.status === 'final' ? dayFmt.format(new Date(g.start_time)) : timeFmt.format(new Date(g.start_time))}</span>
      <span className="side-a"><Badge t={g.away} small /> {done ? <b>{g.away_score}</b> : null}</span>
      <span className="at">@</span>
      <span className="side-b"><Badge t={g.home} small /> {done ? <b>{g.home_score}</b> : null}</span>
      <span className="go" aria-hidden="true">›</span>
    </a>
  );
}
