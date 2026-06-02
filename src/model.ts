// N4 工作中 sprint：單一真相源。AI 回填(raw) + 步2 狀態(diverge) + 收斂候選(shortlist/placements)。
// 持久化(IndexedDB)與匯出入都序列化這個物件；步2 收割的點子由 diverge 衍生（不另存，避免雙真相）。

import type { ExtraNode } from "./graph-model";
import { type HarvestRow, harvestNodes } from "./graph-model";
import { LENS_KEYS, type LensKey, type RawSprint } from "./parse";

export const SPRINT_SCHEMA = 1;

// 步2 各格狀態：text = textarea 原文（一行一點子）；adopted = 被火花「採用」過的行（標來源用）。
export interface DivergeState {
  text: Record<string, string>;
  adopted: Record<string, string[]>;
}

// Impact/Effort 2×2 落點，各 0..1（左下=低，右上=高）。
export interface Placement {
  impact: number;
  effort: number;
}

export interface WorkingSprint {
  schema: number;
  id: string;
  created_at: string;
  updated_at: string;
  transcript: string;
  raw: RawSprint;
  diverge: DivergeState;
  shortlist: string[]; // 勾為候選的點子 id
  placements: Record<string, Placement>; // 點子 id -> 2×2 落點
}

export function cellKey(conceptId: string, lens: LensKey): string {
  return `${conceptId}__${lens}`;
}

export function newSprint(raw: RawSprint, transcript: string): WorkingSprint {
  const now = new Date().toISOString();
  return {
    schema: SPRINT_SCHEMA,
    id: `s_${Date.now()}`,
    created_at: now,
    updated_at: now,
    transcript,
    raw,
    diverge: { text: {}, adopted: {} },
    shortlist: [],
    placements: {},
  };
}

// 由 diverge 狀態衍生步2 收割的點子（給關係圖與 2×2 候選用）。
export function harvestFromState(raw: RawSprint, diverge: DivergeState): ExtraNode[] {
  const rows: HarvestRow[] = [];
  for (const c of raw.core_concepts) {
    for (const lens of LENS_KEYS) {
      const k = cellKey(c.id, lens);
      rows.push({
        conceptId: c.id,
        lens,
        lines: (diverge.text[k] ?? "").split("\n"),
        adopted: new Set(diverge.adopted[k] ?? []),
      });
    }
  }
  return harvestNodes(rows);
}
