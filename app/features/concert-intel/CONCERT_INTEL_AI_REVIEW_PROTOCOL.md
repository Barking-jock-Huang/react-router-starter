# Concert Intel AI Review Protocol

這份文件定義 AI 在音樂售票雷達中的唯一正式介入步驟。未來無論由哪個 AI 或哪個 thread 執行，都應照這個 protocol 工作，避免判讀邏輯分散。

## 1. AI 的唯一任務

AI 的任務是把一批 crawler/parser 產生的候選資料整理成可匯入的 reviewed payload。

AI 必須特別專注三件事：

1. 理解啟售時間與售票事件。
2. 排除無用或非目標活動。
3. 合併重複活動。

AI 不做：

- 不直接爬大量頁面。
- 不直接修改 D1。
- 不直接 commit 資料。
- 不發明沒有來源原文支撐的時間。
- 不把演出日期誤當售票日期。

## 2. 固定工作流程

```txt
1. 讀取 review packet
2. 分析 candidate 與 parser result
3. 判斷 noise / duplicate / valid event
4. 判斷 ticket sale events
5. 輸出 reviewed payload JSON
6. 呼叫 reviewed import API
7. 回報更新摘要
```

AI 在第 5 步之前不得寫入資料庫。

## 3. Review Packet 輸入規格

review packet 應包含以下資料。

```json
{
  "generated_at": "2026-06-17T12:00:00.000Z",
  "timezone": "Asia/Taipei",
  "candidates": [
    {
      "id": 123,
      "source": "legacy",
      "source_id": "legacy:article-page-taichung-3175",
      "source_kind": "organizer_announcement",
      "title": "心與草——福夢 Unplug 巡演 台中場",
      "url": "https://www.legacy.com.tw/article/page/taichung/3175",
      "event_at": "2026-06-18T11:00:00.000Z",
      "venue": "Legacy Taichung 音樂展演空間",
      "city": "台中",
      "organizer": "若霖股份有限公司",
      "raw_excerpt": "開放售票：2026/05/19（二）中午12:00準時開賣；預售至演出前一日止",
      "extracted_text": "...",
      "parser_results": [
        {
          "sale_type": "public_sale",
          "sale_start_at": "2026-05-19T04:00:00.000Z",
          "sale_end_at": null,
          "confidence": 0.95,
          "source_text": "開放售票：2026/05/19（二）中午12:00準時開賣",
          "parser_reason": "explicit YYYY/MM/DD + noon time"
        }
      ]
    }
  ],
  "possible_duplicates": [
    {
      "candidate_id": 123,
      "existing_event_id": 45,
      "reason": "same title and same venue/date"
    }
  ],
  "interest_rules": {
    "tracked_artists": [],
    "tracked_venues": [],
    "tracked_cities": ["台北", "台中", "高雄"],
    "blocked_keywords": [],
    "preferred_keywords": []
  }
}
```

## 4. Reviewed Payload 輸出規格

AI 必須輸出 JSON，不要輸出 prose-only 結果。

```json
{
  "summary": {
    "valid_events": 1,
    "ticket_sales": 1,
    "rejected": 0,
    "duplicates": 0,
    "needs_human_check": 0
  },
  "events": [
    {
      "candidate_id": 123,
      "source": "legacy",
      "source_id": "legacy:article-page-taichung-3175",
      "title": "心與草——福夢 Unplug 巡演 台中場",
      "url": "https://www.legacy.com.tw/article/page/taichung/3175",
      "event_at": "2026-06-18T11:00:00.000Z",
      "venue": "Legacy Taichung 音樂展演空間",
      "city": "台中",
      "organizer": "若霖股份有限公司",
      "artist_text": "福夢 FUMON",
      "status": "active",
      "ai_summary": "有效音樂演出。來源明確寫出公開售票時間。",
      "ticket_sales": [
        {
          "sale_type": "public_sale",
          "sale_start_at": "2026-05-19T04:00:00.000Z",
          "sale_end_at": null,
          "timezone": "Asia/Taipei",
          "confidence": 0.95,
          "source_text": "開放售票：2026/05/19（二）中午12:00準時開賣",
          "source_url": "https://www.legacy.com.tw/article/page/taichung/3175",
          "ai_reason": "明確售票日期與中午12:00，非演出日期。",
          "status": "reviewed"
        }
      ]
    }
  ],
  "rejected_candidates": [],
  "duplicate_links": [],
  "needs_human_check": []
}
```

## 5. 啟售時間判讀規則

AI 判讀啟售時間時，必須遵守以下優先順序。

### 5.1 永遠區分演出日期與售票日期

常見演出日期關鍵詞：

- `演出日期`
- `演出開始`
- `活動日期`
- `節目時間`
- `入場時間`
- `開放入場`

常見售票日期關鍵詞：

- `開放售票`
- `啟售`
- `開賣`
- `準時開賣`
- `一般販售`
- `售票時間`
- `會員預售`
- `優先購`
- `抽選登記`
- `預售至`
- `停售`

如果同一段文字同時有演出日期與開賣日期，AI 必須使用售票日期作為 `sale_start_at`。

### 5.2 明確時間

以下可高信心輸出：

- `2026/05/19（二）中午12:00準時開賣`
- `2026-05-19 12:00 開賣`
- `5月19日 中午12點開賣` 且可由頁面/活動年份推得年份

信心：

- 明確年月日與時間：`0.9 - 1.0`
- 缺年份但可合理推得：`0.65 - 0.85`

### 5.3 相對時間

例如：

- `本週五中午12點`
- `明天 12:00`
- `即日起`

AI 必須根據 `crawled_at`、公告日期或頁面上下文推算，並在 `ai_reason` 寫明推算依據。

信心：

- 有公告日期可推算：最高 `0.75`
- 沒有公告日期：標 `needs_human_check`

### 5.4 只看到售票狀態

如果只有：

- `熱賣中`
- `已開賣`
- `售完`
- `即將開賣`

但沒有日期時間：

- 不可發明 `sale_start_at`。
- 可輸出 `status = missing_sale_time`。
- 在 `needs_human_check` 裡列出。

### 5.5 多個售票事件

同一活動可能有多個 ticket sales。AI 必須全部保留：

- 會員預售
- 信用卡預售
- 一般售票
- 抽選登記
- 抽選截止
- 結果公布
- 加場開賣
- 釋票

不要把預售時間覆蓋成一般售票時間。

## 6. 無用活動判斷規則

AI 應排除或降級以下內容。

### 6.1 非目標活動

通常排除：

- 純講座
- 展覽
- 影展
- 課程
- 運動賽事
- 市集
- 旅遊活動
- 無售票行動的公告

例外：

- 音樂講座如果有售票且使用者可能有興趣，可標 `needs_human_check`。
- 音樂祭、演唱會、Live house 表演、樂團專場應保留。

### 6.2 過期活動

如果演出已過且沒有未來售票事件：

- `rejected_candidates.reject_reason = "past_event_no_ticket_action"`

如果售票已開始但仍可能買票：

- 可保留，但不應進「即將啟售」區。

### 6.3 資訊不足

如果只有標題與 URL，沒有任何活動/售票內容：

- 不要 reviewed。
- 放 `needs_human_check` 或維持 candidate pending。

## 7. 重複合併規則

AI 要特別處理重複，因為同一活動常同時出現在主辦與售票平台。

### 7.1 應合併

符合以下任兩項以上，通常視為同一活動：

- 標題高度相似。
- 演出日期相同。
- 場館/城市相同。
- ticket link 相同。
- 主辦頁明確連到同一售票頁。

合併時：

- 主 event 優先保留最完整的標題、場館、演出日期。
- ticket_sales 可保留多來源 source_url。
- `ai_reason` 必須寫明合併理由。

### 7.2 不應合併

以下應分開：

- 同巡演不同城市。
- 同藝人不同日期。
- 同活動不同加場。
- 同 festival 不同 stage/performance，若售票事件不同。

### 7.3 duplicate_links 輸出

```json
{
  "candidate_id": 123,
  "duplicate_of_event_id": 45,
  "confidence": 0.9,
  "duplicate_reason": "Legacy page links to the same iNDIEVOX ticket page as event 45.",
  "merge_fields": ["source_url", "source_text"]
}
```

## 8. Human Check 規則

AI 不確定時不要硬塞進 reviewed event。放入 `needs_human_check`。

常見原因：

- 售票日期缺年份且無法推算。
- 只有 `即將開賣` 但無時間。
- 活動像音樂也像講座。
- 可能重複但關鍵欄位衝突。
- 多個日期不確定哪個是售票日期。

輸出格式：

```json
{
  "candidate_id": 123,
  "reason": "Multiple dates found; unclear which one is public sale time.",
  "recommended_action": "Open source URL and confirm sale section.",
  "source_text": "..."
}
```

## 9. AI 執行提示模板

未來執行 AI review 時，可使用以下提示。

```txt
你是音樂售票雷達的 AI reviewer。

任務：
1. 從 review packet 判斷有效音樂活動。
2. 理解啟售/預售/抽選/釋票等售票事件。
3. 排除無用或非音樂活動。
4. 合併重複活動。
5. 輸出 reviewed payload JSON。

規則：
- 不要把演出日期當成售票日期。
- 沒有來源原文支持時，不要發明 sale_start_at。
- 不確定就放 needs_human_check。
- 同活動多個售票事件都要保留。
- 同巡演不同城市不要合併。
- 主辦頁與售票頁指向同一活動時要合併。

輸入：
<貼上 review packet JSON>

輸出：
只輸出 reviewed payload JSON。
```

## 10. 驗收案例

### Legacy 明確開賣

Input source text：

```txt
演出日期：2026-06-18(四)
開放售票：2026/05/19（二）中午12:00準時開賣；預售至演出前一日止
```

Expected：

- `event_at = 2026-06-18`
- `sale_start_at = 2026-05-19T04:00:00.000Z`
- `sale_type = public_sale`
- `confidence >= 0.9`
- `ai_reason` 必須說明這是售票日期，不是演出日期。

### 只有演出日期

Input source text：

```txt
演出日期：2026-08-20
演出開始：19:30
```

Expected：

- 不輸出 `sale_start_at`。
- 標 `missing_sale_time` 或 `needs_human_check`。

### 主辦頁與售票頁重複

Input：

- Legacy page title: `心與草——福夢 Unplug 巡演 台中場`
- iNDIEVOX page title: `心與草——福夢 Unplug 巡演 台中場`
- Same event date and ticket URL.

Expected：

- 只產生一個 reviewed event。
- source 可保留兩個 URL 作為證據。

### 同巡演不同城市

Input：

- `福夢 Unplug 巡演 台北場`
- `福夢 Unplug 巡演 台中場`
- 不同日期/場館。

Expected：

- 不合併成同一 performance。
- 可視為同 tour，但雷達上保留不同售票事件。

