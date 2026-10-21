FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY alignment_service/requirements.lock.txt ./requirements.lock.txt
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY alignment_service ./alignment_service
COPY scripts/download-align-model.py ./scripts/download-align-model.py
RUN useradd --uid 1000 --create-home tts
USER tts
ENV DATA_DIR=/data ALIGN_MODEL_DIR=/models/alignment HF_HUB_OFFLINE=1 HF_HOME=/tmp/huggingface TORCH_HOME=/tmp/torch OMP_NUM_THREADS=4
CMD ["python", "-m", "uvicorn", "alignment_service.app:app", "--host", "0.0.0.0", "--port", "8081", "--workers", "1", "--no-access-log"]
