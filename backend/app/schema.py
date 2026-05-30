from typing import Literal

from pydantic import BaseModel, Field

NoteDuration = Literal["whole", "half", "quarter", "eighth", "sixteenth"]
TrackRole = Literal["melody", "harmony", "bass"]
TrackInstrument = Literal["synth", "piano", "strings", "bells", "bass_synth"]


class TimeSignature(BaseModel):
    numerator: int = Field(description="Beats per measure (e.g. 4 for 4/4 time).")
    denominator: int = Field(
        description="Note value that gets one beat (e.g. 4 means a quarter note gets the beat)."
    )


class Note(BaseModel):
    pitch: str = Field(
        description='Scientific pitch notation like "C4", "F#5", "Bb3", or the literal string "rest" for silence.'
    )
    duration: NoteDuration = Field(description="Rhythmic value of the note.")
    dotted: bool = Field(
        default=False,
        description="If true, duration is multiplied by 1.5 (a dotted note).",
    )
    start_beat: float = Field(
        description="Onset time in beats from the start of the piece (beat 0 is the first beat).",
        ge=0,
    )


class TrackSpec(BaseModel):
    id: TrackRole = Field(description="Track identifier: melody, harmony, or bass.")
    instrument: TrackInstrument = Field(description="Tone.js instrument timbre for this track.")
    role: str = Field(description="Compositional role, e.g. 'flowing melodic line in upper register'.")
    style_notes: str = Field(description="Specific composition instructions for this track.")


class ArrangementPlan(BaseModel):
    title: str = Field(description="Short descriptive title for the piece.")
    tempo: int = Field(description="Tempo in BPM.", ge=20, le=300)
    time_signature: TimeSignature
    key_signature: str = Field(description='Key, e.g. "C major", "A minor".')
    chord_progression: str = Field(
        description='Explicit chord progression with repetition, e.g. "Am - F - C - G (repeat 4x)".'
    )
    length_bars: int = Field(description="Number of measures.", ge=4, le=32)
    tracks: list[TrackSpec] = Field(description="Exactly 3 tracks: melody, harmony, bass.")


class TrackNotes(BaseModel):
    notes: list[Note] = Field(description="All notes for this track, in order.")


class Track(BaseModel):
    id: str
    instrument: str
    notes: list[Note]


class MultiTrackScore(BaseModel):
    title: str
    tempo: int
    time_signature: TimeSignature
    key_signature: str
    tracks: list[Track]


# Legacy single-track schema kept for the /generate endpoint.
class MusicScore(BaseModel):
    title: str = Field(description="Short descriptive title for the piece.")
    tempo: int = Field(description="Tempo in beats per minute, typically 60-180.", ge=20, le=300)
    time_signature: TimeSignature
    key_signature: str = Field(
        description='Key of the piece, e.g. "C major", "A minor", "F# major".'
    )
    notes: list[Note] = Field(description="Sequence of notes and rests making up the piece.")


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
