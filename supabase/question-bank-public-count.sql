-- DrillGRE public Question Bank count.
-- Run after security-hardening.sql.
--
-- Public visitors may view the number of published practice questions without
-- receiving question text, answer choices, images, answer keys, or progress data.

create or replace function public.get_public_question_bank_count()
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(*)::integer
  from public.questions q
  where q.published is true
    and q.question_usage in ('practice','both');
$$;

revoke all on function public.get_public_question_bank_count() from public;
grant execute on function public.get_public_question_bank_count() to anon, authenticated;

notify pgrst, 'reload schema';
