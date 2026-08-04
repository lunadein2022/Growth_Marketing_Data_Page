import * as XLSX from "xlsx";

// LinkedIn company-page analytics exports (binary .xls) → structured report.
// Three export types, detected by sheet name (filename-independent):
//   content   → sheets "통계"(daily) + "전체 게시물"(per-post)
//   followers → sheet "새 팔로워"(daily new followers)
//   visitors  → sheet "방문자 통계"(daily page views / unique visitors)

export type LinkedinPost = {
  postId: string;
  title: string;
  permalink: string;
  format: string;
  publishedAt: string; // ISO date
  impressions: number;
  views: number;
  clicks: number;
  ctr: number; // fraction
  reactions: number;
  comments: number;
  shares: number;
  engagementRate: number; // fraction
};

export type LinkedinDailyPoint = { date: string; value: number };

export type LinkedinSeriesKey =
  | "impressions"
  | "clicks"
  | "reactions"
  | "new_followers"
  | "page_views"
  | "unique_visitors";

export type LinkedinReport = {
  periodStart: string;
  periodEnd: string;
  posts: LinkedinPost[];
  totals: {
    impressions: number;
    clicks: number;
    reactions: number;
    comments: number;
    shares: number;
    engagementRate: number; // avg fraction
    newFollowers: number;
    pageViews: number;
    uniqueVisitors: number;
  };
  series: Partial<Record<LinkedinSeriesKey, LinkedinDailyPoint[]>>;
  sourceFiles: string[];
  warnings: string[];
};

type Rows = unknown[][];

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

// LinkedIn dates are text "MM/DD/YYYY"; also tolerate Date objects / serials.
function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, month, day, year] = mdy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  return null;
}

async function readWorkbook(file: File): Promise<XLSX.WorkBook | null> {
  try {
    const buffer = await file.arrayBuffer();
    return XLSX.read(buffer, { type: "array" });
  } catch {
    return null;
  }
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string): Rows {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true }) as Rows;
}

function findHeaderRow(rows: Rows, marker: string): number {
  // Some LinkedIn sheets (e.g. 통계) put a description sentence in row 0 that
  // itself contains the marker word ("…날짜: …"), so prefer an exact first-cell
  // match on the real header row and only fall back to a substring match.
  const exact = rows.findIndex((row) => Array.isArray(row) && text(row[0]) === marker);
  if (exact >= 0) return exact;
  return rows.findIndex((row) => Array.isArray(row) && text(row[0]).includes(marker));
}

// Build a name→index lookup from a header row, matching by substring.
function columnLookup(header: unknown[]): (name: string) => number {
  const labels = header.map((cell) => text(cell));
  return (name: string) => labels.findIndex((label) => label === name || label.includes(name));
}

function parseContentSheet(report: LinkedinReport, rows: Rows) {
  const headerRow = findHeaderRow(rows, "날짜");
  if (headerRow < 0) return;
  const col = columnLookup(rows[headerRow]);
  const dateCol = col("날짜");
  // Prefer combined (소셜+스폰서) columns; fall back to social-only.
  const impCol = col("노출(소셜+스폰서)") >= 0 ? col("노출(소셜+스폰서)") : col("노출(소셜)");
  const clickCol = col("클릭(소셜+스폰서)") >= 0 ? col("클릭(소셜+스폰서)") : col("클릭(소셜)");
  const reactCol = col("반응(소셜+스폰서)") >= 0 ? col("반응(소셜+스폰서)") : col("반응(소셜)");

  const impressions: LinkedinDailyPoint[] = [];
  const clicks: LinkedinDailyPoint[] = [];
  const reactions: LinkedinDailyPoint[] = [];

  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const date = toIsoDate(row[dateCol]);
    if (!date) continue;
    if (impCol >= 0) impressions.push({ date, value: num(row[impCol]) });
    if (clickCol >= 0) clicks.push({ date, value: num(row[clickCol]) });
    if (reactCol >= 0) reactions.push({ date, value: num(row[reactCol]) });
  }

  mergeSeriesPoints(report, "impressions", impressions);
  mergeSeriesPoints(report, "clicks", clicks);
  mergeSeriesPoints(report, "reactions", reactions);
}

function parsePostsSheet(report: LinkedinReport, rows: Rows) {
  const headerRow = findHeaderRow(rows, "게시물의 제목");
  if (headerRow < 0) return;
  const col = columnLookup(rows[headerRow]);
  const idx = {
    title: col("게시물의 제목"),
    link: col("게시물 링크"),
    format: col("게시물 형식"),
    created: col("만든 날짜"),
    impressions: col("노출수"),
    views: col("조회수"),
    clicks: col("클릭"),
    ctr: col("클릭률"),
    reactions: col("추천"),
    comments: col("댓글"),
    shares: col("퍼감"),
    engagement: col("참여율"),
    contentType: col("콘텐츠 종류"),
  };

  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const title = text(row[idx.title]);
    const link = text(row[idx.link]);
    if (!title && !link) continue;
    const urn = link.match(/urn:li:activity:(\d+)/)?.[1] ?? link.match(/(\d{10,})/)?.[1] ?? `${i}`;

    report.posts.push({
      postId: urn,
      title: title.split(/\r?\n/)[0]?.slice(0, 200) || `LinkedIn 게시물 ${urn}`,
      permalink: link,
      format: text(row[idx.contentType]) || text(row[idx.format]) || "post",
      publishedAt: toIsoDate(row[idx.created]) ?? report.periodEnd,
      impressions: num(row[idx.impressions]),
      views: num(row[idx.views]),
      clicks: num(row[idx.clicks]),
      ctr: num(row[idx.ctr]),
      reactions: num(row[idx.reactions]),
      comments: num(row[idx.comments]),
      shares: num(row[idx.shares]),
      engagementRate: num(row[idx.engagement]),
    });
  }
}

function parseFollowersSheet(report: LinkedinReport, rows: Rows) {
  const headerRow = findHeaderRow(rows, "날짜");
  if (headerRow < 0) return;
  const col = columnLookup(rows[headerRow]);
  const dateCol = col("날짜");
  const totalCol = col("총 팔로워");
  const points: LinkedinDailyPoint[] = [];
  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const date = toIsoDate(row[dateCol]);
    if (!date) continue;
    points.push({ date, value: num(row[totalCol]) });
  }
  mergeSeriesPoints(report, "new_followers", points);
}

function parseVisitorsSheet(report: LinkedinReport, rows: Rows) {
  const headerRow = findHeaderRow(rows, "날짜");
  if (headerRow < 0) return;
  const col = columnLookup(rows[headerRow]);
  const dateCol = col("날짜");
  const viewsCol = col("전체 페이지 조회(데스크톱+모바일)");
  const uniqueCol = col("전체 페이지 순방문자(데스크톱+모바일)");
  const views: LinkedinDailyPoint[] = [];
  const unique: LinkedinDailyPoint[] = [];
  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const date = toIsoDate(row[dateCol]);
    if (!date) continue;
    if (viewsCol >= 0) views.push({ date, value: num(row[viewsCol]) });
    if (uniqueCol >= 0) unique.push({ date, value: num(row[uniqueCol]) });
  }
  mergeSeriesPoints(report, "page_views", views);
  mergeSeriesPoints(report, "unique_visitors", unique);
}

function sumSeries(points?: LinkedinDailyPoint[]): number {
  return (points ?? []).reduce((total, point) => total + point.value, 0);
}

// Merge daily points across multiple uploaded files, keyed by date. LinkedIn's
// daily value for a given date is absolute, so overlapping exports must NOT be
// summed — later files win per date. Keeps the series sorted by date.
function mergeSeriesPoints(report: LinkedinReport, key: LinkedinSeriesKey, points: LinkedinDailyPoint[]) {
  if (!points.length) return;
  const byDate = new Map<string, LinkedinDailyPoint>();
  for (const point of report.series[key] ?? []) byDate.set(point.date, point);
  for (const point of points) byDate.set(point.date, point);
  report.series[key] = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function looksLikeLinkedin(workbook: XLSX.WorkBook): boolean {
  const names = workbook.SheetNames;
  return names.includes("전체 게시물") || names.includes("새 팔로워") || names.includes("방문자 통계");
}

export async function parseLinkedinFiles(files: File[]): Promise<LinkedinReport | null> {
  const report: LinkedinReport = {
    periodStart: "",
    periodEnd: "",
    posts: [],
    totals: {
      impressions: 0,
      clicks: 0,
      reactions: 0,
      comments: 0,
      shares: 0,
      engagementRate: 0,
      newFollowers: 0,
      pageViews: 0,
      uniqueVisitors: 0,
    },
    series: {},
    sourceFiles: [],
    warnings: [],
  };

  let matched = false;

  for (const file of files) {
    if (!/\.xls$/i.test(file.name)) continue;
    const workbook = await readWorkbook(file);
    if (!workbook || !looksLikeLinkedin(workbook)) continue;
    matched = true;
    report.sourceFiles.push(file.name);

    if (workbook.SheetNames.includes("통계")) parseContentSheet(report, sheetRows(workbook, "통계"));
    if (workbook.SheetNames.includes("전체 게시물")) parsePostsSheet(report, sheetRows(workbook, "전체 게시물"));
    if (workbook.SheetNames.includes("새 팔로워")) parseFollowersSheet(report, sheetRows(workbook, "새 팔로워"));
    if (workbook.SheetNames.includes("방문자 통계")) parseVisitorsSheet(report, sheetRows(workbook, "방문자 통계"));
  }

  if (!matched) return null;

  // Dedupe posts that appear in more than one uploaded content export (later
  // occurrence wins), so overlapping date ranges don't double-count posts.
  if (report.posts.length) {
    const byPostId = new Map<string, LinkedinPost>();
    for (const post of report.posts) byPostId.set(post.postId, post);
    report.posts = Array.from(byPostId.values());
  }

  // Period range from every daily series.
  const allDates = Object.values(report.series)
    .flat()
    .map((point) => point?.date)
    .filter((date): date is string => Boolean(date))
    .sort();
  report.periodStart = allDates[0] ?? "";
  report.periodEnd = allDates[allDates.length - 1] ?? "";

  // Period totals.
  report.totals.impressions = sumSeries(report.series.impressions);
  report.totals.clicks = sumSeries(report.series.clicks);
  report.totals.reactions = sumSeries(report.series.reactions);
  report.totals.newFollowers = sumSeries(report.series.new_followers);
  report.totals.pageViews = sumSeries(report.series.page_views);
  report.totals.uniqueVisitors = sumSeries(report.series.unique_visitors);
  report.totals.comments = report.posts.reduce((total, post) => total + post.comments, 0);
  report.totals.shares = report.posts.reduce((total, post) => total + post.shares, 0);
  report.totals.engagementRate = report.totals.impressions
    ? (report.totals.reactions + report.totals.comments + report.totals.shares + report.totals.clicks) /
      report.totals.impressions
    : 0;

  if (!report.periodStart) report.warnings.push("LinkedIn 파일에서 날짜 범위를 찾지 못했습니다.");
  return report;
}
