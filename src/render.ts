// 步1 視覺化：想法牆（點子依主題分群）+ 各主題點子數量。
// 步2：自己多想幾個（人手動逐角度 × 主題發散）+ 揭露漏掉的角度／主題（diverge.ts）。
// 用語刻意白話：主題=核心概念、點子=節點、角度=透鏡，畫面不出現技術詞。

import { type DivergeCell, detectGaps } from "./diverge";
import { LENS_KEYS, type LensKey, type RawSprint, type ValidationReport } from "./parse";

// 四個角度的畫面標題 + 引導問（沿用 crazy8s 已驗的問句）
const LENS_META: Record<LensKey, { title: string; hint: string }> = {
  fastest: { title: "最快版本", hint: "只有 1 天能做，你會怎麼解？" },
  reverse: { title: "反過來想", hint: "如果解的是「相反的問題」呢？" },
  crossdomain: { title: "跨界借鏡", hint: "別的領域（醫院／遊戲／餐廳）怎麼處理這情境？" },
  upstream: { title: "往上游挖", hint: "不改產品，解更根本的問題是什麼？" },
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
  box.append(stat("主題", String(report.conceptCount)), stat("點子", String(report.nodeCount)));
  if (report.trace) {
    const ok = report.trace.matched === report.trace.total;
    box.append(
      stat("出處對得上", `${report.trace.matched}/${report.trace.total}`, ok ? "ok" : "err"),
    );
  }
  const schemaOk = report.schemaErrors.length === 0;
  box.append(stat("格式問題", String(report.schemaErrors.length), schemaOk ? "ok" : "err"));
  if (report.orphanConcepts.length) {
    box.append(stat("沒被用到的主題", report.orphanConcepts.join(","), "err"));
  }
  if (!schemaOk) {
    const errs = el("ul", "report-errs");
    for (const e of report.schemaErrors) errs.append(el("li", undefined, e));
    box.append(errs);
  }
  return box;
}

// ── 各主題點子數量（結構整理視覺，非盲點偵測；盲點偵測已移到步2）────────────
export function renderDistribution(report: ValidationReport): HTMLElement {
  const box = el("section", "dist");
  box.append(el("h2", "section-title", "各主題的點子數量"));
  const total = report.distribution.reduce((a, d) => a + d.count, 0);
  const avg = report.distribution.length ? total / report.distribution.length : 0;
  const max = report.distribution.reduce((a, d) => Math.max(a, d.count), 0) || 1;

  for (const d of report.distribution) {
    const thin = d.count < avg; // 低於平均 = 點子少
    const row = el("div", `dist-row${thin ? " thin" : ""}`);
    row.append(el("span", "dist-label", d.label));
    const barWrap = el("div", "dist-bar-wrap");
    const bar = el("div", "dist-bar");
    bar.style.width = `${(d.count / max) * 100}%`;
    barWrap.append(bar);
    row.append(barWrap, el("span", "dist-count", String(d.count)));
    if (thin) row.append(el("span", "dist-flag", "想得少"));
    box.append(row);
  }
  box.append(
    el(
      "p",
      "dist-hint",
      "這主題你點子比較少——不一定是漏，自己判斷。真正的盲點往下走「自己多想幾個」才照得出來。",
    ),
  );
  return box;
}

// ── 想法牆：點子依「主歸屬主題」（第一個 core_concept_id）分群 ────────────────
export function renderBricks(sprint: RawSprint, report: ValidationReport): HTMLElement {
  const box = el("section", "wall");
  box.append(el("h2", "section-title", "想法牆"));
  box.append(el("p", "wall-sub", "你和 AI 整理出的點子，依主題分群。"));

  const labels = new Map(sprint.core_concepts.map((c) => [c.id, c.label]));
  const countById = new Map(report.distribution.map((d) => [d.id, d.count]));
  const avg = report.distribution.length
    ? report.distribution.reduce((a, d) => a + d.count, 0) / report.distribution.length
    : 0;

  // 主歸屬分群（多主題 node 只進第一個群，避免重複膨脹）
  const groups = new Map<string, RawSprint["nodes"]>();
  for (const c of sprint.core_concepts) groups.set(c.id, []);
  for (const n of sprint.nodes) {
    const primary = n.core_concept_ids[0] ?? "_";
    if (!groups.has(primary)) groups.set(primary, []);
    groups.get(primary)?.push(n);
  }

  const grid = el("div", "wall-grid");
  // 依數量順序（多→少）排欄
  for (const d of report.distribution) {
    const nodes = groups.get(d.id) ?? [];
    const thin = (countById.get(d.id) ?? 0) < avg;
    const col = el("div", `wall-col${thin ? " thin" : ""}`);
    const head = el("div", "col-head");
    head.append(
      el("span", "col-label", labels.get(d.id) ?? d.id),
      el("span", "col-count", String(d.count)),
    );
    if (thin) head.append(el("span", "col-flag", "少"));
    col.append(head);
    for (const n of nodes) {
      const card = el("div", "brick");
      card.append(el("div", "brick-idea", n.idea));
      const quote = el("div", "brick-quote", n.source_quote);
      quote.title = "原文（紅線 #2：照抄逐字稿）";
      card.append(quote);
      // 多主題 node 標出跨群歸屬
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

// ── 步2：自己多想幾個（AI 的角度先藏，按鈕揭露漏掉的角度／主題）────────────────
export function mountDiverge(sprint: RawSprint): HTMLElement {
  const box = el("section", "diverge");
  box.append(el("h2", "section-title", "自己多想幾個"));
  box.append(
    el(
      "p",
      "diverge-hint",
      "先別看 AI 的角度。對每個主題，從四個角度自己想想能補什麼點子——想到哪格寫哪格，空著也沒關係，空白本身就是線索。",
    ),
  );

  const grid = el("div", "diverge-grid");
  grid.style.gridTemplateColumns = `150px repeat(${LENS_KEYS.length}, 1fr)`;

  // 表頭：左上角空格 + 四個角度（AI 內容先藏）
  grid.append(el("div", "dv-corner"));
  const lensReveal: Record<string, HTMLElement> = {};
  for (const lens of LENS_KEYS) {
    const head = el("div", "dv-lenshead");
    head.dataset.lens = lens;
    head.append(
      el("div", "dv-lens-title", LENS_META[lens].title),
      el("div", "dv-lens-hint", LENS_META[lens].hint),
    );
    const aiBox = el("div", "dv-ai");
    aiBox.hidden = true;
    lensReveal[lens] = aiBox;
    head.append(aiBox);
    grid.append(head);
  }

  // 每個主題一列，每格一個輸入區
  for (const c of sprint.core_concepts) {
    const label = el("div", "dv-conceptlabel", c.label);
    label.dataset.concept = c.id;
    grid.append(label);
    for (const lens of LENS_KEYS) {
      const cellWrap = el("div", "dv-cell");
      cellWrap.dataset.concept = c.id;
      cellWrap.dataset.lens = lens;
      const ta = document.createElement("textarea");
      ta.className = "dv-input";
      ta.rows = 2;
      ta.placeholder = "一行一個想法…";
      ta.dataset.concept = c.id;
      ta.dataset.lens = lens;
      cellWrap.append(ta);
      grid.append(cellWrap);
    }
  }
  box.append(grid);

  const actions = el("div", "diverge-actions");
  const revealBtn = el("button", "reveal-btn", "看看我漏了什麼");
  actions.append(revealBtn);
  box.append(actions);

  const result = el("div", "diverge-result");
  result.hidden = true;
  box.append(result);

  const lensHasAi: Record<LensKey, boolean> = {
    fastest: sprint.lenses.fastest.length > 0,
    reverse: sprint.lenses.reverse.length > 0,
    crossdomain: sprint.lenses.crossdomain.length > 0,
    upstream: sprint.lenses.upstream.length > 0,
  };
  const conceptLabels = new Map(sprint.core_concepts.map((c) => [c.id, c.label]));
  const conceptIds = sprint.core_concepts.map((c) => c.id);

  revealBtn.addEventListener("click", () => {
    // 收集人手動填的格（一行一個點子，空白行濾掉）
    const cells: DivergeCell[] = [];
    for (const c of sprint.core_concepts) {
      for (const lens of LENS_KEYS) {
        const ta = grid.querySelector<HTMLTextAreaElement>(
          `textarea[data-concept="${c.id}"][data-lens="${lens}"]`,
        );
        const ideas = (ta?.value ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        cells.push({ conceptId: c.id, lens, ideas });
      }
    }
    const report = detectGaps(conceptIds, lensHasAi, cells);

    // 揭露 AI 的角度（先前藏起來）
    for (const lens of LENS_KEYS) {
      const aiBox = lensReveal[lens];
      aiBox.hidden = false;
      aiBox.replaceChildren();
      const dirs = sprint.lenses[lens];
      if (dirs.length === 0) {
        aiBox.append(el("div", "dv-ai-label", "AI 沒給這角度"));
      } else {
        aiBox.append(el("div", "dv-ai-label", "AI 從這角度想到："));
        for (const d of dirs) aiBox.append(el("div", "dv-ai-item", d.direction));
      }
    }

    // 高亮漏掉的角度（整列）與主題（整欄）
    for (const lens of LENS_KEYS) {
      const skipped = report.skippedLenses.includes(lens);
      for (const node of grid.querySelectorAll(`[data-lens="${lens}"]`)) {
        node.classList.toggle("gap-lens", skipped);
      }
    }
    for (const id of conceptIds) {
      const skipped = report.skippedConcepts.includes(id);
      for (const node of grid.querySelectorAll(`[data-concept="${id}"]`)) {
        node.classList.toggle("gap-concept", skipped);
      }
    }

    // 彙總句（列／欄層級，不逐格洗版）
    result.hidden = false;
    result.replaceChildren();
    result.append(el("h3", "result-title", "你沒想到的角度"));
    if (report.skippedLenses.length === 0 && report.skippedConcepts.length === 0) {
      result.append(
        el(
          "p",
          "result-ok",
          `四個角度、每個主題你都碰到了（${report.touchedCells}/${report.totalCells} 格）——這輪沒有明顯漏掉的角度。`,
        ),
      );
      return;
    }
    const ul = el("ul", "result-list");
    for (const lens of report.skippedLenses) {
      ul.append(
        el(
          "li",
          "result-lens",
          `你整輪都沒從「${LENS_META[lens].title}」想過任何主題——AI 在這角度想到了東西（看上方），你沒碰。`,
        ),
      );
    }
    for (const id of report.skippedConcepts) {
      ul.append(
        el(
          "li",
          "result-concept",
          `「${conceptLabels.get(id) ?? id}」你完全沒多想幾個（四個角度都空）。`,
        ),
      );
    }
    result.append(ul);
    result.append(
      el(
        "p",
        "result-foot",
        `已碰 ${report.touchedCells}/${report.totalCells} 格。被點到的角度，問自己：是「對耶沒想到」，還是「我知道但覺得次要」？`,
      ),
    );
  });

  return box;
}
