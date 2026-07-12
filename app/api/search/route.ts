import { NextResponse } from "next/server";
import { searchVoters } from "@/lib/db/search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
