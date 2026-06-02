// 步2 盲點偵測：人手動逐角度 × 主題自己多想幾個後，找出「整個沒碰到的角度／主題」。
// 卡點 = 維度覆蓋缺口（unknown unknown）：訊號來自「人實際碰了什麼」的差集，
// 不是 AI 輸出、也不是人自陳。對齊 crazy8s 原型「某維度全空 = 最大盲點」。

import { cellKey } from "./model";
import { LENS_KEYS, type LensKey } from "./parse";

// 一格 = 某主題 × 某角度，人手動補的點子（空陣列 = 沒碰這格）
export interface DivergeCell {
  conceptId: string;
  lens: LensKey;
  ideas: string[];
}

export interface CellRef {
  conceptId: string;
  lens: LensKey;
}

export interface GapReport {
  skippedLenses: LensKey[]; // AI 在這角度有東西，但人整輪沒碰任何主題
  skippedConcepts: string[]; // 人完全沒對這主題多想（四個角度都沒碰）
  cellGaps: CellRef[]; // 人空 + 該角度 AI 有東西（彙總到列／欄用，不逐格洗版）
  touchedCells: number;
  totalCells: number;
}

// 偵測差集：以「AI 展開過的角度」為全集，比對人手動覆蓋，回報整列／整欄的缺口。
export function detectGaps(
  conceptIds: string[],
  lensHasAi: Record<LensKey, boolean>,
  cells: DivergeCell[],
): GapReport {
  const filled = new Set<string>();
  const conceptIdSet = new Set(conceptIds);
  for (const c of cells) {
    // 只算仍在範圍內的主題：殘留已刪主題的格不該讓 touchedCells 超過 totalCells
    if (c.ideas.length > 0 && conceptIdSet.has(c.conceptId)) {
      filled.add(cellKey(c.conceptId, c.lens));
    }
  }

  // 整列空：某角度，人在所有主題都沒碰，但 AI 證明過這角度對本題是活的
  const skippedLenses: LensKey[] = [];
  for (const lens of LENS_KEYS) {
    const touched = conceptIds.some((id) => filled.has(cellKey(id, lens)));
    if (!touched && lensHasAi[lens]) {
      skippedLenses.push(lens);
    }
  }

  // 整欄空：某主題，人在四個角度都沒碰
  const skippedConcepts: string[] = [];
  for (const id of conceptIds) {
    const touched = LENS_KEYS.some((lens) => filled.has(cellKey(id, lens)));
    if (!touched) {
      skippedConcepts.push(id);
    }
  }

  // 格層級差集（人空 + 該角度 AI 有），供列／欄彙總，不逐格洗版
  const cellGaps: CellRef[] = [];
  for (const id of conceptIds) {
    for (const lens of LENS_KEYS) {
      if (!filled.has(cellKey(id, lens)) && lensHasAi[lens]) {
        cellGaps.push({ conceptId: id, lens });
      }
    }
  }

  return {
    skippedLenses,
    skippedConcepts,
    cellGaps,
    touchedCells: filled.size,
    totalCells: conceptIds.length * LENS_KEYS.length,
  };
}
