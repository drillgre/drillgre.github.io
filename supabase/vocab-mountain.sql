-- DrillGRE Vocab Mountain backend
-- Run this script once in the Supabase SQL Editor.
-- Admins can add, edit, publish, unpublish, and import vocabulary words.
-- Public users can read published vocabulary only.

create table if not exists public.vocab_words (
  id uuid primary key default gen_random_uuid(),
  day integer not null check (day >= 1),
  sn integer check (sn is null or sn >= 1),
  word text not null check (length(trim(word)) > 0),
  meaning1 text,
  meaning2 text,
  meaning3 text,
  synonyms text,
  example1 text,
  example2 text,
  example3 text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vocab_words_word_unique_idx
  on public.vocab_words (lower(trim(word)));

create index if not exists vocab_words_day_sn_idx
  on public.vocab_words (day asc, sn asc nulls last, created_at asc);

alter table public.vocab_words enable row level security;

revoke all on public.vocab_words from public;
revoke all on public.vocab_words from anon;
revoke all on public.vocab_words from authenticated;

grant select on public.vocab_words to anon, authenticated;
grant insert, update, delete on public.vocab_words to authenticated;

drop policy if exists "Public can read published vocabulary" on public.vocab_words;
create policy "Public can read published vocabulary"
on public.vocab_words
for select
to anon, authenticated
using (
  is_published = true
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "Admins can insert vocabulary" on public.vocab_words;
create policy "Admins can insert vocabulary"
on public.vocab_words
for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "Admins can update vocabulary" on public.vocab_words;
create policy "Admins can update vocabulary"
on public.vocab_words
for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "Admins can delete vocabulary" on public.vocab_words;
create policy "Admins can delete vocabulary"
on public.vocab_words
for delete
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create or replace function public.set_vocab_words_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vocab_words_updated_at on public.vocab_words;
create trigger vocab_words_updated_at
before update on public.vocab_words
for each row execute function public.set_vocab_words_updated_at();

notify pgrst, 'reload schema';
