-- DrillGRE persistent topic quizzes, lesson progress, guest quota, and profile/leaderboard rollups.
-- Run AFTER:
--   1. gre-mock-tests.sql
--   2. learner-accounts.sql
--   3. learner-read-policies.sql
--   4. topic-quiz.sql
--
-- Guest users may create two topic quiz attempts per browser visitor key.
-- Starting a quiz consumes an attempt, including an unfinished quiz. A learner
-- who signs in receives unlimited topic quiz attempts and can claim guest history.

create table if not exists public.gre_topic_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  session_token text not null unique,
  learner_id uuid references auth.users(id) on delete set null,
  visitor_key text,
  status text not null default 'in_progress'
    check (status in ('in_progress','completed')),
  topic_keys text[] not null default '{}',
  timing_mode text not null default 'standard'
    check (timing_mode in ('standard','time_and_half','double','untimed')),
  question_count integer not null check (question_count between 10 and 15),
  duration_seconds integer,
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  current_position integer not null default 0,
  flagged_question_ids text[] not null default '{}',
  total_correct integer,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gre_topic_quiz_owner_check
    check (learner_id is not null or visitor_key is not null)
);

create index if not exists gre_topic_quiz_learner_created_idx
  on public.gre_topic_quiz_attempts(learner_id, created_at desc);
create index if not exists gre_topic_quiz_visitor_created_idx
  on public.gre_topic_quiz_attempts(visitor_key, created_at desc);

create table if not exists public.gre_topic_quiz_attempt_questions (
  attempt_id uuid not null references public.gre_topic_quiz_attempts(id) on delete cascade,
  question_id text not null,
  position smallint not null,
  question_snapshot jsonb not null,
  primary key (attempt_id, question_id),
  unique (attempt_id, position)
);

create table if not exists public.gre_topic_quiz_attempt_answers (
  attempt_id uuid not null,
  question_id text not null,
  response jsonb,
  is_correct boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id),
  foreign key (attempt_id, question_id)
    references public.gre_topic_quiz_attempt_questions(attempt_id, question_id)
    on delete cascade
);

create table if not exists public.gre_lesson_progress (
  learner_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (learner_id, lesson_id)
);

alter table public.gre_topic_quiz_attempts enable row level security;
alter table public.gre_topic_quiz_attempt_questions enable row level security;
alter table public.gre_topic_quiz_attempt_answers enable row level security;
alter table public.gre_lesson_progress enable row level security;

revoke all on public.gre_topic_quiz_attempts from public, anon, authenticated;
revoke all on public.gre_topic_quiz_attempt_questions from public, anon, authenticated;
revoke all on public.gre_topic_quiz_attempt_answers from public, anon, authenticated;
revoke all on public.gre_lesson_progress from public, anon, authenticated;

-- Create a quiz attempt and store immutable question snapshots server-side.
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
begin
  if p_session_token is null or length(p_session_token) < 32 then
    raise exception 'A valid quiz session token is required.';
  end if;
  if p_question_ids is null or cardinality(p_question_ids) not between 10 and 15 then
    raise exception 'A topic quiz must contain between 10 and 15 questions.';
  end if;
  if cardinality(p_topic_keys) is null or cardinality(p_topic_keys) = 0 then
    raise exception 'Select at least one topic or subtopic.';
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

    perform pg_advisory_xact_lock(hashtextextended(p_visitor_key || ':topic-quiz', 0));
    select count(*)::integer into v_guest_count
    from public.gre_topic_quiz_attempts
    where visitor_key = p_visitor_key;

    if v_guest_count >= 2 then
      raise exception 'You have used both free topic quiz attempts on this browser. Sign in for unlimited quizzes.';
    end if;
  end if;

  select count(*)::integer into v_question_count
  from public.questions q
  where q.id::text = any(p_question_ids)
    and q.published = true
    and q.question_usage in ('practice','both')
    and coalesce(q.topic_category,'arithmetic') || '::' || coalesce(q.subtopic,'arithmetic_other') = any(p_topic_keys);

  if v_question_count <> cardinality(p_question_ids) then
    raise exception 'Some selected questions are no longer available for practice. Please rebuild your quiz.';
  end if;

  insert into public.gre_topic_quiz_attempts(
    session_token, learner_id, visitor_key, topic_keys, timing_mode,
    question_count, duration_seconds, deadline_at
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

  insert into public.gre_topic_quiz_attempt_questions(attempt_id, question_id, position, question_snapshot)
  select v_attempt_id, q.id::text, array_position(p_question_ids,q.id::text)::smallint, to_jsonb(q)
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

-- Return a resumable attempt and its saved answers to the owner only.
create or replace function public.get_gre_topic_quiz_attempt(
  p_attempt_id uuid,
  p_session_token text,
  p_visitor_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.gre_topic_quiz_attempts%rowtype;
  v_questions jsonb;
  v_responses jsonb;
  v_review jsonb;
begin
  select * into v_attempt
  from public.gre_topic_quiz_attempts a
  where a.id = p_attempt_id
    and a.session_token = p_session_token
    and (
      (a.learner_id is not null and a.learner_id = auth.uid())
      or (a.learner_id is null and auth.uid() is null and a.visitor_key = p_visitor_key)
    );

  if not found then
    raise exception 'Quiz attempt not found for this learner or browser session.';
  end if;

  select coalesce(jsonb_agg(
    question_snapshot - 'correct_answer' - 'explanation' - 'explanation_type' - 'explanation_video_url'
    order by position
  ),'[]'::jsonb)
  into v_questions
  from public.gre_topic_quiz_attempt_questions
  where attempt_id = v_attempt.id;

  select coalesce(jsonb_object_agg(question_id,response),'{}'::jsonb)
  into v_responses
  from public.gre_topic_quiz_attempt_answers
  where attempt_id = v_attempt.id;

  if v_attempt.status = 'completed' then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'position',aq.position,
        'question',aq.question_snapshot - 'correct_answer' - 'explanation' - 'explanation_type' - 'explanation_video_url',
        'response',a.response,
        'is_correct',coalesce(a.is_correct,false),
        'correct_answer',aq.question_snapshot -> 'correct_answer',
        'explanation',aq.question_snapshot -> 'explanation',
        'explanation_type',coalesce(aq.question_snapshot ->> 'explanation_type','text'),
        'explanation_video_url',aq.question_snapshot -> 'explanation_video_url'
      ) order by aq.position
    ),'[]'::jsonb)
    into v_review
    from public.gre_topic_quiz_attempt_questions aq
    left join public.gre_topic_quiz_attempt_answers a
      on a.attempt_id=aq.attempt_id and a.question_id=aq.question_id
    where aq.attempt_id=v_attempt.id;
  end if;

  return jsonb_build_object(
    'attempt_id',v_attempt.id,
    'session_token',v_attempt.session_token,
    'status',v_attempt.status,
    'topic_keys',to_jsonb(v_attempt.topic_keys),
    'timing_mode',v_attempt.timing_mode,
    'question_count',v_attempt.question_count,
    'duration_seconds',v_attempt.duration_seconds,
    'total_correct',v_attempt.total_correct,
    'started_at',v_attempt.started_at,
    'deadline_at',v_attempt.deadline_at,
    'current_position',v_attempt.current_position,
    'flagged_question_ids',to_jsonb(v_attempt.flagged_question_ids),
    'responses',coalesce(v_responses,'{}'::jsonb),
    'questions',coalesce(v_questions,'[]'::jsonb),
    'review',case when v_attempt.status='completed' then coalesce(v_review,'[]'::jsonb) else null end
  );
end;
$$;


-- Save all learner responses and navigation state. This is called as the learner
-- moves between questions and periodically while an answer is being edited.
create or replace function public.save_gre_topic_quiz_progress(
  p_attempt_id uuid,
  p_session_token text,
  p_visitor_key text,
  p_responses jsonb,
  p_flagged_question_ids text[],
  p_current_position integer
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_attempt public.gre_topic_quiz_attempts%rowtype;
  v_item record;
  v_response jsonb;
  v_question_count integer := 0;
begin
  select * into v_attempt
  from public.gre_topic_quiz_attempts a
  where a.id = p_attempt_id
    and a.session_token = p_session_token
    and a.status = 'in_progress'
    and (
      (a.learner_id is not null and a.learner_id = auth.uid())
      or (a.learner_id is null and auth.uid() is null and a.visitor_key = p_visitor_key)
    )
  for update;

  if not found then raise exception 'This quiz attempt is not available for editing.'; end if;
  if v_attempt.deadline_at is not null and v_attempt.deadline_at <= now() then
    raise exception 'The quiz time has expired. Submit the quiz to see your result.';
  end if;
  if p_responses is null or jsonb_typeof(p_responses) <> 'array' then
    raise exception 'Quiz responses must be supplied as an array.';
  end if;

  for v_item in select * from jsonb_array_elements(p_responses) as t(item)
  loop
    v_response := v_item.item -> 'response';
    if not exists (
      select 1 from public.gre_topic_quiz_attempt_questions aq
      where aq.attempt_id = v_attempt.id and aq.question_id = v_item.item ->> 'question_id'
    ) then
      raise exception 'A submitted response does not belong to this quiz.';
    end if;

    insert into public.gre_topic_quiz_attempt_answers(attempt_id,question_id,response,is_correct,updated_at)
    select v_attempt.id, aq.question_id, v_response,
      private.gre_mock_answer_is_correct(aq.question_snapshot,v_response), now()
    from public.gre_topic_quiz_attempt_questions aq
    where aq.attempt_id = v_attempt.id and aq.question_id = v_item.item ->> 'question_id'
    on conflict (attempt_id,question_id)
    do update set response=excluded.response,is_correct=excluded.is_correct,updated_at=now();

    v_question_count := v_question_count + 1;
  end loop;

  if v_question_count <> v_attempt.question_count then
    raise exception 'A complete response state is required to save quiz progress.';
  end if;

  update public.gre_topic_quiz_attempts
  set flagged_question_ids = coalesce(p_flagged_question_ids,'{}'),
      current_position = greatest(0,least(v_attempt.question_count - 1,coalesce(p_current_position,0)))
  where id = v_attempt.id;

  return true;
end;
$$;

-- Finish and grade a quiz using server-side snapshots and answers.
create or replace function public.finish_gre_topic_quiz(
  p_attempt_id uuid,
  p_session_token text,
  p_visitor_key text,
  p_responses jsonb,
  p_flagged_question_ids text[],
  p_current_position integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_attempt public.gre_topic_quiz_attempts%rowtype;
  v_item record;
  v_response jsonb;
  v_correct integer := 0;
  v_review jsonb;
begin
  select * into v_attempt
  from public.gre_topic_quiz_attempts a
  where a.id = p_attempt_id
    and a.session_token = p_session_token
    and a.status = 'in_progress'
    and (
      (a.learner_id is not null and a.learner_id = auth.uid())
      or (a.learner_id is null and auth.uid() is null and a.visitor_key = p_visitor_key)
    )
  for update;

  if not found then raise exception 'This quiz attempt is not available for submission.'; end if;
  if p_responses is null or jsonb_typeof(p_responses) <> 'array' then
    raise exception 'Quiz responses must be supplied as an array.';
  end if;

  for v_item in
    select * from public.gre_topic_quiz_attempt_questions
    where attempt_id = v_attempt.id order by position
  loop
    v_response := null;
    select item -> 'response' into v_response
    from jsonb_array_elements(p_responses) as t(item)
    where item ->> 'question_id' = v_item.question_id
    limit 1;

    insert into public.gre_topic_quiz_attempt_answers(attempt_id,question_id,response,is_correct,updated_at)
    values (
      v_attempt.id, v_item.question_id, v_response,
      private.gre_mock_answer_is_correct(v_item.question_snapshot,v_response), now()
    )
    on conflict (attempt_id,question_id)
    do update set response=excluded.response,is_correct=excluded.is_correct,updated_at=now();
  end loop;

  select count(*) filter (where a.is_correct)::integer
  into v_correct
  from public.gre_topic_quiz_attempt_answers a
  where a.attempt_id = v_attempt.id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'position',aq.position,
      'question',aq.question_snapshot - 'correct_answer' - 'explanation' - 'explanation_type' - 'explanation_video_url',
      'response',a.response,
      'is_correct',coalesce(a.is_correct,false),
      'correct_answer',aq.question_snapshot -> 'correct_answer',
      'explanation',aq.question_snapshot -> 'explanation',
      'explanation_type',coalesce(aq.question_snapshot ->> 'explanation_type','text'),
      'explanation_video_url',aq.question_snapshot -> 'explanation_video_url'
    ) order by aq.position
  ),'[]'::jsonb)
  into v_review
  from public.gre_topic_quiz_attempt_questions aq
  left join public.gre_topic_quiz_attempt_answers a
    on a.attempt_id=aq.attempt_id and a.question_id=aq.question_id
  where aq.attempt_id=v_attempt.id;

  update public.gre_topic_quiz_attempts
  set status='completed',
      total_correct=coalesce(v_correct,0),
      completed_at=now(),
      flagged_question_ids=coalesce(p_flagged_question_ids,'{}'),
      current_position=greatest(0,least(v_attempt.question_count - 1,coalesce(p_current_position,0)))
  where id=v_attempt.id;

  return jsonb_build_object(
    'attempt_id',v_attempt.id,
    'status','completed',
    'total_correct',coalesce(v_correct,0),
    'question_count',v_attempt.question_count,
    'completed_at',now(),
    'review',coalesce(v_review,'[]'::jsonb)
  );
end;
$$;

-- List attempts for the authenticated learner or a guest browser. Session tokens
-- are included only in this owner-scoped RPC response to enable safe resumption.
create or replace function public.get_gre_topic_quiz_history(p_visitor_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempts jsonb;
  v_used integer := 0;
begin
  if v_user_id is null then
    if p_visitor_key is null or length(p_visitor_key) < 32 then
      return jsonb_build_object('attempts','[]'::jsonb,'guest_quizzes_used',0,'guest_quizzes_remaining',2,'is_authenticated',false);
    end if;
    select count(*)::integer into v_used
    from public.gre_topic_quiz_attempts
    where visitor_key=p_visitor_key;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  into v_attempts
  from (
    select id,session_token,status,topic_keys,timing_mode,question_count,
      total_correct,created_at,completed_at,deadline_at,current_position
    from public.gre_topic_quiz_attempts
    where (
      (v_user_id is not null and learner_id=v_user_id)
      or (v_user_id is null and learner_id is null and visitor_key=p_visitor_key)
    )
    order by created_at desc
    limit 30
  ) x;

  return jsonb_build_object(
    'attempts',coalesce(v_attempts,'[]'::jsonb),
    'guest_quizzes_used',case when v_user_id is null then v_used else null end,
    'guest_quizzes_remaining',case when v_user_id is null then greatest(0,2-v_used) else null end,
    'is_authenticated',v_user_id is not null
  );
end;
$$;

create or replace function public.claim_guest_topic_quiz_attempts(p_visitor_key text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_claimed integer := 0;
begin
  if v_user_id is null then raise exception 'Please sign in before claiming guest quizzes.'; end if;
  if p_visitor_key is null or length(p_visitor_key) < 32 then return 0; end if;

  update public.gre_topic_quiz_attempts
  set learner_id=v_user_id
  where visitor_key=p_visitor_key;

  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

-- Lesson completion is stored per account, not only in the browser.
create or replace function public.set_gre_lesson_progress(
  p_lesson_id uuid,
  p_completed boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Sign in to save lesson progress across devices.'; end if;

  if coalesce(p_completed,false) then
    if not exists(select 1 from public.lessons where id=p_lesson_id and published=true) then
      raise exception 'Published lesson not found.';
    end if;
    insert into public.gre_lesson_progress(learner_id,lesson_id)
    values(v_user_id,p_lesson_id)
    on conflict(learner_id,lesson_id) do update set completed_at=now();
  else
    delete from public.gre_lesson_progress where learner_id=v_user_id and lesson_id=p_lesson_id;
  end if;
  return coalesce(p_completed,false);
end;
$$;

create or replace function public.get_gre_lesson_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_progress jsonb;
begin
  if v_user_id is null then raise exception 'Please sign in to view saved lesson progress.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.completed_at desc),'[]'::jsonb)
  into v_progress
  from (
    select lp.lesson_id,lp.completed_at
    from public.gre_lesson_progress lp
    join public.lessons l on l.id=lp.lesson_id and l.published=true
    where lp.learner_id=v_user_id
  ) x;
  return v_progress;
end;
$$;

-- Expand the learner dashboard payload with course progress and topic quiz history.
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
begin
  if v_user_id is null then raise exception 'Please sign in to view your learner dashboard.'; end if;

  select jsonb_build_object(
    'name',p.name,'email',p.email,'education',p.education,'age_range',p.age_range,
    'country',p.country,'academic_background',p.academic_background,
    'further_study',p.further_study,'further_study_field',p.further_study_field
  ) into v_profile
  from public.profiles p where p.id=v_user_id;

  if v_profile is null then raise exception 'Your learner profile is not available. Please contact support.'; end if;

  select count(*)::integer,count(*) filter(where status='completed')::integer
  into v_total,v_completed
  from public.gre_mock_attempts where learner_id=v_user_id;

  select count(*)::integer into v_lessons_total from public.lessons where published=true;
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
    'topic_quiz_attempts',coalesce(v_quiz_attempts,'[]'::jsonb)
  );
end;
$$;

-- Leaderboard ranking remains based on the mock score (130-170). Quiz activity
-- is added as a participation metric and tie-breaker, not converted into a
-- GRE-scaled mock score.
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
        count(distinct a.id) desc
    )::integer as rank,
    split_part(coalesce(nullif(trim(p.name),''),'Learner'),' ',1) as first_name,
    max(a.scaled_score)::integer as best_score,
    count(distinct a.id)::integer as mocks_completed,
    count(distinct q.id)::integer as quizzes_completed
  from public.profiles p
  left join public.gre_mock_attempts a
    on a.learner_id=p.id and a.status='completed'
  left join public.gre_topic_quiz_attempts q
    on q.learner_id=p.id and q.status='completed'
  where p.role='learner'
    and p.leaderboard_opt_in=true
    and (a.id is not null or q.id is not null)
  group by p.id,p.name
  order by max(a.scaled_score) desc nulls last,
    count(distinct q.id) desc,
    count(distinct a.id) desc
  limit greatest(1,least(coalesce(p_limit,50),100))
) r;
$$;

-- Explicit RPC access. Direct table access stays revoked.
revoke all on function public.start_gre_topic_quiz(text,text,text[],text[],text,integer) from public;
revoke all on function public.get_gre_topic_quiz_attempt(uuid,text,text) from public;
revoke all on function public.save_gre_topic_quiz_progress(uuid,text,text,jsonb,text[],integer) from public;
revoke all on function public.finish_gre_topic_quiz(uuid,text,text,jsonb,text[],integer) from public;
revoke all on function public.get_gre_topic_quiz_history(text) from public;
revoke all on function public.claim_guest_topic_quiz_attempts(text) from public;
revoke all on function public.set_gre_lesson_progress(uuid,boolean) from public;
revoke all on function public.get_gre_lesson_progress() from public;
revoke all on function public.get_learner_dashboard() from public;
revoke all on function public.get_public_leaderboard(integer) from public;

grant execute on function public.start_gre_topic_quiz(text,text,text[],text[],text,integer) to anon,authenticated;
grant execute on function public.get_gre_topic_quiz_attempt(uuid,text,text) to anon,authenticated;
grant execute on function public.save_gre_topic_quiz_progress(uuid,text,text,jsonb,text[],integer) to anon,authenticated;
grant execute on function public.finish_gre_topic_quiz(uuid,text,text,jsonb,text[],integer) to anon,authenticated;
grant execute on function public.get_gre_topic_quiz_history(text) to anon,authenticated;
grant execute on function public.claim_guest_topic_quiz_attempts(text) to authenticated;
grant execute on function public.set_gre_lesson_progress(uuid,boolean) to authenticated;
grant execute on function public.get_gre_lesson_progress() to authenticated;
grant execute on function public.get_learner_dashboard() to authenticated;
grant execute on function public.get_public_leaderboard(integer) to anon,authenticated;

notify pgrst,'reload schema';
