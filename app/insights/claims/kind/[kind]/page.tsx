import { CONFLICT_KIND_LABELS } from "@/lib/insights/data";
import { ClaimsView, claimsMetadata } from "../../claims-view";

// /insights/claims?kind=<kind> is rewritten here (next.config.ts), so each filter is a cached page
// instead of a render per visit. The visitor's URL does not change. Only the known kinds exist, so
// made-up ?kind= values cannot fill the cache.
export const revalidate = 86400;
export const dynamicParams = false;
export const metadata = claimsMetadata;

export function generateStaticParams() {
  return Object.keys(CONFLICT_KIND_LABELS).map((kind) => ({ kind }));
}

export default async function ClaimsKindPage({ params }: { params: Promise<{ kind: string }> }) {
  return <ClaimsView kind={(await params).kind} />;
}
