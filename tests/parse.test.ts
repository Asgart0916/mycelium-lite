import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalize, parseSprint, robustExtract, validateSprint } from "../src/parse";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(resolve(here, "fixtures", name), "utf-8");

const V2A = fx("v2a-output.json");
const V2B = fx("v2b-output.json");
const INPUT_01 = fx("01-input.txt");
const INPUT_02 = fx("02-input.txt");

// ── robustExtract：4 髒變體都要解析成功（成功標準 ①，比照 spike robust 4/4）──
describe("robustExtract 健壯性", () => {
  const dirty: [string, string][] = [
    ["乾淨", V2A],
    ["```json 包裹", "```json\n" + V2A + "\n```"],
    ["前後贅字", "好的，這是結果：\n" + V2A + "\n希望有幫助！"],
    ["``` 無語言標記", "```\n" + V2A + "\n```"],
  ];
  for (const [name, raw] of dirty) {
    it(`解析髒變體：${name}`, () => {
      const sprint = parseSprint(raw);
      expect(sprint.nodes.length).toBe(41);
    });
  }
});

// ── 兩樣本 schema + 分布（成功標準 ①②③）──────────────────────────────────
describe("v2a 空間氛圍", () => {
  const report = validateSprint(parseSprint(V2A), INPUT_01);

  it("5 概念 / 41 節點 / 無 schema 錯 / 無孤兒", () => {
    expect(report.conceptCount).toBe(5);
    expect(report.nodeCount).toBe(41);
    expect(report.schemaErrors).toHaveLength(0);
    expect(report.orphanConcepts).toHaveLength(0);
  });

  it("概念分布對齊 spike：c1=15(catch-all)、c4=6(薄)", () => {
    const byId = Object.fromEntries(report.distribution.map((d) => [d.id, d.count]));
    expect(byId.c1).toBe(15);
    expect(byId.c4).toBe(6);
    // distribution 依 count 降序，第一個就是 catch-all
    expect(report.distribution[0].id).toBe("c1");
  });

  it("四透鏡 3/2/3/3", () => {
    expect(report.lensCounts).toEqual({ fastest: 3, reverse: 2, crossdomain: 3, upstream: 3 });
  });

  it("source_quote 全可追溯（紅線 #2，成功標準 ④）", () => {
    expect(report.trace?.matched).toBe(report.trace?.total);
    expect(report.trace?.misses).toHaveLength(0);
  });
});

describe("v2b 光線時鐘", () => {
  const report = validateSprint(parseSprint(V2B), INPUT_02);

  it("無 schema 錯 / 無孤兒 / 全可追溯", () => {
    expect(report.schemaErrors).toHaveLength(0);
    expect(report.orphanConcepts).toHaveLength(0);
    expect(report.trace?.matched).toBe(report.trace?.total);
  });
});

// ── 驗證器負向案例：抓得到壞 schema ────────────────────────────────────────
describe("validateSprint 偵錯", () => {
  it("抓孤兒概念", () => {
    const sprint = parseSprint(
      JSON.stringify({
        core_concepts: [
          { id: "c1", label: "用到的" },
          { id: "c2", label: "沒人指向的孤兒" },
        ],
        nodes: [{ id: "n1", idea: "x", source_quote: "x", core_concept_ids: ["c1"] }],
      }),
    );
    const report = validateSprint(sprint);
    expect(report.orphanConcepts).toEqual(["c2"]);
  });

  it("抓指向不存在概念", () => {
    const sprint = parseSprint(
      JSON.stringify({
        core_concepts: [{ id: "c1", label: "x" }],
        nodes: [{ id: "n1", idea: "x", source_quote: "x", core_concept_ids: ["c9"] }],
      }),
    );
    const report = validateSprint(sprint);
    expect(report.schemaErrors.some((e) => e.includes("c9"))).toBe(true);
  });

  it("壞 JSON 拋帶訊息的錯", () => {
    expect(() => parseSprint("這根本不是 json")).toThrow();
  });
});

// ── normalize：全半形/標點差異不影響命中 ──────────────────────────────────
describe("normalize 寬鬆比對", () => {
  it("去標點空白後全半形等價", () => {
    expect(normalize("（測試）, ABC")).toBe(normalize("(測試)ＡＢＣ"));
  });
  it("robustExtract 去前後贅字", () => {
    expect(robustExtract('foo {"a":1} bar')).toBe('{"a":1}');
  });
});
