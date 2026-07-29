import {
  buildPeriodComparison,
  channels,
  channelMeta,
  contentLabSnapshot,
} from "../../data/mockData";
import {
  buildChannelsSnapshot,
  buildCommandCenterSnapshot,
  buildContentLabSnapshot,
  buildDataCenterSnapshot,
} from "../../data/periodSnapshots";
import type {
  AdContent,
  AiBriefing,
  BrandDataProvider,
  BriefingRequest,
  CampaignRow,
  ChannelId,
  CompareGranularity,
  ContentItem,
  ContentLabSnapshot,
  PeriodMode,
} from "./types";

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const cloneSnapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const hasCollectedPerformance = (item: ContentItem) => {
  const marker = `${item.metricLabel} ${item.metricValue}`;
  return !/(자동|대기|미정|없음|예정)/.test(marker);
};

const parseMetricScore = (value?: string) => {
  if (!value || value === "-") return 0;
  const match = value.match(/[\d,.]+/);
  if (!match) return 0;
  const base = Number(match[0].replace(/,/g, ""));
  if (Number.isNaN(base)) return 0;
  if (value.toUpperCase().includes("K")) return base * 1000;
  if (value.includes("만")) return base * 10000;
  return base;
};

const getCampaignIdByName = (lab: ContentLabSnapshot, name?: string) =>
  lab.campaigns.find((campaign) => campaign.campaign === name)?.id;

const normalizeContentCard = (lab: ContentLabSnapshot, card: ContentItem): ContentItem => ({
  ...card,
  campaignId: card.campaignId ?? getCampaignIdByName(lab, card.campaign),
});

const normalizeAd = (lab: ContentLabSnapshot, ad: AdContent): AdContent => {
  const contentLibrary = [...lab.pipeline, ...lab.archive];
  const source = contentLibrary.find((item) => item.id === ad.sourceContentId || item.linkedPostId === ad.sourceContentId);

  return {
    ...ad,
    campaignId: ad.campaignId ?? getCampaignIdByName(lab, ad.campaign),
    sourceContentId: ad.sourceContentId ?? source?.id,
    sourceContent: ad.sourceContent || source?.title,
    linkedPostTitle: ad.linkedPostTitle || source?.title,
  };
};

const buildGeneratedCampaign = (lab: ContentLabSnapshot, sourceContentId?: string): CampaignRow | null => {
  const candidates = [...lab.pipeline, ...lab.archive]
    .filter(hasCollectedPerformance)
    .sort((a, b) => parseMetricScore(b.metricValue) - parseMetricScore(a.metricValue));
  const source = candidates.find((item) => item.id === sourceContentId) ?? candidates[0];
  if (!source) return null;

  const topic = source.campaign && source.campaign !== "캠페인 없음" ? source.campaign : source.title.split("#")[0].trim();
  const topicSeed = topic.split(" ")[0];
  const related = candidates
    .filter((item) => item.campaignId === source.campaignId || item.campaign === source.campaign || item.title.includes(topicSeed))
    .slice(0, 8);
  const byChannel = (channel: ContentItem["channel"]) => related.find((item) => item.channel === channel);
  const metricFor = (channel: ContentItem["channel"]) => {
    const item = byChannel(channel);
    return item ? `${item.metricValue} ${item.metricLabel}` : undefined;
  };

  return {
    id: `camp-auto-${Date.now()}`,
    campaign: `${topic} 리패키징`,
    objective: "성과 상위 소재를 묶어 자동 생성한 캠페인",
    contentIds: related.map((item) => item.id),
    contentCount: related.length,
    linkedPostCount: related.filter(hasCollectedPerformance).length,
    adCount: 0,
    youtube: metricFor("youtube"),
    tiktok: metricFor("tiktok"),
    instagram: metricFor("instagram"),
    linkedin: metricFor("linkedin"),
    naver: metricFor("naver"),
    website: metricFor("website"),
    total: `소재 ${related.length}개 · 연결 ${related.filter(hasCollectedPerformance).length}개`,
    bestChannel: channelMeta[source.channel].label,
  };
};

export class MockBrandDataProvider implements BrandDataProvider {
  private contentLab = cloneSnapshot(contentLabSnapshot);

  async getCommandCenterSnapshot(periodMode: PeriodMode) {
    await delay(120);
    return buildCommandCenterSnapshot(periodMode);
  }

  async getChannels(periodMode: PeriodMode) {
    await delay(120);
    return buildChannelsSnapshot(periodMode);
  }

  async getContentLabSnapshot(periodMode: PeriodMode) {
    await delay(120);
    return buildContentLabSnapshot(periodMode, this.contentLab);
  }

  async getDataCenterSnapshot(periodMode: PeriodMode) {
    await delay(120);
    return buildDataCenterSnapshot(periodMode);
  }

  async getPeriodComparison(scope: ChannelId, detail: string, granularity: CompareGranularity, baseline: string) {
    await delay(180);
    return buildPeriodComparison(scope, detail, baseline, granularity);
  }

  async generateBriefing(request: BriefingRequest): Promise<AiBriefing> {
    await delay(900);

    const target = request.ad
      ? `${request.ad} 광고`
      : request.campaign
      ? `${request.campaign} 캠페인`
      : request.channel
      ? channels.find((channel) => channel.id === request.channel)?.name ?? "채널"
      : request.surface === "ad"
        ? "광고 성과"
        : request.surface === "campaign"
          ? "캠페인"
          : "Brand Command Center";

    return {
      title: `${target} ${request.periodMode === "weekly" ? "주간" : "월간"} AI 보고서`,
      generatedAt: "2026.07.28 18:40",
      periodLabel: request.periodMode === "weekly" ? "2026년 7월 4주차" : "2026년 7월",
      dataSources:
        request.surface === "command"
          ? ["YouTube Analytics API", "Instagram Graph API", "GA4", "Search Console", "파일 업로드 채널"]
          : ["현재 화면 집계", "연결된 게시물 성과", "데이터 상태"],
      dataWarnings: [
        "부분 데이터와 미지원 지표는 N/A 또는 일부 데이터로 표시했습니다.",
        "AI는 화면에 집계된 값만 사용하며 없는 수치를 생성하지 않습니다.",
      ],
      summary:
        request.surface === "command"
          ? "이번 기간은 검색 가시성과 콘텐츠 소비가 함께 상승했고, 발행 건강도는 계획 대비 지연 1건 때문에 소폭 하락했습니다."
          : request.surface === "ad"
            ? `${target}는 지출 대비 클릭, CTR, 광고 후 Organic Lift를 함께 보면 판단할 수 있습니다. 현재 데이터 기준으로는 효과가 있었는지, 유의미하지만 개선이 필요한지, 집행 전이라 보류해야 하는지를 구분해 보는 흐름입니다.`
            : request.surface === "campaign"
              ? `${target}은 채널별 역할이 분리되어 있습니다. 확산 채널, 신뢰 채널, 문의 전환 채널을 나눠 보고 다음 소재 재활용 우선순위를 잡는 것이 좋습니다.`
          : `${target}의 주요 성과는 상승 흐름입니다. 단, 부분 데이터가 포함된 지표는 원 지표와 상태를 함께 확인해야 합니다.`,
      wins: [
        request.surface === "ad"
          ? "원본 콘텐츠와 광고 성과를 분리해 보면서 광고가 만든 추가 반응을 확인할 수 있습니다."
          : "Hydro Hawk 실증 소재가 YouTube, TikTok, Instagram에서 반복 사용되며 채널별 기여가 분산되었습니다.",
        "Website KR/EN 검색 클릭과 직접 유입이 함께 증가해 브랜드 탐색 행동이 강화되었습니다.",
      ],
      risks: [
        request.surface === "ad"
          ? "광고 지표만 보면 좋은 소재인지, 타깃이 맞았는지, 랜딩이 문제였는지 분리하기 어렵습니다."
          : "TikTok 평균 시청시간과 LinkedIn 선택 지표는 일부 미등록 상태입니다.",
        "Instagram 릴스 일부 지표는 API 응답 조건에 따라 N/A로 표시될 수 있습니다.",
      ],
      actions: [
        request.surface === "ad"
          ? "CTR이 낮으면 첫 화면과 CTA를 바꾸고, Organic Lift가 낮으면 원본 콘텐츠와 타깃의 연결성을 다시 봅니다."
          : "Hydro Hawk 실증 소재를 다음 주 Naver Blog와 LinkedIn 카드뉴스로 재활용합니다.",
        request.surface === "campaign"
          ? "상위 채널의 메시지를 기준으로 저성과 채널의 CTA와 썸네일/첫 문장을 재작성합니다."
          : "지연된 TikTok 숏폼 1건을 이번 주 금요일 18시 슬롯으로 재배치합니다.",
        "Website EN 제품 랜딩에 검색 유입이 높은 키워드 문구를 반영합니다.",
      ],
      evidence: [
        "Website 사용자 10,657 → 12,840 (+20%)",
        "YouTube 조회수 17,640 → 23,100 (+31%)",
        "발행 건강도 82%, 지연 1건",
      ],
    };
  }

  async upsertContentCard(card: ContentItem, periodMode: PeriodMode) {
    await delay(140);
    const nextCard = normalizeContentCard(this.contentLab, card);
    const index = this.contentLab.pipeline.findIndex((item) => item.id === nextCard.id);
    this.contentLab.pipeline =
      index >= 0
        ? this.contentLab.pipeline.map((item) => (item.id === nextCard.id ? nextCard : item))
        : [nextCard, ...this.contentLab.pipeline];
    return buildContentLabSnapshot(periodMode, this.contentLab);
  }

  async moveContentCard(contentId: string, status: string, periodMode: PeriodMode) {
    await delay(100);
    this.contentLab.pipeline = this.contentLab.pipeline.map((item) =>
      item.id === contentId ? { ...item, status } : item,
    );
    return buildContentLabSnapshot(periodMode, this.contentLab);
  }

  async deleteContentCard(contentId: string, periodMode: PeriodMode) {
    await delay(100);
    this.contentLab.pipeline = this.contentLab.pipeline.filter((item) => item.id !== contentId);
    this.contentLab.campaigns = this.contentLab.campaigns.map((campaign) => ({
      ...campaign,
      contentIds: campaign.contentIds?.filter((id) => id !== contentId),
    }));
    return buildContentLabSnapshot(periodMode, this.contentLab);
  }

  async createCampaignFromContent(sourceContentId: string | undefined, periodMode: PeriodMode) {
    await delay(160);
    const generatedCampaign = buildGeneratedCampaign(this.contentLab, sourceContentId);
    if (generatedCampaign) {
      this.contentLab.campaigns = [generatedCampaign, ...this.contentLab.campaigns];
    }
    return buildContentLabSnapshot(periodMode, this.contentLab);
  }

  async upsertAd(ad: AdContent, periodMode: PeriodMode) {
    await delay(140);
    const nextAd = normalizeAd(this.contentLab, ad);
    const index = this.contentLab.ads.findIndex((item) => item.id === nextAd.id);
    this.contentLab.ads =
      index >= 0 ? this.contentLab.ads.map((item) => (item.id === nextAd.id ? nextAd : item)) : [nextAd, ...this.contentLab.ads];
    return buildContentLabSnapshot(periodMode, this.contentLab);
  }

  async deleteAd(adId: string, periodMode: PeriodMode) {
    await delay(100);
    this.contentLab.ads = this.contentLab.ads.filter((ad) => ad.id !== adId);
    return buildContentLabSnapshot(periodMode, this.contentLab);
  }
}
