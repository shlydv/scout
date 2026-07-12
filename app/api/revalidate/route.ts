import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { authorizeDeploySecret } from "@/lib/auth/admin-gate";

/** Called by Vercel deploy hook or manual invocation to purge
 *  all stale cached catalog data after a deployment.
 *  Auth: Authorization: Bearer $ADMIN_SECRET|$CRON_SECRET  or  ?secret= */
export async function GET(req: NextRequest) {
  if (!authorizeDeploySecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    revalidateTag("catalog-search", "max");
    revalidateTag("catalog-meta", "max");
    revalidatePath("/search", "layout");
    revalidatePath("/product/[slug]", "page");
    return NextResponse.json({ ok: true, purged: ["catalog-search", "catalog-meta", "/search", "/product/[slug]"] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
