# Decisions & Dependencies

## Engine & Voice Switching

The C engine from [gabriele-mastrapasqua/qwen3-tts](https://github.com/gabriele-mastrapasqua/qwen3-tts/tree/ef339be58a778b062e1c14382347964552eae007) is used directly without modifying upstream code. The worker invokes the CLI with a profile chosen by internal ID. The API does not accept arbitrary file paths, model weights, or system commands.

Qwen distinguishes Base (speaker extraction) from CustomVoice (synthesis). 0.6B profiles are never mixed with 1.7B. A 1.7B `.qvoice` profile is created without ICL transcription and without swapping model weights. Speed is applied via WSOLA. External `.qvoice` uploads are not accepted in v1.

## Alignment

The synthesis engine does not emit alignment data. Forced alignment is implemented using Wav2Vec2 Spanish, PyTorch CPU, and CTC segmentation against known normalized text. Numbers and dates are expanded prior to synthesis so that spoken speech and alignment targets match, then mapped back onto the original text.

WhisperX is intentionally avoided to eliminate unnecessary ASR, diarization, and bloated dependencies. We do not use `torchaudio.functional.forced_align` (deprecated in 2.8, removed in 2.9). NumPy is pinned to 1.26.4 because the `ctc-segmentation` 1.7.4 extension was built against the NumPy 1 ABI and fails with NumPy 2.

The minimum mean chunk confidence threshold is 0.1, and each word must exceed 0.005 with a positive duration interval. These are failure boundaries rather than precision guarantees; they are not artificially relaxed.

## Compatibility

The service outputs the standard 3-array character-level JSON format expected by ElevenLabs consumers. The public routes and asynchronous job lifecycle are custom. We do not claim full parity with the proprietary ElevenLabs SDK or streaming endpoints.

## Licenses & Provenance

| Component              | License / Source                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application code       | MIT, see `LICENSE`.                                                                                                                                      |
| C Engine               | [MIT](https://github.com/gabriele-mastrapasqua/qwen3-tts/blob/ef339be58a778b062e1c14382347964552eae007/LICENSE); bundled into worker image.              |
| Qwen3-TTS 1.7B Weights | [Apache-2.0, Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) and [CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice). |
| Wav2Vec2 Spanish       | [Apache-2.0](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-spanish).                                                                      |
| CTC segmentation 1.7.4 | [Apache-2.0](https://github.com/lumaku/ctc-segmentation/blob/master/LICENSE).                                                                            |
| Transformers           | Apache-2.0.                                                                                                                                              |
| PyTorch                | BSD-3-Clause.                                                                                                                                            |
| num2words              | LGPL-2.1.                                                                                                                                                |
| System FFmpeg          | Distribution packages governed by system LGPL/GPL terms.                                                                                                 |

Pinned revisions (managed in `scripts/pins.json`):

- Engine commit: `ef339be58a778b062e1c14382347964552eae007`
- Base model: `fd4b254389122332181a7c3db7f27e918eec64e3`
- CustomVoice model: `0c0e3051f131929182e2c023b9537f8b1c68adfe`
- Spanish aligner: `96d7e9b4e4a78af515a3c6d3cee7c0826045d276`
