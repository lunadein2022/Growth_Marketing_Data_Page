-- AI briefing history hardening.
-- Keeps generated report history queryable after refresh/login and preserves
-- the original screen context used to create each briefing.

create extension if not exists pgcrypto;

do $$ begin
  create type metric_owner_type as enum ('channel', 'content', 'post', 'campaign', 'ad');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type period_mode as enum ('weekly', 'monthly');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type briefing_surface as enum ('command', 'channel', 'campaign', 'ad');
exception when duplicate_object then null;
end $$;

create table if not exists ai_briefings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  surface briefing_surface not null,
  owner_type metric_owner_type,
  owner_id uuid,
  period_mode period_mode not null,
  period_start date not null,
  period_end date not null,
  title text not null,
  period_label text not null,
  data_sources jsonb not null default '[]'::jsonb,
  data_warnings jsonb not null default '[]'::jsonb,
  summary text not null,
  wins jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  request_context jsonb not null default '{}'::jsonb,
  model_provider text,
  model_name text,
  prompt_version text,
  generated_by uuid references app_users(id) on delete set null,
  generated_at timestamptz not null default now()
);

alter table ai_briefings add column if not exists owner_type metric_owner_type;
alter table ai_briefings add column if not exists owner_id uuid;
alter table ai_briefings add column if not exists period_start date;
alter table ai_briefings add column if not exists period_end date;
alter table ai_briefings add column if not exists data_sources jsonb not null default '[]'::jsonb;
alter table ai_briefings add column if not exists data_warnings jsonb not null default '[]'::jsonb;
alter table ai_briefings add column if not exists wins jsonb not null default '[]'::jsonb;
alter table ai_briefings add column if not exists risks jsonb not null default '[]'::jsonb;
alter table ai_briefings add column if not exists actions jsonb not null default '[]'::jsonb;
alter table ai_briefings add column if not exists evidence jsonb not null default '[]'::jsonb;
alter table ai_briefings add column if not exists request_context jsonb not null default '{}'::jsonb;
alter table ai_briefings add column if not exists model_provider text;
alter table ai_briefings add column if not exists model_name text;
alter table ai_briefings add column if not exists prompt_version text;
alter table ai_briefings add column if not exists generated_by uuid references app_users(id) on delete set null;
alter table ai_briefings add column if not exists generated_at timestamptz not null default now();

create index if not exists idx_ai_briefings_surface_period
  on ai_briefings(org_id, surface, period_mode, generated_at desc);

create index if not exists idx_ai_briefings_generated
  on ai_briefings(org_id, generated_at desc);

alter table ai_briefings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_briefings'
      and policyname = 'ai_briefings_member_all'
  ) then
    create policy ai_briefings_member_all on ai_briefings
      for all
      using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
end $$;
