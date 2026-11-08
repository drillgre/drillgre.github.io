-- DrillGRE dashboard RPC repair
-- Run this standalone script in Supabase SQL Editor if dashboard.html reports:
-- "Could not find the function public.get_learner_dashboard without parameters
-- in the schema cache".
--
-- This patch is intentionally limited to profile metadata prerequisites and
-- the dashboard RPC. It does not recreate mock tables or change question data.

begin;

alter table public.profiles add column if not exists name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists education text;
alter table public.profiles add column if not exists age_range text;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists academic_background text;
alter table public.profiles add column if not exists further_study text;
alter table public.profiles add column if not exists further_study_fields text[] not null default '{}';

alter table public.gre_mock_attempts
  add column if not exists learner_id uuid references auth.users(id) on delete set null;

create index if not exists gre_mock_attempts_learner_history_idx
  on public.gre_mock_attempts(learner_id, created_at desc);

create or replace function public.get_learner_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile jsonb;
  v_attempts jsonb;
  v_total integer;
  v_completed integer;
begin
  if v_user_id is null then
    raise exception 'Please sign in to view your learner dashboard.';
  end if;

  select jsonb_build_object(
    'name', p.name,
    'email', p.email,
    'education', p.education,
    'age_range', p.age_range,
    'country', p.country,
    'academic_background', p.academic_background,
    'further_study', p.further_study,
    'further_study_fields', p.further_study_fields
  )
  into v_profile
  from public.profiles p
  where p.id = v_user_id;

  if v_profile is null then
    raise exception 'Your learner profile is not available. Please contact support.';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'completed')::integer
  into v_total, v_completed
  from public.gre_mock_attempts
  where learner_id = v_user_id;

  select coalesce(
    jsonb_agg(to_jsonb(recent) order by recent.created_at desc),
    '[]'::jsonb
  )
  into v_attempts
  from (
    select id, status, created_at, completed_at, scaled_score,
           total_correct, route, section1_correct
    from public.gre_mock_attempts
    where learner_id = v_user_id
    order by created_at desc
    limit 20
  ) recent;

  return jsonb_build_object(
    'profile', v_profile,
    'mocks_started', coalesce(v_total, 0),
    'mocks_completed', coalesce(v_completed, 0),
    'recent_attempts', coalesce(v_attempts, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_learner_dashboard() from public, anon;
grant execute on function public.get_learner_dashboard() to authenticated;

commit;

-- Refresh PostgREST's schema cache so the browser can discover the new RPC.
notify pgrst, 'reload schema';
