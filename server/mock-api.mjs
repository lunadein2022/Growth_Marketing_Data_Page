import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mockDataPath = resolve(projectRoot, "src/data/mockData.ts");

let mockModulePromise;
let contentLabState;

async function loadMockData() {
  if (!mockModulePromise) {
    mockModulePromise = readFile(mockDataPath, "utf8").then((source) => {
      const output = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        },
      }).outputText;
      const hash = createHash("sha256").update(output).digest("hex");
      const dataUrl = `data:text/javascript;base64,${Buffer.from(`${output}\n//# sourceURL=mockData-${hash}.mjs`).toString("base64")}`;
      return import(dataUrl);
    });
  }

  return mockModulePromise;
}

function corsHeaders(request) {
  const origin = request.headers.origin ?? "http://127.0.0.1:5173";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    Vary: "Origin",
  };
}

function sendJson(response, request, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request),
  });
  response.end(JSON.stringify(payload, null, 2));
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body) {
        resolveBody({});
        return;
      }

      try {
        resolveBody(JSON.parse(body));
      } catch {
        resolveBody({ rawBody: body });
      }
    });
    request.on("error", rejectBody);
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getContentLabState(data) {
  if (!contentLabState) {
    contentLabState = clone(data.contentLabSnapshot);
  }

  return contentLabState;
}

function hasCollectedPerformance(item) {
  const marker = `${item.metricLabel ?? ""} ${item.metricValue ?? ""}`;
  return !/(자동|대기|미정|없음|예정)/.test(marker);
}

function parseMetricScore(value) {
  if (!value || value === "-") return 0;
  const match = String(value).match(/[\d,.]+/);
  if (!match) return 0;
  const base = Number(match[0].replace(/,/g, ""));
  if (Number.isNaN(base)) return 0;
  if (String(value).toUpperCase().includes("K")) return base * 1000;
  if (String(value).includes("만")) return base * 10000;
  return base;
}

function getPeriodMode(url) {
  return url.searchParams.get("period") === "monthly" ? "monthly" : "weekly";
}

function parseMetricNumber(value) {
  const match = String(value ?? "").match(/[\d,.]+/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

function formatInteger(value) {
  return Math.round(value).toLocaleString("ko-KR");
}

function scaleMetricText(value, factor = 4.15) {
  if (!value || /N\/A|미정|대기|예정|없음/.test(value)) return value;
  const parsed = parseMetricNumber(value);
  if (parsed === null) return value;

  if (String(value).includes("%")) return value;
  if (/^\d+:\d+/.test(String(value))) return value;
  if (String(value).includes("K")) return `${Math.round(parsed * factor)}K`;
  if (String(value).includes("만")) return `${Number((parsed * factor).toFixed(1))}만`;
  if (String(value).includes("h")) return `${formatInteger(parsed * factor)}h`;
  if (String(value).includes("원")) return `${formatInteger(parsed * factor)}원`;
  if (String(value).includes("명")) return value;

  return String(value).replace(/[\d,.]+/, formatInteger(parsed * factor));
}

function scaleDeltaText(value, factor = 4.15) {
  const parsed = parseMetricNumber(value);
  if (parsed === null) return value;
  if (String(value).includes("명")) return String(value).replace(/[\d,.]+/, formatInteger(parsed * factor));
  return value;
}

function buildMonthlyTrend(points, factor = 1) {
  const source = points.length > 0 ? points : [{ label: "1주", value: 20 }];
  const average = source.reduce((sum, point) => sum + point.value, 0) / source.length;
  const profile = [0.72, 0.91, 1.06, 1.24];

  return ["1주", "2주", "3주", "4주"].map((label, index) => ({
    label,
    value: Math.round((average * profile[index] + index * 3) * factor),
  }));
}

function relabelWeeklyTrend(points) {
  const labels = ["월", "화", "수", "목", "금", "토", "일"];
  return points.map((point, index) => ({
    ...point,
    label: labels[index] ?? point.label,
  }));
}

function buildMonthlyPublishing(items, data) {
  const channelCycle = ["youtube", "instagram", "tiktok", "linkedin", "naver", "website"];
  const typeCycle = ["Shorts", "Reels", "Short", "Card", "Blog", "Landing"];
  const generated = Array.from({ length: 31 }, (_, index) => {
    const channel = channelCycle[index % channelCycle.length];
    const day = index + 1;
    const status = day < 29 ? "published" : day === 29 ? "today" : "scheduled";

    return {
      id: `monthly-pub-${day}`,
      title: `7월 ${data.channelMeta[channel].label} 발행 ${day}`,
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

function scaleContentItemForPeriod(item, periodMode) {
  if (periodMode !== "monthly") return clone(item);

  return {
    ...clone(item),
    metricValue: scaleMetricText(item.metricValue),
    performanceSource: item.performanceSource
      ? `${item.performanceSource} · 월간 집계`
      : item.metricValue && !/미정|대기|예정/.test(item.metricValue)
        ? "월간 집계"
        : item.performanceSource,
  };
}

function buildCommandCenterForPeriod(data, periodMode) {
  const snapshot = clone(data.commandCenterSnapshot);
  if (periodMode !== "monthly") {
    return {
      ...snapshot,
      trends: snapshot.trends.map((point, index) => ({ ...point, label: `${index + 1}주` })),
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
    publishing: buildMonthlyPublishing(snapshot.publishing, data),
    todayAlerts: snapshot.todayAlerts.map((item) => ({ ...item, title: `${item.title} · 월간 체크` })),
    channelHighlights: snapshot.channelHighlights.map((item) => ({
      ...item,
      summary: `${item.summary} · 월간 누적 기준`,
      delta: item.delta === "부분" ? item.delta : String(item.delta).replace(/\+(\d+)/, (_, number) => `+${Math.round(Number(number) * 1.25)}`),
    })),
  };
}

function buildChannelsForPeriod(data, periodMode) {
  return data.channels.map((channel) => {
    const next = clone(channel);

    if (periodMode !== "monthly") {
      return {
        ...next,
        trend: relabelWeeklyTrend(next.trend),
        trendSeries: next.trendSeries
          ? Object.fromEntries(Object.entries(next.trendSeries).map(([key, points]) => [key, relabelWeeklyTrend(points ?? [])]))
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
        delta: metric.delta === "N/A" ? metric.delta : String(metric.delta).replace(/\+(\d+)/, (_, number) => `+${Math.round(Number(number) * 1.18)}`),
      })),
      trend: buildMonthlyTrend(next.trend, 1.12),
      trendSeries: next.trendSeries
        ? Object.fromEntries(Object.entries(next.trendSeries).map(([key, points]) => [key, buildMonthlyTrend(points ?? next.trend, 1.1)]))
        : next.trendSeries,
      topContent: next.topContent.map((item) => scaleContentItemForPeriod(item, periodMode)),
      dataNote: `${next.dataNote} 월간 화면에서는 선택 기간 전체 누적값과 월간 추세로 표시합니다.`,
    };
  });
}

function buildContentLabForPeriod(source, periodMode) {
  const snapshot = clone(source);
  if (periodMode !== "monthly") return snapshot;

  return {
    ...snapshot,
    pipeline: snapshot.pipeline.map((item) => scaleContentItemForPeriod(item, periodMode)),
    archive: snapshot.archive.map((item) => scaleContentItemForPeriod(item, periodMode)),
    campaigns: snapshot.campaigns.map((campaign) => ({
      ...campaign,
      youtube: campaign.youtube ? scaleMetricText(campaign.youtube) : campaign.youtube,
      tiktok: campaign.tiktok ? scaleMetricText(campaign.tiktok) : campaign.tiktok,
      instagram: campaign.instagram ? scaleMetricText(campaign.instagram) : campaign.instagram,
      linkedin: campaign.linkedin ? scaleMetricText(campaign.linkedin) : campaign.linkedin,
      naver: campaign.naver ? scaleMetricText(campaign.naver) : campaign.naver,
      website: campaign.website ? scaleMetricText(campaign.website) : campaign.website,
      total: String(campaign.total).includes("·") ? `${campaign.total} · 월간` : `${campaign.total} · 월간 집계`,
    })),
    ads: snapshot.ads.map((ad) => ({
      ...ad,
      spend: scaleMetricText(ad.spend),
      impressions: scaleMetricText(ad.impressions),
      clicks: scaleMetricText(ad.clicks),
      performanceSource: ad.performanceSource ? `${ad.performanceSource} · 월간 집계` : ad.performanceSource,
    })),
  };
}

function buildDataCenterForPeriod(data, periodMode) {
  const snapshot = clone(data.dataCenterSnapshot);
  if (periodMode !== "monthly") return snapshot;

  return {
    ...snapshot,
    sources: snapshot.sources.map((source) => ({ ...source, detail: `${source.detail} · 월간 조회` })),
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

function getCampaignIdByName(lab, name) {
  return lab.campaigns.find((campaign) => campaign.campaign === name)?.id;
}

function normalizeContentCard(lab, card) {
  return {
    ...card,
    campaignId: card.campaignId ?? getCampaignIdByName(lab, card.campaign),
  };
}

function normalizeAd(lab, ad) {
  const contentLibrary = [...lab.pipeline, ...lab.archive];
  const source = contentLibrary.find((item) => item.id === ad.sourceContentId || item.linkedPostId === ad.sourceContentId);

  return {
    ...ad,
    campaignId: ad.campaignId ?? getCampaignIdByName(lab, ad.campaign),
    sourceContentId: ad.sourceContentId ?? source?.id,
    sourceContent: ad.sourceContent || source?.title,
    linkedPostTitle: ad.linkedPostTitle || source?.title,
  };
}

function buildGeneratedCampaign(lab, data, sourceContentId) {
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
  const byChannel = (channel) => related.find((item) => item.channel === channel);
  const metricFor = (channel) => {
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
    bestChannel: data.channelMeta[source.channel].label,
  };
}

function makeBriefing(requestBody, data) {
  const channel = requestBody.channel ? data.channels.find((item) => item.id === requestBody.channel) : null;
  const target =
    requestBody.ad ??
    requestBody.adId ??
    requestBody.campaign ??
    requestBody.campaignId ??
    channel?.name ??
    (requestBody.surface === "ad"
      ? "광고 성과"
      : requestBody.surface === "campaign"
        ? "캠페인"
        : "Brand Command Center");
  const weekly = requestBody.periodMode !== "monthly";

  return {
    id: `briefing-${Date.now()}`,
    title: `${target} ${weekly ? "주간" : "월간"} AI 보고서`,
    generatedAt: "2026.07.29 11:00",
    periodLabel: weekly ? "2026년 7월 4주차" : "2026년 7월",
    dataSources:
      requestBody.surface === "command"
        ? ["YouTube Analytics API", "Instagram Graph API", "GA4", "Search Console", "파일 업로드 채널"]
        : ["현재 화면 집계", "연결된 게시물 성과", "데이터 상태"],
    dataWarnings: [
      "부분 데이터와 미지원 지표는 N/A 또는 일부 데이터로 표시했습니다.",
      "AI는 화면에 집계된 값만 사용하며 없는 수치를 생성하지 않습니다.",
    ],
    summary:
      requestBody.surface === "ad"
        ? `${target}는 지출, 클릭, CTR, 원본 콘텐츠의 Organic Lift를 함께 봐야 합니다. 현재 목업 API는 실제 광고 ID 연결 전 단계입니다.`
        : requestBody.surface === "campaign"
          ? `${target}은 같은 주제 콘텐츠를 채널별로 묶어 확산, 신뢰, 문의 전환을 나눠 보는 캠페인입니다.`
          : `${target}의 주요 성과는 상승 흐름입니다. 단, 일부 파일 업로드 채널은 갱신 상태를 함께 확인해야 합니다.`,
    wins: [
      "상위 콘텐츠를 다른 채널로 재활용할 수 있는 후보가 확인되었습니다.",
      "검색 가시성과 콘텐츠 소비가 함께 상승했습니다.",
    ],
    risks: [
      "TikTok 평균 시청시간과 일부 LinkedIn 선택 지표는 업로드 파일 상태에 따라 N/A가 될 수 있습니다.",
      "캠페인과 광고는 ID 연결이 없는 레거시 데이터가 있으면 제목 fallback으로만 매칭됩니다.",
    ],
    actions: [
      "성과 상위 Shorts를 Instagram Reels, TikTok, Blog 초안으로 재가공합니다.",
      "지연된 발행 슬롯을 이번 주 캘린더에서 재배치합니다.",
      "광고 종료 임박 건은 CTR과 원본 콘텐츠 Organic Lift를 확인합니다.",
    ],
    evidence: [
      "Website 사용자 10,657 → 12,840 (+20%)",
      "YouTube 조회수 17,640 → 23,100 (+31%)",
      "발행 건강도 82%, 지연 1건",
    ],
  };
}

async function route(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  const data = await loadMockData();
  const contentLab = getContentLabState(data);
  const periodMode = getPeriodMode(url);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, request, 200, {
      ok: true,
      service: "DummDumm Brand OS Mock API",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/dashboard/command-center") {
    sendJson(response, request, 200, buildCommandCenterForPeriod(data, periodMode));
    return;
  }

  if (request.method === "GET" && url.pathname === "/dashboard/channels") {
    sendJson(response, request, 200, buildChannelsForPeriod(data, periodMode));
    return;
  }

  if (request.method === "GET" && url.pathname === "/content-lab") {
    sendJson(response, request, 200, buildContentLabForPeriod(contentLab, periodMode));
    return;
  }

  const pipelineMatch = url.pathname.match(/^\/content-lab\/pipeline\/([^/]+)$/);
  if (pipelineMatch && request.method === "PUT") {
    const card = await readRequestBody(request);
    const nextCard = normalizeContentCard(contentLab, {
      ...card,
      id: decodeURIComponent(pipelineMatch[1]),
    });
    const index = contentLab.pipeline.findIndex((item) => item.id === nextCard.id);
    contentLab.pipeline =
      index >= 0
        ? contentLab.pipeline.map((item) => (item.id === nextCard.id ? nextCard : item))
        : [nextCard, ...contentLab.pipeline];
    sendJson(response, request, 200, buildContentLabForPeriod(contentLab, periodMode));
    return;
  }

  if (pipelineMatch && request.method === "DELETE") {
    const contentId = decodeURIComponent(pipelineMatch[1]);
    contentLab.pipeline = contentLab.pipeline.filter((item) => item.id !== contentId);
    contentLab.campaigns = contentLab.campaigns.map((campaign) => ({
      ...campaign,
      contentIds: campaign.contentIds?.filter((id) => id !== contentId),
    }));
    sendJson(response, request, 200, buildContentLabForPeriod(contentLab, periodMode));
    return;
  }

  const pipelineStatusMatch = url.pathname.match(/^\/content-lab\/pipeline\/([^/]+)\/status$/);
  if (pipelineStatusMatch && request.method === "PATCH") {
    const contentId = decodeURIComponent(pipelineStatusMatch[1]);
    const body = await readRequestBody(request);
    contentLab.pipeline = contentLab.pipeline.map((item) =>
      item.id === contentId ? { ...item, status: body.status ?? item.status } : item,
    );
    sendJson(response, request, 200, buildContentLabForPeriod(contentLab, periodMode));
    return;
  }

  if (request.method === "POST" && url.pathname === "/content-lab/campaigns/generate") {
    const body = await readRequestBody(request);
    const generatedCampaign = buildGeneratedCampaign(contentLab, data, body.sourceContentId);
    if (generatedCampaign) {
      contentLab.campaigns = [generatedCampaign, ...contentLab.campaigns];
    }
    sendJson(response, request, 200, buildContentLabForPeriod(contentLab, periodMode));
    return;
  }

  const adMatch = url.pathname.match(/^\/content-lab\/ads\/([^/]+)$/);
  if (adMatch && request.method === "PUT") {
    const ad = await readRequestBody(request);
    const nextAd = normalizeAd(contentLab, {
      ...ad,
      id: decodeURIComponent(adMatch[1]),
    });
    const index = contentLab.ads.findIndex((item) => item.id === nextAd.id);
    contentLab.ads =
      index >= 0 ? contentLab.ads.map((item) => (item.id === nextAd.id ? nextAd : item)) : [nextAd, ...contentLab.ads];
    sendJson(response, request, 200, buildContentLabForPeriod(contentLab, periodMode));
    return;
  }

  if (adMatch && request.method === "DELETE") {
    const adId = decodeURIComponent(adMatch[1]);
    contentLab.ads = contentLab.ads.filter((ad) => ad.id !== adId);
    sendJson(response, request, 200, buildContentLabForPeriod(contentLab, periodMode));
    return;
  }

  if (request.method === "GET" && url.pathname === "/data-center") {
    sendJson(response, request, 200, buildDataCenterForPeriod(data, periodMode));
    return;
  }

  if (request.method === "GET" && url.pathname === "/analytics/period-comparison") {
    const scope = url.searchParams.get("scope") ?? "all";
    const detail = url.searchParams.get("detail") ?? "채널 기여도";
    const granularity = url.searchParams.get("granularity") ?? "month";
    const baseline = url.searchParams.get("baseline") ?? "2026년 6월 (지난달)";
    sendJson(response, request, 200, data.buildPeriodComparison(scope, detail, baseline, granularity));
    return;
  }

  if (request.method === "POST" && url.pathname === "/ai/briefings") {
    const requestBody = await readRequestBody(request);
    sendJson(response, request, 200, makeBriefing(requestBody, data));
    return;
  }

  if (request.method === "POST" && url.pathname === "/imports") {
    sendJson(response, request, 200, {
      ok: true,
      importId: `import-${Date.now()}`,
      status: "queued",
      detail: "Mock API: 파일 업로드 파이프라인에 등록되었습니다.",
    });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/integrations/")) {
    sendJson(response, request, 200, {
      ok: true,
      connectUrl: "https://example.com/mock-oauth",
      detail: "Mock API: 실제 OAuth 연결 전 테스트 응답입니다.",
    });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/sync/")) {
    sendJson(response, request, 200, {
      ok: true,
      syncId: `sync-${Date.now()}`,
      status: "complete",
      detail: "Mock API: 동기화가 완료된 것으로 처리했습니다.",
    });
    return;
  }

  sendJson(response, request, 404, {
    error: "Not Found",
    path: url.pathname,
  });
}

const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    console.error(error);
    sendJson(response, request, 500, {
      error: "Mock API failed",
      message: error instanceof Error ? error.message : String(error),
    });
  });
});

server.listen(port, host, () => {
  console.log(`DummDumm Brand OS Mock API listening on http://${host}:${port}`);
});
