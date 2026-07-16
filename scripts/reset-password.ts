import "dotenv/config";
import { auth } from "../lib/auth";

/**
 * Reset an existing user's password.
 *   npx tsx scripts/reset-password.ts <email> <newPassword>
 */
async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/reset-password.ts <email> <newPassword>");
    process.exit(1);
  }

  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email);
  if (!found?.user) {
    console.error("No such user:", email);
    process.exit(1);
  }

  const hashed = await ctx.password.hash(password);
  await ctx.internalAdapter.updatePassword(found.user.id, hashed);
  console.log("Password reset for", email);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
