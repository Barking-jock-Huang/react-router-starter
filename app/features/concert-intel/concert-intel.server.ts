import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { isAdmin, requireAdmin } from "../admin/admin-auth.server";
import { isLocalHost } from "../admin/local-host";
import { requireBlogDb } from "../../lib/d1.server";
import {
  CONCERT_INTEL_DEFAULT_STATUS,
  CONCERT_INTEL_TIMEZONE,
  type ConcertCrawlCandidateInput,
  type ConcertIntelCandidateRow,
  type ConcertIntelLoaderData,
  type ConcertIntelRadarRow,
  type ConcertIntelStats,
  type ReviewedCandidateUpdateInput,
  type ReviewedConcertInput,
  type ReviewedTicketSaleInput,
} from "./concert-intel.shared";

type Context = LoaderFunctionArgs["context"] | ActionFunctionArgs["context"];

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 500;

const nowIso = () => new Date().toISOString();

const textOrEmpty = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const nullableText = (value: unknown) => {
  const text = textOrEmpty(value);
  return text ? text : null;
};

const clampConfidence = (value: unknown) => {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(number)) return 0;
  return Math.min(Math.max(number, 0), 1);
};

const parseIsoOrNull = (value: unknown) => {
  const text = textOrEmpty(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const fnv1aHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const sourceIdFromUrl = (source: string, url: string) => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.split("/").filter(Boolean).join("-");
    return `${source}:${path || parsed.hostname}`.slice(0, 240);
  } catch {
    return `${source}:${url}`.slice(0, 240);
  }
};

const getEnv = (context: Context) => {
  const ctx = context as any;
  return (ctx?.cloudflare?.env ?? ctx?.env ?? ctx ?? {}) as Record<string, unknown>;
};

const getRequestHostname = (request: Request) => {
  const host = request.headers.get("host") ?? "";
  if (host) return host.split(":")[0]?.trim() ?? "";
  try {
    return new URL(request.url).hostname;
  } catch {
    return "";
  }
};

const isAuthorizedImportRequest = async (request: Request, context: Context) => {
  if (await isAdmin(request, context)) return true;
  const env = getEnv(context);
  const configuredToken = textOrEmpty(env.CONCERT_INTEL_IMPORT_TOKEN);
  const requestToken = request.headers.get("x-concert-intel-token") ?? "";
  if (configuredToken && requestToken && configuredToken === requestToken) return true;

  const hostname = getRequestHostname(request);
  const hasToolbeltKey = Boolean(request.headers.get("x-toolbelt-key")?.trim());
  return isLocalHost(hostname) && hasToolbeltKey;
};

export const requireConcertIntelImportAuth = async (request: Request, context: Context) => {
  if (await isAuthorizedImportRequest(request, context)) return;
  throw Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
};

const getColumns = async (db: D1Database, table: string) => {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => row.name));
};

const ensureColumn = async (db: D1Database, table: string, column: string, definition: string) => {
  const columns = await getColumns(db, table);
  if (!columns.has(column)) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
};

export const ensureConcertIntelSchema = async (db: D1Database) => {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS concert_event (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT NOT NULL, event_at TEXT NOT NULL, url TEXT NOT NULL, first_seen_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), last_seen_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE (source, source_id))",
    )
    .run();
  await ensureColumn(db, "concert_event", "venue", "TEXT");
  await ensureColumn(db, "concert_event", "city", "TEXT");
  await ensureColumn(db, "concert_event", "organizer", "TEXT");
  await ensureColumn(db, "concert_event", "artist_text", "TEXT");
  await ensureColumn(db, "concert_event", "status", "TEXT DEFAULT 'active'");
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_concert_event_event_at ON concert_event (event_at DESC)").run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS concert_crawl_candidate (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT 'ticket_platform',
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        event_at TEXT,
        venue TEXT,
        city TEXT,
        organizer TEXT,
        extracted_text TEXT NOT NULL DEFAULT '',
        raw_excerpt TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        confidence REAL NOT NULL DEFAULT 0,
        ai_summary TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        crawled_at TEXT NOT NULL,
        reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (source, source_id)
      )`,
    )
    .run();
  await ensureColumn(db, "concert_crawl_candidate", "evidence_json", "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn(db, "concert_crawl_candidate", "source_payload_json", "TEXT NOT NULL DEFAULT '{}'");
  await ensureColumn(db, "concert_crawl_candidate", "content_hash", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "concert_crawl_candidate", "parser_version", "TEXT NOT NULL DEFAULT 'legacy'");
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_concert_crawl_candidate_status ON concert_crawl_candidate (status, updated_at DESC)")
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS concert_ticket_sale (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        sale_key TEXT NOT NULL UNIQUE,
        sale_type TEXT NOT NULL DEFAULT 'unknown',
        sale_start_at TEXT,
        sale_end_at TEXT,
        timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
        confidence REAL NOT NULL DEFAULT 0,
        source_text TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        ai_reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'reviewed',
        last_checked_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (event_id) REFERENCES concert_event(id)
      )`,
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_concert_ticket_sale_start ON concert_ticket_sale (sale_start_at ASC)")
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_concert_ticket_sale_status ON concert_ticket_sale (status, confidence)")
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS concert_interest_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER,
        candidate_id INTEGER,
        feedback_type TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (event_id) REFERENCES concert_event(id),
        FOREIGN KEY (candidate_id) REFERENCES concert_crawl_candidate(id)
      )`,
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_concert_interest_event ON concert_interest_feedback (event_id, created_at DESC)")
    .run();
};

const normalizeCandidate = (input: Partial<ConcertCrawlCandidateInput>) => {
  const source = textOrEmpty(input.source).toLowerCase();
  const title = textOrEmpty(input.title);
  const url = textOrEmpty(input.url);
  if (!source || !title || !url) return null;
  const sourceId = textOrEmpty(input.source_id) || sourceIdFromUrl(source, url);
  const crawledAt = parseIsoOrNull(input.crawled_at) ?? nowIso();
  const eventAt = parseIsoOrNull(input.event_at);
  const extractedText = textOrEmpty(input.extracted_text).slice(0, 12000);
  const rawExcerpt = textOrEmpty(input.raw_excerpt).slice(0, 4000);
  const sourcePayloadJson = normalizeJsonObjectText(input.source_payload_json);
  const evidenceJson = normalizeEvidenceJsonText(input.evidence_json, `${extractedText}\n${rawExcerpt}`);
  const contentHash =
    textOrEmpty(input.content_hash) ||
    fnv1aHash([source, sourceId, title, url, eventAt ?? "", extractedText, sourcePayloadJson].join("\n"));
  return {
    source,
    source_id: sourceId,
    source_kind: textOrEmpty(input.source_kind) || "ticket_platform",
    title,
    url,
    event_at: eventAt,
    venue: nullableText(input.venue),
    city: nullableText(input.city),
    organizer: nullableText(input.organizer),
    extracted_text: extractedText,
    raw_excerpt: rawExcerpt,
    evidence_json: evidenceJson,
    source_payload_json: sourcePayloadJson,
    content_hash: contentHash.slice(0, 128),
    parser_version: textOrEmpty(input.parser_version).slice(0, 80) || "server-evidence-v1",
    status: textOrEmpty(input.status) || CONCERT_INTEL_DEFAULT_STATUS,
    confidence: clampConfidence(input.confidence),
    ai_summary: textOrEmpty(input.ai_summary),
    error_message: textOrEmpty(input.error_message),
    crawled_at: crawledAt,
  };
};

export const importConcertIntelCandidates = async (db: D1Database, inputs: Partial<ConcertCrawlCandidateInput>[]) => {
  await ensureConcertIntelSchema(db);
  const candidates = inputs.map(normalizeCandidate).filter(Boolean) as ReturnType<typeof normalizeCandidate>[];
  const updatedAt = nowIso();
  const statements = candidates.map((candidate) =>
    db
      .prepare(
        `INSERT INTO concert_crawl_candidate
          (source, source_id, source_kind, title, url, event_at, venue, city, organizer, extracted_text, raw_excerpt, evidence_json, source_payload_json, content_hash, parser_version, status, confidence, ai_summary, error_message, crawled_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, source_id) DO UPDATE SET
          source_kind = excluded.source_kind,
          title = excluded.title,
          url = excluded.url,
          event_at = excluded.event_at,
          venue = excluded.venue,
          city = excluded.city,
          organizer = excluded.organizer,
          extracted_text = excluded.extracted_text,
          raw_excerpt = excluded.raw_excerpt,
          evidence_json = excluded.evidence_json,
          source_payload_json = excluded.source_payload_json,
          content_hash = excluded.content_hash,
          parser_version = excluded.parser_version,
          status = CASE WHEN concert_crawl_candidate.status = 'reviewed' THEN concert_crawl_candidate.status ELSE excluded.status END,
          confidence = excluded.confidence,
          ai_summary = excluded.ai_summary,
          error_message = excluded.error_message,
          crawled_at = excluded.crawled_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        candidate!.source,
        candidate!.source_id,
        candidate!.source_kind,
        candidate!.title,
        candidate!.url,
        candidate!.event_at,
        candidate!.venue,
        candidate!.city,
        candidate!.organizer,
        candidate!.extracted_text,
        candidate!.raw_excerpt,
        candidate!.evidence_json,
        candidate!.source_payload_json,
        candidate!.content_hash,
        candidate!.parser_version,
        candidate!.status,
        candidate!.confidence,
        candidate!.ai_summary,
        candidate!.error_message,
        candidate!.crawled_at,
        updatedAt,
      ),
  );
  if (statements.length > 0) {
    await db.batch(statements);
  }
  return { total: inputs.length, accepted: candidates.length };
};

const normalizeReviewedEvent = (input: Partial<ReviewedConcertInput>) => {
  const source = textOrEmpty(input.source).toLowerCase();
  const title = textOrEmpty(input.title);
  const url = textOrEmpty(input.url);
  if (!source || !title || !url) return null;
  return {
    candidate_id: typeof input.candidate_id === "number" ? input.candidate_id : null,
    source,
    source_id: textOrEmpty(input.source_id) || sourceIdFromUrl(source, url),
    title,
    url,
    event_at: parseIsoOrNull(input.event_at) ?? new Date("2099-01-01T00:00:00+08:00").toISOString(),
    venue: nullableText(input.venue),
    city: nullableText(input.city),
    organizer: nullableText(input.organizer),
    artist_text: nullableText(input.artist_text),
    status: textOrEmpty(input.status) || "active",
    ai_summary: textOrEmpty(input.ai_summary),
    ticket_sales: Array.isArray(input.ticket_sales) ? input.ticket_sales : [],
  };
};

const normalizeTicketSale = (eventId: number, source: string, sourceId: string, input: Partial<ReviewedTicketSaleInput>) => {
  const saleType = textOrEmpty(input.sale_type) || "unknown";
  const saleStartAt = parseIsoOrNull(input.sale_start_at);
  const saleEndAt = parseIsoOrNull(input.sale_end_at);
  const sourceUrl = textOrEmpty(input.source_url);
  const status =
    textOrEmpty(input.status) ||
    (saleStartAt ? (clampConfidence(input.confidence) < 0.6 ? "low_confidence" : "reviewed") : "missing_sale_time");
  const saleKey = [
    eventId,
    source,
    sourceId,
    saleType,
    saleStartAt ?? "missing",
    sourceUrl || "source",
  ].join("|");
  return {
    sale_key: saleKey.slice(0, 500),
    sale_type: saleType,
    sale_start_at: saleStartAt,
    sale_end_at: saleEndAt,
    timezone: textOrEmpty(input.timezone) || CONCERT_INTEL_TIMEZONE,
    confidence: clampConfidence(input.confidence),
    source_text: textOrEmpty(input.source_text).slice(0, 2000),
    source_url: sourceUrl,
    ai_reason: textOrEmpty(input.ai_reason).slice(0, 2000),
    status,
  };
};

const normalizeCandidateUpdate = (input: Partial<ReviewedCandidateUpdateInput>) => {
  const id = typeof input.candidate_id === "number" ? input.candidate_id : Number.parseInt(String(input.candidate_id ?? ""), 10);
  if (!Number.isFinite(id)) return null;
  return {
    candidate_id: id,
    status: textOrEmpty(input.status) || "pending",
    ai_summary: textOrEmpty(input.ai_summary).slice(0, 2000),
    error_message: textOrEmpty(input.error_message).slice(0, 2000),
  };
};

export const importReviewedConcertIntel = async (
  db: D1Database,
  inputs: Partial<ReviewedConcertInput>[],
  candidateUpdateInputs: Partial<ReviewedCandidateUpdateInput>[] = [],
) => {
  await ensureConcertIntelSchema(db);
  const reviewed = inputs.map(normalizeReviewedEvent).filter(Boolean) as ReturnType<typeof normalizeReviewedEvent>[];
  const candidateUpdates = candidateUpdateInputs
    .map(normalizeCandidateUpdate)
    .filter(Boolean) as ReturnType<typeof normalizeCandidateUpdate>[];
  const checkedAt = nowIso();
  let saleCount = 0;

  for (const item of reviewed) {
    await db
      .prepare(
        `INSERT INTO concert_event
          (source, source_id, title, event_at, url, first_seen_at, last_seen_at, venue, city, organizer, artist_text, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, source_id) DO UPDATE SET
          title = excluded.title,
          event_at = excluded.event_at,
          url = excluded.url,
          last_seen_at = excluded.last_seen_at,
          venue = excluded.venue,
          city = excluded.city,
          organizer = excluded.organizer,
          artist_text = excluded.artist_text,
          status = excluded.status`,
      )
      .bind(
        item!.source,
        item!.source_id,
        item!.title,
        item!.event_at,
        item!.url,
        checkedAt,
        checkedAt,
        item!.venue,
        item!.city,
        item!.organizer,
        item!.artist_text,
        item!.status,
      )
      .run();

    const event = await db
      .prepare("SELECT id FROM concert_event WHERE source = ? AND source_id = ?")
      .bind(item!.source, item!.source_id)
      .first<{ id: number }>();
    if (!event?.id) continue;

    for (const saleInput of item!.ticket_sales) {
      const sale = normalizeTicketSale(event.id, item!.source, item!.source_id, saleInput);
      await db
        .prepare(
          `INSERT INTO concert_ticket_sale
            (event_id, sale_key, sale_type, sale_start_at, sale_end_at, timezone, confidence, source_text, source_url, ai_reason, status, last_checked_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(sale_key) DO UPDATE SET
            sale_type = excluded.sale_type,
            sale_start_at = excluded.sale_start_at,
            sale_end_at = excluded.sale_end_at,
            timezone = excluded.timezone,
            confidence = excluded.confidence,
            source_text = excluded.source_text,
            source_url = excluded.source_url,
            ai_reason = excluded.ai_reason,
            status = excluded.status,
            last_checked_at = excluded.last_checked_at,
            updated_at = excluded.updated_at`,
        )
        .bind(
          event.id,
          sale.sale_key,
          sale.sale_type,
          sale.sale_start_at,
          sale.sale_end_at,
          sale.timezone,
          sale.confidence,
          sale.source_text,
          sale.source_url,
          sale.ai_reason,
          sale.status,
          checkedAt,
          checkedAt,
        )
        .run();
      saleCount += 1;
    }

    if (item!.candidate_id) {
      await db
        .prepare(
          "UPDATE concert_crawl_candidate SET status = 'reviewed', ai_summary = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(item!.ai_summary, checkedAt, checkedAt, item!.candidate_id)
        .run();
    }
  }

  for (const update of candidateUpdates) {
    await db
      .prepare(
        `UPDATE concert_crawl_candidate
         SET status = ?,
             ai_summary = ?,
             error_message = ?,
             reviewed_at = CASE WHEN ? IN ('reviewed', 'ignored') THEN ? ELSE reviewed_at END,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        update!.status,
        update!.ai_summary,
        update!.error_message,
        update!.status,
        checkedAt,
        checkedAt,
        update!.candidate_id,
      )
      .run();
  }

  return { events: reviewed.length, ticket_sales: saleCount, candidate_updates: candidateUpdates.length };
};

const readLimit = (value: string | null) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 10), MAX_LIMIT);
};

const readKnownLimit = (value: string | null) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 5000;
  return Math.min(Math.max(parsed, 100), 20000);
};

const REVIEW_PACKET_KEYWORDS = [
  "啟售",
  "開賣",
  "售票時間",
  "正式開賣",
  "全面開賣",
  "會員預售",
  "預售",
  "登記抽選",
  "抽選登記",
  "抽選",
  "付款時間",
  "截止",
  "釋票",
  "加開",
  "加場",
  "exposeStart",
  "exposeEnd",
  "validFromUtc",
  "validToUtc",
] as const;

const clampReviewPacketLimit = (value: string | null) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(Math.max(parsed, 1), 40);
};

const makeEvidenceWindows = (text: string, maxWindows = 4) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  const windows: { keyword: string; text: string }[] = [];
  const usedStarts: number[] = [];

  for (const keyword of REVIEW_PACKET_KEYWORDS) {
    const index = normalized.indexOf(keyword);
    if (index < 0) continue;
    const start = Math.max(0, index - 220);
    if (usedStarts.some((used) => Math.abs(used - start) < 180)) continue;
    usedStarts.push(start);
    windows.push({
      keyword,
      text: normalized.slice(start, start + 780),
    });
    if (windows.length >= maxWindows) break;
  }

  if (windows.length === 0) {
    windows.push({
      keyword: "summary",
      text: normalized.slice(0, 780),
    });
  }

  return windows;
};

const parseJsonArrayOrNull = (value: unknown) => {
  const text = textOrEmpty(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeJsonObjectText = (value: unknown) => {
  const text = textOrEmpty(value);
  if (!text) return "{}";
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "{}";
    return JSON.stringify(parsed).slice(0, 20000);
  } catch {
    return "{}";
  }
};

const parseJsonObjectOrEmpty = (value: unknown) => {
  const text = textOrEmpty(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeEvidenceJsonText = (value: unknown, fallbackText: string) => {
  const parsed = parseJsonArrayOrNull(value);
  if (parsed) return JSON.stringify(parsed).slice(0, 20000);
  return JSON.stringify(makeEvidenceWindows(fallbackText)).slice(0, 20000);
};

const truncateText = (value: unknown, maxLength: number) => textOrEmpty(value).slice(0, maxLength);

const compactRecord = (value: unknown, keys: string[], maxLength = 240) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    keys
      .map((key) => [key, typeof record[key] === "string" ? truncateText(record[key], maxLength) : record[key]] as const)
      .filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""),
  );
};

const compactArray = (value: unknown, keys: string[], limit: number, maxLength = 180) =>
  Array.isArray(value)
    ? value.slice(0, limit).map((item) => compactRecord(item, keys, maxLength)).filter((item) => Object.keys(item).length > 0)
    : [];

const compactNested = (value: unknown, path: string[]) => {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

const simplifyTitleForDuplicateKey = (title: string) =>
  title
    .replace(/[：:]/g, " ")
    .replace(/\[[^\]]*Mastercard[^\]]*\]/gi, "")
    .replace(/【[^】]*Mastercard[^】]*】/gi, "")
    .replace(/VIP\s*PASS.*$/i, "")
    .replace(/\bin\s+(taipei|kaohsiung|taichung|taiwan)\b/gi, "")
    .replace(/登記抽選/g, "")
    .replace(/限量加購/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const urlSignal = (value: unknown) => {
  const text = textOrEmpty(value);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    parsed.search = "";
    parsed.hash = "";
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return "";
  }
};

const collectUrlSignals = (row: ConcertIntelCandidateRow, payload: Record<string, unknown>) => {
  const signals = new Set<string>();
  const ownUrl = urlSignal(row.url);
  if (ownUrl) signals.add(ownUrl);
  const externalTicketUrl = urlSignal(compactNested(payload, ["detail", "ticket_url"])) || urlSignal(compactNested(payload, ["detail", "source_url"]));
  if (externalTicketUrl) signals.add(externalTicketUrl);
  if (Array.isArray(payload.tickets)) {
    for (const ticket of payload.tickets) {
      const localizations = ticket && typeof ticket === "object" ? (ticket as Record<string, unknown>).localizations : null;
      if (!Array.isArray(localizations)) continue;
      for (const localization of localizations) {
        const signal = urlSignal((localization as Record<string, unknown>)?.url);
        if (signal) signals.add(signal);
      }
    }
  }
  return Array.from(signals).slice(0, 8);
};

const hasAnyTextSignal = (text: string, signals: string[]) => signals.some((signal) => text.includes(signal));

const priceNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildOpentixMusicProfile = (row: ConcertIntelCandidateRow, payload: Record<string, unknown>) => {
  const list = (payload.list ?? {}) as Record<string, unknown>;
  const detail = (payload.detail ?? {}) as Record<string, unknown>;
  const identityText = [
    row.title,
    row.organizer,
    list.title,
    detail.title,
    detail.organizer,
  ]
    .map((value) => textOrEmpty(value))
    .filter(Boolean)
    .join(" ");
  const venueText = [row.venue, list.venue, detail.venue]
    .map((value) => textOrEmpty(value))
    .filter(Boolean)
    .join(" ");
  const categoryText = [
    identityText,
    venueText,
    row.extracted_text,
    list.display_category,
    list.displayCategory,
    list.city,
  ]
    .map((value) => textOrEmpty(value))
    .filter(Boolean)
    .join(" ");
  const profiles: string[] = [];
  const category = textOrEmpty(list.display_category) || textOrEmpty(list.displayCategory);
  if (category === "\u97f3\u6a02" || /category:\s*\u97f3\u6a02/.test(categoryText) || /\u985e\u5225\uff1a\s*\u97f3\u6a02/.test(categoryText)) {
    profiles.push("category_music");
  }
  if (hasAnyTextSignal(identityText, ["I POP", "POP", "Showcase", "showcase", "\u91d1\u66f2", "\u61f7\u820a", "\u6d41\u884c", "\u6f14\u5531", "\u6b4c\u624b"])) {
    profiles.push("popular_or_showcase");
  }
  if (hasAnyTextSignal(identityText, ["\u97f3\u6a02\u5287", "\u5287\u5834", "\u6b4c\u5287"])) {
    profiles.push("musical_or_stage");
  }
  if (hasAnyTextSignal(identityText, ["\u89aa\u5b50", "\u5152\u7ae5", "\u5bb6\u5ead", "\u5c0f\u5c0f", "\u52d5\u756b", "\u5bae\u5d0e\u99ff"])) {
    profiles.push("family_or_animation");
  }
  if (hasAnyTextSignal(identityText, ["\u5408\u5531", "\u6e05\u5531\u5287", "\u5b89\u9b42\u66f2", "TICF"])) {
    profiles.push("choir_or_vocal");
  }
  if (
    hasAnyTextSignal(identityText, [
      "\u4ea4\u97ff",
      "\u7ba1\u6a02",
      "\u570b\u6a02",
      "\u5ba4\u5167\u6a02",
      "\u7368\u594f",
      "\u92fc\u7434",
      "\u8072\u6a02",
      "\u5f26\u6a02",
      "\u7ba1\u98a8\u7434",
      "\u5354\u594f",
      "\u91cd\u594f",
    ])
  ) {
    profiles.push("classical_or_orchestra");
  }
  if (hasAnyTextSignal(identityText, ["\u7562\u696d\u88fd\u4f5c", "\u6821\u53cb", "\u570b\u4e2d", "\u9ad8\u4e2d", "\u5927\u5b78", "\u5b78\u751f", "\u6210\u679c\u767c\u8868\u6703"])) {
    profiles.push("student_or_amateur");
  }
  if (hasAnyTextSignal(identityText, ["\u97f3\u6a02\u7bc0", "\u85dd\u8853\u7bc0"])) {
    profiles.push("festival_context");
  }
  const minPrice = priceNumber(list.min_price ?? list.minPrice);
  const maxPrice = priceNumber(list.max_price ?? list.maxPrice);
  if (minPrice === 0 && maxPrice === 0) profiles.push("free_or_registration_like");

  const uniqueProfiles = Array.from(new Set(profiles));
  const interestBucket = uniqueProfiles.includes("popular_or_showcase")
    ? "candidate_popular_live"
    : uniqueProfiles.some((profile) => profile === "musical_or_stage" || profile === "family_or_animation")
      ? "stage_or_family_music"
    : uniqueProfiles.some((profile) => profile === "classical_or_orchestra" || profile === "choir_or_vocal" || profile === "student_or_amateur")
      ? "classical_academic_or_low_default_interest"
      : "music_other";

  return {
    category,
    profiles: uniqueProfiles,
    interest_bucket: interestBucket,
    min_price: minPrice,
    max_price: maxPrice,
    event_count: priceNumber(list.event_count ?? list.eventCount),
  };
};

const buildReviewHints = (row: ConcertIntelCandidateRow, payload: Record<string, unknown>) => {
  const title = row.title;
  const titleLower = title.toLowerCase();
  const noiseHints: string[] = [];
  if (titleLower.includes("tickets in japan")) noiseHints.push("hub_or_cross_border_ticket_page");
  if (/mastercard|卡友|專區/.test(title)) noiseHints.push("campaign_or_cardholder_variant");
  if (/vip\s*pass|限量加購|加購/.test(titleLower) || /VIP\s*PASS|限量加購|加購/.test(title)) noiseHints.push("addon_or_vip_variant");
  if (/身障|愛心票|輪椅/.test(title)) noiseHints.push("accessibility_ticket_variant");
  if (/棒球|籃球|足球|排球|鬥士隊|例行賽|主場|賽事/.test(title)) noiseHints.push("sports_or_non_music_event");
  if (/展覽|互動展|市集|講座|課程|工作坊/.test(title) && !/演唱會|音樂會|LIVE|Live|live|Concert|concert/.test(title)) {
    noiseHints.push("exhibition_or_non_performance_event");
  }
  if (/場地租借|空間租借|活動空間|會議室|攝影棚|包場/.test(title)) noiseHints.push("venue_rental_page");
  if (/紋身|刺青|博覽會|藝術節/.test(title) && !/音樂|樂團|演唱會|LIVE|Live|live|Concert|concert/.test(title)) {
    noiseHints.push("non_music_festival_or_expo");
  }

  return {
    duplicate_title_key: simplifyTitleForDuplicateKey(title),
    duplicate_url_signals: collectUrlSignals(row, payload),
    music_profile: row.source === "opentix" ? buildOpentixMusicProfile(row, payload) : null,
    likely_noise: noiseHints.length > 0,
    noise_hints: noiseHints,
    review_focus:
      row.source === "opentix"
        ? ["is_music_or_concert", "public_sale_time", "filter_classical_or_family_noise_when_low_interest"]
        : ["is_music_or_concert", "sale_time", "duplicate_or_variant"],
  };
};

const evidenceBudgetBySource: Record<string, { limit: number; textLength: number }> = {
  kktix: { limit: 3, textLength: 420 },
  kham: { limit: 3, textLength: 360 },
  ticketplus: { limit: 4, textLength: 360 },
  indievox: { limit: 3, textLength: 350 },
  tixcraft: { limit: 3, textLength: 360 },
  opentix: { limit: 2, textLength: 300 },
  livenation_tw: { limit: 4, textLength: 360 },
  legacy: { limit: 3, textLength: 360 },
};

const compactEvidenceWindows = (source: string, evidence: unknown[]) => {
  const budget = evidenceBudgetBySource[source] ?? { limit: 3, textLength: 520 };
  return evidence.slice(0, budget.limit).map((entry) => {
    const record = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
    return {
      kind: truncateText(record.kind, 40) || "evidence",
      keyword: truncateText(record.keyword, 60),
      text: truncateText(record.text, budget.textLength),
    };
  });
};

const compactSourcePayload = (source: string, payload: Record<string, unknown>) => {
  if (source === "ticketplus") {
    return {
      main_event: compactRecord(payload.main_event, ["title", "start_date", "end_date", "exposeStart", "exposeEnd"]),
      event: compactRecord(payload.event, ["event_id", "title", "time", "location", "address", "hosts"]),
      sessions: compactArray(payload.sessions, ["name", "date", "time", "location", "address", "exposeStart", "exposeEnd"], 4),
      products: compactArray(payload.products, ["name", "price", "exposeStart", "exposeEnd"], 10),
    };
  }

  if (source === "livenation_tw") {
    const document = payload.document as Record<string, unknown> | undefined;
    const lineup = Array.isArray(document?.lineup)
      ? document.lineup.slice(0, 8).map((artist) => compactRecord(artist, ["name"], 120))
      : [];
    return {
      document: {
        ...compactRecord(document, ["id", "name", "announceDateUtc", "modified", "eventDateUtc", "eventDateToUtc"]),
        lineup,
        venue: compactRecord(document?.venue, ["name", "city"], 160),
      },
      tickets: compactArray(payload.tickets, ["type", "validFromUtc", "validToUtc"], 8),
      ticket_urls: compactArray(
        Array.isArray(payload.tickets)
          ? payload.tickets.flatMap((ticket) => (ticket as Record<string, unknown>).localizations ?? [])
          : [],
        ["type", "url"],
        8,
        260,
      ),
    };
  }

  const listPayload = (payload.list ?? payload.list_link ?? {}) as Record<string, unknown>;
  const detailPayload = (payload.detail ?? {}) as Record<string, unknown>;
  return {
    list: compactRecord(listPayload, [
      "source",
      "source_id",
      "title",
      "display_category",
      "displayCategory",
      "event_at",
      "url",
      "venue",
      "city",
      "organizer",
      "min_price",
      "max_price",
      "event_count",
    ]),
    detail: compactRecord(detailPayload, ["title", "event_at", "venue", "city", "organizer"]),
    external_ticket_url:
      truncateText(compactNested(payload, ["detail", "ticket_url"]), 300) ||
      truncateText(compactNested(payload, ["detail", "source_url"]), 300),
  };
};

export async function loadConcertIntelKnownSourceIds({ request, context }: LoaderFunctionArgs): Promise<Response> {
  await requireConcertIntelImportAuth(request, context);
  const db = requireBlogDb(context);
  await ensureConcertIntelSchema(db);
  const url = new URL(request.url);
  const source = textOrEmpty(url.searchParams.get("source")).toLowerCase();
  if (!source) return Response.json({ success: false, error: "Missing source" }, { status: 400 });
  const limit = readKnownLimit(url.searchParams.get("limit"));
  const result = await db
    .prepare(
      `SELECT source_id FROM concert_crawl_candidate WHERE source = ?
       UNION
       SELECT source_id FROM concert_event WHERE source = ?
       LIMIT ?`,
    )
    .bind(source, source, limit)
    .all<{ source_id: string }>();
  return Response.json({
    success: true,
    source,
    source_ids: (result.results ?? []).map((row) => row.source_id).filter(Boolean),
  });
};

export async function loadConcertIntelReviewPacket({ request, context }: LoaderFunctionArgs): Promise<Response> {
  await requireConcertIntelImportAuth(request, context);
  const db = requireBlogDb(context);
  await ensureConcertIntelSchema(db);
  const url = new URL(request.url);
  const source = textOrEmpty(url.searchParams.get("source")).toLowerCase();
  const status = textOrEmpty(url.searchParams.get("status")) || "pending";
  const since = parseIsoOrNull(url.searchParams.get("since"));
  const limit = clampReviewPacketLimit(url.searchParams.get("limit"));
  const mode = textOrEmpty(url.searchParams.get("mode")) === "full" ? "full" : "compact";
  const params: (string | number)[] = [];
  const where: string[] = [];
  if (status !== "all") {
    where.push("status = ?");
    params.push(status);
  }
  if (source) {
    where.push("source = ?");
    params.push(source);
  }
  if (since) {
    where.push("crawled_at >= ?");
    params.push(since);
  }
  params.push(limit);

  const result = await db
    .prepare(
      `SELECT id, source, source_id, source_kind, title, url, event_at, venue, city, organizer, extracted_text, raw_excerpt, crawled_at, updated_at
              , evidence_json, source_payload_json, content_hash, parser_version
       FROM concert_crawl_candidate
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all<ConcertIntelCandidateRow>();

  const candidates = (result.results ?? []).map((row) => {
    const sourcePayload = parseJsonObjectOrEmpty(row.source_payload_json);
    const evidence = parseJsonArrayOrNull(row.evidence_json) ?? makeEvidenceWindows(`${row.extracted_text}\n${row.raw_excerpt}`);
    return {
      id: row.id,
      source: row.source,
      source_id: row.source_id,
      source_kind: row.source_kind,
      title: row.title,
      url: row.url,
      event_at: row.event_at,
      venue: row.venue,
      city: row.city,
      organizer: row.organizer,
      crawled_at: row.crawled_at,
      updated_at: row.updated_at,
      parser_version: row.parser_version,
      content_hash: row.content_hash,
      packet_hints: buildReviewHints(row, sourcePayload),
      source_payload: mode === "full" ? sourcePayload : compactSourcePayload(row.source, sourcePayload),
      evidence_windows: mode === "full" ? evidence : compactEvidenceWindows(row.source, evidence),
    };
  });

  return Response.json({
    success: true,
    packet_version: mode === "full" ? "review-packet-full-v1" : "review-packet-compact-v1",
    generated_at: nowIso(),
    query: { source: source || "all", status, since, limit, mode },
    candidates,
  });
}

const loadStats = async (db: D1Database): Promise<ConcertIntelStats> => {
  const candidateRows = await db
    .prepare("SELECT status, COUNT(*) as total FROM concert_crawl_candidate GROUP BY status")
    .all<{ status: string; total: number }>();
  const saleRows = await db
    .prepare("SELECT status, COUNT(*) as total FROM concert_ticket_sale GROUP BY status")
    .all<{ status: string; total: number }>();
  const upcomingRow = await db
    .prepare(
      "SELECT COUNT(*) as total FROM concert_ticket_sale WHERE sale_start_at IS NOT NULL AND sale_start_at >= ? AND sale_start_at <= ? AND status != 'ignored'",
    )
    .bind(nowIso(), new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString())
    .first<{ total: number | null }>();
  const candidates = new Map((candidateRows.results ?? []).map((row) => [row.status, Number(row.total ?? 0)]));
  const sales = new Map((saleRows.results ?? []).map((row) => [row.status, Number(row.total ?? 0)]));
  return {
    pending: candidates.get("pending") ?? 0,
    reviewed: candidates.get("reviewed") ?? 0,
    low_confidence: sales.get("low_confidence") ?? 0,
    missing_sale_time: sales.get("missing_sale_time") ?? 0,
    upcoming: Number(upcomingRow?.total ?? 0),
  };
};

const loadRadar = async (db: D1Database, limit: number) => {
  const upper = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const result = await db
    .prepare(
      `SELECT
        e.id as event_id,
        s.id as sale_id,
        e.title,
        e.source,
        e.source_id,
        e.url,
        e.event_at,
        e.venue,
        e.city,
        e.organizer,
        e.artist_text,
        e.status as event_status,
        s.sale_type,
        s.sale_start_at,
        s.sale_end_at,
        s.timezone,
        s.confidence,
        s.source_text,
        s.source_url,
        s.ai_reason,
        s.status as sale_status,
        s.last_checked_at,
        (
          SELECT GROUP_CONCAT(feedback_type, ', ')
          FROM concert_interest_feedback f
          WHERE f.event_id = e.id
        ) as feedback
      FROM concert_event e
      LEFT JOIN concert_ticket_sale s ON s.event_id = e.id
      WHERE e.status IS NULL OR e.status != 'ignored'
      ORDER BY
        CASE
          WHEN s.sale_start_at IS NOT NULL AND s.sale_start_at >= ? AND s.sale_start_at <= ? THEN 0
          WHEN s.status = 'missing_sale_time' THEN 1
          WHEN s.status = 'low_confidence' THEN 2
          ELSE 3
        END,
        s.sale_start_at IS NULL,
        s.sale_start_at ASC,
        e.event_at ASC
      LIMIT ?`,
    )
    .bind(nowIso(), upper, limit)
    .all<ConcertIntelRadarRow>();
  return result.results ?? [];
};

export async function loadConcertIntelAdmin({ request, context }: LoaderFunctionArgs): Promise<Response> {
  await requireAdmin(request, context);
  const db = requireBlogDb(context);
  await ensureConcertIntelSchema(db);
  const url = new URL(request.url);
  const status = textOrEmpty(url.searchParams.get("status")) || "pending";
  const limit = readLimit(url.searchParams.get("limit"));
  const where = status === "all" ? "" : "WHERE status = ?";
  const candidates = await db
    .prepare(
      `SELECT id, source, source_id, source_kind, title, url, event_at, venue, city, organizer, extracted_text, raw_excerpt, status, confidence, ai_summary, error_message, crawled_at, reviewed_at, created_at, updated_at
       FROM concert_crawl_candidate ${where}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .bind(...(status === "all" ? [] : [status]), limit)
    .all<ConcertIntelCandidateRow>();
  const [radar, stats] = await Promise.all([loadRadar(db, limit), loadStats(db)]);

  return Response.json({
    candidates: candidates.results ?? [],
    radar,
    stats,
    query: { status, limit },
  } satisfies ConcertIntelLoaderData);
}

export async function loadPublicTicketRadar({ context }: LoaderFunctionArgs): Promise<Response> {
  const db = requireBlogDb(context);
  await ensureConcertIntelSchema(db);
  const [radar, stats] = await Promise.all([loadRadar(db, 120), loadStats(db)]);
  return Response.json({ radar, stats });
}

export async function handleConcertIntelAdminAction({ request, context }: ActionFunctionArgs): Promise<Response> {
  await requireAdmin(request, context);
  const db = requireBlogDb(context);
  await ensureConcertIntelSchema(db);
  const formData = await request.formData();
  const intent = textOrEmpty(formData.get("intent"));
  const updatedAt = nowIso();

  if (intent === "candidate-status") {
    const id = Number.parseInt(textOrEmpty(formData.get("candidate_id")), 10);
    const status = textOrEmpty(formData.get("status")) || "pending";
    if (!Number.isFinite(id)) return Response.json({ ok: false, error: "Invalid candidate id" }, { status: 400 });
    await db
      .prepare("UPDATE concert_crawl_candidate SET status = ?, reviewed_at = CASE WHEN ? = 'reviewed' THEN ? ELSE reviewed_at END, updated_at = ? WHERE id = ?")
      .bind(status, status, updatedAt, updatedAt, id)
      .run();
    return Response.json({ ok: true });
  }

  if (intent === "feedback") {
    const eventId = Number.parseInt(textOrEmpty(formData.get("event_id")), 10);
    const candidateIdRaw = Number.parseInt(textOrEmpty(formData.get("candidate_id")), 10);
    const feedbackType = textOrEmpty(formData.get("feedback_type"));
    const note = textOrEmpty(formData.get("note"));
    if (!feedbackType || (!Number.isFinite(eventId) && !Number.isFinite(candidateIdRaw))) {
      return Response.json({ ok: false, error: "Invalid feedback" }, { status: 400 });
    }
    await db
      .prepare(
        "INSERT INTO concert_interest_feedback (event_id, candidate_id, feedback_type, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(Number.isFinite(eventId) ? eventId : null, Number.isFinite(candidateIdRaw) ? candidateIdRaw : null, feedbackType, note, updatedAt, updatedAt)
      .run();
    if (feedbackType === "not_interested" && Number.isFinite(eventId)) {
      await db.prepare("UPDATE concert_event SET status = 'ignored', last_seen_at = ? WHERE id = ?").bind(updatedAt, eventId).run();
    }
    return Response.json({ ok: true });
  }

  if (intent === "sale-update") {
    const saleId = Number.parseInt(textOrEmpty(formData.get("sale_id")), 10);
    const saleStartAt = parseIsoOrNull(formData.get("sale_start_at"));
    const saleType = textOrEmpty(formData.get("sale_type")) || "unknown";
    const confidence = clampConfidence(formData.get("confidence"));
    const status = textOrEmpty(formData.get("status")) || (saleStartAt ? "reviewed" : "missing_sale_time");
    if (!Number.isFinite(saleId)) return Response.json({ ok: false, error: "Invalid sale id" }, { status: 400 });
    await db
      .prepare(
        "UPDATE concert_ticket_sale SET sale_start_at = ?, sale_type = ?, confidence = ?, status = ?, updated_at = ?, last_checked_at = ? WHERE id = ?",
      )
      .bind(saleStartAt, saleType, confidence, status, updatedAt, updatedAt, saleId)
      .run();
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Unknown intent" }, { status: 400 });
}
