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

export async function saveSprint(sprint: WorkingSprint): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(sprint, CURRENT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("存檔失敗"));
  });
  db.close();
}

export async function loadSprint(): Promise<WorkingSprint | null> {
  const db = await openDb();
  const result = await new Promise<WorkingSprint | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(CURRENT_KEY);
    req.onsuccess = () => resolve((req.result as WorkingSprint) ?? null);
    req.onerror = () => reject(req.error ?? new Error("讀檔失敗"));
  });
  db.close();
  return result;
}

export async function clearSprint(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(CURRENT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("清除失敗"));
  });
  db.close();
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
    raw: d.raw as WorkingSprint["raw"],
    diverge: { text: diverge.text ?? {}, adopted: diverge.adopted ?? {} },
    shortlist: Array.isArray(d.shortlist) ? (d.shortlist as string[]) : [],
    placements: (d.placements ?? {}) as WorkingSprint["placements"],
  };
}
