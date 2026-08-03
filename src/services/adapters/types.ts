export type ChannelId =
  | "all"
  | "youtube"
  | "instagram"
  | "website"
  | "linkedin"
  | "naver"
  | "tiktok";

export type DataStatus = "complete" | "partial" | "not_uploaded" | "unavailable" | "error";

export type PeriodMode = "weekly" | "monthly";
export type CompareGranularity = "week" | "month" | "year";

export interface KpiCard {
  label: string;
  value: string;
  delta: string;
  tone: "up" | "down" | "neutral";
  source: string;
  status: DataStatus;
}

export interface TrendPoint {
  label: string;
  value: number;
}

export interface ChannelMetric {
  label: string;
  value: string;
  secondary?: string;
  delta: string;
  status: DataStatus;
}

export interface ChannelView {
  id: Exclude<ChannelId, "all">;
  name: string;
  role: string;
  objective: string;
  color: string;
  updatedAt: string;
  source: string;
  tabs: string[];
  kpis: ChannelMetric[];
  trend: TrendPoint[];
  trendSeries?: Partial<Record<string, TrendPoint[]>>;
  topContent: ContentItem[];
  dataNote: string;
}

export interface ContentItem {
  id: string;
  title: string;
  channel: Exclude<ChannelId, "all">;
  type: string;
  status: string;
  campaignId?: string;
  campaign?: string;
  publishDate: string;
  metricLabel: string;
  metricValue: string;
  draft?: string;
  linkedPostId?: string;
  linkedPostTitle?: string;
  performanceSource?: string;
  externalUrl?: string;
  decisionLogs?: string[];
  performance?: Partial<{
    views: number;
    watchTimeMinutes: number;
    reach: number;
    impressions: number;
    avgWatchSeconds: number;
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
  }>;
}

export interface PublishingItem {
  id: string;
  title: string;
  channel: Exclude<ChannelId, "all">;
  type: string;
  date: string;
  time: string;
  status: "scheduled" | "today" | "delayed" | "published";
}

export interface CampaignRow {
  id: string;
  campaign: string;
  objective: string;
  contentIds?: string[];
  contentCount?: number;
  linkedPostCount?: number;
  adCount?: number;
  youtube?: string;
  tiktok?: string;
  instagram?: string;
  linkedin?: string;
  naver?: string;
  website?: string;
  total: string;
  bestChannel: string;
}

export interface AdContent {
  id: string;
  title: string;
  channel: Exclude<ChannelId, "all">;
  campaignId?: string;
  campaign: string;
  sourceContentId?: string;
  sourceContent?: string;
  linkedPostTitle?: string;
  performanceSource?: string;
  period: string;
  budget: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  organicLift: string;
  status: "active" | "ended" | "planned";
}

export interface DataSourceState {
  id: string;
  label: string;
  kind: "api" | "file" | "manual";
  connectionGroup?: "api" | "file";
  channels?: string[];
  cadence?: string;
  status: DataStatus;
  lastSync: string;
  detail: string;
}

export interface CommandCenterSnapshot {
  kpis: KpiCard[];
  trends: TrendPoint[];
  publishing: PublishingItem[];
  todayAlerts: PublishingItem[];
  channelHighlights: Array<{
    channel: string;
    summary: string;
    delta: string;
    status: DataStatus;
  }>;
}

export interface ContentLabSnapshot {
  pipeline: ContentItem[];
  campaigns: CampaignRow[];
  ads: AdContent[];
  archive: ContentItem[];
  publishingRules: Array<{
    id: string;
    label: string;
    channel: Exclude<ChannelId, "all">;
    cadence: string;
    days: string[];
    time: string;
  }>;
}

export interface DataCenterSnapshot {
  sources: DataSourceState[];
  mappingRows: Array<{
    raw: string;
    metric: string;
    transform: string;
    platform: string;
  }>;
  issues: Array<{
    severity: "warning" | "error" | "info";
    title: string;
    detail: string;
  }>;
}

export interface PeriodComparisonRow {
  metric: string;
  previous: string;
  current: string;
  growth: string;
  status: DataStatus;
}

export interface PeriodComparison {
  scope: ChannelId;
  detail: string;
  baseline: string;
  currentLabel: string;
  summary: string;
  rows: PeriodComparisonRow[];
  dataNote: string;
}

export interface AiBriefing {
  title: string;
  generatedAt: string;
  periodLabel: string;
  dataSources: string[];
  dataWarnings: string[];
  summary: string;
  wins: string[];
  risks: string[];
  actions: string[];
  evidence: string[];
}

export interface BriefingRequest {
  surface: "command" | "channel" | "campaign" | "ad";
  periodMode: PeriodMode;
  channel?: Exclude<ChannelId, "all">;
  campaign?: string;
  ad?: string;
}

export interface BrandDataProvider {
  getCommandCenterSnapshot(periodMode: PeriodMode): Promise<CommandCenterSnapshot>;
  getChannels(periodMode: PeriodMode): Promise<ChannelView[]>;
  getContentLabSnapshot(periodMode: PeriodMode): Promise<ContentLabSnapshot>;
  getDataCenterSnapshot(periodMode: PeriodMode): Promise<DataCenterSnapshot>;
  getPeriodComparison(
    scope: ChannelId,
    detail: string,
    granularity: CompareGranularity,
    baseline: string,
  ): Promise<PeriodComparison>;
  generateBriefing(request: BriefingRequest): Promise<AiBriefing>;
  upsertContentCard(card: ContentItem, periodMode: PeriodMode): Promise<ContentLabSnapshot>;
  moveContentCard(contentId: string, status: string, periodMode: PeriodMode): Promise<ContentLabSnapshot>;
  deleteContentCard(contentId: string, periodMode: PeriodMode): Promise<ContentLabSnapshot>;
  createCampaignFromContent(sourceContentId: string | undefined, periodMode: PeriodMode): Promise<ContentLabSnapshot>;
  upsertAd(ad: AdContent, periodMode: PeriodMode): Promise<ContentLabSnapshot>;
  deleteAd(adId: string, periodMode: PeriodMode): Promise<ContentLabSnapshot>;
}
