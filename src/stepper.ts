// 步驟式佈局：依使用流程(想法牆 → 關係圖 → 多想幾個 → 收斂)一次只顯示一個面板，
// 解決所有段落堆疊導致頁面過長。面板都留在 DOM(切換用 hidden)，故 cytoscape / 步2 狀態不掉。
// onShow：面板由隱藏轉顯示時呼叫(cytoscape 重算尺寸、2×2 重畫 chip 需要實際寬高)。

export interface Step {
  label: string;
  sub?: string; // tab 上的次標籤（如「· 看分布」），純裝飾
  panel: HTMLElement;
  onShow?: () => void;
}

export interface StepperHandle {
  el: HTMLElement;
  go: (index: number) => void;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountStepper(steps: Step[]): StepperHandle {
  const box = el("div", "stepper");
  const nav = el("div", "stepper-nav");
  const body = el("div", "stepper-body");
  const tabs: HTMLButtonElement[] = [];
  let current = -1;

  const go = (i: number): void => {
    if (i < 0 || i >= steps.length) return;
    current = i;
    steps.forEach((s, idx) => {
      s.panel.hidden = idx !== i;
      tabs[idx].classList.toggle("active", idx === i);
    });
    const active = steps[i].panel;
    active.classList.remove("panel-enter");
    void active.offsetWidth; // 強制 reflow 讓動畫每次切換都重播
    active.classList.add("panel-enter");
    steps[i].onShow?.();
    updateFooter();
  };

  // 上一步 / 下一步（宣告擺在 updateFooter 之前：後者要讀 prev/next.disabled）
  const footer = el("div", "stepper-footer");
  const prev = el("button", "ghost-btn", "← 上一步") as HTMLButtonElement;
  const next = el("button", "ghost-btn", "下一步 →") as HTMLButtonElement;
  prev.type = "button";
  next.type = "button";
  prev.addEventListener("click", () => go(current - 1));
  next.addEventListener("click", () => go(current + 1));
  footer.append(prev, next);

  // 末頁停用「下一步」、首頁停用「上一步」
  const updateFooter = (): void => {
    prev.disabled = current <= 0;
    next.disabled = current >= steps.length - 1;
  };

  steps.forEach((s, idx) => {
    const tab = el("button", "step-tab") as HTMLButtonElement;
    tab.type = "button";
    const labelWrap = el("span", "step-label");
    labelWrap.append(document.createTextNode(s.label));
    if (s.sub) labelWrap.append(el("span", "step-label-sub", ` · ${s.sub}`));
    tab.append(el("span", "step-num", String(idx + 1)), labelWrap);
    tab.addEventListener("click", () => go(idx));
    tabs.push(tab);
    nav.append(tab);
    s.panel.hidden = true;
    body.append(s.panel);
  });

  box.append(nav, body, footer);
  go(0); // 預設落在第 1 步：避免回傳時 current=-1 的無效態（prev/next 仍可點 go(-1)/go(1)）
  return { el: box, go };
}
