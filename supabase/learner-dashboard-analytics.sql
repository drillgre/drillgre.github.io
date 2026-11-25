-- DrillGRE Quant learner analytics.
-- Run after question-bank-diagnostics.sql, quiz-progress.sql, and learner-accounts.sql.
-- Read-only analytics over existing learner-owned records. Does not alter Question Bank or Mock engines.

create or replace function public.get_learner_quant_analytics()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in to view your Quant performance.';
  end if;

  with events as (
    -- Latest saved Question Bank result for each learner-question pair.
    select
      coalesce(q.topic_category, 'other') as topic,
      coalesce(q.subtopic, 'unclassified') as subtopic,
      coalesce(q.difficulty, p.difficulty) as difficulty,
      coalesce(p.last_attempt_correct, p.status = 'done') as is_correct,
      p.completed_at as occurred_at,
      'Question Bank'::text as source
    from public.gre_question_bank_progress p
    left join public.questions q on q.id::text = p.question_id
    where p.learner_id = v_user_id
      and (p.last_attempt_correct is not null or p.first_attempt_correct is not null)

    union all

    -- Submitted answers from completed topic quizzes and Superquizzes.
    select
      coalesce(aq.question_snapshot->>'topic_category','other'),
      coalesce(aq.question_snapshot->>'subtopic','unclassified'),
      nullif(aq.question_snapshot->>'difficulty','')::integer,
      a.is_correct,
      coalesce(a.updated_at, qa.completed_at),
      case when '__superquiz__' = any(coalesce(qa.topic_keys,'{}'::text[]))
        then 'Superquiz' else 'Topic quiz' end
    from public.gre_topic_quiz_attempts qa
    join public.gre_topic_quiz_attempt_questions aq on aq.attempt_id = qa.id
    join public.gre_topic_quiz_attempt_answers a
      on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
    where qa.learner_id = v_user_id
      and qa.status = 'completed'
      and a.response is not null
      and a.response <> 'null'::jsonb

    union all

    -- Submitted answers from completed adaptive mocks.
    select
      coalesce(ma.question_snapshot->>'topic_category','other'),
      coalesce(ma.question_snapshot->>'subtopic','unclassified'),
      nullif(ma.question_snapshot->>'difficulty','')::integer,
      ans.is_correct,
      coalesce(ma.completed_at, ma.created_at),
      'Mock test'::text
    from public.gre_mock_attempts ma
    join public.gre_mock_attempt_questions mq on mq.attempt_id = ma.id
    join public.gre_mock_attempt_answers ans
      on ans.attempt_id = mq.attempt_id and ans.question_id = mq.question_id
    where ma.learner_id = v_user_id
      and ma.status = 'completed'
  ),
  totals as (
    select count(*)::integer as answered,
      count(*) filter (where is_correct)::integer as correct
    from events
  ),
  topics as (
    select topic, sum(answered)::integer as answered,
      sum(correct)::integer as correct,
      round(100.0 * sum(correct) / nullif(sum(answered),0),1) as accuracy,
      jsonb_agg(jsonb_build_object(
        'subtopic',subtopic,
        'answered',answered,
        'correct',correct,
        'accuracy',accuracy
      ) order by subtopic) as subtopics
    from (
      select topic,subtopic,count(*)::integer as answered,
        count(*) filter (where is_correct)::integer as correct,
        round(100.0 * count(*) filter (where is_correct) / nullif(count(*),0),1) as accuracy
      from events
      group by topic,subtopic
    ) sub
    group by topic
  ),
  trend as (
    select date_trunc('week',occurred_at)::date as week_start,
      count(*)::integer as answered,
      count(*) filter (where is_correct)::integer as correct,
      round(100.0 * count(*) filter (where is_correct) / nullif(count(*),0),1) as accuracy
    from events
    where occurred_at >= now() - interval '16 weeks'
    group by 1
    order by 1
  ),
  sources as (
    select source,count(*)::integer as answered,
      count(*) filter (where is_correct)::integer as correct,
      round(100.0 * count(*) filter (where is_correct) / nullif(count(*),0),1) as accuracy
    from events group by source
  ),
  first_attempts as (
    select count(first_attempt_correct)::integer as recorded,
      count(*) filter (where first_attempt_correct is true)::integer as correct
    from public.gre_question_bank_progress
    where learner_id = v_user_id
  ),
  mocks as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date',completed_at,'score',scaled_score,'correct',total_correct
    ) order by completed_at), '[]'::jsonb) as scores
    from (
      select completed_at,scaled_score,total_correct
      from public.gre_mock_attempts
      where learner_id = v_user_id and status = 'completed'
      order by completed_at desc limit 12
    ) x
  )
  select jsonb_build_object(
    'answered',totals.answered,
    'correct',totals.correct,
    'accuracy',case when totals.answered > 0 then round(100.0*totals.correct/totals.answered,1) else null end,
    'question_bank_first_attempts',first_attempts.recorded,
    'question_bank_first_correct',first_attempts.correct,
    'question_bank_first_accuracy',case when first_attempts.recorded > 0 then round(100.0*first_attempts.correct/first_attempts.recorded,1) else null end,
    'topics',coalesce((select jsonb_agg(to_jsonb(t) order by t.topic) from topics t),'[]'::jsonb),
    'weekly',coalesce((select jsonb_agg(to_jsonb(w) order by w.week_start) from trend w),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.source) from sources s),'[]'::jsonb),
    'mock_scores',mocks.scores
  )
  into v_result
  from totals, first_attempts, mocks;

  return v_result;
end;
$$;

revoke all on function public.get_learner_quant_analytics() from public, anon;
grant execute on function public.get_learner_quant_analytics() to authenticated;

notify pgrst, 'reload schema';
