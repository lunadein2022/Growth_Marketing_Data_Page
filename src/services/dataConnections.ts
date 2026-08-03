import type { DataCenterSnapshot, DataSourceState } from "./adapters/types";

export type ApiConnectionId = "youtube" | "instagram" | "website";
export type FileImportChannel = "linkedin" | "tiktok" | "naver";

export const FILE_IMPORT_EXTENSIONS = [".xlsx", ".xls", ".csv", ".tsv"];

export const FILE_IMPORT_CHANNEL_LABELS: Record<FileImportChannel, string> = {
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  naver: "Naver Blog",
};

export type ApiConnectionRequirement = {
  id: ApiConnectionId;
  provider: "google" | "meta";
  label: string;
  accounts: string[];
  metrics: string[];
  scopes: string[];
  syncTargets: string[];
  requiredSecrets: string[];
};

export const API_CONNECTION_REQUIREMENTS: ApiConnectionRequirement[] = [
  {
    id: "youtube",
    provider: "google",
    label: "YouTube Analytics API",
    accounts: ["본계 Shorts", "본계 Longform"],
    metrics: ["구독자", "조회수", "시청시간", "평균 시청"],
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    syncTargets: ["channel_accounts", "published_posts", "metric_snapshots", "metric_time_series"],
    requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
  },
  {
    id: "instagram",
    provider: "meta",
    label: "Instagram Graph API",
    accounts: ["회사 본계 Carousel/Reels", "둠둠로그 Carousel/Reels"],
    metrics: ["팔로워", "도달", "조회", "저장", "공유"],
    scopes: ["instagram_basic", "instagram_manage_insights", "pages_show_list"],
    syncTargets: ["channel_accounts", "published_posts", "metric_snapshots", "metric_time_series"],
    requiredSecrets: ["META_APP_ID", "META_APP_SECRET"],
  },
  {
    id: "website",
    provider: "google",
    label: "GA4 + Search Console",
    accounts: ["Website KR", "Website EN"],
    metrics: ["사용자", "세션", "검색어", "클릭", "노출", "문의"],
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ],
    syncTargets: ["channel_accounts", "published_posts", "metric_snapshots", "metric_time_series"],
    requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
  },
];

export const DATA_CONNECTION_SOURCES: DataSourceState[] = [
  {
    id: "google-youtube",
    label: "YouTube Analytics API",
    kind: "api",
    connectionGroup: "api",
    channels: ["본계 Shorts", "본계 Longform"],
    cadence: "일 1회 자동 동기화",
    status: "complete",
    lastSync: "2026.07.28 09:10",
    detail: "본계 Shorts/롱폼 성과를 API로 분리 수집합니다.",
  },
  {
    id: "meta-instagram",
    label: "Instagram Graph API",
    kind: "api",
    connectionGroup: "api",
    channels: ["회사 본계 Carousel/Reels", "둠둠로그 Carousel/Reels"],
    cadence: "일 1회 자동 동기화",
    status: "partial",
    lastSync: "2026.07.28 08:40",
    detail: "2개 계정과 포맷별 성과를 API로 수집합니다. 릴스 일부 지표는 권한에 따라 조건부입니다.",
  },
  {
    id: "google-website",
    label: "GA4 + Search Console",
    kind: "api",
    connectionGroup: "api",
    channels: ["Website KR", "Website EN"],
    cadence: "일 1회 자동 동기화",
    status: "complete",
    lastSync: "2026.07.28 09:00",
    detail: "국문/영문 속성을 분리해 유입, 검색어, 전환 신호를 API로 수집합니다.",
  },
  {
    id: "linkedin-file",
    label: "LinkedIn 파일 업로드",
    kind: "file",
    connectionGroup: "file",
    channels: ["게시물 성과 파일"],
    cadence: "월 1회 또는 필요 시 수동 업로드",
    status: "partial",
    lastSync: "2026.07.26 18:00",
    detail: "LinkedIn은 파일 첨부로 게시물 성과를 누적합니다.",
  },
  {
    id: "naver-file",
    label: "Naver Blog 파일 업로드",
    kind: "file",
    connectionGroup: "file",
    channels: ["필수 지표", "유입 분석", "분포/순위"],
    cadence: "월 1회 수동 업로드",
    status: "partial",
    lastSync: "2026.07.25 10:30",
    detail: "조회수, 유입분석, 순방문자수, 방문 횟수, 평균 사용 시간, 재방문율을 월간 파일로 적재합니다.",
  },
  {
    id: "tiktok-file",
    label: "TikTok 파일 업로드",
    kind: "file",
    connectionGroup: "file",
    channels: ["게시물 성과 파일"],
    cadence: "게시물 운영 시작 후 수동 업로드",
    status: "not_uploaded",
    lastSync: "아직 없음",
    detail: "현재 게시물이 없어 데이터는 받지 않습니다. 업로드 구조만 준비되어 있습니다.",
  },
];

export const DATA_CONNECTION_MAPPING_ROWS: DataCenterSnapshot["mappingRows"] = [
  {
    raw: "YouTube Analytics: subscribersGained",
    metric: "subscribers",
    transform: "계정 현재값 + 기간 증가분",
    platform: "YouTube",
  },
  {
    raw: "YouTube Analytics: views/watchTime/averageViewDuration",
    metric: "views_watch_time_avg_view",
    transform: "Shorts/롱폼 포맷별 집계",
    platform: "YouTube",
  },
  {
    raw: "Instagram Graph API: followers/reach/views/saves/shares",
    metric: "instagram_account_metrics",
    transform: "계정 + 포맷별 집계",
    platform: "Instagram",
  },
  {
    raw: "GA4: users/sessions/events",
    metric: "website_behavior",
    transform: "KR/EN 속성별 집계",
    platform: "Website",
  },
  {
    raw: "Search Console: queries/clicks/impressions",
    metric: "website_search_visibility",
    transform: "국문/영문 검색 성과 분리",
    platform: "Website",
  },
  { raw: "조회수", metric: "blog_views", transform: "숫자", platform: "Naver Blog" },
  { raw: "유입분석", metric: "traffic_sources", transform: "유입원별 분해", platform: "Naver Blog" },
  { raw: "순방문자수", metric: "unique_visitors", transform: "숫자", platform: "Naver Blog" },
  { raw: "방문 횟수", metric: "visit_count", transform: "숫자", platform: "Naver Blog" },
  { raw: "평균 사용 시간", metric: "avg_duration_seconds", transform: "시간 → 초", platform: "Naver Blog" },
  { raw: "재방문율", metric: "return_visit_rate", transform: "퍼센트", platform: "Naver Blog" },
  { raw: "신규 팔로워 수", metric: "new_followers", transform: "숫자", platform: "LinkedIn" },
  { raw: "동영상 조회수", metric: "video_views", transform: "숫자", platform: "TikTok" },
];

export const DATA_CONNECTION_ISSUES: DataCenterSnapshot["issues"] = [
  {
    severity: "warning",
    title: "TikTok 게시물 없음",
    detail: "TikTok은 파일 업로드형 채널이지만 아직 게시물이 없어 성과 수집 대상에서 제외됩니다.",
  },
  {
    severity: "info",
    title: "LinkedIn 파일 업로드형",
    detail: "LinkedIn은 API 자동 동기화 대상이 아니며, 업로드 파일의 원본 값을 기준으로 지표를 저장합니다.",
  },
  {
    severity: "warning",
    title: "Instagram 릴스 반복 재생 조건부",
    detail: "Instagram은 API 연결형입니다. 릴스 일부 지표는 Graph API 권한과 응답 가능 여부에 따라 표시합니다.",
  },
];

export function inferFileImportChannel(fileName: string): FileImportChannel | null {
  const source = fileName.toLowerCase();
  if (/linkedin|링크드인/.test(source)) return "linkedin";
  if (/tiktok|틱톡/.test(source)) return "tiktok";
  if (/naver|네이버|blog|블로그|원고|후기|추천|조회수|유입|순방문|방문|재방문|평균\s*사용|성연령|성\/연령|국가|공감|댓글|순위/.test(source)) return "naver";
  return null;
}
