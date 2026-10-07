import type { DashRows } from "./summary";
export interface DashboardSource { fetchRows(from: Date, to: Date): Promise<DashRows> }
