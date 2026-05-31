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
const composerToggle = $<HTMLButtonElement>("#composer-toggle");
const composerSummary = $<HTMLElement>("#composer-summary");

// 解析後把輸入區折疊成一行摘要，騰出空間給步驟面板；點「編輯輸入」展開
function collapseComposer(summary: string) {
  composerSummary.textContent = summary;
  composerEl.classList.add("collapsed");
  composerToggle.hidden = false;
  composerToggle.textContent = "✎ 編輯輸入";
}
composerToggle.addEventListener("click", () => {
  const collapsed = composerEl.classList.toggle("collapsed");
  composerToggle.textContent = collapsed ? "✎ 編輯輸入" : "▴ 收合";
});

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

  // 想法牆面板＝驗證摘要 + 各主題數量 + 積木牆
  const wall = document.createElement("div");
  wall.append(renderReport(report), renderDistribution(report), renderBricks(sprint, report));

  // 步2 發散：左側可塌縮 sidebar（發散輸入）+ 右側大關係圖。圖是主角，sidebar 收起後更寬。
  const divergePanel = document.createElement("div");
  const workSplit = document.createElement("div");
  workSplit.className = "work-split";
  const sidebar = document.createElement("div");
  sidebar.className = "work-sidebar";
  sidebar.append(diverge.el);
  const workMain = document.createElement("div");
  workMain.className = "work-main";
  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.className = "sidebar-toggle";
  collapseBtn.textContent = "◀ 收起輸入欄";
  collapseBtn.addEventListener("click", () => {
    const collapsed = workSplit.classList.toggle("collapsed");
    collapseBtn.textContent = collapsed ? "▶ 展開輸入欄" : "◀ 收起輸入欄";
    graph.onShow(); // 寬度變了 → cytoscape 重算尺寸並重 fit
  });
  workMain.append(collapseBtn, graph.el); // 關係圖只在步2 出現，固定掛這
  workSplit.append(sidebar, workMain);
  divergePanel.append(workSplit);

  // 步3 收斂：2×2 當寬主區（候選清單 + 畫布），不放並排圖
  const quadPanel = document.createElement("div");
  quadPanel.append(quad.el);

  const stepper = mountStepper([
    { label: "想法牆", panel: wall },
    {
      label: "發散：自己多想",
      panel: divergePanel,
      onShow: () => graph.onShow(),
    },
    {
      label: "收斂：選方向",
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
