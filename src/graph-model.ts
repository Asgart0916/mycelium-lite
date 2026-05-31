// 關係圖的純資料建模（無 cytoscape runtime 依賴，僅 import type）。
// 抽出來讓 buildElements / harvestNodes / assignConceptColors 能在 node 測試環境單測。

import type cytoscape from "cytoscape";
import type { RawSprint } from "./parse";

// 分類色盤：低彩度大地色，貼合 app 的 slate + teal(accent) + amber 調性，避開霓虹藍紫。
// 避開純橘(#ef9f27)以免和「跨主題環」搶眼。主題數超過長度時循環取色。
export const CONCEPT_PALETTE = [
  "#5dcaa5", // teal（app accent）
  "#e0a35e", // amber
  "#6f9fc8", // dusty blue
  "#c78fa3", // dusty rose
  "#9bbf72", // sage
  "#b29bcf", // muted lavender
  "#d2906b", // terracotta
  "#5fbcc4", // muted cyan
  "#d4b483", // sand
  "#8fb6a4", // seafoam
];
export const ORPHAN_COLOR = "#6b7785";

export type IdeaOrigin = "ai" | "human" | "spark";

// 步2 收割出來的新點子（人手寫 / 火花採用），單一主題歸屬。
export interface ExtraNode {
  id: string;
  idea: string;
  source_quote: string;
  conceptId: string;
  origin: "human" | "spark";
}

// 步2 收割：一格的人填內容（已被火花採用過的文字在 adopted 集合內 → 標來源=spark）。
export interface HarvestRow {
  conceptId: string;
  lens: string;
  lines: string[];
  adopted: Set<string>;
}

// djb2 小雜湊：把內容轉成穩定短碼，讓 id 不隨「在別格加行」位移（2×2 shortlist/落點要穩定參照）。
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// 把各格人填的行轉成帶來源的點子。純函式：DOM 讀取留在呼叫端，這裡只做轉換 → 可單測。
// id = 內容雜湊（同格同文字恆等），故同格重複行會去重、跨格相同文字各自獨立。
export function harvestNodes(rows: HarvestRow[]): ExtraNode[] {
  const out: ExtraNode[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const line of r.lines) {
      const text = line.trim();
      if (text.length === 0) continue;
      const id = `x_${r.conceptId}_${r.lens}_${hashStr(text)}`;
      if (seen.has(id)) continue; // 同格同文字去重
      seen.add(id);
      out.push({
        id,
        idea: text,
        source_quote: "",
        conceptId: r.conceptId,
        origin: r.adopted.has(text) ? "spark" : "human",
      });
    }
  }
  return out;
}

// 每個主題配一個固定色（依出現序，超過色盤長度循環）。
export function assignConceptColors(conceptIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  conceptIds.forEach((id, i) => {
    map.set(id, CONCEPT_PALETTE[i % CONCEPT_PALETTE.length]);
  });
  return map;
}

// 由 sprint（AI 回填）+ extra（步2 收割）建 cytoscape elements。純函式：同輸入同輸出，可測。
export function buildElements(
  sprint: RawSprint,
  extra: ExtraNode[] = [],
): cytoscape.ElementDefinition[] {
  const conceptIds = sprint.core_concepts.map((c) => c.id);
  const colors = assignConceptColors(conceptIds);
  const conceptSet = new Set(conceptIds);
  const labels = new Map(sprint.core_concepts.map((c) => [c.id, c.label]));
  const els: cytoscape.ElementDefinition[] = [];

  // 主題 hub
  for (const c of sprint.core_concepts) {
    els.push({
      data: { id: c.id, label: c.label, kind: "concept", color: colors.get(c.id) ?? ORPHAN_COLOR },
      classes: "concept",
    });
  }

  // AI 回填點子
  for (const n of sprint.nodes) {
    const cids = (n.core_concept_ids ?? []).filter((id) => conceptSet.has(id));
    const primary = cids[0];
    const cross = cids.length > 1;
    const color = primary ? (colors.get(primary) ?? ORPHAN_COLOR) : ORPHAN_COLOR;
    const members = cids.map((id) => labels.get(id) ?? id).join("、");
    els.push({
      data: {
        id: n.id,
        label: n.idea,
        kind: "idea",
        origin: "ai",
        color,
        quote: n.source_quote ?? "",
        members,
      },
      classes: cross ? "idea ai cross" : "idea ai",
    });
    for (const cid of cids) {
      els.push({ data: { id: `e_${n.id}_${cid}`, source: n.id, target: cid, color } });
    }
  }

  // 步2 收割的新點子（單一主題）
  for (const x of extra) {
    if (!conceptSet.has(x.conceptId)) continue;
    const color = colors.get(x.conceptId) ?? ORPHAN_COLOR;
    els.push({
      data: {
        id: x.id,
        label: x.idea,
        kind: "idea",
        origin: x.origin,
        color,
        quote: x.source_quote ?? "",
        members: labels.get(x.conceptId) ?? x.conceptId,
      },
      classes: `idea ${x.origin}`,
    });
    els.push({
      data: { id: `e_${x.id}_${x.conceptId}`, source: x.id, target: x.conceptId, color },
    });
  }

  return els;
}
