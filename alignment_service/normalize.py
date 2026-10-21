import datetime
import re
from num2words import num2words

PATTERN = re.compile(r"\b\d{1,2}/\d{1,2}/\d{4}\b|\b\d+(?:[.,]\d+)?\b")
MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']


def normalize(text):
    """Expand supported numbers/dates and retain original Unicode code point offsets."""
    pieces, mappings = [], []
    source_cursor = spoken_cursor = 0
    for match in PATTERN.finditer(text):
        raw = match.group()
        prefix = text[source_cursor:match.start()]
        pieces.append(prefix)
        mappings.append(dict(source_start=source_cursor, source_end=match.start(), spoken_start=spoken_cursor, spoken_end=spoken_cursor+len(prefix), kind='identity'))
        spoken_cursor += len(prefix)
        if '/' in raw:
            day, month, year = map(int, raw.split('/'))
            datetime.date(year, month, day)
            spoken = f"{num2words(day, lang='es')} de {MONTHS[month-1]} de {num2words(year, lang='es')}"
        elif '.' in raw or ',' in raw:
            integer, fractional = re.split(r'[.,]', raw)
            spoken = num2words(int(integer), lang='es') + ' coma ' + ' '.join(num2words(int(n), lang='es') for n in fractional)
        else:
            if len(raw) > 15:
                raise ValueError('Numbers longer than 15 digits must be written as words')
            spoken = num2words(int(raw), lang='es')
        pieces.append(spoken)
        mappings.append(dict(source_start=match.start(), source_end=match.end(), spoken_start=spoken_cursor, spoken_end=spoken_cursor+len(spoken), kind='expanded'))
        spoken_cursor += len(spoken)
        source_cursor = match.end()
    suffix = text[source_cursor:]
    pieces.append(suffix)
    mappings.append(dict(source_start=source_cursor, source_end=len(text), spoken_start=spoken_cursor, spoken_end=spoken_cursor+len(suffix), kind='identity'))
    return dict(original_text=text, spoken_text=''.join(pieces), mappings=[m for m in mappings if m['source_end']>m['source_start']])
