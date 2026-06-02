// 步3 收斂：Impact/Effort 2×2。先從所有點子勾「精選」候選，再把候選拖進象限定位。
// 軸：縱 = 效益(上高)、橫 = 成本(右高)；左上 = 高效益低成本 = 優先(quick win)，已標色。
// 落點 placement {impact,effort} 各 0..1，存進 WorkingSprint 一起持久化/匯出。

import type { Placement } from "./model";

export interface IdeaRef {
  id: string;
  label: string;
  color: string;
  origin: "ai" | "human" | "spark";
  conceptId: string;
  conceptLabel: string;
}

export interface QuadrantState {
  shortlist: string[];
  placements: Record<string, Placement>;
}

export interface QuadrantOpts {
  getIdeas: () => IdeaRef[]; // 當前候選池（AI 點子 + 步2 收割）
  initial: QuadrantState;
  onChange: (state: QuadrantState) => void;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// 畫布像素座標 → placement（上=高效益、右=高成本）
export function xyToPlacement(px: number, py: number, w: number, h: number): Placement {
  return { effort: clamp01(px / w), impact: clamp01(1 - py / h) };
}

// placement → 畫布像素座標
export function placementToXy(p: Placement, w: number, h: number): { x: number; y: number } {
  return { x: p.effort * w, y: (1 - p.impact) * h };
}

// 對帳：候選池變動後，丟掉已不存在點子的 shortlist 與落點（純函式，可測）。
export function reconcile(state: QuadrantState, availableIds: string[]): QuadrantState {
  const avail = new Set(availableIds);
  const shortlist = state.shortlist.filter((id) => avail.has(id));
  const placements: Record<string, Placement> = {};
  for (const id of shortlist) {
    if (state.placements[id]) placements[id] = state.placements[id];
  }
  return { shortlist, placements };
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface QuadrantHandle {
  el: HTMLElement;
  onShow: () => void; // 步驟切回此面板：重抓候選 + 重畫（含 chip 尺寸）
}

export function mountQuadrant(opts: QuadrantOpts): QuadrantHandle {
  const shortlist = new Set(opts.initial.shortlist);
  const placements: Record<string, Placement> = { ...opts.initial.placements };
  let ideas = opts.getIdeas();

  const emit = (): void => {
    opts.onChange({ shortlist: [...shortlist], placements: { ...placements } });
  };

  const box = el("section", "quad-section");
  const head = el("div", "graph-head");
  head.append(el("h2", "section-title", "收斂：選出要做的方向"));
  const refreshBtn = el("button", "ghost-btn", "重整候選清單") as HTMLButtonElement;
  refreshBtn.type = "button";
  head.append(refreshBtn);
  box.append(head);
  box.append(
    el(
      "p",
      "graph-sub",
      "先在左邊勾選想認真評估的點子，它們會出現在右邊 2×2。拖曳定位——左上角(高效益、低成本)是優先做的。",
    ),
  );

  const layout = el("div", "quad-layout");
  const listCol = el("div", "quad-listcol");
  const filterSel = document.createElement("select");
  filterSel.className = "quad-filter";
  const listWrap = el("div", "quad-list");
  listCol.append(filterSel, listWrap);
  const canvas = el("div", "quad-canvas");
  layout.append(listCol, canvas);
  box.append(layout);

  let filterConcept = ""; // "" = 全部主題
  filterSel.addEventListener("change", () => {
    filterConcept = filterSel.value;
    renderList();
  });

  // 依當前候選池的主題重建篩選下拉（保留目前選擇若還在）
  function renderFilter(): void {
    const seen = new Map<string, string>();
    for (const i of ideas) if (!seen.has(i.conceptId)) seen.set(i.conceptId, i.conceptLabel);
    if (!seen.has(filterConcept)) filterConcept = "";
    filterSel.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = `全部主題（${ideas.length}）`;
    filterSel.append(all);
    for (const [id, label] of seen) {
      const count = ideas.filter((i) => i.conceptId === id).length;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${label}（${count}）`;
      filterSel.append(opt);
    }
    filterSel.value = filterConcept;
  }

  // 2×2 底圖：四象限（各帶標籤）+ 四向軸標 + quick-win 標記
  const grid = el("div", "quad-grid");
  const cell = (cls: string, tag: string): HTMLElement => {
    const c = el("div", cls);
    c.append(el("span", "cell-tag", tag));
    return c;
  };
  grid.append(
    cell("quad-cell quad-win", "先做 · 高效益低成本"),
    cell("quad-cell", "要規劃 · 高效益高成本"),
    cell("quad-cell", "順手做 · 低效益低成本"),
    cell("quad-cell", "別做 · 低效益高成本"),
  );
  canvas.append(grid);
  canvas.append(
    el("span", "quad-axis quad-axis-y", "效益高 ↑"),
    el("span", "quad-axis quad-axis-y-low", "效益低 ↓"),
    el("span", "quad-axis quad-axis-x", "成本高 →"),
    el("span", "quad-axis quad-axis-x-low", "← 成本低"),
  );
  const chipLayer = el("div", "quad-chips");
  canvas.append(chipLayer);

  function placeChip(chip: HTMLElement, p: Placement): void {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const { x, y } = placementToXy(p, w, h);
    chip.style.left = `${x}px`;
    chip.style.top = `${y}px`;
  }

  function renderChips(): void {
    chipLayer.replaceChildren();
    // 建一次 id→idea 對照，省掉每 chip 多次 O(n) find（renderChips 期間 ideas 不變）
    const ideasMap = new Map(ideas.map((i) => [i.id, i]));
    for (const id of shortlist) {
      const p = placements[id] ?? { impact: 0.5, effort: 0.5 };
      placements[id] = p;
      const idea = ideasMap.get(id);
      const label = idea?.label ?? id;
      const chip = el("div", "quad-chip");
      const dot = el("span", "quad-dot");
      dot.style.background = idea?.color ?? "#6b7785";
      chip.append(dot, document.createTextNode(label));
      chip.title = label;
      placeChip(chip, p);
      attachDrag(chip, id);
      chipLayer.append(chip);
    }
  }

  function attachDrag(chip: HTMLElement, id: string): void {
    chip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      chip.setPointerCapture(e.pointerId);
      chip.classList.add("dragging");
    });
    chip.addEventListener("pointermove", (e) => {
      if (!chip.hasPointerCapture(e.pointerId)) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      placements[id] = xyToPlacement(px, py, rect.width, rect.height);
      placeChip(chip, placements[id]);
    });
    chip.addEventListener("pointerup", (e) => {
      chip.releasePointerCapture(e.pointerId);
      chip.classList.remove("dragging");
      emit();
    });
    // 系統手勢中斷會發 pointercancel 而非 pointerup → 只清理狀態、不 emit，避免 dragging class 永久殘留
    chip.addEventListener("pointercancel", (e) => {
      chip.releasePointerCapture(e.pointerId);
      chip.classList.remove("dragging");
    });
  }

  function renderList(): void {
    listWrap.replaceChildren();
    if (ideas.length === 0) {
      listWrap.append(el("p", "quad-empty", "還沒有點子。先整理想法牆、或在步2 多想幾個。"));
      return;
    }
    const shown = filterConcept ? ideas.filter((i) => i.conceptId === filterConcept) : ideas;
    for (const idea of shown) {
      const row = el("label", "quad-item") as HTMLLabelElement;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = shortlist.has(idea.id);
      // 自訂勾選框外觀；原生 checkbox 隱藏但仍是狀態源（保留鍵盤/a11y）
      const check = el("span", "quad-check");
      const sync = () => {
        row.classList.toggle("checked", cb.checked);
        check.textContent = cb.checked ? "✓" : "";
      };
      cb.addEventListener("change", () => {
        if (cb.checked) {
          shortlist.add(idea.id);
          if (!placements[idea.id]) placements[idea.id] = { impact: 0.5, effort: 0.5 };
        } else {
          shortlist.delete(idea.id);
          delete placements[idea.id];
        }
        sync();
        renderChips();
        emit();
      });
      sync(); // 初始勾選狀態
      const dot = el("span", "quad-dot");
      dot.style.background = idea.color;
      const text = el("span", "quad-item-label", idea.label);
      row.append(cb, check, dot, text);
      listWrap.append(row);
    }
  }

  refreshBtn.addEventListener("click", () => {
    ideas = opts.getIdeas();
    const r = reconcile(
      { shortlist: [...shortlist], placements },
      ideas.map((i) => i.id),
    );
    shortlist.clear();
    for (const id of r.shortlist) shortlist.add(id);
    for (const k of Object.keys(placements)) delete placements[k];
    Object.assign(placements, r.placements);
    renderFilter();
    renderList();
    renderChips();
    emit();
  });

  renderFilter();
  renderList();
  // 容器尺寸要等掛進 DOM；下一個 frame 再放 chip，避免 0 寬高
  requestAnimationFrame(renderChips);

  return {
    el: box,
    onShow: () => {
      ideas = opts.getIdeas();
      // 切回此面板先對帳：步2 刪掉的點子要從 shortlist/placements 移除，
      // 否則 renderChips 會畫孤兒 chip，且 stale id 會被 onChange 持久化。
      const r = reconcile(
        { shortlist: [...shortlist], placements },
        ideas.map((i) => i.id),
      );
      shortlist.clear();
      for (const id of r.shortlist) shortlist.add(id);
      for (const k of Object.keys(placements)) delete placements[k];
      Object.assign(placements, r.placements);
      renderFilter();
      renderList();
      // 面板剛從隱藏轉顯示時 CSS 還沒 layout，canvas 寬高可能為 0 → 延到下一 frame 再放 chip
      requestAnimationFrame(renderChips);
    },
  };
}
