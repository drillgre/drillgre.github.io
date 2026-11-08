-- DrillGRE adaptive Quant mock tests
-- Run this complete script in Supabase SQL Editor.
--
-- Section 1: 12 questions (D1:2, D2:3, D3:4, D4:3)
-- Section 2 if Section 1 >= 8 correct: D3:5, D4:5, D5:5
-- Section 2 if Section 1 < 8 correct: D1:3, D2:5, D3:5, D4:2
--
-- Scoring:
-- Correct answers earn difficulty-weighted points (D1=1 ... D5=5).
-- Incorrect and unanswered answers earn zero. No negative marks.
-- Scaled score = 130 + 40 * (weighted points earned / weighted points available).
-- This is an initial DrillGRE scale, not an ETS-calibrated GRE score.

create table if not exists public.gre_mock_attempts (
  id uuid primary key default gen_random_uuid(),
  session_token text not null,
  status text not null default 'section1'
    check (status in ('section1','section2','completed')),
  section1_correct integer,
  route text check (route in ('harder','easier')),
  total_correct integer,
  weighted_points numeric(10,2),
  max_weighted_points numeric(10,2),
  scaled_score integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists gre_mock_attempts_session_token_uidx
  on public.gre_mock_attempts(session_token);

create table if not exists public.gre_mock_attempt_questions (
  attempt_id uuid not null references public.gre_mock_attempts(id) on delete cascade,
  question_id text not null,
  section_number smallint not null check (section_number in (1,2)),
  position smallint not null,
  question_snapshot jsonb not null,
  primary key (attempt_id, question_id),
  unique (attempt_id, section_number, position)
);

create table if not exists public.gre_mock_attempt_answers (
  attempt_id uuid not null references public.gre_mock_attempts(id) on delete cascade,
  question_id text not null,
  response jsonb,
  is_correct boolean not null default false,
  primary key (attempt_id, question_id)
);

alter table public.gre_mock_attempts enable row level security;
alter table public.gre_mock_attempt_questions enable row level security;
alter table public.gre_mock_attempt_answers enable row level security;

revoke all on public.gre_mock_attempts from anon, authenticated;
revoke all on public.gre_mock_attempt_questions from anon, authenticated;
revoke all on public.gre_mock_attempt_answers from anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.gre_mock_answer_is_correct(
  p_question jsonb,
  p_response jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_type text := p_question ->> 'question_type';
  v_correct jsonb := p_question -> 'correct_answer';
  v_expected numeric;
  v_entered numeric;
  v_tolerance numeric := 0;
  v_expected_choices text[];
  v_response_choices text[];
begin
  if p_response is null or p_response = 'null'::jsonb then
    return false;
  end if;

  if v_type = 'numeric_entry' then
    begin
      if jsonb_typeof(v_correct) = 'object' then
        v_expected := (v_correct ->> 'value')::numeric;
        v_tolerance := coalesce((v_correct ->> 'tolerance')::numeric, 0);
      else
        v_expected := (v_correct #>> '{}')::numeric;
      end if;
      v_entered := (p_response #>> '{}')::numeric;
      return abs(v_entered - v_expected) <= v_tolerance;
    exception when others then
      return false;
    end;
  elsif v_type = 'multiple_choice_multiple' then
    if jsonb_typeof(v_correct) <> 'array' or jsonb_typeof(p_response) <> 'array' then
      return false;
    end if;

    select coalesce(array_agg(value order by value), array[]::text[])
      into v_expected_choices
    from jsonb_array_elements_text(v_correct) as t(value);

    select coalesce(array_agg(value order by value), array[]::text[])
      into v_response_choices
    from jsonb_array_elements_text(p_response) as t(value);

    return v_response_choices = v_expected_choices;
  else
    return upper(trim(coalesce(p_response #>> '{}',''))) =
           upper(trim(coalesce(v_correct #>> '{}','')));
  end if;
end;
$$;

revoke all on function private.gre_mock_answer_is_correct(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.start_gre_mock(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_attempt_id uuid;
  v_distribution record;
  v_question record;
  v_available integer;
  v_position integer := 0;
  v_questions jsonb;
begin
  if p_session_token is null or length(p_session_token) < 32 then
    raise exception 'A valid mock-test session token is required.';
  end if;

  insert into public.gre_mock_attempts(session_token, status)
  values (p_session_token, 'section1')
  returning id into v_attempt_id;

  for v_distribution in
    select * from (values (1,2),(2,3),(3,4),(4,3)) as d(difficulty, question_count)
  loop
    select count(*) into v_available
    from public.questions q
    where q.published = true and q.difficulty = v_distribution.difficulty;

    if v_available < v_distribution.question_count then
      raise exception 'Not enough published questions at difficulty level %. Need %, available %.',
        v_distribution.difficulty, v_distribution.question_count, v_available;
    end if;

    for v_question in
      select q.* from public.questions q
      where q.published = true and q.difficulty = v_distribution.difficulty
      order by random()
      limit v_distribution.question_count
    loop
      v_position := v_position + 1;
      insert into public.gre_mock_attempt_questions(
        attempt_id, question_id, section_number, position, question_snapshot
      )
      values (
        v_attempt_id, v_question.id::text, 1, v_position,
        jsonb_build_object(
          'id', v_question.id::text,
          'topic', v_question.topic,
          'question_type', v_question.question_type,
          'difficulty', v_question.difficulty,
          'question_text', v_question.question_text,
          'options', v_question.options,
          'figure_url', v_question.figure_url,
          'correct_answer', v_question.correct_answer,
          'explanation', v_question.explanation,
          'explanation_type', v_question.explanation_type,
          'explanation_video_url', v_question.explanation_video_url
        )
      );
    end loop;
  end loop;

  select jsonb_agg(
    question_snapshot - 'correct_answer' - 'explanation' - 'explanation_type' - 'explanation_video_url'
    order by position
  ) into v_questions
  from public.gre_mock_attempt_questions
  where attempt_id = v_attempt_id and section_number = 1;

  return jsonb_build_object(
    'attempt_id', v_attempt_id, 'status', 'section1', 'section_number', 1,
    'question_count', 12, 'questions', coalesce(v_questions, '[]'::jsonb)
  );
end;
$$;

create or replace function public.resume_gre_mock(
  p_attempt_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_attempt public.gre_mock_attempts%rowtype;
  v_section integer;
  v_questions jsonb;
begin
  select * into v_attempt
  from public.gre_mock_attempts
  where id = p_attempt_id and session_token = p_session_token;

  if not found then
    raise exception 'Mock test not found for this browser session.';
  end if;

  if v_attempt.status = 'completed' then
    return jsonb_build_object(
      'attempt_id', v_attempt.id, 'status', 'completed',
      'scaled_score', v_attempt.scaled_score, 'total_correct', v_attempt.total_correct,
      'weighted_points', v_attempt.weighted_points,
      'max_weighted_points', v_attempt.max_weighted_points, 'route', v_attempt.route
    );
  end if;

  v_section := case when v_attempt.status = 'section1' then 1 else 2 end;

  select jsonb_agg(
    question_snapshot - 'correct_answer' - 'explanation' - 'explanation_type' - 'explanation_video_url'
    order by position
  ) into v_questions
  from public.gre_mock_attempt_questions
  where attempt_id = v_attempt.id and section_number = v_section;

  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'status', v_attempt.status,
    'section_number', v_section, 'section1_correct', v_attempt.section1_correct,
    'route', v_attempt.route,
    'question_count', jsonb_array_length(coalesce(v_questions, '[]'::jsonb)),
    'questions', coalesce(v_questions, '[]'::jsonb)
  );
end;
$$;

create or replace function public.submit_gre_mock_section1(
  p_attempt_id uuid,
  p_session_token text,
  p_responses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_attempt public.gre_mock_attempts%rowtype;
  v_item record;
  v_response jsonb;
  v_is_correct boolean;
  v_correct_count integer := 0;
  v_route text;
  v_distribution record;
  v_question record;
  v_available integer;
  v_position integer := 0;
  v_questions jsonb;
begin
  select * into v_attempt
  from public.gre_mock_attempts
  where id = p_attempt_id and session_token = p_session_token and status = 'section1'
  for update;

  if not found then
    raise exception 'Section 1 is not available for this mock attempt.';
  end if;

  if p_responses is not null and jsonb_typeof(p_responses) <> 'array' then
    raise exception 'Responses must be supplied as a JSON array.';
  end if;

  for v_item in
    select * from public.gre_mock_attempt_questions
    where attempt_id = p_attempt_id and section_number = 1 order by position
  loop
    v_response := null;
    select item -> 'response' into v_response
    from jsonb_array_elements(coalesce(p_responses,'[]'::jsonb)) as t(item)
    where item ->> 'question_id' = v_item.question_id
    limit 1;

    v_is_correct := private.gre_mock_answer_is_correct(v_item.question_snapshot, v_response);

    insert into public.gre_mock_attempt_answers(attempt_id, question_id, response, is_correct)
    values (p_attempt_id, v_item.question_id, v_response, v_is_correct)
    on conflict (attempt_id, question_id)
    do update set response = excluded.response, is_correct = excluded.is_correct;

    if v_is_correct then v_correct_count := v_correct_count + 1; end if;
  end loop;

  v_route := case when v_correct_count >= 8 then 'harder' else 'easier' end;

  if v_route = 'harder' then
    for v_distribution in
      select * from (values (3,5),(4,5),(5,5)) as d(difficulty, question_count)
    loop
      select count(*) into v_available
      from public.questions q
      where q.published = true and q.difficulty = v_distribution.difficulty
        and not exists (
          select 1 from public.gre_mock_attempt_questions aq
          where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
        );

      if v_available < v_distribution.question_count then
        raise exception 'Not enough unused published questions at difficulty level %. Need %, available %.',
          v_distribution.difficulty, v_distribution.question_count, v_available;
      end if;

      for v_question in
        select q.* from public.questions q
        where q.published = true and q.difficulty = v_distribution.difficulty
          and not exists (
            select 1 from public.gre_mock_attempt_questions aq
            where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
          )
        order by random()
        limit v_distribution.question_count
      loop
        v_position := v_position + 1;
        insert into public.gre_mock_attempt_questions(
          attempt_id, question_id, section_number, position, question_snapshot
        )
        values (
          p_attempt_id, v_question.id::text, 2, v_position,
          jsonb_build_object(
            'id', v_question.id::text, 'topic', v_question.topic,
            'question_type', v_question.question_type, 'difficulty', v_question.difficulty,
            'question_text', v_question.question_text, 'options', v_question.options,
            'figure_url', v_question.figure_url, 'correct_answer', v_question.correct_answer,
            'explanation', v_question.explanation, 'explanation_type', v_question.explanation_type,
            'explanation_video_url', v_question.explanation_video_url
          )
        );
      end loop;
    end loop;
  else
    for v_distribution in
      select * from (values (1,3),(2,5),(3,5),(4,2)) as d(difficulty, question_count)
    loop
      select count(*) into v_available
      from public.questions q
      where q.published = true and q.difficulty = v_distribution.difficulty
        and not exists (
          select 1 from public.gre_mock_attempt_questions aq
          where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
        );

      if v_available < v_distribution.question_count then
        raise exception 'Not enough unused published questions at difficulty level %. Need %, available %.',
          v_distribution.difficulty, v_distribution.question_count, v_available;
      end if;

      for v_question in
        select q.* from public.questions q
        where q.published = true and q.difficulty = v_distribution.difficulty
          and not exists (
            select 1 from public.gre_mock_attempt_questions aq
            where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
          )
        order by random()
        limit v_distribution.question_count
      loop
        v_position := v_position + 1;
        insert into public.gre_mock_attempt_questions(
          attempt_id, question_id, section_number, position, question_snapshot
        )
        values (
          p_attempt_id, v_question.id::text, 2, v_position,
          jsonb_build_object(
            'id', v_question.id::text, 'topic', v_question.topic,
            'question_type', v_question.question_type, 'difficulty', v_question.difficulty,
            'question_text', v_question.question_text, 'options', v_question.options,
            'figure_url', v_question.figure_url, 'correct_answer', v_question.correct_answer,
            'explanation', v_question.explanation, 'explanation_type', v_question.explanation_type,
            'explanation_video_url', v_question.explanation_video_url
          )
        );
      end loop;
    end loop;
  end if;

  update public.gre_mock_attempts
  set status = 'section2', section1_correct = v_correct_count, route = v_route
  where id = p_attempt_id;

  select jsonb_agg(
    question_snapshot - 'correct_answer' - 'explanation' - 'explanation_type' - 'explanation_video_url'
    order by position
  ) into v_questions
  from public.gre_mock_attempt_questions
  where attempt_id = p_attempt_id and section_number = 2;

  return jsonb_build_object(
    'attempt_id', p_attempt_id, 'status', 'section2', 'section_number', 2,
    'section1_correct', v_correct_count, 'route', v_route,
    'question_count', 15, 'questions', coalesce(v_questions, '[]'::jsonb)
  );
end;
$$;

create or replace function public.finish_gre_mock(
  p_attempt_id uuid,
  p_session_token text,
  p_responses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_attempt public.gre_mock_attempts%rowtype;
  v_item record;
  v_response jsonb;
  v_is_correct boolean;
  v_total_correct integer;
  v_section2_correct integer;
  v_weighted_points numeric(10,2);
  v_max_points numeric(10,2);
  v_scaled_score integer;
  v_review jsonb;
begin
  select * into v_attempt
  from public.gre_mock_attempts
  where id = p_attempt_id and session_token = p_session_token and status = 'section2'
  for update;

  if not found then
    raise exception 'Section 2 is not available for this mock attempt.';
  end if;

  if p_responses is not null and jsonb_typeof(p_responses) <> 'array' then
    raise exception 'Responses must be supplied as a JSON array.';
  end if;

  for v_item in
    select * from public.gre_mock_attempt_questions
    where attempt_id = p_attempt_id and section_number = 2 order by position
  loop
    v_response := null;
    select item -> 'response' into v_response
    from jsonb_array_elements(coalesce(p_responses,'[]'::jsonb)) as t(item)
    where item ->> 'question_id' = v_item.question_id
    limit 1;

    v_is_correct := private.gre_mock_answer_is_correct(v_item.question_snapshot, v_response);

    insert into public.gre_mock_attempt_answers(attempt_id, question_id, response, is_correct)
    values (p_attempt_id, v_item.question_id, v_response, v_is_correct)
    on conflict (attempt_id, question_id)
    do update set response = excluded.response, is_correct = excluded.is_correct;
  end loop;

  select
    count(*) filter (where a.is_correct),
    coalesce(sum(case when a.is_correct then (aq.question_snapshot ->> 'difficulty')::numeric else 0 end),0),
    coalesce(sum((aq.question_snapshot ->> 'difficulty')::numeric),0)
  into v_total_correct, v_weighted_points, v_max_points
  from public.gre_mock_attempt_questions aq
  left join public.gre_mock_attempt_answers a
    on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
  where aq.attempt_id = p_attempt_id;

  select count(*) filter (where a.is_correct)
  into v_section2_correct
  from public.gre_mock_attempt_questions aq
  left join public.gre_mock_attempt_answers a
    on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
  where aq.attempt_id = p_attempt_id and aq.section_number = 2;

  v_scaled_score := case
    when v_max_points <= 0 then 130
    else greatest(130, least(170, round(130 + 40 * v_weighted_points / v_max_points)::integer))
  end;

  select jsonb_agg(
    jsonb_build_object(
      'section_number', aq.section_number,
      'position', aq.position,
      'question', aq.question_snapshot - 'correct_answer' - 'explanation' - 'explanation_type' - 'explanation_video_url',
      'response', a.response,
      'is_correct', coalesce(a.is_correct,false),
      'correct_answer', aq.question_snapshot -> 'correct_answer',
      'explanation', aq.question_snapshot -> 'explanation',
      'explanation_type', coalesce(aq.question_snapshot ->> 'explanation_type','text'),
      'explanation_video_url', aq.question_snapshot -> 'explanation_video_url'
    )
    order by aq.section_number, aq.position
  ) into v_review
  from public.gre_mock_attempt_questions aq
  left join public.gre_mock_attempt_answers a
    on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
  where aq.attempt_id = p_attempt_id;

  update public.gre_mock_attempts
  set status = 'completed', total_correct = v_total_correct,
      weighted_points = v_weighted_points, max_weighted_points = v_max_points,
      scaled_score = v_scaled_score, completed_at = now()
  where id = p_attempt_id;

  return jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', 'completed',
    'route', v_attempt.route,
    'section1_correct', v_attempt.section1_correct,
    'section2_correct', v_section2_correct,
    'total_correct', v_total_correct,
    'total_questions', 27,
    'weighted_points', v_weighted_points,
    'max_weighted_points', v_max_points,
    'weighted_accuracy', case when v_max_points > 0 then round(100 * v_weighted_points / v_max_points,2) else 0 end,
    'scaled_score', v_scaled_score,
    'review', coalesce(v_review,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.start_gre_mock(text) from public;
revoke all on function public.resume_gre_mock(uuid, text) from public;
revoke all on function public.submit_gre_mock_section1(uuid, text, jsonb) from public;
revoke all on function public.finish_gre_mock(uuid, text, jsonb) from public;

grant execute on function public.start_gre_mock(text) to anon, authenticated;
grant execute on function public.resume_gre_mock(uuid, text) to anon, authenticated;
grant execute on function public.submit_gre_mock_section1(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.finish_gre_mock(uuid, text, jsonb) to anon, authenticated;

-- Attempts and their answer keys remain inaccessible through direct table queries.
