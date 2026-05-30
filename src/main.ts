// N0 wire（純前端，無後端、無 AI 呼叫）。
// 流程步0–1：人貼 ChatGPT 回填 JSON（+ 可選逐字稿）→ 解析 → 積木牆 + 概念分布。
import { parseSprint, validateSprint } from "./parse";
import { renderBricks, renderDistribution, renderLenses, renderReport } from "./render";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const jsonEl = $<HTMLTextAreaElement>("#json-input");
const transcriptEl = $<HTMLTextAreaElement>("#transcript-input");
const parseBtn = $<HTMLButtonElement>("#parse-btn");
const statusEl = $<HTMLElement>("#status");
const outEl = $<HTMLElement>("#output");

function setStatus(msg: string, kind: "" | "ok" | "err" = "") {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function run() {
  const raw = jsonEl.value.trim();
  if (!raw) {
    setStatus("先貼上 ChatGPT 回填的 JSON", "err");
    return;
  }
  let sprint: ReturnType<typeof parseSprint>;
  try {
    sprint = parseSprint(raw);
  } catch (e) {
    setStatus(`解析失敗：${(e as Error).message}`, "err");
    return;
  }
  const transcript = transcriptEl.value.trim() || undefined;
  const report = validateSprint(sprint, transcript);

  outEl.innerHTML = "";
  outEl.append(
    renderReport(report),
    renderDistribution(report),
    renderBricks(sprint, report),
    renderLenses(sprint),
  );

  const trace = report.trace ? `，可追溯 ${report.trace.matched}/${report.trace.total}` : "";
  const bad = report.schemaErrors.length > 0 || report.orphanConcepts.length > 0;
  setStatus(`${report.conceptCount} 概念 / ${report.nodeCount} 節點${trace}`, bad ? "err" : "ok");
}

parseBtn.addEventListener("click", run);
jsonEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    run();
  }
});
