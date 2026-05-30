export type NoteDuration =
  | "whole"
  | "half"
  | "quarter"
  | "eighth"
  | "sixteenth";

export type Note = {
  pitch: string;
  duration: NoteDuration;
  dotted?: boolean;
  start_beat: number;
};

export type TimeSignature = {
  numerator: number;
  denominator: number;
};

export type TrackId = "melody" | "harmony" | "bass";
export type TrackInstrument = "synth" | "piano" | "strings" | "bells" | "bass_synth";

export type Track = {
  id: TrackId;
  instrument: TrackInstrument;
  notes: Note[];
};

export type MultiTrackScore = {
  title: string;
  tempo: number;
  time_signature: TimeSignature;
  key_signature: string;
  tracks: Track[];
};
