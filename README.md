# mycelium-lite

單人用的 **design sprint 引導器**：把一場 brainstorm 的逐字稿整理成想法牆與關係圖，再逼自己「逐角度多想幾個」，照出你漏掉的角度與主題。對抗的是「以為想全了、其實有盲區」。

純前端 TypeScript（Vite），**零後端、零計費、資料只留在你自己的瀏覽器**。深度推想外包給 ChatGPT（人工貼），本工具不程式化呼叫付費 API。

---

## 這工具解決什麼

| | |
|---|---|
| 痛點 | brainstorm 容易在熟悉的角度繞圈，自己看不到沒想到的方向 |
| 做法 | 強制「主題 × 4 個角度（最快版本／反過來想／跨界借鏡／往上游挖）」逐格自己先想，再揭露你整輪都沒碰的角度與主題 |
| 盲點訊號 | 來自**你手動發散的差集**——哪些角度/主題你一個點子都沒補，就是盲區 |

---

## 快速開始

需求：**Node.js 18+**（建議 20+）。

```bash
npm install
npm run dev
```

開瀏覽器到 **http://localhost:1420/**。

### 使用流程

| 步 | 做什麼 |
|---|---|
| ① 貼逐字稿 | 把這次 brainstorm 的逐字稿貼進①（之後產生指令、核對點子出處都靠它） |
| ② 產生指令 | 按「產生 ChatGPT 指令」→ 複製 → 貼進 **ChatGPT Plus** → 把它回的 JSON 拿回來 |
| ③ 貼回 JSON | 把 ChatGPT 整理好的 JSON 貼進③ → 按「整理成想法牆」 |
| 想法牆 | 點子依主題分群，看分布、看哪個主題想得少 |
| 發散：自己多想 | 對每個主題、從 4 個角度自己補點子 → 按「看看我漏了什麼」揭露盲區 |
| 收斂：選方向 | 勾選要認真評估的點子，拖進 Impact/Effort 2×2，左上角（高效益低成本）優先做 |

進度自動存在瀏覽器（IndexedDB），重整不掉資料。可用「匯出 JSON」備份、「匯入 JSON」還原。

---

## 火花破冰（選用，需本地 Ollama）

步2 卡住時，每格有「破冰」鈕，會打本地 Ollama 生發散切角當提示。**偵測不到 Ollama 時這入口自動隱藏**，不影響其他功能。火花輸出不會自動入想法牆，按「採用」才落地。

設定步驟：

1. 安裝 [Ollama](https://ollama.com/) 並拉模型（預設 `qwen3.5:4b`，約 6GB）：
   ```bash
   ollama pull qwen3.5:4b
   ```
2. **放行 CORS**：瀏覽器（localhost:1420）跨來源呼叫 Ollama（localhost:11434）預設會被擋，需設環境變數讓 Ollama 放行後重啟。

   Windows PowerShell（當前使用者永久生效）：
   ```powershell
   [Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "http://localhost:1420", "User")
   # 設完重啟 Ollama 服務（或登出登入）才生效
   ```
   臨時測試（只在當前終端）：
   ```powershell
   $env:OLLAMA_ORIGINS = "http://localhost:1420"; ollama serve
   ```

預設端點與模型寫在 `src/spark.ts`（`OLLAMA_URL` / `SPARK_MODEL`），要換模型改那裡。

---

## 打包與部署

```bash
npm run build      # 產出靜態檔到 dist/
npm run preview    # 本地預覽 production build
```

`dist/` 是純靜態檔，丟任何靜態主機（GitHub Pages、Netlify、Nginx…）即可。**首屏只載 ~15KB（gzip）**；關係圖用的 cytoscape（~140KB gzip）採動態載入，進到「發散／收斂」步驟才抓。

> 火花破冰需要本地 Ollama，部署到遠端網站時該功能對訪客不可用（會自動隱藏），其餘流程照常。

---

## 開發

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器（http://localhost:1420/） |
| `npm run build` | 型別檢查 + 打包到 `dist/` |
| `npm run check` | tsc + biome + vitest 一次跑完（提交前品質門） |
| `npm test` | 單元測試（vitest） |
| `npm run lint` | biome 檢查 |

技術棧：TypeScript · Vite · [cytoscape.js](https://js.cytoscape.org/) + fcose（關係圖）· biome（lint/format）· vitest（測試）。

---

## 隱私

逐字稿、點子、2×2 落點全部只存在你自己的瀏覽器（IndexedDB）與你匯出的 JSON 檔。本工具不上傳任何資料、不呼叫任何付費 API。唯一的外部互動是：你手動把指令複製去 ChatGPT、再把結果貼回來。
