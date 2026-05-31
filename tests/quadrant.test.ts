import { describe, expect, it } from "vitest";
import type { Placement } from "../src/model";
import { placementToXy, reconcile, xyToPlacement } from "../src/quadrant";

describe("xyToPlacement / placementToXy", () => {
  it("左上角 = 高效益低成本", () => {
    const p = xyToPlacement(0, 0, 200, 100);
    expect(p.effort).toBe(0);
    expect(p.impact).toBe(1);
  });

  it("右下角 = 高成本低效益", () => {
    const p = xyToPlacement(200, 100, 200, 100);
    expect(p.effort).toBe(1);
    expect(p.impact).toBe(0);
  });

  it("超出邊界夾到 0..1", () => {
    const p = xyToPlacement(-50, 999, 200, 100);
    expect(p.effort).toBe(0);
    expect(p.impact).toBe(0);
  });

  it("與 placementToXy 互逆", () => {
    const p: Placement = { impact: 0.7, effort: 0.3 };
    const { x, y } = placementToXy(p, 200, 100);
    expect(xyToPlacement(x, y, 200, 100)).toEqual(p);
  });
});

describe("reconcile", () => {
  const state = {
    shortlist: ["a", "b", "c"],
    placements: {
      a: { impact: 0.5, effort: 0.5 },
      b: { impact: 0.2, effort: 0.8 },
      c: { impact: 1, effort: 0 },
    } as Record<string, Placement>,
  };

  it("丟掉已不存在的點子（shortlist + 落點）", () => {
    const r = reconcile(state, ["a", "c"]);
    expect(r.shortlist).toEqual(["a", "c"]);
    expect(Object.keys(r.placements).sort()).toEqual(["a", "c"]);
    expect(r.placements.b).toBeUndefined();
  });

  it("全部還在 → 原樣保留", () => {
    const r = reconcile(state, ["a", "b", "c"]);
    expect(r.shortlist).toEqual(["a", "b", "c"]);
  });

  it("沒有候選 → 清空", () => {
    const r = reconcile(state, []);
    expect(r.shortlist).toEqual([]);
    expect(r.placements).toEqual({});
  });
});
