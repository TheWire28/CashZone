-- Phase 2: more leagues. Ratings are now kept in the database and updated with only the
-- newly finished games, so a normal run stays small however much history a league has.
-- Safe to run more than once.

alter table games add column if not exists rated boolean not null default false;
create index if not exists games_unrated_idx on games (league) where status = 'final' and not rated;

alter table team_ratings add column if not exists pf numeric not null default 0;
alter table team_ratings add column if not exists pa numeric not null default 0;
alter table team_ratings add column if not exists n  numeric not null default 0;

create table if not exists league_state (
  league      text primary key,
  season      int,
  lg_pts      numeric not null default 0,
  lg_n        numeric not null default 0,
  updated_at  timestamptz not null default now()
);
alter table league_state enable row level security;
drop policy if exists "public read" on league_state;
create policy "public read" on league_state for select to anon, authenticated using (true);
grant select on league_state to anon, authenticated;

-- Saves new ratings and marks the games they include as counted, in one transaction.
create or replace function apply_ratings(p_league text, p_state jsonb, p_teams jsonb, p_game_ids text[])
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into league_state (league, season, lg_pts, lg_n, updated_at)
  values (p_league, (p_state->>'season')::int, (p_state->>'lg_pts')::numeric, (p_state->>'lg_n')::numeric, now())
  on conflict (league) do update
    set season = excluded.season, lg_pts = excluded.lg_pts, lg_n = excluded.lg_n, updated_at = now();

  insert into team_ratings (team_id, league, rating, off, def, games, pf, pa, n, updated_at)
  select x.team_id, p_league, x.rating, x.off, x.def, x.games, x.pf, x.pa, x.n, now()
  from jsonb_to_recordset(p_teams) as x(team_id text, rating numeric, off numeric, def numeric, games int, pf numeric, pa numeric, n numeric)
  on conflict (team_id) do update
    set rating = excluded.rating, off = excluded.off, def = excluded.def, games = excluded.games,
        pf = excluded.pf, pa = excluded.pa, n = excluded.n, updated_at = now();

  update games set rated = true where id = any(p_game_ids);
end $$;

-- Only the scheduled job may call it.
revoke all on function apply_ratings(text, jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function apply_ratings(text, jsonb, jsonb, text[]) to service_role;

create index if not exists games_window_idx on games (league, start_time) include (status);
