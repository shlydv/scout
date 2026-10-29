/** Routes whose server render performs live catalogue queries or planned searches.
 * Navigate normally on intent, but do not execute that work for every visible link.
 */
export function routeNeedsOnDemandData(href: string | { pathname?: string | null }): boolean {
  const path = (typeof href === "string" ? href : href.pathname ?? "").split(/[?#]/, 1)[0];
  return path === "/" || /^\/(search|shelves|catalog|brands|insights|product)(\/|$)/.test(path);
}
