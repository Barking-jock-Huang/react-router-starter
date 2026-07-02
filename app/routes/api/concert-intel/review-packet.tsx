import type { LoaderFunctionArgs } from "react-router";

import { loadConcertIntelReviewPacket } from "../../../features/concert-intel/concert-intel.server";

export async function loader(args: LoaderFunctionArgs) {
  return loadConcertIntelReviewPacket(args);
}
