-- DrillGRE Question Bank correctness status and learner diagnostics.
-- Run after question-bank-progress.sql.
--
-- Legacy Question Bank rows were recorded whenever an answer was submitted,
-- regardless of correctness. They are conservatively changed to Review because
-- their original answer correctness cannot be reconstructed.

alter table public.gre_question_bank_progress
  add column if not exists status text not null default 'review',
  add column if not exists difficulty integer,
  add column if not exists attempts_count integer not null default 1,
  add column if not exists first_attempt_correct boolean,
  add column if not exists last_attempt_correct boolean;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gre_question_bank_progress_status_check'
      and conrelid = 'public.gre_question_bank_progress'::regclass
  ) then
    alter table public.gre_question_bank_progress
      add constraint gre_question_bank_progress_status_check
      check (status in ('done','review'));
  end if;
end
$migration$;

update public.gre_question_bank_progress p
set difficulty = q.difficulty
from public.questions q
where p.question_id = q.id::text
  and p.difficulty is null;

create index if not exists gre_question_bank_progress_learner_status_idx
  on public.gre_question_bank_progress(learner_id, status);

create index if not exists gre_question_bank_progress_learner_difficulty_idx
  on public.gre_question_bank_progress(learner_id, difficulty);

-- Return statuses for the signed-in learner. Only correctly answered items
-- count as completed; incorrect answers remain in Review.
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
  v_statuses jsonb;
  v_completed integer;
  v_attempted integer;
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
    where learner_id = v_user_id and status = 'done'
  ) x;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'question_id',p.question_id,
      'status',p.status,
      'difficulty',p.difficulty,
      'attempts_count',p.attempts_count,
      'first_attempt_correct',p.first_attempt_correct
    ) order by p.completed_at desc),
    '[]'::jsonb
  )
  into v_statuses
  from public.gre_question_bank_progress p
  where p.learner_id = v_user_id;

  select count(*)::integer,
    count(*) filter (where status = 'done')::integer
  into v_attempted,v_completed
  from public.gre_question_bank_progress
  where learner_id = v_user_id;

  return jsonb_build_object(
    'question_ids',v_ids,
    'question_statuses',v_statuses,
    'completed_count',coalesce(v_completed,0),
    'attempted_count',coalesce(v_attempted,0)
  );
end;
$$;

-- Grade every submission and retain the first-attempt result for diagnostics.
-- The visible status follows the latest submitted answer: Done if correct,
-- Review if incorrect.
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
  v_correct boolean;
  v_difficulty integer;
  v_status text;
  v_attempt_count integer;
begin
  if v_user_id is null then
    raise exception 'Sign in to practise questions in the Question Bank.';
  end if;

  v_grade := public.grade_gre_quiz_question(p_question_id, p_response);

  if v_grade is null or v_grade ? 'error' then
    return coalesce(v_grade, jsonb_build_object('error','Question could not be graded.'));
  end if;

  if not (v_grade ? 'correct') then
    return jsonb_build_object('error','The grading service did not return a correctness result.');
  end if;

  v_correct := coalesce((v_grade->>'correct')::boolean,false);
  v_status := case when v_correct then 'done' else 'review' end;

  select q.difficulty into v_difficulty
  from public.questions q
  where q.id::text = p_question_id;

  insert into public.gre_question_bank_progress as saved_progress(
    learner_id,question_id,completed_at,status,difficulty,attempts_count,
    first_attempt_correct,last_attempt_correct
  )
  values (
    v_user_id,p_question_id,now(),v_status,v_difficulty,1,
    v_correct,v_correct
  )
  on conflict (learner_id,question_id) do update
  set completed_at = excluded.completed_at,
      status = excluded.status,
      difficulty = coalesce(saved_progress.difficulty,excluded.difficulty),
      attempts_count = saved_progress.attempts_count + 1,
      last_attempt_correct = excluded.last_attempt_correct
  returning status,attempts_count
  into v_status,v_attempt_count;

  return v_grade || jsonb_build_object(
    'completed',v_status = 'done',
    'status',v_status,
    'attempt_count',v_attempt_count
  );
end;
$$;

-- Provide per-difficulty question counts and first-attempt success rates.
create or replace function public.get_gre_question_bank_diagnostics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_total_attempted integer;
  v_total_completed integer;
  v_first_attempts integer;
  v_first_correct integer;
  v_overall_rate numeric;
  v_by_difficulty jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in to view your Question Bank diagnostics.';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'done')::integer,
    count(first_attempt_correct)::integer,
    count(*) filter (where first_attempt_correct is true)::integer
  into v_total_attempted,v_total_completed,v_first_attempts,v_first_correct
  from public.gre_question_bank_progress
  where learner_id = v_user_id;

  v_overall_rate := case
    when coalesce(v_first_attempts,0) > 0
      then round(100.0 * v_first_correct / v_first_attempts,1)
    else null
  end;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'difficulty',x.difficulty,
      'questions_attempted',x.questions_attempted,
      'first_attempts_recorded',x.first_attempts_recorded,
      'first_attempt_correct',x.first_attempt_correct,
      'first_attempt_success_rate',case
        when x.first_attempts_recorded > 0
          then round(100.0 * x.first_attempt_correct / x.first_attempts_recorded,1)
        else null
      end
    ) order by x.difficulty),
    '[]'::jsonb
  )
  into v_by_difficulty
  from (
    select
      levels.difficulty,
      count(p.question_id)::integer as questions_attempted,
      count(p.first_attempt_correct)::integer as first_attempts_recorded,
      count(*) filter (where p.first_attempt_correct is true)::integer as first_attempt_correct
    from generate_series(1,5) as levels(difficulty)
    left join public.gre_question_bank_progress p
      on p.learner_id = v_user_id
      and p.difficulty = levels.difficulty
    group by levels.difficulty
  ) x;

  return jsonb_build_object(
    'total_attempted',coalesce(v_total_attempted,0),
    'total_completed',coalesce(v_total_completed,0),
    'total_first_attempts_recorded',coalesce(v_first_attempts,0),
    'total_first_attempt_correct',coalesce(v_first_correct,0),
    'total_first_attempt_success_rate',v_overall_rate,
    'by_difficulty',v_by_difficulty
  );
end;
$$;

-- Ensure dashboard and leaderboard completion counts include correctly
-- answered Question Bank items only.
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
  where learner_id=v_user_id and status='done';

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
    on b.learner_id=p.id and b.status='done'
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

revoke all on function public.get_gre_question_bank_progress() from public;
revoke all on function public.grade_gre_question_bank_item(text,jsonb) from public;
revoke all on function public.get_gre_question_bank_diagnostics() from public;
revoke all on function public.get_learner_dashboard() from public;
revoke all on function public.get_public_leaderboard(integer) from public;

grant execute on function public.get_gre_question_bank_progress() to authenticated;
grant execute on function public.grade_gre_question_bank_item(text,jsonb) to authenticated;
grant execute on function public.get_gre_question_bank_diagnostics() to authenticated;
grant execute on function public.get_learner_dashboard() to authenticated;
grant execute on function public.get_public_leaderboard(integer) to anon,authenticated;

notify pgrst, 'reload schema';
