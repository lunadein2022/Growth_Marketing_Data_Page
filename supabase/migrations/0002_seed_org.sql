-- Seed the single DummDumm organization with a fixed UUID so the frontend can
-- reference it as a constant (see src/services/supabaseFileImports.ts ORG_ID).
-- The two marketing owners pass RLS via is_marketing_owner(), so they can write
-- imports against this org without an explicit app_users membership row.

insert into organizations (id, name, slug, timezone)
values (
  '00000000-0000-0000-0000-000000000001',
  'DummDumm Inc.',
  'dummdumm',
  'Asia/Seoul'
)
on conflict (id) do nothing;
