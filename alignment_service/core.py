import math
import os
import re
import subprocess
import wave
from pathlib import Path
import numpy as np
import torch
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
from ctc_segmentation import CtcSegmentationParameters, prepare_token_list, ctc_segmentation, determine_utterance_segments

MODEL_ID = 'jonatasgrosman/wav2vec2-large-xlsr-53-spanish'
MODEL_REVISION = '96d7e9b4e4a78af515a3c6d3cee7c0826045d276'


def prepare_words(config, tokens, delimiter_id):
    # The acoustic model emits an explicit | between words. prepare_token_list
    # inserts CTC blanks between utterances, but a blank is NOT the word delimiter.
    # Keep both: omit only the final delimiter, for which no next word exists.
    with_delimiters = [np.concatenate((ids, [delimiter_id])) if i < len(tokens)-1 else ids for i, ids in enumerate(tokens)]
    return prepare_token_list(config, with_delimiters)


class Aligner:
    def __init__(self):
        torch.set_num_threads(int(os.environ.get('ALIGN_THREADS', '4')))
        model_path = os.environ.get('ALIGN_MODEL_DIR', MODEL_ID)
        kwargs = dict(local_files_only=True)
        if model_path == MODEL_ID:
            kwargs['revision'] = MODEL_REVISION
        self.processor = Wav2Vec2Processor.from_pretrained(model_path, **kwargs)
        self.model = Wav2Vec2ForCTC.from_pretrained(model_path, **kwargs).cpu().eval()
        self.vocab = self.processor.tokenizer.get_vocab()
        self.inverse_vocab = {i: c for c, i in self.vocab.items()}

    def align(self, path, text):
        # FFmpeg accepts only a local file managed by our worker, never a URL.
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path), '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=120, check=True).stdout
        audio = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.
        duration = len(audio)/16000
        if not .1 <= duration <= 96:
            raise ValueError('Alignment segments must contain between 0.1 and 96 seconds of audio')
        tokens, token_positions, texts = [], [], []
        for match in re.finditer(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+", text):
            ids, positions = [], []
            for pos in range(match.start(), match.end()):
                c = text[pos]
                token = c.upper() if c.upper() in self.vocab else c.lower()
                if token not in self.vocab:
                    raise ValueError('Unsupported character in Spanish alignment')
                ids.append(self.vocab[token]); positions.append(pos)
            tokens.append(np.asarray(ids, dtype=np.int64)); token_positions.append(positions); texts.append(match.group())
        if not tokens:
            raise ValueError('No alignable Spanish words')
        inputs = self.processor(audio, sampling_rate=16000, return_tensors='pt')
        with torch.inference_mode():
            logits = self.model(**inputs).logits[0]
            log_probs = torch.log_softmax(logits, dim=-1).numpy().astype(np.float64)
        config = CtcSegmentationParameters(char_list=[self.inverse_vocab[i] for i in range(len(self.vocab))])
        config.blank = self.processor.tokenizer.pad_token_id
        config.index_duration = duration / len(log_probs)
        config.min_window_size = 8000
        ground, begins = prepare_words(config, tokens, self.vocab[self.processor.tokenizer.word_delimiter_token])
        timings, probs, states = ctc_segmentation(config, log_probs, ground)
        spans = determine_utterance_segments(config, begins, probs, timings, texts)
        starts, ends = [None]*len(text), [None]*len(text)
        words = []
        frame = config.index_duration
        for word_index, ((start, end, score), positions) in enumerate(zip(spans, token_positions)):
            start, end = max(0., float(start)), min(duration, float(end))
            confidence = math.exp(max(-100., min(0., float(score))))
            if end <= start or confidence < .005:
                raise ValueError(f'Word {word_index+1} has an unreliable interval (confidence={confidence:.6f})')
            words.append(dict(word=texts[word_index], start=start, end=end, score=confidence))
            for offset, pos in enumerate(positions):
                token_idx = begins[word_index] + 1 + offset
                s = max(start, float(timings[token_idx-1]))
                e = max(s, min(end, float(timings[token_idx])))
                starts[pos], ends[pos] = min(duration,s), min(duration,e)
        if sum(w['score'] for w in words)/len(words) < .1:
            raise ValueError('Alignment mean confidence too low')
        derived = []
        for pos in range(len(text)):
            if starts[pos] is None:
                derived.append(pos)
                # Symbols have no independent acoustic event. Anchor to the previous
                # acoustic end (or the first onset for leading punctuation/space).
                previous = next((ends[i] for i in range(pos-1, -1, -1) if ends[i] is not None), None)
                following = next((starts[i] for i in range(pos+1, len(text)) if starts[i] is not None), 0.)
                starts[pos] = ends[pos] = previous if previous is not None else following
        # CTC word transitions can overlap slightly. Make the public character
        # timeline monotonic while recording which positions needed projection.
        for pos in range(len(text)):
            s = max(float(starts[pos]), float(starts[pos-1]) if pos else 0.)
            e = max(s, float(ends[pos]), float(ends[pos-1]) if pos else 0.)
            if s != starts[pos] or e != ends[pos]:
                derived.append(pos)
            starts[pos], ends[pos] = min(duration,s), min(duration,e)
        return dict(alignment=dict(characters=list(text), character_start_times_seconds=starts, character_end_times_seconds=ends), words=words, derived_positions=sorted(set(derived)), duration_seconds=duration, method='wav2vec2-es-ctc', model_revision=MODEL_REVISION, frame_seconds=frame, mean_word_confidence=sum(w['score'] for w in words)/len(words))
