-- Seed the real channel/account structure for DummDumm.
-- Accounts are distinct rows; post FORMATS (longform/shorts, carousel/reels,
-- page, ...) live on published_posts.format, not here — one account can post
-- multiple formats. account_key is the stable English key; display_name is the
-- human (Korean) label shown in the UI.

insert into channel_accounts (org_id, channel, account_key, display_name)
values
  ('00000000-0000-0000-0000-000000000001', 'youtube',   'main',          'YouTube'),
  ('00000000-0000-0000-0000-000000000001', 'instagram', 'company',       '인스타그램 회사본계'),
  ('00000000-0000-0000-0000-000000000001', 'instagram', 'dummdumm-log',  '인스타그램 둠둠로그'),
  ('00000000-0000-0000-0000-000000000001', 'linkedin',  'main',          'LinkedIn'),
  ('00000000-0000-0000-0000-000000000001', 'naver',     'main',          '네이버 블로그'),
  ('00000000-0000-0000-0000-000000000001', 'website',   'kr',            '홈페이지 국문'),
  ('00000000-0000-0000-0000-000000000001', 'website',   'en',            '홈페이지 영문'),
  ('00000000-0000-0000-0000-000000000001', 'tiktok',    'main',          'TikTok')
on conflict (org_id, channel, account_key) do nothing;
