-- DrillGRE adaptive Quant mock tests


-- Topic classification and linked Data Analysis stimuli.
create table if not exists public.question_stimuli (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  stimulus_text text not null default '',
  figure_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.questions add column if not exists topic_category text;
alter table public.questions add column if not exists subtopic text;
alter table public.questions add column if not exists stimulus_id uuid;

update public.questions
set topic_category = case
  when lower(coalesce(topic,'')) similar to '%(geometry|coordinate)%' then 'geometry'
  when question_type = 'data_interpretation'
    or lower(coalesce(topic,'')) similar to '%(data|probability|counting|permutation|combination|statistics|interpretation)%'
    then 'data_analysis'
  when lower(coalesce(topic,'')) similar to '%(algebra|inequalit|equation|function|word problem)%' then 'algebra'
  else 'arithmetic'
end
where topic_category is null;

update public.questions
set subtopic = case
  when topic_category = 'geometry' and lower(coalesce(topic,'')) like '%coordinate%' then 'coordinate_geometry'
  when topic_category = 'geometry' then 'geometry'
  when topic_category = 'algebra' and lower(coalesce(topic,'')) like '%inequalit%' then 'inequalities'
  when topic_category = 'algebra' and lower(coalesce(topic,'')) like '%word%' then 'word_problems'
  when topic_category = 'algebra' then 'algebra_core'
  when topic_category = 'data_analysis' and lower(coalesce(topic,'')) like '%probab%' then 'probability'
  when topic_category = 'data_analysis' and lower(coalesce(topic,'')) similar to '%(count|permutation|combination)%' then 'counting'
  when topic_category = 'data_analysis' and lower(coalesce(topic,'')) like '%stat%' then 'statistics'
  when topic_category = 'data_analysis' then 'data_interpretation'
  when lower(coalesce(topic,'')) similar to '%(number|property)%' then 'number_properties'
  else 'arithmetic_other'
end
where subtopic is null or btrim(subtopic) = '';

alter table public.questions alter column topic_category set default 'arithmetic';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'questions_topic_category_check'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions add constraint questions_topic_category_check
      check (topic_category in ('arithmetic','data_analysis','algebra','geometry'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'questions_stimulus_id_fkey'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions add constraint questions_stimulus_id_fkey
      foreign key (stimulus_id) references public.question_stimuli(id) on delete set null;
  end if;
end $$;

create index if not exists questions_mock_topic_difficulty_idx
  on public.questions(topic_category, subtopic, difficulty)
  where published = true;
create index if not exists questions_stimulus_id_idx
  on public.questions(stimulus_id);

alter table public.question_stimuli enable row level security;
revoke all on public.question_stimuli from anon, public;
grant select, insert, update, delete on public.question_stimuli to authenticated;
drop policy if exists "Admins manage question stimuli" on public.question_stimuli;
create policy "Admins manage question stimuli"
  on public.question_stimuli
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create or replace function public.limit_question_stimulus_members()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if new.stimulus_id is null then
    return new;
  end if;

  if new.topic_category <> 'data_analysis' or new.subtopic <> 'data_interpretation' then
    raise exception 'A shared stimulus can only be linked to Data Interpretation questions.';
  end if;

  select count(*) into v_count
  from public.questions q
  where q.stimulus_id = new.stimulus_id
    and q.id is distinct from new.id;

  if v_count >= 3 then
    raise exception 'A shared Data Analysis stimulus can be linked to a maximum of three questions.';
  end if;

  return new;
end;
$$;

drop trigger if exists questions_limit_stimulus_members on public.questions;
create trigger questions_limit_stimulus_members
before insert or update of stimulus_id, topic_category on public.questions
for each row execute function public.limit_question_stimulus_members();


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
  completed_at timestamptz,
  section1_da_subtopic text
);

alter table public.gre_mock_attempts add column if not exists section1_da_subtopic text;

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


create or replace function private.gre_mock_select_section(
  p_attempt_id uuid,
  p_section_number integer,
  p_route text,
  p_section1_da_subtopic text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_group_difficulties integer[];
  v_stimulus public.question_stimuli%rowtype;
  v_question public.questions%rowtype;
  v_target record;
  v_position integer := 0;
  v_questions jsonb;
  v_da_subtopic text;
  v_remaining_subtopics text[];
  v_first_subtopic text;
  v_second_subtopic text;
  v_da_diff_1 integer;
  v_da_diff_2 integer;
begin
  if p_section_number = 1 then
    v_group_difficulties := array[2,3,4];
  elsif p_route = 'harder' then
    v_group_difficulties := array[3,4,5];
  else
    v_group_difficulties := array[1,2,3];
  end if;

  -- A stimulus is eligible only when it has exactly three published
  -- Data Analysis questions at the required difficulty levels.
  select s.* into v_stimulus
  from public.question_stimuli s
  where exists (
    select 1
    from public.questions q
    where q.stimulus_id = s.id
      and q.published = true
      and q.topic_category = 'data_analysis'
      and not exists (
        select 1
        from public.gre_mock_attempt_questions used
        where used.attempt_id = p_attempt_id
          and used.question_id = q.id::text
      )
    group by q.stimulus_id
    having count(*) = 3
       and array_agg(q.difficulty order by q.difficulty) = v_group_difficulties
  )
  order by random()
  limit 1;

  if not found then
    raise exception 'No complete published Data Analysis stimulus group is available for this section. The group must contain exactly three published questions at difficulty levels %.',
      array_to_string(v_group_difficulties, ', ');
  end if;

  -- Insert the three linked questions consecutively, with shared stimulus
  -- metadata copied into each protected server-side snapshot.
  for v_question in
    select q.* from public.questions q
    where q.stimulus_id = v_stimulus.id
      and q.published = true
      and q.topic_category = 'data_analysis'
      and q.subtopic = 'data_interpretation'
    order by q.difficulty, q.created_at
  loop
    v_position := v_position + 1;
    insert into public.gre_mock_attempt_questions(
      attempt_id, question_id, section_number, position, question_snapshot
    )
    values (
      p_attempt_id, v_question.id::text, p_section_number, v_position,
      jsonb_build_object(
        'id', v_question.id::text,
        'topic', v_question.topic,
        'topic_category', v_question.topic_category,
        'subtopic', v_question.subtopic,
        'question_type', v_question.question_type,
        'difficulty', v_question.difficulty,
        'question_text', v_question.question_text,
        'options', v_question.options,
        'figure_url', v_question.figure_url,
        'stimulus_id', v_stimulus.id::text,
        'stimulus_title', v_stimulus.title,
        'stimulus_text', v_stimulus.stimulus_text,
        'stimulus_figure_url', v_stimulus.figure_url,
        'correct_answer', v_question.correct_answer,
        'explanation', v_question.explanation,
        'explanation_type', v_question.explanation_type,
        'explanation_video_url', v_question.explanation_video_url
      )
    );
  end loop;

  if p_section_number = 1 then
    -- Section 1 has one standalone Data Analysis question. Across the
    -- complete mock, the standalone questions cover Probability, Counting,
    -- and Statistics once each.
    select q.* into v_question
    from public.questions q
    where q.published = true
      and q.topic_category = 'data_analysis'
      and q.subtopic in ('probability','counting','statistics')
      and q.stimulus_id is null
      and q.difficulty = 4
    order by random()
    limit 1;

    if not found then
      raise exception 'Section 1 needs one standalone Data Analysis question at Level 4, tagged Probability, Counting, or Statistics.';
    end if;

    v_da_subtopic := v_question.subtopic;
    v_position := v_position + 1;
    insert into public.gre_mock_attempt_questions(
      attempt_id, question_id, section_number, position, question_snapshot
    )
    values (
      p_attempt_id, v_question.id::text, p_section_number, v_position,
      jsonb_build_object(
        'id', v_question.id::text, 'topic', v_question.topic,
        'topic_category', v_question.topic_category, 'subtopic', v_question.subtopic,
        'question_type', v_question.question_type, 'difficulty', v_question.difficulty,
        'question_text', v_question.question_text, 'options', v_question.options,
        'figure_url', v_question.figure_url, 'stimulus_id', null,
        'correct_answer', v_question.correct_answer, 'explanation', v_question.explanation,
        'explanation_type', v_question.explanation_type,
        'explanation_video_url', v_question.explanation_video_url
      )
    );

    -- Section 1 topic matrix: Arithmetic 3, Data Analysis 4,
    -- Algebra 3, Geometry 2.
    for v_target in
      select * from (values
        (1,'arithmetic','number_properties'),
        (1,'algebra','word_problems'),
        (2,'arithmetic','number_properties'),
        (2,'algebra','inequalities'),
        (3,'arithmetic','arithmetic_other'),
        (3,'algebra','algebra_core'),
        (3,'geometry','geometry'),
        (4,'geometry','coordinate_geometry')
      ) as m(difficulty, topic_category, subtopic)
    loop
      select q.* into v_question
      from public.questions q
      where q.published = true
        and q.topic_category = v_target.topic_category
        and (
          q.subtopic = v_target.subtopic
          or (
            v_target.topic_category = 'arithmetic'
            and v_target.subtopic = 'arithmetic_other'
            and q.subtopic in (
              'fractions_decimals','percentages','ratios_proportions',
              'exponents_roots','absolute_values','arithmetic_other'
            )
          )
        )
        and q.difficulty = v_target.difficulty
        and (
          v_target.topic_category <> 'arithmetic'
          or v_target.subtopic <> 'arithmetic_other'
          or not exists (
            select 1 from public.gre_mock_attempt_questions prior
            where prior.attempt_id = p_attempt_id
              and prior.question_snapshot ->> 'topic_category' = 'arithmetic'
              and (prior.question_snapshot ->> 'difficulty')::integer = v_target.difficulty
              and prior.question_snapshot ->> 'subtopic' in (
                'fractions_decimals','percentages','ratios_proportions',
                'exponents_roots','absolute_values','arithmetic_other'
              )
          )
        )
        and not exists (
          select 1 from public.gre_mock_attempt_questions aq
          where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
        )
      order by random()
      limit 1;

      if not found then
        raise exception 'Question bank needs a published Level % question tagged % / % for Section 1.',
          v_target.difficulty, v_target.topic_category, v_target.subtopic;
      end if;

      v_position := v_position + 1;
      insert into public.gre_mock_attempt_questions(
        attempt_id, question_id, section_number, position, question_snapshot
      )
      values (
        p_attempt_id, v_question.id::text, p_section_number, v_position,
        jsonb_build_object(
          'id', v_question.id::text, 'topic', v_question.topic,
          'topic_category', v_question.topic_category, 'subtopic', v_question.subtopic,
          'question_type', v_question.question_type, 'difficulty', v_question.difficulty,
          'question_text', v_question.question_text, 'options', v_question.options,
          'figure_url', v_question.figure_url, 'stimulus_id', null,
          'correct_answer', v_question.correct_answer, 'explanation', v_question.explanation,
          'explanation_type', v_question.explanation_type,
          'explanation_video_url', v_question.explanation_video_url
        )
      );
    end loop;

  else
    -- The next two standalone Data Analysis questions use the two subtopics
    -- not selected in Section 1, so Probability, Counting and Statistics all
    -- appear once across the 27-question test.
    v_remaining_subtopics := array_remove(
      array['probability','counting','statistics']::text[],
      p_section1_da_subtopic
    );

    if coalesce(array_length(v_remaining_subtopics,1),0) <> 2 then
      raise exception 'The Section 1 Data Analysis subtopic could not be recovered. Please start a new mock attempt.';
    end if;

    if p_route = 'harder' then
      v_da_diff_1 := 3;
      v_da_diff_2 := 4;
    else
      v_da_diff_1 := 2;
      v_da_diff_2 := 4;
    end if;

    select a.subtopic, b.subtopic into v_first_subtopic, v_second_subtopic
    from unnest(v_remaining_subtopics) as a(subtopic)
    cross join unnest(v_remaining_subtopics) as b(subtopic)
    where a.subtopic <> b.subtopic
      and exists (
        select 1 from public.questions q
        where q.published = true and q.topic_category = 'data_analysis'
          and q.subtopic = a.subtopic and q.stimulus_id is null
          and q.difficulty = v_da_diff_1
          and not exists (
            select 1 from public.gre_mock_attempt_questions aq
            where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
          )
      )
      and exists (
        select 1 from public.questions q
        where q.published = true and q.topic_category = 'data_analysis'
          and q.subtopic = b.subtopic and q.stimulus_id is null
          and q.difficulty = v_da_diff_2
          and not exists (
            select 1 from public.gre_mock_attempt_questions aq
            where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
          )
      )
    order by random()
    limit 1;

    if not found then
      raise exception 'Section 2 needs standalone Data Analysis questions from the two remaining subtopics (Probability, Counting, Statistics) at Levels % and %.',
        v_da_diff_1, v_da_diff_2;
    end if;

    for v_target in
      select * from (values
        (v_da_diff_1, v_first_subtopic),
        (v_da_diff_2, v_second_subtopic)
      ) as d(difficulty, subtopic)
    loop
      select q.* into v_question
      from public.questions q
      where q.published = true
        and q.topic_category = 'data_analysis'
        and q.subtopic = v_target.subtopic
        and q.stimulus_id is null
        and q.difficulty = v_target.difficulty
        and not exists (
          select 1 from public.gre_mock_attempt_questions aq
          where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
        )
      order by random()
      limit 1;

      if not found then
        raise exception 'No published standalone Data Analysis question found for % at Level %.',
          v_target.subtopic, v_target.difficulty;
      end if;

      v_position := v_position + 1;
      insert into public.gre_mock_attempt_questions(
        attempt_id, question_id, section_number, position, question_snapshot
      )
      values (
        p_attempt_id, v_question.id::text, p_section_number, v_position,
        jsonb_build_object(
          'id', v_question.id::text, 'topic', v_question.topic,
          'topic_category', v_question.topic_category, 'subtopic', v_question.subtopic,
          'question_type', v_question.question_type, 'difficulty', v_question.difficulty,
          'question_text', v_question.question_text, 'options', v_question.options,
          'figure_url', v_question.figure_url, 'stimulus_id', null,
          'correct_answer', v_question.correct_answer, 'explanation', v_question.explanation,
          'explanation_type', v_question.explanation_type,
          'explanation_video_url', v_question.explanation_video_url
        )
      );
    end loop;

    if p_route = 'harder' then
      -- Section 2 harder route: 4 Arithmetic, 5 Data Analysis,
      -- 3 Algebra, 3 Geometry. Difficulty counts remain 5/5/5.
      for v_target in
        select * from (values
          (3,'arithmetic','number_properties'),
          (3,'algebra','word_problems'),
          (3,'geometry','geometry'),
          (4,'arithmetic','number_properties'),
          (4,'algebra','inequalities'),
          (4,'geometry','coordinate_geometry'),
          (5,'arithmetic','arithmetic_other'),
          (5,'arithmetic','arithmetic_other'),
          (5,'algebra','algebra_core'),
          (5,'geometry','geometry')
        ) as m(difficulty, topic_category, subtopic)
      loop
        select q.* into v_question
        from public.questions q
        where q.published = true and q.topic_category = v_target.topic_category
          and (
            q.subtopic = v_target.subtopic
            or (
              v_target.topic_category = 'arithmetic'
              and v_target.subtopic = 'arithmetic_other'
              and q.subtopic in (
                'fractions_decimals','percentages','ratios_proportions',
                'exponents_roots','absolute_values','arithmetic_other'
              )
            )
          )
          and q.difficulty = v_target.difficulty
          and (
            v_target.topic_category <> 'arithmetic'
            or v_target.subtopic <> 'arithmetic_other'
            or not exists (
              select 1 from public.gre_mock_attempt_questions prior
              where prior.attempt_id = p_attempt_id
                and prior.question_snapshot ->> 'topic_category' = 'arithmetic'
                and (prior.question_snapshot ->> 'difficulty')::integer = v_target.difficulty
                and prior.question_snapshot ->> 'subtopic' in (
                  'fractions_decimals','percentages','ratios_proportions',
                  'exponents_roots','absolute_values','arithmetic_other'
                )
            )
          )
          and not exists (
            select 1 from public.gre_mock_attempt_questions aq
            where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
          )
        order by random() limit 1;

        if not found then
          raise exception 'Question bank needs a published Level % question tagged % / % for the harder Section 2 route.',
            v_target.difficulty, v_target.topic_category, v_target.subtopic;
        end if;

        v_position := v_position + 1;
        insert into public.gre_mock_attempt_questions(
          attempt_id, question_id, section_number, position, question_snapshot
        )
        values (
          p_attempt_id, v_question.id::text, p_section_number, v_position,
          jsonb_build_object(
            'id', v_question.id::text, 'topic', v_question.topic,
            'topic_category', v_question.topic_category, 'subtopic', v_question.subtopic,
            'question_type', v_question.question_type, 'difficulty', v_question.difficulty,
            'question_text', v_question.question_text, 'options', v_question.options,
            'figure_url', v_question.figure_url, 'stimulus_id', null,
            'correct_answer', v_question.correct_answer, 'explanation', v_question.explanation,
            'explanation_type', v_question.explanation_type,
            'explanation_video_url', v_question.explanation_video_url
          )
        );
      end loop;
    else
      -- Easier route keeps the same topic quotas but uses D1-D4 questions.
      for v_target in
        select * from (values
          (1,'arithmetic','number_properties'),
          (1,'algebra','word_problems'),
          (2,'arithmetic','number_properties'),
          (2,'algebra','inequalities'),
          (2,'geometry','geometry'),
          (3,'arithmetic','arithmetic_other'),
          (3,'algebra','algebra_core'),
          (3,'geometry','geometry'),
          (3,'geometry','coordinate_geometry'),
          (4,'arithmetic','arithmetic_other')
        ) as m(difficulty, topic_category, subtopic)
      loop
        select q.* into v_question
        from public.questions q
        where q.published = true and q.topic_category = v_target.topic_category
          and (
            q.subtopic = v_target.subtopic
            or (
              v_target.topic_category = 'arithmetic'
              and v_target.subtopic = 'arithmetic_other'
              and q.subtopic in (
                'fractions_decimals','percentages','ratios_proportions',
                'exponents_roots','absolute_values','arithmetic_other'
              )
            )
          )
          and q.difficulty = v_target.difficulty
          and (
            v_target.topic_category <> 'arithmetic'
            or v_target.subtopic <> 'arithmetic_other'
            or not exists (
              select 1 from public.gre_mock_attempt_questions prior
              where prior.attempt_id = p_attempt_id
                and prior.question_snapshot ->> 'topic_category' = 'arithmetic'
                and (prior.question_snapshot ->> 'difficulty')::integer = v_target.difficulty
                and prior.question_snapshot ->> 'subtopic' in (
                  'fractions_decimals','percentages','ratios_proportions',
                  'exponents_roots','absolute_values','arithmetic_other'
                )
            )
          )
          and not exists (
            select 1 from public.gre_mock_attempt_questions aq
            where aq.attempt_id = p_attempt_id and aq.question_id = q.id::text
          )
        order by random() limit 1;

        if not found then
          raise exception 'Question bank needs a published Level % question tagged % / % for the foundation Section 2 route.',
            v_target.difficulty, v_target.topic_category, v_target.subtopic;
        end if;

        v_position := v_position + 1;
        insert into public.gre_mock_attempt_questions(
          attempt_id, question_id, section_number, position, question_snapshot
        )
        values (
          p_attempt_id, v_question.id::text, p_section_number, v_position,
          jsonb_build_object(
            'id', v_question.id::text, 'topic', v_question.topic,
            'topic_category', v_question.topic_category, 'subtopic', v_question.subtopic,
            'question_type', v_question.question_type, 'difficulty', v_question.difficulty,
            'question_text', v_question.question_text, 'options', v_question.options,
            'figure_url', v_question.figure_url, 'stimulus_id', null,
            'correct_answer', v_question.correct_answer, 'explanation', v_question.explanation,
            'explanation_type', v_question.explanation_type,
            'explanation_video_url', v_question.explanation_video_url
          )
        );
      end loop;
    end if;
  end if;

  select jsonb_agg(
    question_snapshot - 'correct_answer' - 'explanation' - 'explanation_type' - 'explanation_video_url'
    order by position
  ) into v_questions
  from public.gre_mock_attempt_questions
  where attempt_id = p_attempt_id and section_number = p_section_number;

  return jsonb_build_object(
    'questions', coalesce(v_questions,'[]'::jsonb),
    'da_subtopic', v_da_subtopic
  );
end;
$$;

revoke all on function private.gre_mock_select_section(uuid, integer, text, text)
  from public, anon, authenticated;

create or replace function public.start_gre_mock(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_attempt_id uuid;
  v_selection jsonb;
  v_questions jsonb;
  v_da_subtopic text;
begin
  if p_session_token is null or length(p_session_token) < 32 then
    raise exception 'A valid mock-test session token is required.';
  end if;

  insert into public.gre_mock_attempts(session_token, status)
  values (p_session_token, 'section1')
  returning id into v_attempt_id;

  v_selection := private.gre_mock_select_section(v_attempt_id, 1, null, null);
  v_questions := v_selection -> 'questions';
  v_da_subtopic := v_selection ->> 'da_subtopic';

  update public.gre_mock_attempts
  set section1_da_subtopic = v_da_subtopic
  where id = v_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt_id, 'status', 'section1', 'section_number', 1,
    'question_count', 12, 'questions', coalesce(v_questions,'[]'::jsonb)
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
  v_selection jsonb;
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

  v_selection := private.gre_mock_select_section(
    p_attempt_id, 2, v_route, v_attempt.section1_da_subtopic
  );
  v_questions := v_selection -> 'questions';

  update public.gre_mock_attempts
  set status = 'section2', section1_correct = v_correct_count, route = v_route
  where id = p_attempt_id;

  return jsonb_build_object(
    'attempt_id', p_attempt_id, 'status', 'section2', 'section_number', 2,
    'section1_correct', v_correct_count, 'route', v_route,
    'question_count', 15, 'questions', coalesce(v_questions,'[]'::jsonb)
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
