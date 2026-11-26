import { ClaimsView, claimsMetadata } from "./claims-view";

// Rendered once a day, the same for everyone. Filtered links (?kind=…) are rewritten to ./kind/[kind].
export const revalidate = 86400;

export const metadata = claimsMetadata;

export default function ClaimsPage() {
  return <ClaimsView />;
}
