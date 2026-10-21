"""Compare word timings against independently annotated onset/end references."""
import argparse
import json
import math
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--words',required=True);p.add_argument('--reference',required=True);args=p.parse_args()
words=json.loads(Path(args.words).read_text());references=json.loads(Path(args.reference).read_text())
if len(references)<50:raise SystemExit('Provide at least 50 annotated words (100 onset/end markers)')
errors=[]
for ref in references:
    word=words[ref['word_index']]
    if word['word']!=ref['word']:raise SystemExit('Reference word does not match the output at that index')
    errors.extend([abs(word['start']-ref['start']),abs(word['end']-ref['end'])])
errors.sort();p95=errors[max(0,math.ceil(.95*len(errors))-1)]
print(json.dumps(dict(markers=len(errors),p95_error_ms=p95*1000,max_error_ms=max(errors)*1000,passes_200ms=p95<.2),indent=2))
raise SystemExit(0 if p95<.2 else 1)
