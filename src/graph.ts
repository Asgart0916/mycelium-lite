// 想法關係圖（AntV G6 v5）：主題=泡泡(combo)，主題中心節點 + 點子節點放泡泡內。
// 顏色分主題；形狀分來源（圓=AI、圓角方=你手寫、菱形=火花）；跨主題點子加橘環＝盲點訊號，
// 並用淡虛弧橋接到別的泡泡。combo-combined 佈局保證泡泡互不重疊 → 結構天生乾淨。
// 互動：hover 高亮鄰域 + 漂浮卡看全文、可拖曳、雙擊泡泡收合、工具列縮放/全景、更新收割步2新點子。
// 純資料建模在 graph-model.ts（可單測）；本檔只管 G6 runtime 與互動。

import type {
  ComboData,
  EdgeData,
  GraphData as G6GraphData,
  Graph,
  GraphOptions,
  NodeData,
} from "@antv/g6";
import {
  type ExtraNode,
  type GEdgeData,
  type GNodeData,
  type IdeaOrigin,
  buildGraphData,
} from "./graph-model";
import type { RawSprint } from "./parse";

export type { ExtraNode, HarvestRow } from "./graph-model";
export { harvestNodes, buildGraphData, assignConceptColors } from "./graph-model";

// G6 v5（~含 @antv/g、layout，重量級）動態載入：首屏不背，進步2 建圖時才抓。
type GraphCtor = new (options: GraphOptions) => Graph;
let G6Graph: GraphCtor | null = null;
async function loadG6(): Promise<GraphCtor> {
  if (G6Graph) return G6Graph;
  const m = await import("@antv/g6");
  G6Graph = m.Graph as unknown as GraphCtor;
  return G6Graph;
}

const ORIGIN_LABEL: Record<IdeaOrigin, string> = {
  ai: "AI 回填",
  human: "你手寫",
  spark: "火花採用",
};

const CROSS_RING = "#ef9f27"; // 跨主題橘環
const HUB_RING = "#14171a";

const nd = (d: NodeData): GNodeData => d.data as unknown as GNodeData;
const ed = (d: EdgeData): GEdgeData => d.data as unknown as GEdgeData;
const cd = (d: ComboData): { label: string; color: string } =>
  d.data as unknown as { label: string; color: string };

// G6 設定：節點形狀/大小/環依 data，邊依 cross 弱化，combo 是淡染泡泡，佈局用 combo-combined。
function graphOptions(container: HTMLElement, data: G6GraphData): GraphOptions {
  return {
    container,
    data,
    autoResize: false, // 由 onShow 控制（面板隱藏時容器 0 尺寸）
    padding: 24,
    node: {
      type: (d: NodeData) => {
        const data = nd(d);
        if (data.kind === "concept") return "circle";
        return data.origin === "human" ? "rect" : data.origin === "spark" ? "diamond" : "circle";
      },
      style: {
        fill: (d: NodeData) => nd(d).color,
        size: (d: NodeData) => (nd(d).kind === "concept" ? 26 : nd(d).cross ? 16 : 12),
        radius: (d: NodeData) => (nd(d).origin === "human" ? 3 : 0), // 手寫＝圓角方
        stroke: (d: NodeData) =>
          nd(d).cross ? CROSS_RING : nd(d).kind === "concept" ? HUB_RING : "transparent",
        lineWidth: (d: NodeData) => (nd(d).cross ? 3 : nd(d).kind === "concept" ? 2 : 0),
      },
      state: {
        active: { lineWidth: 3, stroke: "#e6edf3" }, // hover：只亮起鄰域，不壓暗其他
      },
    },
    edge: {
      style: {
        stroke: (d: EdgeData) => ed(d).color,
        lineWidth: (d: EdgeData) => (ed(d).cross ? 1 : 1.5),
        strokeOpacity: (d: EdgeData) => (ed(d).cross ? 0.22 : 0.45),
        lineDash: (d: EdgeData) => (ed(d).cross ? [5, 4] : 0),
        endArrow: false,
      },
      state: {
        active: { strokeOpacity: 0.9, lineWidth: 2 },
      },
    },
    combo: {
      type: "circle",
      style: {
        fill: (d: ComboData) => cd(d).color,
        fillOpacity: 0.07,
        stroke: (d: ComboData) => cd(d).color,
        strokeOpacity: 0.45,
        lineWidth: 1,
        labelText: (d: ComboData) => cd(d).label,
        labelFill: "#e6edf3",
        labelFontSize: 13,
        labelPlacement: "top",
        labelOffsetY: -4,
      },
    },
    layout: {
      type: "combo-combined",
      comboPadding: 20,
      comboSpacing: 30, // 泡泡之間的間距
      // layout 內外共用：外層(無 comboId)用 force 把泡泡推開分離、內層用 concentric 排點子成外環。
      // nodeSize/nodeSpacing 加大 + preventOverlap → 主題中心↔點子拉開，不黏成一坨。
      layout: (comboId: string | null) =>
        comboId
          ? { type: "concentric", preventOverlap: true, nodeSize: 44, nodeSpacing: 30 }
          : { type: "force", preventOverlap: true },
    },
    behaviors: [
      "drag-canvas",
      { type: "zoom-canvas", sensitivity: 0.5 }, // 滾輪縮放靈敏度調低（預設 1，太快）
      "drag-element",
      { type: "hover-activate", degree: 1, state: "active" }, // 只亮鄰域，不壓暗全圖
      "collapse-expand", // 雙擊泡泡收合／展開
    ],
  } as unknown as GraphOptions;
}

export interface GraphHandle {
  el: HTMLElement;
  activate: () => void; // 容器掛進 DOM 後再呼叫（G6 需要實際尺寸）
  onShow: () => void; // 步驟切回此面板：重算尺寸並重新 fit（隱藏時容器 0 尺寸）
}

interface PointerEvt {
  target: { id: string };
  client: { x: number; y: number };
}

// 掛載互動式關係圖。harvest：更新時呼叫，回傳步2收割的新點子。
export function mountGraph(sprint: RawSprint, harvest: () => ExtraNode[]): GraphHandle {
  const box = document.createElement("section");
  box.className = "graph";

  const head = document.createElement("div");
  head.className = "graph-head";
  const title = document.createElement("h2");
  title.className = "section-title";
  title.textContent = "想法關係圖";
  const updateBtn = document.createElement("button");
  updateBtn.className = "graph-update";
  updateBtn.type = "button";
  updateBtn.textContent = "↻ 更新";
  updateBtn.title = "把「自己多想」新填的靈感畫進圖";

  // 縮放/全景工具列
  const tools = document.createElement("div");
  tools.className = "graph-tools";
  const mkTool = (label: string, titleText: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "graph-tool";
    b.type = "button";
    b.textContent = label;
    b.title = titleText;
    return b;
  };
  const zoomInBtn = mkTool("＋", "放大");
  const zoomOutBtn = mkTool("－", "縮小");
  const fitBtn = mkTool("⛶", "全景（看全部）");
  tools.append(zoomInBtn, zoomOutBtn, fitBtn);
  head.append(title, tools, updateBtn);

  const sub = document.createElement("p");
  sub.className = "graph-sub";
  sub.textContent =
    "每個泡泡是一個主題，內含它的點子；形狀分來源（圓=AI、圓角方=你手寫、菱形=火花）。橘色環的點子橫跨多主題、用虛線橋到別的泡泡，可能是真核心或沒拆乾淨。hover 看全文，可拖曳，雙擊泡泡可收合。";

  const canvas = document.createElement("div");
  canvas.className = "graph-canvas";

  const tip = document.createElement("div");
  tip.className = "graph-tip";
  tip.hidden = true;

  box.append(head, sub, canvas);
  canvas.append(tip);

  let graph: Graph | null = null;

  // 漂浮卡：顯示節點全文（圖上故意不畫標籤，避免重疊）
  const el = (cls: string, text: string): HTMLElement => {
    const e = document.createElement("div");
    e.className = cls;
    e.textContent = text;
    return e;
  };
  const showTip = (data: GNodeData, ev: PointerEvt): void => {
    tip.replaceChildren();
    if (data.kind === "concept") {
      tip.append(el("tip-title", data.label));
    } else {
      tip.append(
        el("tip-meta", `${ORIGIN_LABEL[data.origin ?? "ai"]} · 主題：${data.members ?? ""}`),
      );
      tip.append(el("tip-body", data.label));
      if (data.quote) tip.append(el("tip-quote", `原文：${data.quote}`));
    }
    const rect = canvas.getBoundingClientRect();
    tip.style.left = `${ev.client.x - rect.left + 14}px`;
    tip.style.top = `${ev.client.y - rect.top + 14}px`;
    tip.hidden = false;
  };

  const wire = (g: Graph): void => {
    const onEnterMove = (e: unknown): void => {
      const ev = e as PointerEvt;
      const data = g.getNodeData(ev.target.id)?.data as unknown as GNodeData | undefined;
      if (data) showTip(data, ev);
    };
    g.on("node:pointerenter", onEnterMove);
    g.on("node:pointermove", onEnterMove);
    g.on("node:pointerleave", () => {
      tip.hidden = true;
    });
  };

  // 建圖／重繪（更新時重抓資料、重跑佈局）
  let loading: Promise<GraphCtor> | null = null;
  const render = async (extra: ExtraNode[]): Promise<void> => {
    if (!loading) loading = loadG6();
    const Ctor = await loading;
    const data = buildGraphData(sprint, extra) as unknown as G6GraphData;
    if (graph) {
      graph.setData(data);
      await graph.render();
    } else {
      graph = new Ctor(graphOptions(canvas, data));
      wire(graph);
      await graph.render();
    }
  };

  updateBtn.addEventListener("click", () => void render(harvest()));
  zoomInBtn.addEventListener("click", () => void graph?.zoomBy(1.3));
  zoomOutBtn.addEventListener("click", () => void graph?.zoomBy(1 / 1.3));
  fitBtn.addEventListener("click", () => void graph?.fitView());

  return {
    el: box,
    activate: () => void render([]),
    onShow: () => {
      if (!graph) return;
      graph.resize(); // 面板從隱藏轉顯示，容器尺寸變了 → 重算
      void graph.fitView();
    },
  };
}
