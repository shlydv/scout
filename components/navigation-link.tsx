import NextLink from "next/link";
import type { ComponentProps } from "react";
import { routeNeedsOnDemandData } from "@/lib/navigation/prefetch";

/** Keep catalogue generation out of speculative viewport/hover navigation. */
export default function NavigationLink({ href, prefetch, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink {...props} href={href} prefetch={routeNeedsOnDemandData(href) ? false : prefetch} />;
}
