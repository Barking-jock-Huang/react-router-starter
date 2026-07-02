import type { LoaderFunctionArgs } from "react-router";

import { loadConcertIntelKnownSourceIds } from "../../../features/concert-intel/concert-intel.server";

export async function loader(args: LoaderFunctionArgs) {
  return loadConcertIntelKnownSourceIds(args);
}
