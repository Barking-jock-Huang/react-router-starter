import type { ActionFunctionArgs } from "react-router";

import {
  importReviewedConcertIntel,
  requireConcertIntelImportAuth,
} from "../../../features/concert-intel/concert-intel.server";
import { requireBlogDb } from "../../../lib/d1.server";

export async function action({ request, context }: ActionFunctionArgs) {
  await requireConcertIntelImportAuth(request, context);
  const body = (await request.json().catch(() => null)) as { events?: unknown[]; candidate_updates?: unknown[] } | null;
  if (!body || !Array.isArray(body.events)) {
    return Response.json({ success: false, error: "Missing events" }, { status: 400 });
  }
  const db = requireBlogDb(context);
  const result = await importReviewedConcertIntel(
    db,
    body.events as any[],
    Array.isArray(body.candidate_updates) ? (body.candidate_updates as any[]) : [],
  );
  return Response.json({ success: true, ...result });
}
