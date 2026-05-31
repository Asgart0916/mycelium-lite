import { describe, expect, it } from "vitest";
import { SPRINT_SCHEMA, type WorkingSprint, harvestFromState, newSprint } from "../src/model";
import { fromJson, toJson } from "../src/persist";

const RAW = {
  core_concepts: [{ id: "c1", label: "主題一" }],
  nodes: [{ id: "n1", idea: "點子", source_quote: "原文", core_concept_ids: ["c1"] }],
  lenses: { fastest: [], reverse: [], crossdomain: [], upstream: [] },
};

function makeSprint(): WorkingSprint {
  const s = newSprint(RAW, "逐字稿原文");
  s.diverge.text.c1__fastest = "手寫想法";
  s.shortlist = ["n1"];
  s.placements = { n1: { impact: 0.8, effort: 0.2 } };
  return s;
}

describe("newSprint", () => {
  it("帶 schema 版本與時間戳", () => {
    const s = newSprint(RAW, "t");
    expect(s.schema).toBe(SPRINT_SCHEMA);
    expect(s.transcript).toBe("t");
    expect(s.created_at).toBeTruthy();
    expect(s.shortlist).toEqual([]);
  });
});

describe("harvestFromState", () => {
  it("由 diverge 衍生步2 點子，帶來源", () => {
    const s = newSprint(RAW, "");
    s.diverge.text.c1__fastest = "火花的\n我寫的";
    s.diverge.adopted.c1__fastest = ["火花的"];
    const out = harvestFromState(RAW, s.diverge);
    const byIdea = new Map(out.map((n) => [n.idea, n.origin]));
    expect(byIdea.get("火花的")).toBe("spark");
    expect(byIdea.get("我寫的")).toBe("human");
  });
});

describe("toJson / fromJson", () => {
  it("round-trip 還原核心欄位", () => {
    const s = makeSprint();
    const back = fromJson(toJson(s));
    expect(back.transcript).toBe("逐字稿原文");
    expect(back.raw.core_concepts).toEqual(RAW.core_concepts);
    expect(back.diverge.text.c1__fastest).toBe("手寫想法");
    expect(back.shortlist).toEqual(["n1"]);
    expect(back.placements.n1).toEqual({ impact: 0.8, effort: 0.2 });
  });

  it("匯入時更新 updated_at（但保留 created_at/id）", () => {
    const s = makeSprint();
    const back = fromJson(toJson(s));
    expect(back.id).toBe(s.id);
    expect(back.created_at).toBe(s.created_at);
  });

  it("壞 JSON → 丟帶訊息的錯", () => {
    expect(() => fromJson("不是 json")).toThrow(/JSON 解析失敗/);
  });

  it("缺 raw.core_concepts → 拒絕", () => {
    expect(() => fromJson(JSON.stringify({ raw: { nodes: [] } }))).toThrow(/mycelium-lite sprint/);
  });

  it("非物件 → 拒絕", () => {
    expect(() => fromJson("42")).toThrow(/不是 JSON 物件/);
  });

  it("schema 比目前新 → 拒絕", () => {
    const future = JSON.stringify({ schema: SPRINT_SCHEMA + 1, raw: RAW });
    expect(() => fromJson(future)).toThrow(/版本/);
  });

  it("缺 diverge → 補空，不炸", () => {
    const back = fromJson(JSON.stringify({ raw: RAW }));
    expect(back.diverge).toEqual({ text: {}, adopted: {} });
    expect(back.shortlist).toEqual([]);
  });
});
