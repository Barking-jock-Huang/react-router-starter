// toolbelt/index.ts
import express from "express";
import { load } from "cheerio";
import type { Browser, BrowserContext, Page } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process"; // for git use
import { createHash } from "node:crypto";

const app = express();
const PORT = 43210;
const HOST = "127.0.0.1";
const TOOLBELT_KEY = Math.random().toString(36).slice(2);
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.FRONT_URL ||
  process.env.PUBLIC_FRONTEND_URL ||
  "";
const FRONTEND_API_BASE = process.env.FRONTEND_API_BASE || FRONTEND_URL || "";

function runCmd(cmd: string, args: string[] = []) {
  const result = spawnSync(cmd, args, {
    cwd: REPO,
    shell: false,          // for git use
    encoding: "utf8",
    timeout: 120_000,
  });
  const errorMessage = result.error ? `${result.error.name}: ${result.error.message}` : "";
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: [result.stderr ?? "", errorMessage].filter(Boolean).join("\n"),
  };
}


app.use(express.json({ limit: "2mb" }));

// CORS（本機開發）
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-toolbelt-key");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const KKTIX_BASE = "https://kktix.com/events";
const KKTIX_DIRECTORY_BASE = "https://dir.registrano.com/events";
const KKTIX_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const KKTIX_SOURCE = "kktix";
const KKTIX_MAX_PAGES = 20;
const KKTIX_MUSIC_TAG_IDS = ["13", "1", "6", "7", "9", "29"];
const INDIEVOX_BASE = "https://www.indievox.com";
const INDIEVOX_SOURCE = "indievox";
const INDIEVOX_MAX_PAGES = 10;
const MAX_PAGES_LIMIT = 50;
const CONCERT_INTEL_PHASE1_MAX_PAGES = 5;
const CONCERT_INTEL_PHASE1_MAX_DETAIL_PAGES = 100;
const CONCERT_INTEL_SOURCE_CONCURRENCY = 5;
const MAX_DETAIL_PAGES_LIMIT = 300;
const CONCERT_SOURCES = [KKTIX_SOURCE, INDIEVOX_SOURCE] as const;
const CONCERT_INTEL_SOURCE_CONFIGS = [
  {
    source: "kktix",
    sourceKind: "ticket_platform",
    listUrl: KKTIX_BASE,
    include: ["/events/"],
  },
  {
    source: "indievox",
    sourceKind: "ticket_platform",
    listUrl: `${INDIEVOX_BASE}/activity`,
    include: ["/activity/detail/"],
  },
  {
    source: "tixcraft",
    sourceKind: "ticket_platform",
    listUrl: "https://tixcraft.com/activity",
    include: ["/activity/detail/"],
  },
  {
    source: "ticketplus",
    sourceKind: "ticket_platform",
    listUrl: "https://ticketplus.com.tw/activity",
    include: ["/activity/"],
  },
  {
    source: "kham",
    sourceKind: "ticket_platform",
    listUrl: "https://kham.com.tw/",
    include: ["/application/UTK02/UTK0201_.aspx?PRODUCT_ID="],
  },
  {
    source: "opentix",
    sourceKind: "ticket_platform",
    listUrl: "https://www.opentix.life/event",
    include: ["/event/"],
  },
  {
    source: "livenation_tw",
    sourceKind: "organizer_announcement",
    listUrl: "https://www.livenation.com.tw/event/allevents",
    include: ["/event/"],
  },
  {
    source: "legacy",
    sourceKind: "organizer_announcement",
    listUrl: "https://www.legacy.com.tw/",
    include: ["/article/"],
  },
] as const;

const LEGACY_TOPIC_URLS = [
  "https://www.legacy.com.tw/page/topic/taipei/",
  "https://www.legacy.com.tw/page/topic/taichung/",
  "https://www.legacy.com.tw/page/topic/max/",
  "https://www.legacy.com.tw/page/topic/mini/",
  "https://www.legacy.com.tw/page/topic/great/",
] as const;

const KHAM_MUSIC_CATEGORY_URLS = [
  "https://kham.com.tw/application/UTK01/UTK0101_06.aspx?TYPE=1&CATEGORY=205",
  "https://kham.com.tw/application/UTK01/UTK0101_06.aspx?TYPE=1&CATEGORY=77",
] as const;

type DiscoveredLink = {
  url: string;
  title: string;
  event_at?: string | null;
};

type ConcertSource = (typeof CONCERT_SOURCES)[number];
type ConcertIntelSource = (typeof CONCERT_INTEL_SOURCE_CONFIGS)[number]["source"];
type ConcertEventInput = {
  source: string;
  source_id: string;
  title: string;
  event_at: string;
  url: string;
  venue?: string | null;
  city?: string | null;
  organizer?: string | null;
  display_category?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  event_count?: number | null;
  extracted_text?: string;
  raw_excerpt?: string;
};

type ConcertIntelCandidateInput = {
  source: string;
  source_id: string;
  source_kind: string;
  title: string;
  url: string;
  event_at?: string | null;
  venue?: string | null;
  city?: string | null;
  organizer?: string | null;
  extracted_text: string;
  raw_excerpt: string;
  evidence_json?: string;
  source_payload_json?: string;
  content_hash?: string;
  parser_version?: string;
  status: "pending" | "error";
  confidence: number;
  error_message?: string;
  crawled_at: string;
};

type SourceResult = {
  source: ConcertSource;
  total: number;
  pagesFetched?: number;
  error?: string;
};

type ScrapeResult = {
  events: ConcertEventInput[];
  pagesFetched: number;
};

type IntelSourceResult = {
  source: ConcertIntelSource;
  total: number;
  discoveredCount?: number;
  pagesFetched?: number;
  skippedKnown?: number;
  filteredOutOfRange?: number;
  error?: string;
};
const decodeHtmlEntities = (value: string) =>
  value.replace(/&(#\d+|#x[0-9a-fA-F]+|quot|amp|lt|gt|apos);/g, (full, entity) => {
    switch (entity) {
      case "quot":
        return "\"";
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "apos":
        return "'";
      default:
        break;
    }

    if (entity.startsWith("#x")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(code) ? full : String.fromCharCode(code);
    }

    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? full : String.fromCharCode(code);
    }

    return full;
  });

const stripHtml = (value: string) => collapseText(load(`<main>${value}</main>`)("main").text());

const parseKktixPayload = (html: string) => {
  const doubleMatch = html.match(/data-react-props="([^"]+)"/);
  const singleMatch = html.match(/data-react-props='([^']+)'/);
  const raw = doubleMatch?.[1] ?? singleMatch?.[1];
  if (!raw) return null;

  const decoded = decodeHtmlEntities(raw);
  try {
    return JSON.parse(decoded) as { data?: any[] };
  } catch {
    return null;
  }
};

const toIsoFromEpoch = (value: number) => new Date(value * 1000).toISOString();

const kktixSaleText = (row: any) => {
  const firstSaleAt =
    typeof row?.first_sale_at === "number"
      ? row.first_sale_at
      : Number.parseInt(String(row?.first_sale_at ?? ""), 10);
  if (Number.isFinite(firstSaleAt)) {
    return `first_sale_at: ${toIsoFromEpoch(firstSaleAt)}`;
  }
  const status = typeof row?.register_status === "string" ? row.register_status : "";
  return status ? `register_status: ${status}` : "";
};

const parseKktixEvents = (html: string): ConcertEventInput[] => {
  const payload = parseKktixPayload(html);
  const rows = Array.isArray(payload?.data) ? payload?.data : [];
  const events: ConcertEventInput[] = [];

  for (const row of rows) {
    const title = typeof row?.name === "string" ? row.name.trim() : "";
    const url = typeof row?.public_url === "string" ? row.public_url.trim() : "";
    if (!title || !url) continue;

    let sourceId = typeof row?.slug === "string" ? row.slug.trim() : "";
    if (!sourceId) {
      sourceId = url.split("/").filter(Boolean).pop() ?? "";
    }

    const startAt =
      typeof row?.start_at === "number" ? row.start_at : Number.parseInt(String(row?.start_at ?? ""), 10);
    if (!sourceId || Number.isNaN(startAt)) continue;
    const category = typeof row?.category_name === "string" ? row.category_name.trim() : "";
    const summary = typeof row?.description_summary === "string" ? stripHtml(row.description_summary) : "";
    const saleText = kktixSaleText(row);
    const extractedText = collapseText(
      [
        category ? `category: ${category}` : "",
        `title: ${title}`,
        `event_at: ${toIsoFromEpoch(startAt)}`,
        saleText,
        summary ? `summary: ${summary}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    events.push({
      source: KKTIX_SOURCE,
      source_id: sourceId,
      title,
      event_at: toIsoFromEpoch(startAt),
      url,
      extracted_text: extractedText,
      raw_excerpt: extractedText.slice(0, 4000),
    });
  }

  if (events.length === 0) {
    const $ = load(html);
    $("a[href*='.kktix.cc/events/'], a[href*='kktix.com/events/']").each((_, element) => {
      const link = $(element).attr("href")?.trim() ?? "";
      if (!link) return;
      const url = new URL(link, KKTIX_BASE).toString();
      const parsed = new URL(url);
      const sourceId = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
      const text = collapseText($(element).text());
      const eventAt = inferEventDate(text);
      if (!sourceId || !eventAt) return;
      const title = text
        .replace(/^.*?(演出|音樂|音樂會|藝人見面會|電音派對|其他|學習)/, "")
        .replace(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}.*$/, "")
        .replace(/開賣中|檢視活動|熱門秒殺活動/g, "")
        .trim();
      events.push({
        source: KKTIX_SOURCE,
        source_id: sourceId,
        title: title || text.slice(0, 120) || sourceId,
        event_at: eventAt,
        url,
        extracted_text: text,
        raw_excerpt: text.slice(0, 4000),
      });
    });
  }

  return events;
};

const parseIndievoxDate = (value: string) => {
  const match = value.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

const parseIndievoxEvents = (html: string): ConcertEventInput[] => {
  const $ = load(html);
  const events: ConcertEventInput[] = [];

  $("a[href*='/activity/detail/']").each((_, element) => {
    const link = $(element).attr("href")?.trim() ?? "";
    if (!link) return;
    const url = new URL(link, INDIEVOX_BASE).toString();
    const pathSegments = new URL(url).pathname.split("/").filter(Boolean);
    const sourceId = pathSegments[pathSegments.length - 1] ?? "";
    const title =
      $(element).find(".multi_ellipsis").text().trim() ||
      $(element).find("img").attr("alt")?.trim() ||
      $(element).text().trim();
    const dateText =
      $(element).find(".date").text().trim() ||
      $(element).closest(".panel-body").prev(".panel-heading").text().trim();
    const eventAt = parseIndievoxDate(dateText);
    if (!sourceId || !title || !eventAt) return;

    events.push({
      source: INDIEVOX_SOURCE,
      source_id: sourceId,
      title,
      event_at: eventAt,
      url,
    });
  });

  return events;
};

const dedupeEvents = (events: ConcertEventInput[]) => {
  const map = new Map<string, ConcertEventInput>();
  for (const event of events) {
    const key = `${event.source}:${event.source_id}`;
    if (!map.has(key)) {
      map.set(key, event);
    }
  }
  return Array.from(map.values());
};

const buildKktixUrl = (startAt: string, endAt: string, page: number) => {
  const target = new URL(KKTIX_BASE);
  target.searchParams.set("event_tag_ids_in", KKTIX_MUSIC_TAG_IDS.join(","));
  if (startAt) target.searchParams.set("start_at", normalizeKktixDateParam(startAt));
  if (endAt) target.searchParams.set("end_at", normalizeKktixDateParam(endAt));
  target.searchParams.set("page", String(page));
  return target.toString();
};

const buildKktixDirectoryUrl = (startAt: string, endAt: string, page: number) => {
  const target = new URL(KKTIX_DIRECTORY_BASE);
  target.searchParams.set("event_tag_ids_in", KKTIX_MUSIC_TAG_IDS.join(","));
  if (startAt) target.searchParams.set("start_at", normalizeKktixDateParam(startAt));
  if (endAt) target.searchParams.set("end_at", normalizeKktixDateParam(endAt));
  target.searchParams.set("page", String(page));
  return target.toString();
};
const buildIndievoxActivityUrl = (startAt: string, endAt: string) => {
  const target = new URL(`${INDIEVOX_BASE}/activity`);
  target.searchParams.set("type", "card");
  const normalizeDate = (value: string) => value.trim().slice(0, 10).replaceAll("-", "/");
  if (startAt) target.searchParams.set("startDate", normalizeDate(startAt));
  if (endAt) target.searchParams.set("endDate", normalizeDate(endAt));
  return target.toString();
};

const ensureKktixProfileDir = () => {
  const dir = resolve(REPO, ".toolbelt", "kktix-profile");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const clampCount = (value: unknown, defaultValue: number, maxValue: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, 1), maxValue);
};

const clampPageCount = (value: unknown, defaultValue: number) => clampCount(value, defaultValue, MAX_PAGES_LIMIT);

const clampDetailPageCount = (value: unknown, defaultValue: number) =>
  clampCount(value, defaultValue, MAX_DETAIL_PAGES_LIMIT);

const parseSourceInput = (value: unknown): ConcertSource[] => {
  if (value === undefined || value === null) return [KKTIX_SOURCE];
  const tokens = Array.isArray(value)
    ? value.map((entry) => String(entry))
    : String(value).split(",");
  const cleaned = tokens.map((token) => token.trim().toLowerCase()).filter(Boolean);
  if (cleaned.includes("all")) {
    return [...CONCERT_SOURCES];
  }
  const selected = cleaned.filter((token): token is ConcertSource =>
    CONCERT_SOURCES.includes(token as ConcertSource),
  );
  return selected.length > 0 ? Array.from(new Set(selected)) : [KKTIX_SOURCE];
};

const parseIntelSourceInput = (value: unknown): ConcertIntelSource[] => {
  const allSources = CONCERT_INTEL_SOURCE_CONFIGS.map((config) => config.source) as ConcertIntelSource[];
  if (value === undefined || value === null) return allSources;
  const tokens = Array.isArray(value)
    ? value.map((entry) => String(entry))
    : String(value).split(",");
  const cleaned = tokens.map((token) => token.trim().toLowerCase()).filter(Boolean);
  if (cleaned.includes("all")) return allSources;
  const selected = cleaned.filter((token): token is ConcertIntelSource =>
    allSources.includes(token as ConcertIntelSource),
  );
  return selected.length > 0 ? Array.from(new Set(selected)) : allSources;
};

const parseKnownSourceIds = (source: string, value: unknown) => {
  const fromArray = (items: unknown[]) => new Set(items.map((item) => String(item).trim()).filter(Boolean));
  if (Array.isArray(value)) return fromArray(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sourceIds = record[source];
    if (Array.isArray(sourceIds)) return fromArray(sourceIds);
  }
  return new Set<string>();
};

const collapseText = (value: string) => value.replace(/\s+/g, " ").trim();

const COMMON_EVIDENCE_KEYWORDS = [
  "\u555f\u552e",
  "\u958b\u8ce3",
  "\u552e\u7968\u6642\u9593",
  "\u6b63\u5f0f\u958b\u8ce3",
  "\u5168\u9762\u958b\u8ce3",
  "\u6703\u54e1\u9810\u552e",
  "\u9810\u552e",
  "\u767b\u8a18\u62bd\u9078",
  "\u62bd\u9078\u767b\u8a18",
  "\u62bd\u9078",
  "\u4ed8\u6b3e\u6642\u9593",
  "\u622a\u6b62",
  "\u91cb\u7968",
  "\u52a0\u958b",
  "\u52a0\u5834",
  "exposeStart",
  "exposeEnd",
  "validFromUtc",
  "validToUtc",
];

const EVIDENCE_KEYWORDS_BY_SOURCE: Record<string, string[]> = {
  kktix: [...COMMON_EVIDENCE_KEYWORDS, "register_status", "first_sale_at"],
  ticketplus: [...COMMON_EVIDENCE_KEYWORDS, "\u5546\u54c1", "\u7968\u7a2e"],
  livenation_tw: [...COMMON_EVIDENCE_KEYWORDS, "Live Nation", "\u62d3\u5143"],
  tixcraft: [...COMMON_EVIDENCE_KEYWORDS, "\u62d3\u5143", "\u8cfc\u7968"],
  kham: [...COMMON_EVIDENCE_KEYWORDS, "\u8cfc\u7968", "\u5269\u9918", "\u5df2\u552e\u5b8c"],
  opentix: [...COMMON_EVIDENCE_KEYWORDS, "\u92b7\u552e", "\u5957\u7968", "\u8cfc\u7968"],
  indievox: [...COMMON_EVIDENCE_KEYWORDS, "\u7968\u50f9", "\u6f14\u51fa\u8005"],
  legacy: [...COMMON_EVIDENCE_KEYWORDS, "\u9810\u552e\u7968", "\u73fe\u5834\u7968", "\u8cfc\u7968"],
};

const buildEvidenceWindows = (source: string, text: string, maxWindows = 5) => {
  const normalized = collapseText(text);
  const keywords = EVIDENCE_KEYWORDS_BY_SOURCE[source] ?? COMMON_EVIDENCE_KEYWORDS;
  const windows: Array<{ kind: string; keyword: string; text: string }> = [];
  const usedStarts: number[] = [];

  for (const keyword of keywords) {
    const index = normalized.indexOf(keyword);
    if (index < 0) continue;
    const start = Math.max(0, index - 240);
    if (usedStarts.some((used) => Math.abs(used - start) < 180)) continue;
    usedStarts.push(start);
    windows.push({
      kind: /expose|valid|first_sale_at|register_status/.test(keyword) ? "source_field" : "sale_text",
      keyword,
      text: normalized.slice(start, start + 860),
    });
    if (windows.length >= maxWindows) break;
  }

  if (windows.length === 0) {
    windows.push({
      kind: "summary",
      keyword: "summary",
      text: normalized.slice(0, 860),
    });
  }

  return windows;
};

const stringifyPayload = (payload: unknown) => {
  try {
    return JSON.stringify(payload ?? {}).slice(0, 20000);
  } catch {
    return "{}";
  }
};

const hashCandidateContent = (candidate: ConcertIntelCandidateInput, sourcePayloadJson: string) =>
  createHash("sha256")
    .update(
      [
        candidate.source,
        candidate.source_id,
        candidate.title,
        candidate.url,
        candidate.event_at ?? "",
        candidate.extracted_text,
        sourcePayloadJson,
      ].join("\n"),
    )
    .digest("hex");

const indexCandidate = (
  candidate: ConcertIntelCandidateInput,
  sourcePayload: unknown = {},
  parserVersion?: string,
): ConcertIntelCandidateInput => {
  const sourcePayloadJson = stringifyPayload(sourcePayload);
  const evidence = buildEvidenceWindows(candidate.source, `${candidate.extracted_text}\n${candidate.raw_excerpt}`);
  return {
    ...candidate,
    evidence_json: JSON.stringify(evidence),
    source_payload_json: sourcePayloadJson,
    content_hash: hashCandidateContent(candidate, sourcePayloadJson),
    parser_version: parserVersion ?? `${candidate.source}-evidence-v1`,
  };
};

const candidateSourceId = (source: string, url: string) => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.split("/").filter(Boolean).join("-");
    const stableQueryId =
      parsed.searchParams.get("PRODUCT_ID") ||
      parsed.searchParams.get("eventId") ||
      parsed.searchParams.get("id") ||
      "";
    return `${source}:${path || parsed.hostname}${stableQueryId ? `:${stableQueryId}` : ""}`.slice(0, 240);
  } catch {
    return `${source}:${url}`.slice(0, 240);
  }
};

const isoFromTaipeiDate = (year: string, month: string, day: string) => {
  const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const inferEventDate = (text: string) => {
  const normalized = collapseText(text);
  const yearFirst = normalized.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (yearFirst) return isoFromTaipeiDate(yearFirst[1], yearFirst[2], yearFirst[3]);
  const monthFirst = normalized.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/);
  if (monthFirst) return isoFromTaipeiDate(monthFirst[3], monthFirst[1], monthFirst[2]);
  return null;
};

const rangeBoundary = (value: string, endOfDay = false) => {
  const normalized = value.trim().replace(/\//g, "-");
  const match = normalized.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(
    `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}T${time}+08:00`,
  );
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const isEventInRange = (eventAt: string | null | undefined, startAt: string, endAt: string) => {
  if (!eventAt) return false;
  const eventTime = new Date(eventAt).getTime();
  if (Number.isNaN(eventTime)) return false;
  const startTime = rangeBoundary(startAt);
  const endTime = rangeBoundary(endAt, true);
  return (startTime === null || eventTime >= startTime) && (endTime === null || eventTime <= endTime);
};

const filterAndSortEvents = (events: ConcertEventInput[], startAt: string, endAt: string) =>
  events
    .filter((event) => isEventInRange(event.event_at, startAt, endAt))
    .sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime());

const normalizeKktixDateParam = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return trimmed;
  return `${match[1]}/${match[2].padStart(2, "0")}/${match[3].padStart(2, "0")}`;
};

const readDetailPage = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(500);
  const result = await page.evaluate(`(() => {
    const pickText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
    const title =
      pickText("h1") ||
      pickText("[class*='title']") ||
      document.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim() ||
      document.title ||
      "";
    const bodyText = document.body?.innerText || "";
    const venue =
      pickText("[class*='venue']") ||
      pickText("[class*='location']") ||
      pickText("[class*='place']") ||
      "";
    const organizer =
      pickText("[class*='organizer']") ||
      pickText("[class*='host']") ||
      "";
    return { title, bodyText, venue, organizer };
  })()`) as { title: string; bodyText: string; venue: string; organizer: string };
  const extracted = collapseText(result.bodyText).slice(0, 12000);
  return {
    title: collapseText(result.title),
    venue: collapseText(result.venue) || null,
    organizer: collapseText(result.organizer) || null,
    extracted_text: extracted,
    raw_excerpt: extracted.slice(0, 4000),
    event_at: inferEventDate(extracted),
  };
};

const readKhamDetailPage = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(`(() => {
    const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
    const content = document.querySelector("#content");
    const showInfo = document.querySelector("#showInfo");
    const title =
      clean(content?.querySelector("h1, h2, h3, .title")?.textContent) ||
      clean(Array.from(content?.childNodes || [])
        .map((node) => node.textContent || "")
        .find((text) => text && /20\\d{2}|演唱會|Concert|LIVE|Live/.test(text))) ||
      clean(document.querySelector("meta[property='og:title']")?.getAttribute("content")) ||
      clean(document.title);
    const bodyText = clean([
      title,
      content?.textContent || "",
      showInfo?.textContent || "",
    ].filter(Boolean).join("\\n"));
    return { title, bodyText, venue: "", organizer: "" };
  })()`) as { title: string; bodyText: string; venue: string; organizer: string };
  let orderText = "";
  try {
    const parsed = new URL(url);
    const productId = parsed.searchParams.get("PRODUCT_ID");
    if (productId) {
      const orderUrl = new URL(url);
      orderUrl.pathname = orderUrl.pathname.replace("UTK0201_.aspx", "UTK0201_00.aspx");
      await page.goto(orderUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(800);
      orderText = await page.evaluate(`document.querySelector("#content")?.textContent || document.body?.textContent || ""`);
    }
  } catch {
    orderText = "";
  }
  const extracted = collapseText([info.bodyText, orderText].filter(Boolean).join("\n")).slice(0, 12000);
  return {
    title: collapseText(info.title).replace(/^寬宏售票系統\s*/, ""),
    venue: null,
    organizer: null,
    extracted_text: extracted,
    raw_excerpt: extracted.slice(0, 4000),
    event_at: inferEventDate(orderText) || inferEventDate(extracted),
  };
};

const readIndievoxDetailPage = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);
  const result = await page.evaluate(`(() => {
    const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
    const title =
      clean(document.querySelector("h1, h2")?.textContent) ||
      clean(document.querySelector("meta[property='og:title']")?.getAttribute("content")) ||
      clean(document.title);
    const bodyText = document.body?.innerText || document.body?.textContent || "";
    const venue = clean(bodyText.match(/演出地點[:：]\\s*([^\\n]+)/)?.[1] || "");
    const artist = clean(bodyText.match(/演出者[:：]\\s*([^\\n]+)/)?.[1] || "");
    return { title, bodyText, venue, organizer: artist };
  })()`) as { title: string; bodyText: string; venue: string; organizer: string };
  const extracted = collapseText(result.bodyText).slice(0, 12000);
  return {
    title: collapseText(result.title),
    venue: collapseText(result.venue) || null,
    organizer: collapseText(result.organizer) || null,
    extracted_text: extracted,
    raw_excerpt: extracted.slice(0, 4000),
    event_at: inferEventDate(extracted),
  };
};

const readLegacyDetailPage = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);
  const result = await page.evaluate(`(() => {
    const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
    const title =
      clean(document.querySelector("h1")?.textContent) ||
      clean(document.querySelector("meta[property='og:title']")?.getAttribute("content")) ||
      clean(document.title);
    const bodyText = document.body?.innerText || document.body?.textContent || "";
    const venue = clean(bodyText.match(/演出場地[:：]\\s*([^\\n]+)/)?.[1] || "");
    const organizer = clean(bodyText.match(/主辦單位[:：]\\s*([^\\n]+)/)?.[1] || "");
    return { title, bodyText, venue, organizer };
  })()`) as { title: string; bodyText: string; venue: string; organizer: string };
  const extracted = collapseText(result.bodyText).slice(0, 12000);
  return {
    title: collapseText(result.title),
    venue: collapseText(result.venue) || null,
    organizer: collapseText(result.organizer) || null,
    extracted_text: extracted,
    raw_excerpt: extracted.slice(0, 4000),
    event_at: inferEventDate(extracted),
  };
};

const readTixcraftDetailPage = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => null);
  await page.waitForTimeout(1_500);
  const result = await page.evaluate(`(() => {
    const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
    const title =
      clean(document.querySelector("h1")?.textContent) ||
      clean(document.querySelector("meta[property='og:title']")?.getAttribute("content")) ||
      clean(document.title);
    const rawText = document.body?.innerText || document.body?.textContent || "";
    const bodyText = clean(rawText);
    const lines = rawText.split(/\\n+/).map((line) => clean(line)).filter(Boolean);
    const venueLine = lines.find((line) => /^地點[:：]/.test(line)) || "";
    const organizerLine = lines.find((line) => /^主辦[:：]/.test(line)) || "";
    return {
      title,
      bodyText,
      venue: clean(venueLine.replace(/^地點[:：]\\s*/, "")),
      organizer: clean(organizerLine.replace(/^主辦[:：]\\s*/, ""))
    };
  })()`) as { title: string; bodyText: string; venue: string; organizer: string };
  const extracted = collapseText(result.bodyText).slice(0, 12000);
  return {
    title: collapseText(result.title),
    venue: collapseText(result.venue) || null,
    organizer: collapseText(result.organizer) || null,
    extracted_text: extracted,
    raw_excerpt: extracted.slice(0, 4000),
    event_at: inferEventDate(extracted),
  };
};

const readLiveNationDetailPage = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => null);
  await page.waitForTimeout(1_500);
  const result = await page.evaluate(`(() => {
    const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
    const title =
      clean(document.querySelector("h1")?.textContent) ||
      clean(document.querySelector("meta[property='og:title']")?.getAttribute("content")) ||
      clean(document.title);
    const mainText = clean(document.querySelector("main")?.innerText || document.body?.innerText || "");
    const venue =
      clean(document.querySelector("[data-testid*='venue']")?.textContent) ||
      clean(document.querySelector("[class*='venue']")?.textContent) ||
      "";
    return { title, bodyText: mainText, venue, organizer: "Live Nation Taiwan" };
  })()`) as { title: string; bodyText: string; venue: string; organizer: string };
  const extracted = collapseText(result.bodyText).slice(0, 12000);
  return {
    title: collapseText(result.title),
    venue: collapseText(result.venue) || null,
    organizer: "Live Nation Taiwan",
    extracted_text: extracted,
    raw_excerpt: extracted.slice(0, 4000),
    event_at: inferEventDate(extracted),
  };
};

const readSourceDetailPage = async (page: Page, source: string, url: string) => {
  if (source === "kham") return readKhamDetailPage(page, url);
  if (source === "indievox") return readIndievoxDetailPage(page, url);
  if (source === "legacy") return readLegacyDetailPage(page, url);
  if (source === "tixcraft") return readTixcraftDetailPage(page, url);
  if (source === "livenation_tw") return readLiveNationDetailPage(page, url);
  return readDetailPage(page, url);
};

const collectGenericLinks = async (
  page: Page,
  listUrl: string,
  include: readonly string[],
  maxItems: number,
) => {
  await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => null);
  await page.waitForTimeout(2_000);
  const links = await page.evaluate(`(() => {
      const include = ${JSON.stringify([...include])};
      const maxItems = ${JSON.stringify(maxItems)};
      const seen = new Set();
      return Array.from(document.querySelectorAll("a[href]"))
        .map((anchor) => {
          const href = anchor.getAttribute("href") || "";
          const url = new URL(href, location.href).toString();
          const title =
            anchor.textContent?.trim() ||
            anchor.querySelector("img")?.getAttribute("alt")?.trim() ||
            "";
          return { url, title };
        })
        .filter((item) => include.some((part) => item.url.includes(part)))
        .filter((item) => !item.url.includes("/event/allevents"))
        .filter((item) => {
          if (seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        })
        .slice(0, maxItems);
    })()`) as Array<{ url: string; title: string }>;
  return links as DiscoveredLink[];
};

const collectKhamLinks = async (page: Page, maxItems: number) => {
  const links: DiscoveredLink[] = [];
  const seen = new Set<string>();

  for (const listUrl of KHAM_MUSIC_CATEGORY_URLS) {
    const pageLinks = await collectGenericLinks(
      page,
      listUrl,
      ["/application/UTK02/UTK0201_.aspx?PRODUCT_ID="],
      maxItems,
    );
    for (const link of pageLinks) {
      const normalizedUrl = new URL(link.url);
      normalizedUrl.hash = "";
      const url = normalizedUrl.toString();
      if (seen.has(url)) continue;
      seen.add(url);
      links.push({ ...link, url });
      if (links.length >= maxItems) return links;
    }
  }

  return links;
};

const collectLegacyLinks = async (page: Page, maxItems: number) => {
  const links: DiscoveredLink[] = [];
  const seen = new Set<string>();

  for (const listUrl of LEGACY_TOPIC_URLS) {
    if (links.length >= maxItems) break;
    await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const pageLinks = await page.evaluate(`(() => Array.from(document.querySelectorAll(".program_list li"))
      .map((item) => {
        const anchor = item.querySelector("a[href*='/article/page/']");
        const href = anchor?.getAttribute("href") || "";
        return {
          url: href ? new URL(href, location.href).toString() : "",
          title: (item.querySelector(".program_list_text")?.textContent || "").replace(/\\s+/g, " ").trim(),
          dateText: (item.querySelector(".program_list_date")?.textContent || "").replace(/\\s+/g, " ").trim(),
        };
      })
      .filter((item) => item.url && item.title))()`) as Array<{ url: string; title: string; dateText: string }>;
    for (const link of pageLinks) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      links.push({ ...link, event_at: inferEventDate(link.dateText) });
      if (links.length >= maxItems) break;
    }
  }

  return links.sort((a, b) => new Date(a.event_at || 0).getTime() - new Date(b.event_at || 0).getTime());
};

const collectKktixDomEvents = async (page: Page): Promise<ConcertEventInput[]> => {
  const rows = await page.evaluate(`(() => Array.from(document.querySelectorAll("a[href*='.kktix.cc/events/'], a[href*='kktix.com/events/']"))
    .map((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const url = new URL(href, location.href).toString();
      const text = (anchor.textContent || "").replace(/\\s+/g, " ").trim();
      return { url, text };
    }))()`) as Array<{ url: string; text: string }>;
  const events: ConcertEventInput[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const eventAt = inferEventDate(row.text);
    if (!eventAt) continue;
    const parsed = new URL(row.url);
    const sourceId = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const title = row.text
      .replace(/^.*?(演出|音樂|音樂會|藝人見面會|電音派對|其他|學習)/, "")
      .replace(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}.*$/, "")
      .replace(/開賣中|檢視活動|熱門秒殺活動/g, "")
      .trim();
    events.push({
      source: KKTIX_SOURCE,
      source_id: sourceId,
      title: title || row.text.slice(0, 120) || sourceId,
      event_at: eventAt,
      url: row.url,
    });
  }

  return events;
};

const fetchKktixDirectoryEvents = async (
  startAt: string,
  endAt: string,
  maxPages: number,
): Promise<ScrapeResult> => {
  const eventsByKey = new Map<string, ConcertEventInput>();
  let pagesFetched = 0;

  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    const targetUrl = buildKktixDirectoryUrl(startAt, endAt, pageIndex);
    const response = await fetch(targetUrl, {
      headers: {
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "User-Agent": KKTIX_USER_AGENT,
      },
    });
    if (!response.ok) {
      if (pageIndex === 1) throw new Error(`KKTIX directory failed: ${response.status}`);
      break;
    }

    const html = await response.text();
    const events = parseKktixEvents(html);
    pagesFetched += 1;
    if (events.length === 0) break;

    for (const event of events) {
      const key = `${event.source}:${event.source_id}`;
      if (!eventsByKey.has(key)) {
        eventsByKey.set(key, event);
      }
    }
  }

  return { events: filterAndSortEvents(Array.from(eventsByKey.values()), startAt, endAt), pagesFetched };
};

const scoreKktixCandidate = (event: ConcertEventInput, index: number) => {
  const text = collapseText([event.title, event.extracted_text].filter(Boolean).join(" "));
  let score = 0;
  if (/category:\s*(音樂|演出|演唱會|音樂會|藝人見面會|電音派對|KKTIX Live)/i.test(text)) score += 3;
  if (/(演唱|演唱會|音樂|音樂會|樂團|樂手|歌手|發片|專場|巡演|巡迴|公演|音樂祭|電音|DJ|嘻哈|搖滾|金屬|爵士|饒舌|偶像|LIVE|Live|live|concert|Concert|CONCERT|tour|Tour|FAN MEETING|Fan Meeting|fan meeting)/.test(text)) score += 4;
  if (/(課程|講座|研討|工作坊|競賽|測試|資格碼|SEO|AGI|咖啡|可可|玻璃工坊|親子|樂園|龍舟)/.test(text)) score -= 4;
  if (/register_status:\s*(IN_STOCK|REGISTRATION_CLOSED)/.test(text)) score += 1;
  return { event, index, score };
};

const selectKktixCandidates = (events: ConcertEventInput[], maxItems: number) =>
  events
    .map(scoreKktixCandidate)
    .sort(
      (a, b) =>
        new Date(a.event.event_at).getTime() - new Date(b.event.event_at).getTime() ||
        b.score - a.score ||
        a.index - b.index,
    )
    .slice(0, maxItems)
    .map((item) => item.event);

const collectTixcraftEvents = async (page: Page, listUrl: string): Promise<ConcertEventInput[]> => {
  await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => null);
  await page.waitForTimeout(1_500);
  const rows = await page.evaluate(`(() => Array.from(document.querySelectorAll("a[href*='/activity/detail/']"))
    .map((link) => {
      const href = link?.getAttribute("href") || "";
      const url = href ? new URL(href, location.href).toString() : "";
      const card = link.closest(".eventbl") || link.closest("li, article, .thumbnail") || link;
      const text = (card.textContent || link.textContent || "").replace(/\\s+/g, " ").trim();
      const title =
        (card.querySelector(".text-bold a")?.textContent || link?.textContent || "")
          .replace(/\\s+/g, " ")
          .trim();
      const dateText = text.match(/20\\d{2}\\/\\d{1,2}\\/\\d{1,2}[^\\d]*(?:~\\s*20\\d{2}\\/\\d{1,2}\\/\\d{1,2}[^\\d]*)?/)?.[0] || "";
      const venue = title ? text.split(title).slice(1).join(title).replace("節目介紹", "").trim() : "";
      return { url, title, dateText, venue, text };
    })
    .filter((row) => row.url && row.title))()`) as Array<{
      url: string;
      title: string;
      dateText: string;
      venue: string;
      text: string;
    }>;
  const events: ConcertEventInput[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const parsed = new URL(row.url);
    const sourceId = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const eventAt = inferEventDate(row.dateText || row.text);
    events.push({
      source: "tixcraft",
      source_id: sourceId,
      title: row.title,
      event_at: eventAt || "",
      url: row.url,
      venue: collapseText(row.venue) || null,
    });
  }

  return events;
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
};

const isUsefulTicketPlusEvent = (
  event: TicketPlusEventPayload,
  sessions: TicketPlusSessionPayload,
  products: TicketPlusProductPayload,
) => {
  const visibleSessions = (sessions.sessions ?? []).filter((session) => !session.hidden);
  const visibleProducts = (products.products ?? []).filter((product) => !product.hidden);
  if (visibleSessions.length > 0 || visibleProducts.length > 0) return true;
  const text = collapseText([event.title ?? "", event.location ?? "", stripHtml(event.announcement ?? ""), stripHtml(event.info ?? "")].join(" "));
  return /演唱會|LIVE|Live|Concert|巡迴|售票|開賣|啟售|抽選/.test(text);
};

const candidateFromEvent = async (
  page: Page,
  source: string,
  sourceKind: string,
  event: ConcertEventInput,
): Promise<ConcertIntelCandidateInput> => {
  const crawledAt = new Date().toISOString();
  const seedText = collapseText(event.extracted_text || event.raw_excerpt || "");
  try {
    const detail = await readSourceDetailPage(page, source, event.url);
    const extracted = collapseText([seedText, detail.extracted_text].filter(Boolean).join("\n")).slice(0, 12000);
    return indexCandidate({
      source,
      source_id: event.source_id,
      source_kind: sourceKind,
      title: detail.title || event.title,
      url: event.url,
      event_at: event.event_at || detail.event_at,
      venue: detail.venue || event.venue || null,
      organizer: detail.organizer || event.organizer || null,
      city: event.city || null,
      extracted_text: extracted,
      raw_excerpt: extracted.slice(0, 4000),
      status: "pending",
      confidence: extracted ? 0.45 : 0.2,
      crawled_at: crawledAt,
    }, {
      list: event,
      detail,
    });
  } catch (error: any) {
    if (seedText) {
      return indexCandidate({
        source,
        source_id: event.source_id,
        source_kind: sourceKind,
        title: event.title,
        url: event.url,
        event_at: event.event_at,
        venue: event.venue || null,
        city: event.city || null,
        organizer: event.organizer || null,
        extracted_text: seedText.slice(0, 12000),
        raw_excerpt: seedText.slice(0, 4000),
        status: "pending",
        confidence: 0.3,
        error_message: error?.message ? String(error.message) : "Detail crawl failed; using list payload",
        crawled_at: crawledAt,
      }, {
        list: event,
        detail_error: error?.message ? String(error.message) : "Detail crawl failed",
      });
    }
    return indexCandidate({
      source,
      source_id: event.source_id,
      source_kind: sourceKind,
      title: event.title,
      url: event.url,
      event_at: event.event_at,
      venue: null,
      city: null,
      organizer: null,
      extracted_text: "",
      raw_excerpt: "",
      status: "error",
      confidence: 0,
      error_message: error?.message ? String(error.message) : "Detail crawl failed",
      crawled_at: crawledAt,
    }, {
      list: event,
      detail_error: error?.message ? String(error.message) : "Detail crawl failed",
    });
  }
};

const candidateFromEventWithNewPage = async (
  context: BrowserContext,
  source: string,
  sourceKind: string,
  event: ConcertEventInput,
) => {
  const page = await context.newPage();
  try {
    return await candidateFromEvent(page, source, sourceKind, event);
  } finally {
    await page.close();
  }
};

const candidateFromEventSeed = (
  source: string,
  sourceKind: string,
  event: ConcertEventInput,
): ConcertIntelCandidateInput => {
  const seedText = collapseText(event.extracted_text || event.raw_excerpt || "");
  return indexCandidate({
    source,
    source_id: event.source_id,
    source_kind: sourceKind,
    title: event.title,
    url: event.url,
    event_at: event.event_at || null,
    venue: event.venue || null,
    city: event.city || null,
    organizer: event.organizer || null,
    extracted_text: seedText,
    raw_excerpt: (event.raw_excerpt || seedText).slice(0, 4000),
    status: "pending",
    confidence: seedText ? 0.35 : 0.2,
    crawled_at: new Date().toISOString(),
  }, { list: event });
};

const candidateFromLinkWithNewPage = async (
  context: BrowserContext,
  source: string,
  sourceKind: string,
  link: DiscoveredLink,
) => {
  const page = await context.newPage();
  const crawledAt = new Date().toISOString();
  try {
    const detail = await readSourceDetailPage(page, source, link.url);
    return indexCandidate({
      source,
      source_id: candidateSourceId(source, link.url),
      source_kind: sourceKind,
      title: detail.title || collapseText(link.title) || link.url,
      url: link.url,
      event_at: link.event_at || detail.event_at,
      venue: detail.venue,
      city: null,
      organizer: detail.organizer,
      extracted_text: detail.extracted_text,
      raw_excerpt: detail.raw_excerpt,
      status: "pending" as const,
      confidence: detail.extracted_text ? 0.35 : 0.15,
      crawled_at: crawledAt,
    }, {
      list_link: link,
      detail,
    });
  } catch (error: any) {
    return indexCandidate({
      source,
      source_id: candidateSourceId(source, link.url),
      source_kind: sourceKind,
      title: collapseText(link.title) || link.url,
      url: link.url,
      extracted_text: "",
      raw_excerpt: "",
      status: "error" as const,
      confidence: 0,
      error_message: error?.message ? String(error.message) : "Detail crawl failed",
      crawled_at: crawledAt,
    }, {
      list_link: link,
      detail_error: error?.message ? String(error.message) : "Detail crawl failed",
    });
  } finally {
    await page.close();
  }
};

const TICKETPLUS_S3_BASE = "https://apis.ticketplus.com.tw/config/api/v1/getS3";
const TICKETPLUS_PUBLIC_BASE = "https://ticketplus.com.tw/activity";

const fetchTicketPlusJson = async <T>(path: string): Promise<T> => {
  const url = new URL(TICKETPLUS_S3_BASE);
  url.searchParams.set("path", path);
  const response = await fetch(url.toString(), {
    headers: {
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      "User-Agent": KKTIX_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Ticket Plus API ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
};

type TicketPlusMainEvent = {
  title?: string;
  start_date?: string;
  end_date?: string;
  hidden?: boolean;
  exposeStart?: string;
  exposeEnd?: string;
};

type TicketPlusEventPayload = {
  event_id?: string;
  title?: string;
  time?: string;
  location?: string;
  address?: string;
  hosts?: string[];
  announcement?: string;
  info?: string;
};

type TicketPlusSessionPayload = {
  sessions?: Array<{
    name?: string;
    date?: string;
    time?: string;
    location?: string;
    address?: string;
    hosts?: string[];
    hidden?: boolean;
    exposeStart?: string;
    exposeEnd?: string;
  }>;
};

type TicketPlusProductPayload = {
  products?: Array<{
    name?: string;
    price?: number;
    hidden?: boolean;
    exposeStart?: string;
    exposeEnd?: string;
  }>;
};

const eventDateFromTicketPlus = (event: TicketPlusMainEvent, sessions: TicketPlusSessionPayload) => {
  const firstSession = sessions.sessions?.find((session) => !session.hidden);
  const dateText = firstSession?.date || event.start_date || "";
  const match = dateText.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  return match ? isoFromTaipeiDate(match[1], match[2], match[3]) : null;
};

const crawlTicketPlusSource = async (
  startAt: string,
  endAt: string,
  maxDetailPages: number,
  knownSourceIds = new Set<string>(),
) => {
  const main = await fetchTicketPlusJson<{ allEventMainPageInfo?: Record<string, TicketPlusMainEvent> }>(
    "main/mainEvents.json",
  );
  const visibleEvents = Object.entries(main.allEventMainPageInfo ?? {})
    .filter(([, event]) => event && !event.hidden)
    .filter(([, event]) => {
      const eventAt = event.start_date ? inferEventDate(event.start_date) : null;
      return isEventInRange(eventAt, startAt, endAt);
    })
    .sort(([, a], [, b]) => {
      const eventTime = new Date(a.start_date || 0).getTime() - new Date(b.start_date || 0).getTime();
      if (eventTime !== 0) return eventTime;
      return new Date(b.exposeStart || 0).getTime() - new Date(a.exposeStart || 0).getTime();
    });
  const skippedKnown = visibleEvents.filter(([eventId]) => knownSourceIds.has(eventId)).length;
  const events = visibleEvents.filter(([eventId]) => !knownSourceIds.has(eventId)).slice(0, maxDetailPages);
  const candidates: ConcertIntelCandidateInput[] = [];

  for (const [eventId, mainEvent] of events) {
    const crawledAt = new Date().toISOString();
    try {
      const [event, sessions, products] = await Promise.all([
        fetchTicketPlusJson<TicketPlusEventPayload>(`event/${eventId}/event.json`),
        fetchTicketPlusJson<TicketPlusSessionPayload>(`event/${eventId}/sessions.json`),
        fetchTicketPlusJson<TicketPlusProductPayload>(`event/${eventId}/products.json`),
      ]);
      if (!isUsefulTicketPlusEvent(event, sessions, products)) {
        continue;
      }
      const visibleProducts = (products.products ?? []).filter((product) => !product.hidden).slice(0, 30);
      const visibleSessions = (sessions.sessions ?? []).filter((session) => !session.hidden).slice(0, 10);
      const productSaleText = visibleProducts
        .map((product) =>
          [
            product.name,
            product.price ? `NT$${product.price}` : "",
            product.exposeStart ? `exposeStart ${product.exposeStart}` : "",
            product.exposeEnd ? `exposeEnd ${product.exposeEnd}` : "",
          ]
            .filter(Boolean)
            .join(" "),
        )
        .join("\n");
      const sessionText = visibleSessions
        .map((session) =>
          [session.name, session.date, session.time, session.location, session.address, session.exposeStart]
            .filter(Boolean)
            .join(" "),
        )
        .join("\n");
      const extracted = collapseText(
        [
          event.title || mainEvent.title || "",
          event.location || "",
          event.address || "",
          (event.hosts ?? []).join(" / "),
          stripHtml(event.announcement ?? ""),
          stripHtml(event.info ?? ""),
          sessionText,
          productSaleText,
        ]
          .filter(Boolean)
          .join("\n"),
      ).slice(0, 12000);

      candidates.push(indexCandidate({
        source: "ticketplus",
        source_id: eventId,
        source_kind: "ticket_platform",
        title: collapseText(event.title || mainEvent.title || eventId),
        url: `${TICKETPLUS_PUBLIC_BASE}/${eventId}`,
        event_at: eventDateFromTicketPlus(mainEvent, sessions),
        venue: collapseText(event.location || visibleSessions[0]?.location || "") || null,
        city: null,
        organizer: collapseText((event.hosts ?? visibleSessions[0]?.hosts ?? []).join(" / ")) || null,
        extracted_text: extracted,
        raw_excerpt: extracted.slice(0, 4000),
        status: "pending",
        confidence: extracted ? 0.65 : 0.25,
        crawled_at: crawledAt,
      }, {
        main_event: {
          title: mainEvent.title,
          start_date: mainEvent.start_date,
          end_date: mainEvent.end_date,
          exposeStart: mainEvent.exposeStart,
          exposeEnd: mainEvent.exposeEnd,
        },
        event: {
          event_id: event.event_id,
          title: event.title,
          time: event.time,
          location: event.location,
          address: event.address,
          hosts: event.hosts,
        },
        sessions: visibleSessions,
        products: visibleProducts,
      }, "ticketplus-s3-evidence-v1"));
    } catch (error: any) {
      candidates.push(indexCandidate({
        source: "ticketplus",
        source_id: eventId,
        source_kind: "ticket_platform",
        title: collapseText(mainEvent.title || eventId),
        url: `${TICKETPLUS_PUBLIC_BASE}/${eventId}`,
        event_at: mainEvent.start_date ? inferEventDate(mainEvent.start_date) : null,
        venue: null,
        city: null,
        organizer: null,
        extracted_text: "",
        raw_excerpt: "",
        status: "error",
        confidence: 0,
        error_message: error?.message ? String(error.message) : "Ticket Plus API crawl failed",
        crawled_at: crawledAt,
      }, {
        main_event: mainEvent,
        detail_error: error?.message ? String(error.message) : "Ticket Plus API crawl failed",
      }, "ticketplus-s3-evidence-v1"));
    }
  }

  return { candidates, pagesFetched: 1, skippedKnown, discoveredCount: visibleEvents.length };
};

type OpentixProgram = {
  id?: string;
  name?: string;
  displayCategory?: string;
  startDateTime?: number;
  endDateTime?: number;
  cities?: string[];
  minPrice?: number;
  maxPrice?: number;
  events?: Array<{ id?: string; startDateTime?: number; endDateTime?: number }>;
};

const collectOpentixEvents = async (
  startAt: string,
  endAt: string,
  maxPages: number,
): Promise<{ events: ConcertEventInput[]; pagesFetched: number }> => {
  const events = new Map<string, ConcertEventInput>();
  let pagesFetched = 0;
  let page = 1;

  while (page <= maxPages) {
    const url = new URL("https://csm.api.opentix.life/programs");
    url.searchParams.set("page", String(page));
    url.searchParams.set("rowCount", "50");
    const response = await fetch(url, { headers: { "User-Agent": KKTIX_USER_AGENT } });
    if (!response.ok) throw new Error(`OPENTIX programs failed: ${response.status}`);
    const payload = (await response.json()) as {
      result?: { data?: OpentixProgram[]; nextPage?: number | null };
    };
    pagesFetched += 1;

    for (const program of payload.result?.data ?? []) {
      if (!program.id || !program.name || program.displayCategory !== "\u97f3\u6a02" || !program.startDateTime) continue;
      const eventAt = toIsoFromEpoch(program.startDateTime);
      if (!isEventInRange(eventAt, startAt, endAt)) continue;
      events.set(program.id, {
        source: "opentix",
        source_id: `opentix:event-${program.id}`,
        title: program.name,
        event_at: eventAt,
        url: `https://www.opentix.life/event/${program.id}`,
        city: (program.cities ?? []).join(" / ") || null,
        display_category: program.displayCategory,
        min_price: typeof program.minPrice === "number" ? program.minPrice : null,
        max_price: typeof program.maxPrice === "number" ? program.maxPrice : null,
        event_count: Array.isArray(program.events) ? program.events.length : null,
        extracted_text: collapseText(
          [
            `category: ${program.displayCategory}`,
            `event_at: ${eventAt}`,
            program.endDateTime ? `event_end_at: ${toIsoFromEpoch(program.endDateTime)}` : "",
            program.cities?.length ? `cities: ${program.cities.join(" / ")}` : "",
            typeof program.minPrice === "number" ? `min_price: ${program.minPrice}` : "",
            typeof program.maxPrice === "number" ? `max_price: ${program.maxPrice}` : "",
            Array.isArray(program.events) ? `event_count: ${program.events.length}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      });
    }

    const nextPage = payload.result?.nextPage;
    if (!nextPage || nextPage <= page) break;
    page = nextPage;
  }

  return { events: filterAndSortEvents(Array.from(events.values()), startAt, endAt), pagesFetched };
};

type LiveNationDocument = {
  id?: string;
  name?: string;
  eventDateUtc?: string;
  eventDateToUtc?: string;
  announceDateUtc?: string;
  modified?: string;
  lineup?: Array<{ name?: string }>;
  venue?: { name?: string; city?: string };
  localizations?: Array<{
    url?: string;
    name?: string;
    additionalEventInformation?: string;
    mainEventInformation?: string;
  }>;
  tickets?: Array<{
    type?: string;
    validFromUtc?: string;
    validToUtc?: string;
    localizations?: Array<{ url?: string; type?: string }>;
  }>;
};

const crawlLiveNationSource = async (
  startAt: string,
  endAt: string,
  maxPages: number,
  maxDetailPages: number,
  knownSourceIds: Set<string>,
) => {
  const documents: LiveNationDocument[] = [];
  let pagesFetched = 0;
  const pageSize = 50;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL("https://www.livenation.com.tw/api/search/events");
    const startTime = rangeBoundary(startAt);
    const endTime = rangeBoundary(endAt, true);
    if (startTime !== null) url.searchParams.set("DateFrom", new Date(startTime).toISOString());
    if (endTime !== null) url.searchParams.set("DateTo", new Date(endTime).toISOString());
    url.searchParams.set("Genres", "alternative-and-indie,country,hip-hop-and-rap,pop,rnb-and-soul,rock");
    url.searchParams.set("Page", String(page));
    url.searchParams.set("PageSize", String(pageSize));
    url.searchParams.set("Url", "/event/allevents");
    const response = await fetch(url, {
      headers: {
        "User-Agent": KKTIX_USER_AGENT,
        "X-Site": "www.livenation.com.tw",
        "X-Culture": "zh-TW",
      },
    });
    if (!response.ok) throw new Error(`Live Nation events failed: ${response.status}`);
    const payload = (await response.json()) as { documents?: LiveNationDocument[]; total?: number };
    pagesFetched += 1;
    documents.push(...(payload.documents ?? []));
    if (documents.length >= (payload.total ?? 0) || (payload.documents ?? []).length < pageSize) break;
  }

  const discovered = documents
    .map((event) => {
      const localization = event.localizations?.[0];
      const relativeUrl = localization?.url || "";
      const url = relativeUrl ? new URL(relativeUrl, "https://www.livenation.com.tw").toString() : "";
      if (!url || !event.name || !event.eventDateUtc) return null;
      const sourceId = candidateSourceId("livenation_tw", url);
      const ticketText = (event.tickets ?? [])
        .map((ticket) =>
          [
            ticket.type,
            ticket.validFromUtc ? `validFromUtc ${ticket.validFromUtc}` : "",
            ticket.validToUtc ? `validToUtc ${ticket.validToUtc}` : "",
            ticket.localizations?.[0]?.url || "",
          ]
            .filter(Boolean)
            .join(" "),
        )
        .join("\n");
      const extracted = collapseText(
        [
          event.name,
          event.announceDateUtc ? `announceDateUtc ${event.announceDateUtc}` : "",
          event.modified ? `modified ${event.modified}` : "",
          `eventDateUtc ${event.eventDateUtc}`,
          event.eventDateToUtc ? `eventDateToUtc ${event.eventDateToUtc}` : "",
          (event.lineup ?? []).map((artist) => artist.name).filter(Boolean).join(" / "),
          stripHtml(localization?.mainEventInformation ?? ""),
          stripHtml(localization?.additionalEventInformation ?? ""),
          ticketText,
        ]
          .filter(Boolean)
          .join("\n"),
      ).slice(0, 12000);
      return indexCandidate({
        source: "livenation_tw",
        source_id: sourceId,
        source_kind: "organizer_announcement",
        title: localization?.name || event.name,
        url,
        event_at: event.eventDateUtc,
        venue: collapseText(event.venue?.name || "") || null,
        city: collapseText(event.venue?.city || "") || null,
        organizer: "Live Nation Taiwan",
        extracted_text: extracted,
        raw_excerpt: extracted.slice(0, 4000),
        status: "pending" as const,
        confidence: 0.85,
        crawled_at: new Date().toISOString(),
      }, {
        document: {
          id: event.id,
          name: event.name,
          announceDateUtc: event.announceDateUtc,
          modified: event.modified,
          eventDateUtc: event.eventDateUtc,
          eventDateToUtc: event.eventDateToUtc,
          lineup: event.lineup,
          venue: event.venue,
        },
        localization: {
          url: localization?.url,
          name: localization?.name,
          mainEventInformation: stripHtml(localization?.mainEventInformation ?? "").slice(0, 3000),
          additionalEventInformation: stripHtml(localization?.additionalEventInformation ?? "").slice(0, 5000),
        },
        tickets: event.tickets,
      }, "livenation-api-evidence-v1");
    })
    .filter(Boolean) as ConcertIntelCandidateInput[];
  discovered.sort((a, b) => new Date(a.event_at || 0).getTime() - new Date(b.event_at || 0).getTime());
  const skippedKnown = discovered.filter((event) => knownSourceIds.has(event.source_id)).length;
  const candidates = discovered
    .filter((event) => !knownSourceIds.has(event.source_id))
    .slice(0, maxDetailPages);
  return { candidates, pagesFetched, skippedKnown, discoveredCount: discovered.length };
};

const crawlIntelSource = async (
  context: BrowserContext,
  source: ConcertIntelSource,
  startAt: string,
  endAt: string,
  maxPages: number,
  maxDetailPages: number,
  knownSourceIds = new Set<string>(),
) => {
  const config = CONCERT_INTEL_SOURCE_CONFIGS.find((item) => item.source === source);
  if (!config) throw new Error(`Unknown source: ${source}`);

  const page = await context.newPage();
  const detailPage = await context.newPage();
  const candidates: ConcertIntelCandidateInput[] = [];
  let pagesFetched = 0;

  try {
    if (source === KKTIX_SOURCE) {
      const result = await scrapeKktixWithPlaywright(context, startAt, endAt, maxPages);
      pagesFetched += result.pagesFetched;
      const newEvents = result.events.filter((event) => !knownSourceIds.has(event.source_id));
      const selectedEvents = selectKktixCandidates(newEvents, maxDetailPages);
      candidates.push(
        ...selectedEvents
          .map((event) => candidateFromEventSeed(source, config.sourceKind, event)),
      );
      return {
        candidates,
        pagesFetched,
        skippedKnown: result.events.length - newEvents.length,
        discoveredCount: result.events.length,
      };
    }

    if (source === INDIEVOX_SOURCE) {
      const result = await scrapeIndievoxWithPlaywright(context, startAt, endAt, maxPages);
      pagesFetched += result.pagesFetched;
      const newEvents = result.events.filter((event) => !knownSourceIds.has(event.source_id));
      for (const event of newEvents.slice(0, maxDetailPages)) {
        candidates.push(await candidateFromEvent(detailPage, source, config.sourceKind, event));
      }
      return {
        candidates,
        pagesFetched,
        skippedKnown: result.events.length - newEvents.length,
        discoveredCount: result.events.length,
      };
    }

    if (source === "ticketplus") {
      return crawlTicketPlusSource(startAt, endAt, maxDetailPages, knownSourceIds);
    }

    if (source === "opentix") {
      const result = await collectOpentixEvents(startAt, endAt, maxPages);
      pagesFetched += result.pagesFetched;
      const newEvents = result.events.filter((event) => !knownSourceIds.has(event.source_id));
      candidates.push(
        ...(await mapWithConcurrency(newEvents.slice(0, maxDetailPages), 5, (event) =>
          candidateFromEventWithNewPage(context, source, config.sourceKind, event),
        )),
      );
      return {
        candidates,
        pagesFetched,
        skippedKnown: result.events.length - newEvents.length,
        discoveredCount: result.events.length,
      };
    }

    if (source === "livenation_tw") {
      return crawlLiveNationSource(startAt, endAt, maxPages, maxDetailPages, knownSourceIds);
    }

    if (source === "tixcraft") {
      const events = filterAndSortEvents(await collectTixcraftEvents(page, config.listUrl), startAt, endAt);
      const newEvents = events.filter((event) => !knownSourceIds.has(event.source_id));
      pagesFetched += 1;
      candidates.push(
        ...(await mapWithConcurrency(newEvents.slice(0, maxDetailPages), 5, (event) =>
          candidateFromEventWithNewPage(context, source, config.sourceKind, event),
        )),
      );
      return {
        candidates,
        pagesFetched,
        skippedKnown: events.length - newEvents.length,
        discoveredCount: events.length,
      };
    }

    const links =
      source === "kham"
        ? await collectKhamLinks(page, maxDetailPages)
        : source === "legacy"
        ? await collectLegacyLinks(page, maxDetailPages)
        : await collectGenericLinks(page, config.listUrl, config.include, maxDetailPages);
    const rangedLinks =
      source === "legacy"
        ? links.filter((link) => isEventInRange(link.event_at, startAt, endAt))
        : links;
    const newLinks = rangedLinks.filter((link) => !knownSourceIds.has(candidateSourceId(source, link.url)));
    pagesFetched += 1;
    const fetchedCandidates = await mapWithConcurrency(newLinks, 5, (link) =>
      candidateFromLinkWithNewPage(context, source, config.sourceKind, link),
    );
    const filteredCandidates = fetchedCandidates.filter(
      (candidate) => !candidate.event_at || isEventInRange(candidate.event_at, startAt, endAt),
    );
    candidates.push(...filteredCandidates);

    return {
      candidates,
      pagesFetched,
      skippedKnown: rangedLinks.length - newLinks.length,
      filteredOutOfRange: fetchedCandidates.length - filteredCandidates.length,
      discoveredCount: rangedLinks.length,
    };
  } finally {
    await page.close();
    await detailPage.close();
  }
};
const scrapeKktixWithPlaywright = async (
  context: BrowserContext,
  startAt: string,
  endAt: string,
  maxPages: number,
): Promise<ScrapeResult> => {
  const page = await context.newPage();
  const eventsByKey = new Map<string, ConcertEventInput>();
  let pagesFetched = 0;

  try {
    const directoryResult = await fetchKktixDirectoryEvents(startAt, endAt, maxPages);
    pagesFetched += directoryResult.pagesFetched;
    for (const event of directoryResult.events) {
      const key = `${event.source}:${event.source_id}`;
      if (!eventsByKey.has(key)) {
        eventsByKey.set(key, event);
      }
    }
    if (eventsByKey.size > 0) {
      return { events: filterAndSortEvents(Array.from(eventsByKey.values()), startAt, endAt), pagesFetched };
    }

    for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
      const targetUrl = buildKktixUrl(startAt, endAt, pageIndex);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      const html = await page.content();
      let events = parseKktixEvents(html);
      if (events.length === 0) {
        events = await collectKktixDomEvents(page);
      }
      pagesFetched += 1;

      if (events.length === 0 && html.includes("Attention Required")) {
        throw new Error("Blocked by Cloudflare challenge. Try KKTIX_HEADLESS=0.");
      }

      for (const event of events) {
        const key = `${event.source}:${event.source_id}`;
        if (!eventsByKey.has(key)) {
          eventsByKey.set(key, event);
        }
      }

      if (events.length === 0) {
        break;
      }
    }
  } finally {
    await page.close();
  }

  return { events: filterAndSortEvents(Array.from(eventsByKey.values()), startAt, endAt), pagesFetched };
};

const scrapeIndievoxWithPlaywright = async (
  context: BrowserContext,
  startAt: string,
  endAt: string,
  maxPages: number,
): Promise<ScrapeResult> => {
  const page = await context.newPage();
  const eventsByKey = new Map<string, ConcertEventInput>();
  let pagesFetched = 0;

  try {
    const targetUrl = buildIndievoxActivityUrl(startAt, endAt);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page
      .waitForSelector("a[href*='/activity/detail/']", {
        timeout: 8000,
      })
      .catch(() => null);

    const countItems = async () => page.locator("a[href*='/activity/detail/']").count();
    let previousCount = await countItems();
    pagesFetched = previousCount > 0 ? 1 : 0;

    while (pagesFetched < maxPages) {
      const loadMore = page.locator(".page-show-more a");
      const visible = await loadMore.isVisible().catch(() => false);
      if (!visible) break;

      await loadMore.scrollIntoViewIfNeeded();
      await loadMore.click();

      const increased = await page
        .waitForFunction(
          (prev) => document.querySelectorAll("a[href*='/activity/detail/']").length > prev,
          previousCount,
          { timeout: 8000 },
        )
        .then(() => true)
        .catch(() => false);

      if (!increased) {
        await page.waitForTimeout(800);
      }

      const nextCount = await countItems();
      if (nextCount <= previousCount) {
        break;
      }

      previousCount = nextCount;
      pagesFetched += 1;
    }

    const html = await page.content();
    const events = parseIndievoxEvents(html);

    for (const event of events) {
      const key = `${event.source}:${event.source_id}`;
      if (!eventsByKey.has(key)) {
        eventsByKey.set(key, event);
      }
    }
  } finally {
    await page.close();
  }

  return { events: filterAndSortEvents(Array.from(eventsByKey.values()), startAt, endAt), pagesFetched };
};

// 基礎
app.get("/", (_req, res) => res.json({ ok: true, message: "Toolbelt is running!" }));
app.get("/key", (_req, res) => res.json({ key: TOOLBELT_KEY }));
app.get("/config", (_req, res) =>
  res.json({
    frontendUrl: FRONTEND_URL || null,
    apiBase: FRONTEND_API_BASE || null,
  }),
);

app.use((req, res, next) => { res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });

// 授權保護（/、/key、/config 除外）
app.use((req, res, next) => {
  if (req.path === "/key" || req.path === "/" || req.path === "/config") return next();
  if (req.headers["x-toolbelt-key"] !== TOOLBELT_KEY) return res.status(401).send("Unauthorized");
  next();
});
// ── Git 操作 API ──
app.post("/ops/git/commit-push", (req, res) => {
  const { message } = req.body as { message?: string };

  if (!message || !message.trim()) {
    return res.status(400).json({ ok: false, error: "commit message 必填" });
  }

  // 先記錄現在狀態（純資訊用）
  const statusBefore = runCmd("git", ["status", "--short"]);

  // 1) git add -A
  const add = runCmd("git", ["add", "-A"]);
  if (add.code !== 0) {
    return res.status(500).json({
      ok: false,
      step: "add",
      stdout: add.stdout,
      stderr: add.stderr,
    });
  }

  // 2) git commit -m "<message>"
  const commit = runCmd("git", ["commit", "-m", message]);
  const commitOut = (commit.stdout || "") + (commit.stderr || "");
  const nothingToCommit = /nothing to commit/i.test(commitOut);

  // 如果真的「完全沒東西可以 commit」，這不是錯誤，可以照樣回 ok:true
  // 只是之後 push 多半也沒東西
  let pushResult: { code: number; stdout: string; stderr: string } | null = null;
  let pushed = false;

  if (!nothingToCommit) {
    // 有東西要 commit，結果 code 不是 0 → 真正錯誤，直接回
    if (commit.code !== 0) {
      return res.status(500).json({
        ok: false,
        step: "commit",
        stdout: commit.stdout,
        stderr: commit.stderr,
      });
    }

    // 3) git push（只有在有新 commit 的時候才推）
    const push = runCmd("git", ["push"]);
    pushResult = push;

    if (push.code !== 0) {
      return res.status(500).json({
        ok: false,
        step: "push",
        stdout: push.stdout,
        stderr: push.stderr,
      });
    }

    pushed = true;
  }

  const statusAfter = runCmd("git", ["status", "--short"]);

  return res.json({
    ok: true,
    nothingToCommit,
    pushed,
    statusBefore: statusBefore.stdout,
    statusAfter: statusAfter.stdout,
    commit: {
      code: commit.code,
      stdout: commit.stdout,
      stderr: commit.stderr,
    },
    push: pushResult && {
      code: pushResult.code,
      stdout: pushResult.stdout,
      stderr: pushResult.stderr,
    },
  });
});

app.post("/ops/concert-events/scrape", async (req, res) => {
  const startAt = typeof req.body?.start_at === "string" ? req.body.start_at : "";
  const endAt = typeof req.body?.end_at === "string" ? req.body.end_at : "";
  const sources = parseSourceInput(req.body?.source ?? req.body?.sources);
  const headless = req.body?.headless === false ? false : process.env.KKTIX_HEADLESS !== "0";
  let context: BrowserContext | null = null;

  try {
    const playwright = await import("playwright");
    const userDataDir = ensureKktixProfileDir();
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: { width: 1280, height: 800 },
      userAgent: KKTIX_USER_AGENT,
    });
    await context.setExtraHTTPHeaders({
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    });

    const sourceResults: SourceResult[] = [];
    const allEvents: ConcertEventInput[] = [];
    let pagesFetched = 0;

    for (const source of sources) {
      try {
        const maxPages =
          source === KKTIX_SOURCE
            ? clampPageCount(req.body?.max_pages, KKTIX_MAX_PAGES)
            : clampPageCount(req.body?.max_pages, INDIEVOX_MAX_PAGES);
        const result =
          source === KKTIX_SOURCE
            ? await scrapeKktixWithPlaywright(context, startAt, endAt, maxPages)
            : await scrapeIndievoxWithPlaywright(context, startAt, endAt, maxPages);
        sourceResults.push({
          source,
          total: result.events.length,
          pagesFetched: result.pagesFetched,
        });
        allEvents.push(...result.events);
        pagesFetched += result.pagesFetched;
      } catch (error: any) {
        sourceResults.push({
          source,
          total: 0,
          pagesFetched: 0,
          error: error?.message ? String(error.message) : "Scrape failed",
        });
      }
    }

    const successResults = sourceResults.filter((result) => !result.error);
    if (successResults.length === 0) {
      return res.status(500).json({
        ok: false,
        error: sourceResults.map((result) => `${result.source}: ${result.error}`).join("; ") || "Scrape failed",
        sourceResults,
      });
    }

    const dedupedEvents = dedupeEvents(allEvents);
    const errorResults = sourceResults.filter((result) => result.error);

    return res.json({
      ok: true,
      total: dedupedEvents.length,
      pagesFetched,
      events: dedupedEvents,
      sourceResults,
      partial: errorResults.length > 0,
      errors: errorResults.length > 0 ? errorResults : undefined,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message ? String(error.message) : "Scrape failed",
    });
  } finally {
    if (context) {
      await context.close();
    }
  }
});


// ── Toolbelt 僅保留 API（scrape + git ops）──

app.post("/ops/concert-intel/crawl", async (req, res) => {
  const startAt = typeof req.body?.start_at === "string" ? req.body.start_at : "";
  const endAt = typeof req.body?.end_at === "string" ? req.body.end_at : "";
  const sources = parseIntelSourceInput(req.body?.source ?? req.body?.sources);
  const headless = req.body?.headless === false ? false : process.env.KKTIX_HEADLESS !== "0";
  const maxPages = clampPageCount(req.body?.max_pages, CONCERT_INTEL_PHASE1_MAX_PAGES);
  const maxDetailPages = clampDetailPageCount(req.body?.max_detail_pages, CONCERT_INTEL_PHASE1_MAX_DETAIL_PAGES);
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const playwright = await import("playwright");
    browser = await playwright.chromium.launch({
      headless,
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: KKTIX_USER_AGENT,
    });
    await context.setExtraHTTPHeaders({
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    });

    const sourceResults: IntelSourceResult[] = [];
    const allCandidates: ConcertIntelCandidateInput[] = [];
    const crawledSources = await mapWithConcurrency(sources, CONCERT_INTEL_SOURCE_CONCURRENCY, async (source) => {
      try {
        const knownSourceIds = parseKnownSourceIds(source, req.body?.known_source_ids);
        const result = await crawlIntelSource(context, source, startAt, endAt, maxPages, maxDetailPages, knownSourceIds);
        return {
          result: {
            source,
            total: result.candidates.length,
            pagesFetched: result.pagesFetched,
            skippedKnown: result.skippedKnown,
            discoveredCount: result.discoveredCount ?? result.candidates.length + result.skippedKnown,
            filteredOutOfRange: "filteredOutOfRange" in result ? result.filteredOutOfRange : 0,
          },
          candidates: result.candidates,
          pagesFetched: result.pagesFetched,
        };
      } catch (error: any) {
        return {
          result: {
            source,
            total: 0,
            pagesFetched: 0,
            error: error?.message ? String(error.message) : "Crawl failed",
          },
          candidates: [],
          pagesFetched: 0,
        };
      }
    });

    let pagesFetched = 0;
    for (const crawledSource of crawledSources) {
      sourceResults.push(crawledSource.result);
      allCandidates.push(...crawledSource.candidates);
      pagesFetched += crawledSource.pagesFetched;
    }

    const successResults = sourceResults.filter((result) => !result.error);
    if (successResults.length === 0) {
      return res.status(500).json({
        ok: false,
        error: sourceResults.map((result) => `${result.source}: ${result.error}`).join("; ") || "Crawl failed",
        sourceResults,
      });
    }

    const deduped = new Map<string, ConcertIntelCandidateInput>();
    for (const candidate of allCandidates) {
      const indexedCandidate = candidate.evidence_json
        ? candidate
        : indexCandidate(candidate, { fallback_indexed_at: new Date().toISOString() });
      const key = `${candidate.source}:${candidate.source_id}`;
      if (!deduped.has(key)) deduped.set(key, indexedCandidate);
    }
    const errorResults = sourceResults.filter((result) => result.error);

    return res.json({
      ok: true,
      total: deduped.size,
      pagesFetched,
      limits: {
        maxPages,
        maxDetailPages,
        sourceConcurrency: CONCERT_INTEL_SOURCE_CONCURRENCY,
      },
      candidates: Array.from(deduped.values()),
      sourceResults,
      partial: errorResults.length > 0,
      errors: errorResults.length > 0 ? errorResults : undefined,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message ? String(error.message) : "Crawl failed",
    });
  } finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[toolbelt] http://${HOST}:${PORT}`);
  console.log(`[toolbelt] key: ${TOOLBELT_KEY}`);
  console.log(`[toolbelt] repo: ${REPO}`);
});
