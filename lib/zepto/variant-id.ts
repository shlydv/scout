const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isZeptoVariantId(id: string | null | undefined): boolean {
  return Boolean(id?.trim() && UUID_RE.test(id.trim()));
}
