-- DrillGRE learner accounts, email OTP profiles, and mock-attempt limits.
-- Run AFTER gre-mock-tests.sql and BEFORE learner-read-policies.sql.
--
-- Auth is email OTP. Authenticated learners have unlimited mock attempts.
-- Anonymous learners may start two attempts per persistent browser visitor key.
-- Guest quotas are tied to a browser-local key, so clearing browser storage
-- or using another browser can reset the guest identity.

-- ============================================================
-- Learner profile fields
-- ============================================================

alter table public.profiles add column if not exists name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists education text;
alter table public.profiles add column if not exists age_range text;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists academic_background text;
alter table public.profiles add column if not exists further_study text;
alter table public.profiles add column if not exists further_study_fields text[] not null default '{}';

create index if not exists profiles_email_idx on public.profiles(email);

-- Create/update the learner profile when Supabase Auth creates the user.
create or replace function public.handle_new_drillgre_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_fields text[];
begin
  select coalesce(array_agg(value), array[]::text[])
  into v_fields
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(new.raw_user_meta_data -> 'further_study_fields') = 'array'
        then new.raw_user_meta_data -> 'further_study_fields'
      else '[]'::jsonb
    end
  ) as values_table(value);

  insert into public.profiles (
    id, role, name, email, education, age_range, country,
    academic_background, further_study, further_study_fields
  )
  values (
    new.id,
    'learner',
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    new.email,
    nullif(new.raw_user_meta_data ->> 'education', ''),
    nullif(new.raw_user_meta_data ->> 'age_range', ''),
    nullif(trim(new.raw_user_meta_data ->> 'country'), ''),
    nullif(new.raw_user_meta_data ->> 'academic_background', ''),
    nullif(new.raw_user_meta_data ->> 'further_study', ''),
    v_fields
  )
  on conflict (id) do update set
    name = coalesce(excluded.name, public.profiles.name),
    email = coalesce(excluded.email, public.profiles.email),
    education = coalesce(excluded.education, public.profiles.education),
    age_range = coalesce(excluded.age_range, public.profiles.age_range),
    country = coalesce(excluded.country, public.profiles.country),
    academic_background = coalesce(excluded.academic_background, public.profiles.academic_background),
    further_study = coalesce(excluded.further_study, public.profiles.further_study),
    further_study_fields = case
      when cardinality(excluded.further_study_fields) > 0 then excluded.further_study_fields
      else public.profiles.further_study_fields
    end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_drillgre on auth.users;
create trigger on_auth_user_created_drillgre
after insert on auth.users
for each row execute function public.handle_new_drillgre_user();

-- Backfill profiles for any existing Auth users without a profile row.
insert into public.profiles (id, role, name, email, education, age_range, country,
  academic_background, further_study, further_study_fields)
select
  u.id,
  'learner',
  nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
  u.email,
  nullif(u.raw_user_meta_data ->> 'education', ''),
  nullif(u.raw_user_meta_data ->> 'age_range', ''),
  nullif(trim(u.raw_user_meta_data ->> 'country'), ''),
  nullif(u.raw_user_meta_data ->> 'academic_background', ''),
  nullif(u.raw_user_meta_data ->> 'further_study', ''),
  case
    when jsonb_typeof(u.raw_user_meta_data -> 'further_study_fields') = 'array'
      then array(select jsonb_array_elements_text(u.raw_user_meta_data -> 'further_study_fields'))
    else array[]::text[]
  end
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

alter table public.profiles enable row level security;
drop policy if exists "Learners can view own profile" on public.profiles;
create policy "Learners can view own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

-- ============================================================
-- Attempt ownership and free guest quota
-- ============================================================

alter table public.gre_mock_attempts
  add column if not exists learner_id uuid references auth.users(id) on delete set null;
alter table public.gre_mock_attempts add column if not exists visitor_key text;

create index if not exists gre_mock_attempts_learner_history_idx
  on public.gre_mock_attempts(learner_id, created_at desc);
create index if not exists gre_mock_attempts_visitor_history_idx
  on public.gre_mock_attempts(visitor_key, created_at desc);

-- Remove the old one-argument start endpoint. Otherwise guests could bypass
-- the server-side quota by calling the older RPC directly.
drop function if exists public.start_gre_mock(text);

create or replace function public.start_gre_mock(
  p_session_token text,
  p_visitor_key text default null
)
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
  v_user_id uuid := auth.uid();
  v_guest_count integer := 0;
begin
  if p_session_token is null or length(p_session_token) < 32 then
    raise exception 'A valid mock-test session token is required.';
  end if;

  if v_user_id is null then
    if p_visitor_key is null or length(p_visitor_key) < 32 then
      raise exception 'A valid guest browser key is required. Refresh the page and try again.';
    end if;

    -- Prevent simultaneous starts from exceeding the two-attempt allowance.
    perform pg_advisory_xact_lock(hashtextextended(p_visitor_key, 0));

    select count(*) into v_guest_count
    from public.gre_mock_attempts
    where visitor_key = p_visitor_key;

    if v_guest_count >= 2 then
      raise exception 'You have used both free mock attempts on this browser. Sign in with your email to create unlimited mocks.';
    end if;
  end if;

  insert into public.gre_mock_attempts(session_token, status, learner_id, visitor_key)
  values (
    p_session_token,
    'section1',
    v_user_id,
    case when v_user_id is null then p_visitor_key else null end
  )
  returning id into v_attempt_id;

  v_selection := private.gre_mock_select_section(
    v_attempt_id, 1, null, null, p_visitor_key
  );
  v_questions := v_selection -> 'questions';
  v_da_subtopic := v_selection ->> 'da_subtopic';

  update public.gre_mock_attempts
  set section1_da_subtopic = v_da_subtopic
  where id = v_attempt_id;

  if v_user_id is null then
    v_guest_count := v_guest_count + 1;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'status', 'section1',
    'section_number', 1,
    'question_count', 12,
    'questions', coalesce(v_questions, '[]'::jsonb),
    'is_authenticated', v_user_id is not null,
    'guest_attempts_used', case when v_user_id is null then v_guest_count else null end,
    'guest_attempts_remaining', case when v_user_id is null then greatest(0, 2 - v_guest_count) else null end
  );
end;
$$;

drop function if exists public.resume_gre_mock(uuid, text);

create or replace function public.resume_gre_mock(
  p_attempt_id uuid,
  p_session_token text,
  p_visitor_key text default null
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
  where id = p_attempt_id
    and session_token = p_session_token
    and (
      (auth.uid() is not null and learner_id = auth.uid())
      or (auth.uid() is null and learner_id is null and visitor_key = p_visitor_key)
    );

  if not found then
    raise exception 'Mock test not found for this learner or browser session.';
  end if;

  if v_attempt.status = 'completed' then
    return jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', 'completed',
      'scaled_score', v_attempt.scaled_score,
      'total_correct', v_attempt.total_correct,
      'weighted_points', v_attempt.weighted_points,
      'max_weighted_points', v_attempt.max_weighted_points,
      'route', v_attempt.route
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
    'attempt_id', v_attempt.id,
    'status', v_attempt.status,
    'section_number', v_section,
    'section1_correct', v_attempt.section1_correct,
    'route', v_attempt.route,
    'question_count', jsonb_array_length(coalesce(v_questions, '[]'::jsonb)),
    'questions', coalesce(v_questions, '[]'::jsonb)
  );
end;
$$;

drop function if exists public.submit_gre_mock_section1(uuid, text, jsonb);

create or replace function public.submit_gre_mock_section1(
  p_attempt_id uuid,
  p_session_token text,
  p_responses jsonb,
  p_visitor_key text default null
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
  where id = p_attempt_id
    and session_token = p_session_token
    and status = 'section1'
    and (
      (auth.uid() is not null and learner_id = auth.uid())
      or (auth.uid() is null and learner_id is null and visitor_key = p_visitor_key)
    )
  for update;

  if not found then
    raise exception 'Section 1 is not available for this learner or browser session.';
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
    from jsonb_array_elements(coalesce(p_responses, '[]'::jsonb)) as t(item)
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
    p_attempt_id, 2, v_route, v_attempt.section1_da_subtopic, v_attempt.visitor_key
  );
  v_questions := v_selection -> 'questions';

  update public.gre_mock_attempts
  set status = 'section2', section1_correct = v_correct_count, route = v_route
  where id = p_attempt_id;

  return jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', 'section2',
    'section_number', 2,
    'section1_correct', v_correct_count,
    'route', v_route,
    'question_count', 15,
    'questions', coalesce(v_questions, '[]'::jsonb)
  );
end;
$$;

drop function if exists public.finish_gre_mock(uuid, text, jsonb);

create or replace function public.finish_gre_mock(
  p_attempt_id uuid,
  p_session_token text,
  p_responses jsonb,
  p_visitor_key text default null
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
  where id = p_attempt_id
    and session_token = p_session_token
    and status = 'section2'
    and (
      (auth.uid() is not null and learner_id = auth.uid())
      or (auth.uid() is null and learner_id is null and visitor_key = p_visitor_key)
    )
  for update;

  if not found then
    raise exception 'Section 2 is not available for this learner or browser session.';
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
    from jsonb_array_elements(coalesce(p_responses, '[]'::jsonb)) as t(item)
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

-- ============================================================
-- Authenticated learner dashboard data
-- ============================================================

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
  v_total integer;
  v_completed integer;
begin
  if v_user_id is null then
    raise exception 'Please sign in to view your learner dashboard.';
  end if;

  select jsonb_build_object(
    'name', p.name,
    'email', p.email,
    'education', p.education,
    'age_range', p.age_range,
    'country', p.country,
    'academic_background', p.academic_background,
    'further_study', p.further_study,
    'further_study_fields', p.further_study_fields
  ) into v_profile
  from public.profiles p
  where p.id = v_user_id;

  if v_profile is null then
    raise exception 'Your learner profile is not available. Please contact support.';
  end if;

  select count(*)::integer,
         count(*) filter (where status = 'completed')::integer
  into v_total, v_completed
  from public.gre_mock_attempts
  where learner_id = v_user_id;

  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at desc),'[]'::jsonb)
  into v_attempts
  from (
    select id, status, created_at, completed_at, scaled_score,
           total_correct, route, section1_correct
    from public.gre_mock_attempts
    where learner_id = v_user_id
    order by created_at desc
    limit 20
  ) recent;

  return jsonb_build_object(
    'profile', v_profile,
    'mocks_started', coalesce(v_total,0),
    'mocks_completed', coalesce(v_completed,0),
    'recent_attempts', coalesce(v_attempts,'[]'::jsonb)
  );
end;
$$;

-- Revoke old function signatures and expose only the owner-aware RPCs.
revoke all on function public.start_gre_mock(text) from public;
revoke all on function public.resume_gre_mock(uuid, text) from public;
revoke all on function public.submit_gre_mock_section1(uuid, text, jsonb) from public;
revoke all on function public.finish_gre_mock(uuid, text, jsonb) from public;

revoke all on function public.start_gre_mock(text, text) from public;
revoke all on function public.resume_gre_mock(uuid, text, text) from public;
revoke all on function public.submit_gre_mock_section1(uuid, text, jsonb, text) from public;
revoke all on function public.finish_gre_mock(uuid, text, jsonb, text) from public;
revoke all on function public.get_learner_dashboard() from public;

grant execute on function public.start_gre_mock(text, text) to anon, authenticated;
grant execute on function public.resume_gre_mock(uuid, text, text) to anon, authenticated;
grant execute on function public.submit_gre_mock_section1(uuid, text, jsonb, text) to anon, authenticated;
grant execute on function public.finish_gre_mock(uuid, text, jsonb, text) to anon, authenticated;
grant execute on function public.get_learner_dashboard() to authenticated;
