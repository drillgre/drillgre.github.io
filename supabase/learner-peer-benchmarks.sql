-- DrillGRE learner study-time and anonymous peer benchmarking.
-- Run in Supabase SQL Editor after:
-- question-bank-diagnostics.sql, quiz-progress.sql, gre-mock-tests.sql,
-- learner-accounts.sql, and learner-dashboard-analytics.sql.
--
-- Peer cohort: learners with at least one completed mock OR at least 10
-- recorded scored answers across mocks, quizzes, and Question Bank.
-- Individual identities and raw peer records are never returned.

create or replace function public.get_learner_peer_benchmarks()
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
    raise exception 'Sign in to view learner benchmarks.';
  end if;

  with registered as (
    select count(*)::integer as total
    from public.profiles
    where role = 'learner'
  ),
  answer_events as (
    select ma.learner_id, ans.is_correct,
      greatest(0,least(coalesce(ans.time_spent_seconds,0),3600))::integer as seconds
    from public.gre_mock_attempts ma
    join public.gre_mock_attempt_questions mq on mq.attempt_id = ma.id
    join public.gre_mock_attempt_answers ans
      on ans.attempt_id = mq.attempt_id and ans.question_id = mq.question_id
    where ma.status = 'completed' and ma.learner_id is not null

    union all

    select qa.learner_id, ans.is_correct, 0::integer
    from public.gre_topic_quiz_attempts qa
    join public.gre_topic_quiz_attempt_questions q
      on q.attempt_id = qa.id
    join public.gre_topic_quiz_attempt_answers ans
      on ans.attempt_id = q.attempt_id and ans.question_id = q.question_id
    where qa.status = 'completed' and qa.learner_id is not null
      and ans.response is not null and ans.response <> 'null'::jsonb

    union all

    select p.learner_id, p.first_attempt_correct, 0::integer
    from public.gre_question_bank_progress p
    where p.learner_id is not null and p.first_attempt_correct is not null
  ),
  answer_rollup as (
    select learner_id, count(*)::integer as scored_answers,
      round(100.0 * count(*) filter(where is_correct) / nullif(count(*),0),1) as accuracy,
      avg(nullif(seconds,0)) filter(where seconds > 0) as avg_seconds
    from answer_events
    group by learner_id
  ),
  mock_rollup as (
    select learner_id,
      max(scaled_score)::numeric as best_mock_score,
      count(*) filter(where status='completed')::integer as completed_mocks,
      coalesce(sum((
        select coalesce(sum(greatest(0,least(coalesce(a.time_spent_seconds,0),3600))),0)
        from public.gre_mock_attempt_questions mq
        join public.gre_mock_attempt_answers a
          on a.attempt_id=mq.attempt_id and a.question_id=mq.question_id
        where mq.attempt_id=ma.id
      )),0)::bigint as mock_seconds
    from public.gre_mock_attempts ma
    where learner_id is not null
    group by learner_id
  ),
  quiz_rollup as (
    select learner_id,
      coalesce(sum(least(greatest(extract(epoch from (completed_at-started_at))::bigint,0),7200)),0)::bigint as quiz_seconds
    from public.gre_topic_quiz_attempts
    where learner_id is not null and status='completed'
      and completed_at is not null and started_at is not null
    group by learner_id
  ),
  bank_rollup as (
    select learner_id,
      coalesce(sum(greatest(0,least(coalesce(total_time_spent_seconds,0),3600))),0)::bigint as bank_seconds
    from public.gre_question_bank_progress
    group by learner_id
  ),
  learner_metrics as (
    select p.id as learner_id,
      coalesce(ar.scored_answers,0) as scored_answers,
      ar.accuracy,
      case when ar.avg_seconds > 0 then 60.0/ar.avg_seconds end as questions_per_minute,
      mr.best_mock_score,
      coalesce(mr.completed_mocks,0) as completed_mocks,
      (coalesce(mr.mock_seconds,0)+coalesce(qr.quiz_seconds,0)+coalesce(br.bank_seconds,0))::numeric/3600 as study_hours
    from public.profiles p
    left join answer_rollup ar on ar.learner_id=p.id
    left join mock_rollup mr on mr.learner_id=p.id
    left join quiz_rollup qr on qr.learner_id=p.id
    left join bank_rollup br on br.learner_id=p.id
    where p.role='learner'
  ),
  cohort as (
    select * from learner_metrics
    where completed_mocks > 0 or scored_answers >= 10
  ),
  distribution as (
    select count(*)::integer as cohort_size,
      percentile_cont(0.50) within group(order by accuracy) filter(where accuracy is not null) as accuracy_p50,
      percentile_cont(0.75) within group(order by accuracy) filter(where accuracy is not null) as accuracy_p75,
      percentile_cont(0.50) within group(order by questions_per_minute) filter(where questions_per_minute is not null) as speed_p50,
      percentile_cont(0.75) within group(order by questions_per_minute) filter(where questions_per_minute is not null) as speed_p75,
      percentile_cont(0.50) within group(order by best_mock_score) filter(where best_mock_score is not null) as score_p50,
      percentile_cont(0.75) within group(order by best_mock_score) filter(where best_mock_score is not null) as score_p75,
      percentile_cont(0.50) within group(order by study_hours) as hours_p50,
      percentile_cont(0.75) within group(order by study_hours) as hours_p75
    from cohort
  ),
  me as (
    select * from learner_metrics where learner_id=v_user_id
  ),
  ranks as (
    select
      (select count(*) from cohort c,me where c.accuracy <= me.accuracy)::numeric
        / nullif((select count(*) from cohort c where c.accuracy is not null),0)*100 as accuracy_percentile,
      (select count(*) from cohort c,me where c.questions_per_minute <= me.questions_per_minute)::numeric
        / nullif((select count(*) from cohort c where c.questions_per_minute is not null),0)*100 as speed_percentile,
      (select count(*) from cohort c,me where c.best_mock_score <= me.best_mock_score)::numeric
        / nullif((select count(*) from cohort c where c.best_mock_score is not null),0)*100 as score_percentile,
      (select count(*) from cohort c,me where c.study_hours <= me.study_hours)::numeric
        / nullif((select count(*) from cohort),0)*100 as hours_percentile
  )
  select jsonb_build_object(
    'registered_learners',(select total from registered),
    'active_learners',d.cohort_size,
    'minimum_cohort_size',10,
    'cohort_sufficient',d.cohort_size >= 10,
    'eligibility_rule','At least one completed mock or 10 scored answers',
    'my_metrics',jsonb_build_object(
      'scored_answers',me.scored_answers,
      'accuracy',me.accuracy,
      'questions_per_minute',round(me.questions_per_minute::numeric,2),
      'best_mock_score',me.best_mock_score,
      'recorded_study_hours',round(me.study_hours,2)
    ),
    'percentiles',jsonb_build_object(
      'accuracy',case when d.cohort_size>=10 then round(r.accuracy_percentile,1) end,
      'speed',case when d.cohort_size>=10 then round(r.speed_percentile,1) end,
      'best_mock_score',case when d.cohort_size>=10 then round(r.score_percentile,1) end,
      'study_hours',case when d.cohort_size>=10 then round(r.hours_percentile,1) end
    ),
    'benchmarks',jsonb_build_object(
      'accuracy_p50',round(d.accuracy_p50::numeric,1),'accuracy_p75',round(d.accuracy_p75::numeric,1),
      'speed_p50',round(d.speed_p50::numeric,2),'speed_p75',round(d.speed_p75::numeric,2),
      'score_p50',round(d.score_p50::numeric,1),'score_p75',round(d.score_p75::numeric,1),
      'hours_p50',round(d.hours_p50::numeric,2),'hours_p75',round(d.hours_p75::numeric,2)
    )
  ) into v_result
  from distribution d cross join me cross join ranks r;

  return coalesce(v_result,'{}'::jsonb);
end;
$$;

revoke all on function public.get_learner_peer_benchmarks() from public, anon;
grant execute on function public.get_learner_peer_benchmarks() to authenticated;
notify pgrst, 'reload schema';
