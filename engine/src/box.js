// Defense vs position (DvP): for every finished game, what each defense allowed to each
// opposing position. Read from the game's box score once, then never again.
//
//   basketball  positions G / F / C            (the feed's own labels)
//   hockey      positions C / W / D            (LW and RW count as W)
//   football    positions QB / RB / WR / TE    (looked up from team rosters, because
//                                               football box scores carry no positions)
const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const made = (v) => num(String(v ?? '').split('-')[0]); // "3-7" -> 3
const r2 = (x) => Math.round(x * 100) / 100;

function read(group, athlete) {
  const labels = group.labels || [];
  const stats = athlete.stats || [];
  return (label) => {
    const i = labels.indexOf(label);
    return i < 0 ? undefined : stats[i];
  };
}

// Fantasy scoring, so positions can be compared on one number.
const FANTASY = {
  basketball: (s) => s.pts + 1.25 * s.reb + 1.5 * s.ast + 2 * s.stl + 2 * s.blk - 0.5 * s.tov + 0.5 * s.fg3,
  hockey: (s) => 8.5 * s.g + 5 * s.a + 1.5 * s.sog + 1.3 * s.blk,
  football: (s) => 0.04 * s.pass_yds + 4 * s.pass_td - 2 * s.int + 0.1 * s.rush_yds + 6 * s.rush_td + s.rec + 0.1 * s.rec_yds + 6 * s.rec_td,
};

function basketballLines(team) {
  const out = {};
  for (const group of team.statistics || []) {
    for (const a of group.athletes || []) {
      if (!a.stats?.length || a.didNotPlay) continue;
      const pos = a.athlete?.position?.abbreviation;
      if (!['G', 'F', 'C'].includes(pos)) continue;
      const v = read(group, a);
      const s = (out[pos] ||= { pts: 0, reb: 0, ast: 0, fg3: 0, stl: 0, blk: 0, tov: 0 });
      s.pts += num(v('PTS')); s.reb += num(v('REB')); s.ast += num(v('AST')); s.fg3 += made(v('3PT'));
      s.stl += num(v('STL')); s.blk += num(v('BLK')); s.tov += num(v('TO'));
    }
  }
  return out;
}

function hockeyLines(team) {
  const out = {};
  for (const group of team.statistics || []) {
    for (const a of group.athletes || []) {
      if (!a.stats?.length) continue;
      const raw = a.athlete?.position?.abbreviation;
      const pos = raw === 'C' ? 'C' : raw === 'LW' || raw === 'RW' ? 'W' : raw === 'D' ? 'D' : null;
      if (!pos) continue; // goalies
      const v = read(group, a);
      const s = (out[pos] ||= { g: 0, a: 0, pts: 0, sog: 0, blk: 0 });
      // 'S' is shots on goal; the feed's 'SOG' column is something else.
      s.g += num(v('G')); s.a += num(v('A')); s.sog += num(v('S')); s.blk += num(v('BS'));
      s.pts = s.g + s.a;
    }
  }
  return out;
}

function footballLines(team, positions) {
  const out = {};
  const add = (id, fn) => {
    let pos = positions.get(String(id));
    if (pos === 'FB') pos = 'RB';
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) return;
    fn((out[pos] ||= { pass_yds: 0, pass_td: 0, int: 0, rush_yds: 0, rush_td: 0, rec: 0, rec_yds: 0, rec_td: 0, tgt: 0 }));
  };
  for (const group of team.statistics || []) {
    for (const a of group.athletes || []) {
      const v = read(group, a);
      const id = a.athlete?.id;
      if (group.name === 'passing') add(id, (s) => { s.pass_yds += num(v('YDS')); s.pass_td += num(v('TD')); s.int += num(v('INT')); });
      if (group.name === 'rushing') add(id, (s) => { s.rush_yds += num(v('YDS')); s.rush_td += num(v('TD')); });
      if (group.name === 'receiving') add(id, (s) => { s.rec += num(v('REC')); s.rec_yds += num(v('YDS')); s.rec_td += num(v('TD')); s.tgt += num(v('TGTS')); });
    }
  }
  return out;
}

// Every athlete id that appears in a football box score.
export function footballAthleteIds(summary) {
  const ids = new Set();
  for (const team of summary?.boxscore?.players || []) {
    for (const group of team.statistics || []) {
      if (!['passing', 'rushing', 'receiving'].includes(group.name)) continue;
      for (const a of group.athletes || []) if (a.athlete?.id) ids.add(String(a.athlete.id));
    }
  }
  return ids;
}

// One summary -> DvP rows: one per (defending team, opposing position).
export function dvpRows(lg, game, summary, positions = new Map()) {
  const teams = summary?.boxscore?.players || [];
  if (teams.length !== 2) return [];
  const rows = [];
  for (let i = 0; i < 2; i++) {
    const offense = teams[i], defense = teams[1 - i];
    if (!offense.team?.id || !defense.team?.id) continue;
    const lines = lg.dvp === 'basketball' ? basketballLines(offense)
      : lg.dvp === 'hockey' ? hockeyLines(offense)
        : footballLines(offense, positions);
    for (const [pos, s] of Object.entries(lines)) {
      const stats = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, r2(v)]));
      stats.fpts = r2(FANTASY[lg.dvp](s));
      rows.push({
        game_id: game.id, league: lg.key, season: game.season,
        def_team: `${lg.key}:${defense.team.id}`, pos, stats,
      });
    }
  }
  return rows;
}

async function getJson(url, fetchJson) {
  if (fetchJson) return fetchJson(url);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`Feed request failed (${url}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// Reads box scores for this season's finished games that have not been read yet.
// Capped per run so a big backfill spreads over a few runs instead of one long one.
export async function collectDvp(lg, store, season, { fetchJson, log = () => {} } = {}) {
  if (!lg.dvp || !season) return { boxes_read: 0, boxes_left: 0 };
  const todo = await store.listUnboxedFinals(lg.key, season, lg.dvpPerRun || 250);
  if (!todo.length) return { boxes_read: 0, boxes_left: 0 };

  const summaries = new Map();
  await pool(todo, 4, async (g) => {
    try {
      const full = await getJson(`${BASE}/${lg.espnPath}/summary?event=${g.id.split(':')[1]}`, fetchJson);
      // Keep only the box score; a full summary is ~0.5 MB and a backfill reads hundreds.
      summaries.set(g.id, { boxscore: { players: full?.boxscore?.players || [] } });
    } catch (err) {
      log(`[${lg.key}] box score unavailable for ${g.id}: ${err.message}`);
    }
  });

  // Football: learn the position of every player we have not seen before, from team rosters.
  let positions = new Map();
  if (lg.dvp === 'football') {
    const ids = new Set();
    for (const s of summaries.values()) for (const id of footballAthleteIds(s)) ids.add(id);
    positions = await store.getPlayerPositions(lg.key, [...ids]);
    const missing = [...ids].filter((id) => !positions.has(id));
    if (missing.length) {
      const teamIds = new Set();
      for (const s of summaries.values()) {
        for (const t of s?.boxscore?.players || []) {
          const seen = (t.statistics || []).some((g) => (g.athletes || []).some((a) => missing.includes(String(a.athlete?.id))));
          if (seen && t.team?.id) teamIds.add(t.team.id);
        }
      }
      const players = [];
      await pool([...teamIds], 4, async (teamId) => {
        try {
          const roster = await getJson(`${BASE}/${lg.espnPath}/teams/${teamId}/roster`, fetchJson);
          for (const group of roster?.athletes || []) {
            for (const a of group.items || []) {
              if (a.id && a.position?.abbreviation) {
                players.push({ id: `${lg.key}:${a.id}`, league: lg.key, name: a.displayName || '', pos: a.position.abbreviation });
              }
            }
          }
        } catch (err) {
          log(`[${lg.key}] roster unavailable for team ${teamId}: ${err.message}`);
        }
      });
      await store.upsertPlayers(players);
      for (const p of players) positions.set(p.id.split(':')[1], p.pos);
    }
  }

  const rows = [], done = [];
  for (const g of todo) {
    const s = summaries.get(g.id);
    if (!s) continue; // try again next run
    rows.push(...dvpRows(lg, g, s, positions));
    done.push(g.id);
  }
  await store.saveDvp(rows, done);
  const left = await store.countUnboxedFinals(lg.key, season);
  return { boxes_read: done.length, boxes_left: left };
}
