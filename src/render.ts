// 步1 視覺化：積木牆（nodes 依核心概念分群）+ 概念分布條 + 四透鏡。
// E2 盲點訊號（N0 版）：概念分布不均——標出「薄概念」（mention 數低於平均）。
// ⚠️ PreMortem A4 待驗：薄是否真等於盲點，靠 N1 自己跑 3 次判斷。

import type { LensKey, RawSprint, ValidationReport } from "./parse";

const LENS_LABEL: Record<LensKey, string> = {
  fastest: "最快",
  reverse: "反向",
  crossdomain: "跨域",
  upstream: "上游",
};

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ── 驗證摘要列（成功標準的即時體檢）──────────────────────────────────────
export function renderReport(report: ValidationReport): HTMLElement {
  const box = el("div", "report");
  const stat = (label: string, value: string, kind = "") => {
    const s = el("span", `stat ${kind}`);
    s.append(el("b", undefined, value), el("span", "stat-label", label));
    return s;
  };
  box.append(stat("概念", String(report.conceptCount)), stat("節點", String(report.nodeCount)));
  if (report.trace) {
    const ok = report.trace.matched === report.trace.total;
    box.append(stat("可追溯", `${report.trace.matched}/${report.trace.total}`, ok ? "ok" : "err"));
  }
  const schemaOk = report.schemaErrors.length === 0;
  box.append(stat("schema 錯", String(report.schemaErrors.length), schemaOk ? "ok" : "err"));
  if (report.orphanConcepts.length) {
    box.append(stat("孤兒概念", report.orphanConcepts.join(","), "err"));
  }
  if (!schemaOk) {
    const errs = el("ul", "report-errs");
    for (const e of report.schemaErrors) errs.append(el("li", undefined, e));
    box.append(errs);
  }
  return box;
}

// ── 概念分布條（E2 盲點訊號）：依 count 降序，標薄概念 ──────────────────────
export function renderDistribution(report: ValidationReport): HTMLElement {
  const box = el("section", "dist");
  box.append(el("h2", "section-title", "概念分布（盲點訊號）"));
  const total = report.distribution.reduce((a, d) => a + d.count, 0);
  const avg = report.distribution.length ? total / report.distribution.length : 0;
  const max = report.distribution.reduce((a, d) => Math.max(a, d.count), 0) || 1;

  for (const d of report.distribution) {
    const thin = d.count < avg; // 低於平均 = 薄
    const row = el("div", `dist-row${thin ? " thin" : ""}`);
    row.append(el("span", "dist-label", d.label));
    const barWrap = el("div", "dist-bar-wrap");
    const bar = el("div", "dist-bar");
    bar.style.width = `${(d.count / max) * 100}%`;
    barWrap.append(bar);
    row.append(barWrap, el("span", "dist-count", String(d.count)));
    if (thin) row.append(el("span", "dist-flag", "← 薄"));
    box.append(row);
  }
  box.append(
    el(
      "p",
      "dist-hint",
      "「薄」= mention 數低於平均，可能是你想得少的地方（待你自己判斷是否真盲點）。",
    ),
  );
  return box;
}

// ── 積木牆：nodes 依「主歸屬概念」（第一個 core_concept_id）分群 ──────────────
export function renderBricks(sprint: RawSprint, report: ValidationReport): HTMLElement {
  const box = el("section", "wall");
  box.append(el("h2", "section-title", "積木牆"));

  const labels = new Map(sprint.core_concepts.map((c) => [c.id, c.label]));
  const countById = new Map(report.distribution.map((d) => [d.id, d.count]));
  const avg = report.distribution.length
    ? report.distribution.reduce((a, d) => a + d.count, 0) / report.distribution.length
    : 0;

  // 主歸屬分群（多概念 node 只進第一個群，避免重複膨脹）
  const groups = new Map<string, RawSprint["nodes"]>();
  for (const c of sprint.core_concepts) groups.set(c.id, []);
  for (const n of sprint.nodes) {
    const primary = n.core_concept_ids[0] ?? "_";
    if (!groups.has(primary)) groups.set(primary, []);
    groups.get(primary)?.push(n);
  }

  const grid = el("div", "wall-grid");
  // 依分布順序（厚→薄）排欄
  for (const d of report.distribution) {
    const nodes = groups.get(d.id) ?? [];
    const thin = (countById.get(d.id) ?? 0) < avg;
    const col = el("div", `wall-col${thin ? " thin" : ""}`);
    const head = el("div", "col-head");
    head.append(
      el("span", "col-label", labels.get(d.id) ?? d.id),
      el("span", "col-count", String(d.count)),
    );
    if (thin) head.append(el("span", "col-flag", "薄"));
    col.append(head);
    for (const n of nodes) {
      const card = el("div", "brick");
      card.append(el("div", "brick-idea", n.idea));
      const quote = el("div", "brick-quote", n.source_quote);
      quote.title = "原文（紅線 #2：照抄逐字稿）";
      card.append(quote);
      // 多概念 node 標出跨群歸屬
      if (n.core_concept_ids.length > 1) {
        const tags = el("div", "brick-tags");
        for (const cid of n.core_concept_ids.slice(1)) {
          tags.append(el("span", "brick-tag", labels.get(cid) ?? cid));
        }
        card.append(tags);
      }
      col.append(card);
    }
    grid.append(col);
  }
  box.append(grid);
  return box;
}

// ── 四透鏡（ChatGPT 一次往返同時給的發散方向）──────────────────────────────
export function renderLenses(sprint: RawSprint): HTMLElement {
  const box = el("section", "lenses");
  box.append(el("h2", "section-title", "四透鏡發散"));
  const grid = el("div", "lens-grid");
  for (const key of ["fastest", "reverse", "crossdomain", "upstream"] as LensKey[]) {
    const arr = sprint.lenses[key];
    const col = el("div", "lens-col");
    col.append(el("div", "lens-head", `${LENS_LABEL[key]}（${arr.length}）`));
    for (const l of arr) col.append(el("div", "lens-item", l.direction));
    grid.append(col);
  }
  box.append(grid);
  return box;
}
