-- DrillGRE Question Bank likes.
-- Run this once in the Supabase SQL Editor.

create table if not exists public.gre_question_bank_likes (
  learner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_id text not null,
  created_at timestamptz not null default now(),
  constraint gre_question_bank_likes_pkey primary key (learner_id, question_id)
);

create index if not exists gre_question_bank_likes_question_idx
  on public.gre_question_bank_likes(question_id);

alter table public.gre_question_bank_likes enable row level security;

drop policy if exists "Learners can view their own question likes" on public.gre_question_bank_likes;
create policy "Learners can view their own question likes"
  on public.gre_question_bank_likes for select
  to authenticated
  using (learner_id = (select auth.uid()));

drop policy if exists "Learners can like questions" on public.gre_question_bank_likes;
create policy "Learners can like questions"
  on public.gre_question_bank_likes for insert
  to authenticated
  with check (learner_id = (select auth.uid()));

drop policy if exists "Learners can remove their own likes" on public.gre_question_bank_likes;
create policy "Learners can remove their own likes"
  on public.gre_question_bank_likes for delete
  to authenticated
  using (learner_id = (select auth.uid()));

grant select, insert, delete on public.gre_question_bank_likes to authenticated;

create or replace function public.get_gre_question_bank_likes(p_question_ids text[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_object_agg(
      requested.question_id,
      jsonb_build_object(
        'like_count', coalesce(counts.like_count, 0),
        'liked', coalesce(mine.liked, false)
      )
    ),
    '{}'::jsonb
  )
  from (select distinct unnest(coalesce(p_question_ids, array[]::text[])) as question_id) requested
  left join lateral (
    select count(*)::integer as like_count
    from public.gre_question_bank_likes likes
    where likes.question_id = requested.question_id
  ) counts on true
  left join lateral (
    select true as liked
    from public.gre_question_bank_likes likes
    where likes.question_id = requested.question_id
      and likes.learner_id = auth.uid()
    limit 1
  ) mine on true;
$$;

revoke all on function public.get_gre_question_bank_likes(text[]) from public;
grant execute on function public.get_gre_question_bank_likes(text[]) to authenticated;
