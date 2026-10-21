"""Verify downloaded artifact contracts. This does not certify perceptual accuracy."""
import argparse
import hashlib
import json
import math
import subprocess
import wave
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory');p.add_argument('--text-file');args=p.parse_args()
root=Path(args.directory)
alignment=json.loads((root/'alignment.json').read_text());metadata=json.loads((root/'metadata.json').read_text());words=json.loads((root/'words.json').read_text())
assert set(alignment)=={'characters','character_start_times_seconds','character_end_times_seconds'}, 'Unexpected alignment shape'
chars,starts,ends=(alignment[k] for k in ['characters','character_start_times_seconds','character_end_times_seconds'])
assert len(chars)>0 and len(chars)==len(starts)==len(ends), 'Alignment lengths differ'
if args.text_file:assert ''.join(chars)==Path(args.text_file).read_text(), 'Original text differs'
with wave.open(str(root/'audio.wav'),'rb') as w:
    assert w.getframerate()==24000 and w.getnchannels()==1 and w.getsampwidth()==2
    duration=w.getnframes()/w.getframerate()
for i,(s,e) in enumerate(zip(starts,ends)):
    assert math.isfinite(s) and math.isfinite(e) and 0<=s<=e<=duration+.001
    if i:assert s>=starts[i-1] and e>=ends[i-1], 'Non-monotonic alignment'
assert abs(metadata['duration_seconds']-duration)<.001
assert all(0<=i<len(chars) for i in metadata['alignment']['derived_character_positions'])
assert metadata['audio_sha256']==hashlib.sha256((root/'audio.opus').read_bytes()).hexdigest()
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_name','-of','json',str(root/'audio.opus')]))
assert probe['streams'][0]['codec_name']=='opus'
assert abs(float(probe['format']['duration'])-duration)<.08
assert words and all(0<=w['start']<=w['end']<=duration+.001 for w in words)
assert '-->' in (root/'subtitles.srt').read_text()
print(json.dumps(dict(contract_validation='passed',characters=len(chars),words=len(words),duration_seconds=duration,segments=len(metadata['segments']),manual_timing_accuracy='not_measured'),indent=2))
