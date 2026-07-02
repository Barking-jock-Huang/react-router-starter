import type { ActionFunctionArgs } from "react-router";

import {
  importConcertIntelCandidates,
  requireConcertIntelImportAuth,
} from "../../../features/concert-intel/concert-intel.server";
import { requireBlogDb } from "../../../lib/d1.server";

export async function action({ request, context }: ActionFunctionArgs) {
  await requireConcertIntelImportAuth(request, context);
  const body = (await request.json().catch(() => null)) as { candidates?: unknown[] } | null;
  if (!body || !Array.isArray(body.candidates)) {
    return Response.json({ success: false, error: "Missing candidates" }, { status: 400 });
  }
  const db = requireBlogDb(context);
  const result = await importConcertIntelCandidates(db, body.candidates as any[]);
  return Response.json({ success: true, ...result });
}
