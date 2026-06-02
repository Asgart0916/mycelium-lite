// 持久化：IndexedDB 單筆自動存（key 固定 = 當前 sprint）+ JSON 匯出入（B1：不鎖雲端、可備份/換機）。
// IndexedDB 存取需瀏覽器環境；toJson/fromJson 為純函式，可單測。

import { SPRINT_SCHEMA, type WorkingSprint } from "./model";

const DB_NAME = "mycelium-lite";
const STORE = "sprint";
const CURRENT_KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 開啟失敗"));
  });
}

// 統一連線生命週期：交易成功或 reject 都在 finally 關閉，避免交易失敗時 IDBDatabase 連線洩漏。
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export async function saveSprint(sprint: WorkingSprint): Promise<void> {
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(sprint, CURRENT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("存檔失敗"));
      }),
  );
}

export async function loadSprint(): Promise<WorkingSprint | null> {
  return withDb(
    (db) =>
      new Promise<WorkingSprint | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(CURRENT_KEY);
        req.onsuccess = () => resolve((req.result as WorkingSprint) ?? null);
        req.onerror = () => reject(req.error ?? new Error("讀檔失敗"));
        // 交易層級中止（配額超出 / 瀏覽器強制 abort）時 req.onerror 不一定觸發，補這道讓 Promise 必 settle
        tx.onerror = () => reject(tx.error ?? new Error("讀檔失敗"));
      }),
  );
}

export async function clearSprint(): Promise<void> {
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(CURRENT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("清除失敗"));
      }),
  );
}

// ── JSON 匯出入（純函式）──────────────────────────────────────────
export function toJson(sprint: WorkingSprint): string {
  return JSON.stringify(sprint, null, 2);
}

// 容錯解析 + 形狀檢查：壞檔丟帶訊息的錯，給 UI 顯示，不靜默吞掉。
export function fromJson(text: string): WorkingSprint {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失敗：${(e as Error).message}`);
  }
  if (typeof data !== "object" || data === null) {
    throw new Error("檔案內容不是 JSON 物件");
  }
  const d = data as Record<string, unknown>;
  const raw = d.raw as Record<string, unknown> | undefined;
  if (!raw || !Array.isArray(raw.core_concepts) || !Array.isArray(raw.nodes)) {
    throw new Error("不是 mycelium-lite sprint 檔（缺 raw.core_concepts / raw.nodes）");
  }
  const lr = (raw.lenses ?? {}) as Record<string, unknown>;
  if (typeof lr !== "object" || lr === null) {
    throw new Error("不是 mycelium-lite sprint 檔（raw.lenses 應是物件或缺失）");
  }
  // 缺 lenses 或某鍵非陣列 → 補空四鍵，避免下游 validateSprint / lensHasAi 讀 .length 時 crash
  raw.lenses = {
    fastest: Array.isArray(lr.fastest) ? lr.fastest : [],
    reverse: Array.isArray(lr.reverse) ? lr.reverse : [],
    crossdomain: Array.isArray(lr.crossdomain) ? lr.crossdomain : [],
    upstream: Array.isArray(lr.upstream) ? lr.upstream : [],
  };
  if (typeof d.schema === "number" && d.schema > SPRINT_SCHEMA) {
    throw new Error(`檔案版本(${d.schema})比目前(${SPRINT_SCHEMA})新，請更新工具`);
  }
  const diverge = (d.diverge ?? {}) as Partial<WorkingSprint["diverge"]>;
  const now = new Date().toISOString();
  return {
    schema: SPRINT_SCHEMA,
    id: typeof d.id === "string" ? d.id : `s_${Date.now()}`,
    created_at: typeof d.created_at === "string" ? d.created_at : now,
    updated_at: now,
    transcript: typeof d.transcript === "string" ? d.transcript : "",
    raw: raw as unknown as WorkingSprint["raw"],
    diverge: { text: diverge.text ?? {}, adopted: diverge.adopted ?? {} },
    shortlist: Array.isArray(d.shortlist)
      ? d.shortlist.filter((x): x is string => typeof x === "string")
      : [],
    placements: (d.placements ?? {}) as WorkingSprint["placements"],
  };
}
