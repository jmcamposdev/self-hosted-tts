from typing import List, Tuple, Set, Optional

def compute_derived_timeline(
    text: str,
    starts: List[Optional[float]],
    ends: List[Optional[float]],
    duration: float
) -> Tuple[List[float], List[float], List[int]]:
    """Fill missing character boundaries (spaces, symbols) and ensure monotonic timeline."""
    derived: Set[int] = set()

    for pos in range(len(text)):
        if starts[pos] is None:
            derived.add(pos)
            # Symbols have no independent acoustic event. Anchor to previous acoustic end.
            previous = next((ends[i] for i in range(pos - 1, -1, -1) if ends[i] is not None), None)
            following = next((starts[i] for i in range(pos + 1, len(text)) if starts[i] is not None), 0.0)
            starts[pos] = ends[pos] = previous if previous is not None else following

    final_starts: List[float] = [0.0] * len(text)
    final_ends: List[float] = [0.0] * len(text)

    # CTC word transitions can overlap slightly. Make monotonic while recording derived.
    for pos in range(len(text)):
        curr_start = starts[pos] if starts[pos] is not None else 0.0
        curr_end = ends[pos] if ends[pos] is not None else 0.0

        s = max(float(curr_start), float(final_starts[pos - 1]) if pos else 0.0)
        e = max(s, float(curr_end), float(final_ends[pos - 1]) if pos else 0.0)

        if s != curr_start or e != curr_end:
            derived.add(pos)

        final_starts[pos] = min(duration, s)
        final_ends[pos] = min(duration, e)

    return final_starts, final_ends, sorted(derived)
