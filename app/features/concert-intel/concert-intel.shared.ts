export const CONCERT_INTEL_DEFAULT_STATUS = "pending";
export const CONCERT_INTEL_TIMEZONE = "Asia/Taipei";

export const CANDIDATE_STATUS_OPTIONS = [
  "pending",
  "reviewed",
  "ignored",
  "error",
] as const;

export const SALE_STATUS_OPTIONS = [
  "reviewed",
  "low_confidence",
  "missing_sale_time",
  "upcoming",
  "ignored",
] as const;

export const SALE_TYPE_OPTIONS = [
  { value: "public_sale", label: "Public sale" },
  { value: "presale", label: "Presale" },
  { value: "lottery", label: "Lottery" },
  { value: "release", label: "Ticket release" },
  { value: "deadline", label: "Deadline" },
  { value: "unknown", label: "Unknown" },
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUS_OPTIONS)[number];
export type SaleStatus = (typeof SALE_STATUS_OPTIONS)[number];
export type SaleType = (typeof SALE_TYPE_OPTIONS)[number]["value"];

export type ConcertCrawlCandidateInput = {
  source: string;
  source_id?: string | null;
  source_kind?: string | null;
  title: string;
  url: string;
  event_at?: string | null;
  venue?: string | null;
  city?: string | null;
  organizer?: string | null;
  extracted_text?: string | null;
  raw_excerpt?: string | null;
  evidence_json?: string | null;
  source_payload_json?: string | null;
  content_hash?: string | null;
  parser_version?: string | null;
  status?: CandidateStatus | string | null;
  confidence?: number | null;
  ai_summary?: string | null;
  error_message?: string | null;
  crawled_at?: string | null;
};

export type ReviewedTicketSaleInput = {
  sale_type?: SaleType | string | null;
  sale_start_at?: string | null;
  sale_end_at?: string | null;
  timezone?: string | null;
  confidence?: number | null;
  source_text?: string | null;
  source_url?: string | null;
  ai_reason?: string | null;
  status?: SaleStatus | string | null;
};

export type ReviewedConcertInput = {
  candidate_id?: number | null;
  source: string;
  source_id?: string | null;
  title: string;
  url: string;
  event_at?: string | null;
  venue?: string | null;
  city?: string | null;
  organizer?: string | null;
  artist_text?: string | null;
  status?: string | null;
  ai_summary?: string | null;
  ticket_sales?: ReviewedTicketSaleInput[];
};

export type ReviewedCandidateUpdateInput = {
  candidate_id?: number | null;
  status?: CandidateStatus | string | null;
  ai_summary?: string | null;
  error_message?: string | null;
};

export type ConcertIntelCandidateRow = {
  id: number;
  source: string;
  source_id: string;
  source_kind: string;
  title: string;
  url: string;
  event_at: string | null;
  venue: string | null;
  city: string | null;
  organizer: string | null;
  extracted_text: string;
  raw_excerpt: string;
  evidence_json: string;
  source_payload_json: string;
  content_hash: string;
  parser_version: string;
  status: string;
  confidence: number;
  ai_summary: string;
  error_message: string;
  crawled_at: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ConcertIntelRadarRow = {
  event_id: number;
  sale_id: number | null;
  title: string;
  source: string;
  source_id: string;
  url: string;
  event_at: string;
  venue: string | null;
  city: string | null;
  organizer: string | null;
  artist_text: string | null;
  event_status: string | null;
  sale_type: string | null;
  sale_start_at: string | null;
  sale_end_at: string | null;
  timezone: string | null;
  confidence: number | null;
  source_text: string | null;
  source_url: string | null;
  ai_reason: string | null;
  sale_status: string | null;
  last_checked_at: string | null;
  feedback: string | null;
};

export type ConcertIntelStats = {
  pending: number;
  reviewed: number;
  low_confidence: number;
  missing_sale_time: number;
  upcoming: number;
};

export type ConcertIntelQuery = {
  status: string;
  limit: number;
};

export type ConcertIntelLoaderData = {
  candidates: ConcertIntelCandidateRow[];
  radar: ConcertIntelRadarRow[];
  stats: ConcertIntelStats;
  query: ConcertIntelQuery;
};

export type PublicTicketRadarLoaderData = {
  radar: ConcertIntelRadarRow[];
  stats: ConcertIntelStats;
};
