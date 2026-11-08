-- DrillGRE learner access and answer-checking setup
-- Run this entire script after gre-mock-tests.sql has created question_stimuli.
--
-- It grants public read access only to published course material.
-- Anonymous learners can read question prompts and options, but not answers
-- or explanations before they submit a response.

drop policy if exists "Public can read modules with published lessons" on public.modules;
create policy "Public can read modules with published lessons"
on public.modules
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.lessons
    where lessons.module_id = modules.id
      and lessons.published = true
  )
);

drop policy if exists "Public can read published lessons" on public.lessons;
create policy "Public can read published lessons"
on public.lessons
for select
to anon, authenticated
using (published = true);

drop policy if exists "Public can read published questions" on public.questions;
create policy "Public can read published questions"
on public.questions
for select
to anon, authenticated
using (
  (published = true and question_usage in ('practice','both'))
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

-- Restrict the anonymous role to question prompt fields only.
revoke select on public.questions from anon, authenticated, public;
grant select (
  id,
  lesson_id,
  topic,
  question_type,
  difficulty,
  question_text,
  options,
  figure_url,
  topic_category,
  subtopic,
  stimulus_id,
  question_usage,
  published,
  created_at
) on public.questions to anon, authenticated;
-- Learners and admins receive prompt-only columns. Admin question editing
-- obtains answer keys through the role-checked admin_get_question RPC below.

-- Read only stimulus groups associated with published lesson questions.
grant select on public.question_stimuli to anon, authenticated;
drop policy if exists "Public can read stimuli for published lessons" on public.question_stimuli;
create policy "Public can read stimuli for published lessons"
on public.question_stimuli
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.questions q
    join public.lessons l on l.id = q.lesson_id
    where q.stimulus_id = question_stimuli.id
      and q.published = true
      and q.question_usage in ('practice','both')
      and l.published = true
  )
);

-- Grade answers inside PostgreSQL. The answer and explanation are returned
-- only after the learner submits a response.
drop function if exists public.grade_gre_question(uuid, jsonb);

create or replace function public.grade_gre_question(
  p_question_id text,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_correct jsonb;
  v_explanation text;
  v_explanation_type text;
  v_explanation_video_url text;
  v_is_correct boolean := false;
  v_expected numeric;
  v_entered numeric;
  v_tolerance numeric := 0;
  v_expected_choices text[];
  v_response_choices text[];
begin
  select
    q.question_type,
    q.correct_answer,
    q.explanation,
    q.explanation_type,
    q.explanation_video_url
  into
    v_type,
    v_correct,
    v_explanation,
    v_explanation_type,
    v_explanation_video_url
  from public.questions q
  join public.lessons l on l.id = q.lesson_id
  where q.id::text = p_question_id
    and q.published = true
    and q.question_usage in ('practice','both')
    and l.published = true;

  if not found then
    return jsonb_build_object('error', 'Question not found or not published');
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
      v_is_correct := abs(v_entered - v_expected) <= v_tolerance;
    exception when others then
      v_is_correct := false;
    end;

  elsif v_type = 'multiple_choice_multiple' then
    select coalesce(array_agg(value order by value), array[]::text[])
      into v_expected_choices
    from jsonb_array_elements_text(v_correct) as t(value);

    if jsonb_typeof(p_response) = 'array' then
      select coalesce(array_agg(value order by value), array[]::text[])
        into v_response_choices
      from jsonb_array_elements_text(p_response) as t(value);
      v_is_correct := v_response_choices = v_expected_choices;
    else
      v_is_correct := false;
    end if;

  else
    v_is_correct :=
      upper(trim(coalesce(p_response #>> '{}', ''))) =
      upper(trim(coalesce(v_correct #>> '{}', '')));
  end if;

  return jsonb_build_object(
    'correct', v_is_correct,
    'correct_answer', v_correct,
    'explanation', v_explanation,
    'explanation_type', coalesce(v_explanation_type, 'text'),
    'explanation_video_url', v_explanation_video_url
  );
end;
$$;

revoke all on function public.grade_gre_question(text, jsonb) from public;
grant execute on function public.grade_gre_question(text, jsonb) to anon, authenticated;

-- Full question records, including correct answers, are available only to admins.
create or replace function public.admin_get_question(p_question_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $
declare
  v_question jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Administrator access is required to view question answers.';
  end if;

  select to_jsonb(q) into v_question
  from public.questions q
  where q.id::text = p_question_id;

  if v_question is null then
    raise exception 'Question not found.';
  end if;

  return v_question;
end;
$;

revoke all on function public.admin_get_question(text) from public;
grant execute on function public.admin_get_question(text) to authenticated;

-- Security note:
-- This RPC protects answer and explanation columns from ordinary anonymous
-- SELECT requests. It is adequate for lesson practice. Timed mock answer keys remain server-side in the mock attempt snapshots. For timed mock exams,
-- add per-user attempt records, server-side timing, and attempt limits.
