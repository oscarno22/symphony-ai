import json
import logging
from collections.abc import Generator

from anthropic import Anthropic

from .config import settings
from .schema import MusicScore, Note

log = logging.getLogger(__name__)

_client = Anthropic(api_key=settings.anthropic_api_key)

_TOOL_NAME = "render_music_score"

_SYSTEM_PROMPT = """You are a composer that writes short pieces of music.

When the user describes a piece, call the `render_music_score` tool with a complete score.

Composition guidelines:
- Keep pieces under ~32 beats unless the user asks for longer.
- Use scientific pitch notation: middle C is "C4", the A above is "A4", sharps are "C#4", flats are "Bb4".
- For rests, set pitch to the literal string "rest".
- Notes should be sequential: each note's start_beat should equal the previous note's start_beat plus its duration in beats.
- Stay diatonic to the chosen key unless the prompt suggests chromaticism.
- Pick a tempo and time signature that suit the requested style.
"""


def _tool_definition() -> dict:
    schema = MusicScore.model_json_schema()
    return {
        "name": _TOOL_NAME,
        "description": "Render a complete music score as structured data.",
        "input_schema": schema,
    }


def generate_score(prompt: str) -> MusicScore:
    log.info("generate_score: prompt=%r model=%s", prompt, settings.anthropic_model)
    response = _client.messages.create(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
        tools=[_tool_definition()],
        tool_choice={"type": "tool", "name": _TOOL_NAME},
        messages=[{"role": "user", "content": prompt}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == _TOOL_NAME:
            score = MusicScore.model_validate(block.input)
            log.info("generate_score: done title=%r notes=%d", score.title, len(score.notes))
            return score

    raise RuntimeError("Claude did not call the render_music_score tool.")


def stream_score(prompt: str) -> Generator[tuple[str, dict], None, None]:
    """Yield (event_type, data) tuples as notes arrive from the streaming response.

    Emits one "meta" event (title/tempo/key/time_signature) as soon as the
    notes array starts, then one "note" event per complete Note object.
    """
    pending = ""      # unconsumed portion of the notes-array JSON
    pending_scanned = 0  # how far into pending we've already scanned
    depth = 0         # brace depth inside the current note object
    note_start = -1
    notes_started = False
    full_accumulated = ""
    note_count = 0
    delta_count = 0

    log.info("stream_score: start prompt=%r model=%s", prompt, settings.anthropic_model)

    with _client.messages.stream(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
        tools=[_tool_definition()],
        tool_choice={"type": "tool", "name": _TOOL_NAME},
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        for event in stream:
            if event.type != "content_block_delta":
                continue
            if not hasattr(event.delta, "partial_json"):
                continue

            chunk: str = event.delta.partial_json
            delta_count += 1

            if not notes_started:
                full_accumulated += chunk

                # Find "notes" key then its opening bracket — tolerates any
                # whitespace between the key, colon, and bracket that Claude
                # may insert (e.g. `"notes": [` vs `"notes":[`).
                key_idx = full_accumulated.find('"notes"')
                if key_idx == -1:
                    continue
                bracket_idx = full_accumulated.find('[', key_idx)
                if bracket_idx == -1:
                    continue

                notes_started = True
                # Build a minimal valid JSON object from everything before the
                # notes array so we can extract the metadata fields.
                meta_json = full_accumulated[:key_idx] + '"notes":[]}'
                log.debug("stream_score: meta_json=%r", meta_json)
                try:
                    meta = json.loads(meta_json)
                    log.info(
                        "stream_score: meta title=%r tempo=%s key=%s",
                        meta.get("title"),
                        meta.get("tempo"),
                        meta.get("key_signature"),
                    )
                    yield "meta", {
                        k: meta[k]
                        for k in ("title", "tempo", "time_signature", "key_signature")
                        if k in meta
                    }
                except json.JSONDecodeError as exc:
                    log.warning("stream_score: meta parse failed: %s | raw=%r", exc, meta_json)

                pending = full_accumulated[bracket_idx + 1:]
                pending_scanned = 0
                log.info(
                    "stream_score: notes array opened; pending len=%d first=%r",
                    len(pending), pending[:80],
                )
            else:
                pending += chunk

            # Extract complete Note objects from pending using brace-depth tracking.
            # Only scan bytes we haven't seen yet (pending[pending_scanned:]) so
            # that a { already counted in a previous iteration isn't double-counted.
            changed = True
            while changed:
                changed = False
                for rel_i, ch in enumerate(pending[pending_scanned:]):
                    i = rel_i + pending_scanned
                    if ch == "{":
                        if depth == 0:
                            note_start = i
                        depth += 1
                    elif ch == "}" and depth > 0:
                        depth -= 1
                        if depth == 0 and note_start >= 0:
                            note_json = pending[note_start : i + 1]
                            try:
                                note = Note.model_validate_json(note_json)
                                note_count += 1
                                log.info(
                                    "stream_score: note #%d pitch=%s beat=%s dur=%s",
                                    note_count, note.pitch, note.start_beat, note.duration,
                                )
                                yield "note", note.model_dump()
                            except Exception as exc:
                                log.warning("stream_score: note parse FAILED: %s | raw=%r", exc, note_json)
                            pending = pending[i + 1:]
                            pending_scanned = 0
                            note_start = -1
                            changed = True
                            break
                else:
                    # No complete note found this pass — mark everything scanned.
                    pending_scanned = len(pending)

            # Trim any prefix that precedes the current in-progress note.
            if depth == 0 and note_start == -1:
                pending = ""
                pending_scanned = 0
            elif note_start > 0:
                pending_scanned = max(0, pending_scanned - note_start)
                pending = pending[note_start:]
                note_start = 0

    log.info(
        "stream_score: done deltas=%d notes_emitted=%d pending_leftover=%r",
        delta_count, note_count, pending[:80] if pending else "",
    )
