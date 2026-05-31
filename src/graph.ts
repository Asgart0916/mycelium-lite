// 想法關係圖（cytoscape.js）：主題 hub + 點子節點，點子連到其每個歸屬主題。
// 顏色區分主題（點子繼承主歸屬主題色）；來源用形狀分（AI=圓 / 手寫=圓角方 / 火花=菱形）；
// 跨主題點子（AI 多歸屬）加粗環 = 盲點訊號。互動：hover 放大+鄰居高亮+漂浮卡、
// 點擊主題高亮子圖、更新按鈕收割步2新靈感重佈局。
// 純資料建模在 graph-model.ts（可單測）；本檔只管 cytoscape runtime 與互動。

import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { type ExtraNode, type IdeaOrigin, buildElements } from "./graph-model";
import type { RawSprint } from "./parse";

export type { ExtraNode, HarvestRow } from "./graph-model";
export { harvestNodes, buildElements, assignConceptColors } from "./graph-model";

cytoscape.use(fcose as cytoscape.Ext);

const ORIGIN_LABEL: Record<IdeaOrigin, string> = {
  ai: "AI 回填",
  human: "你手寫",
  spark: "火花採用",
};

function fcoseLayout(): cytoscape.LayoutOptions {
  return {
    name: "fcose",
    quality: "proof",
    animate: true,
    animationDuration: 600,
    randomize: true, // 必須 true：否則所有節點從 (0,0) 重合點起算 → 退化成一直線
    nodeSeparation: 220,
    idealEdgeLength: 70, // 短輻條 = 同主題葉點貼近 hub（叢內緊）
    nodeRepulsion: 18000, // 強斥力 = 不同主題叢推開、用滿畫布（叢間鬆）
    gravity: 0.12, // 弱重力 = 不把叢全擠到中心，讓它們散開填空白
    gravityRange: 4.5,
    numIter: 2500,
    packComponents: true, // 把不相連的主題叢（如無跨主題點子者）整齊鋪開
    padding: 50,
  } as unknown as cytoscape.LayoutOptions;
}

// cytoscape 樣式：顏色吃 data(color)，形狀依來源 class，跨主題加粗環，互動態用 .focus/.faded。
function graphStyle(): cytoscape.StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        label: "",
        "transition-property": "width height border-width opacity",
        "transition-duration": 180,
      },
    },
    {
      selector: "node.concept",
      style: {
        width: 26,
        height: 26,
        label: "data(label)",
        color: "#e6edf3",
        "font-size": 13,
        "font-weight": 600,
        "text-valign": "top",
        "text-margin-y": -4,
        "text-outline-color": "#14171a",
        "text-outline-width": 3,
        "border-width": 2,
        "border-color": "#14171a",
      },
    },
    { selector: "node.idea", style: { width: 12, height: 12 } },
    { selector: "node.ai", style: { shape: "ellipse" } },
    { selector: "node.human", style: { shape: "round-rectangle" } },
    { selector: "node.spark", style: { shape: "diamond", width: 14, height: 14 } },
    {
      selector: "node.cross",
      style: { width: 16, height: 16, "border-width": 3, "border-color": "#ef9f27" },
    },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": "data(color)",
        "line-opacity": 0.45,
        "curve-style": "straight",
      },
    },
    { selector: ".faded", style: { opacity: 0.12 } },
    {
      selector: "node.focus",
      style: { width: 30, height: 30, "border-width": 3, "border-color": "#e6edf3" },
    },
    { selector: "node.concept.focus", style: { width: 36, height: 36 } },
    { selector: "edge.focus", style: { width: 2.5, "line-opacity": 0.9 } },
  ] as unknown as cytoscape.StylesheetJson;
}

export interface GraphHandle {
  el: HTMLElement;
  activate: () => void; // 容器掛進 DOM 後再呼叫（cytoscape 需要實際尺寸）
  onShow: () => void; // 步驟切回此面板時呼叫：重算尺寸並重新 fit（隱藏時容器 0 尺寸）
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

  // 縮放/全景/聚焦工具列（解決滾輪縮放太慢）
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
  const focusBtn = mkTool("◎", "聚焦（對齊目前選的主題）");
  tools.append(zoomInBtn, zoomOutBtn, fitBtn, focusBtn);
  head.append(title, tools, updateBtn);

  const sub = document.createElement("p");
  sub.className = "graph-sub";
  sub.textContent =
    "顏色分主題；形狀分來源（圓=AI、圓角方=你手寫、菱形=火花）；橘色加粗環的點子橫跨多主題，可能是真核心或沒拆乾淨。點主題可聚焦，hover 看全文，可拖曳。";

  const canvas = document.createElement("div");
  canvas.className = "graph-canvas";

  const tip = document.createElement("div");
  tip.className = "graph-tip";
  tip.hidden = true;

  box.append(head, sub, canvas);
  canvas.append(tip);

  let cy: cytoscape.Core | null = null;
  let locked: cytoscape.Collection | null = null; // 點主題「鎖定」的子圖（hover 移開不清，聚焦鈕用）

  const clearVisual = (): void => {
    cy?.elements().removeClass("faded focus");
  };
  // 高亮某集合（自己 + 鄰域），其餘淡出。
  const applyFocus = (eles: cytoscape.Collection): void => {
    if (!cy) return;
    cy.elements().addClass("faded");
    eles.removeClass("faded").addClass("focus");
  };
  // hover 結束時回到「鎖定」狀態（有鎖定就還原它，沒有就全清）→ 點擊選取得以保留。
  const restore = (): void => {
    clearVisual();
    if (locked && locked.length > 0) applyFocus(locked);
  };

  const showTip = (node: cytoscape.NodeSingular): void => {
    tip.replaceChildren();
    if (node.data("kind") === "concept") {
      const t = document.createElement("div");
      t.className = "tip-title";
      t.textContent = node.data("label");
      tip.append(t);
    } else {
      const origin = node.data("origin") as IdeaOrigin;
      const meta = document.createElement("div");
      meta.className = "tip-meta";
      meta.textContent = `${ORIGIN_LABEL[origin]} · 主題：${node.data("members")}`;
      const body = document.createElement("div");
      body.className = "tip-body";
      body.textContent = node.data("label");
      tip.append(meta, body);
      const quote = node.data("quote") as string;
      if (quote) {
        const q = document.createElement("div");
        q.className = "tip-quote";
        q.textContent = `原文：${quote}`;
        tip.append(q);
      }
    }
    const pos = node.renderedPosition();
    tip.style.left = `${pos.x + 14}px`;
    tip.style.top = `${pos.y + 14}px`;
    tip.hidden = false;
  };

  const wire = (): void => {
    if (!cy) return;
    cy.on("mouseover", "node", (evt) => {
      const node = evt.target as cytoscape.NodeSingular;
      clearVisual();
      applyFocus(node.closedNeighborhood());
      showTip(node);
    });
    cy.on("mouseout", "node", () => {
      tip.hidden = true;
      restore(); // 回到鎖定狀態，不是無條件清掉
    });
    // 點主題 → 鎖定該子圖（hover 移開仍保留）；點空白 → 解除鎖定
    cy.on("tap", "node.concept", (evt) => {
      locked = (evt.target as cytoscape.NodeSingular).closedNeighborhood();
      applyFocus(locked);
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        locked = null;
        clearVisual();
      }
    });
  };

  // 工具列：以畫面中心為錨縮放、全景、聚焦目前鎖定的子圖
  const zoomBy = (factor: number): void => {
    if (!cy) return;
    const center = { x: cy.width() / 2, y: cy.height() / 2 };
    cy.animate(
      { zoom: { level: cy.zoom() * factor, renderedPosition: center } },
      { duration: 150 },
    );
  };
  zoomInBtn.addEventListener("click", () => zoomBy(1.4));
  zoomOutBtn.addEventListener("click", () => zoomBy(1 / 1.4));
  fitBtn.addEventListener("click", () =>
    cy?.animate({ fit: { eles: cy.elements(), padding: 40 } }),
  );
  focusBtn.addEventListener("click", () => {
    if (!cy) return;
    const eles = locked && locked.length > 0 ? locked : cy.elements();
    cy.animate({ fit: { eles, padding: 60 } });
  });

  const render = (extra: ExtraNode[]): void => {
    if (cy) {
      cy.elements().remove();
      cy.add(buildElements(sprint, extra));
    } else {
      cy = cytoscape({
        container: canvas,
        elements: buildElements(sprint, extra),
        style: graphStyle(),
        layout: { name: "preset" }, // 先 preset 避免初始閃動，下面再跑 fcose
        wheelSensitivity: 0.5, // 滾輪縮放加快（預設過慢）
        pixelRatio: "auto", // 跟著螢幕 DPI → 標籤清晰不糊
        textureOnViewport: false, // 互動時不用低解析貼圖，文字維持銳利
        motionBlur: false,
      });
      wire();
    }
    cy.layout(fcoseLayout()).run();
  };

  updateBtn.addEventListener("click", () => {
    render(harvest());
  });

  return {
    el: box,
    activate: () => render([]),
    onShow: () => {
      if (!cy) return;
      cy.resize(); // 面板從隱藏轉顯示，容器尺寸變了 → 重算
      cy.fit(cy.elements(), 40);
    },
  };
}
