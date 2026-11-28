-- DrillGRE community, daily content, and configurable guest Question Bank access.
create table if not exists public.gre_public_access_settings (
  id integer primary key default 1 check (id=1),
  guest_question_limit integer not null default 50 check (guest_question_limit between 0 and 500),
  guest_access_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.gre_public_access_settings(id) values (1) on conflict (id) do nothing;
alter table public.gre_public_access_settings enable row level security;
revoke all on public.gre_public_access_settings from anon, authenticated, public;
drop policy if exists "Admins manage public access settings" on public.gre_public_access_settings;
create policy "Admins manage public access settings" on public.gre_public_access_settings
for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

create or replace function public.get_public_access_settings()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 select jsonb_build_object('guest_question_limit',guest_question_limit,'guest_access_enabled',guest_access_enabled)
 into v from public.gre_public_access_settings where id=1;
 return coalesce(v,'{"guest_question_limit":50,"guest_access_enabled":true}'::jsonb);
end; $$;
revoke all on function public.get_public_access_settings() from public;
grant execute on function public.get_public_access_settings() to anon,authenticated;

create or replace function public.save_public_access_settings(p_limit integer,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin') then
   raise exception 'Administrator access is required.';
 end if;
 if p_limit is null or p_limit<0 or p_limit>500 then raise exception 'Guest question limit must be between 0 and 500.'; end if;
 update public.gre_public_access_settings set guest_question_limit=p_limit,guest_access_enabled=p_enabled,updated_at=now() where id=1;
 select jsonb_build_object('guest_question_limit',guest_question_limit,'guest_access_enabled',guest_access_enabled) into v from public.gre_public_access_settings where id=1;
 return v;
end; $$;
revoke all on function public.save_public_access_settings(integer,boolean) from public;
grant execute on function public.save_public_access_settings(integer,boolean) to authenticated;

-- Anonymous visitors receive only a capped random sample of prompt fields.
create or replace function public.get_guest_question_bank()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_limit integer; v_enabled boolean; v_rows jsonb;
begin
 select guest_question_limit,guest_access_enabled into v_limit,v_enabled from public.gre_public_access_settings where id=1;
 if not coalesce(v_enabled,false) or coalesce(v_limit,0)=0 then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows
 from (
   select q.id,q.topic,q.topic_category,q.subtopic,q.question_type,q.difficulty,q.question_text,q.options,q.figure_url,q.stimulus_id,q.question_usage,q.created_at
   from public.questions q
   where q.published=true and q.question_usage in ('practice','both')
   order by random()
   limit least(v_limit,500)
 ) x;
 return v_rows;
end; $$;
revoke all on function public.get_guest_question_bank() from public;
grant execute on function public.get_guest_question_bank() to anon,authenticated;

-- Daily content is selected deterministically by Nepal-local calendar date.
create or replace function public.get_gre_daily_challenge()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 select to_jsonb(x) into v from (
   select q.id,q.topic,q.topic_category,q.subtopic,q.question_type,q.difficulty,q.question_text,q.options,q.figure_url,q.stimulus_id
   from public.questions q
   where q.published=true and q.question_usage in ('practice','both')
   order by md5(q.id::text || to_char((now() at time zone 'Asia/Kathmandu')::date,'YYYY-MM-DD'))
   limit 1
 ) x;
 return coalesce(v,'{}'::jsonb);
end; $$;
revoke all on function public.get_gre_daily_challenge() from public;
grant execute on function public.get_gre_daily_challenge() to anon,authenticated;

create or replace function public.get_gre_word_of_day()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 select to_jsonb(x) into v from (
   select id,word,category,meaning1,meaning2,meaning3,synonyms,example1,example2,example3
   from public.vocab_words
   where is_published=true
   order by md5(id::text || to_char((now() at time zone 'Asia/Kathmandu')::date,'YYYY-MM-DD'))
   limit 1
 ) x;
 return coalesce(v,'{}'::jsonb);
end; $$;
revoke all on function public.get_gre_word_of_day() from public;
grant execute on function public.get_gre_word_of_day() to anon,authenticated;

create table if not exists public.gre_discussion_posts (
 id bigint generated by default as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(trim(title)) between 5 and 180),
 body text not null check (char_length(trim(body)) between 5 and 10000),
 category text not null default 'General' check (category in ('General','Quant','Verbal','Vocabulary','Study strategy')),
 is_hidden boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.gre_discussion_replies (
 id bigint generated by default as identity primary key,
 post_id bigint not null references public.gre_discussion_posts(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 body text not null check (char_length(trim(body)) between 1 and 5000),
 is_hidden boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists gre_discussion_posts_created_idx on public.gre_discussion_posts(created_at desc);
create index if not exists gre_discussion_replies_post_idx on public.gre_discussion_replies(post_id,created_at);
alter table public.gre_discussion_posts enable row level security;
alter table public.gre_discussion_replies enable row level security;
drop policy if exists "Public read visible discussion posts" on public.gre_discussion_posts;
create policy "Public read visible discussion posts" on public.gre_discussion_posts for select to anon,authenticated using (is_hidden=false or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
drop policy if exists "Signed-in users create discussion posts" on public.gre_discussion_posts;
create policy "Signed-in users create discussion posts" on public.gre_discussion_posts for insert to authenticated with check (auth.uid()=user_id);
drop policy if exists "Authors and admins update discussion posts" on public.gre_discussion_posts;
create policy "Authors and admins update discussion posts" on public.gre_discussion_posts for update to authenticated using (auth.uid()=user_id or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')) with check (auth.uid()=user_id or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
drop policy if exists "Public read visible discussion replies" on public.gre_discussion_replies;
create policy "Public read visible discussion replies" on public.gre_discussion_replies for select to anon,authenticated using (is_hidden=false or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
drop policy if exists "Signed-in users reply to discussions" on public.gre_discussion_replies;
create policy "Signed-in users reply to discussions" on public.gre_discussion_replies for insert to authenticated with check (auth.uid()=user_id and exists(select 1 from public.gre_discussion_posts d where d.id=post_id and d.is_hidden=false));
drop policy if exists "Authors and admins update discussion replies" on public.gre_discussion_replies;
create policy "Authors and admins update discussion replies" on public.gre_discussion_replies for update to authenticated using (auth.uid()=user_id or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')) with check (auth.uid()=user_id or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
grant select on public.gre_discussion_posts,public.gre_discussion_replies to anon,authenticated;
grant insert,update on public.gre_discussion_posts,public.gre_discussion_replies to authenticated;
grant usage,select on sequence public.gre_discussion_posts_id_seq,public.gre_discussion_replies_id_seq to authenticated;
notify pgrst,'reload schema';
