-- DrillGRE Word Archery: learner attempts, points and success rate.
-- Run after vocab-mountain.sql and security-hardening.sql.

create table if not exists public.gre_word_archery_attempts (
  id bigint generated always as identity primary key,
  learner_id uuid not null references auth.users(id) on delete cascade,
  vocab_word_id uuid not null references public.vocab_words(id) on delete cascade,
  answer_mode text not null check (answer_mode in ('synonym','meaning')),
  is_correct boolean not null,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  created_at timestamptz not null default now()
);

create index if not exists gre_word_archery_learner_created_idx
  on public.gre_word_archery_attempts(learner_id, created_at desc);

alter table public.gre_word_archery_attempts enable row level security;
revoke all on public.gre_word_archery_attempts from public, anon, authenticated;
grant select on public.gre_word_archery_attempts to authenticated;

drop policy if exists "Learners read own Word Archery attempts" on public.gre_word_archery_attempts;
create policy "Learners read own Word Archery attempts"
on public.gre_word_archery_attempts
for select to authenticated
using (learner_id = (select auth.uid()));

create or replace function public.submit_word_archery_attempt(
  p_vocab_word_id uuid,
  p_answer_mode text,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_word public.vocab_words%rowtype;
  v_answer text;
  v_target text;
  v_synonym text;
  v_correct boolean := false;
  v_overlap integer;
  v_target_count integer;
  v_streak_before integer := 0;
  v_streak_after integer := 0;
  v_points integer := 0;
  v_attempts integer := 0;
  v_correct_total integer := 0;
  v_total_points integer := 0;
  v_rate numeric := 0;
  v_meaning text;
  v_row record;
begin
  if v_user_id is null then
    raise exception 'Sign in to save Word Archery results.';
  end if;
  if p_answer_mode not in ('synonym','meaning') then
    raise exception 'Choose either synonym or meaning mode.';
  end if;
  if p_answer is null or length(p_answer) > 250 then
    raise exception 'Your answer must be no longer than 250 characters.';
  end if;

  select * into v_word
  from public.vocab_words
  where id = p_vocab_word_id and is_published = true;

  if not found then
    raise exception 'This vocabulary word is no longer available.';
  end if;

  v_answer := trim(regexp_replace(lower(p_answer), '[^a-z0-9]+', ' ', 'g'));
  if v_answer = '' then
    raise exception 'Please enter a readable English answer.';
  end if;

  if p_answer_mode = 'synonym' then
    for v_synonym in
      select trim(value)
      from regexp_split_to_table(coalesce(v_word.synonyms,''), '[,;|]') as s(value)
    loop
      v_target := trim(regexp_replace(lower(v_synonym), '[^a-z0-9]+', ' ', 'g'));
      if v_target <> '' and v_target = v_answer then
        v_correct := true;
        exit;
      end if;
    end loop;
  else
    foreach v_meaning in array array[
      coalesce(v_word.meaning1,''),
      coalesce(v_word.meaning2,''),
      coalesce(v_word.meaning3,'')
    ]
    loop
      v_target := trim(regexp_replace(lower(v_meaning), '[^a-z0-9]+', ' ', 'g'));
      if v_target = '' then
        continue;
      end if;
      if v_target = v_answer then
        v_correct := true;
        exit;
      end if;

      -- Flexible short-meaning matching: require at least half of the
      -- definition's meaningful words, excluding common grammatical words.
      select count(distinct a.token)::integer
      into v_overlap
      from unnest(regexp_split_to_array(v_answer, '[[:space:]]+')) as a(token)
      join unnest(regexp_split_to_array(v_target, '[[:space:]]+')) as t(token)
        on a.token = t.token
      where length(a.token) > 2
        and a.token not in (
          'the','and','for','with','from','into','onto','that','this','these',
          'those','their','there','then','than','which','what','when','where',
          'while','whose','your','you','are','was','were','been','being',
          'have','has','had','does','did','doing','not','but','can','could',
          'would','should','will','may','might','must','about','over','under',
          'between','through','such','some','more','most','very','often',
          'also','only','each','any','all','one','two','three','its','our',
          'out','per','who','whom','how','why'
        );

      select count(distinct t.token)::integer
      into v_target_count
      from unnest(regexp_split_to_array(v_target, '[[:space:]]+')) as t(token)
      where length(t.token) > 2
        and t.token not in (
          'the','and','for','with','from','into','onto','that','this','these',
          'those','their','there','then','than','which','what','when','where',
          'while','whose','your','you','are','was','were','been','being',
          'have','has','had','does','did','doing','not','but','can','could',
          'would','should','will','may','might','must','about','over','under',
          'between','through','such','some','more','most','very','often',
          'also','only','each','any','all','one','two','three','its','our',
          'out','per','who','whom','how','why'
        );

      if coalesce(v_target_count,0) > 0
        and coalesce(v_overlap,0) >= greatest(1,ceil(v_target_count * 0.5)::integer) then
        v_correct := true;
        exit;
      end if;
    end loop;
  end if;

  if v_correct then
    -- Count the complete current consecutive streak so the bonus is awarded
    -- on every third bullseye, not on every bullseye after the second.
    for v_row in
      select is_correct
      from public.gre_word_archery_attempts
      where learner_id = v_user_id
      order by created_at desc, id desc
      limit 100
    loop
      if not v_row.is_correct then
        exit;
      end if;
      v_streak_before := v_streak_before + 1;
    end loop;

    v_streak_after := v_streak_before + 1;
    v_points := 10 + case when mod(v_streak_after,3) = 0 then 5 else 0 end;
  else
    v_points := 0;
    v_streak_after := 0;
  end if;

  insert into public.gre_word_archery_attempts(
    learner_id,vocab_word_id,answer_mode,is_correct,points_awarded
  )
  values(v_user_id,p_vocab_word_id,p_answer_mode,v_correct,v_points);

  select
    count(*)::integer,
    count(*) filter(where is_correct)::integer,
    coalesce(sum(points_awarded),0)::integer
  into v_attempts,v_correct_total,v_total_points
  from public.gre_word_archery_attempts
  where learner_id = v_user_id;

  v_rate := case when v_attempts > 0
    then round(100.0 * v_correct_total / v_attempts,1)
    else 0 end;

  return jsonb_build_object(
    'is_correct',v_correct,
    'points_awarded',v_points,
    'streak',v_streak_after,
    'total_attempts',v_attempts,
    'correct_attempts',v_correct_total,
    'total_points',v_total_points,
    'success_rate',v_rate
  );
end;
$$;

create or replace function public.get_word_archery_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempts integer;
  v_correct integer;
  v_points integer;
  v_rate numeric;
  v_streak integer := 0;
  v_stop boolean := false;
  v_row record;
begin
  if v_user_id is null then
    raise exception 'Sign in to view saved Word Archery statistics.';
  end if;

  select count(*)::integer,
    count(*) filter(where is_correct)::integer,
    coalesce(sum(points_awarded),0)::integer
  into v_attempts,v_correct,v_points
  from public.gre_word_archery_attempts
  where learner_id = v_user_id;

  v_rate := case when v_attempts > 0
    then round(100.0 * v_correct / v_attempts,1)
    else 0 end;

  for v_row in
    select is_correct
    from public.gre_word_archery_attempts
    where learner_id = v_user_id
    order by created_at desc, id desc
    limit 100
  loop
    if not v_row.is_correct then
      v_stop := true;
      exit;
    end if;
    v_streak := v_streak + 1;
  end loop;

  return jsonb_build_object(
    'total_attempts',coalesce(v_attempts,0),
    'correct_attempts',coalesce(v_correct,0),
    'total_points',coalesce(v_points,0),
    'success_rate',coalesce(v_rate,0),
    'streak',coalesce(v_streak,0)
  );
end;
$$;

revoke all on function public.submit_word_archery_attempt(uuid,text,text) from public, anon;
revoke all on function public.get_word_archery_stats() from public, anon;
grant execute on function public.submit_word_archery_attempt(uuid,text,text) to authenticated;
grant execute on function public.get_word_archery_stats() to authenticated;

notify pgrst, 'reload schema';
