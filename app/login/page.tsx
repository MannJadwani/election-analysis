"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn.email({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Login failed");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Electoral Roll Search
          </h1>
          <p className="mt-1 text-sm text-neutral-500">Sign in to continue</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-base outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-base outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />

          {error && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-base font-medium text-white active:scale-[0.99] disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-400">
          Accounts are created by an administrator.
        </p>
      </div>
    </main>
  );
}
