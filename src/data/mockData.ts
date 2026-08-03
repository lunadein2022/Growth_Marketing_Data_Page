import type {
  AdContent,
  CampaignRow,
  ChannelView,
  ContentItem,
  CommandCenterSnapshot,
  CompareGranularity,
  ContentLabSnapshot,
  DataCenterSnapshot,
  DataSourceState,
  PeriodComparison,
  PeriodMode,
  ChannelId,
} from "../services/adapters/types";

export const channelMeta: Record<Exclude<ChannelId, "all">, { label: string; short: string; color: string }> = {
  youtube: { label: "YouTube", short: "Y", color: "#ef4444" },
  instagram: { label: "Instagram", short: "I", color: "#d83a7c" },
  website: { label: "Website", short: "W", color: "#7c5cff" },
  linkedin: { label: "LinkedIn", short: "L", color: "#2563eb" },
  naver: { label: "Blog", short: "B", color: "#079669" },
  tiktok: { label: "TikTok", short: "T", color: "#10a7a5" },
};

export const commandCenterSnapshot: CommandCenterSnapshot = {
  kpis: [
    {
      label: "브랜드 노출",
      value: "41.8만",
      delta: "+24%",
      tone: "up",
      source: "API + 파일",
      status: "partial",
    },
    {
      label: "콘텐츠 소비",
      value: "68.2만",
      delta: "+18%",
      tone: "up",
      source: "YouTube / Instagram / Website",
      status: "complete",
    },
    {
      label: "검색 가시성",
      value: "12,840",
      delta: "+20%",
      tone: "up",
      source: "GA4 + Search Console",
      status: "complete",
    },
    {
      label: "발행 건강도",
      value: "82%",
      delta: "-3%",
      tone: "down",
      source: "Content Lab",
      status: "complete",
    },
  ],
  trends: [
    { label: "1주", value: 42 },
    { label: "2주", value: 48 },
    { label: "3주", value: 53 },
    { label: "4주", value: 66 },
    { label: "5주", value: 73 },
    { label: "6주", value: 82 },
  ],
  todayAlerts: [
    {
      id: "pub-today-1",
      title: "Hydro Hawk 실증 쇼츠",
      channel: "youtube",
      type: "Shorts",
      date: "2026-07-28",
      time: "12:00",
      status: "today",
    },
    {
      id: "pub-today-2",
      title: "둠둠로그 카드뉴스",
      channel: "instagram",
      type: "Carousel",
      date: "2026-07-28",
      time: "17:00",
      status: "today",
    },
  ],
  publishing: [
    {
      id: "p1",
      title: "Hydro Hawk 실증 쇼츠",
      channel: "youtube",
      type: "Shorts",
      date: "2026-07-28",
      time: "12:00",
      status: "today",
    },
    {
      id: "p2",
      title: "B2B 도입사례 카드",
      channel: "linkedin",
      type: "Card",
      date: "2026-07-29",
      time: "09:00",
      status: "scheduled",
    },
    {
      id: "p3",
      title: "수질관리 블로그",
      channel: "naver",
      type: "Blog",
      date: "2026-07-30",
      time: "10:00",
      status: "scheduled",
    },
    {
      id: "p4",
      title: "둠둠로그 릴스",
      channel: "instagram",
      type: "Reels",
      date: "2026-07-31",
      time: "17:00",
      status: "scheduled",
    },
    {
      id: "p5",
      title: "제품 랜딩 업데이트",
      channel: "website",
      type: "Landing",
      date: "2026-07-24",
      time: "12:00",
      status: "published",
    },
    {
      id: "p6",
      title: "틱톡 현장 숏폼",
      channel: "tiktok",
      type: "Short",
      date: "2026-07-25",
      time: "18:00",
      status: "delayed",
    },
  ],
  channelHighlights: [
    {
      channel: "YouTube",
      summary: "롱폼 시청시간은 유지, Shorts 조회 기여가 상승",
      delta: "+31%",
      status: "complete",
    },
    {
      channel: "Instagram",
      summary: "둠둠로그 저장과 공유가 본계 대비 강세",
      delta: "+18%",
      status: "partial",
    },
    {
      channel: "Website KR/EN",
      summary: "브랜드 키워드 검색 클릭과 직접 유입 동반 상승",
      delta: "+20%",
      status: "complete",
    },
    {
      channel: "LinkedIn / Blog / TikTok",
      summary: "파일 업로드 채널은 일부 기간 데이터만 반영",
      delta: "부분",
      status: "partial",
    },
  ],
};

export const channels: ChannelView[] = [
  {
    id: "youtube",
    name: "YouTube",
    role: "기술과 현장을 깊이 설명",
    objective: "전문성 · 신뢰",
    color: channelMeta.youtube.color,
    updatedAt: "2026.07.28 09:10",
    source: "YouTube Analytics API",
    tabs: ["전체", "쇼츠", "롱폼"],
    kpis: [
      { label: "구독자", value: "18,320명", secondary: "+218명", delta: "+16%", status: "complete" },
      { label: "조회수", value: "23,100", delta: "+31%", status: "complete" },
      { label: "시청시간", value: "1,248h", delta: "+12%", status: "complete" },
      { label: "평균 시청", value: "0:47", delta: "+8%", status: "complete" },
    ],
    trend: [
      { label: "월", value: 26 },
      { label: "화", value: 32 },
      { label: "수", value: 28 },
      { label: "목", value: 47 },
      { label: "금", value: 55 },
      { label: "토", value: 38 },
      { label: "일", value: 42 },
    ],
    topContent: [
      {
        id: "yt-1",
        title: "Hydro Hawk 실증 리뷰",
        channel: "youtube",
        type: "Long-form",
        status: "성과 연결",
        campaign: "Hydro Hawk 실증",
        publishDate: "7/21",
        metricLabel: "조회",
        metricValue: "23,100",
      },
      {
        id: "yt-2",
        title: "수질 채수 현장 30초",
        channel: "youtube",
        type: "Shorts",
        status: "재활용 후보",
        campaign: "Hydro Hawk 실증",
        publishDate: "7/24",
        metricLabel: "조회",
        metricValue: "18,420",
      },
    ],
    dataNote: "Shorts와 롱폼은 조회 기여도와 시청시간 기여도를 분리 표시합니다.",
  },
  {
    id: "instagram",
    name: "Instagram",
    role: "공식 성과와 친근한 기억도 강화",
    objective: "인지도 · 공신력 · 친밀도",
    color: channelMeta.instagram.color,
    updatedAt: "2026.07.28 08:40",
    source: "Instagram Graph API",
    tabs: ["본계", "둠둠로그", "캐러셀", "릴스"],
    kpis: [
      { label: "팔로워", value: "42,180명", secondary: "+484명", delta: "+4%", status: "complete" },
      { label: "도달", value: "31,300", delta: "+18%", status: "partial" },
      { label: "조회", value: "44,900", delta: "+23%", status: "partial" },
      { label: "저장", value: "1,082", delta: "+21%", status: "complete" },
      { label: "공유", value: "624", delta: "+29%", status: "complete" },
    ],
    trend: [
      { label: "월", value: 38 },
      { label: "화", value: 44 },
      { label: "수", value: 42 },
      { label: "목", value: 51 },
      { label: "금", value: 64 },
      { label: "토", value: 59 },
      { label: "일", value: 62 },
    ],
    topContent: [
      {
        id: "ig-1",
        title: "Hydro Hawk 카드뉴스",
        channel: "instagram",
        type: "Carousel",
        status: "저장 강세",
        campaign: "Hydro Hawk 실증",
        publishDate: "7/23",
        metricLabel: "도달",
        metricValue: "12,400",
      },
      {
        id: "ig-2",
        title: "둠둠로그 출장 릴스",
        channel: "instagram",
        type: "Reels",
        status: "공유 강세",
        campaign: "여름 시즌",
        publishDate: "7/25",
        metricLabel: "조회",
        metricValue: "18,900",
      },
    ],
    dataNote: "릴스 일부 지표는 API 응답이 있을 때만 표시하고, 미제공 값은 N/A로 둡니다.",
  },
  {
    id: "website",
    name: "Website KR / EN",
    role: "공식 브랜드 허브",
    objective: "신뢰 · 검색 가시성",
    color: channelMeta.website.color,
    updatedAt: "2026.07.28 09:00",
    source: "GA4 + Search Console API",
    tabs: ["전체", "KR", "EN", "검색"],
    kpis: [
      { label: "사용자", value: "12,840", delta: "+20%", status: "complete" },
      { label: "신규 사용자", value: "9,204", delta: "+22%", status: "complete" },
      { label: "검색 노출", value: "84,200", delta: "+17%", status: "complete" },
      { label: "검색 클릭", value: "3,420", delta: "+14%", status: "complete" },
    ],
    trend: [
      { label: "월", value: 44 },
      { label: "화", value: 49 },
      { label: "수", value: 45 },
      { label: "목", value: 57 },
      { label: "금", value: 61 },
      { label: "토", value: 40 },
      { label: "일", value: 46 },
    ],
    topContent: [
      {
        id: "web-1",
        title: "Hydro Hawk 제품 랜딩",
        channel: "website",
        type: "Landing",
        status: "검색 상승",
        campaign: "Hydro Hawk 실증",
        publishDate: "7/20",
        metricLabel: "문의",
        metricValue: "12",
      },
      {
        id: "web-2",
        title: "영문 회사소개",
        channel: "website",
        type: "EN Page",
        status: "국가 분포 확인",
        publishDate: "7/18",
        metricLabel: "사용자",
        metricValue: "2,410",
      },
    ],
    dataNote: "국문과 영문은 속성 또는 URL 경로 기준으로 분리 집계합니다.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    role: "업계와 공공 분야에 성과 전달",
    objective: "전문성 · 공신력",
    color: channelMeta.linkedin.color,
    updatedAt: "2026.07.26 18:00",
    source: "XLSX 업로드",
    tabs: ["전체", "게시물", "팔로워"],
    kpis: [
      { label: "팔로워", value: "7,694명", secondary: "+86명", delta: "+11%", status: "complete" },
      { label: "노출", value: "7,694", delta: "+12%", status: "partial" },
      { label: "클릭", value: "412", delta: "+9%", status: "partial" },
      { label: "댓글", value: "34", delta: "+4%", status: "complete" },
    ],
    trend: [
      { label: "월", value: 18 },
      { label: "화", value: 20 },
      { label: "수", value: 28 },
      { label: "목", value: 25 },
      { label: "금", value: 32 },
      { label: "토", value: 12 },
      { label: "일", value: 14 },
    ],
    topContent: [
      {
        id: "li-1",
        title: "B2B 도입사례 카드",
        channel: "linkedin",
        type: "Card",
        status: "예약",
        campaign: "Hydro Hawk 실증",
        publishDate: "7/29",
        metricLabel: "예약",
        metricValue: "09:00",
      },
    ],
    dataNote: "필수 4개 지표는 업로드 확인 완료, 선택 지표는 일부 미등록 상태입니다.",
  },
  {
    id: "naver",
    name: "Naver Blog",
    role: "국내 검색 결과에 기술 정보 축적",
    objective: "검색 가시성 · 전문성",
    color: channelMeta.naver.color,
    updatedAt: "2026.07.25 10:30",
    source: "CSV 업로드",
    tabs: ["전체", "필수 지표", "유입분석", "분포·순위"],
    kpis: [
      { label: "조회수", value: "5,400", delta: "+10%", status: "partial" },
      { label: "순방문자수", value: "3,860", delta: "+8%", status: "partial" },
      { label: "방문 횟수", value: "4,920", delta: "+9%", status: "partial" },
      { label: "평균 사용 시간", value: "1:42", delta: "+6%", status: "complete" },
      { label: "재방문율", value: "18%", delta: "+2%", status: "complete" },
    ],
    trend: [
      { label: "월", value: 26 },
      { label: "화", value: 28 },
      { label: "수", value: 30 },
      { label: "목", value: 35 },
      { label: "금", value: 33 },
      { label: "토", value: 21 },
      { label: "일", value: 25 },
    ],
    topContent: [
      {
        id: "nv-1",
        title: "Hydro Hawk 실증 후기",
        channel: "naver",
        type: "Blog",
        status: "검색 누적",
        campaign: "Hydro Hawk 실증",
        publishDate: "7/18",
        metricLabel: "조회",
        metricValue: "5,400",
      },
    ],
    dataNote: "월간 파일 필수 항목은 조회수, 유입분석, 순방문자수, 방문 횟수, 평균 사용 시간, 재방문율입니다.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    role: "회사를 처음 접하는 대중 확대",
    objective: "신규 인지도",
    color: channelMeta.tiktok.color,
    updatedAt: "2026.07.25 18:00",
    source: "TSV 업로드",
    tabs: ["전체", "계정 성과", "영상 성과"],
    kpis: [
      { label: "팔로워", value: "18,320명", secondary: "+484명", delta: "+19%", status: "complete" },
      { label: "조회수", value: "210K", delta: "+38%", status: "partial" },
      { label: "공유", value: "1,240", delta: "+26%", status: "complete" },
      { label: "평균 시청", value: "0:09", delta: "N/A", status: "unavailable" },
    ],
    trend: [
      { label: "월", value: 48 },
      { label: "화", value: 58 },
      { label: "수", value: 46 },
      { label: "목", value: 74 },
      { label: "금", value: 89 },
      { label: "토", value: 67 },
      { label: "일", value: 71 },
    ],
    topContent: [
      {
        id: "tt-1",
        title: "3초 후 Hydro Hawk 숏폼",
        channel: "tiktok",
        type: "Short",
        status: "확산",
        campaign: "Hydro Hawk 실증",
        publishDate: "7/25",
        metricLabel: "조회",
        metricValue: "210K",
      },
    ],
    dataNote: "완주율과 반복 재생은 파일에 없는 경우 생성하지 않습니다.",
  },
];

export const contentLabSnapshot: ContentLabSnapshot = {
  pipeline: [
    {
      id: "pipe-1",
      title: "업계 세미나 카드",
      channel: "linkedin",
      type: "Card",
      status: "아이디어",
      publishDate: "8/2",
      metricLabel: "자동 수집",
      metricValue: "게시물 연결 후",
      draft: "공공기관 담당자가 이해하기 쉬운 실증 도입 배경 카드뉴스 초안",
    },
    {
      id: "pipe-2",
      title: "여름 출장 릴스",
      channel: "instagram",
      type: "Reels",
      status: "초안",
      campaign: "여름 시즌",
      publishDate: "8/4",
      metricLabel: "자동 수집",
      metricValue: "게시물 연결 후",
      draft: "현장 이동 장면과 팀 분위기를 15초 릴스로 편집",
    },
    {
      id: "pipe-3",
      title: "B2B 도입사례 카드",
      channel: "linkedin",
      type: "Card",
      status: "예약",
      campaign: "Hydro Hawk 실증",
      publishDate: "7/29",
      metricLabel: "자동 수집",
      metricValue: "게시물 연결 후",
      draft: "LinkedIn 예약 게시물과 연결 대기",
    },
    {
      id: "pipe-4",
      title: "이벤트 안내 #26",
      channel: "instagram",
      type: "Reels",
      status: "발행됨",
      publishDate: "7/26",
      metricLabel: "도달",
      metricValue: "3,862",
      linkedPostId: "ig_20260726_26",
      linkedPostTitle: "이벤트 안내 #26",
      performanceSource: "Instagram Graph API",
    },
  ],
  publishingRules: [
    { id: "rule-1", label: "유튜브 쇼츠", channel: "youtube", cadence: "매주", days: ["월", "수", "금"], time: "12:00" },
    { id: "rule-2", label: "유튜브 롱폼", channel: "youtube", cadence: "격주", days: ["목"], time: "08:00" },
    { id: "rule-3", label: "인스타(둠둠) 릴스", channel: "instagram", cadence: "매주", days: ["화", "금"], time: "17:00" },
    { id: "rule-4", label: "인스타(둠둠) 캐러셀", channel: "instagram", cadence: "매주", days: ["수"], time: "12:00" },
    { id: "rule-5", label: "인스타(둠둠로그) 릴스", channel: "instagram", cadence: "매주", days: ["월", "목"], time: "19:00" },
    { id: "rule-6", label: "인스타(둠둠로그) 캐러셀", channel: "instagram", cadence: "격주", days: ["금"], time: "13:00" },
    { id: "rule-7", label: "링크드인", channel: "linkedin", cadence: "격주", days: ["화"], time: "09:00" },
    { id: "rule-8", label: "틱톡", channel: "tiktok", cadence: "매주", days: ["월", "목", "금"], time: "18:00" },
    { id: "rule-9", label: "네이버 블로그", channel: "naver", cadence: "매주", days: ["목"], time: "10:00" },
    { id: "rule-10", label: "홈페이지(국문) 업데이트", channel: "website", cadence: "매월", days: ["월"], time: "10:00" },
    { id: "rule-11", label: "홈페이지(영문) 업데이트", channel: "website", cadence: "매월", days: ["월"], time: "11:00" },
  ],
  campaigns: [
    {
      id: "camp-1",
      campaign: "Hydro Hawk 실증",
      objective: "채널별 소재 테스트",
      contentCount: 6,
      linkedPostCount: 5,
      adCount: 2,
      youtube: "23,100 조회",
      tiktok: "210K 조회",
      instagram: "12,400 도달",
      linkedin: "예약",
      naver: "5,400 조회",
      website: "12 문의",
      total: "문의 12 · 소재 6개",
      bestChannel: "TikTok",
    },
    {
      id: "camp-2",
      campaign: "여름 시즌",
      objective: "친밀도 확산",
      contentCount: 3,
      linkedPostCount: 2,
      adCount: 0,
      tiktok: "88,000 조회",
      instagram: "18,900 도달",
      total: "소재 3개",
      bestChannel: "Instagram",
    },
    {
      id: "camp-3",
      campaign: "운영팀 사용법",
      objective: "전문성 강화",
      contentCount: 2,
      linkedPostCount: 1,
      adCount: 0,
      youtube: "9,800 조회",
      linkedin: "예약",
      total: "소재 2개",
      bestChannel: "YouTube",
    },
  ],
  ads: [
    {
      id: "ad-1",
      title: "Hydro Hawk 카드뉴스 광고",
      channel: "instagram",
      campaign: "Hydro Hawk 실증",
      sourceContent: "Hydro Hawk 카드뉴스",
      linkedPostTitle: "Hydro Hawk 카드뉴스",
      performanceSource: "Meta Ads API + Instagram Graph API",
      period: "7/15 - 7/25",
      budget: "500,000원",
      spend: "412,000원",
      impressions: "84,000",
      clicks: "1,240",
      ctr: "1.48%",
      organicLift: "+18%",
      status: "ended",
    },
    {
      id: "ad-2",
      title: "B2B 도입사례 LinkedIn Boost",
      channel: "linkedin",
      campaign: "Hydro Hawk 실증",
      sourceContent: "B2B 도입사례 카드",
      linkedPostTitle: "B2B 도입사례 카드",
      performanceSource: "LinkedIn 업로드 예정",
      period: "7/29 - 8/5",
      budget: "300,000원",
      spend: "0원",
      impressions: "예약",
      clicks: "예약",
      ctr: "예약",
      organicLift: "대기",
      status: "planned",
    },
    {
      id: "ad-3",
      title: "수질 채수 드론 검색 캠페인",
      channel: "website",
      campaign: "검색 가시성",
      sourceContent: "Hydro Hawk 제품 랜딩",
      linkedPostTitle: "Hydro Hawk 제품 랜딩",
      performanceSource: "Google Ads API + GA4",
      period: "7/22 - 8/12",
      budget: "800,000원",
      spend: "266,000원",
      impressions: "31,600",
      clicks: "924",
      ctr: "2.92%",
      organicLift: "+9%",
      status: "active",
    },
  ] satisfies AdContent[],
  archive: [
    {
      id: "arc-1",
      title: "이벤트 안내 #26",
      channel: "instagram",
      type: "Reels",
      status: "발행됨",
      campaign: "여름 시즌",
      publishDate: "7/26",
      metricLabel: "도달",
      metricValue: "3,862",
    },
    {
      id: "arc-2",
      title: "자주 묻는 질문 #25",
      channel: "tiktok",
      type: "Short",
      status: "발행됨",
      publishDate: "6/24",
      metricLabel: "조회",
      metricValue: "3,725",
    },
    {
      id: "arc-3",
      title: "숏폼 클립 #24",
      channel: "youtube",
      type: "Shorts",
      status: "발행됨",
      publishDate: "7/22",
      metricLabel: "조회",
      metricValue: "3,588",
    },
    {
      id: "arc-4",
      title: "업데이트 소식 #23",
      channel: "website",
      type: "Log",
      status: "발행됨",
      publishDate: "6/20",
      metricLabel: "문의",
      metricValue: "3,451",
    },
    {
      id: "arc-5",
      title: "비하인드 컷 #22",
      channel: "naver",
      type: "Blog",
      status: "발행됨",
      publishDate: "7/18",
      metricLabel: "조회",
      metricValue: "3,314",
    },
  ],
};

export const dataCenterSnapshot: DataCenterSnapshot = {
  sources: [
    {
      id: "google-youtube",
      label: "YouTube Analytics",
      kind: "api",
      status: "complete",
      lastSync: "2026.07.28 09:10",
      detail: "본계 채널 · Shorts/롱폼 분리",
    },
    {
      id: "meta-instagram",
      label: "Instagram Graph API",
      kind: "api",
      status: "partial",
      lastSync: "2026.07.28 08:40",
      detail: "본계/둠둠로그 연결 · 릴스 일부 지표 조건부",
    },
    {
      id: "google-website",
      label: "GA4 + Search Console",
      kind: "api",
      status: "complete",
      lastSync: "2026.07.28 09:00",
      detail: "KR/EN 속성 분리",
    },
    {
      id: "linkedin-file",
      label: "LinkedIn 업로드",
      kind: "file",
      status: "partial",
      lastSync: "2026.07.26 18:00",
      detail: "선택 지표 2개 미등록",
    },
    {
      id: "naver-file",
      label: "Naver Blog 업로드",
      kind: "file",
      status: "partial",
      lastSync: "2026.07.25 10:30",
      detail: "월간 필수 지표 파일 반영",
    },
    {
      id: "tiktok-file",
      label: "TikTok 업로드",
      kind: "file",
      status: "partial",
      lastSync: "2026.07.25 18:00",
      detail: "평균 시청시간 미등록",
    },
  ],
  mappingRows: [
    { raw: "조회수", metric: "blog_views", transform: "숫자", platform: "Naver Blog" },
    { raw: "유입분석", metric: "traffic_sources", transform: "유입원별 분해", platform: "Naver Blog" },
    { raw: "순방문자수", metric: "unique_visitors", transform: "숫자", platform: "Naver Blog" },
    { raw: "방문 횟수", metric: "visit_count", transform: "숫자", platform: "Naver Blog" },
    { raw: "평균 사용 시간", metric: "avg_duration_seconds", transform: "시간 → 초", platform: "Naver Blog" },
    { raw: "재방문율", metric: "return_visit_rate", transform: "퍼센트", platform: "Naver Blog" },
    { raw: "신규 팔로워 수", metric: "new_followers", transform: "숫자", platform: "LinkedIn" },
    { raw: "동영상 조회수", metric: "video_views", transform: "숫자", platform: "TikTok" },
  ],
  issues: [
    {
      severity: "warning",
      title: "TikTok 평균 시청시간 미등록",
      detail: "선택 지표이므로 카드에는 N/A로 표시됩니다.",
    },
    {
      severity: "info",
      title: "LinkedIn 참여율 정의 확인 필요",
      detail: "파일 제공 값을 우선하고 시스템 계산은 보류합니다.",
    },
    {
      severity: "warning",
      title: "Instagram 릴스 반복 재생 조건부",
      detail: "API 응답에 값이 있을 때만 노출합니다.",
    },
  ],
};

const channelIds: Array<Exclude<ChannelId, "all">> = ["youtube", "instagram", "website", "linkedin", "naver", "tiktok"];
const typeByChannel: Record<Exclude<ChannelId, "all">, string[]> = {
  youtube: ["Shorts", "Long-form"],
  instagram: ["Carousel", "Reels"],
  website: ["Landing", "KR Page", "EN Page"],
  linkedin: ["Card", "Post"],
  naver: ["Blog", "Traffic"],
  tiktok: ["Short", "Video"],
};
const statusCycle = ["아이디어", "초안", "예약", "발행됨"];
const campaignCycle = ["Hydro Hawk 실증", "여름 시즌", "검색 가시성", "둠둠로그", "운영팀 사용법"];
const topicCycle = [
  "Hydro Hawk 실증",
  "수질 채수 현장",
  "공공기관 도입사례",
  "전시회 회고",
  "인증 성과",
  "팀 문화",
  "기술 Q&A",
  "제품 랜딩",
  "해외 문의",
  "실험 결과",
];

const buildContentUrl = (channel: Exclude<ChannelId, "all">, id: string, title: string) => {
  const q = encodeURIComponent(title);
  const route: Record<Exclude<ChannelId, "all">, string> = {
    youtube: `https://www.youtube.com/results?search_query=${q}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${q}`,
    website: `https://www.google.com/search?q=${q}+DummDumm`,
    linkedin: `https://www.linkedin.com/search/results/content/?keywords=${q}`,
    naver: `https://search.naver.com/search.naver?query=${q}`,
    tiktok: `https://www.tiktok.com/search?q=${q}`,
  };

  return `${route[channel]}&mock_content_id=${encodeURIComponent(id)}`;
};

const makeContent = (
  index: number,
  channel: Exclude<ChannelId, "all">,
  status = statusCycle[index % statusCycle.length],
): ContentItem => {
  const type = typeByChannel[channel][index % typeByChannel[channel].length];
  const title = `${topicCycle[index % topicCycle.length]} #${String(index + 1).padStart(2, "0")}`;
  const isPublished = status === "발행됨";

  return {
    id: `${channel}-content-${index + 1}`,
    title,
    channel,
    type,
    status,
    campaign: campaignCycle[index % campaignCycle.length],
    publishDate: `7/${String((index % 28) + 1).padStart(2, "0")}`,
    metricLabel: channel === "website" ? "문의" : channel === "instagram" ? "도달" : "조회",
    metricValue: channel === "tiktok" ? `${80 + index * 7}K` : `${(2400 + index * 317).toLocaleString("ko-KR")}`,
    draft: `${title} 소재 메모 · 채널별 CTA와 후킹 문구 확인`,
    linkedPostId: isPublished ? `${channel}_post_${index + 1}` : undefined,
    linkedPostTitle: isPublished ? title : undefined,
    performanceSource: isPublished ? `${channelMeta[channel].label} 성과 수집` : undefined,
    externalUrl: buildContentUrl(channel, `${channel}-content-${index + 1}`, title),
  };
};

channels.forEach((channel) => {
  channel.topContent = [
    ...channel.topContent.map((item) => ({
      ...item,
      externalUrl: item.externalUrl ?? buildContentUrl(item.channel, item.id, item.title),
    })),
    ...Array.from({ length: 18 }, (_, index) => makeContent(index + 20, channel.id, "발행됨")),
  ];
});

contentLabSnapshot.pipeline = [
  ...contentLabSnapshot.pipeline.map((item) => ({
    ...item,
    externalUrl: item.externalUrl ?? buildContentUrl(item.channel, item.id, item.title),
  })),
  ...Array.from({ length: 48 }, (_, index) =>
    makeContent(index + 40, channelIds[index % channelIds.length], statusCycle[index % statusCycle.length]),
  ),
];

contentLabSnapshot.archive = [
  ...contentLabSnapshot.archive.map((item) => ({
    ...item,
    externalUrl: item.externalUrl ?? buildContentUrl(item.channel, item.id, item.title),
  })),
  ...Array.from({ length: 42 }, (_, index) =>
    makeContent(index + 90, channelIds[index % channelIds.length], "발행됨"),
  ),
];

contentLabSnapshot.campaigns = [
  ...contentLabSnapshot.campaigns,
  ...Array.from({ length: 24 }, (_, index): CampaignRow => {
    const campaign = `${campaignCycle[index % campaignCycle.length]} 확장 ${index + 1}`;
    const contentCount = 4 + (index % 7);
    const linkedPostCount = Math.max(1, contentCount - (index % 3));
    const adCount = index % 4;

    return {
      id: `camp-extra-${index + 1}`,
      campaign,
      objective: index % 2 === 0 ? "채널별 소재 검증" : "브랜드 목적별 성과 비교",
      contentCount,
      linkedPostCount,
      adCount,
      youtube: index % 2 === 0 ? `${(8200 + index * 410).toLocaleString("ko-KR")} 조회` : undefined,
      tiktok: `${110 + index * 5}K 조회`,
      instagram: `${(6400 + index * 260).toLocaleString("ko-KR")} 도달`,
      linkedin: index % 3 === 0 ? "예약" : `${(1500 + index * 80).toLocaleString("ko-KR")} 노출`,
      naver: `${(2200 + index * 130).toLocaleString("ko-KR")} 조회`,
      website: `${8 + (index % 18)} 문의`,
      total: `소재 ${contentCount}개 · 연결 ${linkedPostCount}개`,
      bestChannel: channelMeta[channelIds[index % channelIds.length]].label,
    };
  }),
];

contentLabSnapshot.ads = [
  ...contentLabSnapshot.ads,
  ...Array.from({ length: 25 }, (_, index): AdContent => {
    const channel = channelIds[index % channelIds.length];
    const status = (["active", "planned", "ended"] as const)[index % 3];
    const title = `${topicCycle[index % topicCycle.length]} 광고 #${index + 1}`;

    return {
      id: `ad-extra-${index + 1}`,
      title,
      channel,
      campaign: campaignCycle[index % campaignCycle.length],
      sourceContent: `${topicCycle[index % topicCycle.length]} 원본 콘텐츠`,
      linkedPostTitle: `${topicCycle[index % topicCycle.length]} 게시물`,
      performanceSource: status === "planned" ? "연결 대기" : `${channelMeta[channel].label} 광고/성과 수집`,
      period: `7/${String((index % 18) + 1).padStart(2, "0")} - 8/${String((index % 12) + 1).padStart(2, "0")}`,
      budget: `${(200000 + index * 45000).toLocaleString("ko-KR")}원`,
      spend: status === "planned" ? "0원" : `${(120000 + index * 31000).toLocaleString("ko-KR")}원`,
      impressions: status === "planned" ? "예약" : `${(18000 + index * 2600).toLocaleString("ko-KR")}`,
      clicks: status === "planned" ? "예약" : `${(220 + index * 47).toLocaleString("ko-KR")}`,
      ctr: status === "planned" ? "예약" : `${(1.1 + (index % 9) * 0.21).toFixed(2)}%`,
      organicLift: status === "planned" ? "대기" : `+${6 + (index % 17)}%`,
      status,
    };
  }),
];

const campaignIdByName = new Map(contentLabSnapshot.campaigns.map((campaign) => [campaign.campaign, campaign.id]));
const attachCampaignId = (item: ContentItem): ContentItem => ({
  ...item,
  campaignId: item.campaignId ?? (item.campaign ? campaignIdByName.get(item.campaign) : undefined),
});

contentLabSnapshot.pipeline = contentLabSnapshot.pipeline.map(attachCampaignId);
contentLabSnapshot.archive = contentLabSnapshot.archive.map(attachCampaignId);

const contentByTitle = new Map(
  [...contentLabSnapshot.pipeline, ...contentLabSnapshot.archive].map((item) => [item.title, item]),
);

contentLabSnapshot.ads = contentLabSnapshot.ads.map((ad) => {
  const source = contentByTitle.get(ad.sourceContent ?? "") ?? contentByTitle.get(ad.linkedPostTitle ?? "");
  return {
    ...ad,
    campaignId: ad.campaignId ?? campaignIdByName.get(ad.campaign),
    sourceContentId: ad.sourceContentId ?? source?.id,
  };
});

dataCenterSnapshot.sources = [
  ...dataCenterSnapshot.sources,
  ...Array.from({ length: 16 }, (_, index): DataSourceState => {
    const channel = channelIds[index % channelIds.length];
    const kind = index % 3 === 0 ? "api" : index % 3 === 1 ? "file" : "manual";
    const status = (["complete", "partial", "not_uploaded", "unavailable"] as const)[index % 4];

    return {
      id: `source-extra-${index + 1}`,
      label: `${channelMeta[channel].label} ${kind.toUpperCase()} 소스 ${index + 1}`,
      kind,
      status,
      lastSync: `2026.07.${String(10 + (index % 18)).padStart(2, "0")} ${String(9 + (index % 8)).padStart(2, "0")}:00`,
      detail:
        status === "complete"
          ? "정상 수집"
          : status === "partial"
            ? "선택 지표 일부 누락"
            : status === "not_uploaded"
              ? "최근 파일 미등록"
              : "플랫폼 미지원 지표 포함",
    };
  }),
];

dataCenterSnapshot.mappingRows = [
  ...dataCenterSnapshot.mappingRows,
  ...Array.from({ length: 26 }, (_, index) => ({
    raw: `원본 열 ${index + 1}`,
    metric: `metric_${String(index + 1).padStart(2, "0")}`,
    transform: index % 4 === 0 ? "숫자" : index % 4 === 1 ? "비율" : index % 4 === 2 ? "시간 → 초" : "문자열",
    platform: channelMeta[channelIds[index % channelIds.length]].label,
  })),
];

dataCenterSnapshot.issues = [
  ...dataCenterSnapshot.issues,
  ...Array.from({ length: 22 }, (_, index): DataCenterSnapshot["issues"][number] => ({
    severity: (["warning", "info", "error"] as const)[index % 3],
    title: `데이터 점검 항목 ${index + 1}`,
    detail:
      index % 3 === 0
        ? "선택 지표가 일부 누락되어 관련 카드는 일부 데이터로 표시됩니다."
        : index % 3 === 1
          ? "업로드 파일의 열 이름 변경 가능성을 확인해야 합니다."
          : "동일 기간 데이터 중복 가능성이 있어 충돌 검토가 필요합니다.",
  })),
];

export function buildPeriodComparison(
  scope: ChannelId,
  detail: string,
  baseline: string,
  granularity: CompareGranularity = "month",
): PeriodComparison {
  const labelMap: Record<ChannelId, string> = {
    all: "전체 브랜드",
    youtube: "YouTube",
    instagram: "Instagram",
    website: "Website",
    linkedin: "LinkedIn",
    naver: "Naver Blog",
    tiktok: "TikTok",
  };

  const baseRows = {
    all: [
      ["YouTube", "17,640 조회", "23,100 조회", "+31%", "complete"],
      ["TikTok", "152K 조회", "210K 조회", "+38%", "partial"],
      ["Instagram", "26,580 도달", "31,300 도달", "+18%", "partial"],
      ["Website", "10,657 사용자", "12,840 사용자", "+20%", "complete"],
      ["LinkedIn", "6,820 노출", "7,694 노출", "+13%", "partial"],
      ["Naver Blog", "4,910 조회", "5,400 조회", "+10%", "partial"],
    ],
    youtube: [
      ["조회수", "17,640", "23,100", "+31%", "complete"],
      ["시청시간", "1,112h", "1,248h", "+12%", "complete"],
      ["구독자 증가", "188", "218", "+16%", "complete"],
      ["공유", "316", "402", "+27%", "complete"],
    ],
    instagram: [
      ["도달", "26,580", "31,300", "+18%", "partial"],
      ["조회", "36,500", "44,900", "+23%", "partial"],
      ["저장", "894", "1,082", "+21%", "complete"],
      ["공유", "484", "624", "+29%", "complete"],
    ],
    website: [
      ["사용자", "10,657", "12,840", "+20%", "complete"],
      ["신규 사용자", "7,540", "9,204", "+22%", "complete"],
      ["검색 클릭", "3,005", "3,420", "+14%", "complete"],
      ["문의", "28", "34", "+21%", "complete"],
    ],
    linkedin: [
      ["노출", "6,820", "7,694", "+13%", "partial"],
      ["클릭", "374", "412", "+10%", "partial"],
      ["댓글", "32", "34", "+6%", "complete"],
      ["신규 팔로워", "77", "86", "+12%", "complete"],
    ],
    naver: [
      ["조회수", "4,910", "5,400", "+10%", "partial"],
      ["순방문자수", "3,560", "3,860", "+8%", "partial"],
      ["방문 횟수", "4,510", "4,920", "+9%", "partial"],
      ["평균 사용 시간", "1:36", "1:42", "+6%", "complete"],
      ["재방문율", "17.6%", "18.0%", "+2%", "complete"],
    ],
    tiktok: [
      ["조회수", "152K", "210K", "+38%", "partial"],
      ["공유", "984", "1,240", "+26%", "complete"],
      ["팔로워 증가", "406", "484", "+19%", "complete"],
      ["평균 시청시간", "N/A", "N/A", "N/A", "unavailable"],
    ],
  } as const;

  const rows = baseRows[scope].map(([metric, previous, current, growth, status]) => ({
    metric,
    previous,
    current,
    growth,
    status,
  }));

  const mainGrowth = rows.find((row) => row.growth !== "N/A")?.growth ?? "변화 없음";
  const currentLabel =
    granularity === "week" ? "2026년 7월 4주차" : granularity === "month" ? "2026년 7월" : "2026년 누적";
  const summary =
    scope === "all"
      ? `전체 브랜드 기준으로 이번 기간의 성장은 단일 합산값이 아니라 채널별 기여도로 비교합니다. 가장 큰 변화는 ${mainGrowth}입니다.`
      : `${labelMap[scope]} ${detail} 기준으로 핵심 지표가 ${baseline} 대비 ${mainGrowth} 변화했습니다.`;

  return {
    scope,
    detail,
    baseline,
    currentLabel,
    summary,
    rows,
    dataNote:
      scope === "all"
        ? "전체 탭은 서로 다른 플랫폼 지표를 억지로 합산하지 않고, 채널별 대표 지표의 변화와 데이터 상태를 비교합니다."
        : "부분 데이터와 미지원 지표는 비교 계산에서 제외하고 상태를 함께 표시합니다.",
  };
}
