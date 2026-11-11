-- DrillGRE public Word Archery leaderboard.
-- Uses the existing learner leaderboard opt-in. Run after word-archery.sql
-- and the learner leaderboard functions in learner-accounts.sql.

create or replace function public.get_public_word_archery_leaderboard(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
select coalesce(jsonb_agg(to_jsonb(r) order by r.rank), '[]'::jsonb)
from (
  select
    row_number() over (
      order by
        sum(a.points_awarded) desc,
        round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 1) desc,
        count(*) desc,
        min(a.created_at) asc
    )::integer as rank,
    split_part(coalesce(nullif(trim(p.name), ''), 'Learner'), ' ', 1) as first_name,
    sum(a.points_awarded)::integer as total_points,
    count(*)::integer as attempts,
    count(*) filter (where a.is_correct)::integer as correct_attempts,
    round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 1) as success_rate
  from public.profiles p
  join public.gre_word_archery_attempts a on a.learner_id = p.id
  where p.role = 'learner'
    and p.leaderboard_opt_in = true
  group by p.id, p.name
  having count(*) > 0
  order by
    sum(a.points_awarded) desc,
    round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 1) desc,
    count(*) desc,
    min(a.created_at) asc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
) r;
$$;

revoke all on function public.get_public_word_archery_leaderboard(integer) from public;
grant execute on function public.get_public_word_archery_leaderboard(integer) to anon, authenticated;

notify pgrst, 'reload schema';
