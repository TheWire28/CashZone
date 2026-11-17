import { useEffect, useState } from 'react';
import { LEAGUES, leagueInfo, loadBoard, type LeagueKey } from './data';
import { LoadState, Notice, clockFmt, dayFmt, useLoad } from './ui';
import { BoardView } from './pages/Board';
import { RecordView } from './pages/Record';
import { SpreadsView } from './pages/Spreads';
import { ModelsView } from './pages/Models';
import { InsightsView } from './pages/Insights';
import { DvpView } from './pages/Dvp';
import { PbpView } from './pages/Pbp';
import { GameView } from './pages/Game';

const PAGES = [
  { key: 'board', label: 'Board', icon: 'M4 5h16v4H4zM4 11h16v4H4zM4 17h10v3H4z' },
  { key: 'spreads', label: 'Spreads', icon: 'M4 18 9 12l4 3 7-9M15 6h5v5' },
  { key: 'record', label: 'Record', icon: 'M5 20V10M12 20V4M19 20v-7' },
  { key: 'models', label: 'Models', icon: 'M12 3 20 7.5v9L12 21 4 16.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5' },
  { key: 'insights', label: 'Insights', icon: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z' },
  { key: 'dvp', label: 'DvP', icon: 'M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z' },
  { key: 'pbp', label: 'PBP', icon: 'M6 4h12M6 9h12M6 14h8M6 19h5' },
] as const;
type PageKey = (typeof PAGES)[number]['key'];
type Route = { page: PageKey } | { page: 'game'; id: string };

function readRoute(): Route {
  const h = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  if (h.startsWith('game/')) return { page: 'game', id: h.slice(5) };
  const p = PAGES.find((x) => x.key === h);
  return { page: p ? p.key : 'board' };
}

function savedLeague(): LeagueKey {
  try {
    const v = localStorage.getItem('cz-league');
    if (LEAGUES.some((l) => l.key === v)) return v as LeagueKey;
  } catch { /* private mode: use the default */ }
  return 'nfl';
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [league, setLeague] = useState<LeagueKey>(savedLeague);
  const leagueName = leagueInfo(league).name;
  const board = useLoad(() => loadBoard(league), [league]);

  useEffect(() => {
    const on = () => { setRoute(readRoute()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Reopening the app from the home screen should show fresh picks.
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === 'visible') board.reload(true); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [board.reload]);

  const pickLeague = (l: LeagueKey) => {
    if (l === league) return;
    setLeague(l);
    try { localStorage.setItem('cz-league', l); } catch { /* fine without it */ }
  };

  const needsBoard = route.page === 'board' || route.page === 'spreads' || route.page === 'record' || route.page === 'pbp';
  const b = board.data;
  let body;
  if (route.page === 'game') {
    body = <GameView id={route.id} fromBoard={b?.games.find((g) => g.id === route.id)} />;
  } else if (needsBoard && !b) {
    body = <main><LoadState error={board.error} loading={board.loading} what="picks" /></main>;
  } else if (route.page === 'board') body = <BoardView key={league} board={b!} league={league} leagueName={leagueName} />;
  else if (route.page === 'spreads') body = <SpreadsView board={b!} league={league} leagueName={leagueName} />;
  else if (route.page === 'record') body = <RecordView board={b!} league={league} leagueName={leagueName} />;
  else if (route.page === 'pbp') body = <PbpView board={b!} leagueName={leagueName} />;
  else if (route.page === 'models') body = <ModelsView league={league} leagueName={leagueName} />;
  else if (route.page === 'insights') body = <InsightsView league={league} leagueName={leagueName} />;
  else body = <DvpView league={league} leagueName={leagueName} />;

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="eyebrow">Prediction terminal</p>
          <h1>The Cash<span>Zone</span></h1>
        </div>
        <button className="btn3d" onClick={() => board.reload(true)} disabled={board.loading} aria-label="Refresh picks">
          {board.loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {route.page !== 'game' ? (
        <nav className="leagues" aria-label="League">
          {LEAGUES.map((l) => (
            <button key={l.key} className={league === l.key ? 'on' : ''} aria-pressed={league === l.key} onClick={() => pickLeague(l.key)}>{l.name}</button>
          ))}
        </nav>
      ) : null}

      {board.error && b && needsBoard ? (
        <div className="card notice" role="alert"><strong>Couldn’t refresh.</strong><span>Showing the last board that loaded. {board.error}</span></div>
      ) : null}
      {board.error === 'not-configured' && route.page === 'board' ? (
        <Notice title="Almost there.">The app isn’t connected to its database yet.</Notice>
      ) : null}

      {body}

      <footer className="fine">
        {b?.last_run ? <p>Model last ran {dayFmt.format(new Date(b.last_run))} at {clockFmt.format(new Date(b.last_run))}.</p> : null}
        <p>Informational analysis only, not betting advice. Picks lock at the start of each game and are graded on the final score.</p>
      </footer>

      <nav className="tabs" aria-label="Sections">
        {PAGES.map((p) => {
          const on = route.page === p.key || (route.page === 'game' && p.key === 'pbp');
          return (
            <a key={p.key} href={`#/${p.key}`} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={p.icon} /></svg>
              <span>{p.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
