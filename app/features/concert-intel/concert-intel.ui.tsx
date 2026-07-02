import { useMemo, useState } from "react";
import { Form, Link, useLoaderData, useRevalidator } from "react-router";
import { RefreshCw } from "lucide-react";

import { AdminNav } from "../../components/AdminNav";
import type {
  ConcertIntelCandidateRow,
  ConcertIntelLoaderData,
  ConcertIntelRadarRow,
} from "./concert-intel.shared";
import { SALE_TYPE_OPTIONS } from "./concert-intel.shared";
import {
  confidenceLabel,
  formatDateInputValue,
  formatTaipeiDateTime,
  saleStatusLabel,
  toLocalDateInput,
} from "./concert-intel.utils";

type CrawlResult = {
  ok: boolean;
  message: string;
  total?: number;
  accepted?: number;
  sources?: Array<{
    source: string;
    total?: number;
    discoveredCount?: number;
    skippedKnown?: number;
    filteredOutOfRange?: number;
    error?: string;
  }>;
};

const TOOLBELT_BASE_URL = "http://127.0.0.1:43210";
const PHASE1_MAX_PAGES = 5;
const PHASE1_MAX_DETAIL_PAGES = 100;
const PHASE1_SOURCE_LIMITS: Record<string, { maxPages: number; maxDetailPages: number }> = {
  kktix: { maxPages: 20, maxDetailPages: 200 },
};
const PHASE1_SOURCES = [
  "kham",
  "kktix",
  "ticketplus",
  "indievox",
  "legacy",
  "tixcraft",
  "opentix",
  "livenation_tw",
];

const getDefaultEndDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 180);
  return toLocalDateInput(date);
};

async function loadKnownSourceIds(source: string, toolbeltKey: string) {
  const response = await fetch(`/api/concert-intel/known?source=${encodeURIComponent(source)}&limit=20000`, {
    headers: {
      "x-toolbelt-key": toolbeltKey,
    },
  });
  const payload = (await response.json().catch(() => null)) as { success?: boolean; source_ids?: string[] } | null;
  if (!response.ok || !payload?.success || !Array.isArray(payload.source_ids)) {
    return [];
  }
  return payload.source_ids;
}

async function runLocalCrawler(startAt: string, endAt: string) {
  const keyResponse = await fetch(`${TOOLBELT_BASE_URL}/key`);
  if (!keyResponse.ok) throw new Error("Toolbelt is not running");
  const keyPayload = (await keyResponse.json().catch(() => null)) as { key?: string } | null;
  const toolbeltKey = keyPayload?.key?.trim();
  if (!toolbeltKey) throw new Error("Toolbelt key is missing");

  let total = 0;
  let accepted = 0;
  let successCount = 0;
  const sources: CrawlResult["sources"] = [];

  for (const source of PHASE1_SOURCES) {
    const sourceLimits = PHASE1_SOURCE_LIMITS[source] ?? {
      maxPages: PHASE1_MAX_PAGES,
      maxDetailPages: PHASE1_MAX_DETAIL_PAGES,
    };
    const knownSourceIds = await loadKnownSourceIds(source, toolbeltKey);
    const crawlResponse = await fetch(`${TOOLBELT_BASE_URL}/ops/concert-intel/crawl`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-toolbelt-key": toolbeltKey,
      },
      body: JSON.stringify({
        start_at: startAt,
        end_at: endAt,
        sources: [source],
        max_pages: sourceLimits.maxPages,
        max_detail_pages: sourceLimits.maxDetailPages,
        known_source_ids: knownSourceIds,
      }),
    });
    const crawlPayload = (await crawlResponse.json().catch(() => null)) as
      | { ok?: boolean; candidates?: unknown[]; total?: number; sourceResults?: CrawlResult["sources"]; error?: string }
      | null;
    if (!crawlResponse.ok || !crawlPayload?.ok) {
      sources?.push({ source, total: 0, error: crawlPayload?.error || "Crawler failed" });
      continue;
    }

    const importResponse = await fetch("/api/concert-intel/candidates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-toolbelt-key": toolbeltKey,
      },
      body: JSON.stringify({ candidates: crawlPayload.candidates ?? [] }),
    });
    const importPayload = (await importResponse.json().catch(() => null)) as
      | { success?: boolean; accepted?: number; total?: number; error?: string }
      | null;
    if (!importResponse.ok || !importPayload?.success) {
      sources?.push({ source, total: crawlPayload.total ?? 0, error: importPayload?.error || "Candidate import failed" });
      continue;
    }

    total += crawlPayload.total ?? 0;
    accepted += importPayload.accepted ?? 0;
    successCount += 1;
    const sourceResult = crawlPayload.sourceResults?.[0] ?? { source, total: crawlPayload.total };
    sources?.push(sourceResult);
  }

  if (successCount === 0) {
    throw new Error("All crawler sources failed");
  }

  return {
    total,
    accepted,
    sources,
  };
}

export default function ConcertIntelAdmin() {
  const { candidates, radar, stats, query } = useLoaderData<ConcertIntelLoaderData>();
  const revalidator = useRevalidator();
  const [startDate, setStartDate] = useState(() => toLocalDateInput(new Date()));
  const [endDate, setEndDate] = useState(getDefaultEndDate);
  const [crawlResult, setCrawlResult] = useState<CrawlResult | null>(null);
  const [isCrawling, setIsCrawling] = useState(false);

  const statCards = useMemo(
    () => [
      ["Pending", stats.pending],
      ["Reviewed", stats.reviewed],
      ["Low confidence", stats.low_confidence],
      ["Missing time", stats.missing_sale_time],
      ["Next 14 days", stats.upcoming],
    ],
    [stats],
  );

  const handleCrawl = async () => {
    setIsCrawling(true);
    setCrawlResult(null);
    try {
      const result = await runLocalCrawler(startDate.replace(/-/g, "/"), endDate.replace(/-/g, "/"));
      setCrawlResult({
        ok: true,
        message: "Local crawl imported",
        total: result.total,
        accepted: result.accepted,
        sources: result.sources,
      });
      revalidator.revalidate();
    } catch (error) {
      setCrawlResult({
        ok: false,
        message: error instanceof Error ? error.message : "Local crawl failed",
      });
    } finally {
      setIsCrawling(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Concert Intel</p>
            <h1 className="mt-1 text-3xl font-bold">音樂售票雷達審核</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              本機 Toolbelt 負責蒐集 raw candidates，這裡負責審核、標記興趣與修正售票時間。
            </p>
            <div className="mt-4">
              <AdminNav active="concert" />
            </div>
          </div>
          <Link
            to="/ticket_radar"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
          >
            查看買票雷達
          </Link>
        </header>

        <section className="grid gap-3 md:grid-cols-5">
          {statCards.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              <div className="mt-2 text-2xl font-bold text-slate-950">{value}</div>
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap gap-3">
              <label className="text-xs font-semibold text-slate-600">
                Crawl start
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Crawl end
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={handleCrawl}
              disabled={isCrawling}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              <RefreshCw className={isCrawling ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {isCrawling ? "Crawling" : "Run local crawl"}
            </button>
          </div>
          {crawlResult ? (
            <div
              className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                crawlResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              <div className="font-semibold">{crawlResult.message}</div>
              {crawlResult.ok ? (
                <div className="mt-1 space-y-1 text-xs">
                  <div>
                    Crawled {crawlResult.total ?? 0}, imported {crawlResult.accepted ?? 0}.
                  </div>
                  {crawlResult.sources?.length ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {crawlResult.sources.map((source) => (
                        <span key={source.source}>
                          {source.source}: discovered {source.discoveredCount ?? source.total ?? 0}, new {source.total ?? 0}
                          {typeof source.skippedKnown === "number" ? `, known ${source.skippedKnown}` : ""}
                          {source.filteredOutOfRange ? `, out-of-range ${source.filteredOutOfRange}` : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-bold">審核佇列</h2>
              <p className="text-sm text-slate-500">先看 pending 與 error，AI 整理後可標成 reviewed 或 ignored。</p>
            </div>
            <Form method="get" className="flex flex-wrap gap-2">
              <select name="status" defaultValue={query.status} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="pending">Pending</option>
                <option value="reviewed">Reviewed</option>
                <option value="ignored">Ignored</option>
                <option value="error">Error</option>
                <option value="all">All</option>
              </select>
              <select name="limit" defaultValue={String(query.limit)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                {[40, 80, 150, 300].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Filter
              </button>
            </Form>
          </div>
          <CandidateTable candidates={candidates} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">售票事件雷達</h2>
          <p className="text-sm text-slate-500">以啟售時間排序，包含低信心與缺少開賣時間的待確認項目。</p>
          <RadarTable radar={radar} editable />
        </section>
      </div>
    </main>
  );
}

function CandidateTable({ candidates }: { candidates: ConcertIntelCandidateRow[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-3 pr-3">Candidate</th>
            <th className="py-3 pr-3">Source</th>
            <th className="py-3 pr-3">Event date</th>
            <th className="py-3 pr-3">Status</th>
            <th className="py-3 pr-3">Evidence</th>
            <th className="py-3 pr-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {candidates.map((candidate) => (
            <tr key={candidate.id} className="align-top">
              <td className="py-4 pr-3">
                <div className="font-semibold text-slate-950">{candidate.title}</div>
                <a href={candidate.url} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-slate-500 underline">
                  {candidate.url}
                </a>
                <div className="mt-1 text-xs text-slate-500">{candidate.venue || candidate.city || candidate.organizer || "-"}</div>
              </td>
              <td className="py-4 pr-3 text-slate-600">
                <div>{candidate.source}</div>
                <div className="text-xs text-slate-400">{candidate.source_kind}</div>
              </td>
              <td className="py-4 pr-3 text-slate-600">{formatTaipeiDateTime(candidate.event_at)}</td>
              <td className="py-4 pr-3">
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{candidate.status}</span>
                <div className="mt-1 text-xs text-slate-500">{confidenceLabel(candidate.confidence)}</div>
              </td>
              <td className="max-w-md py-4 pr-3 text-xs leading-5 text-slate-600">
                {(candidate.ai_summary || candidate.raw_excerpt || candidate.extracted_text || "-").slice(0, 280)}
              </td>
              <td className="py-4 pr-3">
                <div className="flex flex-wrap gap-2">
                  <CandidateStatusButton candidateId={candidate.id} status="reviewed" label="Reviewed" />
                  <CandidateStatusButton candidateId={candidate.id} status="ignored" label="Ignore" />
                  <CandidateStatusButton candidateId={candidate.id} status="error" label="Error" />
                </div>
              </td>
            </tr>
          ))}
          {candidates.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-slate-400">
                No candidates in this queue.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function CandidateStatusButton({ candidateId, status, label }: { candidateId: number; status: string; label: string }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="candidate-status" />
      <input type="hidden" name="candidate_id" value={candidateId} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400">
        {label}
      </button>
    </Form>
  );
}

export function RadarTable({ radar, editable = false }: { radar: ConcertIntelRadarRow[]; editable?: boolean }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-3 pr-3">Event</th>
            <th className="py-3 pr-3">Sale time</th>
            <th className="py-3 pr-3">Type</th>
            <th className="py-3 pr-3">Status</th>
            <th className="py-3 pr-3">Reason</th>
            {editable ? <th className="py-3 pr-3">Actions</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {radar.map((row) => (
            <tr key={`${row.event_id}:${row.sale_id ?? "event"}`} className="align-top">
              <td className="py-4 pr-3">
                <div className="font-semibold text-slate-950">{row.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  演出 {formatTaipeiDateTime(row.event_at)} · {[row.city, row.venue].filter(Boolean).join(" / ") || "-"}
                </div>
                <a href={row.source_url || row.url} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-slate-500 underline">
                  {row.source}
                </a>
                {row.feedback ? <div className="mt-1 text-xs font-semibold text-emerald-700">{row.feedback}</div> : null}
              </td>
              <td className="py-4 pr-3 font-semibold text-slate-900">{formatTaipeiDateTime(row.sale_start_at)}</td>
              <td className="py-4 pr-3 text-slate-600">{row.sale_type || "-"}</td>
              <td className="py-4 pr-3">
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                  {saleStatusLabel(row.sale_status)}
                </span>
                <div className="mt-1 text-xs text-slate-500">{confidenceLabel(row.confidence)}</div>
              </td>
              <td className="max-w-md py-4 pr-3 text-xs leading-5 text-slate-600">
                {(row.ai_reason || row.source_text || "Awaiting AI review").slice(0, 320)}
              </td>
              {editable ? (
                <td className="py-4 pr-3">
                  <div className="flex flex-col gap-2">
                    {row.sale_id ? <SaleEditForm row={row} /> : null}
                    <FeedbackButton eventId={row.event_id} feedbackType="want_to_go" label="想看" />
                    <FeedbackButton eventId={row.event_id} feedbackType="not_interested" label="沒興趣" />
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
          {radar.length === 0 ? (
            <tr>
              <td colSpan={editable ? 6 : 5} className="py-8 text-center text-slate-400">
                No ticket sales are ready yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function SaleEditForm({ row }: { row: ConcertIntelRadarRow }) {
  return (
    <Form method="post" className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
      <input type="hidden" name="intent" value="sale-update" />
      <input type="hidden" name="sale_id" value={row.sale_id ?? ""} />
      <input
        type="datetime-local"
        name="sale_start_at"
        defaultValue={formatDateInputValue(row.sale_start_at)}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <select name="sale_type" defaultValue={row.sale_type ?? "unknown"} className="w-28 rounded-md border border-slate-300 px-2 py-1 text-xs">
          {SALE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          name="confidence"
          type="number"
          min="0"
          max="1"
          step="0.05"
          defaultValue={String(row.confidence ?? 0)}
          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </div>
      <select name="status" defaultValue={row.sale_status ?? "reviewed"} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
        <option value="reviewed">Reviewed</option>
        <option value="low_confidence">Low confidence</option>
        <option value="missing_sale_time">Missing sale time</option>
        <option value="ignored">Ignored</option>
      </select>
      <button type="submit" className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white">
        Save
      </button>
    </Form>
  );
}

function FeedbackButton({ eventId, feedbackType, label }: { eventId: number; feedbackType: string; label: string }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="feedback" />
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="feedback_type" value={feedbackType} />
      <button type="submit" className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400">
        {label}
      </button>
    </Form>
  );
}
