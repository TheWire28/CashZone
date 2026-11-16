#!/usr/bin/env node
// Entry point for Render's scheduled job and for running by hand.
//   node src/run.js sync             pull, pick, grade -> Supabase
//   node src/run.js sync --local     same, but in memory: prints the picks, saves nothing
//   node src/run.js backtest --local how the model would have done on past games
import { writeFile } from 'node:fs/promises';
import { LEAGUES, getLeague } from './leagues.js';
import { sync } from './pipeline.js';
import { backtest } from './model.js';
import { createMemoryStore } from './store-memory.js';

const [cmd = 'sync', ...flags] = process.argv.slice(2);
const local = flags.includes('--local');
const leagueArg = flags.find((f) => f.startsWith('--league='))?.split('=')[1];
const leagues = leagueArg ? [getLeague(leagueArg)] : Object.values(LEAGUES);
const log = (...a) => console.log(...a);

async function makeStore() {
  if (local) return createMemoryStore();
  const { createSupabaseStore } = await import('./store-supabase.js');
  return createSupabaseStore({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
}

async function main() {
  if (!['sync', 'backtest'].includes(cmd)) throw new Error(`Unknown command "${cmd}". Use sync or backtest.`);
  const store = await makeStore();
  let failed = false;

  for (const lg of leagues) {
    try {
      const summary = await sync(lg, store, { log });
      log(`[${lg.key}]`, JSON.stringify(summary));
      if (cmd === 'backtest') {
        const finals = (await store.listGames(lg.key)).filter((g) => g.status === 'final')
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        const season = Math.max(...finals.map((g) => g.season));
        log(`[${lg.key}] backtest, ${season} season:`, JSON.stringify(backtest(finals, lg, { fromSeason: season }), null, 2));
      }
    } catch (err) {
      // One league failing must not stop the others.
      failed = true;
      console.error(`[${lg.key}] FAILED: ${err.message}`);
      await store.logRun({ job: `sync:${lg.key}`, started_at: new Date().toISOString(), finished_at: new Date().toISOString(), ok: false, detail: { error: err.message } }).catch(() => {});
    }
  }

  if (local && cmd === 'sync') {
    const snap = store.snapshot();
    for (const g of snap.games.filter((x) => x.prediction && x.status === 'scheduled')) {
      const p = g.prediction;
      const pick = p.pick_winner === g.home_team ? g.home.abbr : g.away.abbr;
      log(`${g.start_time.slice(0, 16)}  ${g.away.abbr.padEnd(3)} @ ${g.home.abbr.padEnd(3)}  ${p.proj_away}-${p.proj_home}  pick ${pick} ${(p.confidence * 100).toFixed(0)}%  fair ${p.fair_odds > 0 ? '+' : ''}${p.fair_odds}`);
    }
    const out = new URL('../../web/public/dev-snapshot.json', import.meta.url);
    await writeFile(out, JSON.stringify(snap)).then(() => log('Wrote web/public/dev-snapshot.json for local preview.'), () => {});
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
