import { describe, expect, it } from "vitest";
import { type DivergeCell, detectGaps } from "../src/diverge";
import { LENS_KEYS, type LensKey } from "../src/parse";

const ALL_AI: Record<LensKey, boolean> = {
  fastest: true,
  reverse: true,
  crossdomain: true,
  upstream: true,
};
const CONCEPTS = ["c1", "c2", "c3"];

// 一格填了 n 個點子
function cell(conceptId: string, lens: LensKey, n = 1): DivergeCell {
  return { conceptId, lens, ideas: Array.from({ length: n }, (_, i) => `idea${i}`) };
}

// 把指定主題集合 × 指定角度集合全部填滿
function fill(conceptIds: string[], lenses: LensKey[]): DivergeCell[] {
  return conceptIds.flatMap((c) => lenses.map((l) => cell(c, l)));
}

describe("detectGaps 維度覆蓋缺口", () => {
  it("全空 grid → 所有 AI 角度與所有主題都算漏掉", () => {
    const r = detectGaps(CONCEPTS, ALL_AI, []);
    expect(r.skippedLenses).toEqual(LENS_KEYS);
    expect(r.skippedConcepts).toEqual(CONCEPTS);
    expect(r.cellGaps).toHaveLength(12);
    expect(r.touchedCells).toBe(0);
    expect(r.totalCells).toBe(12);
  });

  it("全填 → 沒有任何缺口", () => {
    const r = detectGaps(CONCEPTS, ALL_AI, fill(CONCEPTS, LENS_KEYS));
    expect(r.skippedLenses).toEqual([]);
    expect(r.skippedConcepts).toEqual([]);
    expect(r.cellGaps).toEqual([]);
    expect(r.touchedCells).toBe(12);
  });

  it("某角度整列空 → 進 skippedLenses", () => {
    const lenses = LENS_KEYS.filter((l) => l !== "reverse");
    const r = detectGaps(CONCEPTS, ALL_AI, fill(CONCEPTS, lenses));
    expect(r.skippedLenses).toEqual(["reverse"]);
    expect(r.skippedConcepts).toEqual([]);
    expect(r.cellGaps).toHaveLength(3); // reverse × 3 主題
  });

  it("某主題整欄空 → 進 skippedConcepts", () => {
    const r = detectGaps(CONCEPTS, ALL_AI, fill(["c1", "c3"], LENS_KEYS));
    expect(r.skippedConcepts).toEqual(["c2"]);
    expect(r.skippedLenses).toEqual([]); // 每個角度都被 c1／c3 碰過
  });

  it("AI 沒覆蓋的角度不算漏（差集以 AI 為全集）", () => {
    const noReverse = { ...ALL_AI, reverse: false };
    const r = detectGaps(CONCEPTS, noReverse, []);
    expect(r.skippedLenses).toEqual(["fastest", "crossdomain", "upstream"]);
    expect(r.cellGaps).toHaveLength(9); // 排除 reverse → 3 主題 × 3 角度
  });

  it("某角度被一個主題碰到就不算整列空", () => {
    const r = detectGaps(CONCEPTS, ALL_AI, [cell("c1", "reverse")]);
    expect(r.skippedLenses).toEqual(["fastest", "crossdomain", "upstream"]);
    expect(r.skippedConcepts).toEqual(["c2", "c3"]); // c1 碰了 reverse 故非整欄空
  });

  it("空 ideas 陣列不算碰過", () => {
    const r = detectGaps(CONCEPTS, ALL_AI, [{ conceptId: "c1", lens: "fastest", ideas: [] }]);
    expect(r.touchedCells).toBe(0);
    expect(r.skippedLenses).toEqual(LENS_KEYS);
  });
});
