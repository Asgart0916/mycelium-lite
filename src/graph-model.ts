// 關係圖的純資料建模（無圖引擎 runtime 依賴）。
// 抽出來讓 buildGraphData / harvestNodes / assignConceptColors 能在 node 測試環境單測。

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
  // 去重防禦：重複 id 會占兩個色盤格並位移後續配色（常態無重複，不影響正常行為）
  [...new Set(conceptIds)].forEach((id, i) => {
    map.set(id, CONCEPT_PALETTE[i % CONCEPT_PALETTE.length]);
  });
  return map;
}

// ── G6 圖資料：主題=combo（泡泡容器）、主題中心=concept 節點、點子=idea 節點 ──────────
// 點子歸到「主歸屬主題」的 combo（泡泡內），跨主題點子另對其他主題的中心拉一條 cross 邊（橋接）。
// combo-combined 佈局保證泡泡互不重疊 → 結構天生乾淨，不靠力導向碰運氣。
export type GraphKind = "concept" | "idea";

export interface GNodeData {
  kind: GraphKind;
  label: string;
  color: string;
  origin?: IdeaOrigin; // 點子來源（形狀用）
  quote?: string; // 原文（tooltip 用，紅線 #2 照抄）
  members?: string; // 跨哪些主題（tooltip 用）
  cross?: boolean; // 跨主題點子 → 橘環
}
export interface GNode {
  id: string;
  combo: string;
  data: GNodeData;
}
export interface GEdgeData {
  color: string;
  cross: boolean; // 非主歸屬連線 → 淡虛弧
}
export interface GEdge {
  id: string;
  source: string;
  target: string;
  data: GEdgeData;
}
export interface GCombo {
  id: string;
  data: { label: string; color: string };
}
export interface GraphData {
  nodes: GNode[];
  edges: GEdge[];
  combos: GCombo[];
}

const comboIdOf = (conceptId: string): string => `combo_${conceptId}`;

export function buildGraphData(sprint: RawSprint, extra: ExtraNode[] = []): GraphData {
  const conceptIds = sprint.core_concepts.map((c) => c.id);
  const colors = assignConceptColors(conceptIds);
  const conceptSet = new Set(conceptIds);
  const labels = new Map(sprint.core_concepts.map((c) => [c.id, c.label]));

  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const combos: GCombo[] = [];

  // 每主題：一個泡泡 + 一個置中的主題節點
  for (const c of sprint.core_concepts) {
    const color = colors.get(c.id) ?? ORPHAN_COLOR;
    combos.push({ id: comboIdOf(c.id), data: { label: c.label, color } });
    nodes.push({
      id: c.id,
      combo: comboIdOf(c.id),
      data: { kind: "concept", label: c.label, color },
    });
  }

  // AI 回填點子：放進主歸屬主題的泡泡；每個歸屬拉一條邊（第一個=主邊，其餘=跨主題橋）
  for (const n of sprint.nodes) {
    // 去重：core_concept_ids 含重複值會生出兩條同 id 邊（e_n_c1），G6 對重複 edge id 行為未定義
    const cids = [...new Set((n.core_concept_ids ?? []).filter((id) => conceptSet.has(id)))];
    const primary = cids[0];
    if (!primary) continue; // 無有效歸屬 → 不入圖
    const cross = cids.length > 1;
    const color = colors.get(primary) ?? ORPHAN_COLOR;
    const members = cids.map((id) => labels.get(id) ?? id).join("、");
    nodes.push({
      id: n.id,
      combo: comboIdOf(primary),
      data: {
        kind: "idea",
        label: n.idea,
        color,
        origin: "ai",
        quote: n.source_quote ?? "",
        members,
        cross,
      },
    });
    cids.forEach((cid, idx) => {
      edges.push({
        id: `e_${n.id}_${cid}`,
        source: n.id,
        target: cid,
        data: { color, cross: idx > 0 },
      });
    });
  }

  // 步2 收割的新點子（單一主題）
  for (const x of extra) {
    if (!conceptSet.has(x.conceptId)) continue;
    const color = colors.get(x.conceptId) ?? ORPHAN_COLOR;
    nodes.push({
      id: x.id,
      combo: comboIdOf(x.conceptId),
      data: {
        kind: "idea",
        label: x.idea,
        color,
        origin: x.origin,
        quote: x.source_quote ?? "",
        members: labels.get(x.conceptId) ?? x.conceptId,
        cross: false,
      },
    });
    edges.push({
      id: `e_${x.id}_${x.conceptId}`,
      source: x.id,
      target: x.conceptId,
      data: { color, cross: false },
    });
  }

  return { nodes, edges, combos };
}
