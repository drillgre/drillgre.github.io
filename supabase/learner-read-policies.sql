-- DrillGRE learner access policies
-- Run this in Supabase SQL Editor.
-- These policies add public read access only to published learning material.
-- They do not change the existing write policies or admin permissions.

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
using (published = true);

-- Important security note:
-- The initial learner practice page retrieves correct_answer with published
-- questions so it can grade answers in the browser. This is suitable for
-- ordinary lesson practice, but answers can be inspected by technical users.
-- Before using questions for secure mock examinations or paid assessments,
-- move grading to a Supabase RPC/Edge Function that does not return answer keys.
