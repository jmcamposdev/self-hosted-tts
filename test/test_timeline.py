import unittest
from alignment_service.timeline import compute_derived_timeline

class TimelineTests(unittest.TestCase):
    def test_derived_timeline_handles_missing_anchors_and_monotonicity(self):
        text = "A B"
        # Character 0 ('A'): 0.0 -> 0.4
        # Character 1 (' '): None -> None
        # Character 2 ('B'): 0.35 -> 0.8 (note overlap with 'A')
        starts = [0.0, None, 0.35]
        ends = [0.4, None, 0.8]
        duration = 1.0

        final_starts, final_ends, derived = compute_derived_timeline(text, starts, ends, duration)

        self.assertEqual(len(final_starts), 3)
        self.assertEqual(len(final_ends), 3)
        self.assertIn(1, derived) # Space is derived
        # Check monotonic
        self.assertTrue(final_starts[0] <= final_starts[1] <= final_starts[2])
        self.assertTrue(final_ends[0] <= final_ends[1] <= final_ends[2])
        self.assertTrue(all(s <= e for s, e in zip(final_starts, final_ends)))

if __name__ == '__main__':
    unittest.main()
