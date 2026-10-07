import type {
  ContextLexiconEntry,
  NearHomophonePair
} from "./types";

export const SAME_SPELLING: ContextLexiconEntry[] = [
  { key: "jawze", forms: ["jawze"], kind: "same_spelling", meanings: [
    { id: "jawze_husband", meaning: "my husband", tags: ["person", "family", "relationship"] },
    { id: "jawze_walnut", meaning: "a walnut", tags: ["food", "nut"] }
  ]},
  { key: "saboune", forms: ["saboune"], kind: "same_spelling", meanings: [
    { id: "saboune_soap", meaning: "soap", tags: ["hygiene", "object"] },
    { id: "saboune_hit_me", meaning: "they hit me", tags: ["action", "violence"] }
  ]},
  { key: "se3a", forms: ["se3a"], kind: "same_spelling", meanings: [
    { id: "se3a_watch", meaning: "a watch / clock", tags: ["object", "timepiece"] },
    { id: "se3a_time", meaning: "time / an hour", tags: ["time", "duration"] }
  ]},
  { key: "shmel", forms: ["shmel"], kind: "same_spelling", meanings: [
    { id: "shmel_left", meaning: "left", tags: ["direction"] },
    { id: "shmel_north", meaning: "north", tags: ["direction", "geography"] }
  ]},
  { key: "mrashah", forms: ["mrashah"], kind: "same_spelling", meanings: [
    { id: "mrashah_candidate", meaning: "candidate", tags: ["person", "election"] },
    { id: "mrashah_cold", meaning: "having a cold", tags: ["health"] }
  ]},
  { key: "3arous", forms: ["3arous"], kind: "same_spelling", meanings: [
    { id: "3arous_bride", meaning: "bride", tags: ["person", "wedding"] },
    { id: "3arous_sandwich", meaning: "sandwich", tags: ["food"] }
  ]},
  { key: "anene", forms: ["anene"], kind: "same_spelling", meanings: [
    { id: "anene_selfish", meaning: "selfish", tags: ["personality"] },
    { id: "anene_bottles", meaning: "bottles", tags: ["object", "container"] }
  ]},
  { key: "onsah", forms: ["onsah"], kind: "same_spelling", meanings: [
    { id: "onsah_gain_weight", meaning: "to gain weight", tags: ["health", "body"] },
    { id: "onsah_advise", meaning: "to advise", tags: ["communication", "advice"] }
  ]},
  { key: "sette", forms: ["sette"], kind: "same_spelling", meanings: [
    { id: "sette_grandmother", meaning: "my grandmother", tags: ["person", "family"] },
    { id: "sette_six", meaning: "six", tags: ["number"] }
  ]},
  { key: "od3af", forms: ["od3af"], kind: "same_spelling", meanings: [
    { id: "od3af_lose_weight", meaning: "to lose weight", tags: ["health", "body"] },
    { id: "od3af_weaker", meaning: "to become weaker", tags: ["condition", "strength"] }
  ]},
  { key: "rouhe", forms: ["rouhe"], kind: "same_spelling", meanings: [
    { id: "rouhe_leave", meaning: "leave / go", tags: ["movement", "command"] },
    { id: "rouhe_soul", meaning: "my soul", tags: ["affection", "spiritual"] }
  ]}
];

export const NEAR_HOMOPHONES: NearHomophonePair[] = [
  { key: "kassir_ksir", wordA: "kassir", meaningA: "breaking", wordB: "ksir", meaningB: "short" },
  { key: "2mar_dual", wordA: "2mar", meaningA: "moon", wordB: "2mar", meaningB: "gambling" },
  { key: "soof_shoof", wordA: "soof", meaningA: "wool", wordB: "shoof", meaningB: "look / see" },
  { key: "nissvein_nisvein", wordA: "nissvein", meaningA: "women", wordB: "nisvein", meaningB: "in-laws" },
  { key: "3enab_3enwan", wordA: "3enab", meaningA: "grapes", wordB: "3enwan", meaningB: "address / title" },
  { key: "moushy_mousht", wordA: "moushy", meaningA: "walking", wordB: "mousht", meaningB: "comb" },
  { key: "jel_jil", wordA: "jel", meaningA: "gel / frost", wordB: "jil", meaningB: "generation" },
  { key: "baten_baton", wordA: "baten", meaningA: "belly / abdomen", wordB: "baton", meaningB: "concrete / cement" },
  { key: "kassem_kasam", wordA: "kassem", meaningA: "section / department", wordB: "kasam", meaningB: "oath / vow" },
  { key: "rih_riha", wordA: "rih", meaningA: "wind", wordB: "riha", meaningB: "smell / scent" },
  { key: "sou2_soo2", wordA: "sou2", meaningA: "market", wordB: "soo2", meaningB: "bad / badness" },
  { key: "sadr_siniyye", wordA: "sadr", meaningA: "chest", wordB: "siniyye", meaningB: "tray" },
  { key: "nmel_naml", wordA: "nmel", meaningA: "ants", wordB: "naml", meaningB: "pattern / style" },
  { key: "karak_karkoube", wordA: "karak", meaningA: "distillation apparatus (Arak)", wordB: "karkoube", meaningB: "cluttered / old furniture" },
  { key: "la7me_la7en", wordA: "la7me", meaningA: "meat", wordB: "la7en", meaningB: "melody / tune" },
  { key: "shate2_shatter", wordA: "shate2", meaningA: "beach / shore", wordB: "shatter", meaningB: "smart / clever" },
  { key: "jereh_jalad", wordA: "jereh", meaningA: "wound", wordB: "jalad", meaningB: "endurance" },
  { key: "bahr_ba7at", wordA: "bahr", meaningA: "sea", wordB: "ba7at", meaningB: "pure / plain" },
  { key: "za7le_za7le2", wordA: "za7le", meaningA: "Zahle (city)", wordB: "za7le2", meaningB: "slipping / sliding" },
  { key: "habat_habbat", wordA: "habat", meaningA: "gust of wind", wordB: "habbat", meaningB: "pieces / drops" }
];

export const MULTIPLE_MEANINGS: ContextLexiconEntry[] = [
  { key: "darje", forms: ["darje"], kind: "multiple_meanings", meanings: [
    { id: "darje_stairs", meaning: "stairs / steps" },
    { id: "darje_trendy", meaning: "trendy / fashionable (Daraj)" }
  ]},
  { key: "3ein", forms: ["3ein"], kind: "multiple_meanings", meanings: [
    { id: "3ein_eye", meaning: "eye" },
    { id: "3ein_spring", meaning: "spring water" }
  ]},
  { key: "2ale", forms: ["2ale"], kind: "multiple_meanings", meanings: [
    { id: "2ale_told", meaning: "he told me" },
    { id: "2ale_frying", meaning: "frying / fried" }
  ]},
  { key: "tawli", forms: ["tawli"], kind: "multiple_meanings", meanings: [
    { id: "tawli_table", meaning: "table" },
    { id: "tawli_backgammon", meaning: "backgammon" }
  ]},
  { key: "riz", forms: ["riz"], kind: "multiple_meanings", meanings: [
    { id: "riz_rice", meaning: "rice" },
    { id: "riz_luck", meaning: "luck / fortune (Riz2)" }
  ]},
  { key: "salam", forms: ["salam"], kind: "multiple_meanings", meanings: [
    { id: "salam_peace", meaning: "peace" },
    { id: "salam_greeting", meaning: "hello / greeting" }
  ]},
  { key: "massa", forms: ["massa"], kind: "multiple_meanings", meanings: [
    { id: "massa_evening", meaning: "evening" },
    { id: "massa_touched", meaning: "touched" }
  ]},
  { key: "bared", forms: ["bared"], kind: "multiple_meanings", meanings: [
    { id: "bared_cold", meaning: "cold weather" },
    { id: "bared_mail", meaning: "mail / post" }
  ]},
  { key: "khal", forms: ["khal", "khāl"], kind: "multiple_meanings", meanings: [
    { id: "khal_uncle", meaning: "maternal uncle" },
    { id: "khal_mole", meaning: "mole / beauty mark" }
  ]},
  { key: "madd", forms: ["madd"], kind: "multiple_meanings", meanings: [
    { id: "madd_extended", meaning: "extended / stretched out" },
    { id: "madd_tide", meaning: "tide (ocean)" }
  ]},
  { key: "darab", forms: ["darab"], kind: "multiple_meanings", meanings: [
    { id: "darab_hit", meaning: "hit / struck" },
    { id: "darab_math_music", meaning: "multiplied (math) / played music" }
  ]},
  { key: "3a2ed", forms: ["3a2ed"], kind: "multiple_meanings", meanings: [
    { id: "3a2ed_contract", meaning: "contract" },
    { id: "3a2ed_necklace", meaning: "necklace" }
  ]},
  { key: "3aseer", forms: ["3aseer"], kind: "multiple_meanings", meanings: [
    { id: "3aseer_juice", meaning: "juice" },
    { id: "3aseer_difficult", meaning: "difficult / hard" }
  ]},
  { key: "baleed", forms: ["baleed"], kind: "multiple_meanings", meanings: [
    { id: "baleed_dull", meaning: "dull / lazy" },
    { id: "baleed_country", meaning: "country / town (Balad)" }
  ]},
  { key: "khat", forms: ["khat"], kind: "multiple_meanings", meanings: [
    { id: "khat_phone", meaning: "phone line" },
    { id: "khat_handwriting", meaning: "handwriting" }
  ]},
  { key: "shat", forms: ["shat"], kind: "multiple_meanings", meanings: [
    { id: "shat_coast", meaning: "coast / shore" },
    { id: "shat_diverted", meaning: "diverted / drifted off-topic" }
  ]},
  { key: "rahiq", forms: ["rahiq"], kind: "multiple_meanings", meanings: [
    { id: "rahiq_nectar", meaning: "nectar" },
    { id: "rahiq_delicate", meaning: "fine / delicate" }
  ]},
  { key: "zahr", forms: ["zahr"], kind: "multiple_meanings", meanings: [
    { id: "zahr_flowers", meaning: "flowers / blossoms" },
    { id: "zahr_dice", meaning: "dice" }
  ]},
  { key: "jeld", forms: ["jeld"], kind: "multiple_meanings", meanings: [
    { id: "jeld_skin", meaning: "skin / leather" },
    { id: "jeld_endurance", meaning: "patience / endurance" }
  ]},
  { key: "2elbi", forms: ["2elbi"], kind: "multiple_meanings", meanings: [
    { id: "2elbi_heart", meaning: "my heart" },
    { id: "2elbi_turning", meaning: "turning over / upside down" }
  ]}
];

export const CONTEXT_LEXICON: ContextLexiconEntry[] = [
  ...SAME_SPELLING,
  ...MULTIPLE_MEANINGS
];
