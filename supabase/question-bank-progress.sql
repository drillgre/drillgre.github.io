-- DrillGRE authenticated Question Bank progress and public leaderboard counts.
-- Run after gre-mock-tests.sql, learner-accounts.sql, learner-read-policies.sql,
-- topic-quiz.sql, and quiz-progress.sql.

create table if not exists public.gre_question_bank_progress (
  learner_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  completed_at timestamptz not null default now(),
  primary key (learner_id, question_id)
);

create index if not exists gre_question_bank_progress_learner_completed_idx
  on public.gre_question_bank_progress(learner_id, completed_at desc);

alter table public.gre_question_bank_progress enable row level security;
revoke all on public.gre_question_bank_progress from public, anon, authenticated;

-- Return only the signed-in learner's completed Question Bank item IDs.
create or replace function public.get_gre_question_bank_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_ids jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in to view your Question Bank progress.';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(x.question_id) order by x.completed_at desc),
    '[]'::jsonb
  )
  into v_ids
  from (
    select question_id, completed_at
    from public.gre_question_bank_progress
    where learner_id = v_user_id
  ) x;

  return jsonb_build_object(
    'question_ids', v_ids,
    'completed_count', jsonb_array_length(v_ids)
  );
end;
$$;

-- Grade the learner's response and mark the question as done in one
-- authenticated server-side operation. A checked question counts as done
-- whether the answer is correct or incorrect.
create or replace function public.grade_gre_question_bank_item(
  p_question_id text,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_grade jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in to practise questions in the Question Bank.';
  end if;

  v_grade := public.grade_gre_quiz_question(p_question_id, p_response);

  if v_grade is null or v_grade ? 'error' then
    return coalesce(v_grade, jsonb_build_object('error','Question could not be graded.'));
  end if;

  insert into public.gre_question_bank_progress(learner_id, question_id)
  values (v_user_id, p_question_id)
  on conflict (learner_id, question_id) do nothing;

  return v_grade || jsonb_build_object('completed', true);
end;
$$;

revoke all on function public.get_gre_question_bank_progress() from public;
revoke all on function public.grade_gre_question_bank_item(text, jsonb) from public;
grant execute on function public.get_gre_question_bank_progress() to authenticated;
grant execute on function public.grade_gre_question_bank_item(text, jsonb) to authenticated;

-- Extend the learner dashboard with a Question Bank completion total.
create or replace function public.get_learner_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile jsonb;
  v_attempts jsonb;
  v_quiz_attempts jsonb;
  v_lesson_progress jsonb;
  v_total integer;
  v_completed integer;
  v_lessons_total integer;
  v_lessons_completed integer;
  v_quizzes_started integer;
  v_quizzes_completed integer;
  v_question_bank_completed integer;
begin
  if v_user_id is null then
    raise exception 'Please sign in to view your learner dashboard.';
  end if;

  select jsonb_build_object(
    'name',p.name,'email',p.email,'education',p.education,'age_range',p.age_range,
    'country',p.country,'academic_background',p.academic_background,
    'further_study',p.further_study,'further_study_field',p.further_study_field
  ) into v_profile
  from public.profiles p where p.id=v_user_id;

  if v_profile is null then
    raise exception 'Your learner profile is not available. Please contact support.';
  end if;

  select count(*)::integer,count(*) filter(where status='completed')::integer
  into v_total,v_completed
  from public.gre_mock_attempts where learner_id=v_user_id;

  select count(*)::integer into v_lessons_total
  from public.lessons where published=true;

  select count(*)::integer into v_lessons_completed
  from public.gre_lesson_progress lp
  join public.lessons l on l.id=lp.lesson_id and l.published=true
  where lp.learner_id=v_user_id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.completed_at desc),'[]'::jsonb)
  into v_lesson_progress
  from (
    select lp.lesson_id,lp.completed_at,l.title
    from public.gre_lesson_progress lp
    join public.lessons l on l.id=lp.lesson_id and l.published=true
    where lp.learner_id=v_user_id
    order by lp.completed_at desc
  ) x;

  select count(*)::integer,
    count(*) filter(where status='completed')::integer
  into v_quizzes_started,v_quizzes_completed
  from public.gre_topic_quiz_attempts
  where learner_id=v_user_id;

  select count(*)::integer into v_question_bank_completed
  from public.gre_question_bank_progress
  where learner_id=v_user_id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  into v_quiz_attempts
  from (
    select id,session_token,status,topic_keys,timing_mode,question_count,total_correct,
      created_at,completed_at,deadline_at,current_position
    from public.gre_topic_quiz_attempts
    where learner_id=v_user_id
    order by created_at desc
    limit 30
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  into v_attempts
  from (
    select id,status,created_at,completed_at,scaled_score,total_correct,route,section1_correct
    from public.gre_mock_attempts
    where learner_id=v_user_id
    order by created_at desc
    limit 20
  ) x;

  return jsonb_build_object(
    'profile',v_profile,
    'mocks_started',coalesce(v_total,0),
    'mocks_completed',coalesce(v_completed,0),
    'recent_attempts',coalesce(v_attempts,'[]'::jsonb),
    'lessons_total',coalesce(v_lessons_total,0),
    'lessons_completed',coalesce(v_lessons_completed,0),
    'lesson_progress',coalesce(v_lesson_progress,'[]'::jsonb),
    'quizzes_started',coalesce(v_quizzes_started,0),
    'quizzes_completed',coalesce(v_quizzes_completed,0),
    'topic_quiz_attempts',coalesce(v_quiz_attempts,'[]'::jsonb),
    'question_bank_completed',coalesce(v_question_bank_completed,0)
  );
end;
$$;

-- Preserve the existing best-mock-score ranking. Topic quiz and completed
-- Question Bank counts provide additional participation tie-breakers.
create or replace function public.get_public_leaderboard(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
select coalesce(jsonb_agg(to_jsonb(r) order by r.rank),'[]'::jsonb)
from (
  select
    row_number() over (
      order by max(a.scaled_score) desc nulls last,
        count(distinct q.id) desc,
        count(distinct b.question_id) desc,
        count(distinct a.id) desc
    )::integer as rank,
    split_part(coalesce(nullif(trim(p.name),''),'Learner'),' ',1) as first_name,
    max(a.scaled_score)::integer as best_score,
    count(distinct a.id)::integer as mocks_completed,
    count(distinct q.id)::integer as quizzes_completed,
    count(distinct b.question_id)::integer as question_bank_completed
  from public.profiles p
  left join public.gre_mock_attempts a
    on a.learner_id=p.id and a.status='completed'
  left join public.gre_topic_quiz_attempts q
    on q.learner_id=p.id and q.status='completed'
  left join public.gre_question_bank_progress b
    on b.learner_id=p.id
  where p.role='learner'
    and p.leaderboard_opt_in=true
    and (a.id is not null or q.id is not null or b.question_id is not null)
  group by p.id,p.name
  order by max(a.scaled_score) desc nulls last,
    count(distinct q.id) desc,
    count(distinct b.question_id) desc,
    count(distinct a.id) desc
  limit greatest(1,least(coalesce(p_limit,50),100))
) r;
$$;

-- Explicit function permissions remain opt-in for authenticated learners.
revoke all on function public.get_learner_dashboard() from public;
revoke all on function public.get_public_leaderboard(integer) from public;
grant execute on function public.get_learner_dashboard() to authenticated;
grant execute on function public.get_public_leaderboard(integer) to anon, authenticated;

notify pgrst, 'reload schema';
