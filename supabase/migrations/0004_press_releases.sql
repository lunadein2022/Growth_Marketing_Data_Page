-- Press releases board (보도자료 게시판). Cross-device: stored in Postgres +
-- Supabase Storage (public bucket for images).

create table if not exists press_releases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  body text not null default '',
  images text[] not null default '{}',
  covered_moneytoday boolean not null default false,
  covered_etnews boolean not null default false,
  covered_diginet boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_press_releases_org_created on press_releases(org_id, created_at desc);

alter table press_releases enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'press_releases'
      and policyname = 'press_releases_member_all'
  ) then
    create policy press_releases_member_all on press_releases
      for all
      using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
end $$;

-- Public bucket for press images: readable via public URL, writable by auth users.
insert into storage.buckets (id, name, public)
values ('press-images', 'press-images', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'press_images_public_read'
  ) then
    create policy "press_images_public_read" on storage.objects
      for select
      using (bucket_id = 'press-images');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'press_images_auth_write'
  ) then
    create policy "press_images_auth_write" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'press-images');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'press_images_auth_delete'
  ) then
    create policy "press_images_auth_delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'press-images');
  end if;
end $$;
