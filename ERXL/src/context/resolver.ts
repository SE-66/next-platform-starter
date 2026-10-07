import {
  CONTEXT_LEXICON,
  NEAR_HOMOPHONES
} from "./lexicon";
import type {
  ContextCandidate,
  ContextResolution
} from "./types";

const CONTEXT_HINTS: Record<string, string[]> = {
  jawze_husband: ["husband", "wife", "married", "home", "came", "said", "person"],
  jawze_walnut: ["eat", "food", "nut", "nuts", "baklava", "tree", "kilo"],
  saboune_soap: ["wash", "clean", "bath", "shower", "water", "hands"],
  saboune_hit_me: ["hit", "fight", "attack", "hurt", "people"],
  se3a_watch: ["wear", "wrist", "clock", "wall"],
  se3a_time: ["after", "before", "hour", "hours", "o'clock", "time"],
  shmel_left: ["right", "turn", "side", "direction"],
  shmel_north: ["south", "map", "country", "region", "geography"],
  mrashah_candidate: ["election", "vote", "party", "candidate"],
  mrashah_cold: ["sick", "cold", "cough", "fever"],
  "3arous_bride": ["wedding", "groom", "marriage", "dress"],
  "3arous_sandwich": ["eat", "food", "bread", "sandwich"],
  anene_selfish: ["selfish", "person", "behavior"],
  anene_bottles: ["bottle", "bottles", "water", "glass"],
  onsah_gain_weight: ["weight", "food", "diet", "body"],
  onsah_advise: ["advice", "recommend", "tell", "suggest"],
  sette_grandmother: ["grandmother", "family", "mother", "home"],
  sette_six: ["number", "count", "five", "seven"],
  od3af_lose_weight: ["weight", "diet", "kg", "kilo"],
  od3af_weaker: ["weak", "strength", "power", "sick"],
  rouhe_leave: ["go", "leave", "home", "now"],
  rouhe_soul: ["soul", "love", "heart", "dear"]
};

export function normalizeArabiziToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function contextWords(context: string): Set<string> {
  return new Set(
    context
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter(Boolean)
  );
}

function scoreMeaning(id: string, words: Set<string>): number {
  const hints = CONTEXT_HINTS[id] || [];
  let score = 1;
  for (const hint of hints) {
    if (words.has(hint)) score += 2;
  }
  return score;
}

export function resolveArabiziToken(
  token: string,
  context = ""
): ContextResolution {
  const normalizedToken = normalizeArabiziToken(token);
  const words = contextWords(context);

  const candidates: ContextCandidate[] = [];

  for (const entry of CONTEXT_LEXICON) {
    const matchingForm = entry.forms.find(
      form => normalizeArabiziToken(form) === normalizedToken
    );
    if (!matchingForm) continue;

    for (const meaning of entry.meanings) {
      candidates.push({
        entryKey: entry.key,
        form: matchingForm,
        meaning: meaning.meaning,
        score: scoreMeaning(meaning.id, words),
        kind: entry.kind
      });
    }
  }

  for (const pair of NEAR_HOMOPHONES) {
    if (normalizeArabiziToken(pair.wordA) === normalizedToken) {
      candidates.push({
        entryKey: pair.key,
        form: pair.wordA,
        meaning: pair.meaningA,
        score: 1,
        kind: "near_homophone"
      });
    }
    if (normalizeArabiziToken(pair.wordB) === normalizedToken) {
      candidates.push({
        entryKey: pair.key,
        form: pair.wordB,
        meaning: pair.meaningB,
        score: 1,
        kind: "near_homophone"
      });
    }
  }

  const alternatives = candidates.sort(
    (a, b) => b.score - a.score || a.meaning.localeCompare(b.meaning)
  );
  const selected =
    alternatives.length > 0 &&
    (alternatives.length === 1 || alternatives[0].score > alternatives[1].score)
      ? alternatives[0]
      : undefined;

  return {
    token,
    normalizedToken,
    selected,
    alternatives,
    ambiguous: alternatives.length > 1 && !selected
  };
}
