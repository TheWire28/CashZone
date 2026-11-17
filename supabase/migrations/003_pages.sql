-- Phase 3: data for the Models, Insights and DvP pages. Safe to run more than once.

-- Model scorecard and settings, saved with the ratings.
alter table league_state add column if not exists stats jsonb;
alter table league_state add column if not exists config jsonb;
alter table league_state add column if not exists model_version text;

create or replace function apply_ratings(p_league text, p_state jsonb, p_teams jsonb, p_game_ids text[])
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into league_state (league, season, lg_pts, lg_n, stats, config, model_version, updated_at)
  values (p_league, (p_state->>'season')::int, (p_state->>'lg_pts')::numeric, (p_state->>'lg_n')::numeric,
          p_state->'stats', p_state->'config', p_state->>'model_version', now())
  on conflict (league) do update
    set season = excluded.season, lg_pts = excluded.lg_pts, lg_n = excluded.lg_n,
        stats = excluded.stats, config = excluded.config, model_version = excluded.model_version, updated_at = now();

  insert into team_ratings (team_id, league, rating, off, def, games, pf, pa, n, updated_at)
  select x.team_id, p_league, x.rating, x.off, x.def, x.games, x.pf, x.pa, x.n, now()
  from jsonb_to_recordset(p_teams) as x(team_id text, rating numeric, off numeric, def numeric, games int, pf numeric, pa numeric, n numeric)
  on conflict (team_id) do update
    set rating = excluded.rating, off = excluded.off, def = excluded.def, games = excluded.games,
        pf = excluded.pf, pa = excluded.pa, n = excluded.n, updated_at = now();

  update games set rated = true where id = any(p_game_ids);
end $$;
revoke all on function apply_ratings(text, jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function apply_ratings(text, jsonb, jsonb, text[]) to service_role;

-- Box scores read for defense vs position.
alter table games add column if not exists boxed boolean not null default false;
create index if not exists games_unboxed_idx on games (league, season) where status = 'final' and not boxed;

-- Football player positions (box scores do not include them). Only the job reads this.
create table if not exists players (
  id          text primary key,              -- e.g. nfl:4426348
  league      text not null,
  name        text not null default '',
  pos         text not null,
  updated_at  timestamptz not null default now()
);
alter table players enable row level security;

-- What each defense allowed to each opposing position, one row per game.
create table if not exists dvp_lines (
  game_id   text not null references games(id) on delete cascade,
  league    text not null,
  season    int  not null,
  def_team  text not null references teams(id),
  pos       text not null,
  stats     jsonb not null,
  primary key (game_id, def_team, pos)
);
create index if not exists dvp_lines_league_idx on dvp_lines (league, season, pos);
alter table dvp_lines enable row level security;
drop policy if exists "public read" on dvp_lines;
create policy "public read" on dvp_lines for select to anon, authenticated using (true);
grant select on dvp_lines to anon, authenticated;

-- Per-game averages allowed, latest season of each league. Divides by every game the
-- defense played, so a game where a position produced nothing still counts.
create or replace view v_dvp with (security_invoker = true) as
with latest as (
  select league, max(season) as season from dvp_lines group by league
), lines as (
  select d.* from dvp_lines d join latest l on l.league = d.league and l.season = d.season
), played as (
  select league, def_team, count(distinct game_id) as games from lines group by league, def_team
), sums as (
  select d.league, d.def_team, d.pos, e.key as stat, sum(e.value::numeric) as total
  from lines d cross join lateral jsonb_each_text(d.stats) e
  group by d.league, d.def_team, d.pos, e.key
)
select s.league, l.season, s.def_team, s.pos, p.games,
       jsonb_object_agg(s.stat, round(s.total / p.games, 2)) as per_game
from sums s
join played p on p.league = s.league and p.def_team = s.def_team
join latest l on l.league = s.league
group by s.league, l.season, s.def_team, s.pos, p.games;
grant select on v_dvp to anon, authenticated;

-- Live calibration: how often picks at each confidence level actually won.
create or replace view v_calibration with (security_invoker = true) as
select g.league,
       least(floor(p.confidence * 10) * 10, 90)::int as bucket,
       count(*) as games,
       count(*) filter (where g.winner_correct) as correct,
       round(avg(p.confidence), 3) as avg_conf
from grades g
join predictions p on p.game_id = g.game_id
where g.winner_correct is not null
group by g.league, least(floor(p.confidence * 10) * 10, 90);
grant select on v_calibration to anon, authenticated;
