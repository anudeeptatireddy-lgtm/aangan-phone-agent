import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { agentText, loadTurns } from "./transcripts";
import { scanForPrice } from "@/core/postcall/price-scan";
import { SCRIPTS } from "@/core/scripts";

const flagged = (t: string) => scanForPrice(t).length > 0;

describe("price scan — must flag any price-related number (hard rule 1)", () => {
  const POSITIVE: [string, string][] = [
    ["rupee symbol", "It would be about ₹8,00,000 for that."],
    ["Rs.", "Roughly Rs. 50,000 to 60,000."],
    ["INR", "around INR 450000"],
    ["rupees + number word", "that is five lakh rupees"],
    ["lakh alone", "somewhere around fifteen lakh"],
    ["lakhs", "it starts from 4 lakhs"],
    ["lac", "about 8 lac"],
    ["crore", "two to three crore for a villa"],
    ["per square foot", "roughly 1,200 per square foot"],
    ["per sq ft, no number", "we don't quote per sq ft rates"],
    ["slash sq ft", "it works out to 1500/sq ft"],
    ["k suffix", "that'd be about 50k"],
    ["budget readback", "you mentioned a budget of 1.5"],
    ["budget readback digits", "so your budget is 150000"],
    ["range with cost", "the cost is about eight to ten"],
    ["range with lakh", "between 8 and 10 lakh"],
    ["multiplier near cost", "it can be 3x the cost of a standard kitchen"],
    ["multiplier unicode", "the difference alone can be 3× the cost"],
    ["spoken price", "priced at forty thousand"],
    ["fifteen hundred", "roughly fifteen hundred per square foot"],
    ["thousand rupees", "about two thousand rupees a square foot"],
    ["percent discount", "we can take 10 percent off the price"],
    ["quote", "I can quote around 5 for the kitchen"],
    // Hindi / Marathi / Hinglish
    ["Hindi lakh", "लगभग 5 लाख लगेंगे"],
    ["Hindi spoken", "पाँच लाख के आसपास"],
    ["Hindi dedh lakh", "डेढ़ लाख का बजट"],
    ["Hindi rupees per sqft", "1500 रुपये प्रति स्क्वेयर फुट"],
    ["Hindi hazaar", "करीब पचास हज़ार रुपये"],
    ["Devanagari digits", "खर्चा २५०० रुपये होगा"],
    ["Marathi lakh", "सुमारे दोन लाख"],
    ["Marathi price", "किंमत ५० हजार"],
    ["Marathi crore", "एक कोटी"],
    ["Hinglish kharcha", "kharcha lagbhag 5 lakh"],
    ["Hinglish rate", "daam 1200 per sq ft"],
    ["Hinglish hazaar", "pachas hazaar rupaye lagenge"],
    ["Hindi budget digits", "बजट 80 हज़ार"],
  ];
  it.each(POSITIVE)("flags: %s", (_n, text) => expect(flagged(text), text).toBe(true));

  const NEGATIVE: [string, string][] = [
    ["opening", "Namaste, Aangan Studio. I'm Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?"],
    ["area readback", "So that's a 3BHK in Kothrud, about 1,400 sq ft, done by March."],
    ["area words", "A 2BHK in Wakad, about 950 square feet."],
    ["slot offer", "I have Thursday at 11 or Saturday at 10:30 with a designer."],
    ["slot label", "Thursday 8 October, 11:00 am"],
    ["slot pm", "Friday 9 October, 3:00 pm, does that suit you?"],
    ["timeline weeks", "Design takes three to four weeks and a room takes at least eight to ten weeks end to end."],
    ["timeline digits", "A room redesign with execution takes at least 8–10 weeks from start to finish."],
    ["minutes", "A senior person will call you back within 15 minutes."],
    ["hours", "Our team is in from 10am to 7pm, Monday to Friday."],
    ["free consult", "The consultation is free and there's no obligation."],
    ["proper number", "By the end of it the designer will give you a proper number."],
    ["bedrooms", "Full redesign: kitchen, living room and four bedrooms."],
    ["year", "You'd like it finished by 31 March 2027."],
    ["big areas", "A 5,500 sq ft villa in Kalyani Nagar, and a 2,400 sq ft flat in Koregaon Park."],
    ["office size", "We do commercial fitouts up to about 3,000 sq ft, from 500 sq ft."],
    ["months", "You want to move back in by February, about 4 months from now."],
    ["date", "Can we schedule a site visit for the week of October 20?"],
    ["hindi area", "आपका 3BHK, लगभग 1,400 वर्ग फ़ुट, मार्च तक चाहिए।"],
    ["hindi hours", "सोमवार से शुक्रवार, सुबह 10 से शाम 7 बजे के बीच कॉल आएगा।"],
    ["hindi minutes", "कोई सीनियर व्यक्ति 15 मिनट के भीतर आपको कॉल करेगा।"],
    ["marathi area", "आमचे ऑफिस प्रोजेक्ट साधारण 500 चौरस फुटांपासून सुरू होतात."],
    ["hinglish date", "Main Saturday 4 October ke liye note karti hoon, morning 10:30 AM."],
    ["pricing word, no number", "Our pricing depends on the materials and scope."],
    ["no digits at all", "I can't give you a figure that would mean anything before a designer sees your home."],
    ["one of", "One of our designers will call you."],
  ];
  it.each(NEGATIVE)("does not flag: %s", (_n, text) => expect(flagged(text), JSON.stringify(scanForPrice(text))).toBe(false));

  it("every approved script, in every language, passes the scanner", () => {
    for (const [key, byLocale] of Object.entries(SCRIPTS))
      for (const [loc, s] of Object.entries(byLocale)) expect(flagged(s.text.replace("{when}", "today").replace("{whenMorning}", "this morning")), `${key}/${loc}: ${JSON.stringify(scanForPrice(s.text))}`).toBe(false);
  });

  it("returns where it found it", () => {
    const f = scanForPrice("It would be around 15 lakh, roughly.");
    expect(f[0]).toMatchObject({ kind: "magnitude" });
    expect(f[0]!.excerpt).toContain("lakh");
  });
});

describe("regression over the 40 real September transcripts (the human desk's lines)", () => {
  // Today the desk quotes in two phone calls; the agent must never do that. Everything else in the desk's own lines is price-clean.
  const ids = readdirSync("docs/enquiries").map((f) => f.replace(".md", "")).sort();
  it("the parser finds the desk's turns in every transcript (T-calls and W-threads)", () => {
    for (const id of ids.filter((x) => x !== "T08" && !x.startsWith("F"))) expect(loadTurns(id).some((t) => t.speaker === "agent"), id).toBe(true);
    expect(agentText("T10")).toContain("1 to 1.5 lakh");
  });
  it("flags exactly T10 (quotes a floor in lakh) and T13 (a multiplier on cost)", () => {
    const hits = ids.filter((id) => scanForPrice(agentText(id)).length > 0);
    expect(hits).toEqual(["T10", "T13"]);
  });
});
