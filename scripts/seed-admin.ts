import "dotenv/config";
import { auth } from "../lib/auth";

/**
 * Bootstrap the first admin (signup is invite-only, so we create it directly).
 *   npx tsx scripts/seed-admin.ts <email> <password> [name]
 * If the user already exists, promotes them to admin.
 */
async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  const name = process.argv[4] ?? "Admin";
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/seed-admin.ts <email> <password> [name]");
    process.exit(1);
  }

  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email);

  if (existing?.user) {
    await ctx.internalAdapter.updateUser(existing.user.id, { role: "admin" });
    console.log("Existing user promoted to admin:", email);
    process.exit(0);
  }

  const user = await ctx.internalAdapter.createUser({
    email,
    name,
    emailVerified: true,
    role: "admin",
  });
  const hashed = await ctx.password.hash(password);
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hashed,
  });
  console.log("Created admin:", email);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
