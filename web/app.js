const STORAGE_KEY = "dynamic_activity_diagram_saved_v4";
const DEFAULT_RAW_GRAPH = {
  diagramId: "activity-demo-01",
  lanes: [
    { id: "L_Customer", name: "Customer", order: 0 },
    { id: "L_Warehouse", name: "Warehouse", order: 1 },
    { id: "L_Sales", name: "Sales", order: 2 }
  ],
  nodes: [
    { id: "N1", label: "Submit Order", lane: "L_Customer" },
    { id: "N2", label: "Verify Order", lane: "L_Sales" },
    { id: "N3", label: "Prepare Invoice", lane: "L_Sales" },
    { id: "N4", label: "Pack Items", lane: "L_Warehouse" },
    { id: "N5", label: "Check Stock", lane: "L_Warehouse" },
    { id: "N6", label: "Confirm Delivery", lane: "L_Customer" }
  ],
  edges: [
    { id: "E1", from: "N1", to: "N2" },
    { id: "E2", from: "N2", to: "N3" },
    { id: "E3", from: "N2", to: "N5" },
    { id: "E4", from: "N5", to: "N4" },
    { id: "E5", from: "N3", to: "N6" },
    { id: "E6", from: "N4", to: "N6" },
    { id: "E7", from: "N5", to: "N2" }
  ]
};

let diagram = null, connectMode = false, connectSourceId = null;

function isBoxOverlap(a, b, pad = 14) {
  return !(
    a.x + a.width + pad <= b.x ||
    b.x + b.width + pad <= a.x ||
    a.y + a.height + pad <= b.y ||
    b.y + b.height + pad <= a.y
  );
}

function findFreePosition(lane, nodes, width = 120, height = 50, ignoreNodeId = null) {
  const startX = lane.x + 30;
  const maxX = Math.max(startX, lane.x + lane.width - width - 20);
  for (let y = 75; y < 4000; y += 25) {
    for (let x = startX; x <= maxX; x += 30) {
      const candidate = { x, y, width, height };
      if (!nodes.some(n => n.id !== ignoreNodeId && isBoxOverlap(candidate, n, 14))) {
        return { x, y };
      }
    }
  }
  return { x: startX, y: 75 };
}

function segHitsBox(p1, p2, box, pad = 10) {
  const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
  return !(maxX < box.x - pad || minX > box.x + box.width + pad || maxY < box.y - pad || minY > box.y + box.height + pad);
}

// 檢查整條折線的每一段是否撞到無關方框，若有則自動繞開
function avoidObstacles(u, v, rawWaypoints, allNodes, idx) {
  const obstacles = allNodes.filter(n => n.id !== u.id && n.id !== v.id);
  const uCenter = { x: u.x + u.width / 2, y: u.y + u.height / 2 };
  const vCenter = { x: v.x + v.width / 2, y: v.y + v.height / 2 };
  let pts = [uCenter, ...rawWaypoints, vCenter];

  for (let pass = 0; pass < 3; pass++) {
    let adjusted = false;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      const hit = obstacles.find(box => segHitsBox(p1, p2, box, 10));
      if (hit) {
        const goLeft = (p1.x + p2.x) / 2 <= hit.x + hit.width / 2;
        const safeX = goLeft ? hit.x - 22 - (idx % 3) * 8 : hit.x + hit.width + 22 + (idx % 3) * 8;
        const midY1 = Math.min(p1.y, p2.y) + 15;
        const midY2 = Math.max(p1.y, p2.y) - 15;
        const detour = p1.y <= p2.y ? [{ x: safeX, y: midY1 }, { x: safeX, y: midY2 }] : [{ x: safeX, y: midY2 }, { x: safeX, y: midY1 }];
        pts.splice(i + 1, 0, ...detour);
        adjusted = true;
        break;
      }
    }
    if (!adjusted) break;
  }
  return pts.slice(1, -1);
}

function runSmartLayout(rawGraph) {
  const data = JSON.parse(JSON.stringify(rawGraph));
  const nodeW = 120, nodeH = 50, layerGap = 95, nodeGap = 45, lanePad = 40, headerH = 50;
  const nodes = data.nodes || [], edges = data.edges || [];
  let lanes = data.lanes || [{ id: "default", name: "Default", order: 0 }];
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

  if (lanes.length > 2) {
    const weights = {};
    edges.forEach(e => {
      const uL = nodeMap[e.from] && nodeMap[e.from].lane;
      const vL = nodeMap[e.to] && nodeMap[e.to].lane;
      if (uL && vL && uL !== vL) {
        const key = [uL, vL].sort().join("|");
        weights[key] = (weights[key] || 0) + 1;
      }
    });
    const sortedPairs = Object.entries(weights).sort((a, b) => b[1] - a[1]);
    if (sortedPairs.length > 0) {
      const orderedIds = sortedPairs[0][0].split("|");
      const remaining = new Set(lanes.map(l => l.id).filter(id => !orderedIds.includes(id)));
      while (remaining.size > 0) {
        const left = orderedIds[0], right = orderedIds[orderedIds.length - 1];
        let bestId = null, bestScore = -1, putLeft = false;
        remaining.forEach(cand => {
          const sL = weights[[cand, left].sort().join("|")] || 0;
          const sR = weights[[cand, right].sort().join("|")] || 0;
          if (sL > bestScore) { bestScore = sL; bestId = cand; putLeft = true; }
          if (sR > bestScore) { bestScore = sR; bestId = cand; putLeft = false; }
        });
        if (!bestId) bestId = remaining.values().next().value;
        putLeft ? orderedIds.unshift(bestId) : orderedIds.push(bestId);
        remaining.delete(bestId);
      }
      const laneMap = Object.fromEntries(lanes.map(l => [l.id, l]));
      lanes = orderedIds.map((id, idx) => Object.assign({}, laneMap[id], { order: idx }));
    }
  }
  data.lanes = lanes;
  const laneRank = Object.fromEntries(lanes.map(l => [l.id, l.order]));

  // 區分「有連線的流程節點」與「尚未連線的新增孤立節點」，避免孤立節點全擠到最上方第0層
  const connectedIds = new Set();
  edges.forEach(e => { connectedIds.add(e.from); connectedIds.add(e.to); });
  const activeNodes = connectedIds.size > 0 ? nodes.filter(n => connectedIds.has(n.id)) : nodes;
  const isolatedNodes = connectedIds.size > 0 ? nodes.filter(n => !connectedIds.has(n.id)) : [];

  const adj = {};
  activeNodes.forEach(n => { adj[n.id] = []; });
  edges.forEach(e => { if (adj[e.from]) adj[e.from].push(e); });
  const visited = new Set(), recStack = new Set(), backEdgeIds = new Set();

  function dfs(u) {
    visited.add(u); recStack.add(u);
    (adj[u] || []).forEach(e => {
      if (!visited.has(e.to)) dfs(e.to);
      else if (recStack.has(e.to)) backEdgeIds.add(e.id);
    });
    recStack.delete(u);
  }
  activeNodes.forEach(n => { if (!visited.has(n.id)) dfs(n.id); });
  const dagEdges = edges.map(e => backEdgeIds.has(e.id) ? Object.assign({}, e, { from: e.to, to: e.from }) : e);

  const inDeg = Object.fromEntries(activeNodes.map(n => [n.id, 0]));
  const dagAdj = Object.fromEntries(activeNodes.map(n => [n.id, []]));
  dagEdges.forEach(e => {
    if (e.from !== e.to && dagAdj[e.from]) { dagAdj[e.from].push(e.to); inDeg[e.to] = (inDeg[e.to] || 0) + 1; }
  });
  const layers = Object.fromEntries(activeNodes.map(n => [n.id, 0]));
  const q = activeNodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
  while (q.length > 0) {
    const u = q.shift();
    dagAdj[u].forEach(v => {
      layers[v] = Math.max(layers[v], layers[u] + 1);
      inDeg[v]--;
      if (inDeg[v] === 0) q.push(v);
    });
  }

  const maxLayer = Math.max(0, ...Object.values(layers));
  const layeredNodes = Array.from({ length: maxLayer + 1 }, () => []);
  activeNodes.forEach(n => layeredNodes[layers[n.id]].push(n));
  layeredNodes.forEach(layer => layer.sort((a, b) => (laneRank[a.lane] || 0) - (laneRank[b.lane] || 0)));

  const maxPerLane = Object.fromEntries(lanes.map(l => [l.id, 1]));
  layeredNodes.forEach(layer => {
    const cnt = {};
    layer.forEach(n => { cnt[n.lane] = (cnt[n.lane] || 0) + 1; });
    Object.entries(cnt).forEach(([lid, c]) => { if (maxPerLane[lid]) maxPerLane[lid] = Math.max(maxPerLane[lid], c); });
  });

  let curX = 20;
  const laneX = {};
  lanes.forEach(l => {
    const slots = maxPerLane[l.id] || 1;
    l.width = slots * nodeW + (slots - 1) * nodeGap + 2 * lanePad;
    l.x = curX; laneX[l.id] = curX; curX += l.width;
  });

  layeredNodes.forEach((layer, lIdx) => {
    const y = headerH + 30 + lIdx * (nodeH + layerGap);
    const byLane = {};
    layer.forEach(n => { (byLane[n.lane] = byLane[n.lane] || []).push(n); });
    Object.entries(byLane).forEach(([lid, list]) => {
      const startX = (laneX[lid] !== undefined ? laneX[lid] : 20) + lanePad;
      list.forEach((n, i) => { n.x = startX + i * (nodeW + nodeGap); n.y = y; n.width = nodeW; n.height = nodeH; });
    });
  });

  // 孤立節點自動排在各泳道下方空位
  const placedNodes = [...activeNodes];
  isolatedNodes.forEach(n => {
    const targetLane = lanes.find(l => l.id === n.lane) || lanes[0];
    const pos = findFreePosition(targetLane, placedNodes, nodeW, nodeH);
    n.x = pos.x; n.y = pos.y; n.width = nodeW; n.height = nodeH;
    placedNodes.push(n);
  });

  edges.forEach((e, idx) => {
    const u = nodeMap[e.from], v = nodeMap[e.to];
    if (!u || !v) { e.waypoints = []; return; }
    const uCx = u.x + u.width / 2, uCy = u.y + u.height / 2;
    const vCx = v.x + v.width / 2, vCy = v.y + v.height / 2;
    const laneOffset = ((idx % 5) - 2) * 10;
    let baseWps = [];

    if (backEdgeIds.has(e.id)) {
      const offX = Math.max(u.x + u.width, v.x + v.width) + 32 + (idx % 3) * 14;
      baseWps = [{ x: offX, y: uCy }, { x: offX, y: vCy }];
    } else if (Math.abs(uCx - vCx) > 5 && Math.abs(u.y - v.y) > 5) {
      const midY = (u.y + u.height + v.y) / 2 + laneOffset;
      baseWps = [{ x: uCx, y: midY }, { x: vCx, y: midY }];
    }
    e.waypoints = avoidObstacles(u, v, baseWps, nodes, idx);
  });
  return data;
}
function setStatus(msg) { const el = document.getElementById("status"); if (el) el.textContent = msg; }

function loadDiagram() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    diagram = JSON.parse(saved);
    setStatus("已載入上次儲存的排版（未重新生成）");
  } else {
    diagram = runSmartLayout(DEFAULT_RAW_GRAPH);
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
  const laneG = document.getElementById("layer-lanes"), edgeG = document.getElementById("layer-edges");
  const nodeG = document.getElementById("layer-nodes"), wpG = document.getElementById("layer-waypoints");
  laneG.innerHTML = ""; edgeG.innerHTML = ""; nodeG.innerHTML = ""; wpG.innerHTML = "";

  const maxY = Math.max(850, ...diagram.nodes.map(n => n.y + n.height + 120));
  diagram.lanes.sort((a, b) => a.order - b.order);
  let curX = 20;
  diagram.lanes.forEach(l => { l.x = curX; curX += l.width; });
  svg.setAttribute("width", Math.max(1200, curX + 60));
  svg.setAttribute("height", maxY + 40);

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

  const nodeMap = Object.fromEntries(diagram.nodes.map(n => [n.id, n]));
  diagram.edges.forEach(edge => {
    const u = nodeMap[edge.from], v = nodeMap[edge.to];
    if (!u || !v) return;
    if (!edge.waypoints || edge.waypoints.length === 0) {
      const mx = (u.x + u.width / 2 + v.x + v.width / 2) / 2;
      const my = (u.y + u.height / 2 + v.y + v.height / 2) / 2;
      edge.waypoints = [{ x: mx, y: my }];
    }
    const pts = [{ x: u.x + u.width / 2, y: u.y + u.height / 2 }, ...edge.waypoints, { x: v.x + v.width / 2, y: v.y + v.height / 2 }];
    pts[0] = clipToRectEdge(u, pts[1]);
    pts[pts.length - 1] = clipToRectEdge(v, pts[pts.length - 2]);
    const d = pts.map((p, i) => (i === 0 ? "M " : "L ") + p.x + " " + p.y).join(" ");
    edgeG.appendChild(createSvgEl("path", { d: d, class: "edge-line", "marker-end": "url(#arrow)" }));

    edge.waypoints.forEach(wp => {
      const circle = createSvgEl("circle", { cx: wp.x, cy: wp.y, r: 4.5, class: "waypoint", opacity: "0.75" });
      makeDraggable(circle, (dx, dy) => { wp.x += dx; wp.y += dy; render(); });
      wpG.appendChild(circle);
    });
  });

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
    rect.addEventListener("click", e => {
      if (!connectMode) return;
      e.stopPropagation();
      if (!connectSourceId) { connectSourceId = node.id; setStatus("已選起點 " + node.id + "，請點擊目標節點"); render(); }
      else if (connectSourceId !== node.id) {
        diagram.edges.push({ id: "E" + Date.now().toString().slice(-4), from: connectSourceId, to: node.id, waypoints: [] });
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
      const collided = diagram.nodes.some(other => other.id !== node.id && isBoxOverlap(node, other, 10));
      if (collided) {
        const currentLane = diagram.lanes.find(l => l.id === node.lane) || diagram.lanes[0];
        const safePos = findFreePosition(currentLane, diagram.nodes, node.width, node.height, node.id);
        node.x = safePos.x; node.y = safePos.y;
        setStatus("偵測到方框重疊，已自動調整至不重疊空位");
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

function clipToRectEdge(rect, targetPt) {
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const dx = targetPt.x - cx, dy = targetPt.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min((rect.width / 2) / Math.abs(dx || 1e-6), (rect.height / 2) / Math.abs(dy || 1e-6));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function makeDraggable(el, onDrag, onEnd = null) {
  el.addEventListener("mousedown", e => {
    e.preventDefault(); e.stopPropagation();
    let lastX = e.clientX, lastY = e.clientY;
    const onMove = mv => { onDrag(mv.clientX - lastX, mv.clientY - lastY); lastX = mv.clientX; lastY = mv.clientY; };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (onEnd) onEnd();
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  });
}

function createSvgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

document.getElementById("btn-auto-layout").onclick = () => { diagram = runSmartLayout(diagram); setStatus("已重新執行智慧初始排版"); render(); };
document.getElementById("btn-add-node").onclick = () => {
  const id = "N" + (diagram.nodes.length + 1), label = prompt("輸入新節點名稱：", id) || id, firstLane = diagram.lanes[0];
  const freePos = findFreePosition(firstLane, diagram.nodes, 120, 50);
  diagram.nodes.push({ id, label, lane: firstLane.id, x: freePos.x, y: freePos.y, width: 120, height: 50 });
  setStatus(`已在空位建立節點 ${label}`); render();
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
    diagram = hasCoords ? loaded : runSmartLayout(loaded);
    saveDiagram(false); setStatus(hasCoords ? "已匯入並還原儲存的排版" : "已匯入原始圖並執行智慧初始排版"); render();
  };
  reader.readAsText(file);
};
document.getElementById("btn-reset").onclick = () => { localStorage.removeItem(STORAGE_KEY); loadDiagram(); };
loadDiagram();
