import { describe, expect, it } from "vitest";
import { buildBackfillPrompt } from "../src/prompt";

describe("buildBackfillPrompt", () => {
  it("嵌入逐字稿並含關鍵指令", () => {
    const p = buildBackfillPrompt("使用者一進門就抱怨等太久");
    expect(p).toContain("「使用者一進門就抱怨等太久」");
    expect(p).toContain("只輸出 JSON");
    expect(p).toContain("原文照抄，不要改寫"); // 紅線 #2
    expect(p).toContain("留空是有意義的盲點訊號"); // E2 機制
  });

  it("含四透鏡與 JSON schema 範例", () => {
    const p = buildBackfillPrompt("x");
    for (const lens of ["fastest", "reverse", "crossdomain", "upstream"]) {
      expect(p).toContain(lens);
    }
    expect(p).toContain('"core_concepts"');
    expect(p).toContain('"source_quote"');
  });

  it("逐字稿空白 → 放佔位，仍可複製後補", () => {
    expect(buildBackfillPrompt("   ")).toContain("（請在這裡貼入逐字稿）");
  });

  it("逐字稿前後空白會 trim", () => {
    expect(buildBackfillPrompt("  哈囉  ")).toContain("「哈囉」");
  });
});
