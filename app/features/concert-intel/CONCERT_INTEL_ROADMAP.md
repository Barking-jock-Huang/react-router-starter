# 音樂售票雷達 Roadmap

這份文件是 `concert-intel` 後續實作與實測的共同工作清單。目標不是建立一個演唱會百科，而是建立一套能穩定回答「哪些活動值得注意、什麼時候啟售、哪些資料該忽略或合併」的更新流程。

## 1. 產品目標

售票雷達的核心價值是啟售提醒，不是演出日期提醒。

系統要能做到：

- 自動從售票平台與主辦公告頁收集活動候選資料。
- 優先解析 `啟售時間`、`預售時間`、`抽選登記/截止`、`加場開賣`、`釋票`。
- 把無用活動、非音樂活動、資訊不足活動與重複活動降噪。
- 由 AI 在單一集中步驟完成最後判讀，而不是散落在爬蟲、parser、UI 各處。
- 讓網站只呈現「買票行動清單」與「待確認清單」。

非目標：

- 不爬社群動態牆。
- 不讓 Worker 長時間跑 Playwright。
- 不在網站部署後自動呼叫 OpenAI API。
- 不把所有活動都當成同等重要的資料庫收藏。

## 2. 資料生命週期

資料必須明確分階段，避免 raw 資料、規則解析結果、AI 判讀結果混在一起。

```txt
Crawler raw candidate
→ Rule parser result
→ AI review packet
→ AI reviewed payload
→ Published ticket radar
```

### 2.1 Raw candidate

由 crawler 產生，代表「來源頁上可能是一個音樂活動」。raw candidate 不應假裝自己已經理解啟售時間。

必要欄位：

- `source`
- `source_id`
- `source_kind`
- `title`
- `url`
- `event_at`
- `venue`
- `city`
- `organizer`
- `extracted_text`
- `raw_excerpt`
- `crawled_at`
- `status`
- `confidence`
- `error_message`

驗收標準：

- 每筆 candidate 必須有來源 URL。
- 每筆 candidate 必須保留足夠原文，讓 AI 或人工能回頭判讀。
- crawler 失敗時仍可產生 `status = error` 的 candidate 或 source-level error，不阻斷整批流程。

### 2.2 Rule parser result

由程式規則從 raw candidate 的 `extracted_text` 中抽售票資訊。parser 的責任是先處理明確、常見、可測的文字格式，降低 AI 工作量。

必要欄位：

- `candidate_id`
- `sale_type`
- `sale_start_at`
- `sale_end_at`
- `timezone`
- `source_text`
- `parser_reason`
- `confidence`
- `status`

常見 status：

- `parsed`
- `low_confidence`
- `missing_sale_time`
- `not_music`
- `duplicate_candidate`
- `noise`

驗收標準：

- 明確日期時間必須由 parser 抽出，不交給 AI 猜。
- parser 必須保留觸發解析的原文片段。
- parser 不確定時要標低信心，不可靜默填錯時間。

### 2.3 AI review packet

AI 只讀 review packet，不直接讀整個資料庫，不直接亂查所有頁面。review packet 是 AI 判讀的唯一入口。

內容：

- 一批 raw candidates。
- parser results。
- 來源原文片段。
- 可能重複的 existing events。
- 使用者偏好與排除規則。
- parser 無法判斷的疑點。

### 2.4 AI reviewed payload

AI 的唯一輸出是 reviewed payload。AI 不直接改 DB，只輸出結構化 JSON，交給 import API 寫入。

內容：

- `events`
- `ticket_sales`
- `rejected_candidates`
- `duplicate_links`
- `needs_human_check`
- `summary`

### 2.5 Published ticket radar

正式頁面只看 reviewed 資料與人工回饋，主排序依售票時間，不依演出日期。

預設區塊：

- 即將啟售。
- 高興趣。
- 低信心待確認。
- 缺少啟售時間。
- 已忽略。

## 3. AI 的唯一介入步驟

AI 最重要的任務是：

1. 理解啟售時間與售票事件。
2. 判斷無用活動或非目標活動。
3. 合併重複活動。
4. 把多來源指向同一活動的資料整理成一個 reviewed event。

AI 不負責：

- 自己發明來源。
- 長時間爬網頁。
- 直接修改資料庫。
- 取代可測的時間 parser。

唯一 AI 步驟：

```txt
GET review packet
→ AI read and decide
→ POST reviewed payload
```

詳細 protocol 見 `CONCERT_INTEL_AI_REVIEW_PROTOCOL.md`。

## 4. 階段代辦清單

### Phase 0: 文件與基準

- [ ] 把現有骨架整理成乾淨 commit，避免混入其他 feature。
- [x] 新增 roadmap 文件。
- [x] 新增 AI review protocol 文件。
- [ ] 後台標示 candidate 階段：`raw`、`parsed`、`ai_reviewed`、`published`。
- [ ] 增加「本次更新摘要」區塊。

驗收：

- 任一 AI 接手時，能只看文件知道下一步該做什麼。
- 後台能看出每筆資料目前處於哪個階段。

### Phase 1: 專屬 crawler

目前 `concert-intel/crawl` 有來源設定與通用抽取器，但產品價值不足。下一步要逐站變成專屬 crawler。

#### KKTIX

- [ ] 列表頁抓活動 ID、標題、演出日期、公開 URL。
- [ ] 詳情頁抓完整活動說明。
- [ ] 抽活動地點、票價、售票狀態、主辦。
- [ ] 把 KKTIX challenge/error 變成 source-level error。

實測案例：

- [ ] 至少 2 個近期音樂活動。
- [ ] 至少 1 個沒有明確啟售時間的活動。
- [ ] 至少 1 個售完或已開賣活動。

#### iNDIEVOX

- [ ] 列表頁抓活動卡片與詳情 URL。
- [ ] 詳情頁抓活動描述、票價、售票段落。
- [ ] 正確處理 Legacy 跳轉到 iNDIEVOX 購票頁的情境。

實測案例：

- [ ] 至少 2 個近期音樂活動。
- [ ] 至少 1 個 Legacy 來源導向 iNDIEVOX 的活動。

#### Legacy

- [ ] 活動頁抓標題、場館、地址、演出日期、票價。
- [ ] 抽 `開放售票：...準時開賣` 段落。
- [ ] 抽 `預售至演出前一日止` 作為 sale_end_at 候選。
- [ ] 避免把頁尾推薦活動混入主活動內容。

實測案例：

- [ ] `開放售票：2026/05/19（二）中午12:00準時開賣` 必須進 parser。
- [ ] 台北、台中場館各至少 1 筆。

#### Live Nation Taiwan

- [ ] 活動列表抓 show URL。
- [ ] 詳情頁抓 general sale、presale、VIP package、ticket link。
- [ ] 區分「演出時間」與「售票時間」。
- [ ] 保留英文原文供 AI 判讀。

實測案例：

- [ ] 至少 1 筆 general sale。
- [ ] 至少 1 筆 presale。

#### OPENTIX

- [ ] 活動列表抓詳情 URL。
- [ ] 詳情頁抓節目時間、啟售/停售資訊。
- [ ] 判斷是否音樂演出。

#### Ticket Plus

- [ ] 活動列表抓詳情 URL。
- [ ] 詳情頁抓售票時間、活動時間、地點。
- [ ] 處理 JS rendered content。

#### tixCraft

- [ ] 活動列表抓詳情 URL。
- [ ] 詳情頁抓開賣時間或售票狀態。
- [ ] 處理活動與場次拆分。

來源 crawler 驗收：

- 每個來源至少 2 個真實活動頁。
- 單一來源失敗不阻斷其他來源。
- 每筆 raw candidate 都能在後台看到來源原文。

### Phase 2: 售票時間 parser

這是下一個最重要功能。parser 要先吃掉明確啟售時間，AI 才能專注在模糊文字、重複與無用活動。

- [ ] 新增 parser 模組，例如 `concert-intel.parser.ts`。
- [ ] 新增 parser API 或 action，能對 pending candidates 批次解析。
- [ ] 新增 parser result 表或欄位。
- [ ] 後台顯示 parser result。
- [ ] reviewed import 能接收 parser result。

必須支援的中文時間格式：

- [ ] `2026/05/19（二）中午12:00`
- [ ] `2026/05/19 12:00`
- [ ] `2026-05-19 12:00`
- [ ] `5/19 中午12:00`
- [ ] `5月19日 中午12點`
- [ ] `中午12:00準時開賣`
- [ ] `晚上8點開賣`
- [ ] `即日起`
- [ ] `預售至演出前一日止`

必須支援的關鍵詞：

- [ ] `開放售票`
- [ ] `啟售`
- [ ] `開賣`
- [ ] `準時開賣`
- [ ] `一般販售`
- [ ] `會員預售`
- [ ] `優先購`
- [ ] `抽選登記`
- [ ] `抽選截止`
- [ ] `結果公布`
- [ ] `加場開賣`
- [ ] `釋票`
- [ ] `清票`
- [ ] `停售`

售票類型 mapping：

- `public_sale`
- `presale`
- `lottery_start`
- `lottery_end`
- `lottery_result`
- `release`
- `deadline`
- `unknown`

parser 信心規則：

- 明確年月日 + 明確時間：`0.9` 以上。
- 缺年份但能由活動頁或抓取日期推得：`0.65 ~ 0.8`。
- 只有 `中午12點開賣` 但沒有日期：`missing_sale_time` 或 `low_confidence`。
- `即日起`：可解析成 `crawled_at`，但 confidence 不超過 `0.65`。
- 相對日期如 `本週五`：必須根據公告日期推算，confidence 不超過 `0.75`，並保留推算理由。

parser 驗收：

- Legacy 測試句必須自動生成 `ticket_sale` 候選。
- parser 不可把演出日期誤當啟售日期。
- parser 找不到啟售時間時必須明確標 `missing_sale_time`。

### Phase 3: 重複與無用活動降噪

AI 很重要的一部分不是只抽時間，而是決定什麼不用看。

#### 無用活動

- [ ] 建立 noise classifier 規則。
- [ ] 排除非音樂活動，如講座、展覽、課程、影展、運動。
- [ ] 排除與買票無關的公告，如交通、場館規則、會員制度。
- [ ] 排除已過期且無未來售票事件的活動。
- [ ] 排除沒有售票行動價值的純資訊頁。

AI 判讀時需輸出：

- `reject_reason`
- `reject_confidence`
- `source_text`

#### 重複活動

重複可能來自：

- 主辦公告頁 + 售票頁。
- KKTIX 列表 + KKTIX 詳情頁。
- Legacy 活動頁 + iNDIEVOX 購票頁。
- 同一巡演不同城市。
- 同一活動加場。

去重策略：

- 同來源同 `source_id`：直接同一筆。
- 不同來源但 `ticket_url` 相同：高度疑似同一活動。
- 標題相似 + 演出日期相同 + 城市/場館相同：同一活動。
- 標題相似但城市或日期不同：同一 tour，不同 performance。
- 標題相似且有 `加場`：保留為同 event group，但售票事件與 performance 分開。

AI 判讀時需輸出：

- `duplicate_of_event_id`
- `duplicate_reason`
- `merge_fields`
- `keep_separate_reason`

驗收：

- Legacy + iNDIEVOX 指向同一活動時，不應在雷達出現兩張卡。
- 同巡演不同城市不應被合併成同一場。
- 加場開賣要保留獨立售票事件。

### Phase 4: AI review packet 與 reviewed payload

- [ ] 新增 `GET /api/concert-intel/review-packet`。
- [ ] packet 可依狀態、來源、抓取時間範圍篩選。
- [ ] packet 包含 possible duplicates。
- [ ] packet 包含 parser result。
- [ ] packet 包含 user interest rules。
- [ ] 新增 reviewed payload JSON schema。
- [ ] reviewed import 驗證 schema。
- [ ] reviewed import 回傳更新摘要。

驗收：

- AI 可只看 packet 完成判讀。
- reviewed payload 可重複送出且不產生重複資料。
- 後台顯示 AI 判讀摘要與低信心清單。

### Phase 5: 後台變成工作台

- [ ] Crawl panel 可選來源。
- [ ] Crawl 結果顯示每來源成功/失敗/候選數。
- [ ] Parser panel 可批次解析 pending candidates。
- [ ] Review packet panel 可產生 JSON。
- [ ] Reviewed payload panel 可貼上/匯入 AI JSON。
- [ ] Candidate table 顯示 parser result。
- [ ] Radar table 顯示來源原文與 AI reason。
- [ ] 人工修正售票時間後保留 correction note。
- [ ] `想看`、`沒興趣`、`封鎖來源`、`追蹤藝人` 寫入 feedback。

驗收：

- 後台能完成完整流程：crawl → parse → AI review → import → radar。

### Phase 6: 買票雷達變成行動頁

- [ ] 預設只顯示未來 14 天售票事件。
- [ ] 分區顯示：即將啟售、高興趣、低信心、缺時間、已忽略。
- [ ] 每筆顯示啟售時間、演出日期、場館、來源、理由。
- [ ] 每筆顯示「為什麼推薦」與「為什麼低信心」。
- [ ] 每筆提供 `想看`、`沒興趣`、`已買票`。
- [ ] 支援 ICS/Calendar 匯出候選。

驗收：

- 打開頁面第一眼能知道最近該不該搶票。
- 演出日期不再是主要排序。

## 5. 實測流程

每個來源都照同一套流程建立與實測：

1. 跑單一來源 crawler。
2. 檢查 raw candidate 的 title/url/extracted_text。
3. 跑 parser。
4. 檢查 sale_start_at、sale_type、source_text。
5. 產生 review packet。
6. AI review：判斷時間、無用活動、重複活動。
7. 匯入 reviewed payload。
8. 檢查 `/ticket_radar`。
9. 修 crawler/parser。
10. 固化測試案例。

每次實測要留下：

- 來源 URL。
- raw candidate 摘要。
- parser output。
- AI decision。
- 最終 radar 顯示狀態。
- 若失敗，記錄失敗原因與下一步。

## 6. 下一個最小可用目標

下一步不要再擴 UI。應先完成：

1. Legacy 專屬 parser。
2. KKTIX/iNDIEVOX 詳情頁 raw text 穩定抽取。
3. `ticket-sale-parser`。
4. `review-packet` endpoint。
5. AI review protocol 實測一批真實資料。

完成後的成功畫面：

```txt
Legacy raw candidate
→ parser 抽出 2026/05/19 12:00 public_sale
→ AI 判斷是有效音樂活動且不是重複
→ reviewed import
→ /ticket_radar 顯示該售票事件
```

