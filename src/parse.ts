// 步0 回填解析：把 ChatGPT Plus 一次往返的原始輸出 → 結構化 sprint + 驗證。
// 邏輯移植自 spike `parse_spike.py`（robust_extract / normalize / 可追溯），行為對齊。
// 紅線 #2：source_quote 照抄逐字稿，靠可追溯驗證守住「沒被改寫」。

// ── 型別（對齊 Design.md §5，N0 只處理 ChatGPT 回填的原始三段，Sprint 容器留 N4）──
export interface CoreConcept {
  id: string;
  label: string;
}

export interface RawNode {
  id: string;
  idea: string;
  source_quote: string;
  core_concept_ids: string[];
}

export interface Lens {
  id: string;
  direction: string;
}

export type LensKey = "fastest" | "reverse" | "crossdomain" | "upstream";

export interface Lenses {
  fastest: Lens[];
  reverse: Lens[];
  crossdomain: Lens[];
  upstream: Lens[];
}

export interface RawSprint {
  core_concepts: CoreConcept[];
  nodes: RawNode[];
  lenses: Lenses;
}

export interface ConceptCount {
  id: string;
  label: string;
  count: number;
}

export interface TraceReport {
  matched: number;
  total: number;
  misses: string[]; // 無法在逐字稿命中的 node id（疑改寫）
}

export interface ValidationReport {
  conceptCount: number;
  nodeCount: number;
  orphanConcepts: string[];
  schemaErrors: string[];
  distribution: ConceptCount[]; // 依 count 降序
  lensCounts: Record<LensKey, number>;
  trace?: TraceReport; // 有提供逐字稿才算
}

const LENS_KEYS: LensKey[] = ["fastest", "reverse", "crossdomain", "upstream"];

// ── 容錯前處理：剝 markdown code fence、抓第一個 { 到最後一個 } ──────────────
export function robustExtract(s: string): string {
  let out = s.trim();
  const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    out = fence[1];
  }
  const i = out.indexOf("{");
  const j = out.lastIndexOf("}");
  if (i !== -1 && j !== -1) {
    out = out.slice(i, j + 1);
  }
  return out.trim();
}

// ── 寬鬆比對：NFKC + 去標點空白，避免全半形/標點差異誤判成改寫 ──────────────
export function normalize(t: string): string {
  return t.normalize("NFKC").replace(/[\s，。、？！「」『』（）()…·,.\-:：]/g, "");
}

// ── 解析：容錯抽取 + JSON.parse + 形狀檢查（拋帶訊息的錯，給 UI 顯示）────────
export function parseSprint(raw: string): RawSprint {
  const extracted = robustExtract(raw);
  let data: unknown;
  try {
    data = JSON.parse(extracted);
  } catch (e) {
    throw new Error(`JSON 解析失敗：${(e as Error).message}`);
  }
  if (typeof data !== "object" || data === null) {
    throw new Error("回填內容不是 JSON 物件");
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.core_concepts) || !Array.isArray(d.nodes)) {
    throw new Error("缺 core_concepts 或 nodes 陣列");
  }
  // lenses 容缺：補空四透鏡（v1 格式無 lenses 也能渲染積木與分布）
  const lenses = (d.lenses ?? {}) as Partial<Lenses>;
  return {
    core_concepts: d.core_concepts as CoreConcept[],
    nodes: d.nodes as RawNode[],
    lenses: {
      fastest: lenses.fastest ?? [],
      reverse: lenses.reverse ?? [],
      crossdomain: lenses.crossdomain ?? [],
      upstream: lenses.upstream ?? [],
    },
  };
}

// ── 驗證：schema 完整性 + 孤兒概念 + 概念分布 + （可選）source_quote 可追溯 ──
export function validateSprint(sprint: RawSprint, transcript?: string): ValidationReport {
  const conceptIds = new Set(sprint.core_concepts.map((c) => c.id));
  const schemaErrors: string[] = [];
  const used = new Set<string>();
  const counts = new Map<string, number>();

  const normInput = transcript ? normalize(transcript) : null;
  let traceMatched = 0;
  const traceMisses: string[] = [];

  for (const n of sprint.nodes) {
    for (const k of ["id", "idea", "source_quote", "core_concept_ids"] as const) {
      if (!(k in n) || n[k] === undefined) {
        schemaErrors.push(`node ${n.id ?? "?"} 缺欄位 ${k}`);
      }
    }
    for (const cid of n.core_concept_ids ?? []) {
      used.add(cid);
      counts.set(cid, (counts.get(cid) ?? 0) + 1);
      if (!conceptIds.has(cid)) {
        schemaErrors.push(`node ${n.id} 指向不存在概念 ${cid}`);
      }
    }
    if (normInput !== null) {
      const sq = normalize(n.source_quote ?? "");
      if (sq && normInput.includes(sq)) {
        traceMatched++;
      } else {
        traceMisses.push(n.id);
      }
    }
  }

  const distribution: ConceptCount[] = sprint.core_concepts
    .map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id) ?? 0 }))
    .sort((a, b) => b.count - a.count);

  const orphanConcepts = [...conceptIds].filter((id) => !used.has(id));

  const lensCounts = {
    fastest: sprint.lenses.fastest.length,
    reverse: sprint.lenses.reverse.length,
    crossdomain: sprint.lenses.crossdomain.length,
    upstream: sprint.lenses.upstream.length,
  } as Record<LensKey, number>;

  const report: ValidationReport = {
    conceptCount: conceptIds.size,
    nodeCount: sprint.nodes.length,
    orphanConcepts,
    schemaErrors,
    distribution,
    lensCounts,
  };
  if (normInput !== null) {
    report.trace = { matched: traceMatched, total: sprint.nodes.length, misses: traceMisses };
  }
  return report;
}

export { LENS_KEYS };
