// 步2 火花破冰閥：前端直打本地 Ollama，對「某主題 × 某角度」生成發散切角破冰。
// 複用 v1 §2.1 定案 prompt（去 <> 佔位 + 台灣慣用詞彙）。火花輸出 ephemeral：
// 不自動入想法牆，人按「採用」才落地該格（守紅線 #2）；偵測不到 Ollama → 入口隱藏。

export const OLLAMA_URL = "http://localhost:11434";
export const SPARK_MODEL = "qwen3.5:4b"; // 6GB 地板兼預設（Design §3 / v1 §2.1）
export const SPARK_TEMPERATURE = 0.7; // 4b 在 0.9+ 偶吐簡體字 + <> 殘留，壓到 0.7

export interface SparkResult {
  directions: string[];
  musing: string;
}

// v1 §2.1 定案模板，擴成「主題 × 角度」情境。currentIdeas 帶入讓火花接著人已想的繼續歪。
// 2026-05-31 調整：① 用具體範例當格式錨點，避免模型複誦「關鍵詞或切角一」這類佔位字；
// ② 要求每條方向是有畫面的場景／比喻（15～35 字），不要過度壓縮成乾關鍵詞。
export function buildSparkPrompt(
  conceptLabel: string,
  lensTitle: string,
  lensHint: string,
  currentIdeas: string[],
): string {
  const mine = currentIdeas.length > 0 ? currentIdeas.join("、") : "（還沒寫）";
  return [
    "你是發想助手。針對下面這個想法，從指定角度給我激發靈感的延伸。不要完整方案，要發散、可以歪、敢跳。",
    "規則：",
    "- 用繁體中文與台灣慣用詞彙。",
    "- 「方向」給三條，每條是一個有畫面的場景或比喻，約 15～35 字；要具體到能想像，別壓縮成乾巴巴的關鍵詞。",
    "  好範例：「手術室：主刀醫師閉眼靠手溫感知血管走向來旋轉器械」。",
    "  壞範例：「聲音靜電」（太短、沒畫面）。",
    "- 「隨想」一段 50 字以內的聯想短文。",
    "只輸出下面兩段，不要任何開場白、編號標題或結尾說明：",
    "",
    "方向：",
    "- ……",
    "- ……",
    "- ……",
    "隨想：",
    "……",
    "",
    `主題：「${conceptLabel}」`,
    `角度：${lensTitle}（${lensHint}）`,
    `我目前想到的：${mine}`,
  ].join("\n");
}

// 剝 qwen3 thinking 殘留（payload 已設 think:false，這是保險，見 SOP 踩坑）。
export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// 模型偶爾複誦的佔位／標籤殘留，或範例骨架（……）→ 不該當成真內容
function isPlaceholder(s: string): boolean {
  if (s.length === 0) return true;
  if (/^[…．.、，\s]+$/.test(s)) return true; // 只剩省略號／標點（範例骨架）
  if (/^[（(].*[）)]$/.test(s)) return true; // 整條被括號包住（如「（第一條）」）
  if (/^(關鍵詞或切角|關鍵詞|切角|方向)[一二三四1234]?$/.test(s)) return true; // 純佔位標籤
  return false;
}

// 去掉模型偶爾複誦的標籤前綴：「關鍵詞或切角一：」「方向二、」等（須帶分隔符才剝，避免誤傷正文）
function stripLabelPrefix(s: string): string {
  return s.replace(/^(關鍵詞或切角|關鍵詞|切角|方向)[一二三四1234]?\s*[:：、.)]\s*/, "").trim();
}

// 解析「方向：- … 隨想：…」格式，容錯：全半形冒號、缺段、不同 bullet、佔位殘留都不炸。
export function parseSparkOutput(raw: string): SparkResult {
  const text = stripThink(raw);
  const directions: string[] = [];
  const musingLines: string[] = [];
  let section: "none" | "dir" | "musing" = "none";

  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (/^方向[:：]?$/.test(t)) {
      section = "dir";
      continue;
    }
    // 隨想標題：純標題或帶 inline 內容（隨想：xxx）都切到 musing，
    // 否則尾端有字時躲過 header 比對，會被下方裸行分支誤收成方向。
    const musM = t.match(/^隨想[:：]\s*(.*)$/);
    if (musM) {
      section = "musing";
      const rest = musM[1].trim();
      if (rest && !isPlaceholder(rest)) musingLines.push(stripLabelPrefix(rest));
      continue;
    }
    if (section === "dir" && /^[-*・•]/.test(t)) {
      const d = stripLabelPrefix(t.replace(/^[-*・•]\s*/, "").trim());
      if (!isPlaceholder(d)) directions.push(d);
    } else if (section === "dir") {
      // 模型在「方向：」後直接給無 bullet 的裸行也收（段落標題已在上方 continue 濾掉）
      const d = stripLabelPrefix(t);
      if (!isPlaceholder(d)) directions.push(d);
    } else if (section === "musing") {
      if (!isPlaceholder(t)) musingLines.push(stripLabelPrefix(t));
    }
  }

  return { directions, musing: musingLines.join(" ") };
}

// 偵測本地 Ollama 是否可達（同時驗 CORS 有沒有放行）；失敗 → 呼叫端把火花入口降級隱藏。
export async function detectOllama(timeoutMs = 2500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(timer); // fetch 拋例外時也要清，否則 timer 殘留到 timeoutMs 才觸發
    }
  } catch {
    return false;
  }
}

// 召喚火花：直打 /api/generate。think:false（qwen3 thinking 預設開，會吐 <think> 污染）、stream:false。
export async function summonSpark(
  conceptLabel: string,
  lensTitle: string,
  lensHint: string,
  currentIdeas: string[],
  timeoutMs = 30000,
): Promise<SparkResult> {
  const prompt = buildSparkPrompt(conceptLabel, lensTitle, lensHint, currentIdeas);
  // 本地推論卡死時 fetch 會永不 resolve → loading 解不開；用 AbortController 設逾時上限。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SPARK_MODEL,
        prompt,
        stream: false,
        think: false,
        options: { temperature: SPARK_TEMPERATURE },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Ollama 回應 ${res.status}`);
    }
    const data = (await res.json()) as { response?: string };
    return parseSparkOutput(data.response ?? "");
  } finally {
    clearTimeout(timer);
  }
}
