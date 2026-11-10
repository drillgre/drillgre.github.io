-- DrillGRE Question Bank: global attempt counts, learner bookmarks, and Superquiz.
-- Run after question-bank-public-count.sql.
--
-- Bookmarks are private to the learner. Aggregate attempt counts disclose only
-- the number of recorded attempts for published practice questions.
-- Superquiz uses the existing persistent topic-quiz attempt engine.

begin;

-- ============================================================
-- Learner bookmarks
-- ============================================================

create table if not exists public.gre_question_bank_bookmarks (
  learner_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (learner_id, question_id)
);

create index if not exists gre_question_bank_bookmarks_learner_created_idx
  on public.gre_question_bank_bookmarks(learner_id, created_at desc);

alter table public.gre_question_bank_bookmarks enable row level security;
revoke all on public.gre_question_bank_bookmarks from public, anon, authenticated;
grant select, insert, delete on public.gre_question_bank_bookmarks to authenticated;

drop policy if exists "Learners read own Question Bank bookmarks" on public.gre_question_bank_bookmarks;
create policy "Learners read own Question Bank bookmarks"
on public.gre_question_bank_bookmarks
for select to authenticated
using (learner_id = (select auth.uid()));

drop policy if exists "Learners bookmark published practice questions" on public.gre_question_bank_bookmarks;
create policy "Learners bookmark published practice questions"
on public.gre_question_bank_bookmarks
for insert to authenticated
with check (
  learner_id = (select auth.uid())
  and exists (
    select 1
    from public.questions q
    where q.id = question_id
      and q.published = true
      and q.question_usage in ('practice','both')
  )
);

drop policy if exists "Learners remove own Question Bank bookmarks" on public.gre_question_bank_bookmarks;
create policy "Learners remove own Question Bank bookmarks"
on public.gre_question_bank_bookmarks
for delete to authenticated
using (learner_id = (select auth.uid()));

-- ============================================================
-- Question attempt ledger
-- ============================================================

create table if not exists public.gre_question_bank_attempt_log (
  id bigint generated always as identity primary key,
  learner_id uuid references auth.users(id) on delete set null,
  question_id uuid not null references public.questions(id) on delete cascade,
  quiz_attempt_id uuid references public.gre_topic_quiz_attempts(id) on delete set null,
  source text not null check (source in ('question_bank','topic_quiz','superquiz')),
  is_correct boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists gre_question_bank_attempt_log_question_idx
  on public.gre_question_bank_attempt_log(question_id, attempted_at desc);
create index if not exists gre_question_bank_attempt_log_learner_idx
  on public.gre_question_bank_attempt_log(learner_id, attempted_at desc);
create unique index if not exists gre_question_bank_attempt_log_quiz_question_uidx
  on public.gre_question_bank_attempt_log(quiz_attempt_id, question_id)
  where quiz_attempt_id is not null;

alter table public.gre_question_bank_attempt_log enable row level security;
revoke all on public.gre_question_bank_attempt_log from public, anon, authenticated;

-- Return aggregate attempt totals for the requested published questions.
-- The caller receives no learner IDs, response data, or correctness details.
create or replace function public.get_gre_question_bank_attempt_counts(
  p_question_ids text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_counts jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view Question Bank attempt statistics.';
  end if;
  if coalesce(cardinality(p_question_ids),0) > 500 then
    raise exception 'Request no more than 500 question attempt counts at once.';
  end if;

  select coalesce(jsonb_object_agg(x.question_id,x.total_attempts),'{}'::jsonb)
  into v_counts
  from (
    select
      requested.question_id,
      count(log.id)::integer as total_attempts
    from (select distinct unnest(coalesce(p_question_ids,'{}'::text[])) as question_id) requested
    join public.questions q
      on q.id::text = requested.question_id
      and q.published = true
      and q.question_usage in ('practice','both')
    left join public.gre_question_bank_attempt_log log
      on log.question_id = q.id
    group by requested.question_id
  ) x;

  return coalesce(v_counts,'{}'::jsonb);
end;
$$;

revoke all on function public.get_gre_question_bank_attempt_counts(text[]) from public, anon;
grant execute on function public.get_gre_question_bank_attempt_counts(text[]) to authenticated;

-- ============================================================
-- Question Bank grading: log every submitted attempt
-- ============================================================

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
  v_total_attempts integer;
begin
  if v_user_id is null then
    raise exception 'Sign in to practise questions in the Question Bank.';
  end if;

  v_grade := public.grade_gre_quiz_question(p_question_id,p_response);

  if v_grade is null or v_grade ? 'error' then
    return coalesce(v_grade,jsonb_build_object('error','Question could not be graded.'));
  end if;
  if not (v_grade ? 'correct') then
    return jsonb_build_object('error','The grading service did not return a correctness result.');
  end if;

  v_correct := coalesce((v_grade->>'correct')::boolean,false);
  v_status := case when v_correct then 'done' else 'review' end;

  select q.difficulty into v_difficulty
  from public.questions q
  where q.id::text = p_question_id
    and q.published = true
    and q.question_usage in ('practice','both');

  if not found then
    return jsonb_build_object('error','Question is no longer available for practice.');
  end if;

  insert into public.gre_question_bank_attempt_log(
    learner_id,question_id,source,is_correct
  )
  values (v_user_id,p_question_id::uuid,'question_bank',v_correct);

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
  returning status,attempts_count into v_status,v_attempt_count;

  select count(*)::integer into v_total_attempts
  from public.gre_question_bank_attempt_log
  where question_id = p_question_id::uuid;

  return v_grade || jsonb_build_object(
    'completed',v_status = 'done',
    'status',v_status,
    'attempt_count',v_attempt_count,
    'total_attempts',coalesce(v_total_attempts,0)
  );
end;
$$;

revoke all on function public.grade_gre_question_bank_item(text,jsonb) from public, anon;
grant execute on function public.grade_gre_question_bank_item(text,jsonb) to authenticated;

-- ============================================================
-- Log responses submitted in the existing topic quiz engine.
-- Each question is counted once per completed quiz attempt.
-- ============================================================

create or replace function public.log_completed_topic_quiz_question_attempts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_source text;
begin
  if old.status <> 'completed' and new.status = 'completed' then
    v_source := case
      when '__superquiz__' = any(coalesce(new.topic_keys,'{}'::text[])) then 'superquiz'
      else 'topic_quiz'
    end;

    insert into public.gre_question_bank_attempt_log(
      learner_id,question_id,quiz_attempt_id,source,is_correct
    )
    select
      new.learner_id,
      aq.question_id::uuid,
      new.id,
      v_source,
      coalesce(answer.is_correct,false)
    from public.gre_topic_quiz_attempt_questions aq
    join public.gre_topic_quiz_attempt_answers answer
      on answer.attempt_id = aq.attempt_id
      and answer.question_id = aq.question_id
    where aq.attempt_id = new.id
      and answer.response is not null
      and answer.response <> 'null'::jsonb
      and answer.response <> '""'::jsonb
      and answer.response <> '[]'::jsonb
    on conflict (quiz_attempt_id,question_id)
      where quiz_attempt_id is not null
      do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.log_completed_topic_quiz_question_attempts() from public, anon, authenticated;

drop trigger if exists gre_topic_quiz_log_question_attempts on public.gre_topic_quiz_attempts;
create trigger gre_topic_quiz_log_question_attempts
after update of status on public.gre_topic_quiz_attempts
for each row
when (old.status = 'in_progress' and new.status = 'completed')
execute function public.log_completed_topic_quiz_question_attempts();

-- ============================================================
-- Extend the existing topic quiz engine for bookmarked Superquiz sets.
-- Ordinary topic quizzes keep their original 10-15 question rule.
-- A Superquiz is signed-in only and contains 1-50 of the learner's own
-- currently bookmarked, published practice questions.
-- ============================================================

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.gre_topic_quiz_attempts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%question_count%'
  loop
    execute format(
      'alter table public.gre_topic_quiz_attempts drop constraint %I',
      v_constraint.conname
    );
  end loop;
end
$$;

alter table public.gre_topic_quiz_attempts
  add constraint gre_topic_quiz_attempts_question_count_range
  check (question_count between 1 and 50);

create or replace function public.start_gre_topic_quiz(
  p_session_token text,
  p_visitor_key text,
  p_question_ids text[],
  p_topic_keys text[],
  p_timing_mode text,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt_id uuid;
  v_question_count integer;
  v_questions jsonb;
  v_guest_count integer := 0;
  v_is_superquiz boolean := '__superquiz__' = any(coalesce(p_topic_keys,'{}'::text[]));
begin
  if p_session_token is null or length(p_session_token) < 32 then
    raise exception 'A valid quiz session token is required.';
  end if;

  if p_question_ids is null or cardinality(p_question_ids) not between 1 and 50 then
    raise exception 'A quiz must contain between 1 and 50 questions.';
  end if;

  if v_is_superquiz then
    if v_user_id is null then
      raise exception 'Sign in to start your Superquiz.';
    end if;
    if cardinality(p_topic_keys) <> 1 then
      raise exception 'Invalid Superquiz configuration.';
    end if;
  else
    if cardinality(p_question_ids) not between 10 and 15 then
      raise exception 'A topic quiz must contain between 10 and 15 questions.';
    end if;
    if cardinality(p_topic_keys) is null or cardinality(p_topic_keys) = 0 then
      raise exception 'Select at least one topic or subtopic.';
    end if;
  end if;

  if cardinality(p_question_ids) <> (
    select count(distinct x) from unnest(p_question_ids) as t(x)
  ) then
    raise exception 'A quiz cannot contain duplicate questions.';
  end if;

  if p_timing_mode not in ('standard','time_and_half','double','untimed') then
    raise exception 'Invalid quiz timing option.';
  end if;
  if p_timing_mode = 'untimed' then
    if p_duration_seconds is not null then
      raise exception 'Untimed practice cannot have a duration.';
    end if;
  elsif p_duration_seconds is null or p_duration_seconds < 60 or p_duration_seconds > 7200 then
    raise exception 'The quiz duration is invalid.';
  end if;

  if v_user_id is null then
    if p_visitor_key is null or length(p_visitor_key) < 32 then
      raise exception 'A valid guest browser key is required. Refresh the page and try again.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_visitor_key || ':topic-quiz',0));
    select count(*)::integer into v_guest_count
    from public.gre_topic_quiz_attempts
    where visitor_key = p_visitor_key;

    if v_guest_count >= 2 then
      raise exception 'You have used both free topic quiz attempts on this browser. Sign in for unlimited quizzes.';
    end if;
  end if;

  if v_is_superquiz then
    select count(*)::integer into v_question_count
    from public.questions q
    join public.gre_question_bank_bookmarks b
      on b.question_id = q.id and b.learner_id = v_user_id
    where q.id::text = any(p_question_ids)
      and q.published = true
      and q.question_usage in ('practice','both');
  else
    select count(*)::integer into v_question_count
    from public.questions q
    where q.id::text = any(p_question_ids)
      and q.published = true
      and q.question_usage in ('practice','both')
      and coalesce(q.topic_category,'arithmetic') || '::' || coalesce(q.subtopic,'arithmetic_other') = any(p_topic_keys);
  end if;

  if v_question_count <> cardinality(p_question_ids) then
    raise exception 'Some selected questions are no longer available or are not in your bookmarks. Refresh and rebuild your quiz.';
  end if;

  insert into public.gre_topic_quiz_attempts(
    session_token,learner_id,visitor_key,topic_keys,timing_mode,
    question_count,duration_seconds,deadline_at
  )
  values (
    p_session_token,
    v_user_id,
    case when v_user_id is null then p_visitor_key else null end,
    p_topic_keys,
    p_timing_mode,
    cardinality(p_question_ids),
    p_duration_seconds,
    case when p_duration_seconds is null then null else now() + make_interval(secs => p_duration_seconds) end
  )
  returning id into v_attempt_id;

  insert into public.gre_topic_quiz_attempt_questions(
    attempt_id,question_id,position,question_snapshot
  )
  select
    v_attempt_id,q.id::text,
    array_position(p_question_ids,q.id::text)::smallint,
    to_jsonb(q)
  from public.questions q
  where q.id::text = any(p_question_ids)
  order by array_position(p_question_ids,q.id::text);

  select coalesce(jsonb_agg(
    question_snapshot - 'correct_answer' - 'explanation' - 'explanation_type' - 'explanation_video_url'
    order by position
  ),'[]'::jsonb)
  into v_questions
  from public.gre_topic_quiz_attempt_questions
  where attempt_id = v_attempt_id;

  return jsonb_build_object(
    'attempt_id',v_attempt_id,
    'session_token',p_session_token,
    'status','in_progress',
    'question_count',cardinality(p_question_ids),
    'timing_mode',p_timing_mode,
    'started_at',now(),
    'deadline_at',case when p_duration_seconds is null then null else now() + make_interval(secs => p_duration_seconds) end,
    'questions',coalesce(v_questions,'[]'::jsonb),
    'guest_quizzes_used',case when v_user_id is null then v_guest_count + 1 else null end,
    'guest_quizzes_remaining',case when v_user_id is null then greatest(0,1-v_guest_count) else null end
  );
end;
$$;

revoke all on function public.start_gre_topic_quiz(text,text,text[],text[],text,integer) from public;
grant execute on function public.start_gre_topic_quiz(text,text,text[],text[],text,integer) to anon,authenticated;

notify pgrst, 'reload schema';

