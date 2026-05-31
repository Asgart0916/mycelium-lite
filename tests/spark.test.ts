import { describe, expect, it } from "vitest";
import { buildSparkPrompt, parseSparkOutput, stripThink } from "../src/spark";

describe("buildSparkPrompt", () => {
  it("帶入主題／角度／引導問", () => {
    const p = buildSparkPrompt("掛號流程", "反過來想", "如果解的是相反的問題呢？", []);
    expect(p).toContain("主題：「掛號流程」");
    expect(p).toContain("角度：反過來想（如果解的是相反的問題呢？）");
    expect(p).toContain("繁體中文與台灣慣用詞彙");
  });

  it("人已寫的點子串進 prompt；空則標（還沒寫）", () => {
    expect(buildSparkPrompt("A", "最快版本", "h", ["先做紙本", "找志工"])).toContain(
      "我目前想到的：先做紙本、找志工",
    );
    expect(buildSparkPrompt("A", "最快版本", "h", [])).toContain("我目前想到的：（還沒寫）");
  });
});

describe("stripThink", () => {
  it("剝掉 <think>…</think> 殘留", () => {
    expect(stripThink("<think>盤算中</think>\n方向：\n- x")).toBe("方向：\n- x");
  });
  it("跨行 think 也剝", () => {
    expect(stripThink("<think>第一行\n第二行</think>實際")).toBe("實際");
  });
  it("沒有 think 標籤就原樣 trim", () => {
    expect(stripThink("  乾淨輸出  ")).toBe("乾淨輸出");
  });
});

describe("parseSparkOutput", () => {
  it("標準格式 → 三方向 + 隨想", () => {
    const raw =
      "方向：\n- 閉眼靠手溫感知血管走向\n- 把候診室變成展覽動線\n- 用點餐機的邏輯叫號\n隨想：\n這是一段聯想短文。";
    const r = parseSparkOutput(raw);
    expect(r.directions).toEqual([
      "閉眼靠手溫感知血管走向",
      "把候診室變成展覽動線",
      "用點餐機的邏輯叫號",
    ]);
    expect(r.musing).toBe("這是一段聯想短文。");
  });

  it("容錯：半形冒號 + 不同 bullet + <think> 污染", () => {
    const raw = "<think>x</think>\n方向:\n* 甲\n• 乙\n隨想:\n短文";
    const r = parseSparkOutput(raw);
    expect(r.directions).toEqual(["甲", "乙"]);
    expect(r.musing).toBe("短文");
  });

  it("缺隨想段也不炸", () => {
    const r = parseSparkOutput("方向：\n- 只有方向");
    expect(r.directions).toEqual(["只有方向"]);
    expect(r.musing).toBe("");
  });

  it("完全不符格式 → 空結果，不丟例外", () => {
    const r = parseSparkOutput("一堆無關文字");
    expect(r.directions).toEqual([]);
    expect(r.musing).toBe("");
  });

  it("多行隨想合併成一段", () => {
    const r = parseSparkOutput("隨想：\n第一句\n第二句");
    expect(r.musing).toBe("第一句 第二句");
  });

  it("過濾複誦的佔位標籤（關鍵詞或切角一）", () => {
    const raw = "方向：\n- 關鍵詞或切角一\n- 真正有畫面的切角\n- ……\n隨想：\n短文";
    const r = parseSparkOutput(raw);
    expect(r.directions).toEqual(["真正有畫面的切角"]);
    expect(r.musing).toBe("短文");
  });

  it("剝掉標籤前綴只留正文（方向一：xxx）", () => {
    const raw = "方向：\n- 方向一：閉眼靠手溫感知血管\n- 切角二、用體溫當訊號\n隨想：x";
    const r = parseSparkOutput(raw);
    expect(r.directions).toEqual(["閉眼靠手溫感知血管", "用體溫當訊號"]);
  });

  it("括號佔位（第一條）與骨架……被濾掉", () => {
    const r = parseSparkOutput("方向：\n- （第一條）\n- 實際內容\n隨想：\n……");
    expect(r.directions).toEqual(["實際內容"]);
    expect(r.musing).toBe("");
  });
});
