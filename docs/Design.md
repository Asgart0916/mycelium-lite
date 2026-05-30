# mycelium-lite — 設計文件（v2：單人 design sprint 引導器）

> 2026-05-31 大改。舊定位「連結浮現」（M0–M4a）已封存於 `Design-legacy.md`（commit `a0dd2f3`）。
> 本檔是 v2 可施工規格。轉型失敗風險與最高風險假設見 `PreMortem.md`。

## 0. 定位

引導**單人設計師**走一趟 design sprint，用流程卡點 + 概念分布**暴露 brainstorm 盲點**。
逐字稿 → 結構化節點 + 核心概念 → 四透鏡發散 → 收斂。

所有「推想」外包 ChatGPT Plus 人工貼（紅線 #5）；mycelium 只做五件事：
**流程編排 · prompt 工廠 · 回填解析 · 積木視覺化 · 盲點偵測**。

> 不跟 ChatGPT 比「想得多」——ChatGPT 想得比你多。比的是**逼你面對自己沒想到的維度**（盲點是人的，AI 不會卡）。

## 1. 紅線（CONTRACT，2026-05-31 重審）

| # | 紅線 | v2 判定 |
|---|---|---|
| 1 | 零計費 API | **併入 #5**：核心不程式化呼叫任何計費 API，推想走 ChatGPT Plus 訂閱內人工貼 |
| 2 | **原文不可變** | **鐵律**：`node.source_quote` 照抄逐字稿，永不改寫（spike 已驗 72/72 可追溯）。是整個盲點/收斂的可信地基 |
| 3 | 跑得動低階硬體 | **火花啟用時生效**：核心路徑（步0–1）不本地推論；僅步2 火花破冰閥依賴 Ollama（可選加值，比照 v1 對 Tier 1.5 的 override） |
| 4 | 下載即裝無 runtime | **降為目標**：純前端可 build 靜態檔，本地開或 GitHub Pages 部署；火花需使用者自裝 Ollama（附引導）|
| 5 | **高階思考半手動** | **頭號鐵律**：深度推想走 ChatGPT Plus 人工複製貼上，程式**不呼叫任何深度推理 API** |

## 2. 流程（5 步，HMW 已砍）

> v1 HTML 參考框架是 5 步 + Crazy8s 8 格；v2 砍 HMW、一次往返、四透鏡。重編號如下。

| 步 | 內容 | 誰做 | 菌絲 | 工具管？ |
|---|---|---|---|---|
| **0** | 逐字稿 → ChatGPT 一次往返 → 回填 `core_concepts + nodes + lenses`（收斂+發散同做）| 人貼 / ChatGPT | — | ✅ prompt 工廠 + 回填解析 |
| **1** | 積木牆視覺化 + 概念分布盲點呈現（E2）| mycelium | — | ✅ 核心 |
| **2** | 針對薄概念 / 四透鏡，**人自己再發散補洞**（卡點 = 盲點訊號）| 人（火花可破冰）| ✅ 只在這步長 | ✅ |
| **3** | 收斂：Impact / Effort 象限選方向 | 人 | — | ✅ |
| **4–5** | 假設解構 + 最小驗證 → **走出工具**（mycelium 不管）| 人 | — | ❌ |

### 資料流

```
步0  貼逐字稿 → 一鍵複製 prompt → 人貼進 ChatGPT Plus → 人貼回 JSON
     → robust 解析 → 存成 sprint（core_concepts + nodes + lenses）
步1  渲染積木牆（nodes 依 core_concept 分群）+ 概念分布條 → E2 標薄概念
步2  人對薄概念補節點（菌絲生長）；卡住→召喚火花破冰（Ollama，標機器提示）
步3  候選方向丟 Impact/Effort 2×2 → 選定
步4-5 匯出 brief，離開工具
```

## 3. 步2 火花破冰閥（子規格，複用 v1 M3 邏輯）

> 角色定位：**可選破冰**，不是預設、不是替人想完。守住「先逼人想」，但不讓人卡死。

### 觸發與資料流（沿用 v1 ephemeral 機制）

```
人對某薄概念發散卡住 →（先強制記一次「我目前想到的」）→ 喊「破冰」
  → 前端直打 Ollama 生成「方向×3 + 隨想」→ 顯示，標「機器提示」與人發散區隔
  → 不自動入菌絲；人挑/改後主動保留的才落地成節點（守紅線 #2）
```

### 引擎與 prompt（複用 v1，實作層 Rust → TS 前端）

- 前端 `fetch` 直打 `POST http://localhost:11434/api/generate`，`stream:false`、**`think:false` 必設**（qwen3 thinking mode 會吐 `<think>` 污染），保險再 strip `<think>…</think>`。
- ⚠️ **CORS**：純前端跨來源打 localhost:11434 可能被擋 → 安裝引導需設 `OLLAMA_ORIGINS`（指定 app origin 或 `*`）。偵測不到 Ollama / CORS 失敗 → 火花入口降級隱藏，步0–3 照常跑。
- prompt 模板沿用 v1 §2.1 定案版（去 `<>` 佔位 + 台灣慣用詞彙 + qwen3.5:4b temperature 0.7）。
- 硬體自適應選模型沿用 v1：預設 `qwen3.5:4b`（6GB 地板）/ 8GB+ `qwen3:8b` / 純 CPU 降級。

## 4. E2 盲點偵測（機制演進至第三版）

> **E2 演進史（重要——已三次調整，別退回前兩版）**
>
> | 版本 | 機制 | 否證 |
> |---|---|---|
> | v1 空透鏡 | 透鏡留空 = 盲點 | spike 否證：AI 預填不留空 |
> | v2 概念分布不均 | 薄概念 = 盲點 | **N0 否證（2026-05-31）**：實測「薄得合理」，AI 均勻填充不製造突兀訊號 |
> | **v3 維度覆蓋缺口** | 人手動發散時整個漏掉的維度/概念 | 待 N2 驗 |
>
> **共同教訓**：訊號**不能來自 AI 輸出、也不能來自人的自陳**（兩者都照不見 unknown unknown）。
> known unknown（人意識到的卡）≠ 盲點；只有「人手動發散時自己沒察覺的漏」才是 unknown unknown。

| 訊號 | 算法 | 狀態 |
|---|---|---|
| ~~概念分布不均~~ | 數 `core_concept_ids` 計數標薄 | **N0 否證 → 降級為「結構整理」視覺，不再當盲點偵測** |
| **維度覆蓋缺口**（主）| 步2 人手動逐透鏡 × 概念發散，標出人整個沒碰的維度 | unknown unknown，待 N2 驗 |
| 火花召喚頻率（輔）| 統計各概念召喚火花次數 | 某概念召喚多 = 你這塊弱（A5 緩解④）|

## 5. 資料模型（D1，spike 已驗 schema + 持久化）

```ts
// spike 驗證可行（robust 8/8、可追溯 72/72、0 孤兒）
interface Sprint {
  id: string;
  created_at: string;
  transcript: string;          // 逐字稿原文（不可變，紅線 #2 源頭）
  core_concepts: { id: string; label: string }[];
  nodes: {
    id: string;
    idea: string;
    source_quote: string;      // 照抄逐字稿，回原文命中驗證（A3 緩解）
    core_concept_ids: string[];
    origin: "ai" | "human" | "spark";  // 區隔 AI 回填 / 人發散 / 火花保留
    tentative?: boolean;       // 「存疑/邏輯不通先記著」標記（spike 預留，遲早要加）
  }[];
  lenses: {
    fastest: { id: string; direction: string }[];
    reverse: { id: string; direction: string }[];
    crossdomain: { id: string; direction: string }[];
    upstream: { id: string; direction: string }[];
  };
}
```

- **持久化**：IndexedDB（純前端，單瀏覽器）。早期即做 **JSON 匯出/匯入**（B1 緩解，不承諾雲端）。
- `origin` 欄位讓積木牆能視覺區隔三種來源（A5 緩解③）。

## 6. 技術棧（純前端，棄 Tauri/Rust）

| 角色 | 選型 | 備註 |
|---|---|---|
| 前端 | TypeScript（vanilla-ts + Vite）| 複用現有 `package.json` / `vite.config.ts` 工具鏈 |
| 持久化 | IndexedDB | 純前端，無後端 |
| 解析 | TS robust extract（剝 ```json fence + 抓 `{…}`）| 複用 spike `parse_spike.py` 邏輯，移植 TS |
| 火花（可選）| 前端 fetch → Ollama HTTP | 唯一本地推論，CORS 需處理 |
| 分發 | 靜態 build（本地開 / GitHub Pages）| 未來要桌面再套 Tauri 殼（前端邏輯可移植，故選純前端）|

> **不要**：Rust 後端、fastembed、SQLite（v1 為本地 embedding 而設，核心 MVP 不需要）。

## 7. 舊 code 處置

| 舊資產 | 處置 |
|---|---|
| `src-tauri/`（Rust：embed/graph/links/Tier2 synth）| **移 `legacy/` 封存**，不刪（commit `a0dd2f3` 為據）|
| M3 火花（Ollama 邏輯 + prompt 模板）| **邏輯複用**，實作從 Rust 搬 TS 前端（見 §3）|
| `src/`（v1 前端）| 重起 v2 前端，舊的併入 legacy 參考 |
| README | 標「v1 連結浮現已封存於 legacy/，v2 design sprint 在 src/」（C1 緩解）|

> code 搬遷 + git 操作留待實作批次處理；本文件先定方向。

## 8. 里程碑（A4 優先 —— 先驗最高風險假設）

| N | 內容 | 為何這個順序 |
|---|---|---|
| **N0** | 純前端骨架（Vite TS）+ 貼 JSON → robust 解析 → 渲染積木牆 + 概念分布條 | 最小可驗證單元 |
| **N1** ⭐ | **A4 驗證點（2026-05-31 已驗）**：N0 跑 v2a，判定「薄得合理」→ 訊號①否證。範圍限①，賭注轉② | E2 第三次調整（見 §4）|
| **N2** ⭐ | 步2 人手動逐透鏡 × 概念發散 UI + **維度覆蓋缺口**偵測（標人整個漏掉的維度/透鏡）| 驗 E2 v3，新生死關 |
| N3 | 火花破冰閥（前端打 Ollama + CORS + 標機器提示 + 召喚頻率訊號）| 步2 增強 |
| N4 | 收斂 Impact/Effort 2×2 + IndexedDB 持久化 + JSON 匯出入 | 完整一輪 + B1 緩解 |
| N5 | 步0 逐字稿 → prompt 一鍵複製 + 回填貼入流程打磨（A2 緩解）| 降摩擦 |
| — | 步4–5（假設解構 + 最小驗證）| **不做**，走出工具 |

## 9. 待測風險假設（連 PreMortem）

| 假設 | 待測問題句 | 驗證點 |
|---|---|---|
| **A4**（最高）| 看著概念分布圖，我會不會真的補進原本沒想到的方向？| N1，連 3 次不會 → 停損 |
| A2 | 人工貼來貼去的摩擦，會不會大到我寧願直接用 ChatGPT？| N5 + 全程體感 |
| A5 | 火花會不會變成偷懶逃生艙，稀釋盲點訓練？| N3 後觀察召喚頻率 |

## 10. ChatGPT 回填 prompt（步0，已定案）

一次往返 prompt + JSON schema 見 `workspace/sandbox/c3-synth-parse-spike/prompt-v2.md`（spike 定案，robust 8/8、可追溯 72/72）。**prompt 納入版控**（A3 緩解）。
