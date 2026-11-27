from collections import defaultdict, deque
from copy import deepcopy

class ActivityLayoutEngine:
    def __init__(self, node_width=120, node_height=50, layer_gap=90, node_gap=40, lane_padding=40, header_height=50):
        self.node_width = node_width
        self.node_height = node_height
        self.layer_gap = layer_gap
        self.node_gap = node_gap
        self.lane_padding = lane_padding
        self.header_height = header_height

    def compute_layout(self, graph_data):
        data = deepcopy(graph_data)
        lanes = data.get("lanes", [])
        nodes = data.get("nodes", [])
        edges = data.get("edges", [])
        if not nodes:
            return data
        node_map = {n["id"]: n for n in nodes}
        if not lanes:
            lanes = [{"id": "default", "name": "Default", "order": 0}]
            for n in nodes:
                n["lane"] = "default"
            data["lanes"] = lanes

        ordered_lanes = self._optimize_lane_order(lanes, nodes, edges)
        for idx, lane in enumerate(ordered_lanes):
            lane["order"] = idx
        data["lanes"] = ordered_lanes
        lane_rank = {l["id"]: l["order"] for l in ordered_lanes}

        dag_edges, back_edge_ids = self._break_cycles(nodes, edges)
        layers = self._assign_layers(nodes, dag_edges)
        layered_nodes = self._order_nodes_in_layers(nodes, layers, lane_rank)
        self._assign_coordinates(ordered_lanes, layered_nodes)
        self._route_edges(edges, node_map, back_edge_ids)
        return data

    def _optimize_lane_order(self, lanes, nodes, edges):
        if len(lanes) <= 2:
            return lanes
        node_lane = {n["id"]: n.get("lane", lanes[0]["id"]) for n in nodes}
        weights = defaultdict(int)
        for e in edges:
            u_l, v_l = node_lane.get(e["from"]), node_lane.get(e["to"])
            if u_l and v_l and u_l != v_l:
                weights[tuple(sorted((u_l, v_l)))] += 1
        lane_map = {l["id"]: l for l in lanes}
        if not weights:
            return lanes
        best_pair = max(weights.items(), key=lambda x: x[1])[0]
        ordered_ids = [best_pair[0], best_pair[1]]
        remaining = set(lane_map.keys()) - set(ordered_ids)
        while remaining:
            left_end, right_end = ordered_ids[0], ordered_ids[-1]
            best_c, best_s, put_left = None, -1, False
            for cand in remaining:
                sL = weights.get(tuple(sorted((cand, left_end))), 0)
                sR = weights.get(tuple(sorted((cand, right_end))), 0)
                if sL > best_s: best_s, best_c, put_left = sL, cand, True
                if sR > best_s: best_s, best_c, put_left = sR, cand, False
            if best_c is None: best_c = next(iter(remaining))
            ordered_ids.insert(0, best_c) if put_left else ordered_ids.append(best_c)
            remaining.remove(best_c)
        return [lane_map[lid] for lid in ordered_ids]

    def _break_cycles(self, nodes, edges):
        adj = defaultdict(list)
        for e in edges: adj[e["from"]].append(e)
        visited, rec, back = set(), set(), set()
        def dfs(u):
            visited.add(u); rec.add(u)
            for e in adj[u]:
                v = e["to"]
                if v not in visited: dfs(v)
                elif v in rec: back.add(e["id"])
            rec.remove(u)
        for n in nodes:
            if n["id"] not in visited: dfs(n["id"])
        dag = [{"id": e["id"], "from": e["to"], "to": e["from"]} if e["id"] in back else e for e in edges]
        return dag, back

    def _assign_layers(self, nodes, dag_edges):
        in_deg = {n["id"]: 0 for n in nodes}
        adj = defaultdict(list)
        for e in dag_edges:
            if e["from"] != e["to"]:
                adj[e["from"]].append(e["to"])
                in_deg[e["to"]] = in_deg.get(e["to"], 0) + 1
        layers = {n["id"]: 0 for n in nodes}
        q = deque([nid for nid, d in in_deg.items() if d == 0])
        while q:
            u = q.popleft()
            for v in adj[u]:
                layers[v] = max(layers[v], layers[u] + 1)
                in_deg[v] -= 1
                if in_deg[v] == 0: q.append(v)
        return layers

    def _order_nodes_in_layers(self, nodes, layers, lane_rank):
        max_l = max(layers.values()) if layers else 0
        layered = [[] for _ in range(max_l + 1)]
        for n in nodes: layered[layers[n["id"]]].append(n)
        for layer in layered: layer.sort(key=lambda n: lane_rank.get(n.get("lane"), 0))
        return layered

    def _assign_coordinates(self, ordered_lanes, layered_nodes):
        max_per = {l["id"]: 1 for l in ordered_lanes}
        for layer in layered_nodes:
            cnt = defaultdict(int)
            for n in layer: cnt[n.get("lane")] += 1
            for lid, c in cnt.items():
                if lid in max_per: max_per[lid] = max(max_per[lid], c)
        lane_x, cur_x = {}, 20
        for lane in ordered_lanes:
            lid = lane["id"]
            slots = max_per[lid]
            w = slots * self.node_width + (slots - 1) * self.node_gap + 2 * self.lane_padding
            lane["width"], lane["x"], lane_x[lid] = w, cur_x, cur_x
            cur_x += w
        for l_idx, layer in enumerate(layered_nodes):
            y = self.header_height + 30 + l_idx * (self.node_height + self.layer_gap)
            by_lane = defaultdict(list)
            for n in layer: by_lane[n.get("lane")].append(n)
            for lid, l_nodes in by_lane.items():
                bx = lane_x.get(lid, 20) + self.lane_padding
                for idx, n in enumerate(l_nodes):
                    n["x"] = bx + idx * (self.node_width + self.node_gap)
                    n["y"], n["width"], n["height"] = y, self.node_width, self.node_height

    def _route_edges(self, edges, node_map, back_edge_ids):
        for e in edges:
            u, v = node_map.get(e["from"]), node_map.get(e["to"])
            if not u or not v: e["waypoints"] = []; continue
            ucx, ucy = u["x"] + u["width"] / 2, u["y"] + u["height"] / 2
            vcx, vcy = v["x"] + v["width"] / 2, v["y"] + v["height"] / 2
            if e["id"] in back_edge_ids:
                ox = max(u["x"] + u["width"], v["x"] + v["width"]) + 35
                e["waypoints"] = [{"x": ox, "y": ucy}, {"x": ox, "y": vcy}]
            elif abs(ucx - vcx) > 5 and abs(u["y"] - v["y"]) > 5:
                my = (u["y"] + u["height"] + v["y"]) / 2
                e["waypoints"] = [{"x": ucx, "y": my}, {"x": vcx, "y": my}]
            else: e["waypoints"] = []
