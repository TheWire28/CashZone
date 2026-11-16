-- The CashZone database. Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to run again: everything is "if not exists" / "or replace".

create table if not exists teams (
  id          text primary key,              -- e.g. nfl:33
  league      text not null,
  abbr        text not null default '',
  name        text not null default '',
  short_name  text not null default '',
  color       text
);

create table if not exists games (
  id            text primary key,            -- e.g. nfl:401873065
  league        text not null,
  season        int  not null,
  season_type   int  not null,               -- 2 regular season, 3 playoffs
  week          int,
  start_time    timestamptz not null,
  status        text not null check (status in ('scheduled','in_progress','final','canceled')),
  home_team     text not null,
  away_team     text not null,
  home_score    int,
  away_score    int,
  neutral_site  boolean not null default false,
  venue         text,
  constraint games_home_team_fkey foreign key (home_team) references teams(id),
  constraint games_away_team_fkey foreign key (away_team) references teams(id)
);
create index if not exists games_league_start_idx on games (league, start_time);
create index if not exists games_status_idx on games (league, status);

-- One pick per game. Updated until kickoff, then never touched again.
create table if not exists predictions (
  game_id             text primary key references games(id) on delete cascade,
  league              text not null,
  model_version       text not null,
  home_win_prob       numeric not null,
  proj_home           numeric not null,
  proj_away           numeric not null,
  pick_winner         text not null references teams(id),
  confidence          numeric not null,
  fair_odds           int not null,
  market_spread_home  numeric,               -- sportsbook line seen before kickoff (home team's number)
  market_total        numeric,
  pick_spread         text references teams(id),
  pick_total          text check (pick_total in ('over','under')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists grades (
  game_id         text primary key references games(id) on delete cascade,
  league          text not null,
  winner_correct  boolean,                   -- null when the game ended in a tie
  spread_result   text check (spread_result in ('win','loss','push')),
  total_result    text check (total_result in ('win','loss','push')),
  margin_error    numeric,
  total_error     numeric,
  graded_at       timestamptz not null default now()
);

create table if not exists team_ratings (
  team_id     text primary key references teams(id) on delete cascade,
  league      text not null,
  rating      numeric not null,
  off         numeric not null,              -- points scored per game
  def         numeric not null,              -- points allowed per game
  games       int not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists runs (
  id           bigint generated always as identity primary key,
  job          text not null,
  started_at   timestamptz not null,
  finished_at  timestamptz not null,
  ok           boolean not null,
  detail       jsonb
);
create index if not exists runs_finished_idx on runs (finished_at desc);

-- Win/loss record by league, time window and market. The app reads this.
create or replace view v_record with (security_invoker = true) as
select g.league, w.win, m.market,
       count(*) filter (where m.result = 'win')  as wins,
       count(*) filter (where m.result = 'loss') as losses,
       count(*) filter (where m.result = 'push') as pushes
from grades g
join games ga on ga.id = g.game_id
cross join (values ('7d', 7), ('30d', 30), ('90d', 90), ('all', null)) as w(win, days)
cross join lateral (values
  ('winner', case when g.winner_correct is null then null when g.winner_correct then 'win' else 'loss' end),
  ('spread', g.spread_result),
  ('total',  g.total_result)
) as m(market, result)
where m.result is not null
  and (w.days is null or ga.start_time >= now() - make_interval(days => w.days))
group by g.league, w.win, m.market;

-- Security: anyone with the app can read; nobody can write through the app.
-- Only the scheduled job (service-role key, kept on Render) can write.
alter table teams         enable row level security;
alter table games         enable row level security;
alter table predictions   enable row level security;
alter table grades        enable row level security;
alter table team_ratings  enable row level security;
alter table runs          enable row level security;

do $$
declare t text;
begin
  foreach t in array array['teams','games','predictions','grades','team_ratings','runs'] loop
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;
grant select on v_record to anon, authenticated;
