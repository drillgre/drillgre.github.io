-- Automatic lesson discovery, engagement tracking, study time and learning streaks.
-- Run this file in Supabase SQL Editor after quiz-progress.sql.

create table if not exists public.gre_lesson_activity (
  learner_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  activity_date date not null default (now() at time zone 'utc')::date,
  active_seconds integer not null default 0 check (active_seconds >= 0),
  last_activity_at timestamptz not null default now(),
  primary key (learner_id, lesson_id, activity_date)
);

create index if not exists gre_lesson_activity_learner_date_idx
  on public.gre_lesson_activity(learner_id, activity_date desc);

alter table public.gre_lesson_activity enable row level security;
revoke all on public.gre_lesson_activity from anon, authenticated;

create or replace function public.record_gre_lesson_activity(
  p_lesson_id uuid,
  p_elapsed_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_seconds integer := greatest(0,least(coalesce(p_elapsed_seconds,0),45));
  v_today date := (now() at time zone 'utc')::date;
  v_total integer;
begin
  if v_user is null then raise exception 'Sign in to save lesson activity.'; end if;
  if not exists(select 1 from public.lessons where id=p_lesson_id and published=true) then
    raise exception 'Published lesson not found.';
  end if;
  if v_seconds=0 then return jsonb_build_object('recorded',false); end if;

  insert into public.gre_lesson_activity(learner_id,lesson_id,activity_date,active_seconds,last_activity_at)
  values(v_user,p_lesson_id,v_today,v_seconds,now())
  on conflict(learner_id,lesson_id,activity_date)
  do update set
    active_seconds=least(86400,public.gre_lesson_activity.active_seconds+excluded.active_seconds),
    last_activity_at=now();

  select coalesce(sum(active_seconds),0)::integer into v_total
  from public.gre_lesson_activity where learner_id=v_user;
  return jsonb_build_object('recorded',true,'total_active_seconds',v_total);
end;
$$;

create or replace function public.get_learner_lesson_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_lessons jsonb;
  v_total integer;
  v_completed integer;
  v_seconds bigint;
  v_streak integer;
  v_last_day date;
begin
  if v_user is null then raise exception 'Please sign in to view lesson progress.'; end if;

  select count(*)::integer into v_total
  from public.lessons where published=true;

  select count(*)::integer into v_completed
  from public.gre_lesson_progress lp
  join public.lessons l on l.id=lp.lesson_id and l.published=true
  where lp.learner_id=v_user;

  select coalesce(sum(active_seconds),0)::bigint,
         max(activity_date)
  into v_seconds,v_last_day
  from public.gre_lesson_activity where learner_id=v_user;

  with days as (
    select distinct activity_date
    from public.gre_lesson_activity
    where learner_id=v_user and active_seconds>0
  ),
  anchor as (
    select case when exists(select 1 from days where activity_date=(now() at time zone 'utc')::date)
      then (now() at time zone 'utc')::date
      else (now() at time zone 'utc')::date-1 end as day
  ),
  streak_days as (
    select d.activity_date,
      (a.day-d.activity_date) as gap,
      row_number() over(order by d.activity_date desc)-1 as expected_gap
    from days d cross join anchor a
    where d.activity_date<=a.day
  )
  select count(*)::integer into v_streak
  from streak_days where gap=expected_gap;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.module_order,x.lesson_order,x.title),'[]'::jsonb)
  into v_lessons
  from (
    select l.id,l.title,l.slug,l.sort_order as lesson_order,
      m.title as module_title,coalesce(m.sort_order,0) as module_order,
      lp.completed_at,
      coalesce(a.active_seconds,0)::integer as active_seconds,
      a.last_activity_at,
      case when lp.completed_at is not null then 'completed'
           when a.active_seconds>0 then 'in_progress'
           else 'not_started' end as status
    from public.lessons l
    left join public.modules m on m.id=l.module_id
    left join public.gre_lesson_progress lp on lp.lesson_id=l.id and lp.learner_id=v_user
    left join (
      select lesson_id,sum(active_seconds)::integer as active_seconds,max(last_activity_at) as last_activity_at
      from public.gre_lesson_activity where learner_id=v_user group by lesson_id
    ) a on a.lesson_id=l.id
    where l.published=true
  ) x;

  return jsonb_build_object(
    'lessons',coalesce(v_lessons,'[]'::jsonb),
    'lessons_total',coalesce(v_total,0),
    'lessons_completed',coalesce(v_completed,0),
    'completion_percentage',case when coalesce(v_total,0)>0 then round(100.0*v_completed/v_total,1) else 0 end,
    'study_seconds',coalesce(v_seconds,0),
    'study_hours',round(coalesce(v_seconds,0)::numeric/3600,2),
    'learning_streak_days',coalesce(v_streak,0),
    'last_study_date',v_last_day
  );
end;
$$;

revoke all on function public.record_gre_lesson_activity(uuid,integer) from public,anon;
revoke all on function public.get_learner_lesson_overview() from public,anon;
grant execute on function public.record_gre_lesson_activity(uuid,integer) to authenticated;
grant execute on function public.get_learner_lesson_overview() to authenticated;
notify pgrst,'reload schema';
