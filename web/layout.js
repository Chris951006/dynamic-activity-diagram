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

const GRID = { nodeW: 120, nodeH: 50, rowGap: 95, colGap: 45, lanePad: 40, headerH: 50 };

function isBoxOverlap(a, b, pad = 12) {
  return !(
    a.x + a.width + pad <= b.x ||
    b.x + b.width + pad <= a.x ||
    a.y + a.height + pad <= b.y ||
    b.y + b.height + pad <= a.y
  );
}

// 嚴格在合法的橫列網格 (row = 0, 1, 2...) 尋找不重疊空格，絕不掉進兩列之間的布線走廊
function findGridSlot(lane, nodes, ignoreId = null) {
  const stepX = GRID.nodeW + GRID.colGap;
  const stepY = GRID.nodeH + GRID.rowGap;
  const maxCols = Math.max(1, Math.floor((lane.width - 2 * GRID.lanePad + GRID.colGap) / stepX));

  for (let r = 0; r < 40; r++) {
    const y = GRID.headerH + 30 + r * stepY;
    for (let c = 0; c < maxCols; c++) {
      const x = lane.x + GRID.lanePad + c * stepX;
      const box = { x, y, width: GRID.nodeW, height: GRID.nodeH };
      if (!nodes.some(n => n.id !== ignoreId && isBoxOverlap(box, n, 10))) {
        return { x, y };
      }
    }
  }
  return { x: lane.x + GRID.lanePad, y: GRID.headerH + 30 };
}

function computeSmartLayout(rawGraph) {
  const data = JSON.parse(JSON.stringify(rawGraph));
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  let lanes = data.lanes || [{ id: "default", name: "Default", order: 0 }];
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

  // 1. 智慧泳道排序：互動連線最多的泳道排在相鄰位置
  if (lanes.length > 2) {
    const weights = {};
    edges.forEach(e => {
      const uL = nodeMap[e.from]?.lane, vL = nodeMap[e.to]?.lane;
      if (uL && vL && uL !== vL) {
        const key = [uL, vL].sort().join("|");
        weights[key] = (weights[key] || 0) + 1;
      }
    });
    const top = Object.entries(weights).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const ordered = top[0].split("|");
      const rest = new Set(lanes.map(l => l.id).filter(id => !ordered.includes(id)));
      while (rest.size > 0) {
        let best = null, score = -1, left = false;
        rest.forEach(c => {
          const sL = weights[[c, ordered[0]].sort().join("|")] || 0;
          const sR = weights[[c, ordered[ordered.length - 1]].sort().join("|")] || 0;
          if (sL > score) { score = sL; best = c; left = true; }
          if (sR > score) { score = sR; best = c; left = false; }
        });
        if (!best) best = rest.values().next().value;
        left ? ordered.unshift(best) : ordered.push(best);
        rest.delete(best);
      }
      const lMap = Object.fromEntries(lanes.map(l => [l.id, l]));
      lanes = ordered.map((id, i) => ({ ...lMap[id], order: i }));
    }
  }
  data.lanes = lanes;

  // 2. 分離「有連線的主流程節點」與「尚未連線的孤立節點」
  const linkedIds = new Set();
  edges.forEach(e => { linkedIds.add(e.from); linkedIds.add(e.to); });
  const activeNodes = linkedIds.size > 0 ? nodes.filter(n => linkedIds.has(n.id)) : nodes;
  const freeNodes = linkedIds.size > 0 ? nodes.filter(n => !linkedIds.has(n.id)) : [];

  // 3. 偵測迴圈回邊並計算拓撲分層 (row)
  const adj = Object.fromEntries(activeNodes.map(n => [n.id, []]));
  edges.forEach(e => { if (adj[e.from]) adj[e.from].push(e); });
  const vis = new Set(), stack = new Set(), backIds = new Set();
  function dfs(u) {
    vis.add(u); stack.add(u);
    (adj[u] || []).forEach(e => {
      if (!vis.has(e.to)) dfs(e.to);
      else if (stack.has(e.to)) backIds.add(e.id);
    });
    stack.delete(u);
  }
  activeNodes.forEach(n => { if (!vis.has(n.id)) dfs(n.id); });

  const inDeg = Object.fromEntries(activeNodes.map(n => [n.id, 0]));
  const dag = Object.fromEntries(activeNodes.map(n => [n.id, []]));
  edges.forEach(e => {
    const u = backIds.has(e.id) ? e.to : e.from;
    const v = backIds.has(e.id) ? e.from : e.to;
    if (u !== v && dag[u] && inDeg[v] !== undefined) { dag[u].push(v); inDeg[v]++; }
  });

  const rowOf = Object.fromEntries(activeNodes.map(n => [n.id, 0]));
  const q = activeNodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
  while (q.length > 0) {
    const u = q.shift();
    dag[u].forEach(v => {
      rowOf[v] = Math.max(rowOf[v], rowOf[u] + 1);
      if (--inDeg[v] === 0) q.push(v);
    });
  }

  // 4. 依每層最大並排數計算各泳道寬度，並精準對齊每列 X, Y
  const maxRow = Math.max(0, ...Object.values(rowOf));
  const maxColsPerLane = Object.fromEntries(lanes.map(l => [l.id, 1]));
  for (let r = 0; r <= maxRow; r++) {
    const cnt = {};
    activeNodes.filter(n => rowOf[n.id] === r).forEach(n => { cnt[n.lane] = (cnt[n.lane] || 0) + 1; });
    Object.entries(cnt).forEach(([lid, c]) => {
      if (maxColsPerLane[lid]) maxColsPerLane[lid] = Math.max(maxColsPerLane[lid], c);
    });
  }

  let curX = 20;
  lanes.forEach(l => {
    const cols = maxColsPerLane[l.id] || 1;
    l.width = cols * GRID.nodeW + (cols - 1) * GRID.colGap + 2 * GRID.lanePad;
    l.x = curX;
    curX += l.width;
  });

  for (let r = 0; r <= maxRow; r++) {
    const y = GRID.headerH + 30 + r * (GRID.nodeH + GRID.rowGap);
    lanes.forEach(l => {
      const list = activeNodes.filter(n => n.lane === l.id && rowOf[n.id] === r);
      list.forEach((n, i) => {
        n.x = l.x + GRID.lanePad + i * (GRID.nodeW + GRID.colGap);
        n.y = y;
        n.width = GRID.nodeW;
        n.height = GRID.nodeH;
      });
    });
  }

  // 5. 未連線的孤立節點統一排在主流程最下方一列 (maxRow + 1)
  const placed = [...activeNodes];
  freeNodes.forEach(n => {
    const lane = lanes.find(l => l.id === n.lane) || lanes[0];
    let pos = null;
    for (let r = maxRow + 1; r < maxRow + 25 && !pos; r++) {
      const y = GRID.headerH + 30 + r * (GRID.nodeH + GRID.rowGap);
      const maxC = Math.max(1, Math.floor((lane.width - 2 * GRID.lanePad + GRID.colGap) / (GRID.nodeW + GRID.colGap)));
      for (let c = 0; c < maxC; c++) {
        const x = lane.x + GRID.lanePad + c * (GRID.nodeW + GRID.colGap);
        if (!placed.some(p => isBoxOverlap({ x, y, width: GRID.nodeW, height: GRID.nodeH }, p, 10))) {
          pos = { x, y };
          break;
        }
      }
    }
    pos = pos || { x: lane.x + GRID.lanePad, y: GRID.headerH + 30 + (maxRow + 1) * (GRID.nodeH + GRID.rowGap) };
    n.x = pos.x; n.y = pos.y; n.width = GRID.nodeW; n.height = GRID.nodeH;
    placed.push(n);
  });

  // 清除手動通道覆寫，交由 router.js 統一執行電路圖主幹合併布線
  edges.forEach(e => { delete e.customTrunkX; delete e.waypoints; });
  return data;
}
