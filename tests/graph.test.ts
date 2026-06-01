import { describe, expect, it } from "vitest";
import {
  CONCEPT_PALETTE,
  type ExtraNode,
  type HarvestRow,
  assignConceptColors,
  buildGraphData,
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

describe("assignConceptColors", () => {
  it("依序配色，超過色盤長度則循環", () => {
    const ids = Array.from({ length: CONCEPT_PALETTE.length + 2 }, (_, i) => `c${i}`);
    const m = assignConceptColors(ids);
    expect(m.get("c0")).toBe(CONCEPT_PALETTE[0]);
    expect(m.get(`c${CONCEPT_PALETTE.length}`)).toBe(CONCEPT_PALETTE[0]); // 繞回
  });
});

describe("buildGraphData", () => {
  it("節點 = 主題中心 + 點子；泡泡 = 主題數；邊 = 歸屬連線總數", () => {
    const { nodes, edges, combos } = buildGraphData(
      sprint(
        ["c1", "c2"],
        [
          { id: "n1", concepts: ["c1"] },
          { id: "n2", concepts: ["c1", "c2"] },
        ],
      ),
    );
    expect(nodes).toHaveLength(4); // 2 主題中心 + 2 點子
    expect(combos).toHaveLength(2); // 每主題一泡泡
    expect(edges).toHaveLength(3); // n1→c1, n2→c1, n2→c2
  });

  it("點子歸到主歸屬主題的泡泡；跨主題標 cross、次要邊 cross", () => {
    const { nodes, edges } = buildGraphData(
      sprint(
        ["c1", "c2"],
        [
          { id: "n1", concepts: ["c1"] },
          { id: "n2", concepts: ["c1", "c2"] },
        ],
      ),
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("n2")?.data.cross).toBe(true);
    expect(byId.get("n1")?.data.cross).toBe(false);
    expect(byId.get("n2")?.combo).toBe("combo_c1"); // 主歸屬泡泡
    const edgeById = new Map(edges.map((e) => [e.id, e]));
    expect(edgeById.get("e_n2_c1")?.data.cross).toBe(false); // 主邊
    expect(edgeById.get("e_n2_c2")?.data.cross).toBe(true); // 跨主題橋
  });

  it("點子繼承主歸屬主題色", () => {
    const { nodes } = buildGraphData(sprint(["c1", "c2"], [{ id: "n1", concepts: ["c2"] }]));
    const colors = assignConceptColors(["c1", "c2"]);
    expect(nodes.find((n) => n.id === "n1")?.data.color).toBe(colors.get("c2"));
  });

  it("指向不存在主題的歸屬被濾掉（不建邊、不算 cross）", () => {
    const { nodes, edges } = buildGraphData(
      sprint(["c1"], [{ id: "n1", concepts: ["c1", "ghost"] }]),
    );
    expect(edges).toHaveLength(1);
    expect(nodes.find((n) => n.id === "n1")?.data.cross).toBe(false);
  });

  it("全部歸屬都無效的 AI 點子 → 不入圖", () => {
    const { nodes } = buildGraphData(sprint(["c1"], [{ id: "n1", concepts: ["ghost"] }]));
    expect(nodes.find((n) => n.id === "n1")).toBeUndefined();
  });

  it("extra 點子帶來源、泡泡歸屬與連線", () => {
    const extra: ExtraNode[] = [
      { id: "x1", idea: "手寫的", source_quote: "", conceptId: "c1", origin: "human" },
      { id: "x2", idea: "火花的", source_quote: "", conceptId: "c1", origin: "spark" },
    ];
    const { nodes, edges } = buildGraphData(sprint(["c1"], []), extra);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("x1")?.data.origin).toBe("human");
    expect(byId.get("x2")?.data.origin).toBe("spark");
    expect(byId.get("x1")?.combo).toBe("combo_c1");
    expect(edges).toHaveLength(2); // x1→c1, x2→c1
  });

  it("extra 指向不存在主題 → 略過", () => {
    const extra: ExtraNode[] = [
      { id: "x1", idea: "孤兒", source_quote: "", conceptId: "ghost", origin: "human" },
    ];
    const { nodes } = buildGraphData(sprint(["c1"], []), extra);
    expect(nodes.find((n) => n.id === "x1")).toBeUndefined();
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
