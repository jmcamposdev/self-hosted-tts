import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from .normalize import normalize
from .schemas import TextRequest, AlignRequest, NormalizeResponse, AlignResponse

aligner = None
lock = threading.Lock()
root = Path(os.environ.get('DATA_DIR', 'storage')).resolve()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global aligner
    from .core import Aligner
    aligner = Aligner()
    yield


app = FastAPI(title='Internal Spanish alignment', lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get('/health')
def health():
    if aligner is None:
        raise HTTPException(503, 'Alignment model not loaded')
    return dict(status='ready')


@app.post('/normalize', response_model=NormalizeResponse)
def normalize_request(request: TextRequest):
    try:
        return normalize(request.text)
    except (ValueError, OverflowError, NotImplementedError):
        raise HTTPException(422, 'Cannot normalize number/date; write it as spoken Spanish')


@app.post('/align', response_model=AlignResponse)
def align_request(request: AlignRequest):
    path = Path(request.path).resolve()
    if not path.is_relative_to(root / 'jobs') or not path.is_file() or path.suffix != '.wav':
        raise HTTPException(422, 'Audio must be a managed local job WAV')
    if aligner is None:
        raise HTTPException(503, 'Alignment model not ready')
    try:
        with lock:
            return aligner.align(path, request.text)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception:
        raise HTTPException(500, 'Alignment inference failed')
