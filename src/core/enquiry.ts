import type { CheckFitInput } from "./rules/engine";
import { z } from "zod";
import { CheckFitInput as Schema } from "./rules/engine";

export type ParsedFitInput = z.output<typeof Schema>;

/** What the booking and handoff steps need to know about an enquiry. Persisted in `enquiries` (Session 4 wires the database). */
export interface EnquiryRecord {
  id: string;
  callerId?: string;
  callerName?: string;
  callerEmail?: string;
  language?: string;
  input: ParsedFitInput;
  fit?: "fit" | "not_fit" | "unclear";
  reasonCodes: string[];
  nextAction?: string;
  flags: string[];
  ruleVersion?: string;
  createdAt: string;
}
export type { CheckFitInput };
