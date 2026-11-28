-- DrillGRE learner-owned Mistake Notebook.
-- Run after learner-dashboard-analytics.sql and the Question Bank, quiz, and mock migrations.
-- Reuses immutable question snapshots and existing answer records. Assessment engines are unchanged.

create table if not exists public.gre_learner_mistake_notes (
  learner_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  note text not null default '',
  reason text check (reason in ('conceptual_misunderstanding','calculation_error','misread_question','time_management','incorrect_strategy','careless_error','other')),
  status text not null default 'review'
    check (status in ('review','mastered')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (learner_id, question_id)
);

alter table public.gre_learner_mistake_notes
  add column if not exists reason text
  check (reason in ('conceptual_misunderstanding','calculation_error','misread_question','time_management','incorrect_strategy','careless_error','other'));

alter table public.gre_learner_mistake_notes enable row level security;
revoke all on public.gre_learner_mistake_notes from public, anon, authenticated;
grant select, insert, update on public.gre_learner_mistake_notes to authenticated;

drop policy if exists "Learners manage their own mistake notes" on public.gre_learner_mistake_notes;
create policy "Learners manage their own mistake notes"
on public.gre_learner_mistake_notes
for all to authenticated
using (learner_id = (select auth.uid()))
with check (learner_id = (select auth.uid()));

create or replace function public.get_learner_mistake_notebook()
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
    raise exception 'Sign in to view your Mistake Notebook.';
  end if;

  with mistakes as (
    -- Latest incorrect Question Bank result for each question.
    select p.question_id,
      p.completed_at as occurred_at,
      'Question Bank'::text as source,
      to_jsonb(q) as snapshot,
      row_number() over (
        partition by p.question_id order by p.completed_at desc
      ) as rn
    from public.gre_question_bank_progress p
    join public.questions q on q.id::text = p.question_id
    where p.learner_id = v_user_id
      and (p.last_attempt_correct = false or p.first_attempt_correct = false)

    union all

    -- Incorrect submitted answers from completed quizzes and Superquizzes.
    select aq.question_id,
      coalesce(a.updated_at,qa.completed_at),
      case when '__superquiz__' = any(coalesce(qa.topic_keys,'{}'::text[]))
        then 'Superquiz' else 'Topic quiz' end,
      aq.question_snapshot,
      row_number() over (
        partition by aq.question_id order by coalesce(a.updated_at,qa.completed_at) desc
      )
    from public.gre_topic_quiz_attempts qa
    join public.gre_topic_quiz_attempt_questions aq on aq.attempt_id = qa.id
    join public.gre_topic_quiz_attempt_answers a
      on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
    where qa.learner_id = v_user_id
      and qa.status = 'completed'
      and a.is_correct = false
      and a.response is not null
      and a.response not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb)

    union all

    -- Incorrect submitted answers from completed adaptive mocks.
    select mq.question_id,
      coalesce(ma.completed_at,ma.created_at),
      'Mock test'::text,
      mq.question_snapshot,
      row_number() over (
        partition by mq.question_id order by coalesce(ma.completed_at,ma.created_at) desc
      )
    from public.gre_mock_attempts ma
    join public.gre_mock_attempt_questions mq on mq.attempt_id = ma.id
    join public.gre_mock_attempt_answers ans
      on ans.attempt_id = mq.attempt_id and ans.question_id = mq.question_id
    where ma.learner_id = v_user_id
      and ma.status = 'completed'
      and ans.is_correct = false
      and ans.response is not null
      and ans.response not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb)
  ),
  latest_mistakes as (
    select distinct on (question_id)
      question_id,occurred_at,source,snapshot
    from mistakes
    where rn = 1
    order by question_id,occurred_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'question_id',m.question_id,
    'occurred_at',m.occurred_at,
    'source',m.source,
    'question',m.snapshot,
    'stimulus',s.stimulus_text,
    'note',coalesce(n.note,''),
    'reason',n.reason,
    'status',coalesce(n.status,'review'),
    'updated_at',n.updated_at
  ) order by m.occurred_at desc),'[]'::jsonb)
  into v_result
  from latest_mistakes m
  left join public.gre_learner_mistake_notes n
    on n.learner_id = v_user_id and n.question_id = m.question_id
  left join public.question_stimuli s
    on s.id::text = coalesce(m.snapshot->>'stimulus_id',m.snapshot->>'stimulus');

  return v_result;
end;
$$;

revoke all on function public.get_learner_mistake_notebook() from public, anon;
grant execute on function public.get_learner_mistake_notebook() to authenticated;

notify pgrst, 'reload schema';
