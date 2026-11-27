// 純直角電路圖布線引擎：支援「同源主幹合併 (Bus Trunk)」與「T字匯流接點偵測」
function getVerticalBlocker(x, y1, y2, obstacles, pad = 12) {
  const top = Math.min(y1, y2), bot = Math.max(y1, y2);
  return obstacles.find(b =>
    b.y < bot - 2 && b.y + b.height > top + 2 &&
    x >= b.x - pad && x <= b.x + b.width + pad
  );
}

function findClearX(preferredX, y1, y2, obstacles) {
  let x = preferredX;
  for (let i = 0; i < 12; i++) {
    const blocker = getVerticalBlocker(x, y1, y2, obstacles, 14);
    if (!blocker) return x;
    const leftX = blocker.x - 20;
    const rightX = blocker.x + blocker.width + 20;
    x = Math.abs(preferredX - leftX) <= Math.abs(preferredX - rightX) ? leftX : rightX;
  }
  return x;
}

function computeSchematicRoutes(diagram) {
  const nodes = diagram.nodes || [];
  const edges = diagram.edges || [];
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

  // 1. 先計算每條向下連線理想的垂直通道 X
  const plans = edges.map(edge => {
    const u = nodeMap[edge.from], v = nodeMap[edge.to];
    if (!u || !v) return { edge, type: "invalid", pts: [] };

    const obstacles = nodes.filter(n => n.id !== u.id && n.id !== v.id);
    const uCx = u.x + u.width / 2, uCy = u.y + u.height / 2;
    const vCx = v.x + v.width / 2, vCy = v.y + v.height / 2;

    // 迴圈向上回邊 (從右側繞行)
    if (v.y + v.height <= u.y + 10) {
      const baseRight = Math.max(u.x + u.width, v.x + v.width) + 26;
      const loopX = findClearX(baseRight, vCy, uCy, obstacles);
      return {
        edge, type: "loop", u, v,
        pts: [
          { x: u.x + u.width, y: uCy },
          { x: loopX, y: uCy },
          { x: loopX, y: vCy },
          { x: v.x + v.width, y: vCy }
        ]
      };
    }

    const exitY = u.y + u.height + 18;
    const entryY = v.y - 20;

    // 同一垂直線且中間無障礙物：直接垂直相連
    if (Math.abs(uCx - vCx) <= 2 && !getVerticalBlocker(uCx, u.y + u.height, v.y, obstacles, 10)) {
      return {
        edge, type: "straight", u, v,
        pts: [{ x: uCx, y: u.y + u.height }, { x: vCx, y: v.y }]
      };
    }

    const rawTrunkX = edge.customTrunkX !== undefined
      ? edge.customTrunkX
      : findClearX(uCx, exitY, entryY, obstacles);

    return {
      edge, type: "down", u, v, uCx, vCx, exitY, entryY,
      trunkX: rawTrunkX,
      side: rawTrunkX < uCx ? "left" : (rawTrunkX > uCx ? "right" : "center")
    };
  });

  // 2. 主幹合併 (Bus Merging)：同一個來源節點的多條同側出邊，合併共用同一條 trunkX
  const groups = {};
  plans.forEach(p => {
    if (p.type !== "down" || p.edge.customTrunkX !== undefined) return;
    const key = `${p.u.id}_${p.side}`;
    (groups[key] = groups[key] || []).push(p);
  });

  Object.values(groups).forEach(group => {
    if (group.length < 2) return;
    const side = group[0].side;
    const mergedX = side === "left"
      ? Math.min(...group.map(g => g.trunkX))
      : Math.max(...group.map(g => g.trunkX));
    group.forEach(g => { g.trunkX = mergedX; });
  });

  // 3. 產生最終純直角折線點
  plans.forEach(p => {
    if (p.type !== "down") return;
    const { u, v, uCx, vCx, exitY, entryY, trunkX } = p;
    if (entryY <= exitY + 4) {
      const midY = (u.y + u.height + v.y) / 2;
      p.pts = [
        { x: uCx, y: u.y + u.height },
        { x: uCx, y: midY },
        { x: vCx, y: midY },
        { x: vCx, y: v.y }
      ];
      return;
    }

    const pts = [{ x: uCx, y: u.y + u.height }];
    if (Math.abs(trunkX - uCx) > 2) {
      pts.push({ x: uCx, y: exitY }, { x: trunkX, y: exitY });
    }
    if (Math.abs(trunkX - vCx) > 2) {
      pts.push({ x: trunkX, y: entryY }, { x: vCx, y: entryY });
    }
    pts.push({ x: vCx, y: v.y });
    p.pts = pts;
  });

  // 4. 抽取線段並精準偵測「T字分岔 / 匯流點」(僅 3 方向以上相交處才標橘點)
  const segments = [];
  plans.forEach(p => {
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0.5) {
        segments.push({ a, b, edge: p.edge });
      }
    }
  });

  const nodePorts = new Set();
  nodes.forEach(n => {
    nodePorts.add(`${Math.round(n.x + n.width / 2)},${Math.round(n.y)}`);
    nodePorts.add(`${Math.round(n.x + n.width / 2)},${Math.round(n.y + n.height)}`);
    nodePorts.add(`${Math.round(n.x + n.width)},${Math.round(n.y + n.height / 2)}`);
  });

  const candidates = [];
  segments.forEach(s => { [s.a, s.b].forEach(pt => {
    const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
    if (!nodePorts.has(key) && !candidates.some(c => Math.hypot(c.x - pt.x, c.y - pt.y) < 2)) {
      candidates.push({ x: pt.x, y: pt.y });
    }
  }); });

  const junctions = candidates.filter(pt => {
    const dirs = new Set();
    segments.forEach(({ a, b }) => {
      const eps = 2;
      const isH = Math.abs(a.y - b.y) <= eps && Math.abs(pt.y - a.y) <= eps;
      const isV = Math.abs(a.x - b.x) <= eps && Math.abs(pt.x - a.x) <= eps;
      if (isH) {
        const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
        if (pt.x > minX + eps && pt.x <= maxX + eps) dirs.add("L");
        if (pt.x < maxX - eps && pt.x >= minX - eps) dirs.add("R");
      } else if (isV) {
        const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
        if (pt.y > minY + eps && pt.y <= maxY + eps) dirs.add("U");
        if (pt.y < maxY - eps && pt.y >= minY - eps) dirs.add("D");
      }
    });
    return dirs.size >= 3;
  });

  return { plans, segments, junctions };
}
