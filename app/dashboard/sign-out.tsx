"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await signOut();
        router.push("/login");
        router.refresh();
      }}
      className="rounded-full border border-neutral-300 px-3.5 py-2 text-sm font-medium active:scale-95 dark:border-neutral-700"
    >
      Sign out
    </button>
  );
}
