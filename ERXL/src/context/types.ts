export type AmbiguityKind =
  | "same_spelling"
  | "near_homophone"
  | "multiple_meanings";

export interface ContextMeaning {
  id: string;
  meaning: string;
  tags?: string[];
}

export interface ContextLexiconEntry {
  key: string;
  forms: string[];
  kind: AmbiguityKind;
  meanings: ContextMeaning[];
}

export interface NearHomophonePair {
  key: string;
  wordA: string;
  meaningA: string;
  wordB: string;
  meaningB: string;
}

export interface ContextCandidate {
  entryKey: string;
  form: string;
  meaning: string;
  score: number;
  kind: AmbiguityKind;
}

export interface ContextResolution {
  token: string;
  normalizedToken: string;
  selected?: ContextCandidate;
  alternatives: ContextCandidate[];
  ambiguous: boolean;
};
