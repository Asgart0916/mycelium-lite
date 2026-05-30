# C3 Prompt v2 — 逐字稿 → core concepts + nodes + 四透鏡（一次往返）

> 用法：把下面整段（含逐字稿）貼進 ChatGPT Plus。逐字稿一/二各跑一次，輸出分別存
> `samples/v2a-output.json`、`samples/v2b-output.json`。
> 驗證重點：四透鏡發散品質 + 空透鏡會不會老實留空（盲點訊號）+ 格式穩不穩。

---

你是協助單人設計師整理 brainstorm 的助手。下面是我對著錄音發想一個產品時的逐字稿，內容發散、一句話常包含多個想法，也包含一些我自己都覺得「還不通」「先記著」的念頭。

請做三件事，並**只輸出 JSON**（不要任何前言、說明或 markdown 程式碼框）：

1. 抽出 3-5 個「圍繞這個產品的核心概念」（core_concepts），每個給短 id 和 label。
2. 把逐字稿拆成多個「單一 idea」節點（nodes）：`id` / `idea`（一句）/ `source_quote`（**原文照抄，不要改寫**）/ `core_concept_ids`（歸屬，一到多）。顆粒度：一個 idea = 一個可單獨討論的點；連「邏輯不通 / 先記著」的也要抽成節點。
3. 針對「這個產品想做的方向」，用四個透鏡各發想幾個**解法方向**（lenses），每個方向給 `id` 和 `direction`（一句）：
   - `fastest`（最快版本）：只有 1 天 / 最少資源能做，會怎麼解？
   - `reverse`（反向版本）：如果解「相反的問題」，會怎麼做？
   - `crossdomain`（跨域移植）：別的領域（醫院 / 遊戲設計 / 餐廳…）怎麼解這個情境？
   - `upstream`（上游解法）：不改產品本身，解決更根本的上游問題是什麼？

**重要**：每個透鏡給 0-3 個方向即可。**如果某個透鏡你真的想不到合理的方向，就留空陣列 `[]`，絕對不要硬湊或塞不可行的方向**——留空是有意義的盲點訊號。

全程用繁體中文與台灣慣用詞彙。

輸出 JSON 格式：
```
{
  "core_concepts": [{"id":"c1","label":"..."}],
  "nodes": [{"id":"n1","idea":"...","source_quote":"...","core_concept_ids":["c1"]}],
  "lenses": {
    "fastest": [{"id":"l1","direction":"..."}],
    "reverse": [],
    "crossdomain": [{"id":"l2","direction":"..."}],
    "upstream": [{"id":"l3","direction":"..."}]
  }
}
```

逐字稿：
「{在此貼入逐字稿（樣本一 01-input.txt 或樣本二 02-input.txt）}」
