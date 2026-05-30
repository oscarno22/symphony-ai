import json
from collections.abc import Generator

from anthropic import Anthropic

from .config import settings
from .schema import MusicScore, Note

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
            return MusicScore.model_validate(block.input)

    raise RuntimeError("Claude did not call the render_music_score tool.")


def stream_score(prompt: str) -> Generator[tuple[str, dict], None, None]:
    """Yield (event_type, data) tuples as notes arrive from the streaming response.

    Emits one "meta" event (title/tempo/key/time_signature) as soon as the
    notes array starts, then one "note" event per complete Note object.
    """
    pending = ""   # unconsumed portion of the notes-array JSON
    depth = 0      # brace depth inside the current note object
    note_start = -1
    notes_started = False
    full_accumulated = ""

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

            if not notes_started:
                full_accumulated += chunk
                idx = full_accumulated.find('"notes":[')
                if idx == -1:
                    continue

                notes_started = True
                # Everything before "notes":[ is the metadata — close the object
                # by appending the dummy notes array so json.loads can parse it.
                meta_json = full_accumulated[:idx] + '"notes":[]}'
                try:
                    meta = json.loads(meta_json)
                    yield "meta", {
                        k: meta[k]
                        for k in ("title", "tempo", "time_signature", "key_signature")
                        if k in meta
                    }
                except json.JSONDecodeError:
                    pass

                pending = full_accumulated[idx + len('"notes":['):]
            else:
                pending += chunk

            # Extract complete Note objects from pending using brace-depth tracking.
            changed = True
            while changed:
                changed = False
                for i, ch in enumerate(pending):
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
                                yield "note", note.model_dump()
                            except Exception:
                                pass
                            pending = pending[i + 1 :]
                            note_start = -1
                            changed = True
                            break

            # Trim any prefix that precedes the current in-progress note.
            if depth == 0 and note_start == -1:
                pending = ""
            elif note_start > 0:
                pending = pending[note_start:]
                note_start = 0
