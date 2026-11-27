const STORAGE_KEY = "dynamic_activity_diagram_saved_v7";
let diagram = null, connectMode = false, connectSourceId = null;

function setStatus(msg) { const el = document.getElementById("status"); if (el) el.textContent = msg; }

function loadDiagram() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    diagram = JSON.parse(saved);
    setStatus("已載入上次儲存的排版（未重新生成）");
  } else {
    diagram = computeSmartLayout(DEFAULT_RAW_GRAPH);
    saveDiagram(false);
    setStatus("首次開啟：已完成智慧初始排版並自動儲存");
  }
  render();
}

function saveDiagram(notify = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(diagram));
  if (notify) setStatus("已儲存目前位置、泳道順序與連線路徑 (" + new Date().toLocaleTimeString() + ")");
}

function render() {
  const svg = document.getElementById("diagram-svg");
  const laneG = document.getElementById("layer-lanes");
  const edgeG = document.getElementById("layer-edges");
  const nodeG = document.getElementById("layer-nodes");
  laneG.innerHTML = ""; edgeG.innerHTML = ""; nodeG.innerHTML = "";

  const maxX = Math.max(1200, ...diagram.nodes.map(n => n.x + n.width + 80));
  const maxY = Math.max(850, ...diagram.nodes.map(n => n.y + n.height + 120));
  diagram.lanes.sort((a, b) => a.order - b.order);
  let curX = 20;
  diagram.lanes.forEach(l => { l.x = curX; curX += l.width; });
  svg.setAttribute("width", Math.max(maxX, curX + 60));
  svg.setAttribute("height", maxY + 40);

  // 1. 繪製泳道
  diagram.lanes.forEach((lane, idx) => {
    const header = createSvgEl("rect", { x: lane.x, y: 10, width: lane.width, height: 40, class: "lane-header" });
    const body = createSvgEl("rect", { x: lane.x, y: 50, width: lane.width, height: maxY - 50, class: "lane-body" });
    const text = createSvgEl("text", {
      x: lane.x + lane.width / 2, y: 35, "text-anchor": "middle", "font-weight": "bold", "font-size": "14",
      style: "pointer-events: none; user-select: none;"
    });
    text.textContent = lane.name + " (左右拖曳換順序)";
    header.addEventListener("mousedown", e => {
      e.preventDefault();
      const startX = e.clientX;
      const onUp = upEvt => {
        window.removeEventListener("mouseup", onUp);
        const dx = upEvt.clientX - startX;
        if (Math.abs(dx) > 30) {
          const targetIdx = dx > 0 ? Math.min(diagram.lanes.length - 1, idx + 1) : Math.max(0, idx - 1);
          if (targetIdx !== idx) { swapLanes(idx, targetIdx); setStatus("已調整泳道順序"); render(); }
        }
      };
      window.addEventListener("mouseup", onUp);
    });
    laneG.append(body, header, text);
  });

  // 2. 執行純直角電路圖布線（含同源主幹合併與 T 字匯流偵測）
  const { plans, segments, junctions } = computeSchematicRoutes(diagram);

  plans.forEach(p => {
    if (!p.pts || p.pts.length < 2) return;
    const d = p.pts.map((pt, i) => (i === 0 ? "M " : "L ") + pt.x + " " + pt.y).join(" ");
    edgeG.appendChild(createSvgEl("path", { d, class: "edge-line", "marker-end": "url(#arrow)" }));
  });

  // 垂直主幹可左右平移拖曳；雙擊恢復自動合併
  segments.forEach(seg => {
    const isVert = Math.abs(seg.a.x - seg.b.x) < 1;
    if (!isVert) return;
    const hit = createSvgEl("line", { x1: seg.a.x, y1: seg.a.y, x2: seg.b.x, y2: seg.b.y, class: "seg-hit" });
    hit.addEventListener("dblclick", e => {
      e.stopPropagation();
      delete seg.edge.customTrunkX;
      setStatus("已恢復自動主幹合併");
      render();
    });
    makeDraggable(hit, dx => {
      seg.edge.customTrunkX = (seg.edge.customTrunkX !== undefined ? seg.edge.customTrunkX : seg.a.x) + dx;
      render();
    });
    edgeG.appendChild(hit);
  });

  // 僅在 T 字分岔 / 匯流點標註實心橘色接點
  junctions.forEach(dot => {
    edgeG.appendChild(createSvgEl("circle", {
      cx: dot.x, cy: dot.y, r: 4.5, fill: "#f59e0b", stroke: "#ffffff", "stroke-width": "1.5"
    }));
  });

  // 3. 繪製方框節點
  diagram.nodes.forEach(node => {
    const g = createSvgEl("g", {});
    const rect = createSvgEl("rect", {
      x: node.x, y: node.y, width: node.width, height: node.height,
      class: "node-rect" + (connectSourceId === node.id ? " selected" : "")
    });
    const label = createSvgEl("text", {
      x: node.x + node.width / 2, y: node.y + node.height / 2 + 5, "text-anchor": "middle", "font-size": "13",
      style: "pointer-events: none; user-select: none;"
    });
    label.textContent = node.label || node.id;

    rect.addEventListener("dblclick", e => {
      e.stopPropagation();
      const next = prompt("修改節點名稱：", node.label || node.id);
      if (next && next.trim()) { node.label = next.trim(); render(); }
    });

    rect.addEventListener("click", e => {
      if (!connectMode) return;
      e.stopPropagation();
      if (!connectSourceId) { connectSourceId = node.id; setStatus("已選起點 " + node.id + "，請點擊目標節點"); render(); }
      else if (connectSourceId !== node.id) {
        diagram.edges.push({ id: "E" + Date.now().toString().slice(-4), from: connectSourceId, to: node.id });
        connectMode = false; connectSourceId = null; setStatus("已建立新連線"); render();
      }
    });

    makeDraggable(rect, (dx, dy) => {
      if (connectMode) return;
      node.x += dx; node.y = Math.max(60, node.y + dy);
      const centerX = node.x + node.width / 2;
      const hitLane = diagram.lanes.find(l => centerX >= l.x && centerX <= l.x + l.width);
      if (hitLane) node.lane = hitLane.id;
      render();
    }, () => {
      if (diagram.nodes.some(other => other.id !== node.id && isBoxOverlap(node, other, 10))) {
        const lane = diagram.lanes.find(l => l.id === node.lane) || diagram.lanes[0];
        const safe = findGridSlot(lane, diagram.nodes, node.id);
        node.x = safe.x; node.y = safe.y;
        setStatus("偵測到方框重疊，已自動對齊至最近空格");
        render();
      }
    });

    g.append(rect, label); nodeG.appendChild(g);
  });
}

function swapLanes(idxA, idxB) {
  const laneA = diagram.lanes[idxA], laneB = diagram.lanes[idxB];
  const oldXa = laneA.x, oldXb = laneB.x, tempOrder = laneA.order;
  laneA.order = laneB.order; laneB.order = tempOrder;
  diagram.lanes.sort((a, b) => a.order - b.order);
  let curX = 20; const newXMap = {};
  diagram.lanes.forEach(l => { newXMap[l.id] = curX; curX += l.width; });
  diagram.nodes.forEach(n => {
    if (n.lane === laneA.id) n.x += (newXMap[laneA.id] - oldXa);
    else if (n.lane === laneB.id) n.x += (newXMap[laneB.id] - oldXb);
  });
}

function makeDraggable(el, onDrag, onEnd = null) {
  el.addEventListener("mousedown", e => {
    e.preventDefault(); e.stopPropagation();
    let lastX = e.clientX, lastY = e.clientY;
    const onMove = mv => { onDrag(mv.clientX - lastX, mv.clientY - lastY); lastX = mv.clientX; lastY = mv.clientY; };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); if (onEnd) onEnd(); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  });
}

function createSvgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

document.getElementById("btn-auto-layout").onclick = () => { diagram = computeSmartLayout(diagram); setStatus("已重新執行智慧初始排版"); render(); };
document.getElementById("btn-add-node").onclick = () => {
  let maxNum = 0;
  diagram.nodes.forEach(n => { const m = /^N(\d+)$/.exec(n.id); if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10)); });
  const id = "N" + (maxNum + 1), label = prompt("輸入新節點名稱：", id) || id, firstLane = diagram.lanes[0];
  const pos = findGridSlot(firstLane, diagram.nodes);
  diagram.nodes.push({ id, label, lane: firstLane.id, x: pos.x, y: pos.y, width: GRID.nodeW, height: GRID.nodeH });
  setStatus(`已在空格建立節點 ${label}`); render();
};
document.getElementById("btn-add-edge").onclick = () => { connectMode = true; connectSourceId = null; setStatus("連線模式：請先點擊起點節點"); };
document.getElementById("btn-save").onclick = () => saveDiagram(true);
document.getElementById("btn-export").onclick = () => {
  const blob = new Blob([JSON.stringify(diagram, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (diagram.diagramId || "activity-diagram") + ".json"; a.click();
};
document.getElementById("btn-import").onclick = () => document.getElementById("file-input").click();
document.getElementById("file-input").onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    const loaded = JSON.parse(evt.target.result);
    const hasCoords = loaded.nodes && loaded.nodes.some(n => typeof n.x === "number");
    diagram = hasCoords ? loaded : computeSmartLayout(loaded);
    saveDiagram(false); setStatus(hasCoords ? "已匯入並還原儲存的排版" : "已匯入原始圖並執行智慧初始排版"); render();
  };
  reader.readAsText(file);
};
document.getElementById("btn-reset").onclick = () => { localStorage.removeItem(STORAGE_KEY); loadDiagram(); };
loadDiagram();
