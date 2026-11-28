-- Global learner dashboard layout, managed by DrillGRE administrators.
create table if not exists public.gre_dashboard_settings (
  id integer primary key check (id = 1),
  layout jsonb not null default '["study-activity","mistake-intelligence","topic-performance","question-type-performance","practice-priorities","weekly-trend","practice-sources","mock-score-progression"]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.gre_dashboard_settings enable row level security;

drop policy if exists "Authenticated users can read dashboard layout" on public.gre_dashboard_settings;
create policy "Authenticated users can read dashboard layout"
on public.gre_dashboard_settings
for select
to authenticated
using (true);

drop policy if exists "Admins can insert dashboard layout" on public.gre_dashboard_settings;
create policy "Admins can insert dashboard layout"
on public.gre_dashboard_settings
for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists "Admins can update dashboard layout" on public.gre_dashboard_settings;
create policy "Admins can update dashboard layout"
on public.gre_dashboard_settings
for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

grant select, insert, update on public.gre_dashboard_settings to authenticated;

insert into public.gre_dashboard_settings (id)
values (1)
on conflict (id) do nothing;
