// 步1 視覺化：想法牆（點子依主題分群）+ 各主題點子數量。
// 步2：自己多想幾個（人手動逐角度 × 主題發散）+ 揭露漏掉的角度／主題（diverge.ts）。
// 用語刻意白話：主題=核心概念、點子=節點、角度=透鏡，畫面不出現技術詞。

import { type DivergeCell, detectGaps } from "./diverge";
import { type ExtraNode, type HarvestRow, assignConceptColors, harvestNodes } from "./graph-model";
import { type DivergeState, cellKey } from "./model";
import { LENS_KEYS, type LensKey, type RawSprint, type ValidationReport } from "./parse";
import { type SparkResult, detectOllama, summonSpark } from "./spark";

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

// 火花結果顯示在該格下方，標「機器提示」與人發散區隔；按「採用」才把該方向落地進 textarea
// （ephemeral，不自動入想法牆 → 守紅線 #2）。onAdopt 記下被採用的文字，供關係圖標來源=火花。
function renderSparkOut(
  box: HTMLElement,
  result: SparkResult,
  ta: HTMLTextAreaElement,
  onAdopt: (text: string) => void,
): void {
  box.hidden = false;
  box.replaceChildren();
  if (result.directions.length === 0 && result.musing === "") {
    box.append(el("div", "spark-err", "火花沒吐出可用內容，再試一次。"));
    return;
  }
  box.append(el("div", "spark-label", "機器提示 · 不會自動入牆，按「採用」才落地"));
  result.directions.forEach((d, i) => {
    const row = el("div", "spark-dir");
    row.style.setProperty("--reveal-i", String(i)); // 逐條 stagger 進場
    row.append(el("span", "spark-dir-text", d));
    const take = el("button", "spark-take", "採用") as HTMLButtonElement;
    take.type = "button";
    take.addEventListener("click", () => {
      const cur = ta.value.trim();
      ta.value = cur.length > 0 ? `${cur}\n${d}` : d;
      onAdopt(d);
    });
    row.append(take);
    box.append(row);
  });
  if (result.musing) {
    box.append(el("div", "spark-musing", result.musing));
  }
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

  let hasThin = false;
  for (const d of report.distribution) {
    const thin = d.count < avg; // 低於平均 = 點子少
    if (thin) hasThin = true;
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
  // 沒有任何「想得少」的列時不顯示提示，否則使用者找不到對應旗標會困惑
  if (hasThin) {
    box.append(
      el(
        "p",
        "dist-hint",
        "標「想得少」的主題點子比較少——不一定是漏，自己判斷。真正的盲點往下走「自己多想幾個」才照得出來。",
      ),
    );
  }
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
      el("span", "col-count", String(nodes.length)), // 用實際入欄卡片數：d.count 對跨主題 node 重複計
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

// 步2 收割結果：每格的人填內容轉成帶來源的點子（關係圖「更新」用）。
export interface DivergeHandle {
  el: HTMLElement;
  rail: HTMLElement; // 收合時左緣的迷你進度欄（色點 + 4 段 pips）
  harvest: () => ExtraNode[];
  snapshot: () => DivergeState; // 目前各格內容 + 火花採用紀錄（持久化用）
}

export interface DivergeOpts {
  initial?: DivergeState; // 從持久化還原時預填
  onChange?: () => void; // 任一格編輯/採用時觸發（主程式據此自動存）
}

// ── 步2：自己多想幾個（AI 的角度先藏，按鈕揭露漏掉的角度／主題）────────────────
export function mountDiverge(sprint: RawSprint, opts: DivergeOpts = {}): DivergeHandle {
  const box = el("section", "diverge");
  box.append(el("h2", "section-title", "自己多想幾個"));
  box.append(
    el(
      "p",
      "diverge-hint",
      "先別看 AI 的角度。對每個主題，從四個角度自己想想能補什麼點子——想到哪格寫哪格，空著也沒關係，空白本身就是線索。",
    ),
  );

  // 各主題的色（取自關係圖主節點配色）→ 角度卡背景用相近色系
  const conceptColors = assignConceptColors(sprint.core_concepts.map((c) => c.id));

  // 火花召喚頻率（in-session，N4 再進 IndexedDB）：某主題召喚多 = 你這塊弱（輔助盲點訊號）
  const sparkCounts = new Map<string, number>();
  // 各格被「採用」過的火花文字 → 關係圖更新時標來源=spark（其餘人填行 = human）。從持久化還原。
  const sparkAdopted = new Map<string, Set<string>>();
  for (const [k, list] of Object.entries(opts.initial?.adopted ?? {})) {
    sparkAdopted.set(k, new Set(list));
  }

  // 垂直 accordion：一個主題一個可收合區，內含 4 個角度直向堆疊（可多開、預設全展開）。
  // 改自原本的 5 欄寬矩陣，讓步2 能塞進左側窄 sidebar。
  const accordion = el("div", "dv-accordion");
  const aiBoxes: HTMLElement[] = []; // 各主題各角度的 AI 揭露框，reveal 時一起填（同角度內容相同）

  // 收合時左緣的迷你進度欄：一主題一列（色點 + 4 段 pips），同步各主題填了幾個角度
  const rail = el("div", "dv-rail");

  for (const c of sprint.core_concepts) {
    const section = el("div", "dv-section");
    section.dataset.concept = c.id;
    // 卡片背景取該主題（主節點）色系 → 角度卡視覺綁回主題
    section.style.setProperty("--card-tint", conceptColors.get(c.id) ?? "#5dcaa5");

    // 主題標頭：點擊收合／展開（caret 旋轉由 CSS 控）
    const summary = el("button", "dv-summary") as HTMLButtonElement;
    summary.type = "button";
    summary.dataset.concept = c.id;
    const countEl = el("span", "dv-summary-count");
    summary.append(el("span", "dv-caret", "▾"), el("span", "dv-summary-label", c.label), countEl);
    summary.addEventListener("click", () => section.classList.toggle("collapsed"));

    const body = el("div", "dv-section-body");
    // 標頭右側「填了幾個角度」進度（純視覺，依非空 textarea 數）
    const sectionTextareas: HTMLTextAreaElement[] = [];

    // 收合列：色點（主題色）+ 4 段 pips，與標頭計數同步；hover 才浮主題名 + 進度
    const tint = conceptColors.get(c.id) ?? "#5dcaa5";
    const railItem = el("div", "dv-rail-item");
    railItem.dataset.concept = c.id;
    const railDot = el("span", "dv-rail-dot");
    railDot.style.background = tint;
    const railPips = el("div", "dv-rail-pips");
    const pips = LENS_KEYS.map(() => {
      const pip = el("span", "dv-rail-pip");
      pip.style.setProperty("--pip-color", tint);
      railPips.append(pip);
      return pip;
    });
    railItem.append(railDot, railPips);
    rail.append(railItem);

    const updateCount = () => {
      const filled = sectionTextareas.filter((t) => t.value.trim().length > 0).length;
      countEl.textContent = `${filled}/${LENS_KEYS.length}`;
      pips.forEach((pip, i) => pip.classList.toggle("on", i < filled)); // 亮前 filled 段
      railItem.title = `${c.label} · ${filled}/${LENS_KEYS.length}`;
    };
    for (const lens of LENS_KEYS) {
      const block = el("div", "dv-lensblock");
      block.dataset.concept = c.id;
      block.dataset.lens = lens;
      block.append(
        el("div", "dv-lens-title", LENS_META[lens].title),
        el("div", "dv-lens-hint", LENS_META[lens].hint),
      );

      const ta = document.createElement("textarea");
      ta.className = "dv-input";
      ta.rows = 2;
      ta.placeholder = "一行一個想法…";
      ta.dataset.concept = c.id;
      ta.dataset.lens = lens;
      ta.value = opts.initial?.text?.[cellKey(c.id, lens)] ?? ""; // 還原預填
      sectionTextareas.push(ta);
      ta.addEventListener("input", () => {
        opts.onChange?.();
        updateCount();
      });

      // 火花破冰：偵測到 Ollama 才啟用（box.spark-on），hover 該角度區塊浮現（CSS 控）
      const spark = el("button", "spark-btn", "卡住了？破冰") as HTMLButtonElement;
      spark.type = "button";
      const sparkOut = el("div", "spark-out");
      sparkOut.hidden = true;

      spark.addEventListener("click", async () => {
        const ideas = (ta.value ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        sparkCounts.set(c.id, (sparkCounts.get(c.id) ?? 0) + 1);
        spark.disabled = true;
        spark.textContent = "想中…";
        spark.classList.add("spark-loading"); // 呼吸脈動，傳達本地推論進行中
        try {
          const result = await summonSpark(
            c.label,
            LENS_META[lens].title,
            LENS_META[lens].hint,
            ideas,
          );
          renderSparkOut(sparkOut, result, ta, (text) => {
            const key = cellKey(c.id, lens);
            const set = sparkAdopted.get(key) ?? new Set<string>();
            set.add(text);
            sparkAdopted.set(key, set);
            opts.onChange?.(); // 採用後文字進了 textarea，回報以便自動存
            updateCount(); // 採用是直接寫 ta.value（不觸發 input）→ 手動刷新標頭 N/4 與 rail pips
          });
        } catch (e) {
          sparkOut.hidden = false;
          sparkOut.replaceChildren(
            el(
              "div",
              "spark-err",
              `破冰失敗：${(e as Error).message}（Ollama 沒開？或 CORS 沒放行）`,
            ),
          );
        } finally {
          spark.disabled = false;
          spark.textContent = "卡住了？破冰";
          spark.classList.remove("spark-loading");
        }
      });

      // AI 這角度想到的方向（先藏，按「看看我漏了什麼」才揭露）
      const aiBox = el("div", "dv-ai");
      aiBox.hidden = true;
      aiBox.dataset.lens = lens;
      aiBoxes.push(aiBox);

      block.append(ta, spark, sparkOut, aiBox);
      body.append(block);
    }
    updateCount(); // 還原後的初始計數

    section.append(summary, body);
    accordion.append(section);
  }
  box.append(accordion);

  // rail 底部展開把手（點整條 rail 也能展開，由 main 端綁定）
  const railExpand = document.createElement("button");
  railExpand.type = "button";
  railExpand.className = "dv-rail-expand";
  railExpand.textContent = "⮞";
  railExpand.title = "展開側欄";
  rail.append(railExpand);

  // 偵測本地 Ollama；可達才掛 spark-on（CSS 用它 hover 浮現破冰鈕），否則火花入口維持隱藏。
  // 公開站（非 localhost）連不上本機 Ollama 是瀏覽器擋的（mixed content / PNA），非 bug；
  // 此時掛 spark-remote → 顯示說明，告知「火花只在本機開站可用」，避免誤判成壞掉。
  const sparkHint = el("div", "spark-hint", "💡 火花破冰需在本機開站（npm run dev）才啟用");
  box.append(sparkHint);
  detectOllama().then((ok) => {
    if (ok) {
      box.classList.add("spark-on");
    } else if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      box.classList.add("spark-remote");
    }
  });

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
        const ta = accordion.querySelector<HTMLTextAreaElement>(
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

    // 揭露 AI 的角度（先前藏起來）。每個角度框都填同一份方向（accordion 每主題各有一份）
    for (const aiBox of aiBoxes) {
      const lens = aiBox.dataset.lens as LensKey;
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

    // 高亮漏掉的角度（每個主題的同角度區塊）與主題（整個收合區）
    for (const lens of LENS_KEYS) {
      const skipped = report.skippedLenses.includes(lens);
      for (const node of accordion.querySelectorAll(`.dv-lensblock[data-lens="${lens}"]`)) {
        node.classList.toggle("gap-lens", skipped);
      }
    }
    for (const id of conceptIds) {
      const skipped = report.skippedConcepts.includes(id);
      for (const node of accordion.querySelectorAll(`[data-concept="${id}"]`)) {
        node.classList.toggle("gap-concept", skipped);
      }
    }

    // 整欄空的主題＝最大盲點：標頭依序脈動一次，把眼睛帶過去（重新揭露要能重播 → 先清再 reflow）
    for (const sum of accordion.querySelectorAll<HTMLElement>(".dv-summary.gap-pulse")) {
      sum.classList.remove("gap-pulse");
      sum.style.removeProperty("animation-delay");
    }
    void accordion.offsetWidth; // 強制 reflow 讓動畫可重新觸發
    report.skippedConcepts.forEach((id, i) => {
      const sum = accordion.querySelector<HTMLElement>(`.dv-summary[data-concept="${id}"]`);
      if (!sum) return;
      sum.style.animationDelay = `${Math.min(i, 6) * 90}ms`;
      sum.classList.add("gap-pulse");
    });

    // 彙總句（列／欄層級，不逐格洗版）
    result.hidden = false;
    result.replaceChildren();
    result.append(el("h3", "result-title", "你沒想到的角度"));

    // 火花召喚頻率（輔助訊號）：召喚最多的主題 = 你這塊最沒把握
    let topSpark = "";
    let topSparkN = 0;
    for (const [id, n] of sparkCounts) {
      if (n > topSparkN) {
        topSparkN = n;
        topSpark = id;
      }
    }
    if (topSparkN > 0) {
      result.append(
        el(
          "p",
          "result-spark",
          `你在「${conceptLabels.get(topSpark) ?? topSpark}」召喚破冰最多次（${topSparkN} 次）——這塊你可能比較沒把握，值得回頭多想。`,
        ),
      );
    }

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
    let ri = 0; // stagger 序（跨兩段累加，封頂避免拖太長）
    for (const lens of report.skippedLenses) {
      const li = el(
        "li",
        "result-lens",
        `你整輪都沒從「${LENS_META[lens].title}」想過任何主題——AI 在這角度想到了東西（看上方），你沒碰。`,
      );
      li.style.setProperty("--reveal-i", String(Math.min(ri++, 8)));
      ul.append(li);
    }
    for (const id of report.skippedConcepts) {
      const li = el(
        "li",
        "result-concept",
        `「${conceptLabels.get(id) ?? id}」你完全沒多想幾個（四個角度都空）。`,
      );
      li.style.setProperty("--reveal-i", String(Math.min(ri++, 8)));
      ul.append(li);
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

  const readCell = (conceptId: string, lens: LensKey): string =>
    accordion.querySelector<HTMLTextAreaElement>(
      `textarea[data-concept="${conceptId}"][data-lens="${lens}"]`,
    )?.value ?? "";

  // 收割：讀各格 textarea → 帶來源的點子（關係圖「更新」呼叫）
  const harvest = (): ExtraNode[] => {
    const rows: HarvestRow[] = [];
    for (const c of sprint.core_concepts) {
      for (const lens of LENS_KEYS) {
        rows.push({
          conceptId: c.id,
          lens,
          lines: readCell(c.id, lens).split("\n"),
          adopted: sparkAdopted.get(cellKey(c.id, lens)) ?? new Set<string>(),
        });
      }
    }
    return harvestNodes(rows);
  };

  // 快照：目前各格內容 + 採用紀錄（持久化用）。只存非空格，檔案精簡。
  const snapshot = (): DivergeState => {
    const text: Record<string, string> = {};
    const adopted: Record<string, string[]> = {};
    for (const c of sprint.core_concepts) {
      for (const lens of LENS_KEYS) {
        const k = cellKey(c.id, lens);
        const v = readCell(c.id, lens);
        if (v.trim().length > 0) text[k] = v;
        const set = sparkAdopted.get(k);
        if (set && set.size > 0) adopted[k] = [...set];
      }
    }
    return { text, adopted };
  };

  return { el: box, rail, harvest, snapshot };
}
