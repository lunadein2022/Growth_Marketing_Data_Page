import {
  AlertCircle,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileText,
  FolderKanban,
  Gauge,
  LineChart,
  LogIn,
  LogOut,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Upload,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { channelMeta } from "./data/mockData";
import { createBrandDataProvider } from "./services/dataGateway";
import {
  hasAuthConfig,
  signInWithGoogle,
  signOutFromAuth,
  subscribeToAuthUser,
  type DashboardUser,
} from "./services/authClient";
import {
  persistImportedFilesToSupabase,
  type SupabaseImportPersistence,
} from "./services/supabaseFileImports";
import {
  canUseEdgeBriefings,
  generateBriefingViaEdge,
  type BriefingContext,
} from "./services/aiBriefings";
import {
  canUseAiBriefingHistory,
  loadAiBriefingHistory,
  saveAiBriefingHistory,
} from "./services/aiBriefingHistory";
import {
  FILE_IMPORT_CHANNEL_LABELS,
  FILE_IMPORT_EXTENSIONS,
  inferFileImportChannel,
  type FileImportChannel,
} from "./services/dataConnections";
import {
  applyDataCenterSyncStatus,
  canLoadDataCenterSyncStatus,
  loadDataCenterSyncStatus,
} from "./services/dataCenterSyncStatus";
import {
  canSyncYoutubeAnalytics,
  syncYoutubeAnalytics,
  type YoutubeSyncState,
} from "./services/youtubeSync";
import {
  canSyncInstagramAnalytics,
  syncInstagramAnalytics,
  type InstagramSyncState,
} from "./services/instagramSync";
import {
  applyYoutubeChannelPatch,
  applyYoutubeContentToContentLab,
  buildYoutubeKpisFromContent,
  canLoadYoutubeChannelData,
  loadYoutubeChannelPatch,
} from "./services/youtubeChannelData";
import {
  applyInstagramChannelPatch,
  applyInstagramContentToContentLab,
  buildInstagramKpisFromContent,
  canLoadInstagramChannelData,
  loadInstagramChannelPatch,
} from "./services/instagramChannelData";
import {
  applyLinkedinChannelPatch,
  applyLinkedinContentToContentLab,
  canLoadLinkedinChannelData,
  loadLinkedinChannelPatch,
  persistLinkedinReport,
} from "./services/linkedinChannelData";
import { parseLinkedinFiles } from "./services/linkedinParser";
import {
  applyWebsiteChannelPatch,
  applyWebsiteContentToContentLab,
  canLoadWebsiteChannelData,
  loadWebsiteChannelPatch,
} from "./services/websiteChannelData";
import {
  canSyncWebsiteAnalytics,
  syncWebsiteAnalytics,
  type WebsiteSyncState,
} from "./services/websiteSync";
import {
  applyCommandCenterPatch,
  canLoadCommandCenterData,
  loadCommandCenterPatch,
} from "./services/commandCenterData";
import {
  canComparePeriods,
  computePeriodComparison,
  type DateRange,
} from "./services/periodComparison";
import {
  canUsePressBoard,
  createPressRelease,
  deletePressRelease,
  listPressReleases,
  pressImageUrl,
  updatePressCoverage,
  updatePressRelease,
  uploadPressImages,
  type PressCoverage,
  type PressRelease,
} from "./services/pressReleases";
import { parseNaverMonthlyImport, type NaverMonthlyReport } from "./services/naverMonthlyParser";
import {
  canLoadSavedNaverMonthlyReports,
  loadSavedNaverMonthlyReports,
} from "./services/naverMonthlyReports";
import type {
  AdContent,
  AiBriefing,
  BriefingRequest,
  ChannelMetric,
  ChannelId,
  ChannelView,
  CommandCenterSnapshot,
  CompareGranularity,
  ContentItem,
  ContentLabSnapshot,
  CampaignRow,
  DataCenterSnapshot,
  DataStatus,
  PeriodComparison,
  PeriodMode,
  PublishingItem,
  TrendPoint,
} from "./services/adapters/types";

type AppView = "command" | "channels" | "content" | "data" | "press";
type ContentTab = "publishing" | "pipeline" | "campaigns" | "ads" | "archive";
type PublishingCalendarMode = "week" | "month";
type ChannelFilterGroup = { label: string; options: string[] };
type ChannelTrendMetric = {
  label: string;
  color: string;
  points: TrendPoint[];
  formatValue: (value: number) => string;
};
type NaverDetailTab = "required" | "traffic" | "segments" | "validation";
type OperatingTask = {
  id: string;
  title: string;
  detail: string;
  tone: "danger" | "warning" | "good";
  icon: React.ElementType;
};
type ReuseRecommendation = {
  id: string;
  source: ContentItem;
  targets: Array<Exclude<ChannelId, "all">>;
  reason: string;
};
type ParsedFileImportItem = {
  id: string;
  sourceFileName: string;
  channel: FileImportChannel;
  title: string;
  type: string;
  metricLabel: string;
  metricValue: string;
};
type DataFileImportResult = {
  id: string;
  importedAt: string;
  totalFiles: number;
  channelCounts: Record<FileImportChannel, number>;
  items: ParsedFileImportItem[];
  naverMonthlyReport?: NaverMonthlyReport | null;
  naverMonthlyReports?: NaverMonthlyReport[];
};
type PaginationState<T> = {
  page: number;
  totalPages: number;
  totalItems: number;
  start: number;
  end: number;
  pagedItems: T[];
  setPage: (page: number) => void;
};
type PublishingCalendarEvent = {
  id: string;
  title: string;
  channel: Exclude<ChannelId, "all">;
  type: string;
  date: Date;
  time?: string;
  status: "published" | "scheduled" | "today" | "delayed";
  locked: boolean;
  metric?: string;
  source: "content" | "rule";
};

const provider = createBrandDataProvider();
const PAGE_SIZE = 10;
const CHANNEL_ORDER_STORAGE_KEY = "dummdumm-channel-order";
const TODAY = new Date(2026, 6, 29);
const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

const statusLabel: Record<DataStatus, string> = {
  complete: "정상",
  partial: "일부 데이터",
  not_uploaded: "미등록",
  unavailable: "N/A",
  error: "오류",
};

const navItems: Array<{ id: AppView; label: string; icon: React.ElementType }> = [
  { id: "command", label: "Command Center", icon: Gauge },
  { id: "channels", label: "Channels", icon: BarChart3 },
  { id: "content", label: "Content Lab", icon: FolderKanban },
  { id: "data", label: "Data Center", icon: Database },
  { id: "press", label: "보도자료", icon: Megaphone },
];

const contentTabs: Array<{ id: ContentTab; label: string; icon: React.ElementType }> = [
  { id: "publishing", label: "발행", icon: CalendarDays },
  { id: "pipeline", label: "파이프라인", icon: FolderKanban },
  { id: "campaigns", label: "캠페인", icon: LineChart },
  { id: "ads", label: "광고", icon: Megaphone },
  { id: "archive", label: "아카이브", icon: FileText },
];

const channelFilterGroups: Record<Exclude<ChannelId, "all">, ChannelFilterGroup[]> = {
  youtube: [{ label: "포맷", options: ["전체", "쇼츠", "롱폼"] }],
  instagram: [
    { label: "계정", options: ["전체", "본계", "둠둠로그"] },
    { label: "포맷", options: ["전체", "캐러셀", "릴스"] },
  ],
  website: [
    { label: "속성", options: ["전체", "KR", "EN"] },
    { label: "분석", options: ["전체", "검색"] },
  ],
  linkedin: [{ label: "범위", options: ["전체", "게시물", "팔로워"] }],
  naver: [],
  tiktok: [{ label: "범위", options: ["전체", "계정 성과", "영상 성과"] }],
};

const RULE_TIME_STORAGE_KEY = "dummdumm.ruleTimes";

function readStoredRuleTimes(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RULE_TIME_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeStoredRuleTimes(times: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RULE_TIME_STORAGE_KEY, JSON.stringify(times));
  } catch {
    /* ignore storage errors */
  }
}

function readStoredChannelOrder(): Array<Exclude<ChannelId, "all">> {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHANNEL_ORDER_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (value): value is Exclude<ChannelId, "all"> =>
        typeof value === "string" && Object.prototype.hasOwnProperty.call(channelFilterGroups, value),
    );
  } catch {
    return [];
  }
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function startOfWeek(date: Date) {
  const base = startOfDay(date);
  const mondayOffset = (base.getDay() + 6) % 7;
  return addDays(base, -mondayOffset);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function isSameDay(a: Date, b: Date) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function isBeforeDay(a: Date, b: Date) {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

function isWithinRange(date: Date, start: Date, end: Date) {
  const time = startOfDay(date).getTime();
  return time >= startOfDay(start).getTime() && time <= startOfDay(end).getTime();
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCalendarTitle(date: Date, mode: PublishingCalendarMode) {
  if (mode === "month") return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}

function getBriefingPeriodRange(periodMode: PeriodMode) {
  if (periodMode === "monthly") {
    return {
      start: formatDateKey(startOfMonth(TODAY)),
      end: formatDateKey(endOfMonth(TODAY)),
    };
  }

  const start = startOfWeek(TODAY);
  return {
    start: formatDateKey(start),
    end: formatDateKey(addDays(start, 6)),
  };
}

function formatBriefingPeriodLabel(periodMode: PeriodMode) {
  const range = getBriefingPeriodRange(periodMode);
  return periodMode === "weekly" ? `${range.start} ~ ${range.end}` : `${range.start.slice(0, 7)}`;
}

function mergeBriefingHistory(incoming: AiBriefing[], current: AiBriefing[]) {
  const byKey = new Map<string, AiBriefing>();
  [...incoming, ...current].forEach((item) => {
    const key = `${item.generatedAt}|${item.title}|${item.summary}`;
    if (!byKey.has(key)) byKey.set(key, item);
  });

  return Array.from(byKey.values()).slice(0, 60);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function buildLocalBriefingFromContext(
  request: BriefingRequest,
  context: BriefingContext,
  errorDetail?: string,
): AiBriefing {
  const figures = context.figures ?? {};
  const channelFigure = asRecord(figures.channel);
  const commandFigure = asRecord(figures.command);
  const kpis = asRecordArray(channelFigure.kpis ?? commandFigure.kpis);
  const topContent = asRecordArray(channelFigure.topContent);
  const periodLabel = context.periodLabel ?? formatBriefingPeriodLabel(request.periodMode);
  const target =
    asText(channelFigure.name) ||
    request.ad ||
    request.campaign ||
    (request.channel ? channelMeta[request.channel].label : "Brand Command Center");
  const evidence = [
    ...kpis.map((kpi) => {
      const secondary = asText(kpi.secondary);
      return `${asText(kpi.label)}: ${asText(kpi.value)}${secondary ? ` (${secondary})` : ""}`;
    }),
    ...topContent.map((item) => `${asText(item.title)}: ${asText(item.metric)}`),
  ].filter(Boolean).slice(0, 4);
  const primaryKpi = evidence[0] ?? "현재 화면의 집계 지표";
  const dataWarnings = [
    ...(errorDetail ? [`Claude 응답 형식 문제로 현재 화면 데이터 기반 요약으로 대체했습니다: ${errorDetail}`] : []),
    ...(context.dataWarnings ?? []),
  ].slice(0, 6);

  return {
    title: `${target} ${request.periodMode === "weekly" ? "주간" : "월간"} AI 보고서`,
    generatedAt: formatImportTimestamp(),
    periodLabel,
    dataSources: (context.dataSources?.length ? context.dataSources : ["현재 화면 집계"]).slice(0, 8),
    dataWarnings,
    summary: `${target} 보고서는 현재 화면에 집계된 실제 지표를 기준으로 생성했습니다. 우선 확인할 기준값은 ${primaryKpi}입니다.`,
    wins: evidence.length
      ? evidence.slice(0, 3).map((item) => `${item} 기준으로 성과 확인이 가능합니다.`)
      : ["현재 화면에 집계된 지표 기준으로 성과를 확인할 수 있습니다."],
    risks: dataWarnings.length
      ? dataWarnings.slice(0, 3)
      : ["일부 지표는 API나 파일 업로드 범위에 따라 누락될 수 있으므로 데이터 출처를 함께 확인해야 합니다."],
    actions: [
      topContent[0]
        ? `${asText(topContent[0].title)} 콘텐츠의 지표를 먼저 확인하고 재활용 또는 후속 게시 여부를 판단합니다.`
        : "가장 중요한 KPI를 기준으로 상승/하락 원인을 먼저 확인합니다.",
      "누락 또는 일부 데이터로 표시된 항목은 Data Center에서 연결 상태를 먼저 확인합니다.",
      "성과가 좋은 콘텐츠는 캠페인 또는 광고 원본 콘텐츠로 연결해 후속 성과를 기록합니다.",
    ],
    evidence: evidence.length ? evidence : ["현재 화면 집계 데이터"],
  };
}

function parseContentDate(value: string) {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));

  const compactMatch = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!compactMatch) return null;
  return new Date(TODAY.getFullYear(), Number(compactMatch[1]) - 1, Number(compactMatch[2]));
}

function formatImportTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}.${month}.${day} ${hour}:${minute}`;
}

function cleanImportedTitle(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getParsedImportMetric(channel: FileImportChannel, seed: number) {
  if (channel === "linkedin") {
    return { metricLabel: "노출", metricValue: (6800 + seed * 37).toLocaleString("ko-KR") };
  }

  if (channel === "tiktok") {
    return { metricLabel: "조회", metricValue: `${Math.max(18, Math.round((86000 + seed * 970) / 1000))}K` };
  }

  return { metricLabel: "조회수", metricValue: (2400 + seed * 23).toLocaleString("ko-KR") };
}

function buildDataFileImportResult(files: File[]): DataFileImportResult {
  const items = files.flatMap((file, index): ParsedFileImportItem[] => {
    const channel = inferFileImportChannel(file.name);
    if (!channel) return [];

    const metric = getParsedImportMetric(channel, Math.max(1, Math.round(file.size / 1024) + index));
    const type: Record<FileImportChannel, string> = {
      linkedin: "Card",
      tiktok: "Short",
      naver: "Blog",
    };

    return [{
      id: `import-${Date.now()}-${index}`,
      sourceFileName: file.name,
      channel,
      title: cleanImportedTitle(file.name) || `${channelMeta[channel].label} 업로드 콘텐츠`,
      type: type[channel],
      ...metric,
    }];
  });

  return {
    id: `import-batch-${Date.now()}`,
    importedAt: formatImportTimestamp(),
    totalFiles: files.length,
    channelCounts: {
      linkedin: items.filter((item) => item.channel === "linkedin").length,
      tiktok: items.filter((item) => item.channel === "tiktok").length,
      naver: items.filter((item) => item.channel === "naver").length,
    },
    items,
  };
}

function isParsedPostRecord(item: ParsedFileImportItem) {
  return item.type === "PostRecord";
}

function formatImportedPeriodDate(periodKey: string) {
  const [, month] = periodKey.split("-");
  return `${Number(month) || TODAY.getMonth() + 1}/${new Date(Number(periodKey.slice(0, 4)) || TODAY.getFullYear(), Number(month) || TODAY.getMonth() + 1, 0).getDate()}`;
}

function extractRankingMetricValue(value: string) {
  const afterRank = value.match(/·\s*([\d,]+)/);
  if (afterRank) return afterRank[1];
  return value.match(/[\d,]+/)?.[0] ?? value;
}

function getNaverReportsFromImport(result: DataFileImportResult) {
  if (result.naverMonthlyReports?.length) return result.naverMonthlyReports;
  return result.naverMonthlyReport ? [result.naverMonthlyReport] : [];
}

function formatNaverReportRangeLabel(reports: NaverMonthlyReport[]) {
  if (!reports.length) return "";

  const sorted = [...reports].sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  return first.periodKey === last.periodKey ? first.periodLabel : `${first.periodLabel}~${last.periodLabel}`;
}

function mergeNaverMonthlyReports(current: NaverMonthlyReport[], incoming: NaverMonthlyReport[]) {
  const byPeriod = new Map(current.map((report) => [report.periodKey, report]));
  incoming.forEach((report) => byPeriod.set(report.periodKey, report));
  return Array.from(byPeriod.values()).sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}

function applyImportToDataCenter(data: DataCenterSnapshot, result: DataFileImportResult): DataCenterSnapshot {
  const importedChannels = new Set<FileImportChannel>(result.items.map((item) => item.channel));
  const naverReport = result.naverMonthlyReport;
  const naverReports = getNaverReportsFromImport(result);
  if (naverReports.length) importedChannels.add("naver");
  const naverRangeLabel = formatNaverReportRangeLabel(naverReports);
  const naverCompleteRequired =
    naverReport?.validationRows.filter((row) => row.type === "필수" && row.status === "complete").length ?? 0;
  const summary = (Object.entries(result.channelCounts) as Array<[FileImportChannel, number]>)
    .filter(([, count]) => count > 0)
    .map(([channel, count]) => `${channelMeta[channel].label} ${count}건`)
    .join(" · ");

  const sourceMatchesChannel = (sourceText: string, channel: FileImportChannel) => {
    if (channel === "linkedin") return /linkedin|링크드인/.test(sourceText);
    if (channel === "tiktok") return /tiktok|틱톡/.test(sourceText);
    return /naver|blog|네이버|블로그/.test(sourceText);
  };

  return {
    ...data,
    sources: data.sources.map((source) => {
      const sourceText = `${source.id} ${source.label} ${source.detail}`.toLowerCase();
      const matchedChannel = Array.from(importedChannels).find((channel) => sourceMatchesChannel(sourceText, channel));
      if (!matchedChannel) return source;

      return {
        ...source,
        status: matchedChannel === "naver" && naverReport && naverCompleteRequired < 6 ? "partial" : "complete",
        lastSync: result.importedAt,
        detail:
          matchedChannel === "naver" && naverReport
            ? `${naverRangeLabel} ${naverReports.length}개월 적재 · 화면 대표 ${naverReport.periodLabel} 필수 ${naverCompleteRequired}/6개 파싱`
            : `${channelMeta[matchedChannel].label} 업로드 ${result.channelCounts[matchedChannel]}건 저장 · 지표 소스 갱신`,
      };
    }),
    issues: [
      ...(naverReport
        ? [
            {
              severity: naverReport.parseWarnings.length ? ("warning" as const) : ("info" as const),
              title: "네이버 월간 파일 파싱",
              detail: naverReport.parseWarnings.length
                ? `${naverRangeLabel} ${naverReports.length}개월 적재 · 최신 ${naverReport.periodLabel}: ${naverReport.parseWarnings.join(" · ")}`
                : `${naverRangeLabel} ${naverReports.length}개월 월별 데이터를 파싱해 네이버 지표 소스에 반영했습니다.`,
            },
          ]
        : []),
      {
        severity: "info",
        title: "파일 저장 완료",
        detail: `${result.totalFiles}개 파일을 ${summary || "파일 업로드 채널"} 데이터 소스로 저장했습니다. 콘텐츠 리스트에는 게시물 단위로 파싱된 레코드만 추가합니다.`,
      },
      ...data.issues,
    ],
    mappingRows: [
      ...result.items.map((item) => ({
        platform: channelMeta[item.channel].label,
        raw: item.channel === "naver" ? "네이버 월간 필수 지표" : `${item.type} 업로드 성과`,
        metric:
          item.channel === "naver"
            ? "blog_monthly_required_metrics"
            : item.metricLabel === "노출"
              ? "impressions"
              : "content_views",
        transform:
          item.channel === "naver"
            ? "조회수·유입분석·순방문자수·방문 횟수·평균 사용 시간·재방문율"
            : "파일 저장 → 게시물 단위 파서 대기",
      })),
      ...data.mappingRows,
    ],
  };
}

function applyNaverMonthlyReportToChannels(channels: ChannelView[], report: NaverMonthlyReport | null | undefined) {
  if (!report) return channels;

  const rankingContent: ContentItem[] = report.rankingRows
    .filter((row) => !row.title.includes("파일 연결") && !row.title.includes("확인 필요"))
    .map((row, index) => ({
      id: `naver-ranking-${report.periodKey}-${index}`,
      title: row.title,
      channel: "naver",
      type: "Blog",
      status: row.metric,
      campaign: "파일 업로드",
      publishDate: formatImportedPeriodDate(report.periodKey),
      metricLabel: row.metric.replace(" 순위", ""),
      metricValue: extractRankingMetricValue(row.value),
      performanceSource: `${report.periodLabel} 네이버 순위 파일`,
    }));

  return channels.map((channel) => {
    if (channel.id !== "naver") return channel;
    const existingContent = channel.topContent.filter((item) => !item.id.startsWith("naver-ranking-"));

    return {
      ...channel,
      updatedAt: `${report.importedAt} 갱신`,
      source: "Naver Blog 월간 파일",
      kpis: report.requiredMetrics.map((item) =>
        metric(item.label, item.value, item.delta === "파일값" ? "업로드" : item.delta, item.status),
      ),
      trend: report.metricTimeSeries.views ?? channel.trend,
      trendSeries: Object.fromEntries(
        report.requiredMetrics
          .map((item) => [item.label, report.metricTimeSeries[item.key]] as const)
          .filter(([, points]) => Boolean(points)),
      ),
      topContent: rankingContent.length ? [...rankingContent, ...existingContent] : existingContent,
      dataNote: `${report.periodLabel} 네이버 월간 파일 ${report.sourceFiles.length}개 기준입니다. 파일에서 찾은 값만 완료로 표시합니다.`,
    };
  });
}

function applySavedNaverReportsToDataCenter(data: DataCenterSnapshot, reports: NaverMonthlyReport[]): DataCenterSnapshot {
  if (!reports.length) return data;

  const latest = reports[reports.length - 1];
  const completeRequired = latest.validationRows.filter((row) => row.type === "필수" && row.status === "complete").length;
  const rangeLabel = formatNaverReportRangeLabel(reports);

  return {
    ...data,
    sources: data.sources.map((source) => {
      const sourceText = `${source.id} ${source.label} ${source.detail}`.toLowerCase();
      if (!/naver|blog|네이버|블로그/.test(sourceText)) return source;

      return {
        ...source,
        status: latest.parseWarnings.length ? ("partial" as const) : ("complete" as const),
        lastSync: latest.importedAt,
        detail: `Supabase 저장 데이터 ${rangeLabel} ${reports.length}개월 · 최신 ${latest.periodLabel} 필수 ${completeRequired}/6개`,
      };
    }),
  };
}

function applyImportToContentLab(data: ContentLabSnapshot, result: DataFileImportResult): ContentLabSnapshot {
  const postRecords = result.items.filter(isParsedPostRecord);
  if (!postRecords.length) return data;

  const nextItems: ContentItem[] = postRecords.map((item) => ({
    id: item.id,
    title: item.title,
    channel: item.channel,
    type: item.type,
    status: "발행됨",
    campaign: "파일 업로드",
    publishDate: formatShortDate(TODAY),
    metricLabel: item.metricLabel,
    metricValue: item.metricValue,
    performanceSource: "파일 업로드 게시물 파싱",
    decisionLogs: [`${result.importedAt} · 파일 업로드에서 자동 파싱되어 성과 데이터에 반영`],
  }));

  return {
    ...data,
    archive: [...nextItems, ...data.archive],
  };
}

function applyImportToChannels(channels: ChannelView[], result: DataFileImportResult): ChannelView[] {
  return channels.map((channel) => {
    if (channel.id !== "linkedin" && channel.id !== "tiktok" && channel.id !== "naver") return channel;

    const imported = result.items.filter((item) => item.channel === channel.id);
    if (!imported.length) return channel;

    const postRecords = imported.filter(isParsedPostRecord);
    const importedContent: ContentItem[] = postRecords.map((item) => ({
      id: item.id,
      title: item.title,
      channel: item.channel,
      type: item.type,
      status: "파일 업로드 반영",
      campaign: "파일 업로드",
      publishDate: formatShortDate(TODAY),
      metricLabel: item.metricLabel,
      metricValue: item.metricValue,
      performanceSource: "파일 업로드 게시물 파싱",
    }));

    return {
      ...channel,
      updatedAt: `${result.importedAt} 갱신`,
      source: channel.source.includes("파일 업로드") ? channel.source : `${channel.source} + 파일 업로드`,
      topContent: importedContent.length ? [...importedContent, ...channel.topContent] : channel.topContent,
      dataNote: importedContent.length
        ? `${channel.dataNote} 파일 업로드 ${importedContent.length}건이 게시물 단위로 파싱되어 현재 성과 목록에 반영되었습니다.`
        : `${channel.dataNote} 파일 업로드 ${imported.length}건은 데이터 소스로 저장했고, 콘텐츠 리스트에는 게시물 단위 파싱 결과만 반영합니다.`,
    };
  });
}

function getCampaignKeyFromName(name?: string) {
  if (!name || name === "캠페인 없음") return undefined;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getCampaignIdByName(campaigns: CampaignRow[], name?: string) {
  if (!name || name === "캠페인 없음") return undefined;
  return campaigns.find((campaign) => campaign.campaign === name)?.id ?? `camp-${getCampaignKeyFromName(name)}`;
}

function contentBelongsToCampaign(item: ContentItem, campaign: CampaignRow) {
  return item.campaignId === campaign.id || (!item.campaignId && item.campaign === campaign.campaign);
}

function adBelongsToCampaign(ad: AdContent, campaign: CampaignRow) {
  return ad.campaignId === campaign.id || (!ad.campaignId && ad.campaign === campaign.campaign);
}

function parsePeriodEndDate(period: string) {
  const [, rawEnd] = period.split("-").map((value) => value.trim());
  return rawEnd ? parseContentDate(rawEnd) : null;
}

function getOperatingTasks(snapshot: CommandCenterSnapshot, contentLab: ContentLabSnapshot): OperatingTask[] {
  const tasks: OperatingTask[] = [];
  const delayed = snapshot.publishing.filter((item) => item.status === "delayed");
  const allContent = [...contentLab.archive, ...contentLab.pipeline];
  const surged = allContent
    .filter(hasCollectedPerformance)
    .sort((a, b) => parseMetricScore(b.metricValue) - parseMetricScore(a.metricValue))[0];
  const endingAds = contentLab.ads.filter((ad) => {
    const endDate = parsePeriodEndDate(ad.period);
    if (!endDate || ad.status === "ended") return false;
    const daysLeft = Math.ceil((startOfDay(endDate).getTime() - startOfDay(TODAY).getTime()) / 86400000);
    return daysLeft >= 0 && daysLeft <= 7;
  });

  delayed.slice(0, 2).forEach((item) => {
    tasks.push({
      id: `delayed-${item.id}`,
      title: `${channelMeta[item.channel].label} 지연 발행 처리`,
      detail: `${item.title} · ${item.time} 슬롯 재배치 필요`,
      tone: "danger",
      icon: Bell,
    });
  });

  if (surged) {
    tasks.push({
      id: `surge-${surged.id}`,
      title: "성과 급등 콘텐츠 확인",
      detail: `${surged.title} · ${surged.metricValue} ${surged.metricLabel}`,
      tone: "good",
      icon: LineChart,
    });
  }

  endingAds.slice(0, 2).forEach((ad) => {
    const endDate = parsePeriodEndDate(ad.period);
    const daysLeft = endDate ? Math.max(0, Math.ceil((startOfDay(endDate).getTime() - startOfDay(TODAY).getTime()) / 86400000)) : 0;
    tasks.push({
      id: `ad-ending-${ad.id}`,
      title: "광고 종료 임박",
      detail: `${ad.title} · ${daysLeft}일 후 종료 · CTR ${ad.ctr}`,
      tone: "warning",
      icon: Megaphone,
    });
  });

  return tasks.slice(0, 5);
}

function getReuseRecommendations(contentLab: ContentLabSnapshot): ReuseRecommendation[] {
  return [...contentLab.archive, ...contentLab.pipeline]
    .filter((item) => item.channel === "youtube" && contentMatchesType(item, ["short"]) && hasCollectedPerformance(item))
    .sort((a, b) => parseMetricScore(b.metricValue) - parseMetricScore(a.metricValue))
    .slice(0, 3)
    .map((source) => ({
      id: `reuse-${source.id}`,
      source,
      targets: ["instagram", "tiktok", "naver"],
      reason: `${source.metricValue} ${source.metricLabel} 기준 상위 Shorts입니다.`,
    }));
}

function getBriefingWarnings(channels: ChannelView[], dataCenter?: DataCenterSnapshot, targetChannel?: Exclude<ChannelId, "all">) {
  const scopedChannels = targetChannel ? channels.filter((channel) => channel.id === targetChannel) : channels;
  const targetLabel = targetChannel ? channelMeta[targetChannel].label : "";
  const metricWarnings = scopedChannels.flatMap((channel) =>
    channel.kpis
      .filter((kpi) => kpi.status === "partial" || kpi.status === "unavailable" || kpi.value === "N/A")
      .map((kpi) => `${channel.name} ${kpi.label}은 ${statusLabel[kpi.status]} 상태입니다.`),
  );
  const sourceWarnings =
    dataCenter?.issues
      .filter((issue) => issue.severity !== "info")
      .filter((issue) => {
        if (!targetChannel) return true;
        const source = `${issue.title} ${issue.detail}`.toLowerCase();
        const label = targetLabel.toLowerCase();
        return source.includes(targetChannel) || source.includes(label);
      })
      .map((issue) => `${issue.title}: ${issue.detail}`) ?? [];

  return [...metricWarnings, ...sourceWarnings].slice(0, 4);
}

function getWeekdayLabel(date: Date) {
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function firstOfMonthUtc(iso: string): Date {
  const parsed = new Date(`${iso}T00:00:00Z`);
  const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
}

// Default compare ranges: current = last full calendar month, previous = the month before.
function defaultCompareRanges() {
  const now = new Date();
  const curEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const curStart = new Date(Date.UTC(curEnd.getUTCFullYear(), curEnd.getUTCMonth(), 1));
  const prevEnd = new Date(Date.UTC(curStart.getUTCFullYear(), curStart.getUTCMonth(), 0));
  const prevStart = new Date(Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), 1));
  return {
    curStart: curStart.toISOString().slice(0, 10),
    curEnd: curEnd.toISOString().slice(0, 10),
    prevStart: prevStart.toISOString().slice(0, 10),
    prevEnd: prevEnd.toISOString().slice(0, 10),
  };
}

const comparisonDetailOptions: Record<ChannelId, string[]> = {
  all: ["채널 기여도", "브랜드 노출", "콘텐츠 소비", "검색 가시성"],
  youtube: ["전체", "쇼츠", "롱폼"],
  instagram: ["본계 전체", "본계 캐러셀", "본계 릴스", "둠둠로그 전체", "둠둠로그 캐러셀", "둠둠로그 릴스"],
  website: ["전체", "KR", "EN", "검색"],
  linkedin: ["전체", "게시물", "팔로워"],
  naver: ["전체", "필수 지표", "유입분석", "분포·순위"],
  tiktok: ["전체", "계정 성과", "영상 성과"],
};

const baselineOptions: Record<CompareGranularity, string[]> = {
  week: ["지난주", "2주 전", "4주 전", "작년 같은 주"],
  month: ["2026년 6월 (지난달)", "2026년 4월 (3개월 전)", "2026년 1월 (반년 전)", "2025년 7월 (작년 이맘때)", "2025년 (작년 전체)"],
  year: ["2025년", "2024년", "최근 3년 평균", "사용자 지정 기준연도"],
};

const naverDetailTabs: Array<{ id: NaverDetailTab; label: string }> = [
  { id: "required", label: "필수 지표" },
  { id: "traffic", label: "유입분석" },
  { id: "segments", label: "분포·순위" },
  { id: "validation", label: "파일 검증" },
];

const naverRequiredMetrics = [
  { label: "조회수", value: "5,400", delta: "+10%", note: "월간 전체 조회 합계" },
  { label: "유입분석", value: "54%", delta: "+13%", note: "검색 유입 비중 · 외부/직접 분해" },
  { label: "순방문자수", value: "3,860", delta: "+8%", note: "중복 방문자를 제거한 사용자" },
  { label: "방문 횟수", value: "4,920", delta: "+9%", note: "반복 방문을 포함한 세션" },
  { label: "평균 사용 시간", value: "1:42", delta: "+6%", note: "방문당 평균 체류" },
  { label: "재방문율", value: "18%", delta: "+2%", note: "다시 들어온 방문 비중" },
];

const naverTrafficSources = [
  { label: "검색 유입", value: "2,142", share: 54, delta: "+13%" },
  { label: "외부 링크", value: "824", share: 21, delta: "+7%" },
  { label: "직접 유입", value: "611", share: 15, delta: "+5%" },
  { label: "기타", value: "401", share: 10, delta: "-2%" },
];

const naverDistributionRows = [
  { label: "35-44세", value: "36%", detail: "가장 높은 연령대" },
  { label: "25-34세", value: "28%", detail: "두 번째 반응군" },
  { label: "대한민국", value: "94%", detail: "국가별 분포 1위" },
  { label: "미국", value: "3%", detail: "영문 검색 보조 신호" },
];

const naverRankingRows = [
  { metric: "조회수 순위", title: "Hydro Hawk 실증 후기", value: "1위 · 5,400 조회" },
  { metric: "공감수 순위", title: "B2B 도입사례 정리", value: "3위 · 86 공감" },
  { metric: "댓글수 순위", title: "팀 문화 인터뷰", value: "5위 · 24 댓글" },
];

const naverFileValidationRows: NaverMonthlyReport["validationRows"] = [
  { label: "조회수", type: "필수", status: "complete" as DataStatus },
  { label: "유입분석", type: "필수", status: "complete" as DataStatus },
  { label: "순방문자수", type: "필수", status: "complete" as DataStatus },
  { label: "방문 횟수", type: "필수", status: "complete" as DataStatus },
  { label: "평균 사용 시간", type: "필수", status: "complete" as DataStatus },
  { label: "재방문율", type: "필수", status: "complete" as DataStatus },
  { label: "성/연령별 분포", type: "선택", status: "partial" as DataStatus },
  { label: "국가별 분포", type: "선택", status: "partial" as DataStatus },
  { label: "조회수 순위", type: "선택", status: "complete" as DataStatus },
  { label: "공감수 순위", type: "선택", status: "partial" as DataStatus },
  { label: "댓글수 순위", type: "선택", status: "partial" as DataStatus },
];

const initialBriefingHistory: AiBriefing[] = [
  {
    title: "Brand Command Center 주간 AI 보고서",
    generatedAt: "2026.07.22 18:05",
    periodLabel: "2026년 7월 3주차",
    dataSources: ["YouTube Analytics API", "Instagram Graph API", "GA4", "Search Console"],
    dataWarnings: ["LinkedIn 선택 지표는 미등록 상태였습니다."],
    summary: "Hydro Hawk 실증 소재가 검색과 SNS 소비를 동시에 끌어올렸고, 발행 지연은 없었습니다.",
    wins: ["Website 검색 클릭 상승", "Instagram 저장률 개선"],
    risks: ["TikTok 파일 업로드가 지연되었습니다."],
    actions: ["Hydro Hawk 소재를 Naver Blog로 확장", "LinkedIn 카드뉴스 예약"],
    evidence: ["Website 검색 클릭 +14%", "Instagram 저장 +18%"],
  },
  ...Array.from({ length: 24 }, (_, index): AiBriefing => ({
    title:
      index % 3 === 0
        ? "Brand Command Center 주간 AI 보고서"
        : index % 3 === 1
          ? "YouTube 채널 AI 브리핑"
          : "캠페인 성과 AI 분석",
    generatedAt: `2026.07.${String(1 + (index % 27)).padStart(2, "0")} ${String(10 + (index % 9)).padStart(2, "0")}:30`,
    periodLabel: index % 2 === 0 ? `2026년 7월 ${1 + (index % 4)}주차` : "2026년 7월",
    dataSources:
      index % 2 === 0
        ? ["YouTube Analytics API", "Instagram Graph API", "GA4"]
        : ["파일 업로드 채널", "연결된 게시물 성과", "Content Lab"],
    dataWarnings:
      index % 4 === 0
        ? ["일부 파일 업로드 채널은 부분 데이터 상태였습니다."]
        : ["미지원 지표는 N/A로 표시했습니다."],
    summary: `목업 보고서 ${index + 1}: 채널별 성과와 발행 흐름을 기준으로 다음 액션을 정리했습니다.`,
    wins: ["검색 가시성 개선", "상위 소재 재활용 가능성 확인"],
    risks: ["일부 데이터 소스의 갱신 시점이 다릅니다."],
    actions: ["상위 콘텐츠를 다른 채널로 재가공", "미등록 파일 업로드 상태 확인"],
    evidence: [`콘텐츠 소비 +${12 + (index % 18)}%`, `발행 연결 ${18 + index}건`],
  })),
];

function App() {
  const [activeView, setActiveView] = useState<AppView>("command");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("weekly");
  const [snapshot, setSnapshot] = useState<CommandCenterSnapshot | null>(null);
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [contentLab, setContentLab] = useState<ContentLabSnapshot | null>(null);
  const [dataCenter, setDataCenter] = useState<DataCenterSnapshot | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Exclude<ChannelId, "all">>("youtube");
  const [selectedContentTab, setSelectedContentTab] = useState<ContentTab>("publishing");
  const [compareOpen, setCompareOpen] = useState(false);
  const [briefing, setBriefing] = useState<AiBriefing | null>(null);
  const [briefingHistory, setBriefingHistory] = useState<AiBriefing[]>(initialBriefingHistory);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [importingFiles, setImportingFiles] = useState(false);
  const [lastFileImport, setLastFileImport] = useState<DataFileImportResult | null>(null);
  const [importPersistence, setImportPersistence] = useState<SupabaseImportPersistence | null>(null);
  const [youtubeSyncing, setYoutubeSyncing] = useState(false);
  const [youtubeSyncResult, setYoutubeSyncResult] = useState<YoutubeSyncState | null>(null);
  const [instagramSyncing, setInstagramSyncing] = useState(false);
  const [instagramSyncResult, setInstagramSyncResult] = useState<InstagramSyncState | null>(null);
  const [websiteSyncing, setWebsiteSyncing] = useState(false);
  const [websiteSyncResult, setWebsiteSyncResult] = useState<WebsiteSyncState | null>(null);
  const [authUser, setAuthUser] = useState<DashboardUser | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [naverMonthlyReport, setNaverMonthlyReport] = useState<NaverMonthlyReport | null>(null);
  const [naverMonthlyReports, setNaverMonthlyReports] = useState<NaverMonthlyReport[]>([]);
  const naverMonthlyReportRef = useRef<NaverMonthlyReport | null>(null);
  const naverMonthlyReportsRef = useRef<NaverMonthlyReport[]>([]);
  const youtubeChannelPatchRef = useRef<Partial<ChannelView> | null>(null);
  const instagramChannelPatchRef = useRef<Partial<ChannelView> | null>(null);
  const linkedinChannelPatchRef = useRef<Partial<ChannelView> | null>(null);
  const websiteChannelPatchRef = useRef<Partial<ChannelView> | null>(null);
  const authConfigured = hasAuthConfig();
  const channelDataSignature = useMemo(
    () => channels.map((channel) => `${channel.id}:${channel.updatedAt}:${channel.source}`).join("|"),
    [channels],
  );

  useEffect(() => {
    naverMonthlyReportRef.current = naverMonthlyReport;
  }, [naverMonthlyReport]);

  useEffect(() => {
    naverMonthlyReportsRef.current = naverMonthlyReports;
  }, [naverMonthlyReports]);

  useEffect(() => {
    let mounted = true;

    Promise.all([
      provider.getCommandCenterSnapshot(periodMode),
      provider.getChannels(periodMode),
      provider.getContentLabSnapshot(periodMode),
      provider.getDataCenterSnapshot(periodMode),
    ]).then(([command, channelList, lab, data]) => {
      if (!mounted) return;
      const savedNaverReport = naverMonthlyReportRef.current;
      const savedNaverReports = naverMonthlyReportsRef.current;
      setSnapshot(command);
      setChannels(savedNaverReport ? applyNaverMonthlyReportToChannels(channelList, savedNaverReport) : channelList);
      setContentLab(lab);
      setDataCenter(savedNaverReports.length ? applySavedNaverReportsToDataCenter(data, savedNaverReports) : data);
    });

    return () => {
      mounted = false;
    };
  }, [periodMode]);

  useEffect(() => subscribeToAuthUser(setAuthUser), []);

  useEffect(() => {
    if (!authUser || !canLoadYoutubeChannelData() || channels.length === 0) return;

    let mounted = true;

    loadYoutubeChannelPatch(periodMode)
      .then((patch) => {
        if (!mounted || !patch) return;
        youtubeChannelPatchRef.current = patch;
        setChannels((current) => applyYoutubeChannelPatch(current, patch));
        setContentLab((current) => (current ? applyYoutubeContentToContentLab(current, patch) : current));
      })
      .catch((error) => {
        console.warn("Saved YouTube channel data could not be loaded.", error);
      });

    return () => {
      mounted = false;
    };
  }, [authUser?.uid, periodMode, channels.length, channelDataSignature]);

  useEffect(() => {
    if (!authUser || !canLoadInstagramChannelData() || channels.length === 0) return;

    let mounted = true;

    loadInstagramChannelPatch(periodMode)
      .then((patch) => {
        if (!mounted || !patch) return;
        instagramChannelPatchRef.current = patch;
        setChannels((current) => applyInstagramChannelPatch(current, patch));
        setContentLab((current) => (current ? applyInstagramContentToContentLab(current, patch) : current));
      })
      .catch((error) => {
        console.warn("Saved Instagram channel data could not be loaded.", error);
      });

    return () => {
      mounted = false;
    };
  }, [authUser?.uid, periodMode, channels.length, channelDataSignature]);

  useEffect(() => {
    if (!authUser || !canLoadLinkedinChannelData() || channels.length === 0) return;

    let mounted = true;

    loadLinkedinChannelPatch(periodMode)
      .then((patch) => {
        if (!mounted || !patch) return;
        linkedinChannelPatchRef.current = patch;
        setChannels((current) => applyLinkedinChannelPatch(current, patch));
        setContentLab((current) => (current ? applyLinkedinContentToContentLab(current, patch) : current));
      })
      .catch((error) => {
        console.warn("Saved LinkedIn channel data could not be loaded.", error);
      });

    return () => {
      mounted = false;
    };
  }, [authUser?.uid, periodMode, channels.length, channelDataSignature]);

  useEffect(() => {
    if (!authUser || !canLoadWebsiteChannelData() || channels.length === 0) return;

    let mounted = true;

    loadWebsiteChannelPatch(periodMode)
      .then((patch) => {
        if (!mounted || !patch) return;
        websiteChannelPatchRef.current = patch;
        setChannels((current) => applyWebsiteChannelPatch(current, patch));
        setContentLab((current) => (current ? applyWebsiteContentToContentLab(current, patch) : current));
      })
      .catch((error) => {
        console.warn("Saved website channel data could not be loaded.", error);
      });

    return () => {
      mounted = false;
    };
  }, [authUser?.uid, periodMode, channels.length, channelDataSignature]);

  useEffect(() => {
    if (!authUser || !canLoadCommandCenterData() || !snapshot) return;

    let mounted = true;

    loadCommandCenterPatch(periodMode)
      .then((patch) => {
        if (!mounted || !patch) return;
        setSnapshot((current) => (current ? applyCommandCenterPatch(current, patch) : current));
      })
      .catch((error) => {
        console.warn("Command Center real data could not be loaded.", error);
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, periodMode, snapshot ? "ready" : "empty", channelDataSignature]);

  useEffect(() => {
    if (!authUser || !canLoadDataCenterSyncStatus()) return;

    let mounted = true;

    loadDataCenterSyncStatus()
      .then((patch) => {
        if (!mounted || !patch) return;
        setDataCenter((current) => (current ? applyDataCenterSyncStatus(current, patch) : current));
      })
      .catch((error) => {
        console.warn("Saved Data Center sync status could not be loaded.", error);
      });

    return () => {
      mounted = false;
    };
  }, [authUser?.uid, periodMode, dataCenter ? "ready" : "empty"]);

  useEffect(() => {
    if (!authUser || !canLoadSavedNaverMonthlyReports()) return;

    let mounted = true;

    loadSavedNaverMonthlyReports()
      .then((reports) => {
        if (!mounted || !reports.length) return;
        setNaverMonthlyReports((current) => mergeNaverMonthlyReports(current, reports));
        setNaverMonthlyReport(reports[reports.length - 1]);
      })
      .catch((error) => {
        console.warn("Saved Naver monthly reports could not be loaded.", error);
      });

    return () => {
      mounted = false;
    };
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser || !canUseAiBriefingHistory()) return;

    let mounted = true;

    loadAiBriefingHistory()
      .then((history) => {
        if (!mounted || !history.length) return;
        setBriefingHistory((current) => mergeBriefingHistory(history, current));
      })
      .catch((error) => {
        console.warn("Saved AI briefing history could not be loaded.", error);
      });

    return () => {
      mounted = false;
    };
  }, [authUser?.uid]);

  useEffect(() => {
    if (!naverMonthlyReport) return;

    setChannels((current) => applyNaverMonthlyReportToChannels(current, naverMonthlyReport));
  }, [naverMonthlyReport]);

  useEffect(() => {
    if (!naverMonthlyReports.length) return;

    setDataCenter((current) => (current ? applySavedNaverReportsToDataCenter(current, naverMonthlyReports) : current));
  }, [naverMonthlyReports]);

  const selectedChannelView = channels.find((channel) => channel.id === selectedChannel) ?? channels[0];

  const buildBriefingContext = (targetChannel?: Exclude<ChannelId, "all">): BriefingContext => {
    const channelView = targetChannel ? channels.find((channel) => channel.id === targetChannel) : undefined;
    const figures: Record<string, unknown> = {};
    const sources = new Set<string>();

    if (snapshot) {
      snapshot.kpis.forEach((kpi) => kpi.source && sources.add(kpi.source));
      figures.command = {
        kpis: snapshot.kpis.map((kpi) => ({
          label: kpi.label,
          value: kpi.value,
          delta: kpi.delta,
          status: kpi.status,
          source: kpi.source,
        })),
        trends: snapshot.trends,
        channelHighlights: snapshot.channelHighlights,
      };
    }

    if (channelView) {
      sources.add(channelView.source);
      figures.channel = {
        name: channelView.name,
        role: channelView.role,
        objective: channelView.objective,
        kpis: channelView.kpis.map((kpi) => ({
          label: kpi.label,
          value: kpi.value,
          secondary: kpi.secondary,
          delta: kpi.delta,
          status: kpi.status,
        })),
        trend: channelView.trend,
        topContent: channelView.topContent.slice(0, 5).map((item) => ({
          title: item.title,
          metric: `${item.metricValue} ${item.metricLabel}`,
        })),
      };
    }

    return {
      periodLabel: formatBriefingPeriodLabel(periodMode),
      dataSources: [...sources],
      dataWarnings: getBriefingWarnings(channels, dataCenter ?? undefined, targetChannel),
      figures,
    };
  };

  const handleGenerateBriefing = async (
    surface: "command" | "channel" | "campaign" | "ad",
    channel?: Exclude<ChannelId, "all">,
    campaign?: string,
    ad?: string,
  ) => {
    setGenerating(true);
    setBriefingOpen(true);
    setBriefing(null);

    const request = { surface, periodMode, channel, campaign, ad };
    const context = buildBriefingContext(channel);

    try {
      let nextBriefing: AiBriefing;

      if (canUseEdgeBriefings() && authUser) {
        try {
          nextBriefing = await generateBriefingViaEdge(request, context);
        } catch (error) {
          // Keep the panel useful even when Claude returns an invalid shape.
          const detail = error instanceof Error ? error.message : "알 수 없는 오류";
          const fallback = buildLocalBriefingFromContext(request, context, detail);
          nextBriefing = fallback;
        }
      } else {
        nextBriefing = buildLocalBriefingFromContext(request, context);
      }

      setBriefing(nextBriefing);

      if (authUser && canUseAiBriefingHistory()) {
        void saveAiBriefingHistory(nextBriefing, request, getBriefingPeriodRange(periodMode))
          .then((historyBriefing) => {
            setBriefing((current) =>
              current?.title === nextBriefing.title && current.summary === nextBriefing.summary ? historyBriefing : current,
            );
            setBriefingHistory((current) => mergeBriefingHistory([historyBriefing], current));
          })
          .catch((error) => {
            console.warn("AI briefing history could not be saved.", error);
            setBriefingHistory((current) => mergeBriefingHistory([nextBriefing], current));
          });
      } else {
        setBriefingHistory((current) => mergeBriefingHistory([nextBriefing], current));
      }
    } finally {
      setGenerating(false);
    }
  };

  const replaceContentLab = (nextContentLab: ContentLabSnapshot) => {
    const mergedContentLab = applyWebsiteContentToContentLab(
      applyLinkedinContentToContentLab(
        applyInstagramContentToContentLab(
          applyYoutubeContentToContentLab(nextContentLab, youtubeChannelPatchRef.current),
          instagramChannelPatchRef.current,
        ),
        linkedinChannelPatchRef.current,
      ),
      websiteChannelPatchRef.current,
    );
    setContentLab(mergedContentLab);
    return mergedContentLab;
  };

  const handleSaveContentCard = async (card: ContentItem) => replaceContentLab(await provider.upsertContentCard(card, periodMode));
  const handleMoveContentCard = async (contentId: string, status: string) =>
    replaceContentLab(await provider.moveContentCard(contentId, status, periodMode));
  const handleDeleteContentCard = async (contentId: string) =>
    replaceContentLab(await provider.deleteContentCard(contentId, periodMode));
  const handleCreateCampaignFromContent = async (sourceContentId?: string) => {
    if (contentLab) {
      const generatedCampaign = buildGeneratedCampaignFromContentLab(contentLab, sourceContentId);
      if (generatedCampaign) {
        return replaceContentLab({
          ...contentLab,
          campaigns: [generatedCampaign, ...contentLab.campaigns],
        });
      }
    }

    return replaceContentLab(await provider.createCampaignFromContent(sourceContentId, periodMode));
  };
  const handleSaveAd = async (ad: AdContent) => replaceContentLab(await provider.upsertAd(ad, periodMode));
  const handleDeleteAd = async (adId: string) => replaceContentLab(await provider.deleteAd(adId, periodMode));
  const handleSignIn = async () => {
    setAuthBusy(true);

    try {
      await signInWithGoogle();
      setImportPersistence(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "로그인 실패";
      setImportPersistence({ status: "error", message });
    } finally {
      setAuthBusy(false);
    }
  };
  const handleSignOut = async () => {
    setAuthBusy(true);

    try {
      await signOutFromAuth();
    } finally {
      setAuthBusy(false);
    }
  };
  const handleImportFiles = async (files: File[]) => {
    if (!files.length || importingFiles) return;

    setImportingFiles(true);
    setImportPersistence(null);

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      const baseResult = buildDataFileImportResult(files);
      let naverParseError = "";
      const naverImport = await parseNaverMonthlyImport(files, baseResult.importedAt).catch((error) => {
        naverParseError = error instanceof Error ? error.message : "네이버 파일 파싱 실패";
        return null;
      });
      const naverReport = naverImport?.latestReport ?? null;
      const result: DataFileImportResult = {
        ...baseResult,
        naverMonthlyReport: naverReport,
        naverMonthlyReports: naverImport?.monthlyReports ?? [],
      };
      const persistence = await persistImportedFilesToSupabase(files, result, authUser);

      // LinkedIn analytics exports (.xls) → parse + normalize into the DB.
      let linkedinNote = "";
      const linkedinReport = await parseLinkedinFiles(files).catch((error) => {
        linkedinNote = error instanceof Error ? error.message : "링크드인 파일 파싱 실패";
        return null;
      });
      if (linkedinReport && authUser) {
        const linkedinPersist = await persistLinkedinReport(linkedinReport);
        linkedinNote = linkedinPersist.message;
        if (linkedinPersist.status === "saved") {
          void loadLinkedinChannelPatch(periodMode)
            .then((patch) => {
              if (!patch) return;
              linkedinChannelPatchRef.current = patch;
              setChannels((current) => applyLinkedinChannelPatch(current, patch));
              setContentLab((current) => (current ? applyLinkedinContentToContentLab(current, patch) : current));
            })
            .catch((error) => {
              console.warn("LinkedIn channel data could not be refreshed after import.", error);
            });
        }
      } else if (linkedinReport && !authUser) {
        linkedinNote = "Google 로그인 후 링크드인 데이터를 저장할 수 있습니다.";
      }

      const notes = [
        naverParseError ? `네이버 파싱 실패: ${naverParseError}` : "",
        linkedinNote,
      ].filter(Boolean);
      const nextPersistence =
        notes.length && persistence.status === "saved"
          ? { ...persistence, message: [persistence.message, ...notes].join(" · ") }
          : persistence;
      setDataCenter((current) => (current ? applyImportToDataCenter(current, result) : current));
      setContentLab((current) => (current ? applyImportToContentLab(current, result) : current));
      setChannels((current) => applyNaverMonthlyReportToChannels(applyImportToChannels(current, result), naverReport));
      if (naverReport) {
        setNaverMonthlyReport(naverReport);
        setNaverMonthlyReports((current) => mergeNaverMonthlyReports(current, result.naverMonthlyReports ?? [naverReport]));
      }
      setLastFileImport(result);
      setImportPersistence(nextPersistence);
    } finally {
      setImportingFiles(false);
    }
  };

  const handleSyncYouTube = async () => {
    if (youtubeSyncing) return;

    if (!canSyncYoutubeAnalytics()) {
      setYoutubeSyncResult({ status: "error", message: "Supabase 환경변수가 없어 YouTube API 동기화를 실행할 수 없습니다." });
      return;
    }

    if (!authUser) {
      setYoutubeSyncResult({ status: "error", message: "Google 로그인 후 YouTube API 동기화를 실행할 수 있습니다." });
      return;
    }

    const range = getBriefingPeriodRange(periodMode);
    setYoutubeSyncing(true);
    setYoutubeSyncResult(null);

    try {
      const result = await syncYoutubeAnalytics({
        periodMode,
        startDate: range.start,
        endDate: range.end,
        maxVideos: 300,
        includeUploadBackfill: true,
      });
      setYoutubeSyncResult(result);
      void loadYoutubeChannelPatch(periodMode)
        .then((patch) => {
          if (!patch) return;
          youtubeChannelPatchRef.current = patch;
          setChannels((current) => applyYoutubeChannelPatch(current, patch));
          setContentLab((current) => (current ? applyYoutubeContentToContentLab(current, patch) : current));
        })
        .catch((error) => {
          console.warn("YouTube channel data could not be refreshed after sync.", error);
        });
      setDataCenter((current) =>
        current
          ? {
              ...current,
              sources: current.sources.map((source) =>
                source.id === "google-youtube"
                  ? {
                      ...source,
                      status: "complete",
                      lastSync: formatImportTimestamp(),
                      detail: `${result.channelTitle} ${result.periodStart}~${result.periodEnd} · 총 영상 ${result.videosSynced}개 저장 · 기간 성과 ${result.videosWithPeriodMetrics ?? 0}개`,
                    }
                  : source,
              ),
            }
          : current,
      );
    } catch (error) {
      setYoutubeSyncResult({
        status: "error",
        message: error instanceof Error ? error.message : "YouTube API 동기화 실패",
      });
      setDataCenter((current) =>
        current
          ? {
              ...current,
              sources: current.sources.map((source) =>
                source.id === "google-youtube" ? { ...source, status: "error", lastSync: formatImportTimestamp() } : source,
              ),
            }
          : current,
      );
    } finally {
      setYoutubeSyncing(false);
    }
  };

  const handleSyncInstagram = async () => {
    if (instagramSyncing) return;

    if (!canSyncInstagramAnalytics()) {
      setInstagramSyncResult({ status: "error", message: "Supabase config is missing. Instagram sync cannot run." });
      return;
    }

    if (!authUser) {
      setInstagramSyncResult({ status: "error", message: "Google login is required to run Instagram sync." });
      return;
    }

    const range = getBriefingPeriodRange(periodMode);
    setInstagramSyncing(true);
    setInstagramSyncResult(null);

    try {
      const result = await syncInstagramAnalytics({
        periodMode,
        startDate: range.start,
        endDate: range.end,
        maxMedia: 200,
        includeMediaBackfill: true,
      });
      setInstagramSyncResult(result);
      void loadInstagramChannelPatch(periodMode)
        .then((patch) => {
          if (!patch) return;
          instagramChannelPatchRef.current = patch;
          setChannels((current) => applyInstagramChannelPatch(current, patch));
          setContentLab((current) => (current ? applyInstagramContentToContentLab(current, patch) : current));
        })
        .catch((error) => {
          console.warn("Instagram channel data could not be refreshed after sync.", error);
        });
      setDataCenter((current) =>
        current
          ? {
              ...current,
              sources: current.sources.map((source) =>
                source.id === "meta-instagram"
                  ? {
                      ...source,
                      status: result.status === "complete" ? "complete" : "partial",
                      lastSync: formatImportTimestamp(),
                      detail: `Instagram ${result.periodStart}~${result.periodEnd} · 계정 ${result.accounts.length}개 · 게시물 ${result.accounts.reduce(
                        (total, account) => total + account.mediaSynced,
                        0,
                      )}개 저장`,
                    }
                  : source,
              ),
            }
          : current,
      );
    } catch (error) {
      setInstagramSyncResult({
        status: "error",
        message: error instanceof Error ? error.message : "Instagram Graph API sync failed.",
      });
      setDataCenter((current) =>
        current
          ? {
              ...current,
              sources: current.sources.map((source) =>
                source.id === "meta-instagram" ? { ...source, status: "error", lastSync: formatImportTimestamp() } : source,
              ),
            }
          : current,
      );
    } finally {
      setInstagramSyncing(false);
    }
  };

  const handleSyncWebsite = async () => {
    if (websiteSyncing) return;

    if (!canSyncWebsiteAnalytics()) {
      setWebsiteSyncResult({ status: "error", message: "Supabase 환경변수가 없어 홈페이지 API 동기화를 실행할 수 없습니다." });
      return;
    }

    if (!authUser) {
      setWebsiteSyncResult({ status: "error", message: "Google 로그인 후 홈페이지 API 동기화를 실행할 수 있습니다." });
      return;
    }

    const range = getBriefingPeriodRange(periodMode);
    setWebsiteSyncing(true);
    setWebsiteSyncResult(null);

    try {
      const result = await syncWebsiteAnalytics({
        periodMode,
        startDate: range.start,
        endDate: range.end,
        maxPages: 20,
      });
      setWebsiteSyncResult(result);
      void loadWebsiteChannelPatch(periodMode)
        .then((patch) => {
          if (!patch) return;
          websiteChannelPatchRef.current = patch;
          setChannels((current) => applyWebsiteChannelPatch(current, patch));
          setContentLab((current) => (current ? applyWebsiteContentToContentLab(current, patch) : current));
        })
        .catch((error) => {
          console.warn("Website channel data could not be refreshed after sync.", error);
        });
      setDataCenter((current) =>
        current
          ? {
              ...current,
              sources: current.sources.map((source) =>
                source.id === "google-website"
                  ? {
                      ...source,
                      status: result.overallStatus,
                      lastSync: formatImportTimestamp(),
                      detail: `홈페이지 ${result.periodStart}~${result.periodEnd} · 속성 ${result.accounts.length}개 · 페이지 ${result.accounts.reduce(
                        (total, account) => total + account.pagesSynced,
                        0,
                      )}개 저장`,
                    }
                  : source,
              ),
            }
          : current,
      );
    } catch (error) {
      setWebsiteSyncResult({
        status: "error",
        message: error instanceof Error ? error.message : "홈페이지 API 동기화 실패",
      });
      setDataCenter((current) =>
        current
          ? {
              ...current,
              sources: current.sources.map((source) =>
                source.id === "google-website" ? { ...source, status: "error", lastSync: formatImportTimestamp() } : source,
              ),
            }
          : current,
      );
    } finally {
      setWebsiteSyncing(false);
    }
  };

  const ready = snapshot && contentLab && dataCenter && channels.length > 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">D</div>
          <div>
            <div className="brand-row">
              <strong>DummDumm Brand OS</strong>
              <span className="status-pill accent">운영 준비</span>
            </div>
            <p>DummDumm Inc. · 마케팅팀 브랜드 인텔리전스</p>
          </div>
        </div>

        <div className="header-actions">
          <Segmented
            value={periodMode}
            items={[
              { value: "weekly", label: "주간" },
              { value: "monthly", label: "월간" },
            ]}
            onChange={(value) => setPeriodMode(value as PeriodMode)}
          />
          <button className="button secondary" onClick={() => setCompareOpen(true)}>
            <BarChart3 size={16} />
            기간 비교
          </button>
          <button className="button secondary" onClick={() => handleGenerateBriefing("command")}>
            <Bot size={16} />
            AI {periodMode === "weekly" ? "주간" : "월간"} 보고서
          </button>
          <button className="button primary">
            <Download size={16} />
            내보내기
          </button>
        </div>
      </header>

      <nav className="main-nav" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={activeView === item.id ? "nav-button active" : "nav-button"}
              onClick={() => setActiveView(item.id)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <main>
        {!ready ? (
          <div className="loading-panel">
            <Loader2 size={22} className="spin" />
            데이터 준비 중
          </div>
        ) : (
          <>
            {activeView === "command" && (
              <CommandCenter
                snapshot={snapshot}
                contentLab={contentLab}
                channels={channels}
                dataCenter={dataCenter}
                periodMode={periodMode}
                briefingHistory={briefingHistory}
                onOpenBriefing={(item) => {
                  setGenerating(false);
                  setBriefing(item);
                  setBriefingOpen(true);
                }}
                onOpenPublishingPlan={() => {
                  setActiveView("content");
                  setSelectedContentTab("publishing");
                }}
                onCompare={() => setCompareOpen(true)}
                onGenerate={() => handleGenerateBriefing("command")}
              />
            )}
            {activeView === "channels" && selectedChannelView && (
              <ChannelsView
                channels={channels}
                selectedChannel={selectedChannel}
                onSelectChannel={setSelectedChannel}
                channel={selectedChannelView}
                naverMonthlyReport={naverMonthlyReport}
                naverMonthlyReports={naverMonthlyReports}
                onCompare={() => setCompareOpen(true)}
                onGenerate={() => handleGenerateBriefing("channel", selectedChannel)}
              />
            )}
            {activeView === "content" && (
              <ContentLab
                data={contentLab}
                selectedTab={selectedContentTab}
                onSelectTab={setSelectedContentTab}
                onGenerateCampaign={(campaign) => handleGenerateBriefing("campaign", undefined, campaign)}
                onGenerateAd={(ad) => handleGenerateBriefing("ad", undefined, undefined, ad)}
                onSaveContentCard={handleSaveContentCard}
                onMoveContentCard={handleMoveContentCard}
                onDeleteContentCard={handleDeleteContentCard}
                onCreateCampaignFromContent={handleCreateCampaignFromContent}
                onSaveAd={handleSaveAd}
                onDeleteAd={handleDeleteAd}
              />
            )}
            {activeView === "data" && (
              <DataCenter
                data={dataCenter}
                importing={importingFiles}
                importResult={lastFileImport}
                importPersistence={importPersistence}
                authConfigured={authConfigured}
                authUser={authUser}
                authBusy={authBusy}
                youtubeSyncing={youtubeSyncing}
                youtubeSyncResult={youtubeSyncResult}
                instagramSyncing={instagramSyncing}
                instagramSyncResult={instagramSyncResult}
                websiteSyncing={websiteSyncing}
                websiteSyncResult={websiteSyncResult}
                onSignIn={handleSignIn}
                onSignOut={handleSignOut}
                onImportFiles={handleImportFiles}
                onSyncYouTube={handleSyncYouTube}
                onSyncInstagram={handleSyncInstagram}
                onSyncWebsite={handleSyncWebsite}
              />
            )}

            {activeView === "press" && <PressBoard authUser={authUser} />}
          </>
        )}
      </main>

      {compareOpen && <PeriodCompareModal onClose={() => setCompareOpen(false)} />}
      {briefingOpen && (
        <BriefingModal
          briefing={briefing}
          generating={generating}
          onClose={() => {
            setBriefingOpen(false);
            setBriefing(null);
          }}
        />
      )}
    </div>
  );
}

function CommandCenter({
  snapshot,
  contentLab,
  channels,
  dataCenter,
  periodMode,
  briefingHistory,
  onOpenBriefing,
  onOpenPublishingPlan,
  onCompare,
  onGenerate,
}: {
  snapshot: CommandCenterSnapshot;
  contentLab: ContentLabSnapshot;
  channels: ChannelView[];
  dataCenter: DataCenterSnapshot;
  periodMode: PeriodMode;
  briefingHistory: AiBriefing[];
  onOpenBriefing: (briefing: AiBriefing) => void;
  onOpenPublishingPlan: () => void;
  onCompare: () => void;
  onGenerate: () => void;
}) {
  const operatingTasks = useMemo(() => getOperatingTasks(snapshot, contentLab), [snapshot, contentLab]);
  const reuseRecommendations = useMemo(() => getReuseRecommendations(contentLab), [contentLab]);
  const briefingWarnings = useMemo(() => getBriefingWarnings(channels, dataCenter), [channels, dataCenter]);

  return (
    <div className="screen-stack">
      <section className="summary-band">
        <div>
          <span className="eyebrow">Brand Command Center</span>
          <h1>{periodMode === "weekly" ? "이번 주 브랜드 운영 상태" : "이번 달 브랜드 운영 상태"}</h1>
          <p>검색 가시성과 콘텐츠 소비가 상승 중이며, 파일 업로드 채널은 일부 데이터 상태를 함께 확인합니다.</p>
        </div>
        <div className="summary-actions">
          <button className="button secondary" onClick={onCompare}>
            <BarChart3 size={16} />
            기간 비교
          </button>
          <button className="button dark" onClick={onGenerate}>
            <Bot size={16} />
            AI 보고서 생성
          </button>
        </div>
      </section>

      <BriefingReadinessPanel warnings={briefingWarnings} />

      <section className="metric-grid">
        {snapshot.kpis.map((kpi) => (
          <div className="metric-tile" key={kpi.label}>
            <div className="tile-head">
              <span>{kpi.label}</span>
              <StatusPill status={kpi.status} />
            </div>
            <div className="metric-value">{kpi.value}</div>
            <div className={`delta ${kpi.tone}`}>{kpi.delta}</div>
            <small>{kpi.source}</small>
          </div>
        ))}
      </section>

      <OperatingFlow />

      <div className="two-column">
        <TodayTaskPanel tasks={operatingTasks} />
        <ReuseRecommendationPanel recommendations={reuseRecommendations} />
      </div>

      <div className="two-column">
        <section className="section-panel">
          <div className="section-header">
            <div>
              <h2>브랜드 성장 추세</h2>
              <p>대표 지표 묶음 · 최근 6주</p>
            </div>
            <StatusPill status="partial" />
          </div>
          <Sparkline points={snapshot.trends} />
          <div className="highlight-list">
            {snapshot.channelHighlights.map((item) => (
              <div className="highlight-row" key={item.channel}>
                <div>
                  <strong>{item.channel}</strong>
                  <span>{item.summary}</span>
                </div>
                <span className="delta up">{item.delta}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="section-panel">
          <div className="section-header">
            <div>
              <h2>오늘의 발행 알림</h2>
              <p>2026년 7월 28일</p>
            </div>
            <Bell size={18} />
          </div>
          <div className="alert-list">
            {snapshot.todayAlerts.map((item) => (
              <PublishingRow key={item.id} item={item} compact />
            ))}
          </div>
          <div className="inline-note">
            <AlertCircle size={16} />
            지연된 TikTok 숏폼 1건은 이번 주 캘린더에서 강조됩니다.
          </div>
        </section>
      </div>
      <section className="section-panel">
        <div className="section-header">
          <div>
            <h2>월간 발행 캘린더</h2>
            <p>2026년 7월 · 계획 42건 / 완료 31건 / 지연 1건</p>
          </div>
          <button className="button secondary small" onClick={onOpenPublishingPlan}>
            <Settings size={15} />
            Content Lab
          </button>
        </div>
        <MonthlyCalendar items={snapshot.publishing} />
      </section>

      <BriefingHistoryPanel history={briefingHistory} onOpen={onOpenBriefing} />
    </div>
  );
}

function OperatingFlow() {
  const steps = [
    { label: "기획 카드", value: "14", detail: "아이디어 4 · 초안 5", tone: "blue" },
    { label: "발행 계획", value: "42", detail: "이번 달 예정 슬롯", tone: "orange" },
    { label: "게시물 연결", value: "31", detail: "API/파일 성과 연결", tone: "green" },
    { label: "성과 반영", value: "9", detail: "캠페인·광고 연결", tone: "violet" },
  ];

  return (
    <section className="section-panel flow-panel">
      <div className="section-header">
        <div>
          <h2>이번 주 운영 흐름</h2>
          <p>기획 카드가 발행과 실제 게시물 성과로 연결되는 상태</p>
        </div>
        <StatusPill status="partial" />
      </div>
      <div className="flow-steps">
        {steps.map((step, index) => (
          <div className={`flow-step flow-${step.tone}`} key={step.label}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <b>{step.value}</b>
              <small>{step.detail}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BriefingReadinessPanel({ warnings }: { warnings: string[] }) {
  return (
    <section className={warnings.length > 0 ? "briefing-readiness warning" : "briefing-readiness"}>
      <div>
        <Bot size={17} />
        <strong>AI 브리핑 전 데이터 체크</strong>
      </div>
      {warnings.length > 0 ? (
        <ul>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : (
        <p>현재 보고서 생성에 필요한 핵심 데이터가 정상 상태입니다.</p>
      )}
    </section>
  );
}

function TodayTaskPanel({ tasks }: { tasks: OperatingTask[] }) {
  return (
    <section className="section-panel">
      <div className="section-header">
        <div>
          <h2>오늘 할 일</h2>
          <p>지연 발행 · 성과 급등 · 광고 종료 임박 자동 큐</p>
        </div>
        <Bell size={18} />
      </div>
      <div className="task-list">
        {tasks.map((task) => {
          const Icon = task.icon;
          return (
            <div className={`task-row ${task.tone}`} key={task.id}>
              <span>
                <Icon size={15} />
              </span>
              <div>
                <strong>{task.title}</strong>
                <em>{task.detail}</em>
              </div>
            </div>
          );
        })}
        {tasks.length === 0 && <div className="empty-result">오늘 바로 처리할 운영 이슈가 없습니다.</div>}
      </div>
    </section>
  );
}

function ReuseRecommendationPanel({ recommendations }: { recommendations: ReuseRecommendation[] }) {
  return (
    <section className="section-panel">
      <div className="section-header">
        <div>
          <h2>콘텐츠 재활용 추천</h2>
          <p>YouTube 상위 Shorts를 다른 채널 초안으로 전환</p>
        </div>
        <RefreshCw size={18} />
      </div>
      <div className="reuse-list">
        {recommendations.map((recommendation) => (
          <div className="reuse-card" key={recommendation.id}>
            <div>
              <span className="content-type-tag tag-orange">Shorts</span>
              <a className="content-title-link" href={getContentExternalUrl(recommendation.source)} target="_blank" rel="noreferrer">
                {recommendation.source.title}
              </a>
            </div>
            <p>{recommendation.reason}</p>
            <div className="reuse-targets">
              {recommendation.targets.map((target) => (
                <ChannelBadge channel={target} compact key={target} />
              ))}
            </div>
          </div>
        ))}
        {recommendations.length === 0 && <div className="empty-result">재활용 추천을 만들 상위 Shorts가 아직 없습니다.</div>}
      </div>
    </section>
  );
}

function BriefingHistoryPanel({ history, onOpen }: { history: AiBriefing[]; onOpen: (briefing: AiBriefing) => void }) {
  const pagination = usePaginatedItems(history);

  return (
    <section className="section-panel">
      <div className="section-header">
        <div>
          <h2>AI 보고서 히스토리</h2>
          <p>생성된 브리핑은 근거 기간과 함께 저장됩니다.</p>
        </div>
        <Bot size={18} />
      </div>
      <div className="history-list">
        {pagination.pagedItems.map((item) => (
          <button className="history-row" key={`${item.title}-${item.generatedAt}`} onClick={() => onOpen(item)}>
            <div>
              <strong>{item.title}</strong>
              <span>{item.periodLabel} · {item.generatedAt}</span>
            </div>
            <em>{item.dataSources.slice(0, 2).join(" + ")}{item.dataSources.length > 2 ? " 외" : ""}</em>
          </button>
        ))}
      </div>
      <Pagination pagination={pagination} />
    </section>
  );
}

function pickFilter<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function metric(
  label: string,
  value: string,
  delta: string,
  status: DataStatus = "complete",
  secondary?: string,
): ChannelMetric {
  return {
    label,
    value,
    delta,
    status,
    ...(secondary ? { secondary } : {}),
  };
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function parseDurationSeconds(value: string) {
  const match = value.match(/^(\d+):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseTrendMetricValue(metric: ChannelMetric) {
  if (metric.value === "N/A") return 0;
  if (metric.value.includes(":")) return parseDurationSeconds(metric.value);
  return parseMetricScore(metric.value);
}

function parseDeltaRate(delta: string) {
  const match = delta.match(/([+-]?\d+(?:\.\d+)?)%/);
  return match ? Number(match[1]) / 100 : 0;
}

function formatSignedDuration(value: number) {
  const rounded = Math.round(value);
  const prefix = rounded < 0 ? "-" : "";
  return `${prefix}${formatDuration(Math.abs(rounded))}`;
}

function getTrendMetricFormatter(metric: ChannelMetric) {
  const label = metric.label;
  const rawValue = metric.value;

  if (rawValue.includes(":")) return (value: number) => formatSignedDuration(value);
  if (label.includes("시청시간")) return (value: number) => `${formatCount(value)}h`;
  if (label.includes("률") || label.includes("상위 유입")) return (value: number) => `${Math.round(value)}%`;
  if (label.includes("대표 키워드") || label.includes("순위")) return (value: number) => `${Math.max(1, Math.round(value))}위`;

  return (value: number) => formatCount(value);
}

function getTrendMetricVolatility(metric: ChannelMetric) {
  if (metric.label.includes("구독자") || metric.label.includes("팔로워")) return 0.08;
  if (metric.label.includes("평균") || metric.label.includes("률") || metric.label.includes("대표 키워드") || metric.label.includes("순위")) return 0.22;
  if (metric.label.includes("시간") || metric.label.includes("체류") || metric.label.includes("사용")) return 0.32;
  return 1;
}

function normalizeTrendSeries(series: TrendPoint[] | undefined, metric: ChannelMetric) {
  if (!series || series.length === 0) return null;

  const metricValue = parseTrendMetricValue(metric);
  const lastValue = series[series.length - 1]?.value || 0;
  if (metricValue <= 0 || lastValue <= 0) return null;

  const scale = metricValue / lastValue;
  return series.map((point, index) => ({
    label: point.label,
    value: index === series.length - 1 ? Math.round(metricValue) : Math.max(1, Math.round(point.value * scale)),
  }));
}

function buildMetricTrendPoints(channel: ChannelView, metric: ChannelMetric): TrendPoint[] {
  const explicitSeries = normalizeTrendSeries(channel.trendSeries?.[metric.label], metric);
  if (explicitSeries) return explicitSeries;

  const baseValue = parseTrendMetricValue(metric);
  if (baseValue <= 0) return [];

  const seed = hashText(`${channel.id}-${metric.label}`);
  const lastTrendValue = channel.trend[channel.trend.length - 1]?.value || 1;
  const volatility = getTrendMetricVolatility(metric);
  const deltaRate = parseDeltaRate(metric.delta);
  const firstValue =
    (metric.label.includes("대표 키워드") || metric.label.includes("순위")) && metric.delta.includes("계단")
      ? baseValue + parseMetricScore(metric.delta)
      : deltaRate !== 0
        ? baseValue / Math.max(0.2, 1 + deltaRate)
        : baseValue * (0.9 + (seed % 7) / 100);
  const pointCount = Math.max(channel.trend.length - 1, 1);

  return channel.trend.map((point, index) => {
    if (index === channel.trend.length - 1) {
      return { label: point.label, value: Math.max(1, Math.round(baseValue)) };
    }

    const progress = index / pointCount;
    const ratio = point.value / lastTrendValue;
    const channelShape = 1 + (ratio - 1) * volatility * 0.45;
    const waveStrength = metric.label.includes("구독자") || metric.label.includes("팔로워") ? 0.015 : 0.035 + (seed % 5) / 100;
    const wave = Math.sin((index + 1) * (0.72 + (seed % 5) * 0.08) + seed) * waveStrength;
    const weekdayBias =
      ["조회", "도달", "노출", "클릭", "공유"].some((label) => metric.label.includes(label)) &&
      ["토", "일"].includes(point.label)
        ? 0.92
        : 1;
    const linearValue = firstValue + (baseValue - firstValue) * progress;

    return {
      label: point.label,
      value: Math.max(1, Math.round(linearValue * channelShape * (1 + wave) * weekdayBias)),
    };
  });
}

function buildChannelTrendMetrics(channel: ChannelView): ChannelTrendMetric[] {
  const palette = [channel.color, "#2563eb", "#0f9f8f", "#db3b78", "#7c5cff", "#007a5f"];

  return channel.kpis
    .map((metric, index): ChannelTrendMetric | null => {
      const points = buildMetricTrendPoints(channel, metric);
      if (points.length === 0) return null;

      return {
        label: metric.label,
        color: palette[index % palette.length],
        points,
        formatValue: getTrendMetricFormatter(metric),
      };
    })
    .filter((metric): metric is ChannelTrendMetric => Boolean(metric));
}

function scaleTrend(points: TrendPoint[], multiplier: number, lift = 0): TrendPoint[] {
  return points.map((point) => ({
    ...point,
    value: Math.max(1, Math.round(point.value * multiplier + lift)),
  }));
}

function contentMatchesType(item: ContentItem, types: string[]) {
  const source = item.type.toLowerCase();
  return types.some((type) => source.includes(type.toLowerCase()));
}

function getInstagramAccountKeyFromFilter(account: string) {
  if (account.includes("둠둠")) return "dummdumm-log";
  if (account.includes("본계")) return "company";
  return undefined;
}

function getInstagramFormatKeyFromFilter(format: string) {
  if (format.includes("릴")) return "reels";
  if (format.includes("캐")) return "carousel";
  return undefined;
}

function isRealInstagramContent(item: ContentItem) {
  return item.channel === "instagram" && Boolean(item.performance);
}

function decorateContentVariant(
  items: ContentItem[],
  fallback: ContentItem[],
  label: string,
  metricLabel?: string,
): ContentItem[] {
  const source = items.length > 0 ? items : fallback.slice(0, PAGE_SIZE);
  if (label === "전체" && !metricLabel) return source;

  return source.map((item, index) => ({
    ...item,
    id: `${item.id}-${label}-${index}`,
    status: label === "전체" ? item.status : `${label} · ${item.status}`,
    metricLabel: metricLabel ?? item.metricLabel,
  }));
}

function getFilteredChannelView(channel: ChannelView, filters: Record<string, string>): ChannelView {
  switch (channel.id) {
    case "youtube": {
      const format = pickFilter(filters["포맷"], ["전체", "쇼츠", "롱폼"] as const, "전체");
      const content =
        format === "쇼츠"
          ? channel.topContent.filter((item) => contentMatchesType(item, ["short"]))
          : format === "롱폼"
            ? channel.topContent.filter((item) => contentMatchesType(item, ["long"]))
            : channel.topContent;
      const hasRealYoutubeDataset = channel.topContent.some((item) => item.performance);
      const youtubeFilteredContent = (label: string) =>
        decorateContentVariant(content, hasRealYoutubeDataset ? [] : channel.topContent, label, "조회");

      if (format === "쇼츠") {
        return {
          ...channel,
          kpis: hasRealYoutubeDataset
            ? buildYoutubeKpisFromContent(channel, content)
            : [
                metric("구독자", "18,320명", "+9%", "complete", "+124명"),
                metric("조회수", "15,880", "+36%"),
                metric("시청시간", "410h", "+18%"),
                metric("평균 시청", "0:23", "+6%"),
              ],
          trend: scaleTrend(channel.trend, 1.16, 4),
          topContent: youtubeFilteredContent("쇼츠"),
          dataNote: "YouTube Shorts 기준입니다. 조회와 구독자 유입은 빠르게 반영하고 시청시간은 별도 기여로 봅니다.",
        };
      }

      if (format === "롱폼") {
        return {
          ...channel,
          kpis: hasRealYoutubeDataset
            ? buildYoutubeKpisFromContent(channel, content)
            : [
                metric("구독자", "18,320명", "+7%", "complete", "+94명"),
                metric("조회수", "7,220", "+18%"),
                metric("시청시간", "838h", "+9%"),
                metric("평균 시청", "3:42", "+11%"),
              ],
          trend: scaleTrend(channel.trend, 0.78, 2),
          topContent: youtubeFilteredContent("롱폼"),
          dataNote: "YouTube 롱폼 기준입니다. 평균 시청과 시청시간을 Shorts와 분리해 전문성 콘텐츠 기여를 확인합니다.",
        };
      }

      return channel;
    }

    case "instagram": {
      const account = pickFilter(filters["계정"], ["전체", "본계", "둠둠로그"] as const, "전체");
      const format = pickFilter(filters["포맷"], ["전체", "캐러셀", "릴스"] as const, "전체");
      const accountScale = account === "본계" ? 0.58 : account === "둠둠로그" ? 0.42 : 1;
      const formatScale = format === "캐러셀" ? 0.44 : format === "릴스" ? 0.56 : 1;
      const saveScale = format === "캐러셀" ? 0.68 : format === "릴스" ? 0.32 : 1;
      const shareScale = format === "릴스" ? 0.72 : format === "캐러셀" ? 0.28 : 1;
      const followerBase = {
        전체: { total: "42,180명", gain: 484, delta: "+4%" },
        본계: { total: "27,860명", gain: 192, delta: "+3%" },
        둠둠로그: { total: "14,320명", gain: 292, delta: "+6%" },
      }[account];
      const followerGain = Math.max(1, Math.round(followerBase.gain * formatScale));
      const label = [account, format].filter((value) => value !== "전체").join(" · ") || "전체";

      const hasRealInstagramDataset = channel.topContent.some(isRealInstagramContent);

      if (hasRealInstagramDataset) {
        const accountKey = getInstagramAccountKeyFromFilter(account);
        const formatKey = getInstagramFormatKeyFromFilter(format);
        let realContent = channel.topContent.filter(isRealInstagramContent);

        if (accountKey) realContent = realContent.filter((item) => item.accountKey === accountKey);
        if (formatKey) realContent = realContent.filter((item) => contentMatchesType(item, [formatKey]));

        return {
          ...channel,
          kpis: buildInstagramKpisFromContent(channel, realContent, accountKey),
          trend: channel.trend,
          topContent: realContent,
          dataNote: `${label} 기준입니다. Supabase에 저장된 Instagram Graph API 게시물 성과를 계정/포맷별로 분리해 보여줍니다.`,
        };
      }

      let content = channel.topContent;
      if (account !== "전체") {
        content = content.filter((item, index) => {
          const dummLogItem = item.title.includes("둠둠로그") || index % 2 === 1;
          return account === "둠둠로그" ? dummLogItem : !dummLogItem;
        });
      }
      if (format === "캐러셀") content = content.filter((item) => contentMatchesType(item, ["carousel"]));
      if (format === "릴스") content = content.filter((item) => contentMatchesType(item, ["reels"]));

      return {
        ...channel,
        kpis: [
          metric("팔로워", followerBase.total, followerBase.delta, "complete", `+${formatNumber(followerGain)}명`),
          metric("도달", formatNumber(31300 * accountScale * formatScale), format === "릴스" ? "+24%" : "+18%", "partial"),
          metric("조회", formatNumber(44900 * accountScale * (format === "릴스" ? 0.68 : formatScale)), format === "릴스" ? "+31%" : "+23%", "partial"),
          metric("저장", formatNumber(1082 * accountScale * saveScale), format === "캐러셀" ? "+28%" : "+21%"),
          metric("공유", formatNumber(624 * accountScale * shareScale), format === "릴스" ? "+34%" : "+29%"),
        ],
        trend: scaleTrend(channel.trend, accountScale * (format === "릴스" ? 1.08 : format === "캐러셀" ? 0.92 : 1), 2),
        topContent: decorateContentVariant(content, channel.topContent, label, format === "릴스" ? "조회" : "도달"),
        dataNote: `${label} 기준입니다. 계정과 포맷을 조합해 팔로워 현재 수, 증가분, 도달·조회·저장·공유를 따로 계산합니다.`,
      };
    }

    case "website": {
      const property = pickFilter(filters["속성"], ["전체", "KR", "EN"] as const, "전체");
      const analysis = pickFilter(filters["분석"], ["전체", "검색"] as const, "전체");
      const propertyScale = property === "KR" ? 0.72 : property === "EN" ? 0.28 : 1;
      const label = [property, analysis].filter((value) => value !== "전체").join(" · ") || "전체";
      let content = channel.topContent;

      if (property === "KR") {
        content = content.filter((item, index) => contentMatchesType(item, ["KR", "Landing"]) || index % 2 === 0);
      }
      if (property === "EN") {
        content = content.filter((item, index) => contentMatchesType(item, ["EN"]) || index % 2 === 1);
      }

      return {
        ...channel,
        kpis:
          analysis === "검색"
            ? [
                metric("검색 노출", formatNumber(84200 * propertyScale), "+17%"),
                metric("검색 클릭", formatNumber(3420 * propertyScale), "+14%"),
                metric("클릭률", property === "EN" ? "3.2%" : "4.1%", "+3%"),
                metric("문의", formatNumber(34 * propertyScale), "+21%"),
              ]
            : [
                metric("사용자", formatNumber(12840 * propertyScale), "+20%"),
                metric("신규 사용자", formatNumber(9204 * propertyScale), "+22%"),
                metric("검색 노출", formatNumber(84200 * propertyScale), "+17%"),
                metric("검색 클릭", formatNumber(3420 * propertyScale), "+14%"),
              ],
        trend: scaleTrend(channel.trend, propertyScale || 1, analysis === "검색" ? 6 : 0),
        topContent: decorateContentVariant(content, channel.topContent, label, analysis === "검색" ? "검색 클릭" : undefined),
        dataNote: `${label} 기준입니다. KR/EN 속성과 검색 지표를 분리해 GA4와 Search Console 값을 섞지 않고 봅니다.`,
      };
    }

    case "linkedin": {
      const scope = pickFilter(filters["범위"], ["전체", "게시물", "팔로워"] as const, "전체");
      if (scope === "게시물") {
        return {
          ...channel,
          kpis: [
            metric("팔로워", "7,694명", "+5%", "complete", "+42명"),
            metric("노출", "5,280", "+12%", "partial"),
            metric("클릭", "326", "+9%", "partial"),
            metric("댓글", "28", "+4%"),
          ],
          trend: scaleTrend(channel.trend, 0.82, 3),
          topContent: decorateContentVariant(channel.topContent, channel.topContent, "게시물", "노출"),
          dataNote: "LinkedIn 게시물 기준입니다. 파일 업로드의 게시물 노출·클릭·댓글만 분리해 표시합니다.",
        };
      }

      if (scope === "팔로워") {
        return {
          ...channel,
          kpis: [
            metric("팔로워", "7,694명", "+11%", "complete", "+86명"),
            metric("노출", "2,414", "+7%", "partial"),
            metric("클릭", "86", "+5%", "partial"),
            metric("댓글", "6", "+2%"),
          ],
          trend: scaleTrend(channel.trend, 0.64, 5),
          topContent: decorateContentVariant(channel.topContent, channel.topContent, "팔로워 기여", "신규 팔로워"),
          dataNote: "LinkedIn 팔로워 기준입니다. 신규 팔로워를 현재 팔로워 수 옆 증가분으로 표시합니다.",
        };
      }

      return channel;
    }

    case "naver": {
      const report = pickFilter(filters["보고서"], ["전체", "필수 지표", "유입분석", "분포·순위"] as const, "전체");
      if (report === "필수 지표") {
        return {
          ...channel,
          kpis: [
            metric("조회수", "5,400", "+10%", "partial"),
            metric("순방문자수", "3,860", "+8%", "partial"),
            metric("방문 횟수", "4,920", "+9%", "partial"),
            metric("평균 사용 시간", "1:42", "+6%"),
            metric("재방문율", "18%", "+2%"),
          ],
          trend: scaleTrend(channel.trend, 1.05, 3),
          topContent: decorateContentVariant(channel.topContent, channel.topContent, "필수 지표", "조회"),
          dataNote: "Naver Blog 필수 파일 기준입니다. 조회수, 유입분석, 순방문자수, 방문 횟수, 평균 사용 시간, 재방문율을 월간 파일에서 가져옵니다.",
        };
      }

      if (report === "유입분석") {
        return {
          ...channel,
          kpis: [
            metric("검색 유입", "2,142", "+13%", "partial"),
            metric("외부 유입", "824", "+7%", "partial"),
            metric("직접 유입", "611", "+5%"),
            metric("상위 유입 비중", "64%", "+6%"),
          ],
          trend: scaleTrend(channel.trend, 0.9, 4),
          topContent: decorateContentVariant(channel.topContent, channel.topContent, "유입분석", "유입"),
          dataNote: "Naver Blog 유입분석 기준입니다. 검색, 외부, 직접 유입을 분리하고 유입원별 기여를 봅니다.",
        };
      }

      if (report === "분포·순위") {
        return {
          ...channel,
          kpis: [
            metric("조회수 순위", "1위", "유지"),
            metric("공감수 순위", "3위", "+2계단"),
            metric("댓글수 순위", "5위", "+1계단"),
            metric("주요 연령", "35-44", "선택 파일"),
            metric("주요 국가", "KR 94%", "선택 파일"),
          ],
          trend: scaleTrend(channel.trend, 0.74, 8),
          topContent: decorateContentVariant(channel.topContent, channel.topContent, "분포·순위", "순위"),
          dataNote: "Naver Blog 선택 파일 기준입니다. 성/연령, 국가, 조회수·공감수·댓글수 순위는 들어온 달에만 보조 리포트로 표시합니다.",
        };
      }

      return channel;
    }

    case "tiktok": {
      const scope = pickFilter(filters["범위"], ["전체", "계정 성과", "영상 성과"] as const, "전체");
      if (scope === "계정 성과") {
        return {
          ...channel,
          kpis: [
            metric("팔로워", "18,320명", "+19%", "complete", "+484명"),
            metric("조회수", "88K", "+21%", "partial"),
            metric("공유", "420", "+14%"),
            metric("평균 시청", "N/A", "N/A", "unavailable"),
          ],
          trend: scaleTrend(channel.trend, 0.72, 6),
          topContent: decorateContentVariant(channel.topContent, channel.topContent, "계정 성과", "계정 기여"),
          dataNote: "TikTok 계정 기준입니다. 팔로워 현재 수와 증가분을 분리하고 평균 시청은 파일에 없으면 N/A로 둡니다.",
        };
      }

      if (scope === "영상 성과") {
        return {
          ...channel,
          kpis: [
            metric("팔로워", "18,320명", "+8%", "complete", "+210명"),
            metric("조회수", "210K", "+38%", "partial"),
            metric("공유", "1,240", "+26%"),
            metric("평균 시청", "0:09", "N/A", "unavailable"),
          ],
          trend: scaleTrend(channel.trend, 1.18, 3),
          topContent: decorateContentVariant(channel.topContent, channel.topContent, "영상 성과", "조회"),
          dataNote: "TikTok 영상 기준입니다. 영상별 조회·공유·평균 시청을 계정 성장 지표와 분리합니다.",
        };
      }

      return channel;
    }

    default:
      return channel;
  }
}

function ChannelsView({
  channels,
  selectedChannel,
  onSelectChannel,
  channel,
  naverMonthlyReport,
  naverMonthlyReports,
  onCompare,
  onGenerate,
}: {
  channels: ChannelView[];
  selectedChannel: Exclude<ChannelId, "all">;
  onSelectChannel: (channel: Exclude<ChannelId, "all">) => void;
  channel: ChannelView;
  naverMonthlyReport: NaverMonthlyReport | null;
  naverMonthlyReports: NaverMonthlyReport[];
  onCompare: () => void;
  onGenerate: () => void;
}) {
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string>>({});
  const [channelOrder, setChannelOrder] = useState<Array<Exclude<ChannelId, "all">>>(() =>
    readStoredChannelOrder(),
  );
  const [draggedChannel, setDraggedChannel] = useState<Exclude<ChannelId, "all"> | null>(null);
  const [selectedTrendMetric, setSelectedTrendMetric] = useState("");
  const filterGroups = channelFilterGroups[channel.id];

  useEffect(() => {
    setSelectedFilters(
      Object.fromEntries(channelFilterGroups[channel.id].map((group) => [group.label, group.options[0]])),
    );
  }, [channel.id]);

  useEffect(() => {
    setChannelOrder((current) => {
      const incoming = channels.map((item) => item.id);
      const next = [...current.filter((id) => incoming.includes(id)), ...incoming.filter((id) => !current.includes(id))];
      return next.length > 0 ? next : incoming;
    });
  }, [channels]);

  useEffect(() => {
    if (channelOrder.length === 0 || typeof window === "undefined") return;

    try {
      window.localStorage.setItem(CHANNEL_ORDER_STORAGE_KEY, JSON.stringify(channelOrder));
    } catch {
      // Local storage can be unavailable in restricted browser contexts.
    }
  }, [channelOrder]);

  const orderedChannels = useMemo(() => {
    const byId = new Map(channels.map((item) => [item.id, item]));
    return channelOrder.map((id) => byId.get(id)).filter((item): item is ChannelView => Boolean(item));
  }, [channelOrder, channels]);

  const filteredChannel = useMemo(() => getFilteredChannelView(channel, selectedFilters), [channel, selectedFilters]);
  const trendMetrics = useMemo(() => buildChannelTrendMetrics(filteredChannel), [filteredChannel]);
  const channelBriefingWarnings = useMemo(() => getBriefingWarnings([filteredChannel]), [filteredChannel]);

  useEffect(() => {
    if (trendMetrics.length === 0) {
      setSelectedTrendMetric("");
      return;
    }

    if (!trendMetrics.some((metric) => metric.label === selectedTrendMetric)) {
      setSelectedTrendMetric(trendMetrics[0].label);
    }
  }, [selectedTrendMetric, trendMetrics]);

  const activeTrendMetric = trendMetrics.find((metric) => metric.label === selectedTrendMetric) ?? trendMetrics[0];

  const moveChannelTab = (targetId: Exclude<ChannelId, "all">) => {
    if (!draggedChannel || draggedChannel === targetId) return;

    setChannelOrder((current) => {
      const next = current.length > 0 ? [...current] : channels.map((item) => item.id);
      const fromIndex = next.indexOf(draggedChannel);
      const toIndex = next.indexOf(targetId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const [moving] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moving);
      return next;
    });
    setDraggedChannel(null);
  };

  const selectedFilterLabel = filterGroups
    .map((group) => selectedFilters[group.label])
    .filter(Boolean)
    .filter((value, index, values) => value !== "전체" || values.length === 1)
    .join(" · ");

  return (
    <div className="screen-stack channels-view" style={{ "--channel-accent": channel.color } as React.CSSProperties}>
      <div className="channel-tabs">
        {orderedChannels.map((item) => (
          <button
            key={item.id}
            draggable
            className={[
              selectedChannel === item.id ? "channel-tab active" : "channel-tab",
              draggedChannel === item.id ? "dragging" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title="드래그해서 채널 순서 변경"
            onDragStart={(event) => {
              setDraggedChannel(item.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              moveChannelTab(item.id);
            }}
            onDragEnd={() => setDraggedChannel(null)}
            onClick={() => onSelectChannel(item.id)}
          >
            <ChannelBadge channel={item.id} />
            {item.name}
          </button>
        ))}
      </div>

      <section className="summary-band channel-summary" style={{ borderColor: channel.color }}>
        <div>
          <span className="eyebrow">Channel Analytics</span>
          <h1>{channel.name}</h1>
          <p>
            {channel.role} · {channel.objective}
          </p>
        </div>
        <div className="summary-actions">
          {filterGroups.length > 0 && (
            <div className="filter-stack">
              {filterGroups.map((group) => (
                <div className="filter-group" key={group.label}>
                  <span>{group.label}</span>
                  <Segmented
                    value={selectedFilters[group.label] ?? group.options[0]}
                    items={group.options.map((option) => ({ value: option, label: option }))}
                    onChange={(value) =>
                      setSelectedFilters((current) => ({
                        ...current,
                        [group.label]: value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <button className="button secondary" onClick={onCompare}>
            <BarChart3 size={16} />
            기간 비교
          </button>
          <button className="button dark" onClick={onGenerate}>
            <Bot size={16} />
            AI 브리핑 생성
          </button>
        </div>
      </section>

      <BriefingReadinessPanel warnings={channelBriefingWarnings} />

      <section className={`metric-grid ${filteredChannel.kpis.length === 5 ? "five-up" : ""}`}>
        {filteredChannel.kpis.map((metric) => (
          <div className="metric-tile" key={metric.label}>
            <div className="tile-head">
              <span>{metric.label}</span>
              <StatusPill status={metric.status} />
            </div>
            <div className="metric-value-row">
              <div className="metric-value">{metric.value}</div>
              {metric.secondary && <div className="metric-secondary">{metric.secondary}</div>}
            </div>
            <div className={metric.delta === "N/A" ? "delta neutral" : "delta up"}>{metric.delta}</div>
            <small>{filteredChannel.source}</small>
          </div>
        ))}
      </section>

      <div className="two-column wide-left">
        <section className="section-panel">
          <div className="section-header">
            <div>
              <h2>{selectedFilterLabel || "전체"} {activeTrendMetric?.label ?? "성과"} 추세</h2>
              <p>{filteredChannel.updatedAt} 갱신 · 지표별 선그래프</p>
            </div>
            <StatusPill status={filteredChannel.kpis.some((kpi) => kpi.status === "partial") ? "partial" : "complete"} />
          </div>
          {trendMetrics.length > 1 && (
            <div className="trend-filter-bar">
              <Segmented
                value={activeTrendMetric?.label ?? ""}
                items={trendMetrics.map((metric) => ({ value: metric.label, label: metric.label }))}
                onChange={setSelectedTrendMetric}
              />
            </div>
          )}
          <Sparkline
            points={activeTrendMetric?.points ?? filteredChannel.trend}
            color={activeTrendMetric?.color ?? filteredChannel.color}
            valueFormatter={activeTrendMetric?.formatValue}
          />
          <div className="inline-note">
            <AlertCircle size={16} />
            {filteredChannel.dataNote}
          </div>
        </section>

        <section className="section-panel">
          <div className="section-header">
            <div>
              <h2>다음 액션</h2>
              <p>성과 기반 운영 후보</p>
            </div>
          </div>
          <div className="action-list">
            <ActionItem label="재활용" text="상위 소재를 LinkedIn 카드뉴스와 Naver Blog로 확장" />
            <ActionItem label="검증" text="부분 데이터 지표는 다음 동기화 후 보고서에 반영" />
            <ActionItem label="발행" text="금요일 18시 숏폼 슬롯에 지연 콘텐츠 배치" />
          </div>
        </section>
      </div>

      {channel.id === "youtube" && <YouTubeAiInsightPanel />}
      {filteredChannel.id === "naver" && <NaverBlogDetailPanel report={naverMonthlyReport} reports={naverMonthlyReports} />}

      <section className="section-panel">
        <div className="section-header">
          <div>
            <h2>콘텐츠 성과 리스트</h2>
            <p>수집된 콘텐츠 전체 · 성과 지표 클릭 시 해당 기준으로 정렬</p>
          </div>
        </div>
        <ChannelContentPerformanceTable items={filteredChannel.topContent} />
      </section>
    </div>
  );
}

function YouTubeAiInsightPanel() {
  const patterns = [
    {
      title: "Shorts 포맷",
      value: "×1.0",
      unit: "평균 조회",
      tone: "neutral",
      detail: "롱폼 대비 조회 효율",
    },
    {
      title: "제목 5단어 이하",
      value: "-85%",
      unit: "조회",
      tone: "down",
      detail: "짧은 제목군 성과 저하",
    },
    {
      title: "수요일 업로드",
      value: "116",
      unit: "평균 조회",
      tone: "up",
      detail: "요일별 업로드 비교",
    },
  ];

  return (
    <div className="youtube-ai-grid">
      <section className="section-panel youtube-ai-panel">
        <div className="section-header">
          <div>
            <h2>AI 패턴 분석</h2>
            <p>영상 34편 기준 · YouTube Analytics + Claude 분석 예정</p>
          </div>
          <Bot size={18} />
        </div>
        <div className="ai-pattern-grid">
          {patterns.map((pattern) => (
            <div className={`ai-pattern-card ${pattern.tone}`} key={pattern.title}>
              <strong>{pattern.title}</strong>
              <div>
                <b>{pattern.value}</b>
                <span>{pattern.unit}</span>
              </div>
              <small>{pattern.detail}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="section-panel youtube-ai-panel comment-panel">
        <div className="section-header">
          <div>
            <h2>댓글 분석</h2>
            <p>AI 분류 · 긍정/질문/불만/키워드</p>
          </div>
          <MessageBubbleIcon />
        </div>
        <div className="comment-empty-state">
          <strong>댓글 텍스트 수집 대기</strong>
          <p>YouTube 댓글 텍스트가 수집되면 Claude가 긍정 질문 불만 분류와 키워드 클러스터를 표시합니다.</p>
        </div>
      </section>
    </div>
  );
}

function NaverBlogDetailPanel({
  report,
  reports,
}: {
  report: NaverMonthlyReport | null;
  reports: NaverMonthlyReport[];
}) {
  const [activeTab, setActiveTab] = useState<NaverDetailTab>("required");
  const availableReports = useMemo(() => {
    const byPeriod = new Map<string, NaverMonthlyReport>();
    reports.forEach((item) => byPeriod.set(item.periodKey, item));
    if (report) byPeriod.set(report.periodKey, report);
    return Array.from(byPeriod.values()).sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  }, [report, reports]);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState(report?.periodKey ?? "");

  useEffect(() => {
    if (!availableReports.length) {
      setSelectedPeriodKey("");
      return;
    }

    if (!availableReports.some((item) => item.periodKey === selectedPeriodKey)) {
      setSelectedPeriodKey(availableReports[0].periodKey);
    }
  }, [availableReports, selectedPeriodKey]);

  const activeReport = availableReports.find((item) => item.periodKey === selectedPeriodKey) ?? report;
  const requiredMetrics = activeReport?.requiredMetrics ?? naverRequiredMetrics;
  const trafficSources = activeReport?.trafficSources ?? naverTrafficSources;
  const distributionRows = activeReport?.distributionRows.length ? activeReport.distributionRows : naverDistributionRows;
  const rankingRows = activeReport?.rankingRows.length ? activeReport.rankingRows : naverRankingRows;
  const validationRows = activeReport?.validationRows ?? naverFileValidationRows;

  return (
    <section className="section-panel naver-detail-panel">
      <div className="section-header">
        <div>
          <h2>네이버 월간 파일 상세</h2>
          <p>
            {activeReport
              ? `${availableReports.length}개월 적재 · 현재 ${activeReport.periodLabel} · ${activeReport.sourceFiles.length}개 파일 파싱 · ${activeReport.importedAt} 갱신`
              : "필수 항목과 선택 항목을 분리해 월별로 확인합니다."}
          </p>
        </div>
        <div className="naver-detail-controls">
          {availableReports.length > 1 && (
            <label className="naver-period-select">
              <span>월 선택</span>
              <select value={selectedPeriodKey} onChange={(event) => setSelectedPeriodKey(event.target.value)}>
                {availableReports.map((item) => (
                  <option key={item.periodKey} value={item.periodKey}>
                    {item.periodLabel}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Segmented
            value={activeTab}
            items={naverDetailTabs.map((tab) => ({ value: tab.id, label: tab.label }))}
            onChange={(value) => setActiveTab(value as NaverDetailTab)}
          />
        </div>
      </div>

      {activeTab === "required" && (
        <div className="naver-required-grid">
          {requiredMetrics.map((metric) => (
            <div className="naver-required-row" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <em>{metric.delta}</em>
              <small>{metric.note}</small>
            </div>
          ))}
        </div>
      )}

      {activeTab === "traffic" && (
        <div className="naver-drill-grid">
          <div className="naver-bar-list">
            {trafficSources.map((source) => (
              <div className="naver-bar-row" key={source.label}>
                <div>
                  <strong>{source.label}</strong>
                  <span>{source.value} · {source.delta}</span>
                </div>
                <div className="naver-bar-track">
                  <span style={{ width: `${source.share}%` }} />
                </div>
                <em>{source.share}%</em>
              </div>
            ))}
          </div>
          <div className="naver-note-box">
            <strong>확인 포인트</strong>
            <p>검색 유입이 높으면 SEO용 기술 콘텐츠를 유지하고, 외부 유입이 늘면 링크가 걸린 캠페인/광고 소재와 연결해 봅니다.</p>
          </div>
        </div>
      )}

      {activeTab === "segments" && (
        <div className="naver-drill-grid">
          <div className="naver-segment-list">
            {distributionRows.map((row) => (
              <div className="naver-segment-row" key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
                <small>{row.detail}</small>
              </div>
            ))}
          </div>
          <div className="naver-ranking-list">
            {rankingRows.map((row) => (
              <div className="naver-ranking-row" key={row.metric}>
                <span>{row.metric}</span>
                <strong>{row.title}</strong>
                <em>{row.value}</em>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "validation" && (
        <div className="naver-validation-grid">
          {validationRows.map((row) => (
            <div className="naver-validation-row" key={row.label}>
              <div>
                <strong>{row.label}</strong>
                <span>{row.sourceFileName ? `${row.type} · ${row.sourceFileName}` : row.type}</span>
              </div>
              <StatusPill status={row.status} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MessageBubbleIcon() {
  return (
    <span className="message-bubble-icon" aria-hidden="true">
      AI
    </span>
  );
}

function ContentLab({
  data,
  selectedTab,
  onSelectTab,
  onGenerateCampaign,
  onGenerateAd,
  onSaveContentCard,
  onMoveContentCard,
  onDeleteContentCard,
  onCreateCampaignFromContent,
  onSaveAd,
  onDeleteAd,
}: {
  data: ContentLabSnapshot;
  selectedTab: ContentTab;
  onSelectTab: (tab: ContentTab) => void;
  onGenerateCampaign: (campaign?: string) => void;
  onGenerateAd: (ad?: string) => void;
  onSaveContentCard: (card: ContentItem) => Promise<ContentLabSnapshot>;
  onMoveContentCard: (contentId: string, status: string) => Promise<ContentLabSnapshot>;
  onDeleteContentCard: (contentId: string) => Promise<ContentLabSnapshot>;
  onCreateCampaignFromContent: (sourceContentId?: string) => Promise<ContentLabSnapshot>;
  onSaveAd: (ad: AdContent) => Promise<ContentLabSnapshot>;
  onDeleteAd: (adId: string) => Promise<ContentLabSnapshot>;
}) {
  const contentLibrary = useMemo(() => [...data.archive, ...data.pipeline], [data.archive, data.pipeline]);

  return (
    <div className="screen-stack">
      <div className="sub-nav">
        {contentTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={selectedTab === tab.id ? "sub-nav-button active" : "sub-nav-button"}
              onClick={() => onSelectTab(tab.id)}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {selectedTab === "publishing" && <PublishingPlan data={data} />}
      {selectedTab === "pipeline" && (
        <PipelineBoard
          items={data.pipeline}
          campaigns={data.campaigns}
          contentLibrary={contentLibrary}
          onMoveCard={onMoveContentCard}
          onSaveCard={onSaveContentCard}
          onDeleteCard={onDeleteContentCard}
        />
      )}
      {selectedTab === "campaigns" && (
        <CampaignPerformance data={data} onGenerate={onGenerateCampaign} onCreateCampaign={onCreateCampaignFromContent} />
      )}
      {selectedTab === "ads" && (
        <AdContentManager data={data} onGenerate={onGenerateAd} onSaveAd={onSaveAd} onDeleteAd={onDeleteAd} />
      )}
      {selectedTab === "archive" && (
        <section className="section-panel">
          <div className="section-header">
            <div>
              <h2>발행 전체 아카이브</h2>
              <p>채널별 필터와 성과 연결</p>
            </div>
            <Search size={18} />
          </div>
          <ContentTable items={data.archive} />
        </section>
      )}
    </div>
  );
}

function buildContentCalendarEvents(data: ContentLabSnapshot): PublishingCalendarEvent[] {
  const seen = new Set<string>();
  const contentItems = [...data.archive, ...data.pipeline];

  return contentItems.flatMap((item) => {
    const date = parseContentDate(item.publishDate);
    if (!date || item.publishDate === "미정") return [];

    const dateKey = formatDateKey(date);
    const key = `${item.id}-${dateKey}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const locked = isBeforeDay(date, TODAY);
    const isToday = isSameDay(date, TODAY);
    const status: PublishingCalendarEvent["status"] = locked
      ? "published"
      : item.status === "발행됨"
        ? "published"
        : item.status === "예약"
          ? "scheduled"
          : isToday
            ? "today"
            : "scheduled";

    return [
      {
        id: key,
        title: item.title,
        channel: item.channel,
        type: item.type,
        date,
        status,
        locked,
        metric: locked || item.linkedPostId ? `${item.metricValue} ${item.metricLabel}` : undefined,
        source: "content" as const,
      },
    ];
  });
}

function buildRuleCalendarEvents(
  data: ContentLabSnapshot,
  rangeStart: Date,
  rangeEnd: Date,
  existingEvents: PublishingCalendarEvent[],
) {
  const events: PublishingCalendarEvent[] = [];
  const existingSlots = new Set(
    existingEvents.map((event) => `${formatDateKey(event.date)}-${event.channel}-${event.type.toLowerCase()}`),
  );

  for (let cursor = startOfDay(rangeStart); cursor <= startOfDay(rangeEnd); cursor = addDays(cursor, 1)) {
    if (isBeforeDay(cursor, TODAY)) continue;
    const weekday = getWeekdayLabel(cursor);

    data.publishingRules.forEach((rule) => {
      if (!rule.days.includes(weekday)) return;
      const slotKey = `${formatDateKey(cursor)}-${rule.channel}-${rule.label.toLowerCase()}`;
      if (existingSlots.has(slotKey)) return;

      events.push({
        id: `rule-${rule.id}-${formatDateKey(cursor)}`,
        title: rule.label,
        channel: rule.channel,
        type: rule.cadence,
        date: new Date(cursor),
        time: rule.time,
        status: isSameDay(cursor, TODAY) ? "today" : "scheduled",
        locked: false,
        source: "rule",
      });
    });
  }

  return events;
}

function getPublishingCalendarEvents(data: ContentLabSnapshot, rangeStart: Date, rangeEnd: Date) {
  const contentEvents = buildContentCalendarEvents(data).filter((event) => isWithinRange(event.date, rangeStart, rangeEnd));
  const ruleEvents = buildRuleCalendarEvents(data, rangeStart, rangeEnd, contentEvents);

  return [...contentEvents, ...ruleEvents].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });
}

function PublishingPlan({ data }: { data: ContentLabSnapshot }) {
  const [ruleTimes, setRuleTimes] = useState<Record<string, string>>(() => readStoredRuleTimes());

  const updateRuleTime = (id: string, time: string) => {
    setRuleTimes((prev) => {
      const next = { ...prev, [id]: time };
      writeStoredRuleTimes(next);
      return next;
    });
  };
  const [calendarMode, setCalendarMode] = useState<PublishingCalendarMode>("week");
  const [cursorDate, setCursorDate] = useState(TODAY);

  const rangeStart = calendarMode === "week" ? startOfWeek(cursorDate) : startOfMonth(cursorDate);
  const rangeEnd = calendarMode === "week" ? addDays(rangeStart, 6) : endOfMonth(cursorDate);
  const calendarEvents = useMemo(
    () => getPublishingCalendarEvents(data, rangeStart, rangeEnd),
    [data, rangeStart.getTime(), rangeEnd.getTime()],
  );
  const lockedRange = isBeforeDay(rangeEnd, TODAY);

  const moveCalendar = (direction: -1 | 1) => {
    setCursorDate((current) => (calendarMode === "week" ? addDays(current, direction * 7) : addMonths(current, direction)));
  };

  return (
    <>
      <section className="summary-band">
        <div>
          <span className="eyebrow">Publishing Plan</span>
          <h1>발행 계획 관리</h1>
          <p>콘텐츠 유형별 발행 규칙과 이번 주 발행 슬롯을 함께 봅니다.</p>
        </div>
        <button className="button primary">
          <Plus size={16} />
          콘텐츠 추가
        </button>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <div>
            <h2>발행 캘린더</h2>
            <p>
              {formatCalendarTitle(cursorDate, calendarMode)} · 실제 발행 데이터 {calendarEvents.filter((event) => event.source === "content").length}건
              / 규칙 슬롯 {calendarEvents.filter((event) => event.source === "rule").length}건
            </p>
          </div>
          <div className="calendar-toolbar">
            <Segmented
              value={calendarMode}
              items={[
                { value: "week", label: "주별" },
                { value: "month", label: "월별" },
              ]}
              onChange={(value) => {
                setCalendarMode(value as PublishingCalendarMode);
                setCursorDate(TODAY);
              }}
            />
            <div className="calendar-nav">
              <button className="button secondary small" onClick={() => moveCalendar(-1)}>
                <ChevronLeft size={15} />
                이전 {calendarMode === "week" ? "주" : "달"}
              </button>
              <button className="button secondary small" onClick={() => setCursorDate(TODAY)}>
                오늘
              </button>
              <button className="button secondary small" onClick={() => moveCalendar(1)}>
                다음 {calendarMode === "week" ? "주" : "달"}
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>

        {calendarMode === "week" ? (
          <PublishingWeekCalendar start={rangeStart} events={calendarEvents} />
        ) : (
          <PublishingMonthCalendar cursor={cursorDate} events={calendarEvents} />
        )}

        <div className="inline-note">
          <AlertCircle size={16} />
          {lockedRange
            ? "이전 기간입니다. 표시된 발행 콘텐츠는 실제 발행 완료 데이터로 잠겨 있어 수정할 수 없습니다."
            : "오늘보다 이전 날짜는 실제 발행 완료 데이터로 잠겨 있고, 오늘 이후 슬롯은 발행 규칙에 따라 자동 생성됩니다."}
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <div>
            <h2>콘텐츠 유형별 발행 규칙</h2>
            <p>요일 클릭 · 시간 조정</p>
          </div>
        </div>
        <div className="rules-table">
          {data.publishingRules.map((rule) => (
            <div className="rule-row" key={rule.id}>
              <div>
                <ChannelBadge channel={rule.channel} />
                <strong>{rule.label}</strong>
              </div>
              <select defaultValue={rule.cadence} aria-label={`${rule.label} 주기`}>
                <option>매주</option>
                <option>격주</option>
                <option>매월</option>
                <option>상시</option>
              </select>
              <div className="weekday-row">
                {["월", "화", "수", "목", "금", "토", "일"].map((day) => (
                  <button key={day} className={rule.days.includes(day) ? "weekday active" : "weekday"}>
                    {day}
                  </button>
                ))}
              </div>
              <input
                type="time"
                className="time-input"
                value={ruleTimes[rule.id] ?? rule.time}
                aria-label={`${rule.label} 발행 시간`}
                onChange={(event) => updateRuleTime(rule.id, event.target.value)}
              />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function PublishingWeekCalendar({ start, events }: { start: Date; events: PublishingCalendarEvent[] }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

  return (
    <div className="publishing-calendar week-mode">
      {days.map((date) => (
        <PublishingCalendarCell
          date={date}
          events={events.filter((event) => isSameDay(event.date, date))}
          key={formatDateKey(date)}
        />
      ))}
    </div>
  );
}

function PublishingMonthCalendar({ cursor, events }: { cursor: Date; events: PublishingCalendarEvent[] }) {
  const monthStart = startOfMonth(cursor);
  const offset = (monthStart.getDay() + 6) % 7;
  const daysInMonth = endOfMonth(cursor).getDate();
  const cells = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(cursor.getFullYear(), cursor.getMonth(), index + 1)),
  ];
  const trailing = (7 - (cells.length % 7)) % 7;
  const paddedCells = [...cells, ...Array.from({ length: trailing }, () => null)];

  return (
    <div className="publishing-month-wrap">
      <div className="calendar-heading-row">
        {WEEKDAY_LABELS.map((day) => (
          <div className="calendar-heading" key={day}>
            {day}
          </div>
        ))}
      </div>
      <div className="publishing-calendar month-mode">
        {paddedCells.map((date, index) =>
          date ? (
            <PublishingCalendarCell
              date={date}
              events={events.filter((event) => isSameDay(event.date, date))}
              key={formatDateKey(date)}
              compact
            />
          ) : (
            <div className="calendar-cell empty" key={`empty-${index}`} />
          ),
        )}
      </div>
    </div>
  );
}

function PublishingCalendarCell({
  date,
  events,
  compact = false,
}: {
  date: Date;
  events: PublishingCalendarEvent[];
  compact?: boolean;
}) {
  const locked = isBeforeDay(date, TODAY);
  const today = isSameDay(date, TODAY);
  const visibleEvents = events.slice(0, compact ? 3 : 5);
  const hiddenCount = Math.max(0, events.length - visibleEvents.length);

  return (
    <div className={["calendar-cell", locked ? "locked" : "", today ? "today" : ""].filter(Boolean).join(" ")}>
      <div className="calendar-cell-head">
        <strong>
          {compact ? date.getDate() : `${getWeekdayLabel(date)} ${date.getMonth() + 1}/${date.getDate()}`}
        </strong>
        {(locked || today) && <span>{locked ? "발행완료" : "오늘"}</span>}
      </div>

      <div className="calendar-events">
        {visibleEvents.map((event) => (
          <div
            className={["calendar-event", `chip-${event.channel}`, event.locked ? "locked" : "", event.source === "rule" ? "rule" : ""]
            .filter(Boolean)
            .join(" ")}
            key={event.id}
            title={`${event.title} · ${event.locked ? "수정 불가" : "규칙 기반 자동 등록"}`}
          >
            <b>{event.time ?? (event.locked ? "완료" : event.status === "today" ? "오늘" : "예정")}</b>
            <span>{event.title}</span>
            <em>{event.metric ?? event.type}</em>
          </div>
        ))}
        {hiddenCount > 0 && <span className="calendar-more">+{hiddenCount}개 더</span>}
        {events.length === 0 && <span className="calendar-empty-text">{locked ? "발행 기록 없음" : "계획 없음"}</span>}
      </div>
    </div>
  );
}

function hasCollectedPerformance(item: ContentItem) {
  const planningLabels = ["담당", "소재", "예약", "성과", "자동 수집"];
  return Boolean(
    item.linkedPostId ||
      (item.status === "발행됨" &&
        item.metricValue &&
        item.metricValue !== "미연결" &&
        item.metricValue !== "게시물 연결 후" &&
      !planningLabels.includes(item.metricLabel)),
  );
}

function getContentSourceId(item: ContentItem) {
  return item.linkedPostId ?? item.id;
}

function filterContentItems(items: ContentItem[], query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return items;

  return items.filter((item) =>
    [
      item.title,
      item.type,
      item.status,
      item.campaign,
      item.publishDate,
      item.metricLabel,
      item.metricValue,
      item.performanceSource,
      channelMeta[item.channel].label,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword)),
  );
}

function PipelineBoard({
  items,
  campaigns,
  contentLibrary,
  onMoveCard,
  onSaveCard,
  onDeleteCard,
}: {
  items: ContentItem[];
  campaigns: CampaignRow[];
  contentLibrary: ContentItem[];
  onMoveCard: (contentId: string, status: string) => Promise<ContentLabSnapshot>;
  onSaveCard: (card: ContentItem) => Promise<ContentLabSnapshot>;
  onDeleteCard: (contentId: string) => Promise<ContentLabSnapshot>;
}) {
  const columns = ["아이디어", "초안", "예약", "발행됨"];
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<ContentItem | null>(null);
  const [columnPages, setColumnPages] = useState<Record<string, number>>({});
  const editorContentLibrary = useMemo(() => {
    const cardIds = new Set(items.map((card) => card.id));
    return [...contentLibrary.filter((item) => !cardIds.has(item.id)), ...items];
  }, [items, contentLibrary]);

  const handleDrop = async (status: string) => {
    if (!draggedId) return;
    const nextId = draggedId;
    setDraggedId(null);
    await onMoveCard(nextId, status);
  };

  const openNewCard = () => {
    setEditingCard({
      id: `draft-${Date.now()}`,
      title: "",
      channel: "instagram",
      type: "릴스",
      status: "아이디어",
      campaign: "캠페인 없음",
      publishDate: "미정",
      metricLabel: "자동 수집",
      metricValue: "게시물 연결 후",
      draft: "",
    });
  };

  const saveCard = async (nextCard: ContentItem) => {
    await onSaveCard(nextCard);
    setEditingCard(null);
  };

  const deleteCard = async (id: string) => {
    await onDeleteCard(id);
    setEditingCard(null);
  };

  return (
    <>
      <section className="summary-band">
        <div>
          <span className="eyebrow">Content Pipeline</span>
          <h1>콘텐츠 파이프라인</h1>
          <p>카드를 이동해 운영 단계를 바꾸고, 발행된 카드는 실제 게시물 API 성과와 연결합니다.</p>
        </div>
        <div className="summary-actions">
          <button className="button secondary">
            <RefreshCw size={16} />
            최신 상태
          </button>
          <button className="button primary" onClick={openNewCard}>
            <Plus size={16} />
            아이디어 추가
          </button>
        </div>
      </section>

      <div className="kanban-board">
        {columns.map((column) => (
          <KanbanColumn
            cards={items.filter((item) => item.status === column)}
            column={column}
            key={column}
            onAdd={openNewCard}
            onDragStart={setDraggedId}
            onDrop={handleDrop}
            onEdit={setEditingCard}
            page={columnPages[column] ?? 1}
            setPage={(page) => setColumnPages((current) => ({ ...current, [column]: page }))}
          />
        ))}
      </div>
      {editingCard && (
        <ContentCardEditor
          card={editingCard}
          campaigns={campaigns}
          contentLibrary={editorContentLibrary}
          onClose={() => setEditingCard(null)}
          onDelete={deleteCard}
          onSave={saveCard}
        />
      )}
    </>
  );
}

function KanbanColumn({
  cards,
  column,
  onAdd,
  onDragStart,
  onDrop,
  onEdit,
  page,
  setPage,
}: {
  cards: ContentItem[];
  column: string;
  onAdd: () => void;
  onDragStart: (id: string) => void;
  onDrop: (status: string) => void;
  onEdit: (card: ContentItem) => void;
  page: number;
  setPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pagedCards = cards.slice(start, start + PAGE_SIZE);
  const pagination: PaginationState<ContentItem> = {
    page: safePage,
    totalPages,
    totalItems: cards.length,
    start,
    end: Math.min(start + PAGE_SIZE, cards.length),
    pagedItems: pagedCards,
    setPage,
  };

  return (
    <section className="kanban-column" onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(column)}>
      <div className="kanban-title">
        <strong>{column}</strong>
        <span>{cards.length}</span>
        {column === "아이디어" && (
          <button className="icon-button mini" onClick={onAdd} aria-label="아이디어 추가">
            <Plus size={15} />
          </button>
        )}
      </div>
      {pagedCards.map((item) => {
        const collected = hasCollectedPerformance(item);

        return (
          <button
            className="content-card"
            draggable
            key={item.id}
            onClick={() => onEdit(item)}
            onDragStart={() => onDragStart(item.id)}
          >
            <div className="content-card-head">
              <ChannelBadge channel={item.channel} />
              <span className={collected ? "link-state linked" : "link-state"}>
                {collected ? "성과 수집" : item.status === "예약" ? "예약 대기" : "성과 대기"}
              </span>
            </div>
            <strong>{item.title}</strong>
            <span>{item.type} · {item.campaign ?? "캠페인 없음"}</span>
            <small>{item.linkedPostTitle ?? item.draft ?? item.publishDate}</small>
            {item.decisionLogs?.[0] && <small className="decision-log-preview">{item.decisionLogs[0]}</small>}
            {collected ? (
              <div className="card-metric">
                <strong>{item.metricValue}</strong>
                <span>{item.metricLabel}</span>
              </div>
            ) : (
              <div className="card-performance-pending">실제 게시물 연결 후 API/업로드 데이터 자동 반영</div>
            )}
          </button>
        );
      })}
      <Pagination pagination={pagination} compact />
    </section>
  );
}

function ContentCardEditor({
  card,
  campaigns,
  contentLibrary,
  onClose,
  onDelete,
  onSave,
}: {
  card: ContentItem;
  campaigns: CampaignRow[];
  contentLibrary: ContentItem[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onSave: (card: ContentItem) => void;
}) {
  const [form, setForm] = useState(card);
  const [showPosts, setShowPosts] = useState(false);
  const [postSearch, setPostSearch] = useState("");
  const [decisionLogDraft, setDecisionLogDraft] = useState("");
  const update = (patch: Partial<ContentItem>) => setForm((current) => ({ ...current, ...patch }));
  const collected = hasCollectedPerformance(form);
  const connectedPosts = useMemo(() => {
    const byId = new Map<string, ContentItem>();

    contentLibrary.forEach((item) => {
      if (item.id === form.id) return;
      if (!hasCollectedPerformance(item)) return;
      byId.set(item.linkedPostId ?? item.id, item);
    });

    return Array.from(byId.values()).sort((a, b) => getPublishTime(b) - getPublishTime(a));
  }, [contentLibrary, form.id]);
  const filteredPosts = filterContentItems(connectedPosts, postSearch);
  const connectPost = (post: ContentItem) => {
    update({
      channel: post.channel,
      type: post.type,
      status: "발행됨",
      campaignId: post.campaignId,
      campaign: post.campaign,
      publishDate: post.publishDate,
      metricLabel: post.metricLabel,
      metricValue: post.metricValue,
      linkedPostId: getContentSourceId(post),
      linkedPostTitle: post.title,
      performanceSource: post.performanceSource,
      externalUrl: getContentExternalUrl(post),
    });
    setShowPosts(false);
  };
  const addDecisionLog = () => {
    const nextLog = decisionLogDraft.trim();
    if (!nextLog) return;
    update({
      decisionLogs: [`2026.07.29 · ${nextLog}`, ...(form.decisionLogs ?? [])],
    });
    setDecisionLogDraft("");
  };

  return (
    <ModalShell title={`${form.status} 편집`} icon={<FileText size={18} />} onClose={onClose} size="medium">
      <div className="editor-body">
        <label className="field full">
          <span>제목</span>
          <input value={form.title} onChange={(event) => update({ title: event.target.value })} placeholder="콘텐츠 제목" />
        </label>
        <label className="field">
          <span>채널</span>
          <select
            value={form.channel}
            onChange={(event) => update({ channel: event.target.value as Exclude<ChannelId, "all"> })}
          >
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn</option>
            <option value="naver">Blog</option>
            <option value="website">Website</option>
          </select>
        </label>
        <label className="field">
          <span>유형</span>
          <input value={form.type} onChange={(event) => update({ type: event.target.value })} placeholder="릴스, 카드뉴스, 블로그글" />
        </label>
        <label className="field">
          <span>캠페인</span>
          <select
            value={form.campaign ?? "캠페인 없음"}
            onChange={(event) => update({ campaign: event.target.value, campaignId: getCampaignIdByName(campaigns, event.target.value) })}
          >
            <option>캠페인 없음</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id}>{campaign.campaign}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>단계</span>
          <select value={form.status} onChange={(event) => update({ status: event.target.value })}>
            <option>아이디어</option>
            <option>초안</option>
            <option>예약</option>
            <option>발행됨</option>
          </select>
        </label>
        <label className="field">
          <span>발행일</span>
          <input value={form.publishDate} onChange={(event) => update({ publishDate: event.target.value })} placeholder="7/28 또는 미정" />
        </label>
        <div className="field full">
          <span>성과 수집 상태</span>
          <div className={collected ? "performance-state linked" : "performance-state"}>
            {collected ? (
              <>
                <strong>{form.metricValue} {form.metricLabel}</strong>
                <em>{form.performanceSource ?? "연결된 게시물 성과"}</em>
              </>
            ) : (
              <>
                <strong>게시물 연결 후 자동 수집</strong>
                <em>기획 단계에서는 성과값을 직접 입력하지 않습니다.</em>
              </>
            )}
          </div>
        </div>
        <div className="field full">
          <span>실제 게시물 연결</span>
          <button className="button secondary full-button" onClick={() => setShowPosts((value) => !value)}>
            <Search size={16} />
            수집 게시물 불러오기
          </button>
          {form.linkedPostTitle && (
            <div className="linked-post-note">
              <strong>{form.linkedPostTitle}</strong>
              <span>{form.performanceSource} · {form.metricValue} {form.metricLabel}</span>
            </div>
          )}
          {showPosts && (
            <>
              <label className="result-search">
                <Search size={15} />
                <input
                  value={postSearch}
                  onChange={(event) => setPostSearch(event.target.value)}
                  placeholder="제목, 채널, 캠페인, 성과로 검색"
                />
              </label>
              <div className="post-result-list">
                {filteredPosts.map((post) => (
                  <button key={post.id} onClick={() => connectPost(post)}>
                    <span>{post.title}</span>
                    <strong>{post.metricValue} {post.metricLabel}</strong>
                  </button>
                ))}
                {filteredPosts.length === 0 && <div className="empty-result">검색 결과가 없습니다.</div>}
              </div>
            </>
          )}
        </div>
        <label className="field full">
          <span>초안 내용</span>
          <textarea
            value={form.draft ?? ""}
            onChange={(event) => update({ draft: event.target.value })}
            placeholder="본문 메모, 스크립트, 참고 링크를 적습니다."
          />
        </label>
        <div className="field full">
          <span>판단 로그</span>
          <div className="decision-log-box">
            <div className="decision-log-input">
              <input
                value={decisionLogDraft}
                onChange={(event) => setDecisionLogDraft(event.target.value)}
                placeholder="예: 다음달 재집행, 썸네일 교체, CTA 강화"
              />
              <button className="button secondary" onClick={addDecisionLog}>
                추가
              </button>
            </div>
            <div className="decision-log-list">
              {(form.decisionLogs ?? ["2026.07.29 · 아직 판단 로그가 없습니다."]).map((log) => (
                <span key={log}>{log}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="editor-actions">
          <button className="button danger" onClick={() => onDelete(form.id)}>
            삭제
          </button>
          <div>
            <button className="button secondary" onClick={onClose}>
              취소
            </button>
            <button className="button dark" onClick={() => onSave(form)}>
              저장
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

const campaignChannelIds: Array<Exclude<ChannelId, "all">> = ["youtube", "tiktok", "instagram", "linkedin", "naver", "website"];

function parseMetricScore(value?: string) {
  if (!value || value === "-" || value.includes("예약") || value.includes("미등록")) return 0;
  const match = value.match(/[\d,.]+/);
  if (!match) return 0;
  const base = Number(match[0].replace(/,/g, ""));
  if (Number.isNaN(base)) return 0;
  if (value.toUpperCase().includes("K")) return base * 1000;
  if (value.includes("만")) return base * 10000;
  return base;
}

function formatShortDate(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getCampaignContent(data: ContentLabSnapshot, campaign: CampaignRow) {
  const allContent = [...data.pipeline, ...data.archive];
  if (campaign.contentIds?.length) {
    const contentIdSet = new Set(campaign.contentIds);
    return allContent.filter((item) => contentIdSet.has(item.id) || (item.linkedPostId && contentIdSet.has(item.linkedPostId)));
  }

  return allContent.filter((item) => contentBelongsToCampaign(item, campaign));
}

function getCampaignAds(data: ContentLabSnapshot, campaign: CampaignRow) {
  return data.ads.filter((ad) => adBelongsToCampaign(ad, campaign));
}

function getCampaignUploadPeriod(data: ContentLabSnapshot, campaign: CampaignRow) {
  const dates = getCampaignContent(data, campaign)
    .map((item) => parseContentDate(item.publishDate))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length === 0) return "기간 미연결";
  return dates.length === 1 ? formatShortDate(dates[0]) : `${formatShortDate(dates[0])} - ${formatShortDate(dates[dates.length - 1])}`;
}

function getCampaignTopicFromContent(item: ContentItem) {
  const campaign = item.campaign?.trim();
  if (campaign && !/없음|API|Analytics/i.test(campaign)) return campaign;

  const titleTopic = item.title
    .replace(/\[[^\]]+\]/g, "")
    .split(/[|#]/)[0]
    .trim();

  return titleTopic || item.title.slice(0, 40);
}

function buildGeneratedCampaignFromContentLab(data: ContentLabSnapshot, sourceContentId?: string): CampaignRow | null {
  const candidates = [...data.pipeline, ...data.archive]
    .filter(hasCollectedPerformance)
    .sort((a, b) => parseMetricScore(b.metricValue) - parseMetricScore(a.metricValue));
  const source =
    candidates.find((item) => item.id === sourceContentId || getContentSourceId(item) === sourceContentId) ?? candidates[0];
  if (!source) return null;

  const topic = getCampaignTopicFromContent(source);
  const topicSeed = topic.split(/\s+/)[0] || topic;
  const related = candidates
    .filter(
      (item) =>
        getContentSourceId(item) === getContentSourceId(source) ||
        (source.campaignId && item.campaignId === source.campaignId) ||
        (source.campaign && item.campaign === source.campaign) ||
        item.title.includes(topic) ||
        item.title.includes(topicSeed),
    )
    .slice(0, 12);
  const relatedContent = related.length ? related : [source];
  const byChannel = (channel: ContentItem["channel"]) =>
    relatedContent
      .filter((item) => item.channel === channel)
      .sort((a, b) => parseMetricScore(b.metricValue) - parseMetricScore(a.metricValue))[0];
  const metricFor = (channel: ContentItem["channel"]) => {
    const item = byChannel(channel);
    return item ? `${item.metricValue} ${item.metricLabel}` : undefined;
  };
  const bestItem = [...relatedContent].sort((a, b) => parseMetricScore(b.metricValue) - parseMetricScore(a.metricValue))[0] ?? source;

  return {
    id: `camp-auto-${getContentSourceId(source)}-${Date.now()}`,
    campaign: `${topic} 캠페인`,
    objective: "연결된 실제 게시물 기반 자동 생성",
    contentIds: relatedContent.map(getContentSourceId),
    contentCount: relatedContent.length,
    linkedPostCount: relatedContent.filter(hasCollectedPerformance).length,
    adCount: 0,
    youtube: metricFor("youtube"),
    tiktok: metricFor("tiktok"),
    instagram: metricFor("instagram"),
    linkedin: metricFor("linkedin"),
    naver: metricFor("naver"),
    website: metricFor("website"),
    total: `콘텐츠 ${relatedContent.length}개 · 연결 ${relatedContent.filter(hasCollectedPerformance).length}개`,
    bestChannel: channelMeta[bestItem.channel].label,
  };
}

function getCampaignChannelRows(campaign: CampaignRow) {
  const rows = campaignChannelIds.map((channel) => ({
    channel,
    label: channelMeta[channel].label,
    value: campaign[channel] ?? "미등록",
    score: parseMetricScore(campaign[channel]),
  }));
  const max = Math.max(...rows.map((row) => row.score), 1);

  return rows.map((row) => ({
    ...row,
    width: row.score > 0 ? Math.max(8, Math.round((row.score / max) * 100)) : 0,
  }));
}

function CampaignPerformance({
  data,
  onGenerate,
  onCreateCampaign,
}: {
  data: ContentLabSnapshot;
  onGenerate: (campaign?: string) => void;
  onCreateCampaign: (sourceContentId?: string) => Promise<ContentLabSnapshot>;
}) {
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRow | null>(null);
  const campaignData = data;
  const campaignPagination = usePaginatedItems(data.campaigns);
  const createCampaignFromContent = async () => {
    const nextData = await onCreateCampaign();
    setSelectedCampaign(nextData.campaigns[0] ?? null);
  };

  return (
    <>
      <section className="summary-band">
        <div>
          <span className="eyebrow">Campaign Performance</span>
          <h1>캠페인 × 채널 성과</h1>
          <p>하나의 캠페인이 채널별로 만든 다른 성과를 나눠 봅니다.</p>
        </div>
        <div className="summary-actions">
          <button className="button secondary" onClick={createCampaignFromContent}>
            <Plus size={16} />
            캠페인 생성
          </button>
          <button className="button dark" onClick={() => onGenerate()}>
            <Bot size={16} />
            AI 캠페인 분석
          </button>
        </div>
      </section>

      <section className="section-panel">
        <div className="table-scroll">
          <table className="data-table campaign-table">
            <thead>
              <tr>
                <th>캠페인</th>
                <th>업로드 기간</th>
                <th>YouTube</th>
                <th>TikTok</th>
                <th>Instagram</th>
                <th>LinkedIn</th>
                <th>Blog</th>
                <th>Website</th>
                <th>연결</th>
                <th>종합</th>
              </tr>
            </thead>
            <tbody>
              {campaignPagination.pagedItems.map((campaign) => (
                <tr className="clickable-row" key={campaign.id} onClick={() => setSelectedCampaign(campaign)}>
                  <td>
                    <strong>{campaign.campaign}</strong>
                    <span>{campaign.objective} · 클릭해서 상세 보기</span>
                  </td>
                  <td>{getCampaignUploadPeriod(campaignData, campaign)}</td>
                  <td>{campaign.youtube ?? "-"}</td>
                  <td>{campaign.tiktok ?? "-"}</td>
                  <td>{campaign.instagram ?? "-"}</td>
                  <td>{campaign.linkedin ?? "-"}</td>
                  <td>{campaign.naver ?? "-"}</td>
                  <td>{campaign.website ?? "-"}</td>
                  <td>
                    <span className="connection-stack">
                      카드 {campaign.contentCount ?? 0}
                      <br />
                      게시물 {campaign.linkedPostCount ?? 0}
                    </span>
                  </td>
                  <td>{campaign.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination pagination={campaignPagination} />
      </section>

      <section className="section-panel relation-panel">
        <div className="relation-step">
          <span>1</span>
          <strong>캠페인 행 선택</strong>
          <p>표에서 캠페인을 클릭해 상세 성과 확인</p>
        </div>
        <div className="relation-arrow">→</div>
        <div className="relation-step">
          <span>2</span>
          <strong>실제 게시물 연결</strong>
          <p>YouTube · TikTok · Instagram · Blog · Website</p>
        </div>
        <div className="relation-arrow">→</div>
        <div className="relation-step">
          <span>3</span>
          <strong>성과 반영</strong>
          <p>채널별 업로드 콘텐츠 성과에 자동 반영</p>
        </div>
      </section>

      {selectedCampaign && (
        <CampaignDetailModal
          campaign={selectedCampaign}
          data={campaignData}
          onClose={() => setSelectedCampaign(null)}
          onGenerate={() => onGenerate(selectedCampaign.campaign)}
        />
      )}
    </>
  );
}

function CampaignDetailModal({
  campaign,
  data,
  onClose,
  onGenerate,
}: {
  campaign: CampaignRow;
  data: ContentLabSnapshot;
  onClose: () => void;
  onGenerate: () => void;
}) {
  const content = getCampaignContent(data, campaign);
  const channelRows = getCampaignChannelRows(campaign);
  const activeRows = channelRows.filter((row) => row.score > 0 || row.value !== "미등록");
  const totalScore = activeRows.reduce((sum, row) => sum + row.score, 0);
  const topChannel = [...activeRows].sort((a, b) => b.score - a.score)[0];

  return (
    <ModalShell title={`${campaign.campaign} 상세 성과`} icon={<LineChart size={18} />} onClose={onClose} size="large">
      <div className="modal-stack">
        <div className="campaign-detail-head">
          <div>
            <span className="eyebrow">Campaign Detail</span>
            <h2>{campaign.campaign}</h2>
            <p>{campaign.objective}</p>
          </div>
          <button className="button dark" onClick={onGenerate}>
            <Bot size={16} />
            이 캠페인 AI 브리핑
          </button>
        </div>

        <div className="campaign-kpi-grid">
          <div>
            <span>콘텐츠 업로드 기간</span>
            <strong>{getCampaignUploadPeriod(data, campaign)}</strong>
          </div>
          <div>
            <span>업로드 콘텐츠</span>
            <strong>{content.length || campaign.contentCount || 0}개</strong>
          </div>
          <div>
            <span>연결 상태</span>
            <strong>카드 {campaign.contentCount ?? content.length} · 게시물 {campaign.linkedPostCount ?? 0}</strong>
          </div>
          <div>
            <span>상위 채널</span>
            <strong>{topChannel ? `${topChannel.label} · ${topChannel.value}` : campaign.bestChannel}</strong>
          </div>
        </div>

        <section className="campaign-visual-panel">
          <div className="section-header">
            <div>
              <h2>채널별 성과</h2>
              <p>서로 다른 지표 단위는 합산하지 않고 채널 안 대표 성과로 비교합니다.</p>
            </div>
            <span className="status-pill status-partial">단위 혼합</span>
          </div>
          <div className="campaign-channel-list">
            {channelRows.map((row) => (
              <div className="campaign-channel-row" key={row.channel}>
                <ChannelBadge channel={row.channel} />
                <div className="campaign-bar-track">
                  <span className="campaign-bar" style={{ width: `${row.width}%`, "--channel-color": channelMeta[row.channel].color } as React.CSSProperties} />
                </div>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <div className="campaign-detail-grid">
          <section className="campaign-visual-panel">
            <div className="section-header">
              <div>
                <h2>전체 성과 요약</h2>
                <p>마케터가 바로 봐야 할 판단 지점</p>
              </div>
            </div>
            <div className="action-list">
              <ActionItem label="총합" text={`${campaign.total} · 대표 점수 ${formatTrendValue(totalScore)}`} />
              <ActionItem label="역할" text={`${campaign.bestChannel}가 가장 강한 채널로 표시됩니다.`} />
              <ActionItem label="판단" text="확산 채널과 문의 전환 채널을 분리해서 다음 소재 재활용 우선순위를 정합니다." />
            </div>
          </section>

          <section className="campaign-visual-panel">
            <div className="section-header">
              <div>
                <h2>연결 근거</h2>
                <p>각 채널에 업로드된 콘텐츠 발행일과 성과</p>
              </div>
            </div>
            <div className="campaign-evidence-list">
              {content.slice(0, 5).map((item) => (
                <div key={item.id}>
                  <ChannelBadge channel={item.channel} compact />
                  <a className="content-title-link" href={getContentExternalUrl(item)} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                  <span>{item.publishDate} · {item.metricValue} {item.metricLabel}</span>
                </div>
              ))}
              {content.length === 0 && <p className="muted-copy">연결된 업로드 콘텐츠 데이터가 아직 없습니다.</p>}
            </div>
          </section>
        </div>
      </div>
    </ModalShell>
  );
}

function getAdContentLibrary(data: ContentLabSnapshot) {
  const byId = new Map<string, ContentItem>();

  [...data.archive, ...data.pipeline].forEach((item) => {
    byId.set(item.id, item);
  });

  return Array.from(byId.values()).sort((a, b) => {
    const aLinked = hasCollectedPerformance(a) ? 1 : 0;
    const bLinked = hasCollectedPerformance(b) ? 1 : 0;
    return bLinked - aLinked;
  });
}

function findContentForAd(contentLibrary: ContentItem[], ad: AdContent) {
  return (
    contentLibrary.find((item) => item.id === ad.sourceContentId || item.linkedPostId === ad.sourceContentId) ??
    contentLibrary.find((item) => item.title === ad.sourceContent || item.title === ad.linkedPostTitle)
  );
}

function AdContentManager({
  data,
  onGenerate,
  onSaveAd,
  onDeleteAd,
}: {
  data: ContentLabSnapshot;
  onGenerate: (ad?: string) => void;
  onSaveAd: (ad: AdContent) => Promise<ContentLabSnapshot>;
  onDeleteAd: (adId: string) => Promise<ContentLabSnapshot>;
}) {
  const [editingAd, setEditingAd] = useState<AdContent | null>(null);
  const [selectedAd, setSelectedAd] = useState<AdContent | null>(null);
  const contentLibrary = useMemo(() => getAdContentLibrary(data), [data]);
  const adsPagination = usePaginatedItems(data.ads);
  const activeCount = data.ads.filter((ad) => ad.status === "active").length;
  const plannedCount = data.ads.filter((ad) => ad.status === "planned").length;
  const endedCount = data.ads.filter((ad) => ad.status === "ended").length;

  const openNewAd = () => {
    setEditingAd({
      id: `ad-draft-${Date.now()}`,
      title: "",
      channel: "instagram",
      campaignId: getCampaignIdByName(data.campaigns, "Hydro Hawk 실증"),
      campaign: "Hydro Hawk 실증",
      sourceContentId: "",
      sourceContent: "",
      linkedPostTitle: "",
      performanceSource: "Meta Ads API 연결 대기",
      period: "2026.07.29 - 2026.08.05",
      budget: "0원",
      spend: "0원",
      impressions: "예정",
      clicks: "예정",
      ctr: "예정",
      organicLift: "대기",
      status: "planned",
    });
  };

  const saveAd = async (nextAd: AdContent) => {
    await onSaveAd(nextAd);
    setEditingAd(null);
  };

  const deleteAd = async (id: string) => {
    await onDeleteAd(id);
    setSelectedAd((current) => (current?.id === id ? null : current));
    setEditingAd(null);
  };

  return (
    <>
      <section className="summary-band">
        <div>
          <span className="eyebrow">Paid Content</span>
          <h1>광고 콘텐츠 관리</h1>
          <p>광고 집행 콘텐츠와 원본 콘텐츠 성과를 연결합니다.</p>
        </div>
        <div className="summary-actions">
          <button className="button secondary" onClick={openNewAd}>
            <Plus size={16} />
            광고 등록
          </button>
          <button className="button dark" onClick={() => onGenerate()}>
            <Bot size={16} />
            AI 광고 분석
          </button>
        </div>
      </section>

      <section className="metric-grid compact">
        <div className="metric-tile">
          <div className="tile-head">
            <span>광고 콘텐츠</span>
            <StatusPill status="partial" />
          </div>
          <div className="metric-value">{data.ads.length}</div>
          <small>활성 {activeCount} · 예정 {plannedCount} · 종료 {endedCount}</small>
        </div>
        <div className="metric-tile">
          <div className="tile-head">
            <span>집행 금액</span>
            <StatusPill status="complete" />
          </div>
          <div className="metric-value">678,000원</div>
          <small>등록 기준</small>
        </div>
        <div className="metric-tile">
          <div className="tile-head">
            <span>광고 후 유기 성과</span>
            <StatusPill status="partial" />
          </div>
          <div className="metric-value">+14%</div>
          <small>연결 콘텐츠 평균</small>
        </div>
      </section>

      <section className="section-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>콘텐츠</th>
                <th>채널</th>
                <th>원본 콘텐츠</th>
                <th>캠페인</th>
                <th>기간</th>
                <th>예산</th>
                <th>사용</th>
                <th>노출</th>
                <th>클릭</th>
                <th>CTR</th>
                <th>Organic Lift</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {adsPagination.pagedItems.map((ad) => (
                <tr className="clickable-row" key={ad.id} onClick={() => setSelectedAd(ad)}>
                  <td>
                    <strong>{ad.title}</strong>
                    <span>{ad.performanceSource ?? "성과 연결 대기"}</span>
                  </td>
                  <td>
                    <ChannelBadge channel={ad.channel} />
                  </td>
                  <td>
                    <strong>{ad.sourceContent ?? "-"}</strong>
                    <span>{ad.performanceSource ?? "원본 콘텐츠 연결 대기"}</span>
                  </td>
                  <td>{ad.campaign}</td>
                  <td>{ad.period}</td>
                  <td>{ad.budget}</td>
                  <td>{ad.spend}</td>
                  <td>{ad.impressions}</td>
                  <td>{ad.clicks}</td>
                  <td>{ad.ctr}</td>
                  <td>{ad.organicLift}</td>
                  <td>
                    <span className={`status-pill ad-${ad.status}`}>
                      {ad.status === "active" ? "집행중" : ad.status === "planned" ? "예정" : "종료"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination pagination={adsPagination} />
      </section>
      {selectedAd && (
        <AdPerformanceModal
          ad={selectedAd}
          sourceContent={findContentForAd(contentLibrary, selectedAd)}
          onClose={() => setSelectedAd(null)}
          onEdit={() => {
            setSelectedAd(null);
            setEditingAd(selectedAd);
          }}
          onGenerate={() => onGenerate(selectedAd.title)}
        />
      )}
      {editingAd && (
        <AdContentEditor
          ad={editingAd}
          campaigns={data.campaigns}
          contentLibrary={contentLibrary}
          onClose={() => setEditingAd(null)}
          onDelete={deleteAd}
          onSave={saveAd}
        />
      )}
    </>
  );
}

function getAdNumericValue(value: string) {
  return parseMetricScore(value.replace(/원/g, ""));
}

function getAdPerformanceSummary(ad: AdContent) {
  const budget = getAdNumericValue(ad.budget);
  const spend = getAdNumericValue(ad.spend);
  const impressions = getAdNumericValue(ad.impressions);
  const clicks = getAdNumericValue(ad.clicks);
  const ctr = getAdNumericValue(ad.ctr);
  const organicLift = getAdNumericValue(ad.organicLift);
  const spendRate = budget > 0 ? Math.min(100, Math.round((spend / budget) * 100)) : 0;

  let verdict = "판단 보류";
  let tone: "good" | "watch" | "weak" | "pending" = "pending";
  let note = "아직 집행 전이거나 성과 데이터가 부족합니다.";

  if (ad.status !== "planned" && spend > 0 && impressions > 0) {
    if (ctr >= 2 || organicLift >= 15) {
      verdict = "효과 있음";
      tone = "good";
      note = "클릭 효율이나 광고 후 유기 성과가 기준 이상입니다. 같은 원본 콘텐츠의 후속 집행 가치가 있습니다.";
    } else if (ctr >= 1 || organicLift >= 6) {
      verdict = "유의미함";
      tone = "watch";
      note = "성과는 확인되지만 소재/타깃/랜딩 중 하나를 더 최적화하면 좋겠습니다.";
    } else {
      verdict = "효과 약함";
      tone = "weak";
      note = "지출 대비 반응이 낮습니다. 첫 문장, 썸네일, 타깃 세그먼트를 재검토하는 편이 좋습니다.";
    }
  }

  return {
    budget,
    spend,
    impressions,
    clicks,
    ctr,
    organicLift,
    spendRate,
    verdict,
    tone,
    note,
  };
}

function AdMetricBar({
  label,
  value,
  detail,
  percent,
}: {
  label: string;
  value: string;
  detail: string;
  percent: number;
}) {
  return (
    <div className="ad-bar-row">
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <div className="ad-bar-track">
        <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
      <em>{value}</em>
    </div>
  );
}

function AdPerformanceModal({
  ad,
  sourceContent,
  onClose,
  onEdit,
  onGenerate,
}: {
  ad: AdContent;
  sourceContent?: ContentItem;
  onClose: () => void;
  onEdit: () => void;
  onGenerate: () => void;
}) {
  const performance = getAdPerformanceSummary(ad);

  return (
    <ModalShell title={`${ad.title} 광고 성과`} icon={<Megaphone size={18} />} onClose={onClose} size="large">
      <div className="modal-stack">
        <div className="campaign-detail-head">
          <div>
            <span className="eyebrow">Paid Content Detail</span>
            <h2>{ad.title}</h2>
            <p>{ad.period} · {ad.campaign} · {channelMeta[ad.channel].label}</p>
          </div>
          <div className="summary-actions">
            <button className="button secondary" onClick={onEdit}>
              <FileText size={16} />
              광고 정보 편집
            </button>
            <button className="button dark" onClick={onGenerate}>
              <Bot size={16} />
              이 광고 AI 브리핑
            </button>
          </div>
        </div>

        <div className="ad-verdict-panel">
          <span className={`ad-verdict ${performance.tone}`}>{performance.verdict}</span>
          <p>{performance.note}</p>
        </div>

        <div className="campaign-kpi-grid">
          <div>
            <span>예산</span>
            <strong>{ad.budget}</strong>
          </div>
          <div>
            <span>사용</span>
            <strong>{ad.spend}</strong>
          </div>
          <div>
            <span>CTR</span>
            <strong>{ad.ctr}</strong>
          </div>
          <div>
            <span>Organic Lift</span>
            <strong>{ad.organicLift}</strong>
          </div>
        </div>

        <section className="campaign-visual-panel">
          <div className="section-header">
            <div>
              <h2>광고 성과 시각화</h2>
              <p>Meta Ads API 연결 시 광고 ID 기준으로 자동 갱신될 지표입니다.</p>
            </div>
            <span className={`status-pill ad-${ad.status}`}>
              {ad.status === "active" ? "집행중" : ad.status === "planned" ? "예정" : "종료"}
            </span>
          </div>
          <div className="ad-bar-list">
            <AdMetricBar label="예산 사용률" value={`${performance.spendRate}%`} detail={`${ad.spend} / ${ad.budget}`} percent={performance.spendRate} />
            <AdMetricBar label="노출" value={ad.impressions} detail="광고가 표시된 횟수" percent={Math.min(100, performance.impressions / 1000)} />
            <AdMetricBar label="클릭" value={ad.clicks} detail="광고 클릭 수" percent={Math.min(100, performance.clicks / 20)} />
            <AdMetricBar label="CTR" value={ad.ctr} detail="클릭률" percent={Math.min(100, performance.ctr * 28)} />
            <AdMetricBar label="Organic Lift" value={ad.organicLift} detail="광고 후 원본 콘텐츠 유기 성과 변화" percent={Math.min(100, performance.organicLift * 4)} />
          </div>
        </section>

        <div className="campaign-detail-grid">
          <section className="campaign-visual-panel">
            <div className="section-header">
              <div>
                <h2>원본 콘텐츠 연결</h2>
                <p>광고는 원본 콘텐츠와 분리해 성과를 비교합니다.</p>
              </div>
            </div>
            {sourceContent ? (
              <div className="campaign-evidence-list">
                <div>
                  <ChannelBadge channel={sourceContent.channel} compact />
                  <a className="content-title-link" href={getContentExternalUrl(sourceContent)} target="_blank" rel="noreferrer">
                    {sourceContent.title}
                  </a>
                  <span>
                    {sourceContent.publishDate} ·{" "}
                    {hasCollectedPerformance(sourceContent)
                      ? `${sourceContent.metricValue} ${sourceContent.metricLabel}`
                      : "성과 수집 대기"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="performance-state">
                <strong>원본 콘텐츠 미연결</strong>
                <em>Content Lab에서 원본 콘텐츠를 연결하면 유기 성과와 광고 성과를 함께 비교합니다.</em>
              </div>
            )}
          </section>

          <section className="campaign-visual-panel">
            <div className="section-header">
              <div>
                <h2>다음 판단</h2>
                <p>브리핑에서 더 자세히 풀어볼 항목</p>
              </div>
            </div>
            <div className="action-list">
              <ActionItem label="유효성" text={performance.verdict === "효과 있음" ? "동일 소재의 추가 집행 가치가 있습니다." : "성과 기준을 충족하는지 AI 브리핑에서 원인별로 확인합니다."} />
              <ActionItem label="개선" text="소재 첫 화면, CTA, 타깃, 랜딩 경로 중 어디를 바꾸면 좋을지 점검합니다." />
              <ActionItem label="비교" text="같은 원본 콘텐츠의 유기 성과와 광고 성과를 분리해 비교합니다." />
            </div>
          </section>
        </div>
      </div>
    </ModalShell>
  );
}

function AdContentEditor({
  ad,
  campaigns,
  contentLibrary,
  onClose,
  onDelete,
  onSave,
}: {
  ad: AdContent;
  campaigns: CampaignRow[];
  contentLibrary: ContentItem[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onSave: (ad: AdContent) => void;
}) {
  const [form, setForm] = useState(ad);
  const [showContentLibrary, setShowContentLibrary] = useState(false);
  const [contentSearch, setContentSearch] = useState("");
  const update = (patch: Partial<AdContent>) => setForm((current) => ({ ...current, ...patch }));
  const filteredContentLibrary = filterContentItems(contentLibrary, contentSearch).slice(0, 30);
  const selectedSource = findContentForAd(contentLibrary, form);
  const connectSourceContent = (item: ContentItem) => {
    update({
      channel: item.channel,
      campaignId: item.campaignId ?? getCampaignIdByName(campaigns, item.campaign ?? form.campaign),
      campaign: item.campaign ?? form.campaign,
      sourceContentId: getContentSourceId(item),
      sourceContent: item.title,
      linkedPostTitle: item.title,
      performanceSource: item.performanceSource
        ? `Meta Ads API 연결 대기 + ${item.performanceSource}`
        : `Meta Ads API 연결 대기 + ${channelMeta[item.channel].label} 콘텐츠`,
      organicLift: hasCollectedPerformance(item) ? `원본 ${item.metricValue} ${item.metricLabel}` : "원본 성과 수집 대기",
    });
    setShowContentLibrary(false);
  };

  return (
    <ModalShell title="광고 등록" icon={<Megaphone size={18} />} onClose={onClose} size="medium">
      <div className="editor-body">
        <label className="field full">
          <span>광고명</span>
          <input value={form.title} onChange={(event) => update({ title: event.target.value })} placeholder="광고 콘텐츠명" />
        </label>
        <label className="field">
          <span>채널</span>
          <select
            value={form.channel}
            onChange={(event) => update({ channel: event.target.value as Exclude<ChannelId, "all"> })}
          >
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn</option>
            <option value="naver">Blog</option>
            <option value="website">Website</option>
          </select>
        </label>
        <label className="field">
          <span>상태</span>
          <select value={form.status} onChange={(event) => update({ status: event.target.value as AdContent["status"] })}>
            <option value="planned">예정</option>
            <option value="active">집행중</option>
            <option value="ended">종료</option>
          </select>
        </label>
        <label className="field">
          <span>캠페인</span>
          <select
            value={form.campaign}
            onChange={(event) => update({ campaign: event.target.value, campaignId: getCampaignIdByName(campaigns, event.target.value) })}
          >
            {campaigns.map((campaign) => (
              <option key={campaign.id}>{campaign.campaign}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>기간</span>
          <input value={form.period} onChange={(event) => update({ period: event.target.value })} placeholder="2026.07.29 - 2026.08.05" />
        </label>
        <div className="field full">
          <span>원본 콘텐츠</span>
          <button className="button secondary full-button" onClick={() => setShowContentLibrary((value) => !value)}>
            <Search size={16} />
            Content Lab에서 불러오기
          </button>
          {selectedSource ? (
            <div className="linked-post-note">
              <strong>{selectedSource.title}</strong>
              <span>
                {channelMeta[selectedSource.channel].label} · {selectedSource.type} ·{" "}
                {hasCollectedPerformance(selectedSource)
                  ? `${selectedSource.metricValue} ${selectedSource.metricLabel}`
                  : "성과 수집 대기"}
              </span>
            </div>
          ) : (
            <div className="performance-state">
              <strong>원본 콘텐츠를 선택하세요</strong>
              <em>광고 등록은 Content Lab 카드/발행 게시물과 연결된 뒤 성과를 가져옵니다.</em>
            </div>
          )}
          {showContentLibrary && (
            <>
              <label className="result-search">
                <Search size={15} />
                <input
                  value={contentSearch}
                  onChange={(event) => setContentSearch(event.target.value)}
                  placeholder="제목, 채널, 유형, 캠페인으로 검색"
                />
              </label>
              <div className="post-result-list">
                {filteredContentLibrary.map((item) => (
                  <button key={item.id} onClick={() => connectSourceContent(item)}>
                    <span>{item.title}</span>
                    <strong>
                      {channelMeta[item.channel].label} ·{" "}
                      {hasCollectedPerformance(item) ? `${item.metricValue} ${item.metricLabel}` : item.status}
                    </strong>
                  </button>
                ))}
                {filteredContentLibrary.length === 0 && <div className="empty-result">검색 결과가 없습니다.</div>}
              </div>
            </>
          )}
        </div>
        <div className="field full">
          <span>광고 성과 소스</span>
          <div className="performance-state linked">
            <strong>{form.performanceSource ?? "Meta Ads API 연결 대기"}</strong>
            <em>Meta Ads 연결 시 광고 ID 기준으로 노출, 클릭, CTR, 지출을 자동 수집합니다.</em>
          </div>
        </div>
        <label className="field">
          <span>예산</span>
          <input value={form.budget} onChange={(event) => update({ budget: event.target.value })} placeholder="500,000원" />
        </label>
        <label className="field">
          <span>사용</span>
          <input value={form.spend} onChange={(event) => update({ spend: event.target.value })} placeholder="0원" />
        </label>
        <label className="field">
          <span>노출</span>
          <input value={form.impressions} onChange={(event) => update({ impressions: event.target.value })} placeholder="예정 또는 84,000" />
        </label>
        <label className="field">
          <span>클릭</span>
          <input value={form.clicks} onChange={(event) => update({ clicks: event.target.value })} placeholder="예정 또는 1,240" />
        </label>
        <label className="field">
          <span>CTR</span>
          <input value={form.ctr} onChange={(event) => update({ ctr: event.target.value })} placeholder="예정 또는 1.48%" />
        </label>
        <label className="field">
          <span>Organic Lift</span>
          <input value={form.organicLift} onChange={(event) => update({ organicLift: event.target.value })} placeholder="대기 또는 +18%" />
        </label>
        <div className="editor-actions">
          <button className="button danger" onClick={() => onDelete(form.id)}>
            삭제
          </button>
          <div>
            <button className="button secondary" onClick={onClose}>
              취소
            </button>
            <button className="button dark" onClick={() => onSave(form)}>
              저장
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function DataCenter({
  data,
  importing,
  importResult,
  importPersistence,
  authConfigured,
  authUser,
  authBusy,
  youtubeSyncing,
  youtubeSyncResult,
  instagramSyncing,
  instagramSyncResult,
  websiteSyncing,
  websiteSyncResult,
  onSignIn,
  onSignOut,
  onImportFiles,
  onSyncYouTube,
  onSyncInstagram,
  onSyncWebsite,
}: {
  data: DataCenterSnapshot;
  importing: boolean;
  importResult: DataFileImportResult | null;
  importPersistence: SupabaseImportPersistence | null;
  authConfigured: boolean;
  authUser: DashboardUser | null;
  authBusy: boolean;
  youtubeSyncing: boolean;
  youtubeSyncResult: YoutubeSyncState | null;
  instagramSyncing: boolean;
  instagramSyncResult: InstagramSyncState | null;
  websiteSyncing: boolean;
  websiteSyncResult: WebsiteSyncState | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onImportFiles: (files: File[]) => void;
  onSyncYouTube: () => void;
  onSyncInstagram: () => void;
  onSyncWebsite: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sourcesPagination = usePaginatedItems(data.sources);
  const issuesPagination = usePaginatedItems(data.issues);
  const mappingPagination = usePaginatedItems(data.mappingRows);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const ensureUploadReady = () => {
    if (!authConfigured) {
      setImportError("Supabase 환경변수가 없어 실제 파일 저장을 할 수 없습니다.");
      return false;
    }

    if (!authUser) {
      setImportError("Google 로그인 후 Supabase Storage에 파일을 저장할 수 있습니다.");
      return false;
    }

    return true;
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length || importing) return;
    if (!ensureUploadReady()) return;

    const selectedFiles = Array.from(files);
    const acceptedFiles = selectedFiles.filter((file) =>
      FILE_IMPORT_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension)),
    );

    if (!acceptedFiles.length) {
      setImportNotice(null);
      setImportError("CSV, TSV, XLS, XLSX 파일만 업로드할 수 있습니다.");
      return;
    }

    const unsupportedChannelFiles = acceptedFiles.filter((file) => !inferFileImportChannel(file.name));
    const importableFiles = acceptedFiles.filter((file) => inferFileImportChannel(file.name));

    if (!importableFiles.length) {
      setImportNotice(null);
      setImportError("파일명에서 LinkedIn, TikTok, Naver Blog 대상 파일을 찾지 못했습니다. API 채널 파일은 업로드하지 않습니다.");
      return;
    }

    setImportError(null);
    setImportNotice(
      unsupportedChannelFiles.length
        ? `${unsupportedChannelFiles.length}개 파일은 파일 업로드 대상 채널이 아니어서 제외했습니다.`
        : null,
    );
    onImportFiles(importableFiles);
  };

  const openFilePicker = () => {
    if (importing || !ensureUploadReady()) return;
    fileInputRef.current?.click();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    handleFiles(event.dataTransfer.files);
  };

  return (
    <div className="screen-stack">
      <section className="summary-band">
        <div>
          <span className="eyebrow">Data Center</span>
          <h1>데이터 연결 상태</h1>
          <p>YouTube, Instagram, Website는 API로 연결하고 LinkedIn, Naver Blog, TikTok은 파일 업로드로 적재합니다.</p>
        </div>
      </section>

      <section className="source-grid data-source-grid">
        {sourcesPagination.pagedItems.map((source) => (
          <div className={`source-tile source-tile-${source.connectionGroup ?? source.kind}`} key={source.id}>
            <div className="tile-head">
              <strong>{source.label}</strong>
              <StatusPill status={source.status} />
            </div>
            <div className="source-meta-row">
              <span className="source-kind">{(source.connectionGroup ?? source.kind).toUpperCase()}</span>
              {source.cadence && <em>{source.cadence}</em>}
            </div>
            {source.channels?.length ? (
              <div className="source-channel-list">
                {source.channels.map((channel) => (
                  <span key={channel}>{channel}</span>
                ))}
              </div>
            ) : null}
            <p>{source.detail}</p>
            <small>{source.lastSync}</small>
            {source.id === "google-youtube" && (
              <div className="source-action-row">
                <button className="button secondary small" disabled={youtubeSyncing || !authUser} onClick={onSyncYouTube}>
                  {youtubeSyncing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  YouTube 동기화
                </button>
                {!authUser && <span>Google 로그인 필요</span>}
              </div>
            )}
            {source.id === "google-youtube" && youtubeSyncResult && (
              <small className={`sync-note ${youtubeSyncResult.status}`}>
                {youtubeSyncResult.status === "complete"
                  ? `${youtubeSyncResult.videosSynced}개 영상 저장 · 기간 성과 ${youtubeSyncResult.videosWithPeriodMetrics ?? 0}개 · ${youtubeSyncResult.dailyPoints}일 지표`
                  : youtubeSyncResult.message}
              </small>
            )}
            {source.id === "meta-instagram" && (
              <div className="source-action-row">
                <button className="button secondary small" disabled={instagramSyncing || !authUser} onClick={onSyncInstagram}>
                  {instagramSyncing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  Instagram 동기화
                </button>
                {!authUser && <span>Google 로그인 필요</span>}
              </div>
            )}
            {source.id === "meta-instagram" && instagramSyncResult && (
              <small className={`sync-note ${instagramSyncResult.status}`}>
                {instagramSyncResult.status === "error"
                  ? instagramSyncResult.message
                  : `${instagramSyncResult.accounts.length}개 계정 · ${instagramSyncResult.accounts.reduce(
                      (total, account) => total + account.mediaSynced,
                      0,
                    )}개 게시물 저장 · ${instagramSyncResult.rowsWritten}행 처리`}
              </small>
            )}
            {source.id === "google-website" && (
              <div className="source-action-row">
                <button className="button secondary small" disabled={websiteSyncing || !authUser} onClick={onSyncWebsite}>
                  {websiteSyncing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  홈페이지 동기화
                </button>
                {!authUser && <span>Google 로그인 필요</span>}
              </div>
            )}
            {source.id === "google-website" && websiteSyncResult && (
              <small className={`sync-note ${websiteSyncResult.status === "error" ? "error" : websiteSyncResult.overallStatus}`}>
                {websiteSyncResult.status === "error"
                  ? websiteSyncResult.message
                  : `${websiteSyncResult.accounts.length}개 속성 · 페이지 ${websiteSyncResult.accounts.reduce(
                      (total, account) => total + account.pagesSynced,
                      0,
                    )}개 저장 · ${websiteSyncResult.rowsWritten}행 처리`}
              </small>
            )}
          </div>
        ))}
        <div
          className={`source-tile file-import-card ${isDraggingFile ? "dragging" : ""} ${importing ? "processing" : ""}`}
          role="button"
          tabIndex={0}
          aria-busy={importing}
          onClick={openFilePicker}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openFilePicker();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            className="visually-hidden-file-input"
            type="file"
            accept={FILE_IMPORT_EXTENSIONS.join(",")}
            multiple
            onChange={(event) => {
              handleFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <div className="file-import-head">
            <span className="file-import-icon">
              <Upload size={18} />
            </span>
            <div>
              <strong>파일 가져오기</strong>
              <p>LinkedIn · Naver Blog · TikTok 전용</p>
            </div>
          </div>
          <span className="source-kind">CSV / TSV / XLS / XLSX</span>
          <p>YouTube, Instagram, Website는 API 연결형이라 파일 업로드 대상이 아닙니다.</p>
          <div className="source-channel-list">
            {(Object.keys(FILE_IMPORT_CHANNEL_LABELS) as FileImportChannel[]).map((channel) => (
              <span key={channel}>{FILE_IMPORT_CHANNEL_LABELS[channel]}</span>
            ))}
          </div>
          <div className={authUser ? "supabase-import-auth connected" : "supabase-import-auth"}>
            <span>{authUser ? `${authUser.email ?? "로그인 사용자"} 연결됨` : "저장하려면 Google 로그인 필요"}</span>
            {authUser ? (
              <button
                className="button secondary small"
                disabled={authBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  onSignOut();
                }}
              >
                <LogOut size={14} />
                로그아웃
              </button>
            ) : (
              <button
                className="button dark small"
                disabled={authBusy || !authConfigured}
                onClick={(event) => {
                  event.stopPropagation();
                  onSignIn();
                }}
              >
                {authBusy ? <Loader2 size={14} className="spin" /> : <LogIn size={14} />}
                Google 로그인
              </button>
            )}
          </div>
          {importing ? (
            <div className="file-import-status processing">
              <Loader2 size={16} className="spin" />
              <strong>저장 및 분류 중</strong>
              <span>Supabase Storage 저장 · DB 기록 · 데이터 소스 매핑</span>
            </div>
          ) : importError ? (
            <div className="file-import-status warning">
              <AlertCircle size={16} />
              <strong>지원하지 않는 형식 제외</strong>
              <span>{importError}</span>
            </div>
          ) : importResult ? (
            <div className="file-import-status complete">
              <Check size={16} />
              <strong>{importResult.totalFiles}개 파일 저장 완료</strong>
              <span>{importResult.importedAt} 데이터 소스 갱신 완료</span>
              {importPersistence && (
                <span className={`import-persistence ${importPersistence.status}`}>
                  {importPersistence.message}
                </span>
              )}
              <div className="import-channel-chips">
                {(Object.entries(importResult.channelCounts) as Array<[FileImportChannel, number]>)
                  .filter(([, count]) => count > 0)
                  .map(([channel, count]) => (
                    <em key={channel}>
                      {channelMeta[channel].label} {count}
                    </em>
                  ))}
              </div>
            </div>
          ) : (
            <small>월간 리포트 파일은 콘텐츠 행으로 넣지 않고, 지표 소스로만 저장합니다.</small>
          )}
          {importNotice && <small className="file-import-note">{importNotice}</small>}
        </div>
      </section>
      <Pagination pagination={sourcesPagination} />

      <section className="section-panel data-issues-panel">
        <div className="section-header">
          <div>
            <h2>데이터 이슈</h2>
            <p>검증 결과 · 연결 누락 · 매핑 충돌</p>
          </div>
          <StatusPill status={data.issues.some((issue) => issue.severity === "error") ? "partial" : "complete"} />
        </div>
        <div className="issue-list wide">
          {issuesPagination.pagedItems.map((issue) => (
            <div className={`issue-row ${issue.severity}`} key={issue.title}>
              <AlertCircle size={16} />
              <div>
                <strong>{issue.title}</strong>
                <span>{issue.detail}</span>
              </div>
            </div>
          ))}
        </div>
        <Pagination pagination={issuesPagination} />
      </section>

      <section className="section-panel">
        <div className="section-header">
          <div>
            <h2>지표 매핑</h2>
            <p>API 필드와 업로드 파일 열이 시스템 지표로 들어오는 방식</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>플랫폼</th>
                <th>원본 열 이름</th>
                <th>시스템 지표</th>
                <th>변환</th>
              </tr>
            </thead>
            <tbody>
              {mappingPagination.pagedItems.map((row) => (
                <tr key={`${row.platform}-${row.raw}`}>
                  <td>{row.platform}</td>
                  <td>{row.raw}</td>
                  <td>
                    <code>{row.metric}</code>
                  </td>
                  <td>{row.transform}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination pagination={mappingPagination} />
      </section>
    </div>
  );
}

function formatPressDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const PRESS_OUTLETS: Array<{ key: keyof PressCoverage; label: string }> = [
  { key: "moneytoday", label: "머니투데이" },
  { key: "etnews", label: "전자신문" },
  { key: "diginet", label: "디지넷" },
];

type PressView =
  | { mode: "list" }
  | { mode: "write" }
  | { mode: "detail"; id: string }
  | { mode: "edit"; id: string };

function PressBoard({ authUser }: { authUser: DashboardUser | null }) {
  const configured = canUsePressBoard();
  const [view, setView] = useState<PressView>({ mode: "list" });
  const [releases, setReleases] = useState<PressRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadReleases = () => {
    if (!configured) {
      setReleases([]);
      return;
    }
    listPressReleases()
      .then((rows) => {
        setReleases(rows);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "불러오기 실패");
        setReleases([]);
      });
  };

  useEffect(() => {
    loadReleases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  const toggleCoverage = (release: PressRelease, key: keyof PressCoverage) => {
    const nextCoverage = { ...release.coverage, [key]: !release.coverage[key] };
    setReleases((prev) => prev?.map((row) => (row.id === release.id ? { ...row, coverage: nextCoverage } : row)) ?? null);
    updatePressCoverage(release.id, nextCoverage).catch(() => loadReleases());
  };

  const removeRelease = (release: PressRelease, options?: { back?: boolean }) => {
    if (typeof window !== "undefined" && !window.confirm("이 보도자료를 삭제할까요?")) return;
    setReleases((prev) => prev?.filter((row) => row.id !== release.id) ?? null);
    deletePressRelease(release).catch(() => loadReleases());
    if (options?.back) setView({ mode: "list" });
  };

  if (!configured) {
    return (
      <div className="screen-stack">
        <section className="section-panel">
          <div className="press-empty">Supabase 연결 후 보도자료 게시판을 사용할 수 있습니다.</div>
        </section>
      </div>
    );
  }

  if (view.mode === "write" || view.mode === "edit") {
    const back: PressView = view.mode === "edit" ? { mode: "detail", id: view.id } : { mode: "list" };
    const editing = view.mode === "edit" ? releases?.find((row) => row.id === view.id) : undefined;
    return (
      <PressWrite
        authUser={authUser}
        editing={editing}
        onCancel={() => setView(back)}
        onSaved={() => {
          setView(back);
          loadReleases();
        }}
      />
    );
  }

  if (view.mode === "detail") {
    const release = releases?.find((row) => row.id === view.id);
    return (
      <PressDetail
        release={release}
        onBack={() => setView({ mode: "list" })}
        onEdit={() => setView({ mode: "edit", id: view.id })}
        onDelete={() => release && removeRelease(release, { back: true })}
        onToggle={toggleCoverage}
      />
    );
  }

  return (
    <div className="screen-stack">
      <section className="summary-band">
        <div>
          <span className="eyebrow">Press Room</span>
          <h1>보도자료 게시판</h1>
          <p>직접 작성해 게시판처럼 관리하세요. 사진 첨부 · 매체 보도 여부 체크 · 모든 기기에서 확인.</p>
        </div>
        <div className="summary-actions">
          <button className="button primary" onClick={() => setView({ mode: "write" })}>
            <Plus size={16} />
            새 글
          </button>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <div>
            <h2>보도자료 목록</h2>
            <p>{releases ? `${releases.length}건` : "불러오는 중"}</p>
          </div>
        </div>
        {error ? (
          <div className="press-empty">불러오기 실패: {error}</div>
        ) : !releases ? (
          <div className="loading-panel slim">
            <Loader2 size={18} className="spin" />
            불러오는 중
          </div>
        ) : releases.length === 0 ? (
          <div className="press-empty">아직 작성된 보도자료가 없습니다. '새 글'로 첫 보도자료를 등록하세요.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table press-table">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>작성일</th>
                  {PRESS_OUTLETS.map((outlet) => (
                    <th key={outlet.key} className="press-outlet-col">
                      {outlet.label}
                    </th>
                  ))}
                  <th aria-label="삭제" />
                </tr>
              </thead>
              <tbody>
                {releases.map((release) => (
                  <tr key={release.id}>
                    <td>
                      <button className="press-title-link" onClick={() => setView({ mode: "detail", id: release.id })}>
                        {release.title}
                        {release.images.length > 0 && <span className="press-img-count">사진 {release.images.length}</span>}
                      </button>
                    </td>
                    <td className="press-date-cell">{formatPressDate(release.createdAt)}</td>
                    {PRESS_OUTLETS.map((outlet) => (
                      <td key={outlet.key} className="press-outlet-col">
                        <input
                          type="checkbox"
                          className="press-check"
                          checked={release.coverage[outlet.key]}
                          onChange={() => toggleCoverage(release, outlet.key)}
                          aria-label={`${release.title} ${outlet.label} 보도`}
                        />
                      </td>
                    ))}
                    <td className="press-actions-cell">
                      <button
                        type="button"
                        className="icon-button mini"
                        onClick={() => removeRelease(release)}
                        aria-label="삭제"
                      >
                        <X size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PressWrite({
  authUser,
  editing,
  onCancel,
  onSaved,
}: {
  authUser: DashboardUser | null;
  editing?: PressRelease;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(editing);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [existingImages, setExistingImages] = useState<string[]>(editing?.images ?? []);
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const picked = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...picked]);
    setPreviews((prev) => [...prev, ...picked.map((file) => URL.createObjectURL(file))]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeNewAt = (index: number) => {
    setFiles((prev) => prev.filter((_, current) => current !== index));
    setPreviews((prev) => prev.filter((_, current) => current !== index));
  };

  const removeExisting = (path: string) => {
    setExistingImages((prev) => prev.filter((current) => current !== path));
    setRemovedImages((prev) => [...prev, path]);
  };

  const submit = async () => {
    if (!title.trim() && !body.trim() && files.length === 0 && existingImages.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const newPaths = files.length ? await uploadPressImages(editing.id, files) : [];
        await updatePressRelease({
          id: editing.id,
          title: title.trim() || "제목 없음",
          body: body.trim(),
          images: [...existingImages, ...newPaths],
          removedImages,
        });
      } else {
        await createPressRelease({
          title: title.trim() || "제목 없음",
          body: body.trim(),
          files,
          createdBy: authUser?.email ?? null,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : isEdit ? "수정 실패" : "등록 실패");
      setSaving(false);
    }
  };

  return (
    <div className="screen-stack">
      <section className="section-panel">
        <div className="section-header">
          <div>
            <h2>{isEdit ? "보도자료 수정" : "새 보도자료 작성"}</h2>
            <p>제목 · 본문 · 사진</p>
          </div>
          <button className="button secondary small" onClick={onCancel}>
            <ChevronLeft size={16} />
            {isEdit ? "취소" : "목록"}
          </button>
        </div>
        <div className="press-form">
          <input
            className="press-title-input"
            placeholder="제목"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            className="press-body-input"
            placeholder="본문을 입력하세요"
            rows={10}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          {(existingImages.length > 0 || previews.length > 0) && (
            <div className="press-image-grid">
              {existingImages.map((path) => (
                <div className="press-thumb" key={path}>
                  <img src={pressImageUrl(path)} alt="첨부 이미지" />
                  <button
                    type="button"
                    className="press-thumb-remove"
                    onClick={() => removeExisting(path)}
                    aria-label="이미지 제거"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {previews.map((src, index) => (
                <div className="press-thumb" key={`new-${index}`}>
                  <img src={src} alt="첨부 이미지" />
                  <button
                    type="button"
                    className="press-thumb-remove"
                    onClick={() => removeNewAt(index)}
                    aria-label="이미지 제거"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="press-form-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => addFiles(event.target.files)}
            />
            <button type="button" className="button secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={16} />
              사진 첨부
            </button>
            <button type="button" className="button primary" disabled={saving} onClick={submit}>
              {saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
              {isEdit ? "수정하기" : "등록하기"}
            </button>
          </div>
          {error && (
            <div className="inline-note">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function PressDetail({
  release,
  onBack,
  onEdit,
  onDelete,
  onToggle,
}: {
  release: PressRelease | undefined;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (release: PressRelease, key: keyof PressCoverage) => void;
}) {
  if (!release) {
    return (
      <div className="screen-stack">
        <section className="section-panel">
          <button className="button secondary small" onClick={onBack}>
            <ChevronLeft size={16} />
            목록
          </button>
          <div className="press-empty">보도자료를 찾을 수 없습니다.</div>
        </section>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <section className="section-panel press-detail">
        <div className="section-header">
          <button className="button secondary small" onClick={onBack}>
            <ChevronLeft size={16} />
            목록
          </button>
          <div className="press-detail-actions">
            <button className="button secondary small" onClick={onEdit}>
              <Settings size={16} />
              수정
            </button>
            <button className="button danger small" onClick={onDelete}>
              <X size={16} />
              삭제
            </button>
          </div>
        </div>
        <h1 className="press-detail-title">{release.title}</h1>
        <div className="press-detail-meta">
          {formatPressDate(release.createdAt)}
          {release.createdBy ? ` · ${release.createdBy}` : ""}
        </div>
        <div className="press-detail-outlets">
          {PRESS_OUTLETS.map((outlet) => (
            <label key={outlet.key} className="press-outlet-toggle">
              <input
                type="checkbox"
                className="press-check"
                checked={release.coverage[outlet.key]}
                onChange={() => onToggle(release, outlet.key)}
              />
              {outlet.label}
            </label>
          ))}
        </div>
        {release.body && <p className="press-detail-body">{release.body}</p>}
        {release.images.length > 0 && (
          <div className="press-detail-images">
            {release.images.map((path, index) => (
              <img key={index} src={pressImageUrl(path)} alt="첨부 이미지" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DateRangePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => firstOfMonthUtc(value.start));
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setView(firstOfMonthUtc(value.start));
    setPendingStart(null);
    setHovered(null);
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, value.start]);

  const year = view.getUTCFullYear();
  const month = view.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [];
  for (let blank = 0; blank < firstWeekday; blank += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10));
  }

  const handleDay = (iso: string) => {
    if (!pendingStart) {
      setPendingStart(iso);
      return;
    }
    const [start, end] = pendingStart <= iso ? [pendingStart, iso] : [iso, pendingStart];
    onChange({ start, end });
    setPendingStart(null);
    setHovered(null);
    setOpen(false);
  };

  // While picking a new range, ignore the old value and show only the in-progress
  // selection (pendingStart → hovered day preview).
  let selStart = value.start;
  let selEnd = value.end;
  if (pendingStart) {
    const other = hovered ?? pendingStart;
    [selStart, selEnd] = pendingStart <= other ? [pendingStart, other] : [other, pendingStart];
  }

  return (
    <div className="range-field" ref={ref}>
      <span>{label}</span>
      <button type="button" className="range-trigger" onClick={() => setOpen((prev) => !prev)}>
        <CalendarDays size={15} />
        <strong>{value.start}</strong>
        <em>~</em>
        <strong>{value.end}</strong>
      </button>
      {open && (
        <div className="range-calendar">
          <div className="range-calendar-head">
            <button
              type="button"
              className="icon-button mini"
              aria-label="이전 달"
              onClick={() => setView(new Date(Date.UTC(year, month - 1, 1)))}
            >
              <ChevronLeft size={16} />
            </button>
            <strong>
              {year}년 {month + 1}월
            </strong>
            <button
              type="button"
              className="icon-button mini"
              aria-label="다음 달"
              onClick={() => setView(new Date(Date.UTC(year, month + 1, 1)))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="range-calendar-grid">
            {["일", "월", "화", "수", "목", "금", "토"].map((weekday) => (
              <span className="range-weekday" key={weekday}>
                {weekday}
              </span>
            ))}
            {cells.map((iso, index) => {
              if (!iso) return <span key={`blank-${index}`} />;
              const isEdge = iso === selStart || iso === selEnd;
              const inRange = iso > selStart && iso < selEnd;
              return (
                <button
                  type="button"
                  key={iso}
                  className={["range-day", isEdge ? "edge" : "", inRange ? "in-range" : ""].filter(Boolean).join(" ")}
                  onMouseEnter={() => setHovered(iso)}
                  onClick={() => handleDay(iso)}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              );
            })}
          </div>
          <div className="range-calendar-foot">
            {pendingStart ? `시작 ${pendingStart} · 종료일을 선택하세요` : "시작일을 선택하세요"}
          </div>
        </div>
      )}
    </div>
  );
}

function PeriodCompareModal({ onClose }: { onClose: () => void }) {
  const defaults = useMemo(() => defaultCompareRanges(), []);
  const [scope, setScope] = useState<ChannelId>("all");
  const [current, setCurrent] = useState<DateRange>({ start: defaults.curStart, end: defaults.curEnd });
  const [previous, setPrevious] = useState<DateRange>({ start: defaults.prevStart, end: defaults.prevEnd });
  const [comparison, setComparison] = useState<PeriodComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = canComparePeriods();

  useEffect(() => {
    if (!configured) {
      setComparison(null);
      return;
    }
    let mounted = true;
    setComparison(null);
    setError(null);
    computePeriodComparison(scope, current, previous)
      .then((result) => {
        if (mounted) setComparison(result);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : "비교 계산 실패");
      });
    return () => {
      mounted = false;
    };
  }, [configured, scope, current, previous]);

  const fillPreviousFromCurrent = () => {
    const startMs = Date.parse(`${current.start}T00:00:00Z`);
    const endMs = Date.parse(`${current.end}T00:00:00Z`);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return;
    const dayMs = 86400000;
    const lengthDays = Math.round((endMs - startMs) / dayMs) + 1;
    const prevEndMs = startMs - dayMs;
    const prevStartMs = prevEndMs - (lengthDays - 1) * dayMs;
    setPrevious({ start: toIsoDate(prevStartMs), end: toIsoDate(prevEndMs) });
  };

  const scopeTabs: Array<{ id: ChannelId; label: string }> = [
    { id: "all", label: "전체" },
    { id: "youtube", label: "YouTube" },
    { id: "instagram", label: "Instagram" },
    { id: "website", label: "Website" },
    { id: "linkedin", label: "LinkedIn" },
    { id: "naver", label: "Naver Blog" },
    { id: "tiktok", label: "TikTok" },
  ];

  return (
    <ModalShell title="기간 비교 - 과거 vs 지금" icon={<BarChart3 size={18} />} onClose={onClose} size="large">
      <div className="modal-stack">
        <div className="scope-tabs">
          {scopeTabs.map((tab) => (
            <button
              key={tab.id}
              className={scope === tab.id ? "scope-tab active" : "scope-tab"}
              onClick={() => setScope(tab.id)}
            >
              {tab.id !== "all" && <ChannelBadge channel={tab.id as Exclude<ChannelId, "all">} compact />}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="compare-range-controls">
          <DateRangePicker label="과거 기간" value={previous} onChange={setPrevious} />
          <DateRangePicker label="현재 기간" value={current} onChange={setCurrent} />
          <button className="button secondary small" onClick={fillPreviousFromCurrent}>
            <CalendarDays size={14} />
            직전 동일 기간 자동
          </button>
        </div>

        {!configured ? (
          <div className="loading-panel slim">Supabase 연결 후 실데이터 기간 비교가 활성화됩니다.</div>
        ) : error ? (
          <div className="loading-panel slim">비교 계산 실패: {error}</div>
        ) : !comparison ? (
          <div className="loading-panel slim">
            <Loader2 size={18} className="spin" />
            비교 계산 중
          </div>
        ) : (
          <>
            <div className="comparison-summary">{comparison.summary}</div>
            {comparison.scope === "all" && (
              <div className="contribution-grid">
                {comparison.rows.map((row) => (
                  <div className="contribution-card" key={row.metric}>
                    <div className="tile-head">
                      <strong>{row.metric}</strong>
                      <StatusPill status={row.status} />
                    </div>
                    <span>{row.previous} → {row.current}</span>
                    <div className={row.growth === "N/A" ? "delta neutral" : "delta up"}>{row.growth}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="table-scroll">
              <table className="data-table compare-table">
                <thead>
                  <tr>
                    <th>{comparison.scope === "all" ? "채널" : "지표"}</th>
                    <th>과거</th>
                    <th></th>
                    <th>지금</th>
                    <th>성장</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((row) => (
                    <tr key={row.metric}>
                      <td>
                        <strong>{row.metric}</strong>
                      </td>
                      <td>{row.previous}</td>
                      <td className="arrow-cell">→</td>
                      <td>
                        <strong>{row.current}</strong>
                      </td>
                      <td className={row.growth === "N/A" ? "delta neutral" : "delta up"}>{row.growth}</td>
                      <td>
                        <StatusPill status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="inline-note">
              <AlertCircle size={16} />
              {comparison.dataNote}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function BriefingModal({
  briefing,
  generating,
  onClose,
}: {
  briefing: AiBriefing | null;
  generating: boolean;
  onClose: () => void;
}) {
  return (
    <ModalShell title={briefing?.title ?? "AI 보고서 생성"} icon={<Bot size={18} />} onClose={onClose} size="medium">
      {generating || !briefing ? (
        <div className="ai-loading">
          <Loader2 size={28} className="spin" />
          <strong>브리핑 생성 중</strong>
          <span>현재 화면의 집계 데이터와 데이터 상태만 사용합니다.</span>
        </div>
      ) : (
        <div className="briefing-body">
          <div className="briefing-meta">
            <div>
              <span>기준 기간</span>
              <strong>{briefing.periodLabel}</strong>
            </div>
            <div>
              <span>데이터 소스</span>
              <div className="meta-chip-row">
                {briefing.dataSources.map((source) => (
                  <em key={source}>{source}</em>
                ))}
              </div>
            </div>
            <div>
              <span>주의사항</span>
              <div className="meta-warning-list">
                {briefing.dataWarnings.map((warning) => (
                  <em key={warning}>{warning}</em>
                ))}
              </div>
            </div>
          </div>
          <div className="briefing-summary">
            <span>{briefing.generatedAt}</span>
            <p>{briefing.summary}</p>
          </div>
          <BriefingBlock title="좋았던 점" items={briefing.wins} />
          <BriefingBlock title="주의할 점" items={briefing.risks} />
          <BriefingBlock title="다음 액션" items={briefing.actions} ordered />
          <div className="evidence-list">
            <strong>근거 지표</strong>
            {briefing.evidence.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="modal-actions">
            <button className="button secondary">
              <FileText size={16} />
              저장
            </button>
            <button className="button primary">
              <Download size={16} />
              PDF 다운로드
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function ModalShell({
  title,
  icon,
  children,
  onClose,
  size,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  size: "medium" | "large";
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal-panel ${size}`}>
        <div className="modal-header">
          <div>
            {icon}
            <strong>{title}</strong>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Segmented({
  value,
  items,
  onChange,
}: {
  value: string;
  items: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented">
      {items.map((item) => (
        <button
          key={item.value}
          className={value === item.value ? "active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: DataStatus }) {
  return <span className={`status-pill status-${status}`}>{statusLabel[status]}</span>;
}

function ChannelBadge({ channel, compact = false }: { channel: Exclude<ChannelId, "all">; compact?: boolean }) {
  const meta = channelMeta[channel];
  return (
    <span className={compact ? "channel-badge compact" : "channel-badge"} style={{ "--channel": meta.color } as React.CSSProperties}>
      <span className="channel-initial">{meta.short}</span>
      {!compact && <span className="channel-name">{meta.label}</span>}
    </span>
  );
}

function formatTrendValue(value: number) {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}만`;
  if (Math.abs(value) >= 1000) return value.toLocaleString("ko-KR");
  return `${value}`;
}

function Sparkline({
  points,
  color = "#ff6b2c",
  valueFormatter = formatTrendValue,
}: {
  points: Array<{ label: string; value: number }>;
  color?: string;
  valueFormatter?: (value: number) => string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const visiblePoints = points.length > 0 ? points : [{ label: "-", value: 0 }];
  const width = 720;
  const height = 230;
  const chartTop = 30;
  const chartBottom = 176;
  const labelY = 212;
  const horizontalPadding = 54;
  const max = Math.max(...visiblePoints.map((point) => point.value), 1);
  const min = Math.min(...visiblePoints.map((point) => point.value), 0);
  const range = Math.max(max - min, 1);
  const coordinates = visiblePoints.map((point, index) => {
    const x = (index / (visiblePoints.length - 1 || 1)) * (width - horizontalPadding * 2) + horizontalPadding;
    const y = chartBottom - ((point.value - min) / range) * (chartBottom - chartTop);

    return {
      point,
      x,
      y,
      left: `${(x / width) * 100}%`,
      top: `${(Math.max(24, y - 12) / height) * 100}%`,
    };
  });
  const path = coordinates.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const areaPath = `${path} L ${coordinates[coordinates.length - 1].x} ${chartBottom} L ${coordinates[0].x} ${chartBottom} Z`;
  const activePoint = activeIndex === null ? null : coordinates[activeIndex];
  const first = visiblePoints[0];
  const latest = visiblePoints[visiblePoints.length - 1];
  const peak = visiblePoints.reduce((best, point) => (point.value > best.value ? point : best), visiblePoints[0]);
  const change = latest.value - first.value;
  const changePercent = first.value === 0 ? 0 : Math.round((change / first.value) * 100);
  const trendId = `spark-${`${color}-${visiblePoints.map((point) => `${point.label}-${point.value}`).join("-")}`.replace(
    /[^a-zA-Z0-9-]/g,
    "",
  )}`;

  return (
    <div className="sparkline-wrap">
      <div className="sparkline-plot" onMouseLeave={() => setActiveIndex(null)}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`성과 추세 그래프: ${visiblePoints.map((point) => `${point.label} ${valueFormatter(point.value)}`).join(", ")}`}
        >
          <defs>
            <linearGradient id={trendId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="grid-line" d={`M ${horizontalPadding} ${chartBottom} H ${width - horizontalPadding}`} />
          <path className="grid-line" d={`M ${horizontalPadding} ${(chartTop + chartBottom) / 2} H ${width - horizontalPadding}`} />
          <path className="grid-line" d={`M ${horizontalPadding} ${chartTop} H ${width - horizontalPadding}`} />
          <path d={areaPath} fill={`url(#${trendId})`} />
          <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {activePoint && (
            <path className="sparkline-hover-line" d={`M ${activePoint.x} ${chartTop} V ${chartBottom}`} />
          )}
          {coordinates.map(({ point, x, y }, index) => (
            <g
              key={`${point.label}-${point.value}-${index}`}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              tabIndex={0}
            >
              <title>
                {point.label} · {valueFormatter(point.value)}
              </title>
              <circle className="sparkline-hit-area" cx={x} cy={y} r="18" />
              <circle
                className={activeIndex === index ? "sparkline-point active" : "sparkline-point"}
                cx={x}
                cy={y}
                r="5.5"
                fill={color}
              />
            </g>
          ))}
          {coordinates.map(({ point, x }, index) => (
            <text
              className="sparkline-axis-label"
              key={`${point.label}-${index}-label`}
              x={x}
              y={labelY}
              textAnchor="middle"
            >
              {point.label}
            </text>
          ))}
        </svg>
        {activePoint && (
          <div className="sparkline-value-layer">
            <span
              className={activeIndex === 0 ? "edge-start" : activeIndex === coordinates.length - 1 ? "edge-end" : ""}
              style={{ left: activePoint.left, top: activePoint.top, "--point-color": color } as React.CSSProperties}
            >
              <b>{activePoint.point.label}</b>
              <em>{valueFormatter(activePoint.point.value)}</em>
            </span>
          </div>
        )}
      </div>
      <div className="sparkline-stats">
        <span>
          <b>현재</b>
          {latest.label} {valueFormatter(latest.value)}
        </span>
        <span>
          <b>최고</b>
          {peak.label} {valueFormatter(peak.value)}
        </span>
        <span className={change >= 0 ? "trend-up" : "trend-down"}>
          <b>기간 변화</b>
          {change >= 0 ? "+" : ""}
          {valueFormatter(change)} ({changePercent >= 0 ? "+" : ""}
          {changePercent}%)
        </span>
      </div>
    </div>
  );
}

function MonthlyCalendar({ items }: { items: PublishingItem[] }) {
  const days = Array.from({ length: 31 }, (_, index) => index + 1);
  const offset = 2;
  const cells = [...Array.from({ length: offset }, () => 0), ...days];

  return (
    <div className="month-calendar">
      {["월", "화", "수", "목", "금", "토", "일"].map((day) => (
        <div className="calendar-heading" key={day}>
          {day}
        </div>
      ))}
      {cells.map((day, index) => {
        const dayItems = day
          ? items.filter((item) => Number(item.date.split("-")[2]) === day)
          : [];
        return (
          <div className={day === 28 ? "month-cell today" : "month-cell"} key={`${day}-${index}`}>
            {day ? <strong>{day}</strong> : null}
            <div>
              {dayItems.slice(0, 3).map((item) => (
                <span className={`calendar-chip chip-${item.channel}`} key={item.id}>
                  {item.type}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeeklyCalendar() {
  const plan = [
    { day: "월 21", items: ["Shorts 12:00", "카드뉴스 17:00"] },
    { day: "화 22", items: ["숏폼 18:00", "스토리"] },
    { day: "수 23", items: ["Shorts 12:00", "릴스 17:00"] },
    { day: "목 24 · 오늘", items: ["스토리", "블로그 10:00"] },
    { day: "금 25", items: ["숏폼 18:00", "릴스 17:00"] },
    { day: "토 26", items: ["둠둠로그"] },
    { day: "일 27", items: ["스토리"] },
  ];

  return (
    <div className="week-calendar">
      {plan.map((day) => (
        <div className={day.day.includes("오늘") ? "week-cell today" : "week-cell"} key={day.day}>
          <strong>{day.day}</strong>
          {day.items.map((item, index) => (
            <span className={`week-chip tone-${index % 4}`} key={item}>
              {item}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function PublishingRow({ item, compact = false }: { item: PublishingItem; compact?: boolean }) {
  return (
    <div className={compact ? "publishing-row compact" : "publishing-row"}>
      <ChannelBadge channel={item.channel} compact />
      <div>
        <strong>{item.title}</strong>
        <span>
          {item.type} · {item.time}
        </span>
      </div>
      <span className={`status-pill pub-${item.status}`}>
        {item.status === "today" ? "오늘" : item.status === "delayed" ? "지연" : item.status === "published" ? "완료" : "예정"}
      </span>
    </div>
  );
}

function ActionItem({ label, text }: { label: string; text: string }) {
  return (
    <div className="action-item">
      <span>{label}</span>
      <p>{text}</p>
    </div>
  );
}

type ContentPerformanceSortKey =
  | "publishTime"
  | "views"
  | "reach"
  | "impressions"
  | "avgWatchSeconds"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "clicks"
  | "followers"
  | "visitors"
  | "visits"
  | "trafficInflow"
  | "revisitRate"
  | "searchClicks"
  | "inquiries";
type ContentPerformanceRow = {
  item: ContentItem;
  publishTime: number;
  views: number;
  reach: number;
  impressions: number;
  avgWatchSeconds: number;
  avgWatchLabel: string;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  followers: number;
  visitors: number;
  visits: number;
  trafficInflow: number;
  revisitRate: number;
  searchClicks: number;
  inquiries: number;
};

type PerformanceColumn = { key: ContentPerformanceSortKey; label: string; format?: "count" | "duration" | "date" | "percent" };
type ContentTypeTag = { label: string; tone: "orange" | "pink" | "teal" | "blue" | "green" | "violet" | "gray" };

const channelPerformanceColumns: Record<Exclude<ChannelId, "all">, PerformanceColumn[]> = {
  youtube: [
    { key: "publishTime", label: "발행일", format: "date" },
    { key: "views", label: "조회수" },
    { key: "avgWatchSeconds", label: "평균 시청", format: "duration" },
    { key: "likes", label: "좋아요" },
    { key: "comments", label: "댓글" },
    { key: "shares", label: "공유" },
  ],
  instagram: [
    { key: "publishTime", label: "발행일", format: "date" },
    { key: "reach", label: "도달" },
    { key: "views", label: "조회" },
    { key: "likes", label: "좋아요" },
    { key: "comments", label: "댓글" },
    { key: "shares", label: "공유" },
    { key: "saves", label: "저장" },
  ],
  tiktok: [
    { key: "publishTime", label: "발행일", format: "date" },
    { key: "views", label: "조회수" },
    { key: "avgWatchSeconds", label: "평균 시청", format: "duration" },
    { key: "likes", label: "좋아요" },
    { key: "comments", label: "댓글" },
    { key: "shares", label: "공유" },
    { key: "followers", label: "팔로워 기여" },
  ],
  linkedin: [
    { key: "publishTime", label: "발행일", format: "date" },
    { key: "impressions", label: "노출" },
    { key: "clicks", label: "클릭" },
    { key: "likes", label: "반응" },
    { key: "comments", label: "댓글" },
    { key: "shares", label: "공유" },
    { key: "followers", label: "팔로워 기여" },
  ],
  naver: [
    { key: "publishTime", label: "발행일", format: "date" },
    { key: "views", label: "조회수" },
    { key: "trafficInflow", label: "유입분석" },
    { key: "visitors", label: "순방문자수" },
    { key: "visits", label: "방문 횟수" },
    { key: "avgWatchSeconds", label: "평균 사용 시간", format: "duration" },
    { key: "revisitRate", label: "재방문율", format: "percent" },
  ],
  website: [
    { key: "publishTime", label: "발행일", format: "date" },
    { key: "visitors", label: "사용자" },
    { key: "views", label: "페이지뷰" },
    { key: "searchClicks", label: "검색 클릭" },
    { key: "avgWatchSeconds", label: "평균 참여", format: "duration" },
    { key: "inquiries", label: "문의" },
  ],
};

function hashText(value: string) {
  return value.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function formatCount(value: number) {
  if (value >= 100000) return `${Math.round(value / 1000).toLocaleString("ko-KR")}K`;
  return Math.round(value).toLocaleString("ko-KR");
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return "-";
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function getContentExternalUrl(item: ContentItem) {
  if (item.externalUrl) return item.externalUrl;

  const query = encodeURIComponent(`${item.title} ${channelMeta[item.channel].label}`);
  const routes: Record<Exclude<ChannelId, "all">, string> = {
    youtube: `https://www.youtube.com/results?search_query=${query}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${query}`,
    tiktok: `https://www.tiktok.com/search?q=${query}`,
    linkedin: `https://www.linkedin.com/search/results/content/?keywords=${query}`,
    naver: `https://search.naver.com/search.naver?query=${query}`,
    website: `https://www.google.com/search?q=${query}`,
  };

  return routes[item.channel];
}

function getPublishTime(item: ContentItem) {
  return parseContentDate(item.publishDate)?.getTime() ?? 0;
}

function getContentTypeTags(item: ContentItem): ContentTypeTag[] {
  const source = `${item.title} ${item.type} ${item.status}`.toLowerCase();
  const hasDummLog =
    item.accountKey === "dummdumm-log" ||
    source.includes("둠둠로그") ||
    source.includes("dummlog") ||
    source.includes("dumm log");

  switch (item.channel) {
    case "youtube":
      return [
        item.type.toLowerCase().includes("long")
          ? { label: "Long", tone: "blue" }
          : { label: "Shorts", tone: "orange" },
      ];
    case "instagram":
      return [
        item.type.toLowerCase().includes("reels")
          ? { label: "Reels", tone: "pink" }
          : { label: "Carousel", tone: "violet" },
        hasDummLog ? { label: "둠둠로그", tone: "green" } : { label: "회사계정", tone: "gray" },
      ];
    case "tiktok":
      return [{ label: item.type.toLowerCase().includes("video") ? "Video" : "Short", tone: "teal" }];
    case "linkedin":
      return [{ label: item.type.toLowerCase().includes("post") ? "Post" : "Card", tone: "blue" }];
    case "naver":
      return [{ label: item.type.toLowerCase().includes("traffic") ? "유입" : "Blog", tone: "green" }];
    case "website":
      if (source.includes("en")) return [{ label: "EN", tone: "violet" }];
      if (source.includes("kr")) return [{ label: "KR", tone: "blue" }];
      return [{ label: "Landing", tone: "gray" }];
    default:
      return [];
  }
}

function hasContentPerformanceValue(item: ContentItem) {
  const label = item.metricLabel.trim();
  const value = item.metricValue.trim();
  const planningLabels = ["담당", "소재", "예약", "자동 수집"];

  return (
    !planningLabels.some((planningLabel) => label.includes(planningLabel)) &&
    value !== "-" &&
    !value.includes("미연결") &&
    !value.includes("연결 후") &&
    !value.includes("대기") &&
    parseMetricScore(value) > 0
  );
}

function getContentPerformanceRow(item: ContentItem): ContentPerformanceRow {
  const seed = hashText(`${item.id}-${item.title}`);
  const hasPerformance = hasContentPerformanceValue(item);
  const metricBase = hasPerformance ? Math.max(parseMetricScore(item.metricValue), 1) : 0;
  const isVideo =
    item.channel === "youtube" ||
    item.channel === "tiktok" ||
    item.type.toLowerCase().includes("reels") ||
    item.type.toLowerCase().includes("short");
  const isLongForm = item.type.toLowerCase().includes("long");
  const isWebsite = item.channel === "website";
  const label = item.metricLabel;
  let views = 0;
  let reach = 0;
  let impressions = 0;
  let clicks = 0;
  let followers = 0;
  let visitors = 0;
  let visits = 0;
  let trafficInflow = 0;
  let revisitRate = 0;
  let searchClicks = 0;
  let inquiries = 0;

  if (hasPerformance) {
    switch (item.channel) {
      case "instagram": {
        if (label.includes("도달")) {
          reach = Math.round(metricBase);
          views = Math.round(metricBase * (1.12 + (seed % 12) / 100));
        } else {
          views = Math.round(metricBase);
          reach = Math.round(metricBase * (0.72 + (seed % 14) / 100));
        }
        break;
      }
      case "linkedin": {
        if (label.includes("클릭")) {
          clicks = Math.round(metricBase);
          impressions = Math.round(metricBase * (18 + (seed % 8)));
        } else if (label.includes("팔로워")) {
          followers = Math.round(metricBase);
          impressions = Math.round(metricBase * (42 + (seed % 16)));
          clicks = Math.max(1, Math.round(impressions * 0.04));
        } else {
          impressions = Math.round(metricBase);
          clicks = Math.max(0, Math.round(metricBase * (0.035 + (seed % 7) / 1000)));
        }
        views = impressions;
        break;
      }
      case "website": {
        if (label.includes("문의")) {
          inquiries = metricBase <= 100 ? Math.round(metricBase) : Math.max(1, Math.round(metricBase * 0.012));
          visitors = metricBase <= 100 ? inquiries * (220 + (seed % 60)) : Math.round(metricBase * (0.58 + (seed % 19) / 100));
          views = metricBase <= 100 ? Math.round(visitors * (1.42 + (seed % 15) / 100)) : Math.round(metricBase);
        } else if (label.includes("검색 클릭")) {
          searchClicks = Math.round(metricBase);
          visitors = Math.round(metricBase * (2.8 + (seed % 8) / 10));
          views = Math.round(visitors * 1.5);
        } else {
          visitors = Math.round(metricBase);
          views = Math.round(metricBase * (1.34 + (seed % 20) / 100));
        }
        searchClicks = searchClicks || Math.max(0, Math.round(visitors * (0.22 + (seed % 9) / 100)));
        inquiries = inquiries || Math.max(0, Math.round(visitors * 0.01));
        impressions = Math.round(views * (1.18 + (seed % 14) / 100));
        break;
      }
      case "naver": {
        if (label.includes("순방문")) {
          visitors = Math.round(metricBase);
          views = Math.round(metricBase * (1.28 + (seed % 18) / 100));
        } else if (label.includes("유입")) {
          trafficInflow = Math.round(metricBase);
          visitors = Math.round(metricBase * (1.45 + (seed % 18) / 100));
          views = Math.round(visitors * (1.18 + (seed % 14) / 100));
        } else {
          views = Math.round(metricBase);
          visitors = Math.round(metricBase * (0.58 + (seed % 19) / 100));
        }
        visits = Math.max(visitors, Math.round(visitors * (1.18 + (seed % 16) / 100)));
        trafficInflow = trafficInflow || Math.max(0, Math.round(visits * (0.44 + (seed % 13) / 100)));
        revisitRate = Math.min(78, Math.max(5, Math.round(14 + (seed % 18) + visits / Math.max(views, 1) * 8)));
        break;
      }
      default: {
        views = Math.round(metricBase);
        break;
      }
    }
  }

  const avgWatchSeconds =
    hasPerformance && isVideo
      ? isLongForm
        ? 170 + (seed % 220)
        : 8 + (seed % 28)
      : hasPerformance && (isWebsite || item.channel === "naver")
        ? 48 + (seed % 96)
        : 0;
  const engagementBase = Math.max(views, reach, impressions, visitors);
  const likes = hasPerformance ? Math.round(engagementBase * (0.018 + (seed % 9) / 1000)) : 0;
  const comments = hasPerformance ? Math.max(0, Math.round(engagementBase * (0.002 + (seed % 5) / 2000))) : 0;
  const shares = hasPerformance ? Math.max(0, Math.round(engagementBase * (0.004 + (seed % 7) / 1800))) : 0;
  const saves =
    hasPerformance && item.channel === "instagram"
      ? Math.max(0, Math.round(Math.max(reach, views) * (0.006 + (seed % 11) / 1700)))
      : 0;

  if (hasPerformance && (item.channel === "tiktok" || item.channel === "youtube")) {
    followers = Math.max(0, Math.round(views * (0.0015 + (seed % 4) / 5000)));
  }

  const actual = item.performance ?? {};
  const resolvedAvgWatchSeconds = actual.avgWatchSeconds ?? avgWatchSeconds;

  return {
    item,
    publishTime: getPublishTime(item),
    views: actual.views ?? views,
    reach: actual.reach ?? reach,
    impressions: actual.impressions ?? impressions,
    avgWatchSeconds: resolvedAvgWatchSeconds,
    avgWatchLabel: resolvedAvgWatchSeconds > 0 ? formatDuration(resolvedAvgWatchSeconds) : "-",
    likes: actual.likes ?? likes,
    comments: actual.comments ?? comments,
    shares: actual.shares ?? shares,
    saves: actual.saves ?? saves,
    clicks: actual.clicks ?? clicks,
    followers: actual.followers ?? followers,
    visitors: actual.visitors ?? visitors,
    visits: actual.visits ?? visits,
    trafficInflow: actual.trafficInflow ?? trafficInflow,
    revisitRate: actual.revisitRate ?? revisitRate,
    searchClicks: actual.searchClicks ?? searchClicks,
    inquiries: actual.inquiries ?? inquiries,
  };
}

function ChannelContentPerformanceTable({ items }: { items: ContentItem[] }) {
  const channel = items[0]?.channel ?? "youtube";
  const columns = channelPerformanceColumns[channel];
  const [sortKey, setSortKey] = useState<ContentPerformanceSortKey>(columns[1]?.key ?? "publishTime");

  useEffect(() => {
    if (!columns.some((column) => column.key === sortKey)) {
      setSortKey(columns[1]?.key ?? "publishTime");
    }
  }, [columns, sortKey]);

  const rows = useMemo(() => {
    return items
      .map(getContentPerformanceRow)
      .sort((a, b) => {
        const currentValue = b[sortKey] as number;
        const nextValue = a[sortKey] as number;
        return currentValue - nextValue || b.publishTime - a.publishTime;
      });
  }, [items, sortKey]);
  const pagination = usePaginatedItems(rows);
  const sortLabel = columns.find((column) => column.key === sortKey)?.label ?? "성과";

  const formatCellValue = (row: ContentPerformanceRow, column: PerformanceColumn) => {
    if (column.format === "date") return row.item.publishDate;
    if (column.format === "duration") return row.avgWatchLabel;
    if (column.format === "percent") return `${Math.round(row[column.key] as number)}%`;
    const value = row[column.key] as number;
    return typeof value === "number" && value > 0 ? formatCount(value) : "-";
  };

  return (
    <>
      <div className="content-performance-toolbar">
        <span>전체 {rows.length}개 콘텐츠 · 10개씩 보기</span>
        <em>{sortKey === "publishTime" ? "발행일 최신순" : `${sortLabel} 높은 순`}</em>
      </div>
      <div className="table-scroll">
        <table className="data-table performance-table">
          <thead>
            <tr>
              <th>콘텐츠</th>
              {columns.map((column) => (
                <th key={column.key}>
                  <button
                    className={sortKey === column.key ? "sort-header active" : "sort-header"}
                    onClick={() => setSortKey(column.key)}
                  >
                    {column.label}
                    <span>{sortKey === column.key ? "↓" : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagination.pagedItems.map((row) => (
              <tr key={row.item.id}>
                <td>
                  <div className="performance-title-line">
                    {getContentTypeTags(row.item).map((tag) => (
                      <span className={`content-type-tag tag-${tag.tone}`} key={`${row.item.id}-${tag.label}`}>
                        {tag.label}
                      </span>
                    ))}
                    <a className="content-title-link" href={getContentExternalUrl(row.item)} target="_blank" rel="noreferrer">
                      {row.item.title}
                    </a>
                  </div>
                  <span>{row.item.campaign ?? row.item.status}</span>
                </td>
                {columns.map((column) => (
                  <td key={`${row.item.id}-${column.key}`}>
                    {sortKey === column.key && column.format !== "duration" && column.format !== "date" ? (
                      <strong>{formatCellValue(row, column)}</strong>
                    ) : (
                      formatCellValue(row, column)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination pagination={pagination} />
    </>
  );
}

function ContentTable({ items }: { items: ContentItem[] }) {
  const pagination = usePaginatedItems(items);

  return (
    <>
      <div className="table-scroll">
        <table className="data-table content-table">
          <thead>
            <tr>
              <th>콘텐츠</th>
              <th>채널</th>
              <th>유형</th>
              <th>캠페인</th>
              <th>발행일</th>
              <th>성과</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pagedItems.map((item) => (
              <tr key={item.id}>
                <td>
                  <a className="content-title-link" href={getContentExternalUrl(item)} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                  <span>{item.status}</span>
                </td>
                <td>
                  <ChannelBadge channel={item.channel} />
                </td>
                <td>{item.type}</td>
                <td>{item.campaign ?? "-"}</td>
                <td>{item.publishDate}</td>
                <td>
                  <strong>{item.metricValue}</strong> {item.metricLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination pagination={pagination} />
    </>
  );
}

function usePaginatedItems<T>(items: T[], pageSize = PAGE_SIZE): PaginationState<T> {
  const [page, setPage] = useState(1);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, totalItems);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const pagedItems = useMemo(() => items.slice(start, end), [items, start, end]);

  return {
    page: safePage,
    totalPages,
    totalItems,
    start,
    end,
    pagedItems,
    setPage,
  };
}

function Pagination<T>({ pagination, compact = false }: { pagination: PaginationState<T>; compact?: boolean }) {
  if (pagination.totalItems <= PAGE_SIZE) return null;

  return (
    <div className={compact ? "pagination compact" : "pagination"}>
      <span>
        {pagination.start + 1}-{pagination.end} / 총 {pagination.totalItems}개
      </span>
      <div>
        <button disabled={pagination.page === 1} onClick={() => pagination.setPage(pagination.page - 1)}>
          이전
        </button>
        {Array.from({ length: pagination.totalPages }, (_, index) => index + 1).map((page) => (
          <button
            className={pagination.page === page ? "active" : ""}
            key={page}
            onClick={() => pagination.setPage(page)}
          >
            {page}
          </button>
        ))}
        <button
          disabled={pagination.page === pagination.totalPages}
          onClick={() => pagination.setPage(pagination.page + 1)}
        >
          다음
        </button>
      </div>
    </div>
  );
}

function BriefingBlock({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <section className="briefing-block">
      <h3>{title}</h3>
      <Tag>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </Tag>
    </section>
  );
}

export default App;
