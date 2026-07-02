# Concert Intel Source Feasibility

Last verified: 2026-06-22, Asia/Taipei.

This document records which ticketing and organizer websites are currently useful for the ticket radar. The score is based on whether we can reliably obtain: event list, detail URL, event date, venue, sale-time source text, duplicate signals, and whether the site needs Playwright.

## Current Discovery Contract (Authoritative)

The crawler must discover current candidates from each site's own date sequence before opening detail URLs. Search results, home-page recommendation order, and historical database rows are not discovery sources.

| Source | Current discovery input | Ordering/filter rule |
| --- | --- | --- |
| KKTIX | `https://dir.registrano.com/events` with `start_at`, `end_at`, and music tag ids `13,1,6,7,9,29` | Reject pinned/out-of-range rows locally, then sort by `start_at` ascending. |
| Kham | Concert category `CATEGORY=205` and music category `CATEGORY=77` | Discover only category product links. After detail extraction, reject an explicit out-of-range performance date. Keep undated rows for review. |
| Ticket Plus | `main/mainEvents.json` | Filter `start_date` to the requested range, sort by performance date, then `exposeStart` descending as a tie-breaker. |
| iNDIEVOX | `/activity?type=card&startDate=YYYY/MM/DD&endDate=YYYY/MM/DD` | The API requires slash-formatted dates. Parse and sort list-card performance dates ascending. |
| tixCraft | `/activity` | Parse `.eventbl` cards, filter the complete list to the requested range, then sort performance dates ascending before selecting detail URLs. |
| OPENTIX | `https://csm.api.opentix.life/programs?page=N&rowCount=50` | Keep `displayCategory === "音樂"`, filter `startDateTime`, sort ascending. |
| Live Nation Taiwan | `/api/search/events` with `DateFrom`, `DateTo`, music genres, `X-Site`, and `X-Culture` | Use API event dates and order ascending. Preserve `announceDateUtc`, `modified`, and ticket validity as freshness/sale evidence. |
| Legacy | Taipei, Taichung, Max, Mini, and Great topic pages | Parse `.program_list` dates, filter requested range, sort ascending. |

Every crawl response reports:

- `discoveredCount`: URLs/events found by the current date-sequence discovery step.
- `skippedKnown`: discovered source IDs already supplied through `known_source_ids`; their detail pages are not fetched.
- `total`: new candidates actually returned in this batch, capped by `max_detail_pages`.
- `filteredOutOfRange`: candidates rejected after a detail page exposed an explicit performance date outside the requested range.

An update still reads each lightweight list/API once so it can discover new URLs. It does not reopen a known detail URL. When more unknown URLs exist than `max_detail_pages`, successive runs consume the next backlog batch; this is expected and is not duplicate refetching.

## Evidence Indexing v1

Implemented on 2026-06-23. The crawler now returns indexed messy evidence for every source instead of only raw text:

- `evidence_json`: small keyword windows around sale-related terms such as `啟售`, `開賣`, `抽選`, `預售`, `截止`, `exposeStart`, and `validFromUtc`.
- `source_payload_json`: source-specific raw-ish payload, kept as JSON text. It is intentionally not normalized across platforms.
- `content_hash`: sha256 of the candidate's stable content and payload.
- `parser_version`: source parser/indexer version.

This is not final structured parsing. It is an evidence store so AI review can read short, indexed slices from D1 without reopening the source page.

Smoke test on 2026-06-23, one candidate per source:

| Source | Parser version | Evidence result | Payload result | Current difficulty |
| --- | --- | --- | --- | --- |
| KKTIX | `kktix-evidence-v1` | `register_status` / sale metadata window when available | List payload | Medium. Large volume and noisy categories; detail ticket blocks remain inconsistent. |
| Kham | `kham-evidence-v1` | `開賣`, `截止`, `購票` windows | List link + detail text | Medium-high. Useful sale text exists, but old WebForms pages require detail/order-page reading. |
| Ticket Plus | `ticketplus-s3-evidence-v1` | Sale windows or fallback summary | `main_event`, `event`, `sessions`, `products` | Low-medium. API payload is good; AI still needs to distinguish `exposeStart` from real sale text. |
| iNDIEVOX | `indievox-evidence-v1` | `售票時間` window | List payload + detail text | Medium. Detail pages are readable, but formatting varies. |
| tixCraft | `tixcraft-evidence-v1` | `開賣`, `截止`, `拓元`, `購票` windows | List payload + detail text | Medium-high. Sale information can be in announcement blocks, ticket links, or multiple related pages. |
| OPENTIX | `opentix-evidence-v1` | `銷售` / sale-related windows | List payload + detail text | High. Very high volume and many classical/arts events; AI filtering matters. |
| Live Nation Taiwan | `livenation-api-evidence-v1` | `開賣`, `正式開賣`, `validFromUtc` windows | API `document`, `localization`, `tickets` | Low-medium. API is strong; AI mainly resolves public sale vs presales. |
| Legacy | `legacy-evidence-v1` | `預售`, `購票` windows | List link + detail text | Medium-high. Announcement text is useful, but final sale may be on external platforms. |

Storage direction:

1. Discovery stays lightweight and still uses known URL/source ID skipping.
2. Detail fetch stores raw text plus indexed evidence and source-specific payload.
3. AI review reads `review-packet`, which now prefers stored `evidence_json` and falls back to live slicing only for legacy rows.
4. Existing rows can remain `parser_version = legacy`; they will be upgraded naturally when refetched or upserted.

## Minimal Review Packet v1

Implemented on 2026-06-23. `GET /api/concert-intel/review-packet` now defaults to `mode=compact`; use `mode=full` only for debugging. Compact packets include:

- candidate identity and event metadata;
- compact `evidence_windows` with per-source budgets;
- source-specific payload summaries, not full source payloads;
- `packet_hints` with duplicate title key and likely-noise hints;
- `content_hash` and `parser_version`.

One-row smoke test after compacting:

| Source | Compact bytes | Full bytes | Reduction | Noise hint observed |
| --- | ---: | ---: | ---: | --- |
| KKTIX | 2,032 | 2,761 | 26% | `exhibition_or_non_performance_event` |
| Kham | 4,217 | 50,790 | 92% | none |
| Ticket Plus | 2,098 | 2,266 | 7% | `hub_or_cross_border_ticket_page` |
| iNDIEVOX | 2,419 | 7,436 | 67% | none |
| tixCraft | 4,124 | 17,912 | 77% | `sports_or_non_music_event` |
| OPENTIX | 3,852 | 31,456 | 88% | none |
| Live Nation Taiwan | 4,581 | 12,097 | 62% | none |
| Legacy | 3,005 | 12,065 | 75% | none |

Target for AI review is normally one compact packet row at a time, or small batches grouped by source. OPENTIX should stay in smaller batches because the source has high volume and mixed music/classical/family programming.

## 2026-06-22 Range Test

Range: `2026-06-22` through `2026-12-19`; maximum 20 returned candidates per source.

| Source | Returned | Explicitly out of range | Observed performance-date span |
| --- | ---: | ---: | --- |
| KKTIX | 20 | 0 | 2026-06-22 to 2026-06-27 |
| Kham | 16 | 0 | 2026-07-10 to 2026-10-17 |
| Ticket Plus | 20 | 0 | 2026-06-25 to 2026-07-05 |
| iNDIEVOX | 20 | 0 | 2026-06-26 to 2026-07-12 |
| tixCraft | 20 | 0 | 2026-06-27 to 2026-07-15 |
| OPENTIX | 20 | 0 | 2026-06-22 to 2026-06-28 |
| Live Nation Taiwan | 20 | 0 | 2026-06-27 to 2026-11-21 |
| Legacy | 20 | 0 | 2026-06-26 to 2026-09-20 |

Kham initially returned one category-listed product whose parsed performance date was in 2023. The post-detail range gate now rejects it and reports `filteredOutOfRange: 1`. iNDIEVOX initially returned zero because the request used ISO hyphens instead of the site's required slashes. tixCraft initially returned zero because the card lookup selected an inner `div`; discovery now scopes to `.eventbl`.

## Priority Summary

| Priority | Source | Feasibility | Best Use | Notes |
| --- | --- | --- | --- | --- |
| P0 | Kham 寬宏 | High | Ticket platform detail source | Live-tested in toolbelt. Detail + order pages expose event date and sale text. |
| P0 | iNDIEVOX | High | Ticket platform detail source | Detail pages expose event info and sale time in plain HTML. |
| P0 | Legacy | High | Organizer announcement source | Detail pages expose sale text and link to iNDIEVOX. Strong duplicate-pair source. |
| P0 | tixCraft | High | Ticket platform detail source | List and detail pages expose sale phases, presale, public sale, venue, date. |
| P0 | Live Nation Taiwan | High | Organizer announcement source | Detail pages expose public sale text and link to ticket platforms. |
| P1 | KKTIX | Medium-high | Ticket platform detail/list source | Useful data exists, but direct fetch may return 403. Prefer Playwright plus detail-page fallback. |
| P1 | Ticket Plus | Medium-high | Ticket platform API source | Live-tested via public S3 JSON API. Strong data, but needs noise/duplicate filtering. |
| P1 | ERA 年代 | Medium-high | Ticket platform list/detail source | Home/list exposes on-sale previews. Detail pages vary in completeness. |
| P2 | OPENTIX | Medium | Arts/music ticket platform | Search-indexed detail text exposes some sale info, but event pages can be JS-heavy and category is broad. |
| P3 | ibon | Medium-low | Supplemental ticket platform | Search/detail availability inconsistent from crawler perspective. Useful later, not first parser target. |

## Verified Sample URLs

Use these pages as crawler/parser fixtures before expanding each source. They are intentionally real current pages, not synthetic examples.

| Source | Sample URL | Useful fields observed |
| --- | --- | --- |
| iNDIEVOX list | `https://www.indievox.com/activity` | Event date, title, detail URL. |
| iNDIEVOX detail | `https://www.indievox.com/activity/detail/26_iv040619b` | Title, event date, venue, artist, price, public sale time, accessibility-sale time. |
| Legacy detail | `https://www.legacy.com.tw/article/page/taichung/3175` | Organizer, venue, event date, price, public sale time, outbound iNDIEVOX ticket URL. |
| tixCraft list | `https://tixcraft.com/activity` | Event date range, title, venue, detail URL, duplicate title signals such as card campaigns. |
| tixCraft detail | `https://tixcraft.com/activity/detail/26_kumachan` | Event dates, venue, organizer, presale window, public sale time. |
| Kham detail | `https://kham.com.tw/application/UTK02/UTK0201_.aspx?PRODUCT_ID=P1AQ3JFM` | Release sale time, public sale time, organizer, purchase rules. |
| ERA homepage | `https://www.ticket.com.tw/` | Recent shows, preview shows, preview sale times. |
| Live Nation homepage | `https://www.livenation.com.tw/` | Organizer event list, artist/event links, duplicate signal against tixCraft/KKTIX. |
| Ticket Plus list | `https://ticketplus.com.tw/activity` | JS-only shell; use as Playwright/API-inspection target. |

## Live Test Results

Tested through local toolbelt on 2026-06-18:

```json
{
  "request": {
    "endpoint": "/ops/concert-intel/crawl",
    "sources": ["kham", "kktix", "ticketplus"],
    "max_pages": 1,
    "max_detail_pages": 5
  },
  "result": {
    "ok": true,
    "total": 15,
    "pagesFetched": 3,
    "partial": false,
    "sourceResults": [
      { "source": "kham", "total": 5, "pagesFetched": 1 },
      { "source": "kktix", "total": 5, "pagesFetched": 1 },
      { "source": "ticketplus", "total": 5, "pagesFetched": 1 }
    ]
  }
}
```

Expanded P0/P1 smoke test after crawler hardening:

```json
{
  "request": {
    "endpoint": "/ops/concert-intel/crawl",
    "sources": [
      "kham",
      "kktix",
      "ticketplus",
      "indievox",
      "legacy",
      "tixcraft",
      "livenation_tw"
    ],
    "max_pages": 1,
    "max_detail_pages": 3
  },
  "result": {
    "ok": true,
    "total": 21,
    "pagesFetched": 7,
    "partial": false,
    "sourceResults": [
      { "source": "kham", "total": 3, "pagesFetched": 1 },
      { "source": "kktix", "total": 3, "pagesFetched": 1 },
      { "source": "ticketplus", "total": 3, "pagesFetched": 1 },
      { "source": "indievox", "total": 3, "pagesFetched": 1 },
      { "source": "legacy", "total": 3, "pagesFetched": 1 },
      { "source": "tixcraft", "total": 3, "pagesFetched": 1 },
      { "source": "livenation_tw", "total": 3, "pagesFetched": 1 }
    ]
  }
}
```

Implementation observations:

- Kham is now a P0 source. The crawler must use `PRODUCT_ID` as the stable key, read the info page, and also read the `_00.aspx` order page for true event date/venue rows. The visible page text alone can miss hidden sale tabs.
- KKTIX works in a fresh non-persistent Playwright context. The persistent profile triggered a Cloudflare verification page during testing. The crawler now uses a clean context for `concert-intel/crawl`.
- KKTIX raw candidates are noisy. Current list samples include valid music events plus education, venue-rental, and KKTIX demo pages. AI/noise filtering is mandatory before reviewed import.
- Ticket Plus should use the public JSON source behind the frontend, not DOM scraping. The useful endpoints are:
  - `https://apis.ticketplus.com.tw/config/api/v1/getS3?path=main/mainEvents.json`
  - `https://apis.ticketplus.com.tw/config/api/v1/getS3?path=event/{eventId}/event.json`
  - `https://apis.ticketplus.com.tw/config/api/v1/getS3?path=event/{eventId}/sessions.json`
  - `https://apis.ticketplus.com.tw/config/api/v1/getS3?path=event/{eventId}/products.json`
- Ticket Plus raw candidates include strong sale evidence, e.g. `啟售時間`, `開賣時間`, `登記抽選`, and product `exposeStart`. It also includes hub/noise pages such as `Tickets in Japan`, so noise filtering remains required.
- iNDIEVOX now uses a dedicated detail reader for `演出地點` and `演出者`, avoiding generic cookie/footer false positives.
- Legacy now uses a dedicated detail reader for `演出場地` and `主辦單位`.
- tixCraft now uses list-card discovery for event date/title/venue, then detail-page crawling for sale text. This avoids mistaking sale dates for performance dates.
- Live Nation Taiwan discovery now uses `/event/` links. Treat this as an organizer source and use the linked ticket-platform URL/title/date as duplicate evidence.

## P0 Sources

### Kham 寬宏

Status: highly usable; promoted to P0 after live toolbelt test.

Observed strengths:

- Homepage exposes many event links with `PRODUCT_ID`.
- Detail pages expose sale tabs in hidden DOM content.
- Order pages expose concrete event date rows.
- Good explicit sale phrases:
  - `原音娛樂會員優先購票：2026年05月13日(三)中午12點 至 05月15日(五)下午6點`
  - `全面開賣：2026年05月20日(三)中午12點`
  - `釋票啟售：2026年06月05日(五)中午12點`

Crawler approach:

- Discover from homepage/category pages.
- Use `PRODUCT_ID` as source id.
- Fetch both:
  - `/application/UTK02/UTK0201_.aspx?PRODUCT_ID=...`
  - `/application/UTK02/UTK0201_00.aspx?PRODUCT_ID=...`
- Prefer `_00` order-page date for `event_at`; use info-page hidden tabs for sale text.
- Parser should support Chinese year/month/day format and `上午/中午/下午/晚上`.

Risks:

- Many package/VIP/benefit pages point to related parent events.
- Some pages have sale info buried in purchase rules, so parser must isolate sale phrases.

### iNDIEVOX

Status: highly usable.

Observed strengths:

- `/activity` list page exposes dated event links even without active browser JS.
- Detail pages expose structured text for event date, venue, artist, price, and sale time.
- Good explicit sale phrases:
  - `售票時間：2026/05/19（二）12:00 開始販售`
  - `一般預售票開賣時間：2026/05/19（星期二）12：00`

Crawler approach:

- Use list page for discovery.
- Use detail page as a high-confidence source for `event_at`, `venue`, `artist_text`, `price_text`, and `sale_start_at`.
- Parser should treat `售票時間` and `一般預售票開賣時間` as public sale.
- Dedicated toolbelt reader extracts `演出地點` and `演出者`.

Risks:

- Some pages include long notice text. Parser must prefer the top event info block and sale-time lines.

### Legacy

Status: highly usable.

Observed strengths:

- Homepage/topic page exposes current events with city, date, title, and BUY links.
- Detail pages expose organizer, venue, address, event date, entry time, start time, price, and sale text.
- Legacy often links to iNDIEVOX, making it ideal for duplicate testing.
- Good explicit sale phrase:
  - `開放售票：2026/05/19（二）中午12:00準時開賣；預售至演出前一日止`

Crawler approach:

- Use Legacy list pages for discovery.
- Detail crawler must extract only the main activity block and avoid footer/recommended events.
- Parser should map `開放售票` to `public_sale`.
- Use outbound ticket URL as duplicate signal with iNDIEVOX.
- Dedicated toolbelt reader extracts `演出場地` and `主辦單位`.

Risks:

- Detail page includes recommended activity cards after the main event. Raw text must be scoped to main content.

### tixCraft

Status: highly usable.

Observed strengths:

- `/activity` list exposes many events with dates, venues, and detail links.
- Detail pages expose show date, venue, ticket prices, presale phase, public sale, official sale links, and notice text.
- Good explicit sale phrases:
  - `Planet K 會員預售 時間：2026/6/01（一）10:00~2026/6/03（三）10:00`
  - `正式開賣 時間：2026/6/03 (三) 13:00 PM`

Crawler approach:

- Use `/activity` for discovery.
- Use list-card date/title/venue as the primary performance metadata.
- Use detail page tabs/sections as raw source.
- Parser should support multiple ticket_sale rows per event: presale and public sale.
- Noise classifier must filter add-on pages, VIP upgrade pages, shuttle bus pages, sports pages.

Risks:

- tixCraft contains many duplicate/add-on pages, e.g. Mastercard area, VIP upgrade, bus packages.
- Requires duplicate grouping and noise classification earlier than other sources.

### Live Nation Taiwan

Status: highly usable.

Observed strengths:

- Homepage exposes current artist/activity links.
- Detail pages expose event date, venue, price, category, ticket platform, and sale text.
- Good explicit sale phrase:
  - `全面開賣 2026/6/9 12PM 拓元售票系統`

Crawler approach:

- Use homepage and `/event/` links for discovery.
- Treat Live Nation as organizer announcement source, not final ticket platform source.
- Use linked platform/ticket CTA as duplicate signal with tixCraft or other ticketing site.

Risks:

- Some pages have artist-level routes rather than event-level routes.
- Must identify actual event cards inside artist pages.

## P1 Sources

### KKTIX

Status: useful but fetch-sensitive.

Observed strengths:

- Search-indexed pages and snippets expose sale-time phrases such as `售票時間`, `啟售時間`, `正式啟售`, and `開賣中`.
- Existing project already has KKTIX list parser using `data-react-props`.

Observed issue:

- Direct fetch to `https://kktix.com/events?event_tag_ids_in=1` may return 403 in simple HTTP contexts.

Crawler approach:

- Keep Playwright path as primary.
- Use list page only when Playwright can load it.
- Use known detail URLs as fallback from search, historical DB, or organizer outbound links.
- Parser should support both list card status (`開賣中`, `12小時後開賣`) and detail body sale text.

Risks:

- Anti-bot behavior.
- Some events are outside Taiwan or non-music despite event tags.

### ERA 年代

Status: medium-high.

Observed strengths:

- Homepage exposes `近期節目` and `節目預告`.
- Preview list includes on-sale phrases:
  - `06/12(五) 下午17:00開賣`
  - `05/30(六)中午12:00開賣`
- Category filters are visible in HTML.

Crawler approach:

- Start with homepage/preview list for on-sale radar.
- Detail pages are useful but may vary; use list as primary sale-time source when present.
- Parser must infer year from current/near future context carefully.

Risks:

- Detail pages sometimes have sparse or JS-dependent content.
- Broader arts categories create more noise.

## P2 Sources

### OPENTIX

Status: medium.

Observed strengths:

- Search-indexed OPENTIX event pages expose category, organizer, event description, and sale text.
- Good sale phrases:
  - `四月十七日（五）中午12:00 正式啟售`
  - `5/17(一)12:00起 全面啟售`

Crawler approach:

- Use search/list routes if Playwright can expose stable event cards.
- Detail page parser should handle `購票資訊`, `折扣方案`, and event description.
- Strong category filter: keep `音樂`, `演唱會`, selected music theatre if desired.

Risks:

- Many OPENTIX events are theatre, dance, classical, lectures, or broad arts events.
- Simple HTTP can be incomplete; likely needs Playwright for robust list crawling.

OPENTIX music filtering update:

- The public programs API has a reliable top-level `displayCategory`; the crawler should keep only `displayCategory === "音樂"`.
- This solves the first-layer music/non-music split, but OPENTIX's music category is broad. It includes pop/showcase events, musical theatre, family concerts, choir, orchestra, student recitals, and classical programming.
- Review packets now expose `packet_hints.music_profile` for OPENTIX:
  - `candidate_popular_live`: likely higher-priority popular/live/showcase rows.
  - `stage_or_family_music`: musical theatre, family, children, or animation music.
  - `classical_academic_or_low_default_interest`: orchestra, choir, recital, student/amateur, academic, or classical rows.
  - `music_other`: music category rows without a stronger subtype signal.
- Future OPENTIX crawls also preserve list-level `display_category`, `min_price`, `max_price`, and `event_count` in the source payload so AI review can avoid rereading full detail text.

### Ticket Plus

Status: medium-high after API inspection.

Observed strengths:

- Public frontend data is available through stable JSON endpoints.
- `main/mainEvents.json` returned 100 current events during live testing.
- Event JSON exposes title, venue, organizer, announcement, info, sessions, and products.
- Product records expose `exposeStart` / `exposeEnd`, useful as fallback sale windows.
- Ticket Plus has many Japan/Taiwan music events,抽選, and livehouse-type events that fit the radar.

Observed issue:

- Direct HTML shell says the app needs JavaScript.
- Some event records are hub pages or duplicate抽選/public-sale pairs.

Crawler approach:

- Use API, not DOM:
  - `main/mainEvents.json` for discovery.
  - `event/{eventId}/event.json` for announcement and sale text.
  - `event/{eventId}/sessions.json` for event dates and venues.
  - `event/{eventId}/products.json` for product exposure windows.
- Keep抽選 and public-sale records as separate raw candidates until AI duplicate grouping.

Risks:

- Hub/noise pages such as `Tickets in Japan`.
- Duplicate pairs: `登記抽選` and public sale often have different event ids but same artist/date/venue.

### ibon

Status: medium-low for v1.

Observed strengths:

- Search results and some details expose music events.
- Good as a supplemental platform for larger mainstream concerts.

Observed issue:

- Direct crawler access is inconsistent in simple HTTP context.
- Some content appears behind dynamic routes/search.

Crawler approach:

- Defer until P0/P1 sources are stable.
- Later inspect detail pages with Playwright and identify stable APIs.

Risks:

- Broader category/noise.
- Potential anti-bot or dynamic rendering.

## Implementation Order Recommendation

1. Legacy parser and scoped main-content extraction.
2. iNDIEVOX parser.
3. tixCraft parser with duplicate/noise handling.
4. Live Nation parser as organizer announcement source.
5. Kham parser.
6. KKTIX Playwright hardening.
7. ERA preview-list parser.
8. OPENTIX Playwright/API inspection.
9. Ticket Plus API inspection.
10. ibon exploration.

## Parser Test Seeds

Use these exact source-text patterns as parser fixtures:

- `售票時間：2026/05/19（二）12:00 開始販售`
- `一般預售票開賣時間：2026/05/19（星期二）12：00`
- `開放售票：2026/05/19（二）中午12:00準時開賣；預售至演出前一日止`
- `正式開賣 時間：2026/6/03 (三) 13:00 PM`
- `Planet K 會員預售 時間：2026/6/01（一）10:00~2026/6/03（三）10:00`
- `全面開賣 2026/6/9 12PM 拓元售票系統`
- `釋票啟售：2026年06月05日(五)中午12點。`
- `全面開賣：2026年05月29日(五)中午12點。`
- `06/12(五) 下午17:00開賣`
- `四月十七日（五）中午12:00 正式啟售`
