from anthropic import Anthropic

from .config import settings
from .schema import MusicScore

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
