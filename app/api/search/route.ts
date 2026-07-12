import { NextResponse } from "next/server";
import { searchVoters } from "@/lib/db/search";
import { getUser, scopeCondition } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUser(req.headers);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const p = url.searchParams;
  const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);

  try {
    const result = await searchVoters({
      q: p.get("q") ?? undefined,
      state: p.get("state") ?? undefined,
      assemblyConstituencyNo: num("ac"),
      partId: num("partId"),
      gender: p.get("gender") ?? undefined,
      ageMin: num("ageMin"),
      ageMax: num("ageMax"),
      limit: num("limit"),
      offset: num("offset"),
      // Region-incharges are transparently restricted to their region.
      scope: scopeCondition(user),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
