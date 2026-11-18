-- Hit/miss record by confidence level, for winner, spread and total picks.
-- Confidence is the model's win chance for the team it picked (50% to 99%), grouped by tens.
create or replace view v_confidence_record with (security_invoker = true) as
select g.league,
       least(floor(p.confidence * 10) * 10, 90)::int as bucket,
       m.market,
       count(*) filter (where m.result = 'win')  as wins,
       count(*) filter (where m.result = 'loss') as losses,
       count(*) filter (where m.result = 'push') as pushes,
       round(avg(p.confidence), 3) as avg_conf
from grades g
join predictions p on p.game_id = g.game_id
cross join lateral (values
  ('winner', case when g.winner_correct is null then null when g.winner_correct then 'win' else 'loss' end),
  ('spread', g.spread_result),
  ('total',  g.total_result)
) as m(market, result)
where m.result is not null
group by g.league, least(floor(p.confidence * 10) * 10, 90), m.market;
grant select on v_confidence_record to anon, authenticated;
