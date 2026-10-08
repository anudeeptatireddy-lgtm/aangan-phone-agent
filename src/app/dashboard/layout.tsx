import type { ReactNode } from "react";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./dashboard.css";

// Two typefaces (docs/design-plan.md): Newsreader for titles and every large figure, Hanken Grotesk for reading and tables. Self-hosted at build time.
const display = Newsreader({ subsets: ["latin"], variable: "--font-display", display: "swap", axes: ["opsz"] });
const text = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-text", display: "swap" });

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <div className={`dash ${display.variable} ${text.variable}`}>{children}</div>;
}
