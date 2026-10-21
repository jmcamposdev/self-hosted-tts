from typing import List, Literal
from pydantic import BaseModel, Field

class TextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=30000)

class AlignRequest(BaseModel):
    path: str
    text: str = Field(min_length=1, max_length=1500)

class SourceMapping(BaseModel):
    source_start: int
    source_end: int
    spoken_start: int
    spoken_end: int
    kind: Literal['identity', 'expanded']

class NormalizeResponse(BaseModel):
    original_text: str
    spoken_text: str
    mappings: List[SourceMapping]

class AlignmentTimeline(BaseModel):
    characters: List[str]
    character_start_times_seconds: List[float]
    character_end_times_seconds: List[float]

class AlignedWord(BaseModel):
    word: str
    start: float
    end: float
    score: float

class AlignResponse(BaseModel):
    alignment: AlignmentTimeline
    words: List[AlignedWord]
    derived_positions: List[int]
    duration_seconds: float
    method: str
    model_revision: str
    frame_seconds: float
    mean_word_confidence: float
