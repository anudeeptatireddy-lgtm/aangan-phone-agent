import { z } from "zod";
import { getDeps } from "@/server/deps";
import { ExtractionSchema } from "@/core/postcall/extraction";

// Local-only: preloads the scripted extractor so the simulator can run the post-call pipeline without a model. 404 in production.
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const deps = getDeps();
  if (req.headers.get("authorization") !== `Bearer ${deps.env.TOOL_SHARED_SECRET}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!deps.fakeExtractor) return Response.json({ error: "real_extractor_in_use" }, { status: 409 });
  const p = z.object({ vendorCallId: z.string(), extraction: ExtractionSchema }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  deps.fakeExtractor.set(p.data.vendorCallId, p.data.extraction);
  return Response.json({ ok: true });
}
