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

export type MusicScore = {
  title: string;
  tempo: number;
  time_signature: TimeSignature;
  key_signature: string;
  notes: Note[];
};
