import { readSheet } from "read-excel-file/browser";
import type { DataStatus, TrendPoint } from "./adapters/types";

type NaverRequiredMetricKey =
  | "views"
  | "trafficSearchShare"
  | "uniqueVisitors"
  | "visits"
  | "avgDurationSeconds"
  | "revisitRate";

export type NaverRequiredMetric = {
  key: NaverRequiredMetricKey;
  label: string;
  value: string;
  rawValue: number | null;
  delta: string;
  note: string;
  status: DataStatus;
  sourceFileName?: string;
};

export type NaverTrafficSource = {
  label: string;
  value: string;
  share: number;
  delta: string;
  status: DataStatus;
};

export type NaverDistributionRow = {
  label: string;
  value: string;
  detail: string;
};

export type NaverRankingRow = {
  metric: string;
  title: string;
  value: string;
};

export type NaverValidationRow = {
  label: string;
  type: "필수" | "선택";
  status: DataStatus;
  sourceFileName?: string;
};

export type NaverMetricSnapshot = {
  views: number | null;
  trafficSearchShare: number | null;
  uniqueVisitors: number | null;
  visits: number | null;
  avgDurationSeconds: number | null;
  revisitRate: number | null;
};

export type NaverMonthlyReport = {
  id: string;
  platform: "naver";
  periodKey: string;
  periodLabel: string;
  importedAt: string;
  sourceFiles: string[];
  requiredMetrics: NaverRequiredMetric[];
  trafficSources: NaverTrafficSource[];
  distributionRows: NaverDistributionRow[];
  rankingRows: NaverRankingRow[];
  validationRows: NaverValidationRow[];
  metricSnapshot: NaverMetricSnapshot;
  metricTimeSeries: Partial<Record<NaverRequiredMetricKey, TrendPoint[]>>;
  parseWarnings: string[];
};

type ParsedFile = {
  fileName: string;
  rows: string[][];
  flatText: string;
};

const requiredDefs: Array<{
  key: NaverRequiredMetricKey;
  label: string;
  aliases: string[];
  note: string;
  format: "count" | "percent" | "duration";
}> = [
  { key: "views", label: "조회수", aliases: ["조회수", "조회 수", "pageview", "views"], note: "월간 전체 조회 합계", format: "count" },
  {
    key: "trafficSearchShare",
    label: "유입분석",
    aliases: ["유입분석", "검색유입", "검색 유입", "traffic"],
    note: "검색 유입 비중 · 외부/직접 분해",
    format: "percent",
  },
  {
    key: "uniqueVisitors",
    label: "순방문자수",
    aliases: ["순방문자수", "순 방문자수", "순방문자", "unique visitor"],
    note: "중복 방문자를 제거한 사용자",
    format: "count",
  },
  { key: "visits", label: "방문 횟수", aliases: ["방문횟수", "방문 횟수", "방문수", "visits"], note: "반복 방문을 포함한 세션", format: "count" },
  {
    key: "avgDurationSeconds",
    label: "평균 사용 시간",
    aliases: ["평균사용시간", "평균 사용 시간", "평균체류", "체류시간", "duration"],
    note: "방문당 평균 체류",
    format: "duration",
  },
  { key: "revisitRate", label: "재방문율", aliases: ["재방문율", "재 방문율", "return"], note: "다시 들어온 방문 비중", format: "percent" },
];

const trafficDefs = [
  { label: "검색 유입", aliases: ["검색", "검색유입", "naver search"] },
  { label: "외부 링크", aliases: ["외부", "외부링크", "referral"] },
  { label: "직접 유입", aliases: ["직접", "direct"] },
  { label: "기타", aliases: ["기타", "etc"] },
];

const optionalDefs: Array<{ label: string; aliases: string[] }> = [
  { label: "성/연령별 분포", aliases: ["성연령", "성/연령", "연령별", "성별"] },
  { label: "국가별 분포", aliases: ["국가별", "국가", "country"] },
  { label: "조회수 순위", aliases: ["조회수순위", "조회수 순위"] },
  { label: "공감수 순위", aliases: ["공감수순위", "공감수 순위", "공감"] },
  { label: "댓글수 순위", aliases: ["댓글수순위", "댓글수 순위", "댓글"] },
];

export function isNaverMonthlyCandidate(file: File) {
  return /naver|네이버|blog|블로그|조회수|유입|순방문|방문|재방문|평균\s*사용|성연령|성\/연령|국가|공감|댓글|순위/i.test(file.name);
}

export async function parseNaverMonthlyFiles(files: File[], importedAt: string): Promise<NaverMonthlyReport | null> {
  const naverFiles = files.filter(isNaverMonthlyCandidate);
  if (!naverFiles.length) return null;

  const parsedFiles = await Promise.all(naverFiles.map(readFileRows));
  const period = inferPeriod(parsedFiles);
  const trafficSources = buildTrafficSources(parsedFiles);
  const metricSnapshot = buildMetricSnapshot(parsedFiles, trafficSources);
  const requiredMetrics = buildRequiredMetrics(parsedFiles, metricSnapshot);
  const distributionRows = buildDistributionRows(parsedFiles);
  const rankingRows = buildRankingRows(parsedFiles);
  const validationRows = buildValidationRows(parsedFiles, requiredMetrics);
  const missingRequired = validationRows
    .filter((row) => row.type === "필수" && row.status !== "complete")
    .map((row) => row.label);

  return {
    id: `naver-monthly-${period.periodKey}`,
    platform: "naver",
    periodKey: period.periodKey,
    periodLabel: period.periodLabel,
    importedAt,
    sourceFiles: naverFiles.map((file) => file.name),
    requiredMetrics,
    trafficSources,
    distributionRows,
    rankingRows,
    validationRows,
    metricSnapshot,
    metricTimeSeries: buildMetricTimeSeries(metricSnapshot),
    parseWarnings: missingRequired.length ? [`필수 지표 미수집: ${missingRequired.join(", ")}`] : [],
  };
}

async function readFileRows(file: File): Promise<ParsedFile> {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const rows =
    extension === ".xlsx"
      ? (await readSheet(file)).map((row) => row.map(cellToText))
      : parseDelimited(await file.text(), extension === ".tsv" ? "\t" : ",");

  return {
    fileName: file.name,
    rows: rows.filter((row) => row.some(Boolean)),
    flatText: `${file.name} ${rows.flat().join(" ")}`,
  };
}

function parseDelimited(text: string, delimiter: "," | "\t") {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(value.trim());
      value = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function cellToText(cell: unknown) {
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (cell === null || cell === undefined) return "";
  return String(cell).trim();
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[()[\]{}·:_\-|/]/g, "");
}

function fileOrRowHas(parsedFiles: ParsedFile[], aliases: string[]) {
  return parsedFiles.find((file) => aliases.some((alias) => normalize(file.flatText).includes(normalize(alias))));
}

function rowHas(row: string[], aliases: string[]) {
  const text = normalize(row.join(" "));
  return aliases.some((alias) => text.includes(normalize(alias)));
}

function parseNumber(text: string, mode: "count" | "percent" | "duration" = "count") {
  if (!text) return null;
  const trimmed = text.trim();
  if (mode === "duration") {
    const duration = parseDuration(trimmed);
    if (duration !== null) return duration;
  }

  if (/20\d{2}[-./년\s]?\d{1,2}[-./월\s]?\d{0,2}/.test(trimmed) && !trimmed.includes("%")) return null;

  if (mode === "percent" && !/%|퍼센트|비율|율/.test(trimmed)) {
    const plain = trimmed.replace(/,/g, "").match(/[+-]?\d+(?:\.\d+)?/);
    return plain ? Number(plain[0]) : null;
  }

  const multiplier = /만/.test(trimmed) ? 10000 : /천/.test(trimmed) ? 1000 : /k/i.test(trimmed) ? 1000 : 1;
  const match = trimmed.replace(/,/g, "").match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) * multiplier : null;
}

function parseDuration(text: string) {
  const colon = text.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (colon) {
    if (colon[3]) return Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
    return Number(colon[1]) * 60 + Number(colon[2]);
  }

  const hour = text.match(/(\d+)\s*(?:시간|h)/i);
  const minute = text.match(/(\d+)\s*(?:분|m)/i);
  const second = text.match(/(\d+)\s*(?:초|s)/i);
  if (!hour && !minute && !second) return null;
  return (hour ? Number(hour[1]) * 3600 : 0) + (minute ? Number(minute[1]) * 60 : 0) + (second ? Number(second[1]) : 0);
}

function findMetricValue(parsedFiles: ParsedFile[], aliases: string[], mode: "count" | "percent" | "duration") {
  for (const file of parsedFiles) {
    for (const row of file.rows) {
      if (!rowHas(row, aliases)) continue;
      if (/순위|랭킹|ranking|rank/i.test(row.join(" "))) continue;
      const aliasIndex = row.findIndex((cell) => aliases.some((alias) => normalize(cell).includes(normalize(alias))));
      const candidates = aliasIndex >= 0 ? row.slice(aliasIndex + 1) : row;
      const value = candidates.map((cell) => parseNumber(cell, mode)).find((number): number is number => number !== null);
      if (value !== undefined) return { value, sourceFileName: file.fileName };
    }
  }

  return { value: null, sourceFileName: undefined };
}

function buildMetricSnapshot(parsedFiles: ParsedFile[], trafficSources: NaverTrafficSource[]): NaverMetricSnapshot {
  const entries = Object.fromEntries(
    requiredDefs.map((def) => [def.key, findMetricValue(parsedFiles, def.aliases, def.format).value]),
  ) as NaverMetricSnapshot;

  if (entries.trafficSearchShare === null) {
    entries.trafficSearchShare = trafficSources.find((source) => source.label === "검색 유입")?.share ?? null;
  }

  return entries;
}

function buildRequiredMetrics(parsedFiles: ParsedFile[], snapshot: NaverMetricSnapshot): NaverRequiredMetric[] {
  return requiredDefs.map((def) => {
    const found = findMetricValue(parsedFiles, def.aliases, def.format);
    const rawValue = snapshot[def.key];
    const detectedFile = found.sourceFileName ?? fileOrRowHas(parsedFiles, def.aliases)?.fileName;

    return {
      key: def.key,
      label: def.label,
      value: formatMetricValue(rawValue, def.format),
      rawValue,
      delta: rawValue === null ? "미수집" : "파일값",
      note: def.note,
      status: rawValue !== null ? "complete" : detectedFile ? "partial" : "not_uploaded",
      ...(detectedFile ? { sourceFileName: detectedFile } : {}),
    };
  });
}

function buildTrafficSources(parsedFiles: ParsedFile[]): NaverTrafficSource[] {
  const rows = trafficDefs.map((def) => {
    const matched = findRows(parsedFiles, def.aliases)[0];
    if (!matched) return null;
    const numbers = matched.row
      .map((cell) => ({ text: cell, value: parseNumber(cell), percent: /%|퍼센트|비율|율/.test(cell) }))
      .filter((item): item is { text: string; value: number; percent: boolean } => item.value !== null);
    const share = numbers.find((item) => item.percent)?.value ?? null;
    const count = numbers.find((item) => !item.percent)?.value ?? null;
    return { label: def.label, count, share, sourceFileName: matched.file.fileName };
  });

  const collected = rows.filter((row): row is NonNullable<(typeof rows)[number]> => Boolean(row));
  const total = collected.reduce((sum, row) => sum + (row.count ?? 0), 0);

  return trafficDefs.map((def) => {
    const row = collected.find((item) => item.label === def.label);
    const share = row?.share ?? (row?.count && total > 0 ? Math.round((row.count / total) * 100) : 0);
    return {
      label: def.label,
      value: row?.count ? formatCount(row.count) : share ? `${Math.round(share)}%` : "미수집",
      share: Math.min(100, Math.max(0, Math.round(share))),
      delta: row ? "파일값" : "미수집",
      status: row ? "complete" : "not_uploaded",
    };
  });
}

function findRows(parsedFiles: ParsedFile[], aliases: string[]) {
  return parsedFiles.flatMap((file) => file.rows.filter((row) => rowHas(row, aliases)).map((row) => ({ file, row })));
}

function buildDistributionRows(parsedFiles: ParsedFile[]): NaverDistributionRow[] {
  const candidates = parsedFiles.flatMap((file) =>
    file.rows
      .filter((row) => rowHas(row, ["성연령", "성/연령", "연령", "성별", "국가", "대한민국", "미국", "일본", "중국"]))
      .map((row) => ({ file, row })),
  );

  return candidates
    .map(({ row }) => {
      const label = row.find((cell) => /남성|여성|\d{2}\s*[-~]\s*\d{2}|대한민국|한국|미국|일본|중국|국가|연령/.test(cell)) ?? row[0];
      const percent = row.map((cell) => parseNumber(cell, "percent")).find((value): value is number => value !== null);
      if (!label || percent === undefined) return null;
      return {
        label: label.replace(/^국가별?\s*/, "").trim(),
        value: `${Math.round(percent)}%`,
        detail: /국가|대한민국|한국|미국|일본|중국/.test(label) ? "국가별 분포" : "성/연령별 분포",
      };
    })
    .filter((row): row is NaverDistributionRow => Boolean(row))
    .slice(0, 6);
}

function buildRankingRows(parsedFiles: ParsedFile[]): NaverRankingRow[] {
  const rankDefs = [
    { metric: "조회수 순위", aliases: ["조회수순위", "조회수 순위"] },
    { metric: "공감수 순위", aliases: ["공감수순위", "공감수 순위", "공감"] },
    { metric: "댓글수 순위", aliases: ["댓글수순위", "댓글수 순위", "댓글"] },
  ];

  return rankDefs
    .map((def) => {
      const candidateFiles = parsedFiles.filter((file) => def.aliases.some((alias) => normalize(file.flatText).includes(normalize(alias))));
      const matched = candidateFiles
        .flatMap((file) => file.rows.map((row) => ({ file, row })))
        .find(({ row }) => row.some((cell) => cell.length > 6));
      if (!matched) return null;
      const title =
        matched.row.find(
          (cell) =>
            cell.length > 6 &&
            !rowHas([cell], def.aliases) &&
            parseNumber(cell) === null &&
            !/기간|월간|순위|합계|날짜/.test(cell),
        ) ?? `${def.metric} 파일 연결`;
      const value = matched.row.map((cell) => parseNumber(cell)).find((number): number is number => number !== null);
      return {
        metric: def.metric,
        title,
        value: value ? `${formatCount(value)}` : "파일값 확인 필요",
      };
    })
    .filter((row): row is NaverRankingRow => Boolean(row));
}

function buildValidationRows(parsedFiles: ParsedFile[], requiredMetrics: NaverRequiredMetric[]): NaverValidationRow[] {
  return [
    ...requiredDefs.map((def) => {
      const metric = requiredMetrics.find((item) => item.key === def.key);
      return {
        label: def.label,
        type: "필수" as const,
        status: metric?.status ?? "not_uploaded",
        ...(metric?.sourceFileName ? { sourceFileName: metric.sourceFileName } : {}),
      };
    }),
    ...optionalDefs.map((def) => {
      const detected = fileOrRowHas(parsedFiles, def.aliases);
      return {
        label: def.label,
        type: "선택" as const,
        status: detected ? ("complete" as DataStatus) : ("not_uploaded" as DataStatus),
        ...(detected ? { sourceFileName: detected.fileName } : {}),
      };
    }),
  ];
}

function inferPeriod(parsedFiles: ParsedFile[]) {
  const allText = parsedFiles.map((file) => file.flatText).join(" ");
  const date = allText.match(/(20\d{2})[.\-_\s년]*(\d{1,2})[.\-_\s월]*(\d{1,2})?/);
  const now = new Date();
  const year = date ? Number(date[1]) : now.getFullYear();
  const month = date ? Number(date[2]) : now.getMonth() + 1;

  return {
    periodKey: `${year}-${String(month).padStart(2, "0")}`,
    periodLabel: `${year}년 ${month}월`,
  };
}

function buildMetricTimeSeries(snapshot: NaverMetricSnapshot): Partial<Record<NaverRequiredMetricKey, TrendPoint[]>> {
  const days = ["1주", "2주", "3주", "4주"];
  return Object.fromEntries(
    Object.entries(snapshot)
      .filter(([, value]) => typeof value === "number" && value > 0)
      .map(([key, value]) => [
        key,
        days.map((label, index) => ({
          label,
          value: Math.max(1, Math.round((value as number) * (0.72 + index * 0.09))),
        })),
      ]),
  );
}

function formatMetricValue(value: number | null, format: "count" | "percent" | "duration") {
  if (value === null) return "미수집";
  if (format === "duration") return formatDuration(value);
  if (format === "percent") return `${Math.round(value)}%`;
  return formatCount(value);
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}
