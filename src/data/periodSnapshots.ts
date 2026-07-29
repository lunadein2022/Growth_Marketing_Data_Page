import {
  channelMeta,
  channels,
  commandCenterSnapshot,
  contentLabSnapshot,
  dataCenterSnapshot,
} from "./mockData";
import type {
  AdContent,
  CampaignRow,
  ChannelId,
  ChannelView,
  CommandCenterSnapshot,
  ContentItem,
  ContentLabSnapshot,
  DataCenterSnapshot,
  PeriodMode,
} from "../services/adapters/types";

const cloneSnapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const monthFactor = 4.15;
const weeklyTrendLabels = ["월", "화", "수", "목", "금", "토", "일"];
const monthlyTrendLabels = ["1주", "2주", "3주", "4주"];

function isMonthly(periodMode: PeriodMode) {
  return periodMode === "monthly";
}

function parseMetricNumber(value: string) {
  const match = value.match(/[\d,.]+/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function scaleMetricText(value: string, factor = monthFactor) {
  if (!value || /N\/A|미정|대기|예정|없음/.test(value)) return value;
  const parsed = parseMetricNumber(value);
  if (parsed === null) return value;

  if (value.includes("%")) return value;
  if (/^\d+:\d+/.test(value)) return value;
  if (value.includes("K")) return `${Math.round(parsed * factor)}K`;
  if (value.includes("만")) return `${Number((parsed * factor).toFixed(1))}만`;
  if (value.includes("h")) return `${formatInteger(parsed * factor)}h`;
  if (value.includes("원")) return `${formatInteger(parsed * factor)}원`;
  if (value.includes("명")) return value;

  return value.replace(/[\d,.]+/, formatInteger(parsed * factor));
}

function scaleDeltaText(value: string, factor = monthFactor) {
  const parsed = parseMetricNumber(value);
  if (parsed === null) return value;
  if (value.includes("명")) return value.replace(/[\d,.]+/, formatInteger(parsed * factor));
  return value;
}

function buildMonthlyTrend(points: Array<{ label: string; value: number }>, factor = 1) {
  const source = points.length > 0 ? points : [{ label: "1주", value: 20 }];
  const average = source.reduce((sum, point) => sum + point.value, 0) / source.length;
  const profile = [0.72, 0.91, 1.06, 1.24];

  return monthlyTrendLabels.map((label, index) => ({
    label,
    value: Math.round((average * profile[index] + index * 3) * factor),
  }));
}

function relabelWeeklyTrend(points: Array<{ label: string; value: number }>) {
  return points.map((point, index) => ({
    ...point,
    label: weeklyTrendLabels[index] ?? point.label,
  }));
}

function buildMonthlyPublishing(items: CommandCenterSnapshot["publishing"]) {
  const channelCycle: Array<Exclude<ChannelId, "all">> = ["youtube", "instagram", "tiktok", "linkedin", "naver", "website"];
  const typeCycle = ["Shorts", "Reels", "Short", "Card", "Blog", "Landing"];
  const generated = Array.from({ length: 31 }, (_, index): CommandCenterSnapshot["publishing"][number] => {
    const channel = channelCycle[index % channelCycle.length];
    const day = index + 1;
    const status = day < 29 ? "published" : day === 29 ? "today" : "scheduled";

    return {
      id: `monthly-pub-${day}`,
      title: `7월 ${channelMeta[channel].label} 발행 ${day}`,
      channel,
      type: typeCycle[index % typeCycle.length],
      date: `2026-07-${String(day).padStart(2, "0")}`,
      time: `${String(9 + (index % 9)).padStart(2, "0")}:00`,
      status,
    };
  });

  const byId = new Map(generated.map((item) => [item.id, item]));
  items.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function scaleContentItemForPeriod(item: ContentItem, periodMode: PeriodMode): ContentItem {
  if (!isMonthly(periodMode)) return cloneSnapshot(item);

  return {
    ...cloneSnapshot(item),
    metricValue: scaleMetricText(item.metricValue),
    performanceSource: item.performanceSource
      ? `${item.performanceSource} · 월간 집계`
      : item.metricValue && !/미정|대기|예정/.test(item.metricValue)
        ? "월간 집계"
        : item.performanceSource,
  };
}

function scaleCampaignForPeriod(campaign: CampaignRow, periodMode: PeriodMode): CampaignRow {
  if (!isMonthly(periodMode)) return cloneSnapshot(campaign);

  return {
    ...cloneSnapshot(campaign),
    youtube: campaign.youtube ? scaleMetricText(campaign.youtube) : campaign.youtube,
    tiktok: campaign.tiktok ? scaleMetricText(campaign.tiktok) : campaign.tiktok,
    instagram: campaign.instagram ? scaleMetricText(campaign.instagram) : campaign.instagram,
    linkedin: campaign.linkedin ? scaleMetricText(campaign.linkedin) : campaign.linkedin,
    naver: campaign.naver ? scaleMetricText(campaign.naver) : campaign.naver,
    website: campaign.website ? scaleMetricText(campaign.website) : campaign.website,
    total: campaign.total.includes("·") ? `${campaign.total} · 월간` : `${campaign.total} · 월간 집계`,
  };
}

function scaleAdForPeriod(ad: AdContent, periodMode: PeriodMode): AdContent {
  if (!isMonthly(periodMode)) return cloneSnapshot(ad);

  return {
    ...cloneSnapshot(ad),
    spend: scaleMetricText(ad.spend),
    impressions: scaleMetricText(ad.impressions),
    clicks: scaleMetricText(ad.clicks),
    performanceSource: ad.performanceSource ? `${ad.performanceSource} · 월간 집계` : ad.performanceSource,
  };
}

export function buildCommandCenterSnapshot(periodMode: PeriodMode): CommandCenterSnapshot {
  const snapshot = cloneSnapshot(commandCenterSnapshot);

  if (!isMonthly(periodMode)) {
    return {
      ...snapshot,
      trends: snapshot.trends.map((point, index) => ({
        label: `${index + 1}주`,
        value: point.value,
      })),
    };
  }

  const monthlyValues = ["168.4만", "284.7만", "52,840", "91%"];
  const monthlyDeltas = ["+31%", "+22%", "+27%", "+6%p"];

  return {
    ...snapshot,
    kpis: snapshot.kpis.map((kpi, index) => ({
      ...kpi,
      value: monthlyValues[index] ?? scaleMetricText(kpi.value),
      delta: monthlyDeltas[index] ?? kpi.delta,
      tone: index === 3 ? "up" : kpi.tone,
      source: `${kpi.source} · 월간`,
    })),
    trends: buildMonthlyTrend(snapshot.trends, 1.08),
    publishing: buildMonthlyPublishing(snapshot.publishing),
    todayAlerts: snapshot.todayAlerts.map((item) => ({
      ...item,
      title: `${item.title} · 월간 체크`,
    })),
    channelHighlights: snapshot.channelHighlights.map((item) => ({
      ...item,
      summary: `${item.summary} · 월간 누적 기준`,
      delta: item.delta === "부분" ? item.delta : item.delta.replace(/\+(\d+)/, (_, number) => `+${Math.round(Number(number) * 1.25)}`),
    })),
  };
}

export function buildChannelsSnapshot(periodMode: PeriodMode): ChannelView[] {
  return channels.map((channel) => {
    const next = cloneSnapshot(channel);

    if (!isMonthly(periodMode)) {
      return {
        ...next,
        trend: relabelWeeklyTrend(next.trend),
        trendSeries: next.trendSeries
          ? Object.fromEntries(
              Object.entries(next.trendSeries).map(([key, points]) => [key, relabelWeeklyTrend(points ?? [])]),
            )
          : next.trendSeries,
      };
    }

    return {
      ...next,
      updatedAt: "2026.07 월간 집계",
      kpis: next.kpis.map((metric) => ({
        ...metric,
        value: scaleMetricText(metric.value),
        secondary: metric.secondary ? scaleDeltaText(metric.secondary) : metric.secondary,
        delta: metric.delta === "N/A" ? metric.delta : metric.delta.replace(/\+(\d+)/, (_, number) => `+${Math.round(Number(number) * 1.18)}`),
      })),
      trend: buildMonthlyTrend(next.trend, 1.12),
      trendSeries: next.trendSeries
        ? Object.fromEntries(
            Object.entries(next.trendSeries).map(([key, points]) => [key, buildMonthlyTrend(points ?? next.trend, 1.1)]),
          )
        : next.trendSeries,
      topContent: next.topContent.map((item) => scaleContentItemForPeriod(item, periodMode)),
      dataNote: `${next.dataNote} 월간 화면에서는 선택 기간 전체 누적값과 월간 추세로 표시합니다.`,
    };
  });
}

export function buildContentLabSnapshot(periodMode: PeriodMode, source: ContentLabSnapshot = contentLabSnapshot): ContentLabSnapshot {
  const snapshot = cloneSnapshot(source);
  if (!isMonthly(periodMode)) return snapshot;

  return {
    ...snapshot,
    pipeline: snapshot.pipeline.map((item) => scaleContentItemForPeriod(item, periodMode)),
    archive: snapshot.archive.map((item) => scaleContentItemForPeriod(item, periodMode)),
    campaigns: snapshot.campaigns.map((campaign) => scaleCampaignForPeriod(campaign, periodMode)),
    ads: snapshot.ads.map((ad) => scaleAdForPeriod(ad, periodMode)),
  };
}

export function buildDataCenterSnapshot(periodMode: PeriodMode): DataCenterSnapshot {
  const snapshot = cloneSnapshot(dataCenterSnapshot);
  if (!isMonthly(periodMode)) return snapshot;

  return {
    ...snapshot,
    sources: snapshot.sources.map((source) => ({
      ...source,
      detail: `${source.detail} · 월간 조회`,
    })),
    issues: [
      {
        severity: "info",
        title: "월간 기준 적용",
        detail: "현재 화면의 데이터는 상단 월간 선택값을 기준으로 집계됩니다.",
      },
      ...snapshot.issues,
    ],
  };
}
