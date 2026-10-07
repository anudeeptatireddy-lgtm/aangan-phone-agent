// Safety net for hard rule 1: scan what the AGENT said for anything that sounds like a price. Deliberately conservative:
// a false alarm costs a glance, a miss is the worst failure the system can have. Tuned against the approved scripts and the
// 40 real transcripts (tests/postcall/price-scan.test.ts); weekly call review catches what regexes cannot.
//
// A finding is any of: a rupee amount, an Indian magnitude word (lakh/crore), a per-area rate, a "50k" style figure, or ANY number
// (digits or spoken, EN/HI/MR/Hinglish) that is not clearly an area, time, date, count or year and sits next to a price word.

export type PriceFindingKind = "currency" | "magnitude" | "per_area" | "k_suffix" | "price_context_number";
export interface PriceFinding { kind: PriceFindingKind; excerpt: string; index: number }

const DEVANAGARI_DIGITS = "०१२३४५६७८९";
// Same length as the input so reported positions stay valid. "Rs." must not end a sentence ("Rs. 50,000").
const toAscii = (s: string) =>
  s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d))).replace(/\b(rs)\.(?=\s*\d)/gi, (m) => m.slice(0, -1) + "\u2024");

const MAGNITUDE = /\b(lakhs?|lacs?|crores?)\b|लाख|करोड़|करोड|कोटी|कोटि/giu;
const PER_AREA = [
  /\bper\s*(?:sq\.?\s*(?:ft|feet|foot)|square\s*(?:feet|foot|ft)|sqft)\b/giu,
  /\d\s*\/\s*(?:sq|sqft|square)\b/giu,
  /प्रति\s*(?:स्क्वे[अय]र|स्क्वायर|वर्ग|चौरस)\s*(?:फुट|फ़ुट|फूट)/giu,
];
const K_SUFFIX = /\b\d+(?:\.\d+)?\s?k\b(?!\s*(?:sq|sqft|ft|m\b))/giu;
const CURRENCY_SYMBOL = /₹/gu;
const CURRENCY_WORD = /\b(?:rs|inr|rupees?|rupaye|rupaiye|rupay[ae]|rupayon)\b\.?|रुपये|रुपए|रुपया|रुपयों|रूपये|रू\./giu;

const PRICE_WORDS = new Set([
  "price", "prices", "pricing", "priced", "cost", "costs", "costing", "rate", "rates", "budget", "charge", "charges", "fee", "fees", "quote", "quoted",
  "quotation", "estimate", "amount", "expense", "expenses", "spend", "afford", "discount", "payment", "pay", "paise", "paisa", "daam", "dam", "kimat", "keemat",
  "kharcha", "kharch", "bajat", "kitna", "kimmat",
  "कीमत", "दाम", "खर्च", "खर्चा", "बजट", "भाव", "शुल्क", "फीस", "पैसे", "पैसा", "किंमत", "खर्चाचा", "दर",
]);

const WORD_NUMBERS = new Set([
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "dozen",
  "teen", "char", "paanch", "panch", "chhe", "saat", "aath", "nau", "bees", "tees", "chalis", "pachas", "saath", "sattar", "assi", "nabbe", "sau", "hazaar", "hazar", "dedh", "dhai", "sade",
  "दो", "तीन", "चार", "पांच", "पाँच", "छह", "छः", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस", "तीस", "चालीस", "पचास", "साठ", "सत्तर",
  "अस्सी", "नब्बे", "सौ", "सैकड़ा", "हज़ार", "हजार", "डेढ़", "ढाई", "साढ़े", "पौने",
  "दोन", "पाच", "सहा", "नऊ", "दहा", "वीस", "चाळीस", "पन्नास", "शंभर", "दीड", "अडीच", "साडे",
]);

// Units that make a number harmless: area, bedrooms, durations, times, dates, years.
const BENIGN_UNIT = new Set([
  "sq", "sqft", "square", "feet", "foot", "ft", "bhk", "bedroom", "bedrooms", "room", "rooms", "week", "weeks", "month", "months", "day", "days", "hour", "hours",
  "hr", "hrs", "min", "mins", "minute", "minutes", "year", "years", "am", "pm", "oclock", "floor", "floors", "people", "workstations", "cabins", "january", "february", "march", "april",
  "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "हफ़्ते", "हफ्ते", "हफ्ता", "आठवडे", "आठवड्याचे", "महीने", "महिने", "महिना", "दिन", "दिवस", "घंटे", "तास", "मिनट", "मिनिटांत", "मिनिटे", "वर्ष", "साल", "वर्ग", "फुट", "फ़ुट", "फूट", "चौरस",
  "बीएचके", "बजे", "वाजता", "वाजेपर्यंत", "कमरे", "खोल्या", "मंज़िल", "मजले", "लोग", "जनों", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर", "जनवरी", "फ़रवरी", "फरवरी",
]);
const CONNECTORS = new Set(["to", "-", "–", "—", "and", "or", "se", "te", "से", "ते", "या", "किंवा", "aur", "ya"]);
const MONTH_PREFIX = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);

const WINDOW = 6; // tokens either side, within one sentence

interface Tok { raw: string; norm: string; index: number; isDigit: boolean; unitSuffix?: string }

function tokenize(sentence: string, offset: number): Tok[] {
  const out: Tok[] = [];
  const re = /\d[\d,]*(?:\.\d+)?|[\p{L}\p{M}]+|[×x%]|[-–—]/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const raw = m[0];
    const isDigit = /^\d/.test(raw);
    out.push({ raw, norm: isDigit ? raw.replace(/,/g, "") : raw.toLowerCase().replace(/[’']/g, ""), index: offset + m.index, isDigit });
  }
  // "10am", "7pm", "3x": split a digit token directly followed by letters (the regex already splits them, so mark suffix by adjacency)
  return out;
}

const isYear = (t: Tok) => t.isDigit && /^(19|20)\d{2}$/.test(t.norm);
const isNumeric = (t: Tok) => t.isDigit || WORD_NUMBERS.has(t.norm);

function isBenign(toks: Tok[], i: number, sentence: string): boolean {
  const t = toks[i]!;
  if (isYear(t)) return true;
  // clock time like 10:30 (the colon is not tokenised: look at the raw text around the number)
  const around = sentence.slice(Math.max(0, t.index - 1 - (toks[0]?.index ?? 0) + (toks[0]?.index ?? 0)), t.index + t.raw.length + 3);
  if (/\d:\d{2}/.test(sentence.slice(Math.max(0, t.index - 3), t.index + t.raw.length + 3))) return true;
  // skip forward over further numbers and connectors ("8 to 10 weeks", "10am to 7pm", "3-4 weeks"), then look at the first real word
  let j = i + 1;
  while (j < toks.length && (isNumeric(toks[j]!) || CONNECTORS.has(toks[j]!.norm))) j++;
  const next = toks[j];
  if (next && BENIGN_UNIT.has(next.norm)) return true;
  // a month name just before the number: "October 20"
  const prev = toks[i - 1];
  if (prev && MONTH_PREFIX.has(prev.norm)) return true;
  void around;
  return false;
}

function sentences(text: string): { s: string; offset: number }[] {
  const out: { s: string; offset: number }[] = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?।]+(?=\s|$)/g)) {
    out.push({ s: text.slice(start, m.index! + m[0].length), offset: start });
    start = m.index! + m[0].length;
  }
  if (start < text.length) out.push({ s: text.slice(start), offset: start });
  return out;
}

const excerptAt = (text: string, index: number, len = 60) => text.slice(Math.max(0, index - 20), Math.min(text.length, index + len)).trim();

export function scanForPrice(input: string): PriceFinding[] {
  const text = toAscii(input);
  const findings: PriceFinding[] = [];
  const add = (kind: PriceFindingKind, index: number) => findings.push({ kind, index, excerpt: excerptAt(input, index) });

  for (const m of text.matchAll(CURRENCY_SYMBOL)) add("currency", m.index!);
  for (const m of text.matchAll(MAGNITUDE)) add("magnitude", m.index!);
  for (const re of PER_AREA) for (const m of text.matchAll(re)) add("per_area", m.index!);
  for (const m of text.matchAll(K_SUFFIX)) add("k_suffix", m.index!);

  for (const { s, offset } of sentences(text)) {
    const toks = tokenize(s, offset);
    // currency WORDS only count next to a number ("rupees" alone is not an amount)
    for (const m of s.matchAll(CURRENCY_WORD)) {
      const at = offset + m.index!;
      const near = toks.filter((t) => Math.abs(t.index - at) < 40 && isNumeric(t));
      if (near.length) add("currency", at);
    }
    const priceIdx = toks.map((t, i) => (PRICE_WORDS.has(t.norm) ? i : -1)).filter((i) => i >= 0);
    if (!priceIdx.length) continue;
    toks.forEach((t, i) => {
      if (!isNumeric(t) || isBenign(toks, i, s)) return;
      if (priceIdx.some((p) => Math.abs(p - i) <= WINDOW)) add("price_context_number", t.index);
    });
  }

  // one finding per (kind, index), time-ordered
  const seen = new Set<string>();
  return findings.filter((f) => { const k = `${f.kind}:${f.index}`; return seen.has(k) ? false : (seen.add(k), true); }).sort((a, b) => a.index - b.index);
}
