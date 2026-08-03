-- DummDumm Brand OS — Supabase (PostgreSQL) initial schema.
-- Migrated from server/schema.sql (previously a Firebase/Firestore reference draft).
-- Core rule: content cards, published posts, campaigns, and ads are separate
-- entities connected by explicit IDs, never by title string matching.
--
-- Adds vs. the reference draft:
--   * app_users.auth_user_id -> auth.users (Supabase Auth linkage)
--   * Row Level Security on every table (replaces server/firestore.rules)
--   * Helper functions is_marketing_owner / is_org_member / is_org_admin

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type channel_id as enum ('youtube', 'instagram', 'website', 'linkedin', 'naver', 'tiktok');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type data_status as enum ('complete', 'partial', 'not_uploaded', 'unavailable', 'error');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type period_mode as enum ('weekly', 'monthly');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type content_status as enum ('idea', 'draft', 'scheduled', 'published', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type ad_status as enum ('planned', 'active', 'ended');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type raw_source as enum ('api', 'file', 'manual');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type metric_owner_type as enum ('channel', 'content', 'post', 'campaign', 'ad');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type briefing_surface as enum ('command', 'channel', 'campaign', 'ad');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  display_name text,
  role text not null default 'marketer',
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table if not exists channel_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  channel channel_id not null,
  account_key text not null,
  display_name text not null,
  status data_status not null default 'not_uploaded',
  auth_provider text,
  external_account_id text,
  scopes text[] not null default '{}',
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, channel, account_key)
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  objective text,
  status text not null default 'active',
  upload_start_date date,
  upload_end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create table if not exists content_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  channel channel_id not null,
  account_key text,
  format text not null,
  status content_status not null default 'idea',
  title text not null,
  draft text,
  scheduled_at timestamptz,
  published_at timestamptz,
  external_url text,
  legacy_mock_id text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, legacy_mock_id)
);

create table if not exists published_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  channel_account_id uuid references channel_accounts(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete set null,
  channel channel_id not null,
  account_key text,
  format text not null,
  platform_post_id text not null,
  title text not null,
  permalink text,
  published_at timestamptz not null,
  collected_at timestamptz not null default now(),
  raw_source raw_source not null default 'api',
  raw_payload jsonb not null default '{}'::jsonb,
  unique (org_id, channel, account_key, platform_post_id)
);

create table if not exists content_post_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  content_id uuid not null references content_cards(id) on delete cascade,
  post_id uuid not null references published_posts(id) on delete cascade,
  link_type text not null default 'primary',
  linked_at timestamptz not null default now(),
  unique (org_id, content_id, post_id)
);

create table if not exists campaign_contents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  content_id uuid not null references content_cards(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (org_id, campaign_id, content_id)
);

create table if not exists ad_contents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  source_content_id uuid references content_cards(id) on delete set null,
  source_post_id uuid references published_posts(id) on delete set null,
  channel channel_id not null,
  account_key text,
  title text not null,
  platform_ad_id text,
  source text not null default 'manual_plan',
  period_start date not null,
  period_end date not null,
  budget numeric(14, 2) not null default 0,
  spend numeric(14, 2) not null default 0,
  impressions integer,
  clicks integer,
  ctr numeric(7, 4),
  organic_lift numeric(7, 4),
  status ad_status not null default 'planned',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, platform_ad_id)
);

create table if not exists metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  owner_type metric_owner_type not null,
  owner_id uuid not null,
  channel channel_id,
  account_key text,
  period_mode period_mode not null,
  period_start date not null,
  period_end date not null,
  metrics jsonb not null default '{}'::jsonb,
  status data_status not null default 'partial',
  source_ids text[] not null default '{}',
  collected_at timestamptz not null default now(),
  unique (org_id, owner_type, owner_id, period_mode, period_start, period_end)
);

create table if not exists metric_time_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  owner_type metric_owner_type not null,
  owner_id uuid not null,
  channel channel_id,
  account_key text,
  metric_key text not null,
  granularity text not null check (granularity in ('day', 'week', 'month')),
  point_date date not null,
  value numeric(18, 4),
  status data_status not null default 'partial',
  source_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (org_id, owner_type, owner_id, metric_key, granularity, point_date)
);

create table if not exists decision_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  content_id uuid not null references content_cards(id) on delete cascade,
  note text not null,
  tag text check (tag in ('rerun', 'thumbnail', 'copy', 'cta', 'hold', 'idea', 'other')),
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

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
  model_provider text,
  model_name text,
  prompt_version text,
  generated_by uuid references app_users(id) on delete set null,
  generated_at timestamptz not null default now()
);

create table if not exists publishing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  channel channel_id not null,
  account_key text,
  format text not null,
  cadence text not null check (cadence in ('daily', 'weekly', 'biweekly', 'monthly', 'custom')),
  days_of_week integer[] not null default '{}',
  time_local time not null,
  timezone text not null default 'Asia/Seoul',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists file_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source_kind text not null,
  filename text not null,
  status data_status not null default 'partial',
  row_count integer,
  raw_metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references app_users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  channel_account_id uuid references channel_accounts(id) on delete set null,
  job_type text not null,
  period_start date,
  period_end date,
  status data_status not null default 'partial',
  rows_read integer not null default 0,
  rows_written integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_content_cards_org_status on content_cards(org_id, status);
create index if not exists idx_content_cards_org_channel on content_cards(org_id, channel, account_key);
create index if not exists idx_published_posts_org_channel_date on published_posts(org_id, channel, account_key, published_at desc);
create index if not exists idx_campaign_contents_campaign on campaign_contents(org_id, campaign_id);
create index if not exists idx_ad_contents_source_content on ad_contents(org_id, source_content_id);
create index if not exists idx_metric_snapshots_owner_period on metric_snapshots(org_id, owner_type, owner_id, period_start, period_end);
create index if not exists idx_metric_time_series_owner_metric on metric_time_series(org_id, owner_type, owner_id, metric_key, point_date);
create index if not exists idx_ai_briefings_surface_period on ai_briefings(org_id, surface, period_mode, generated_at desc);
create index if not exists idx_decision_logs_content on decision_logs(org_id, content_id, created_at desc);
create index if not exists idx_app_users_auth on app_users(auth_user_id);

-- ---------------------------------------------------------------------------
-- RLS helper functions (replaces server/firestore.rules)
-- ---------------------------------------------------------------------------
create or replace function public.is_marketing_owner()
returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'lunadein2022@gmail.com',
    'lunachae827@gmail.com'
  );
$$;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.is_marketing_owner()
    or exists (
      select 1 from app_users u
      where u.org_id = target_org
        and u.auth_user_id = auth.uid()
    );
$$;

create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.is_marketing_owner()
    or exists (
      select 1 from app_users u
      where u.org_id = target_org
        and u.auth_user_id = auth.uid()
        and u.role in ('owner', 'admin')
    );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Category A: members have full CRUD.
-- Category B: members read, admins write.
do $$
declare
  member_crud text[] := array[
    'content_cards', 'content_post_links', 'campaigns', 'campaign_contents',
    'ad_contents', 'decision_logs', 'ai_briefings', 'publishing_rules'
  ];
  admin_write text[] := array[
    'app_users', 'channel_accounts', 'published_posts', 'metric_snapshots',
    'metric_time_series', 'content_rankings_placeholder', 'file_imports', 'sync_runs'
  ];
  t text;
begin
  -- content_rankings does not exist as a table in this schema (rankings live in
  -- metric_snapshots/jsonb); drop the placeholder so the loop skips it.
  admin_write := array_remove(admin_write, 'content_rankings_placeholder');

  foreach t in array (member_crud || admin_write) loop
    execute format('alter table %I enable row level security;', t);
  end loop;

  foreach t in array member_crud loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = format('%s_member_all', t)
    ) then
      execute format($f$
        create policy %1$I_member_all on %1$I
          for all
          using (public.is_org_member(org_id))
          with check (public.is_org_member(org_id));
      $f$, t);
    end if;
  end loop;

  foreach t in array admin_write loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = format('%s_member_read', t)
    ) then
      execute format($f$
        create policy %1$I_member_read on %1$I
          for select using (public.is_org_member(org_id));
      $f$, t);
    end if;

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = format('%s_admin_write', t)
    ) then
      execute format($f$
        create policy %1$I_admin_write on %1$I
          for all
          using (public.is_org_admin(org_id))
          with check (public.is_org_admin(org_id));
      $f$, t);
    end if;
  end loop;
end $$;

-- organizations: keyed by id (no org_id column) — members read, admins write.
alter table organizations enable row level security;
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'organizations'
      and policyname = 'organizations_member_read'
  ) then
    create policy organizations_member_read on organizations
      for select using (public.is_org_member(id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'organizations'
      and policyname = 'organizations_admin_write'
  ) then
    create policy organizations_admin_write on organizations
      for all
      using (public.is_org_admin(id))
      with check (public.is_org_admin(id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Storage bucket for raw file imports (replaces Firebase Storage)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('file-imports', 'file-imports', false)
on conflict (id) do nothing;

-- Any authenticated org member may read/write objects under file-imports/.
-- Fine-grained per-org path scoping is enforced in application code (see
-- src/services/supabaseFileImports.ts) and can be tightened here later.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'file_imports_authenticated_read'
  ) then
    create policy "file_imports_authenticated_read" on storage.objects
      for select to authenticated
      using (bucket_id = 'file-imports');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'file_imports_authenticated_write'
  ) then
    create policy "file_imports_authenticated_write" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'file-imports');
  end if;
end $$;
