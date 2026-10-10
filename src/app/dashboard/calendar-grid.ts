export interface DayCell { date: string; day: number; inMonth: boolean }

/** The weeks of one month as Monday-first rows of 7 dates (days outside the month are padding). `month` is 1-12. */
export function monthGrid(year: number, month: number): DayCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;                       // Monday = 0
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: DayCell[] = [];
  for (let i = -lead; i < Math.ceil((lead + days) / 7) * 7 - lead; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 + i));
    cells.push({ date: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 });
  }
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** The months touched by an inclusive range of YYYY-MM-DD dates, at most `max` of them (the first ones). */
export function monthsIn(from: string, to: string, max = 3): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4)), endM = Number(to.slice(5, 7));
  while ((y < endY || (y === endY && m <= endM)) && out.length < max) { out.push({ year: y, month: m }); if (++m > 12) { m = 1; y++; } }
  return out;
}
