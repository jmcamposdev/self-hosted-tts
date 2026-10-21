import json
import re
import unittest
from pathlib import Path

class PinsConsistencyTests(unittest.TestCase):
    def test_pins_match_dockerfile_and_constants(self):
        root = Path(__file__).resolve().parent.parent
        with open(root / "scripts/pins.json", "r", encoding="utf-8") as f:
            pins = json.load(f)

        engine_commit = pins["engine"]["commit"]

        dockerfile = (root / "Dockerfile").read_text(encoding="utf-8")
        match = re.search(r"ARG QWEN_COMMIT=([0-9a-fA-F]+)", dockerfile)
        self.assertIsNotNone(match, "QWEN_COMMIT not found in Dockerfile")
        self.assertEqual(match.group(1), engine_commit)

        constants = (root / "src/shared/constants/engine.constants.ts").read_text(encoding="utf-8")
        self.assertIn(f'ENGINE_COMMIT = "{engine_commit}"', constants)

        core_py = (root / "alignment_service/config.py").read_text(encoding="utf-8")
        align_rev = pins["models"]["alignment"]["revision"]
        self.assertIn(f"MODEL_REVISION = '{align_rev}'", core_py)

if __name__ == '__main__':
    unittest.main()
