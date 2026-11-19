import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import test from "node:test";
import { SUPABASE_ROOT_CA } from "@/lib/supabase/root-ca";

const cert = new X509Certificate(SUPABASE_ROOT_CA);

test("the bundled database CA is Supabase's 2021 root", () => {
  assert.equal(
    cert.fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );
  assert.equal(cert.ca, true);
  assert.match(cert.subject, /CN=Supabase Root 2021 CA/);
  assert.ok(cert.verify(cert.publicKey), "self-signed root");
});

test("the bundled database CA has at least six months left", () => {
  // Fails ahead of expiry so the replacement root (Supabase dashboard → Database settings)
  // lands before database connections start failing.
  const left = new Date(cert.validTo).getTime() - Date.now();
  assert.ok(left > 182 * 24 * 3600 * 1000, `Supabase root CA expires ${cert.validTo}`);
});
