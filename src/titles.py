"""Conservative offline display titles from filenames and series folders."""
import re
from pathlib import PurePosixPath


def clean_name(value):
    value = re.sub(r"^\d{4,}\s+-\s+", "", value)
    value = value.replace('_', ' ')
    # Remove known technical tags, retaining dates and episode numbers.
    value = re.sub(r"(?i)\b(?:480[pi]|576[pi]|720[pi]|1080[pi]|2160[pi]|4k|8k|x26[45]|h[ ._-]?26[45]|hevc|avc|aac(?:[ ._-]?\d[ ._-]?\d)?|ac3|dts|web[ ._-]?dl|webrip|bluray|brrip|dvdrip|hdtv|remux)\b", " ", value)
    value = re.sub(r"[._]+", " ", value)
    value = re.sub(r"[\[\](){}]", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" -")
    return value


def meaningful(value):
    return bool(re.search(r"[^\W\d_]", value, re.UNICODE)) and value.casefold() not in {
        'video', 'videos', 'adverts', 'advert', 'movie', 'movies', 'clip', 'clips',
        'untitled', 'download', 'downloads', 'recording', 'sample', 'test',
    } and not re.fullmatch(r"(?i)(?:video|clip|movie|recording|untitled)[\s-]*\d*", value) and not re.fullmatch(r"(?i)[a-f0-9]{16,}", value)


def title_from_path(relative, original_name=None):
    """Return a useful title or empty string; preserve original letter case."""
    path = PurePosixPath(str(relative).replace('\\', '/'))
    stem = clean_name(PurePosixPath(original_name or path.name).stem)
    episode = re.fullmatch(r"(?i)(?:s(\d{1,2})[ -]*)?e(?:p(?:isode)?)?[ -]*(\d{1,3})", stem)
    number = re.fullmatch(r"\d{1,3}", stem)
    parent = clean_name(path.parent.name)
    season = re.fullmatch(r"(?i)(?:season|s)\s*(\d{1,2})", parent)
    series = clean_name(path.parent.parent.name) if season else parent
    if number or episode:
        if not meaningful(series):
            return ''
        episode_number = int(number[0] if number else episode[2])
        season_number = int(season[1]) if season else int(episode[1]) if episode and episode[1] else None
        label = f'S{season_number:02d}E{episode_number:02d}' if season_number is not None else f'Episode {episode_number:02d}'
        return f'{series} — {label}'[:300]
    if not meaningful(stem):
        return ''
    # Separate an explicit episode marker without changing the title's spelling.
    stem = re.sub(r"(?i)(?:\s*[-–—]\s*|\s+)\b(s\d{1,2}e\d{1,3})\b", lambda m: ' — '+m[1].upper(), stem)
    return stem.strip(' —')[:300]
