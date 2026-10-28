/** A refining-process claim is not disproved merely by finding another sweetener. */
export function refiningConflictIsSupported(claim: string, reality: string): boolean {
  const text = claim.toLowerCase().replace(/[-_]+/g, ' ');
  if (!/\brefined sugar\b/.test(text)) return true;
  return /\b(?:refined|white) sugar\b/i.test(reality);
}
