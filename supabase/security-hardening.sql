-- DrillGRE production security hardening.
-- Run this script LAST, after:
-- gre-mock-tests.sql, learner-accounts.sql, learner-read-policies.sql,
-- topic-quiz.sql, quiz-progress.sql, question-bank-progress.sql,
-- question-bank-diagnostics.sql, vocab-mountain.sql, and vocab-word-progress.sql.
--
-- This migration intentionally prevents direct browser-side edits to profiles.
-- Use the existing SECURITY DEFINER RPCs for learner preferences and trusted
-- database triggers for profile creation.

begin;

-- Prevent authenticated learners from changing their role or profile fields
-- by calling the Data API directly. The dashboard only needs to read its own
-- profile. Admin status is managed directly by a trusted project owner.
alter table public.profiles enable row level security;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', v_policy.policyname);
  end loop;
end
$$;

create policy "Profiles are readable only by their owner"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

revoke all on table public.profiles from public, anon, authenticated;

grant select (
  id,
  role,
  name,
  email,
  education,
  age_range,
  country,
  academic_background,
  further_study,
  further_study_fields,
  further_study_field,
  leaderboard_opt_in
) on table public.profiles to authenticated;

-- Client roles may use the public schema but must not create objects in it.
revoke create on schema public from public, anon, authenticated;

-- The app's question-figure bucket is public-read for rendered question images.
-- Only an authenticated account whose profile has role=admin may upload,
-- replace, or delete files. SVG is excluded to avoid active-content uploads.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'question-figures',
  'question-figures',
  true,
  5242880,
  array['image/png','image/jpeg','image/webp','image/gif']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "DrillGRE admins upload question figures" on storage.objects;
create policy "DrillGRE admins upload question figures"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'question-figures'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

drop policy if exists "DrillGRE admins update question figures" on storage.objects;
create policy "DrillGRE admins update question figures"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'question-figures'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
)
with check (
  bucket_id = 'question-figures'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

drop policy if exists "DrillGRE admins delete question figures" on storage.objects;
create policy "DrillGRE admins delete question figures"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'question-figures'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

commit;

notify pgrst, 'reload schema';

-- Review the resulting Storage policies. Remove any older permissive policy
-- that allows general authenticated writes to the question-figures bucket.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
