# mycelium-lite — 設計文件

> 砍掉重練自 `mycelium-wall`（過度工程 + 邊不帶邏輯）。本檔是可施工規格,不是願景。

## 0. 定位

本地優先的「**連結浮現**」工具:把使用者**忘掉的**舊想法,跟新想法的關聯翻出來。
不跟 ChatGPT 比單次統整;比的是「跨時間、你早忘了的連結」——這是 ChatGPT 結構上做不到的。

## 1. 紅線（CONTRACT,不可違反）

| # | 紅線 |
|---|---|
| 1 | **零 API 計費**:不接任何按量計費的 embedding / LLM API。 |
| 2 | **原文不可變**:`thoughts.text` 永不覆寫,向量/連結都是衍生物。 |
| 3 | **跑得動低階硬體**:目標規格 6GB GPU 等級;實際上 embedding 連 CPU 都夠。 |
| 4 | **GitHub 下載即裝**:基礎功能單一安裝檔、零外部 runtime(無 Python)。⚠️ **2026-05-30 有意識 override**:Tier 1.5 靈感火花為**可選加值**,需使用者自裝 Ollama(附圖文安裝說明 + 路徑管理)。基礎體驗(Tier 0 撈連結 + Tier 2 人工貼)**不依賴 Ollama**,偵測不到時火花降級隱藏、app 照常跑。 |
| 5 | **高階思考走半手動**:深度推理用 ChatGPT Plus 聊天視窗人工複製貼上,不程式化呼叫。 |

> 註:目標用戶只有 **ChatGPT Plus**(無 API、無 Claude Max),故 Tier 2 只能人工貼。已確認可接受。

## 2. 架構分層

```
Tier 0    本地 embedding 撈候選            免費 · 自動 · 即時    ← 核心
Tier 1    (本地 LLM 連結過濾器)            已砍 —— 人工判取代
Tier 1.5  本地小模型「靈感火花」(生成式)    免費 · 可選 · 秒級    ← M3（新增）
Tier 2    ChatGPT Plus 深度合成（人工貼）  免費（訂閱內）· 手動  ← M4
```

> Tier 1.5 ≠ 復活 Tier 1。Tier 1 被砍是因為它當「連結**過濾器**」沒用、人工判更好;
> Tier 1.5 是全新角色——對**單一概念**生成「延伸方向 + 隨想」來**激發靈感**,不碰連結篩選。
> 它也不取代 Tier 2:火花是輕量觸發,深度合成仍走 Tier 2 人工貼(紅線 #5 維持)。

## 2.1 Tier 1.5 規格（靈感火花,M3）

> spike 實證:`workspace/sandbox/qwen3-spark-spike/`(throwaway,2026-05-30)。
> 結論:qwen3 家族小模型對單一概念能即時吐出守繁中、守格式、會發散的火花;
> qwen2.5:7b 守不住格式(0/18)+漏簡體,出局。

### 觸發與資料流
```
使用者選一個 thought →「給我靈感」→ Ollama 生成 → 顯示「方向×3 + 隨想」
                                                ↓ 拋棄式,不入庫
                                人工挑/改 → 滿意的才走 add_thought 升格成新想法
```
- 火花輸出**不寫進 thoughts/chunks**,是 ephemeral 暫態 → 守紅線 #2(原文不可變)。
- 只有人工編修後**主動保留**的,才經 `add_thought` 變成新 thought(走正常嵌入流程)。

### 引擎
- Ollama HTTP `POST http://localhost:11434/api/generate`,`stream:false`。
- **`think:false` 必設**:qwen3 thinking mode 預設開,會吐 `<think>` 污染輸出(見 SOP 踩坑)。保險再 strip `<think>...</think>`。

### 硬體自適應選模型（安裝時偵測 VRAM,可手動覆寫）
| VRAM | 模型 | 備註 |
|---|---|---|
| **預設 / 6GB(3060,紅線#3 底線)** | **`qwen3.5:4b`**(~2.5GB) | 最新、品質佳、6GB 裝得下 → 當地板兼預設 |
| 8GB+ | `qwen3:8b`(~5.2GB) | 想要更穩/更長 context 可選 |
| 純 CPU / 無 Ollama | —— | 火花降級隱藏,app 照常跑 |

### 生成參數
- temperature:`qwen3.5:4b` 用 **0.7**(0.9+ 偶發簡體字 + `<>` 殘留);`qwen3:8b` 可 0.9。
- 已知小瑕(4b):偶帶陸式詞彙(信息/塑料/算法)→ prompt 加「台灣慣用詞彙」壓制。

### Prompt 模板（spike 定案:去 `<>` 佔位 + 台灣詞彙）
```
你是發想助手。針對下面這個想法,給我激發靈感的延伸,不要完整方案,要發散、可以歪。
務必用繁體中文與台灣慣用詞彙。嚴格照以下格式輸出,不要加任何其他文字:

方向:
- 關鍵詞或切角一
- 關鍵詞或切角二
- 關鍵詞或切角三
隨想:
(50 字以內,一段聯想短文)

想法:「{thought 原文}」
```

### 優雅降級
偵測不到 Ollama / 模型沒拉 → 火花入口變灰 + 提示「裝 Ollama 解鎖」;Tier 0 撈連結、Tier 2 人工貼不受影響。

## 3. 資料流

```
add_thought(text) → 本地嵌入 → 存 thoughts（不可變）
find_connections(id, top_k) → 即時 cosine top-K（排除自己 + 已決定過的）
confirm_link / reject_link → 寫 links → 確認的才落地成菌絲
get_graph() → 已確認連結 = 整面菌絲牆
```

## 4. 資料模型（SQLite）

```sql
thoughts(id, created_at, text)                       -- 原文不可變,整段顯示用
chunks(id, thought_id, seq, text, vector BLOB)       -- M2：一段切多句,每句 384×f32
links(id, src, dst, similarity, status, created_at, UNIQUE(src,dst))
       -- status ∈ {confirmed, rejected};(src,dst) 以 (min,max) 正規化（連結對稱）
       -- pending 不入庫,即時算
```

> schema 以 `PRAGMA user_version` 控管;升級時直接重建（test data 拋棄,非生產資料）。

## 5. ⛔ 兩條實證鐵律（spike 驗證,違反即踩雷）

### 5.1 embedding：對稱用法 + e5-small

- 模型:`multilingual-e5-small`（fastembed-rs 內建,384 維,純本地）。
- **所有文字一律加 `query: ` 前綴**（對稱）。
- 為何不用非對稱(query/passage):spike v2 顯示分離間隙幾乎一樣（皆約 0.06）,
  而對稱讓每個想法只存一個向量、檢索免重嵌、免混用模式。簡單勝出。

### 5.2 檢索：相對排序,不用絕對門檻

- spike 實證:e5 的 cosine 擠在 **0.79~0.89** 高窄帶。
- **舊系統的「cosine ≥ 0.60 連邊」在此完全失效**(什麼都命中)。
- 一律用 **top-K 相對排序**;相關與否靠排序 + 人工判,不靠絕對門檻。

> spike 紀錄:`workspace/sandbox/fastembed-zh-spike/`(throwaway)。

## 6. 技術棧

| 角色 | 選型 |
|---|---|
| 殼 | Tauri v2 |
| 後端 | Rust（fastembed-rs + rusqlite bundled）|
| 前端 | TypeScript（vanilla-ts）|
| embedding | ONNX via ort（fastembed 已禁用 image-models 減肥）|

## 7. 里程碑

| M | 內容 | 狀態 |
|---|---|---|
| **M0** | 地基:schema + embed + retrieve + Tauri 命令,GATE 2 綠 | ✅ |
| **M1** | 連結 feed UI:倒想法 → 浮現候選 → 確認/否決 + 刪除/清空 | ✅ |
| **M2** | 多向量切塊 + max-sim:長段落在 idea 層比對,顯示「對到哪一句」 | ✅ |
| M2.5 | （視測試）撈更準:跨時間加權、排序啟發式(看間隙/elbow)、切塊 heuristic 調校 | 待定 |
| **M3** | Tier 1.5 靈感火花:Ollama 整合 + 硬體自適應選模型 + 火花 UI + 升格 add_thought + 優雅降級 | 待做 |
| M4 | Tier 2 半手動深挖 + 打包安裝檔(GitHub release) | 待做 |

## 8. TODO / 已知債

- 跨時間加權（M2;偏好時間遠的=被遺忘的）。
- embedding 模型 bundle vs 首次啟動下載（目前:首次啟動下載 ~100MB）。
- `setup()` 內模型載入會阻塞數秒 → 之後改 lazy / 背景載入 + UI 提示。
- 命門風險:若 top-K 雜訊太多,人工判會累 → M2 必須把撈準度做起來。
