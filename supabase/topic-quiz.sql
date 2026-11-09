-- DrillGRE topic and subtopic quiz support
-- Run this after gre-mock-tests.sql, learner-accounts.sql, and learner-read-policies.sql.
--
-- Topic quizzes use published questions marked "practice" or "both".
-- The browser receives question prompts and choices only. This SECURITY DEFINER
-- function checks each submitted response and returns the answer and explanation
-- only after the learner submits the quiz.

-- Shared Data Interpretation stimulus groups must also be available for published
-- practice questions that are not attached to a published course lesson.
drop policy if exists "Public can read stimuli for published lessons" on public.question_stimuli;
drop policy if exists "Public can read stimuli for published practice questions" on public.question_stimuli;

create policy "Public can read stimuli for published practice questions"
on public.question_stimuli
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.questions q
    where q.stimulus_id = question_stimuli.id
      and q.published = true
      and q.question_usage in ('practice','both')
  )
);

create or replace function public.grade_gre_quiz_question(
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
  where q.id::text = p_question_id
    and q.published = true
    and q.question_usage in ('practice','both');

  if not found then
    return jsonb_build_object('error', 'Question not found or not available for practice.');
  end if;

  if p_response is null or p_response = 'null'::jsonb then
    v_is_correct := false;

  elsif v_type = 'numeric_entry' then
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
    if jsonb_typeof(v_correct) = 'array' and jsonb_typeof(p_response) = 'array' then
      select coalesce(array_agg(value order by value), array[]::text[])
        into v_expected_choices
      from jsonb_array_elements_text(v_correct) as t(value);

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

revoke all on function public.grade_gre_quiz_question(text, jsonb) from public;
grant execute on function public.grade_gre_quiz_question(text, jsonb) to anon, authenticated;
