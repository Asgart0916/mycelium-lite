// 主程式（N4 起有狀態）：WorkingSprint 為單一真相源，改動防抖自動存 IndexedDB、
// 啟動時還原上次 sprint、支援 JSON 匯出入（B1）。流程步0–3：貼 JSON → 想法牆/關係圖 → 步2 發散。
import { mountGraph } from "./graph";
import { ORPHAN_COLOR, assignConceptColors } from "./graph-model";
import { type WorkingSprint, harvestFromState, newSprint } from "./model";
import { type RawSprint, parseSprint, validateSprint } from "./parse";
import { fromJson, loadSprint, saveSprint, toJson } from "./persist";
import { buildBackfillPrompt } from "./prompt";
import { type IdeaRef, mountQuadrant } from "./quadrant";
import { mountDiverge, renderBricks, renderDistribution, renderReport } from "./render";
import { mountStepper } from "./stepper";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const jsonEl = $<HTMLTextAreaElement>("#json-input");
const transcriptEl = $<HTMLTextAreaElement>("#transcript-input");
const parseBtn = $<HTMLButtonElement>("#parse-btn");
const exportBtn = $<HTMLButtonElement>("#export-btn");
const importBtn = $<HTMLButtonElement>("#import-btn");
const importFile = $<HTMLInputElement>("#import-file");
const genPromptBtn = $<HTMLButtonElement>("#gen-prompt-btn");
const copyPromptBtn = $<HTMLButtonElement>("#copy-prompt-btn");
const promptOut = $<HTMLElement>("#prompt-out");
const promptText = $<HTMLTextAreaElement>("#prompt-text");
const statusEl = $<HTMLElement>("#status");
const outEl = $<HTMLElement>("#output");
const composerEl = $<HTMLElement>(".composer");
const composerToggle = $<HTMLButtonElement>("#composer-toggle"); // 摘要列：展開
const composerCollapse = $<HTMLButtonElement>("#composer-collapse"); // 三欄區右上：折疊
const composerSummary = $<HTMLElement>("#composer-summary");

// 解析後把輸入區折疊成一行摘要，騰出空間給步驟面板；點「編輯輸入」展開
function collapseComposer(summary: string) {
  composerSummary.textContent = summary;
  composerEl.classList.add("collapsed");
  composerToggle.hidden = false;
}
composerToggle.addEventListener("click", () => composerEl.classList.remove("collapsed"));
composerCollapse.addEventListener("click", () => composerEl.classList.add("collapsed"));

let working: WorkingSprint | null = null;
let saveTimer: number | undefined;

function setStatus(msg: string, kind: "" | "ok" | "err" = "") {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

// 防抖自動存：頻繁打字不要每次寫 IndexedDB
function autosave() {
  if (!working) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (working) saveSprint(working).catch((e) => console.error("自動存失敗", e));
  }, 400);
}

// 由 working 重繪整個 output（parse / 還原 / 匯入共用）
function renderWorking() {
  if (!working) return;
  const sprint = working.raw;
  const report = validateSprint(sprint, working.transcript || undefined);

  const diverge = mountDiverge(sprint, {
    initial: working.diverge,
    onChange: () => {
      if (!working) return;
      working.diverge = diverge.snapshot();
      working.updated_at = new Date().toISOString();
      autosave();
    },
  });
  const graph = mountGraph(sprint, diverge.harvest);

  // 2×2 候選池：AI 點子 + 步2 收割，依主歸屬主題上色 + 帶主題（給篩選用）
  const candidateIdeas = (): IdeaRef[] => {
    if (!working) return [];
    const colors = assignConceptColors(working.raw.core_concepts.map((c) => c.id));
    const labels = new Map(working.raw.core_concepts.map((c) => [c.id, c.label]));
    const ai: IdeaRef[] = working.raw.nodes.map((n) => {
      const cid = n.core_concept_ids[0] ?? "";
      return {
        id: n.id,
        label: n.idea,
        origin: "ai",
        color: colors.get(cid) ?? ORPHAN_COLOR,
        conceptId: cid,
        conceptLabel: labels.get(cid) ?? "（未分類）",
      };
    });
    const extra: IdeaRef[] = harvestFromState(working.raw, working.diverge).map((x) => ({
      id: x.id,
      label: x.idea,
      origin: x.origin,
      color: colors.get(x.conceptId) ?? ORPHAN_COLOR,
      conceptId: x.conceptId,
      conceptLabel: labels.get(x.conceptId) ?? "（未分類）",
    }));
    return [...ai, ...extra];
  };
  const quad = mountQuadrant({
    getIdeas: candidateIdeas,
    initial: { shortlist: working.shortlist, placements: working.placements },
    onChange: (state) => {
      if (!working) return;
      working.shortlist = state.shortlist;
      working.placements = state.placements;
      working.updated_at = new Date().toISOString();
      autosave();
    },
  });

  // 想法牆面板＝驗證摘要列（上）+ 兩欄（左各主題數量、右積木牆，吃滿橫向）
  const wall = document.createElement("div");
  const wallLayout = document.createElement("div");
  wallLayout.className = "wall-layout";
  wallLayout.append(renderDistribution(report), renderBricks(sprint, report));
  wall.append(renderReport(report), wallLayout);

  // 步2 發散：關係圖永遠滿版，發散輸入是「覆蓋在圖上的抽屜」。
  // 抽屜用絕對定位 + transform 滑動，不參與排版 → 收合不會 reflow 圖、cytoscape 不需 resize、動畫不 glitch。
  const divergePanel = document.createElement("div");
  const workSplit = document.createElement("div");
  workSplit.className = "work-split";

  const workMain = document.createElement("div");
  workMain.className = "work-main";
  workMain.append(graph.el); // 關係圖只在步2 出現，固定掛這、永遠滿版

  const sidebar = document.createElement("div");
  sidebar.className = "work-sidebar";
  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.className = "sidebar-toggle";
  collapseBtn.textContent = "⮜ 收起側欄";
  collapseBtn.addEventListener("click", () => workSplit.classList.add("collapsed"));
  sidebar.append(collapseBtn, diverge.el);

  // 收合時左緣浮現的迷你進度欄（色點 + 4 段 pips）取代舊把手：垂直置中、不擋標題，
  // 一眼看各主題填了幾個角度；點整條 rail 即展開抽屜（圖寬不變，無需 graph.onShow）。
  diverge.rail.addEventListener("click", () => workSplit.classList.remove("collapsed"));

  workSplit.append(workMain, sidebar, diverge.rail);
  divergePanel.append(workSplit);

  // 步3 收斂：2×2 當寬主區（候選清單 + 畫布），不放並排圖
  const quadPanel = document.createElement("div");
  quadPanel.append(quad.el);

  const stepper = mountStepper([
    { label: "想法牆", sub: "看分布", panel: wall },
    {
      label: "發散",
      sub: "自己多想幾個",
      panel: divergePanel,
      onShow: () => graph.onShow(),
    },
    {
      label: "收斂",
      sub: "選方向",
      panel: quadPanel,
      onShow: () => quad.onShow(),
    },
  ]);

  outEl.innerHTML = "";
  outEl.append(stepper.el);
  graph.activate(); // 容器已在 DOM（步2 work-main，雖隱藏），建 cytoscape；onShow 會 resize+fit
  stepper.go(0); // 落在「想法牆」
  exportBtn.hidden = false;

  const trace = report.trace ? `，出處對得上 ${report.trace.matched}/${report.trace.total}` : "";
  const bad = report.schemaErrors.length > 0 || report.orphanConcepts.length > 0;
  setStatus(`${report.conceptCount} 主題 / ${report.nodeCount} 點子${trace}`, bad ? "err" : "ok");
  collapseComposer(`${report.conceptCount} 主題 / ${report.nodeCount} 點子`);
}

function parseAndRender() {
  const raw = jsonEl.value.trim();
  if (!raw) {
    setStatus("先貼上 ChatGPT 給的 JSON", "err");
    return;
  }
  let parsed: RawSprint;
  try {
    parsed = parseSprint(raw);
  } catch (e) {
    setStatus(`解析失敗：${(e as Error).message}`, "err");
    return;
  }
  working = newSprint(parsed, transcriptEl.value.trim());
  renderWorking();
  autosave();
}

parseBtn.addEventListener("click", parseAndRender);
jsonEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    parseAndRender();
  }
});

// ── 步0 prompt 工廠：逐字稿 → 可貼進 ChatGPT 的指令 ──────────────────
genPromptBtn.addEventListener("click", () => {
  const transcript = transcriptEl.value.trim();
  if (!transcript) {
    setStatus("先在①貼逐字稿，再產生指令", "err");
    return;
  }
  promptText.value = buildBackfillPrompt(transcript);
  promptOut.hidden = false;
  setStatus("指令已產生，複製後貼進 ChatGPT Plus", "ok");
});

copyPromptBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(promptText.value);
    setStatus("已複製，貼進 ChatGPT Plus", "ok");
  } catch {
    promptText.select(); // clipboard 不可用時退而求其次：選取讓使用者手動複製
    setStatus("無法自動複製，已選取請按 Ctrl+C", "err");
  }
});

// ── 匯出：下載當前 sprint .json ──────────────────────────────────
exportBtn.addEventListener("click", () => {
  if (!working) return;
  const blob = new Blob([toJson(working)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mycelium-lite-${working.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── 匯入：讀檔還原（覆蓋當前需確認 → 唯一具破壞性的操作）────────────
importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = ""; // 允許重選同檔
  if (!file) return;
  if (working && !window.confirm("匯入會覆蓋目前的 sprint，確定？")) return;
  try {
    const text = await file.text();
    let next: WorkingSprint;
    try {
      next = fromJson(text); // 優先：匯出的 sprint 檔
    } catch (sprintErr) {
      try {
        next = newSprint(parseSprint(text), transcriptEl.value.trim()); // 退而求其次：ChatGPT 回填 JSON
      } catch {
        throw sprintErr; // 兩種都不是 → 回報 sprint 檔的錯
      }
    }
    working = next;
    transcriptEl.value = working.transcript;
    renderWorking();
    autosave();
  } catch (e) {
    setStatus(`匯入失敗：${(e as Error).message}`, "err");
  }
});

// ── 啟動：還原上次 sprint（B1：重整頁不掉資料）────────────────────
loadSprint()
  .then((saved) => {
    if (!saved) return;
    working = saved;
    transcriptEl.value = saved.transcript;
    renderWorking();
    setStatus(`已回復上次 sprint（${saved.raw.core_concepts.length} 主題）`, "ok");
  })
  .catch((e) => console.error("還原失敗", e));
