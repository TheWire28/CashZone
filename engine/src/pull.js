// Decides which feed pages to request for a league and turns them into teams and games.
//   week leagues (NFL, college football): the feed is organized by season week
//   day leagues (NHL, NBA, college basketball): the feed is organized by calendar day
import { fetchScoreboard, normalizeEvent } from './espn.js';

const DAY = 864e5;
// The feed's "day" is the US Eastern calendar day.
const etDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d).replaceAll('-', '');

function weekRequests(lg, head, firstRun) {
  const year = head?.season?.year, type = head?.season?.type, week = head?.week?.number;
  if (!year) throw new Error('Feed response had no season; its format may have changed.');
  const want = [];
  if (firstRun) {
    // Last season (with playoffs) plus this season so far, so ratings start informed.
    for (let w = 1; w <= lg.regularWeeks; w++) want.push({ year: year - 1, type: 2, week: w });
    for (let w = 1; w <= lg.postWeeks; w++) want.push({ year: year - 1, type: 3, week: w });
    const upTo = type === 2 ? week : type > 2 ? lg.regularWeeks : 0;
    for (let w = 1; w <= Math.min(upTo + 1, lg.regularWeeks); w++) want.push({ year, type: 2, week: w });
  } else if (type === 2 && week) {
    // Normal run: this week, last week (late finals) and next week (early lines).
    for (const w of [week - 1, week, week + 1]) if (w >= 1 && w <= lg.regularWeeks) want.push({ year, type: 2, week: w });
  } else {
    want.push({}); // playoffs or offseason: whatever the feed is currently showing
  }
  return want;
}

function dayRequests(lg, now, firstRun) {
  const want = [];
  if (firstRun) {
    if (lg.backfill === 'month') {
      // One request per month for the past 14 months covers last season and this one.
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      for (let i = 0; i < 14; i++) {
        want.push({ date: `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}` });
        d.setUTCMonth(d.getUTCMonth() - 1);
      }
    } else {
      // Too many games per month for one page, so go day by day through the months the league plays.
      for (let i = 2; i <= 400; i++) {
        const d = new Date(now.getTime() - i * DAY);
        if (!lg.activeMonths || lg.activeMonths.includes(Number(etDay(d).slice(4, 6)))) want.push({ date: etDay(d) });
      }
    }
  }
  // Every run: yesterday (late finals) through the next few days (upcoming games and lines).
  for (let i = -1; i <= lg.daysAhead; i++) want.push({ date: etDay(new Date(now.getTime() + i * DAY)) });
  return want;
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function pull(lg, { firstRun, now = new Date(), fetchJson, log = () => {} }) {
  const teams = new Map(), games = new Map();
  const take = (board) => {
    for (const e of board?.events || []) {
      const n = normalizeEvent(lg, e);
      if (!n) continue;
      for (const t of n.teams) teams.set(t.id, t);
      games.set(n.game.id, n.game);
    }
  };

  let requests;
  if (lg.calendar === 'week') {
    const head = await fetchScoreboard(lg, { group: lg.groups?.[0] }, fetchJson);
    requests = weekRequests(lg, head, firstRun);
  } else {
    requests = dayRequests(lg, now, firstRun);
  }
  // College divisions are separate feeds; ask each one for every page.
  const all = requests.flatMap((r) => (lg.groups || [null]).map((group) => (group ? { ...r, group } : r)));
  if (firstRun) log(`[${lg.key}] First run: loading history (${all.length} feed requests).`);

  let failed = 0;
  await pool(all, firstRun ? 4 : 2, async (r) => {
    try {
      take(await fetchScoreboard(lg, r, fetchJson));
    } catch (err) {
      // During the one-time history load a missing page (e.g. a week that does not exist)
      // is fine. On a normal run every page matters, so let it fail loudly.
      if (!firstRun) throw err;
      failed++;
    }
  });
  if (failed) log(`[${lg.key}] ${failed} of ${all.length} history requests returned nothing.`);
  if (firstRun && failed > all.length / 2) throw new Error('Most history requests failed; not trusting this load.');
  return { teams: [...teams.values()], games: [...games.values()] };
}
