import math
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np
import torch
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
from ctc_segmentation import (
    CtcSegmentationParameters,
    prepare_token_list,
    ctc_segmentation,
    determine_utterance_segments,
)
from .config import (
    MODEL_ID,
    MODEL_REVISION,
    MIN_DURATION_SECONDS,
    MAX_DURATION_SECONDS,
    MIN_WORD_CONFIDENCE,
    MIN_MEAN_CONFIDENCE,
    SAMPLE_RATE,
)
from .timeline import compute_derived_timeline


def prepare_words(config, tokens, delimiter_id):
    # The acoustic model emits an explicit | between words. prepare_token_list
    # inserts CTC blanks between utterances, but a blank is NOT the word delimiter.
    # Keep both: omit only the final delimiter, for which no next word exists.
    with_delimiters = [
        np.concatenate((ids, [delimiter_id])) if i < len(tokens) - 1 else ids
        for i, ids in enumerate(tokens)
    ]
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

    def align(self, path: Path, text: str) -> Dict[str, Any]:
        # FFmpeg accepts only a local file managed by our worker, never a URL.
        raw = subprocess.run(
            [
                'ffmpeg',
                '-v',
                'error',
                '-nostdin',
                '-i',
                str(path),
                '-ac',
                '1',
                '-ar',
                str(SAMPLE_RATE),
                '-f',
                's16le',
                'pipe:1',
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=120,
            check=True,
        ).stdout
        audio = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
        duration = len(audio) / float(SAMPLE_RATE)
        if not (MIN_DURATION_SECONDS <= duration <= MAX_DURATION_SECONDS):
            raise ValueError(
                f'Alignment segments must contain between {MIN_DURATION_SECONDS} and {MAX_DURATION_SECONDS} seconds of audio'
            )

        tokens: List[np.ndarray] = []
        token_positions: List[List[int]] = []
        texts: List[str] = []

        for match in re.finditer(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+", text):
            ids, positions = [], []
            for pos in range(match.start(), match.end()):
                c = text[pos]
                token = c.upper() if c.upper() in self.vocab else c.lower()
                if token not in self.vocab:
                    raise ValueError('Unsupported character in Spanish alignment')
                ids.append(self.vocab[token])
                positions.append(pos)
            tokens.append(np.asarray(ids, dtype=np.int64))
            token_positions.append(positions)
            texts.append(match.group())

        if not tokens:
            raise ValueError('No alignable Spanish words')

        inputs = self.processor(audio, sampling_rate=SAMPLE_RATE, return_tensors='pt')
        with torch.inference_mode():
            logits = self.model(**inputs).logits[0]
            log_probs = torch.log_softmax(logits, dim=-1).numpy().astype(np.float64)

        config = CtcSegmentationParameters(
            char_list=[self.inverse_vocab[i] for i in range(len(self.vocab))]
        )
        config.blank = self.processor.tokenizer.pad_token_id
        config.index_duration = duration / len(log_probs)
        config.min_window_size = 8000
        ground, begins = prepare_words(
            config, tokens, self.vocab[self.processor.tokenizer.word_delimiter_token]
        )
        timings, probs, _ = ctc_segmentation(config, log_probs, ground)
        spans = determine_utterance_segments(config, begins, probs, timings, texts)

        starts: List[Optional[float]] = [None] * len(text)
        ends: List[Optional[float]] = [None] * len(text)
        words: List[Dict[str, Any]] = []
        frame = config.index_duration

        for word_index, ((start, end, score), positions) in enumerate(
            zip(spans, token_positions)
        ):
            s_word, e_word = max(0.0, float(start)), min(duration, float(end))
            confidence = math.exp(max(-100.0, min(0.0, float(score))))
            if e_word <= s_word or confidence < MIN_WORD_CONFIDENCE:
                raise ValueError(
                    f'Word {word_index+1} has an unreliable interval (confidence={confidence:.6f})'
                )
            words.append(
                dict(word=texts[word_index], start=s_word, end=e_word, score=confidence)
            )
            for offset, pos in enumerate(positions):
                token_idx = begins[word_index] + 1 + offset
                s = max(s_word, float(timings[token_idx - 1]))
                e = max(s, min(e_word, float(timings[token_idx])))
                starts[pos], ends[pos] = min(duration, s), min(duration, e)

        mean_confidence = sum(w['score'] for w in words) / len(words)
        if mean_confidence < MIN_MEAN_CONFIDENCE:
            raise ValueError('Alignment mean confidence too low')

        final_starts, final_ends, derived_positions = compute_derived_timeline(
            text, starts, ends, duration
        )

        return dict(
            alignment=dict(
                characters=list(text),
                character_start_times_seconds=final_starts,
                character_end_times_seconds=final_ends,
            ),
            words=words,
            derived_positions=derived_positions,
            duration_seconds=duration,
            method='wav2vec2-es-ctc',
            model_revision=MODEL_REVISION,
            frame_seconds=frame,
            mean_word_confidence=mean_confidence,
        )
