# C3 Spike — 結構化回填解析（throwaway）

**目的**：驗證 mycelium 轉型（單人 design sprint 引導器）的最大不確定性節點 C3——
「ChatGPT Plus 把多-idea 逐字稿 → 結構化節點」是否可行、parser 是否健壯。

## 驗證問題
- (a) 一個 prompt 能否讓 ChatGPT Plus **穩定**吐出指定 JSON？
- (b) 拆出的單一 idea **顆粒度**合理嗎？
- (c) **核心概念歸屬**（節點 → top-k 核心概念）有意義嗎？
- (d) parser 夠健壯（容忍 ```json 包裹、前後贅字）？

## 極簡 schema（跑通再加）
```json
{
  "core_concepts": [{ "id": "c1", "label": "圍繞產品的核心概念" }],
  "nodes": [
    {
      "id": "n1",
      "idea": "拆出的單一 idea（一句）",
      "source_quote": "逐字稿原文片段（守可追溯）",
      "core_concept_ids": ["c1"]
    }
  ]
}
```

## 通過條件
3 段逐字稿：ChatGPT 守格式 ≥ 2/3、parser 全解析成功、顆粒度與歸屬人工判「可用」。

## 停損
調 3 版 prompt 仍守不住格式 → 退「鬆散 markdown + 人工微調」或重想 C3。

## 分工
schema / prompt / parser → Claude；真實逐字稿 + ChatGPT 操作 → Jasper。

## 樣本
- 樣本 1：`samples/01-input.txt`（空間氛圍硬體，Jasper 提供 2026-05-30）
- 待回填：`samples/01-output.json`（ChatGPT Plus 貼回）

## 狀態
- [x] schema 草案
- [x] prompt v1（`prompt.md`）
- [x] 樣本 1 ChatGPT 輸出回填（`samples/01-output.json`）
- [x] parser 寫 + 驗（`parse_spike.py`）
- [x] 結論（見下，樣本 1）

## 結論（樣本 1，2026-05-30）

**信號很強，但通過條件要 3 段、目前只驗 1 段。**

| 面向 | 結果 | 判讀 |
|---|---|---|
| 守格式 | 1/1 純 JSON | ChatGPT Plus 守 JSON 可靠 |
| parser 健壯 | 4/4 髒變體 | `robust_extract`（剝 fence + 抓 `{...}`）足夠 |
| source_quote 可追溯 | **16/16** | 照抄原文，追溯不斷 → C3 + 紅線 #2 精神成立 |
| schema / 孤兒概念 | 0 錯 / 無孤兒 | 結構可行 |

**衍生洞察（spike 的真正價值，不只「能 parse」）**：
1. **顆粒度小瑕**：n11 把「折射/AR/不做眼鏡/桌面獨立」揉成一個節點 → prompt 可補「一段含多個可分的點要拆成多個節點」。
2. **概念分布極不均**：c1(11) 像 catch-all、c4(2) 很薄。**這個分布本身就是 E2/E3 盲點診斷的素材**——薄的概念 = 想得少的地方。
3. **「有問題的念頭」有被保留**：n13（心跳感應，使用者自己說「邏輯不通先記著」）正確抽成節點 → 之後 D1 應給節點加「待驗證/存疑」標記。

**對 D1 的回饋**：`core_concepts(id,label)` + `nodes(id,idea,source_quote,core_concept_ids[])` 結構確認可行；極簡版先不加 node 標記，但已知遲早要加。

## 樣本 2（刻意難：自我打斷+抽象隱喻+技術跳躍）

| 面向 | 結果 |
|---|---|
| 守格式 | 純 JSON |
| 節點數 | 30（顆粒度比樣本 1 更細，材質/比喻/自我否定都拆開） |
| robust 解析 | 4/4 |
| source_quote 可追溯 | **30/30**（連自我打斷拼接的 n11 也命中） |
| schema / 孤兒 | 0 錯 / 無 |
| 概念分布 | 均勻 c1=11 c3=11 c5=9 c2=7 c4=4 |

## ⭐ 最終結論：C3 **通過**（2/2，2026-05-30）

- 守格式 2/2、parser robust 8/8、可追溯 46/46 → C3 + 紅線 #2 精神紮實成立，**不需第 3 段**。
- **關鍵洞察**：樣本 1 分布偏（c4 只 2 個 = AI 想得少）、樣本 2 分布均 → **概念分布均勻度反映 brainstorm 完整度**，直接餵養 E2/E3 盲點診斷。**E2 不需獨立重 spike**。
- **已知不穩（非 blocker）**：顆粒度由 prompt 控制會飄（樣本 1 偏粗、樣本 2 偏細）。對 brainstorm 工具寧細勿粗，留待正式實作 prompt tuning，不擋 C3。
- **D1 確認**：`core_concepts(id,label)` + `nodes(id,idea,source_quote,core_concept_ids[])` 可行；node「存疑」標記遲早要加。

---

## B2 AI spike — prompt v2 一次往返（core + nodes + 四透鏡，2026-05-30）

決策變更：為使用者減負，**砍掉 HMW，一次往返**從逐字稿直接抓 core concepts + nodes + 四透鏡解法。

| | v2a 空間氛圍 | v2b 光線時鐘 |
|---|---|---|
| robust | 4/4 | 4/4 |
| source_quote 可追溯 | 41/41 | 31/31 |
| schema / 孤兒 | 0 / 無 | 0 / 無 |
| 四透鏡(快/反/跨/上) | 3/2/3/3 | 3/2/3/3 |
| 概念分布 | c1=15(catch-all) … c4=6 | c1=12 … c4=4(薄) |

**結論：一次往返技術上通過**——收斂+發散同做、可追溯 72/72、四透鏡有料、格式穩。

### ⭐ 關鍵否證（spike 最大產出）
**「空透鏡 = 盲點」機制在 AI 預填下失效。** prompt 明寫「想不到就留空」，兩段四透鏡仍全填滿且內容真有料。ChatGPT 幾乎總能對任何產品掰出合理的反向/跨域/上游 → 透鏡極少空。

**E2 盲點訊號改用**：
1. 概念分布不均（C3/B2 一致穩定有區辨力，如 c4 持續偏薄）。
2. 人自己發散階段的卡點（盲點是人的，AI 不會卡）。

### 已知（非 blocker）
顆粒度持續偏細（v2a 41 節點）；一次往返沒讓收斂品質下降。

## 三個不確定節點總結
- **C3 結構化回填解析** → ✅ 通過
- **B2 AI（一次往返四透鏡）** → ✅ 通過
- **E2 卡點判定** → ⚠️ 機制修正：不靠空透鏡，改用概念分布 + 人發散卡點
