import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getUser, isAdmin } from "@/lib/auth-helpers";
import { getRegionOptions, getStats } from "@/lib/db/regions";
import { UserManager } from "./user-manager";
import { SignOutButton } from "./sign-out";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getUser(await headers());
  if (!user) redirect("/login?next=/dashboard");
  if (!isAdmin(user)) redirect("/");

  const [stats, regions] = await Promise.all([getStats(), getRegionOptions()]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Admin dashboard
          </h1>
          <p className="truncate text-sm text-neutral-500">{user.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/"
            className="rounded-full bg-neutral-100 px-3.5 py-2 text-sm font-medium active:scale-95 dark:bg-neutral-800"
          >
            Search
          </Link>
          <SignOutButton />
        </div>
      </header>

      {/* Stats */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Voters" value={stats.voters.toLocaleString()} />
        <Stat label="Booths (parts)" value={stats.parts.toLocaleString()} />
        <Stat label="States" value={String(stats.byState.length)} />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">
          Voters by state
        </h2>
        <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
          {stats.byState.map((s, i) => (
            <div
              key={s.state ?? i}
              className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 text-sm last:border-0 dark:border-neutral-800"
            >
              <span>{s.state ?? "—"}</span>
              <span className="font-medium">{s.voters.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      <UserManager regions={regions} />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
