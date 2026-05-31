import { describe, expect, it } from "vitest";
import {
  CONCEPT_PALETTE,
  type ExtraNode,
  type HarvestRow,
  assignConceptColors,
  buildElements,
  harvestNodes,
} from "../src/graph-model";
import type { RawSprint } from "../src/parse";

const EMPTY_LENSES = { fastest: [], reverse: [], crossdomain: [], upstream: [] };

function sprint(concepts: string[], nodes: { id: string; concepts: string[] }[]): RawSprint {
  return {
    core_concepts: concepts.map((id) => ({ id, label: `主題-${id}` })),
    nodes: nodes.map((n) => ({
      id: n.id,
      idea: `點子-${n.id}`,
      source_quote: "q",
      core_concept_ids: n.concepts,
    })),
    lenses: EMPTY_LENSES,
  };
}

// data().id 取用：elements 沒有 source 的是節點，有 source 的是邊
function nodeData(els: ReturnType<typeof buildElements>) {
  return els.filter((e) => !e.data.source);
}
function edgeData(els: ReturnType<typeof buildElements>) {
  return els.filter((e) => e.data.source);
}

describe("assignConceptColors", () => {
  it("依序配色，超過色盤長度則循環", () => {
    const ids = Array.from({ length: CONCEPT_PALETTE.length + 2 }, (_, i) => `c${i}`);
    const m = assignConceptColors(ids);
    expect(m.get("c0")).toBe(CONCEPT_PALETTE[0]);
    expect(m.get(`c${CONCEPT_PALETTE.length}`)).toBe(CONCEPT_PALETTE[0]); // 繞回
  });
});

describe("buildElements", () => {
  it("節點 = 主題 + 點子；邊 = 歸屬連線總數", () => {
    const els = buildElements(
      sprint(
        ["c1", "c2"],
        [
          { id: "n1", concepts: ["c1"] },
          { id: "n2", concepts: ["c1", "c2"] },
        ],
      ),
    );
    expect(nodeData(els)).toHaveLength(4); // 2 主題 + 2 點子
    expect(edgeData(els)).toHaveLength(3); // n1→c1, n2→c1, n2→c2
  });

  it("跨主題 AI 點子標 cross class，單主題不標", () => {
    const els = buildElements(
      sprint(
        ["c1", "c2"],
        [
          { id: "n1", concepts: ["c1"] },
          { id: "n2", concepts: ["c1", "c2"] },
        ],
      ),
    );
    const byId = new Map(els.map((e) => [e.data.id, e]));
    expect(byId.get("n2")?.classes).toContain("cross");
    expect(byId.get("n1")?.classes).not.toContain("cross");
  });

  it("點子繼承主歸屬主題色", () => {
    const els = buildElements(sprint(["c1", "c2"], [{ id: "n1", concepts: ["c2"] }]));
    const colors = assignConceptColors(["c1", "c2"]);
    const n1 = els.find((e) => e.data.id === "n1");
    expect(n1?.data.color).toBe(colors.get("c2"));
  });

  it("指向不存在主題的歸屬被濾掉（不建邊）", () => {
    const els = buildElements(sprint(["c1"], [{ id: "n1", concepts: ["c1", "ghost"] }]));
    expect(edgeData(els)).toHaveLength(1);
    expect(els.find((e) => e.data.id === "n1")?.classes).not.toContain("cross");
  });

  it("extra 點子帶來源 class 與連線", () => {
    const extra: ExtraNode[] = [
      { id: "x1", idea: "手寫的", source_quote: "", conceptId: "c1", origin: "human" },
      { id: "x2", idea: "火花的", source_quote: "", conceptId: "c1", origin: "spark" },
    ];
    const els = buildElements(sprint(["c1"], []), extra);
    const byId = new Map(els.map((e) => [e.data.id, e]));
    expect(byId.get("x1")?.classes).toBe("idea human");
    expect(byId.get("x2")?.classes).toBe("idea spark");
    expect(edgeData(els)).toHaveLength(2); // x1→c1, x2→c1
  });

  it("extra 指向不存在主題 → 略過", () => {
    const extra: ExtraNode[] = [
      { id: "x1", idea: "孤兒", source_quote: "", conceptId: "ghost", origin: "human" },
    ];
    const els = buildElements(sprint(["c1"], []), extra);
    expect(els.find((e) => e.data.id === "x1")).toBeUndefined();
  });
});

describe("harvestNodes", () => {
  function row(
    conceptId: string,
    lens: string,
    lines: string[],
    adopted: string[] = [],
  ): HarvestRow {
    return { conceptId, lens, lines, adopted: new Set(adopted) };
  }

  it("空行濾掉、trim", () => {
    const out = harvestNodes([row("c1", "fastest", ["  想法A  ", "", "  "])]);
    expect(out).toHaveLength(1);
    expect(out[0].idea).toBe("想法A");
    expect(out[0].conceptId).toBe("c1");
  });

  it("被採用過的文字標來源=spark，其餘=human", () => {
    const out = harvestNodes([row("c1", "fastest", ["火花來的", "我自己想的"], ["火花來的"])]);
    const byIdea = new Map(out.map((n) => [n.idea, n.origin]));
    expect(byIdea.get("火花來的")).toBe("spark");
    expect(byIdea.get("我自己想的")).toBe("human");
  });

  it("id 不重複（跨格累加索引）", () => {
    const out = harvestNodes([row("c1", "fastest", ["a", "b"]), row("c2", "reverse", ["c"])]);
    expect(new Set(out.map((n) => n.id)).size).toBe(3);
  });
});
