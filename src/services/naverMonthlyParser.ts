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
  warnings: string[];
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
  const partialOptional = validationRows
    .filter((row) => row.type === "선택" && row.status === "partial")
    .map((row) => row.label);
  const fileWarnings = parsedFiles.flatMap((file) => file.warnings);

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
    parseWarnings: [
      ...fileWarnings,
      ...(missingRequired.length ? [`필수 지표 미수집: ${missingRequired.join(", ")}`] : []),
      ...(partialOptional.length ? [`선택 파일 데이터 행 없음: ${partialOptional.join(", ")}`] : []),
    ],
  };
}

async function readFileRows(file: File): Promise<ParsedFile> {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const parsed =
    extension === ".xlsx"
      ? { rows: (await readSheet(file)).map((row) => row.map(cellToText)), warnings: [] }
      : extension === ".xls"
        ? await parseLegacyXlsLikeFile(file)
        : { rows: parseDelimited(await file.text(), extension === ".tsv" ? "\t" : ","), warnings: [] };

  return {
    fileName: file.name,
    rows: parsed.rows.filter((row) => row.some(Boolean)),
    flatText: `${file.name} ${parsed.rows.flat().join(" ")}`,
    warnings: parsed.warnings,
  };
}

async function parseLegacyXlsLikeFile(file: File): Promise<{ rows: string[][]; warnings: string[] }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer.slice(0, 8));
  const isOleBinary =
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1;

  if (isOleBinary) {
    return {
      rows: [],
      warnings: [
        `${file.name}은 구형 바이너리 XLS라 브라우저에서 직접 표를 읽지 못했습니다. 파일은 저장했고, XLSX/CSV/TSV 또는 HTML형 XLS는 자동 파싱됩니다.`,
      ],
    };
  }

  const text = decodeSpreadsheetText(buffer);
  const tableRows = parseHtmlOrXmlTable(text);
  if (tableRows.length) return { rows: tableRows, warnings: [] };

  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows = parseDelimited(text, delimiter);
  return {
    rows,
    warnings: rows.length
      ? []
      : [`${file.name}에서 표 데이터를 찾지 못했습니다. 파일은 저장했지만 네이버 지표에는 반영하지 않았습니다.`],
  };
}

function decodeSpreadsheetText(buffer: ArrayBuffer) {
  const utf8 = new TextDecoder("utf-8").decode(buffer);

  try {
    const eucKr = new TextDecoder("euc-kr").decode(buffer);
    return countReplacementChars(eucKr) < countReplacementChars(utf8) ? eucKr : utf8;
  } catch {
    return utf8;
  }
}

function countReplacementChars(value: string) {
  return (value.match(/\uFFFD/g) ?? []).length;
}

function parseHtmlOrXmlTable(text: string) {
  if (/<Workbook|<ss:Workbook|<Worksheet|<Table/i.test(text)) {
    const rows = parseSpreadsheetXmlRows(text);
    if (rows.length) return rows;
  }

  if (!/<table|<tr|<td|<th/i.test(text)) return [];

  const document = new DOMParser().parseFromString(text, "text/html");
  return Array.from(document.querySelectorAll("tr"))
    .map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent?.trim() ?? ""))
    .filter((row) => row.some(Boolean));
}

function parseSpreadsheetXmlRows(text: string) {
  const document = new DOMParser().parseFromString(text, "text/xml");
  const rows = Array.from(document.getElementsByTagName("Row"));

  return rows
    .map((row) =>
      Array.from(row.getElementsByTagName("Cell")).map((cell) => {
        const data = cell.getElementsByTagName("Data")[0];
        return (data?.textContent ?? cell.textContent ?? "").trim();
      }),
    )
    .filter((row) => row.some(Boolean));
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

  if (/20\d{2}[-./년\s]*\d{1,2}[-./월\s]*\d{0,2}/.test(trimmed) && !trimmed.includes("%")) return null;

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
    const detectedFile = rawValue !== null ? found.sourceFileName ?? fileOrRowHas(parsedFiles, def.aliases)?.fileName : undefined;

    return {
      key: def.key,
      label: def.label,
      value: formatMetricValue(rawValue, def.format),
      rawValue,
      delta: rawValue === null ? "미수집" : "파일값",
      note: def.note,
      status: rawValue !== null ? "complete" : "not_uploaded",
      ...(detectedFile ? { sourceFileName: detectedFile } : {}),
    };
  });
}

function buildTrafficSources(parsedFiles: ParsedFile[]): NaverTrafficSource[] {
  const routeShares = new Map<string, number>();

  parsedFiles
    .filter((file) => rowHas([file.fileName, file.flatText], ["유입분석"]))
    .forEach((file) => {
      file.rows.forEach((row) => {
        const route = row[0]?.trim();
        const share = parseNumber(row[1] ?? "", "percent");
        if (
          !route ||
          share === null ||
          rowHas(row, ["유입경로", "상세유입경로", "다운로드 날짜", "데이터 기간", "서비스명", "데이터명", "선택"])
        ) {
          return;
        }
        if (!routeShares.has(route)) routeShares.set(route, share);
      });
    });

  const grouped = trafficDefs.map((def) => ({
    label: def.label,
    share: 0,
    detected: false,
  }));

  routeShares.forEach((share, route) => {
    const group = grouped.find((item) => item.label === getTrafficGroupLabel(route));
    if (!group) return;
    group.share += share;
    group.detected = true;
  });

  return grouped.map((row) => {
    const share = Math.min(100, Math.max(0, Math.round(row.share)));
    return {
      label: row.label,
      value: row.detected ? `${share}%` : "미수집",
      share,
      delta: row.detected ? "파일값" : "미수집",
      status: row.detected ? ("complete" as DataStatus) : ("not_uploaded" as DataStatus),
    };
  });
}

function getTrafficGroupLabel(route: string) {
  const normalizedRoute = route.toLowerCase();
  if (/직접|direct/.test(normalizedRoute)) return "직접 유입";
  if (/검색|google|bing|daum|yahoo/.test(normalizedRoute)) return "검색 유입";
  if (/기타|etc|네이버\s*블로그|naver\s*blog/.test(normalizedRoute)) return "기타";
  return "외부 링크";
}

function findRows(parsedFiles: ParsedFile[], aliases: string[]) {
  return parsedFiles.flatMap((file) => file.rows.filter((row) => rowHas(row, aliases)).map((row) => ({ file, row })));
}

function buildDistributionRows(parsedFiles: ParsedFile[]): NaverDistributionRow[] {
  return parsedFiles
    .flatMap((file) => {
      if (rowHas([file.fileName], ["국가별분포"])) {
        return file.rows.slice(findHeaderIndex(file.rows, ["국가명", "비율"]) + 1).map((row) => ({
          label: row[1] ?? row[0],
          percent: parseNumber(row[3] ?? "", "percent"),
          detail: "국가별 분포",
        }));
      }

      if (rowHas([file.fileName], ["성연령별분포"])) {
        return file.rows.slice(findHeaderIndex(file.rows, ["연령별", "성별", "비율"]) + 1).map((row) => ({
          label: `${row[0] ?? ""} ${row[1] ?? ""}`.trim(),
          percent: parseNumber(row[3] ?? "", "percent"),
          detail: "성/연령별 분포",
        }));
      }

      return [];
    })
    .filter((row) => row.label && row.percent !== null && row.percent > 0)
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
    .map((row) => {
      return {
        label: row.label,
        value: `${Math.round(row.percent ?? 0)}%`,
        detail: row.detail,
      };
    })
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
        .flatMap((file) => {
          const headerIndex = findHeaderIndex(file.rows, ["순위", "제목"]);
          return headerIndex >= 0 ? file.rows.slice(headerIndex + 1).map((row) => ({ file, row })) : [];
        })
        .find(({ row }) => row[1] && row[2]);
      if (!matched) return null;
      const rank = parseNumber(matched.row[0] ?? "");
      const title = matched.row[1] ?? `${def.metric} 파일 연결`;
      const value = parseNumber(matched.row[2] ?? "");
      return {
        metric: def.metric,
        title,
        value: value ? `${rank ? `${formatCount(rank)}위 · ` : ""}${formatCount(value)} ${def.metric.replace(" 순위", "")}` : "파일값 확인 필요",
      };
    })
    .filter((row): row is NaverRankingRow => Boolean(row));
}

function findHeaderIndex(rows: string[][], aliases: string[]) {
  return rows.findIndex((row) => aliases.every((alias) => rowHas(row, [alias])));
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
      const hasDataRows = detected ? hasOptionalDataRows(parsedFiles, def) : false;
      return {
        label: def.label,
        type: "선택" as const,
        status: detected ? (hasDataRows ? ("complete" as DataStatus) : ("partial" as DataStatus)) : ("not_uploaded" as DataStatus),
        ...(detected ? { sourceFileName: detected.fileName } : {}),
      };
    }),
  ];
}

function hasOptionalDataRows(parsedFiles: ParsedFile[], def: { label: string; aliases: string[] }) {
  const candidateFiles = parsedFiles.filter((file) => def.aliases.some((alias) => normalize(file.flatText).includes(normalize(alias))));

  if (def.label.includes("순위")) {
    return candidateFiles.some((file) => {
      const headerIndex = findHeaderIndex(file.rows, ["순위", "제목"]);
      return headerIndex >= 0 && file.rows.slice(headerIndex + 1).some((row) => row[1] && row[2]);
    });
  }

  if (def.label.includes("국가")) {
    return candidateFiles.some((file) => {
      const headerIndex = findHeaderIndex(file.rows, ["국가명", "비율"]);
      return headerIndex >= 0 && file.rows.slice(headerIndex + 1).some((row) => row[1] && row[3]);
    });
  }

  if (def.label.includes("성/연령")) {
    return candidateFiles.some((file) => {
      const headerIndex = findHeaderIndex(file.rows, ["연령별", "성별", "비율"]);
      return headerIndex >= 0 && file.rows.slice(headerIndex + 1).some((row) => row[0] && row[1] && row[3]);
    });
  }

  return Boolean(detectedRows(candidateFiles).length);
}

function detectedRows(files: ParsedFile[]) {
  return files.flatMap((file) => file.rows.filter((row) => row.some(Boolean)));
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
