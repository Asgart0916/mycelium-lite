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
| 4 | **GitHub 下載即裝**:單一安裝檔,零外部 runtime(無 Python、無 Ollama)。 |
| 5 | **高階思考走半手動**:深度推理用 ChatGPT Plus 聊天視窗人工複製貼上,不程式化呼叫。 |

> 註:目標用戶只有 **ChatGPT Plus**(無 API、無 Claude Max),故 Tier 2 只能人工貼。已確認可接受。

## 2. 三層架構

```
Tier 0  本地 embedding 撈候選          免費 · 自動 · 即時   ← 本專案核心
Tier 1  (本地 LLM 過濾器)              已砍 —— 改由「人工判」當過濾器
Tier 2  ChatGPT Plus 深度合成（人工貼） 免費（訂閱內）· 手動  ← 後期
```

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
| M3 | Tier 2 半手動深挖 + 打包安裝檔(GitHub release) | 待做 |

## 8. TODO / 已知債

- 跨時間加權（M2;偏好時間遠的=被遺忘的）。
- embedding 模型 bundle vs 首次啟動下載（目前:首次啟動下載 ~100MB）。
- `setup()` 內模型載入會阻塞數秒 → 之後改 lazy / 背景載入 + UI 提示。
- 命門風險:若 top-K 雜訊太多,人工判會累 → M2 必須把撈準度做起來。
