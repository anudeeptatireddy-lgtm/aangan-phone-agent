# Dashboard design plan

Written before the redesign, 2026-10-08. Scope: the look and the usability of `/dashboard`. Every metric, query, API route, test and behaviour stays.
**Desktop only** (owner's call on 2026-10-08: not designing for phones in this pass). Pages still stack acceptably on a narrow window, but nothing is tuned or screenshotted for mobile.

## Who and what
Nikhil Deshpande, founder of Aangan Studio, Pune. He opens this on a laptop and asks one thing: **did every call get answered, and what became of it?**
So each page opens with that answer as a sentence, then shows the proof.

"Aangan" is the courtyard at the centre of an Indian home: a square of open sky that everything else is arranged around. The design takes that literally in two ways: the Overview is built around one central figure (the call funnel) with everything else arranged quietly around it, and the logo is a square within a square.

## Colour: six names from the studio's materials
| Name | Hex | Where it is used |
|---|---|---|
| **Kota stone** | `#1E2926` | Text; the dark funnel panel. A deep green-black slate, the stone on a Pune verandah floor. |
| **Lime plaster** | `#ECEEE8` | Page background. A cool, slightly green wash-white, not cream. |
| **Indigo** | `#2C4380` | The flow of calls in the funnel (on the dark panel a lifted `#8FA4E3`); after-hours calls ("the night"); links and focus rings. |
| **Brass** | `#B8902F` | The destination: "Won" in the funnel, targets met, the one highlight per page. Never used for small text (it fails contrast on plaster). |
| **Teak** | `#7A4A28` | "Waiting for a person" and mild warnings. |
| **Madder** | `#A63A32` | Only for what is wrong: a price said by the agent, a caller told "booked" with no booking, an overturned decision. Madder red is the old textile dye. |

Dark mode swaps the ground, not the meaning: Kota becomes the page (`#141B19`), plaster becomes the text (`#E6E9E1`), and the accents lift (indigo `#9DB0EC`, brass `#D9B25A`, teak `#C9966E`, madder `#EE8D84`). The funnel panel gets a lighter slate (`#1F2B28`) and a hairline border so it still reads as an object.
Contrast: text on ground is at least 7:1; indigo, teak and madder on plaster are all at least 5:1; brass is a fill only, with Kota text on it.

## Type
- **Newsreader** (Google Fonts, variable, optical size): page titles, section titles, every large number. A warm editorial serif; large figures in it feel written, not rendered. Lining figures.
- **Hanken Grotesk** (Google Fonts): everything that is read in a line or a table: labels, body, controls. Tabular figures wherever numbers sit in columns.
- Scale (px): 13 captions and units · 15 body and table text · 17 lead sentences · 24 section titles (Newsreader) · 40 key figures (Newsreader) · 72 the one hero figure on Overview (Newsreader). Line-height 1.45 for text, 1.1 for figures. Sentence case everywhere: no all-caps labels.

## Layout principles
- **No card grid.** Sections are separated by hairline rules and space, like a printed ledger. The only filled panel on the Overview is the funnel.
- Max width 1200px, a 12-column grid, generous left margin for section titles (a "margin column" with the title, content to its right), which gives the page a calm rhythm instead of stacked boxes.
- Navigation is four words with an underline for the current page. Live / Demo is a quiet two-state control on the right. The date range is one line ("1 Sep to 30 Sep 2026 ▾") that opens a small panel; the old always-open filter bar is gone.
- Every number is followed by its context in a lighter line: the previous period, or the target.
- No decorative motion. Only `:focus-visible` rings and a hover underline; `prefers-reduced-motion` has nothing to turn off.

## The one memorable element: the funnel
A single dark Kota panel, the only heavy object on the Overview, titled **"What happened to every call"**. Inside, the calls flow left to right as one indigo ribbon whose thickness at each stage is the number of calls still in it: seven stations (**Received, Answered, Qualified, Booked, With a designer, Quoted, Won**), each with its count in large Newsreader figures above and its plain label below. The ribbon narrows from 40 to 2; the last station is brass. Between stations, the loss is written in words ("7 weren't a fit", "1 missed"), not just shown. Stages with no source yet are drawn as a dashed outline with "no data yet". All ten underlying steps and their percentages stay available in a "Show all ten steps" table under the panel.

```
┌─ Kota panel ──────────────────────────────────────────────────────────────────────────────┐
│ What happened to every call                                    1 Sep to 30 Sep 2026        │
│                                                                                            │
│  40          39          24          19          19         10          2                 │
│ ████████████▇▇▇▇▇▇▇▇▇▇▇▇▅▅▅▅▅▅▅▅▅▅▅▅▃▃▃▃▃▃▃▃▃▃▃▃▃▃▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▁▁▁▁▁▁▁▁  (one ribbon, narrowing) │
│ Received    Answered   Qualified    Booked     With a      Quoted      Won               │
│             1 missed   15 not a fit            designer                                   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Wireframes (desktop, 1200px)

### Overview
```
 ▣ Aangan    Overview   Calls   Designers   Weekly check                  [Live|Demo]  1 Sep–30 Sep ▾
 ──────────────────────────────────────────────────────────────────────────────────────────────────
 ▒ DEMO DATA  made-up calls for showing the dashboard ▒   (thin strip, only in Demo)

 September 2026
 39 of 40 calls were answered.                                        (lead sentence, 17px)
 40 calls · 19 booked · 2 won          vs August: 12 calls, 5 booked   (72px "40", then context)
 ┌ funnel panel (above) ───────────────────────────────────────────────────────────────────────┐
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
   Show all ten steps ▸

 Did we do what we promised?          (four figures in a row, hairline dividers, no boxes)
 │ Answered within an hour │ Agent quoted a price │ Complaints called back in 15 min │ Bookings matched │
 │ 97.5%   target 100%     │ 0   target 0         │ 100%   target 100%               │ 19 of 19         │

 Calls each day                                 │ Where the calls ended up
 ▮▮ bars: ink = in hours, indigo = after hours  │ Fit 24 · Not a fit 7 (reasons) · Unclear 7 ...
 ───────────────────────────────────────────────┴───────────────────────────────────────────────
 What it costs                                  │ Quotes and deals
 table by line, total, per call, per booking    │ Won ₹84 L · Quoted ₹2.4 Cr  (designers' own figures)
 ───────────────────────────────────────────────┴───────────────────────────────────────────────
 Bookings matched to calls                      │ How fast designers answer
 Matched 19 · couldn't tell which 0 · ...       │ median accept 17 working min ...
 ──────────────────────────────────────────────────────────────────────────────────────────────
 Who calls and what they want:  Areas · Kinds of project · Designers · Languages · Time of day
```

### Calls
```
 (header as above)
 Calls                                                           40 calls in September · Export CSV
 Search [..........]  Outcome [All ▾]  Rules said [All ▾]  Designer [All ▾]  Time [Any ▾]  [Filter]
 ───────────────────────────────────────────────────────────────────────────────────────────────
 When            Caller           Phone           Area        Wanted       What happened     With
 2 Sep  9:10 pm  Manish D.  ☾     +91 90••••••11  Kothrud     Full home    ● Booked 7 Sep    Kabir Shah
 ...  (hairline rows, ☾ = after hours in indigo, ● coloured by outcome with the word beside it)
 Page 1 of 1
```

### Call detail
```
 ‹ All calls
 Manish Deshmukh called on 2 Sep at 9:10 pm (after hours).        (headline sentence)
 The rules said fit, the agent booked Kabir Shah for 7 Sep, 11:00 am. Kabir accepted in 10 minutes.
 ─────────────────────────────────────────────┬──────────────────────────────────────────────
 What they asked for (definition list)        │ Transcript (scrolls inside its own column)
 Why it was judged fit (rule v1, reasons)     │  Agent: ...
 Booking and designer (timeline)              │  Caller: ...
 Quote and deal (HubSpot)                     │
 Alerts and escalations                       │
 Note the designer received                   │
```

### Designers
```
 Designers                                                      1 Sep to 30 Sep
 Designer        Given   Accepted   Median time to accept (bar)   Consultations   Quotes   Won
 Kabir Shah        4      4 of 4    ▬▬▬▬ 12 min                       3             2       1
```

### Weekly check
```
 Weekly check                         ‹ 15 Sep–21 Sep ›
 Ten calls drawn at random each week. Listen, then say whether the agent decided right.
 Checked 3 of 10 · Overturned 1 (33%) · All weeks: 12% overturned
 ───────────────────────────────────────────────────────────────────────────────────────────────
 22 Sep  2:14 pm   Pimple Saudagar    "3BHK full home"      Agent: booked          [Agent was right] [Overturn]
                   Open the call and transcript
```

### Password screen (production only)
```
                 ▣ Aangan
                 Owner dashboard
                 [ password ........ ]  [Open]
```

## Plain language (labels change, data does not)
Router health → **Bookings matched to calls** (matched · "couldn't tell which call it was" · "caller was told they're booked, no booking found" · "bookings with no call"). Pushed → **With a designer**. Price leaks → **Times the agent quoted a price**. Cost per booked consultation → **Cost to book one consultation**. Escalations → **Complaints**, "closed within 15 min" → **called back within 15 minutes**. Pipeline → **Quotes and deals**. Weekly review → **Weekly check**. Overturn stays (it is the button he asked for). "Outbox", "router", "handoff", "extraction", "flag", "SLA" do not appear.

## Context on every number
Every key figure carries either the previous period ("vs August: 12") or its target ("target 100%"). For a full calendar month the previous period is the previous calendar month; otherwise the same number of days just before. Direction words are neutral for counts (more calls is not good or bad) and coloured only where a direction is clearly better (cost, price mentions, unmatched bookings).

## Empty states say what to do
No calls in the range → "No calls between 1 and 7 Oct. Try 'This month', or switch to Demo to see the dashboard with sample calls." No quotes yet → "Designers' quotes show here once they reach HubSpot (needs the HubSpot connection)." No review yet → "Nothing checked this week. Pick a call below, listen, then press one of the two buttons." No cost yet → "No spend recorded. Fixed monthly fees are entered by hand: see docs/next-session.md."

## Quality floor
Dark mode (follows the system). `:focus-visible` rings in indigo (lifted in dark) on every control and link, 2px with 2px offset. Contrast as above. `prefers-reduced-motion` respected (there is no animation to reduce). Colour is never the only signal (outcomes carry a word; after hours carries a moon mark and a word). Semantic HTML: a real `<nav>`, `<main>`, one `<h1>` per page, tables with `<th scope>`, the funnel SVG with a text alternative and the full table one click away.

## Self-check against generic dashboard defaults
What the first plan (and the current UI) looked like, and what I changed:
1. **Identical rounded white cards with a soft border/shadow around every metric.** Replaced: no cards. Hairline rules, space, and a margin column for titles. One filled panel, the funnel.
2. **A row of eight KPI tiles with big number + small grey caption.** Replaced: one hero figure and a lead sentence that answers his question, then four promises-kept figures that each show a target.
3. **Pill-shaped nav tabs and an always-open filter bar.** Replaced: text nav with an underline; the date range is a single line that opens a panel.
4. **A single green accent on grey (the current look) / the cream-and-terracotta "warm" look.** Replaced: lime plaster ground with Kota ink, indigo for the night, brass for the destination, madder only for faults. Nothing terracotta, nothing cream.
5. **ALL-CAPS tracked labels above every heading.** Replaced: sentence case; titles are in the serif at 24px.
6. **Gradient or glow decoration; a bar chart per metric.** Replaced: flat fills; charts only where a shape carries meaning (the funnel ribbon, calls per day, time of day); everything else is a sentence or a two-column list.
7. **Generic sans for everything, big bold sans numbers.** Replaced: serif figures, grotesk text.
8. **Jargon labels** ("Router health", "Pushed", "Price leaks"). Replaced with Nikhil's words (above).
9. **"No data" empty states.** Replaced with what to do next.
Second look after drafting the wireframes: the four "promises kept" figures risked becoming four identical tiles again, so they are one ruled row with shared hairlines and no individual boxes; the outcome list risked a rainbow of pills, so outcomes are a dot and a word in one of three colours (ink = fine, teak = waiting for a person, madder = problem).

## Libraries
None added. The charts are three simple shapes drawn in SVG/CSS by server components (no client JavaScript, nothing to hydrate); a charting library would add weight and a dependency to vet for no gain. Fonts are self-hosted at build time by `next/font/google`.

## As built, and what the critique changed
Built as planned: Kota / plaster / indigo / brass / teak / madder, Newsreader plus Hanken Grotesk, no cards, a margin column for section titles, text nav, the date range as a single line that opens a panel, the funnel ribbon as the only dark object, Nikhil's words throughout, a target or a comparison under every key number, empty states that say what to do, dark mode, focus rings. No library was added. Screenshots (desktop only, light and dark, demo data) are in `docs/screenshots/`.
After looking at the first render, I changed:
1. **Comparisons only when there is something to compare.** The first render printed "August: 0" and "August: n/a" under nearly every number (the demo has no August). Now each comparison appears only when the earlier period has calls, and otherwise one line says there are none to compare with.
2. **Truncated and clashing text.** "Complaints from existing…" was cut off, and the notes in "Bookings matched to calls" ran into their numbers ("1Call them back"). Names now wrap, and notes have their own padded column. "4 4 booked" became "4 (4 booked)".
3. **System words.** "Unspecified" and "Unknown" became "Not said" and "Not given". A test now fails if internal terms (outbox, router health, handoff, webhook, SLA, pushed, price leaks) appear in anything a reader sees.
4. **A table bug I would not have found in the plan.** Right-aligned numbers sat under left-aligned headings on the Designers page (a CSS specificity slip), designer names were smaller than the other text, and the bar touched the "4 of 4". All fixed.
5. **The password screen** had a white strip above it (a top margin collapsing through its parent). Fixed with a flow-root wrapper.
6. **Demo realism.** Callers were given random names that contradicted their own transcripts ("Manish Deshmukh" whose call says "I'm Priya"). Names now come from the enquiry documents, and demo summaries read as sentences. The ☾ mark is now explained where it appears (evenings, nights and weekends).
Not done, on purpose: no mobile layout (owner's call), no animation, no chart library.

