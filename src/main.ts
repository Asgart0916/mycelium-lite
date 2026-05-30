import { invoke } from "@tauri-apps/api/core";

type Thought = { id: number; created_at: number; text: string };
type Candidate = {
  id: number;
  text: string;
  created_at: number;
  similarity: number;
  matched_text: string;
};
// Tier 1.5 火花
type SparkResult = { directions: string[]; musing: string };
type SparkHealth = { ollama_up: boolean; model_ready: boolean };

const TOP_K = 5;

// 硬體自適應選模型（可手動覆寫）。安裝時依 VRAM 自動選的功能留到打包階段(M4)，目前手動下拉。
const SPARK_MODELS = [
  { name: "qwen3.5:4b", temp: 0.7, label: "qwen3.5:4b（6GB·預設）" },
  { name: "qwen3:8b", temp: 0.9, label: "qwen3:8b（8GB+）" },
];

let thoughts: Thought[] = [];
let selectedId: number | null = null;
let sparkModel = SPARK_MODELS[0];
let sparkUp = false; // Ollama 在跑？
let sparkReady = false; // 目標模型已拉？

// ── DOM ───────────────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

const inputEl = $<HTMLTextAreaElement>("#input");
const addBtn = $<HTMLButtonElement>("#add-btn");
const statusEl = $<HTMLElement>("#status");
const listEl = $<HTMLUListElement>("#thought-list");
const countEl = $<HTMLElement>("#count");
const seedEl = $<HTMLElement>("#seed");
const candsEl = $<HTMLElement>("#candidates");
const clearBtn = $<HTMLButtonElement>("#clear-btn");
const sparkBarEl = $<HTMLElement>("#spark-bar");
const sparkPanelEl = $<HTMLElement>("#spark-panel");

// ── helpers ─────────────────────────────────────────────────────────────────
function setStatus(msg: string, kind: "" | "ok" | "err" = "") {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const day = 86_400_000;
  const d = new Date(ms);
  const stamp = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (diff < 60_000) return `剛剛 · ${stamp}`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)} 小時前 · ${stamp}`;
  return `${Math.floor(diff / day)} 天前 · ${stamp}`;
}

// ── render ────────────────────────────────────────────────────────────────
function renderThoughts() {
  countEl.textContent = String(thoughts.length);
  listEl.innerHTML = "";
  for (const t of thoughts) {
    const li = document.createElement("li");
    li.className = "thought-item" + (t.id === selectedId ? " active" : "");
    li.innerHTML = `
      <div class="t-main">
        <div class="t-text"></div>
        <div class="t-time">${relTime(t.created_at)}</div>
      </div>
      <button class="t-del" title="刪除這個想法">✕</button>`;
    (li.querySelector(".t-text") as HTMLElement).textContent = t.text;
    li.querySelector(".t-main")!.addEventListener("click", () => selectThought(t.id));
    li.querySelector(".t-del")!.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteThought(t.id);
    });
    listEl.appendChild(li);
  }
}

function renderSeed(t: Thought | null) {
  if (!t) {
    seedEl.className = "seed empty";
    seedEl.textContent = "← 選一個想法，看它浮現的連結";
    return;
  }
  seedEl.className = "seed";
  seedEl.innerHTML = `<span class="seed-label">浮現連結 ←</span><div class="seed-text"></div>`;
  (seedEl.querySelector(".seed-text") as HTMLElement).textContent = t.text;
}

function renderCandidates(cands: Candidate[]) {
  candsEl.innerHTML = "";
  if (cands.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cand-empty";
    empty.textContent = "沒有可浮現的連結（想法太少，或都判過了）。";
    candsEl.appendChild(empty);
    return;
  }
  cands.forEach((c, i) => {
    const card = document.createElement("div");
    card.className = "cand";
    card.innerHTML = `
      <div class="cand-rank">#${i + 1}</div>
      <div class="cand-body">
        <div class="cand-text"></div>
        <div class="cand-why">↳ 對到這句：<span class="why-text"></span></div>
        <div class="cand-meta">
          <span>${relTime(c.created_at)}</span>
          <span class="cand-sim" title="cosine（僅供參考，判斷靠排序不靠絕對值）">~${c.similarity.toFixed(3)}</span>
        </div>
      </div>
      <div class="cand-actions">
        <button class="btn-confirm" title="確認：長出這條菌絲">✓ 相關</button>
        <button class="btn-reject" title="否決：不再浮現">✗ 無關</button>
      </div>`;
    (card.querySelector(".cand-text") as HTMLElement).textContent = c.text;
    const whyEl = card.querySelector(".cand-why") as HTMLElement;
    if (c.matched_text && c.matched_text !== c.text) {
      (card.querySelector(".why-text") as HTMLElement).textContent = c.matched_text;
    } else {
      whyEl.style.display = "none"; // 整段就一句,不必再標
    }
    card.querySelector(".btn-confirm")!.addEventListener("click", () =>
      decide(card, c, "confirmed"),
    );
    card.querySelector(".btn-reject")!.addEventListener("click", () =>
      decide(card, c, "rejected"),
    );
    candsEl.appendChild(card);
  });
}

// ── actions ──────────────────────────────────────────────────────────────
async function refreshThoughts() {
  thoughts = await invoke<Thought[]>("list_thoughts");
  renderThoughts();
}

async function selectThought(id: number) {
  selectedId = id;
  renderThoughts();
  const t = thoughts.find((x) => x.id === id) ?? null;
  renderSeed(t);
  renderSparkBar(t);
  sparkPanelEl.innerHTML = "";
  try {
    const cands = await invoke<Candidate[]>("find_connections", {
      thoughtId: id,
      topK: TOP_K,
    });
    renderCandidates(cands);
  } catch (e) {
    setStatus(`撈連結失敗：${e}`, "err");
  }
}

async function addThought() {
  const text = inputEl.value.trim();
  if (!text) return;
  addBtn.disabled = true;
  setStatus("嵌入中…");
  try {
    const newId = await invoke<number>("add_thought", { text });
    inputEl.value = "";
    setStatus("已倒進來", "ok");
    await refreshThoughts();
    await selectThought(newId);
  } catch (e) {
    setStatus(`失敗：${e}`, "err");
  } finally {
    addBtn.disabled = false;
  }
}

async function decide(card: HTMLElement, c: Candidate, status: "confirmed" | "rejected") {
  if (selectedId === null) return;
  const cmd = status === "confirmed" ? "confirm_link" : "reject_link";
  try {
    await invoke(cmd, { src: selectedId, dst: c.id, similarity: c.similarity });
    card.classList.add("decided", status);
    const actions = card.querySelector(".cand-actions") as HTMLElement;
    actions.innerHTML = status === "confirmed" ? "✓ 已連結" : "✗ 已否決";
  } catch (e) {
    setStatus(`寫入失敗：${e}`, "err");
  }
}

async function deleteThought(id: number) {
  try {
    await invoke("delete_thought", { thoughtId: id });
    if (selectedId === id) {
      selectedId = null;
      renderSeed(null);
      candsEl.innerHTML = "";
    }
    await refreshThoughts();
    setStatus("已刪除", "ok");
  } catch (e) {
    setStatus(`刪除失敗：${e}`, "err");
  }
}

async function clearAll() {
  if (thoughts.length === 0) return;
  if (!confirm(`清空全部 ${thoughts.length} 個想法？此操作無法復原。`)) return;
  try {
    await invoke("clear_all");
    selectedId = null;
    renderSeed(null);
    candsEl.innerHTML = "";
    await refreshThoughts();
    setStatus("已清空", "ok");
  } catch (e) {
    setStatus(`清空失敗：${e}`, "err");
  }
}

// ── Tier 1.5 火花 ────────────────────────────────────────────────────────────
// 火花是拋棄式建議：人挑/改 → 「保留」才走 add_thought 升格成新想法（守紅線 #2）。

async function checkSparkHealth() {
  try {
    const h = await invoke<SparkHealth>("spark_health", { model: sparkModel.name });
    sparkUp = h.ollama_up;
    sparkReady = h.model_ready;
  } catch {
    sparkUp = false;
    sparkReady = false;
  }
  const t = selectedId === null ? null : (thoughts.find((x) => x.id === selectedId) ?? null);
  renderSparkBar(t);
}

function renderSparkBar(t: Thought | null) {
  sparkBarEl.innerHTML = "";
  if (!t) return;

  const btn = document.createElement("button");
  btn.className = "spark-btn";
  btn.textContent = "✨ 靈感火花";
  const healthy = sparkUp && sparkReady;
  if (!healthy) {
    btn.disabled = true;
    btn.title = sparkUp
      ? `沒拉模型：終端機執行  ollama pull ${sparkModel.name}`
      : "未偵測到 Ollama——啟動 Ollama 以解鎖靈感火花";
  } else {
    btn.title = "對這個想法生成延伸方向 + 隨想";
  }
  btn.addEventListener("click", doSpark);
  sparkBarEl.appendChild(btn);

  const sel = document.createElement("select");
  sel.className = "spark-model";
  SPARK_MODELS.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = m.label;
    if (m === sparkModel) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => {
    sparkModel = SPARK_MODELS[Number(sel.value)];
    checkSparkHealth();
  });
  sparkBarEl.appendChild(sel);

  if (!healthy) {
    const hint = document.createElement("span");
    hint.className = "spark-down";
    hint.textContent = sparkUp ? `缺 ${sparkModel.name}` : "Ollama 未啟動";
    sparkBarEl.appendChild(hint);
  }
}

async function doSpark() {
  if (selectedId === null) return;
  sparkPanelEl.innerHTML = "";
  setStatus("火花生成中…（首次載入模型會慢幾秒）");
  try {
    const r = await invoke<SparkResult>("spark", {
      thoughtId: selectedId,
      model: sparkModel.name,
      temperature: sparkModel.temp,
    });
    renderSparkResult(r);
    setStatus("火花來了——挑你喜歡的、改一改，按「保留」", "ok");
  } catch (e) {
    setStatus(`火花失敗：${e}`, "err");
  }
}

function renderSparkResult(r: SparkResult) {
  sparkPanelEl.innerHTML = "";
  const hint = document.createElement("div");
  hint.className = "spark-hint";
  hint.textContent = "拋棄式建議——挑你喜歡的、改一改，按「保留」變成新想法。";
  sparkPanelEl.appendChild(hint);
  r.directions.forEach((d) => sparkPanelEl.appendChild(makeKeepRow(d, "dir")));
  if (r.musing.trim()) sparkPanelEl.appendChild(makeKeepRow(r.musing, "musing"));
}

function makeKeepRow(text: string, kind: "dir" | "musing"): HTMLElement {
  const row = document.createElement("div");
  row.className = "spark-row " + kind;
  const field = (
    kind === "musing" ? document.createElement("textarea") : document.createElement("input")
  ) as HTMLInputElement | HTMLTextAreaElement;
  field.className = "spark-field";
  field.value = text;
  if (field instanceof HTMLTextAreaElement) field.rows = 2;
  const btn = document.createElement("button");
  btn.className = "spark-keep";
  btn.textContent = "保留";
  btn.title = "把這條（可先編輯）存成新想法";
  btn.addEventListener("click", () => promote(field.value, row));
  row.appendChild(field);
  row.appendChild(btn);
  return row;
}

async function promote(text: string, row: HTMLElement) {
  const t = text.trim();
  if (!t) return;
  try {
    await invoke<number>("add_thought", { text: t });
    row.classList.add("kept");
    const btn = row.querySelector(".spark-keep") as HTMLButtonElement;
    btn.textContent = "✓ 已保留";
    btn.disabled = true;
    (row.querySelector(".spark-field") as HTMLInputElement).disabled = true;
    await refreshThoughts();
    setStatus("火花已升格成新想法", "ok");
  } catch (e) {
    setStatus(`保留失敗：${e}`, "err");
  }
}

// ── wire ──────────────────────────────────────────────────────────────────
addBtn.addEventListener("click", addThought);
clearBtn.addEventListener("click", clearAll);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    addThought();
  }
});

refreshThoughts();
checkSparkHealth();
