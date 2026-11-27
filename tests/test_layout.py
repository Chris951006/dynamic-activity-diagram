import unittest
from src.layout_engine import ActivityLayoutEngine

class TestActivityLayoutEngine(unittest.TestCase):
    def setUp(self):
        self.engine = ActivityLayoutEngine()

    def test_swimlane_ordering(self):
        raw = {
            "lanes": [{"id": "L_A", "order": 0}, {"id": "L_B", "order": 1}, {"id": "L_C", "order": 2}],
            "nodes": [{"id": "N1", "lane": "L_A"}, {"id": "N2", "lane": "L_C"}, {"id": "N3", "lane": "L_B"}],
            "edges": [{"id": "E1", "from": "N1", "to": "N2"}]
        }
        res = self.engine.compute_layout(raw)
        orders = {l["id"]: l["order"] for l in res["lanes"]}
        self.assertEqual(abs(orders["L_A"] - orders["L_C"]), 1)

    def test_layering_and_cycle(self):
        raw = {
            "lanes": [{"id": "L1", "order": 0}],
            "nodes": [{"id": "N1", "lane": "L1"}, {"id": "N2", "lane": "L1"}, {"id": "N3", "lane": "L1"}],
            "edges": [{"id": "E1", "from": "N1", "to": "N2"}, {"id": "E2", "from": "N2", "to": "N1"}, {"id": "E3", "from": "N2", "to": "N3"}]
        }
        res = self.engine.compute_layout(raw)
        ymap = {n["id"]: n["y"] for n in res["nodes"]}
        self.assertLess(ymap["N1"], ymap["N2"])
        self.assertLess(ymap["N2"], ymap["N3"])

if __name__ == "__main__":
    unittest.main()
