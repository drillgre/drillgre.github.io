-- Vocab Mountain learner-level word classification.
-- Run after supabase/vocab-mountain.sql.
--
-- "know" is the default state and is not stored. Only review and unknown
-- states are saved, so newly published words start green for every learner.

create table if not exists public.vocab_word_progress (
  learner_id uuid not null references auth.users(id) on delete cascade,
  vocab_word_id uuid not null references public.vocab_words(id) on delete cascade,
  status text not null check (status in ('review','unknown')),
  updated_at timestamptz not null default now(),
  primary key (learner_id, vocab_word_id)
);

create index if not exists vocab_word_progress_learner_status_idx
  on public.vocab_word_progress(learner_id, status);

alter table public.vocab_word_progress enable row level security;

revoke all on public.vocab_word_progress from public, anon, authenticated;
grant select, insert, update, delete on public.vocab_word_progress to authenticated;

drop policy if exists "Learners read own vocabulary progress" on public.vocab_word_progress;
create policy "Learners read own vocabulary progress"
on public.vocab_word_progress
for select to authenticated
using (auth.uid() = learner_id);

drop policy if exists "Learners insert own vocabulary progress" on public.vocab_word_progress;
create policy "Learners insert own vocabulary progress"
on public.vocab_word_progress
for insert to authenticated
with check (auth.uid() = learner_id);

drop policy if exists "Learners update own vocabulary progress" on public.vocab_word_progress;
create policy "Learners update own vocabulary progress"
on public.vocab_word_progress
for update to authenticated
using (auth.uid() = learner_id)
with check (auth.uid() = learner_id);

drop policy if exists "Learners delete own vocabulary progress" on public.vocab_word_progress;
create policy "Learners delete own vocabulary progress"
on public.vocab_word_progress
for delete to authenticated
using (auth.uid() = learner_id);

notify pgrst, 'reload schema';
