import { hash } from "bcrypt";
import { Client } from "pg";

const email = process.env.BACKEND_BOOTSTRAP_ADMIN_EMAIL?.trim();
const password = process.env.BACKEND_BOOTSTRAP_ADMIN_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (!email || !password || !databaseUrl) {
  throw new Error("DATABASE_URL, BACKEND_BOOTSTRAP_ADMIN_EMAIL, and BACKEND_BOOTSTRAP_ADMIN_PASSWORD are required");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const result = await client.query(
    'UPDATE "user" SET password = $1, role = $2 WHERE email = $3 RETURNING id',
    [await hash(password, 12), "admin", email],
  );

  if (result.rowCount !== 1) {
    throw new Error("No user matches BACKEND_BOOTSTRAP_ADMIN_EMAIL");
  }
} finally {
  await client.end();
}

console.log("Local administrator password reset.");
