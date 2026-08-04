-- Per-account API tokens (Instagram Login etc.) stored in the DB so the sync
-- function can auto-refresh them on a schedule — no more manual rotation.

create table if not exists channel_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null,              -- 'instagram'
  account_key text not null,           -- 'company' | 'dummdumm-log'
  access_token text not null,
  token_expires_at timestamptz,
  external_user_id text,               -- resolved platform user id
  display_name text,
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, account_key)
);

alter table channel_tokens enable row level security;

-- Tokens are sensitive: only org admins (marketing owners) may read/write them
-- from the client. The sync function uses the service role key and bypasses RLS.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'channel_tokens'
      and policyname = 'channel_tokens_admin_all'
  ) then
    create policy channel_tokens_admin_all on channel_tokens
      for all
      using (public.is_org_admin(org_id))
      with check (public.is_org_admin(org_id));
  end if;
end $$;
