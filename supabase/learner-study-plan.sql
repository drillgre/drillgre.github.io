-- DrillGRE learner weekly study planner. Run after learner-accounts.sql.
create table if not exists public.gre_study_plan_items (
 id uuid primary key default gen_random_uuid(),
 learner_id uuid not null references auth.users(id) on delete cascade,
 activity_date date not null,
 activity_type text not null check(activity_type in ('lesson','quiz','mock','vocabulary')),
 title text not null check(length(trim(title)) between 1 and 120),
 details text,
 completed boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists gre_study_plan_items_owner_date_idx on public.gre_study_plan_items(learner_id,activity_date);
alter table public.gre_study_plan_items enable row level security;
drop policy if exists "Learners manage own study plan" on public.gre_study_plan_items;
create policy "Learners manage own study plan" on public.gre_study_plan_items for all to authenticated using(learner_id=auth.uid()) with check(learner_id=auth.uid());
revoke all on public.gre_study_plan_items from anon,authenticated;

create table if not exists public.gre_study_plan_targets(
 learner_id uuid not null references auth.users(id) on delete cascade,
 target_date date not null,
 quant_target integer not null default 20 check(quant_target between 0 and 500),
 vocab_target integer not null default 10 check(vocab_target between 0 and 200),
 vocab_completed integer not null default 0 check(vocab_completed between 0 and 200),
 updated_at timestamptz not null default now(),
 primary key(learner_id,target_date)
);
alter table public.gre_study_plan_targets enable row level security;
drop policy if exists "Learners manage own study targets" on public.gre_study_plan_targets;
create policy "Learners manage own study targets" on public.gre_study_plan_targets for all to authenticated using(learner_id=auth.uid()) with check(learner_id=auth.uid());
revoke all on public.gre_study_plan_targets from anon,authenticated;

create or replace function public.get_gre_study_plan(p_week_start date default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_start date:=coalesce(p_week_start,date_trunc('week',current_date)::date); v_items jsonb; v_targets jsonb;
begin
 if v_uid is null then raise exception 'Sign in to view your study plan.'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.activity_date,x.created_at),'[]'::jsonb) into v_items
 from (select id,activity_date,activity_type,title,details,completed,created_at from public.gre_study_plan_items where learner_id=v_uid and activity_date between v_start and v_start+6) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.target_date),'[]'::jsonb) into v_targets
 from (select target_date,quant_target,vocab_target,vocab_completed from public.gre_study_plan_targets where learner_id=v_uid and target_date between v_start and v_start+6) x;
 return jsonb_build_object('week_start',v_start,'items',v_items,'targets',v_targets);
end $$;

create or replace function public.save_gre_study_plan_item(p_id uuid,p_activity_date date,p_activity_type text,p_title text,p_details text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_id uuid;
begin
 if v_uid is null then raise exception 'Sign in to save your study plan.'; end if;
 if p_activity_date is null or p_activity_type not in ('lesson','quiz','mock','vocabulary') or p_title is null or length(trim(p_title)) not between 1 and 120 then raise exception 'Provide a valid date, activity type and title.'; end if;
 if p_id is null then
  insert into public.gre_study_plan_items(learner_id,activity_date,activity_type,title,details) values(v_uid,p_activity_date,p_activity_type,trim(p_title),nullif(trim(p_details),'')) returning id into v_id;
 else
  update public.gre_study_plan_items set activity_date=p_activity_date,activity_type=p_activity_type,title=trim(p_title),details=nullif(trim(p_details),''),updated_at=now() where id=p_id and learner_id=v_uid returning id into v_id;
  if v_id is null then raise exception 'Study plan activity not found.'; end if;
 end if;
 return v_id;
end $$;

create or replace function public.set_gre_study_plan_item_completed(p_id uuid,p_completed boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to update your study plan.'; end if;
 update public.gre_study_plan_items set completed=coalesce(p_completed,false),updated_at=now() where id=p_id and learner_id=auth.uid();
 if not found then raise exception 'Study plan activity not found.'; end if;
 return coalesce(p_completed,false);
end $$;

create or replace function public.delete_gre_study_plan_item(p_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to update your study plan.'; end if;
 delete from public.gre_study_plan_items where id=p_id and learner_id=auth.uid();
 return found;
end $$;

create or replace function public.set_gre_study_plan_target(p_target_date date,p_quant_target integer,p_vocab_target integer,p_vocab_completed integer default 0)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to save your daily targets.'; end if;
 if p_target_date is null or p_quant_target not between 0 and 500 or p_vocab_target not between 0 and 200 or p_vocab_completed not between 0 and 200 then raise exception 'Daily targets are outside the allowed range.'; end if;
 insert into public.gre_study_plan_targets(learner_id,target_date,quant_target,vocab_target,vocab_completed) values(auth.uid(),p_target_date,p_quant_target,p_vocab_target,p_vocab_completed)
 on conflict(learner_id,target_date) do update set quant_target=excluded.quant_target,vocab_target=excluded.vocab_target,vocab_completed=excluded.vocab_completed,updated_at=now();
 return true;
end $$;

revoke all on function public.get_gre_study_plan(date) from public,anon;
revoke all on function public.save_gre_study_plan_item(uuid,date,text,text,text) from public,anon;
revoke all on function public.set_gre_study_plan_item_completed(uuid,boolean) from public,anon;
revoke all on function public.delete_gre_study_plan_item(uuid) from public,anon;
revoke all on function public.set_gre_study_plan_target(date,integer,integer,integer) from public,anon;
grant execute on function public.get_gre_study_plan(date) to authenticated;
grant execute on function public.save_gre_study_plan_item(uuid,date,text,text,text) to authenticated;
grant execute on function public.set_gre_study_plan_item_completed(uuid,boolean) to authenticated;
grant execute on function public.delete_gre_study_plan_item(uuid) to authenticated;
grant execute on function public.set_gre_study_plan_target(date,integer,integer,integer) to authenticated;
notify pgrst,'reload schema';
