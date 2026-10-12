import { Client } from "pg";

/** Проверяет .env без вывода пароля; потребители checkDatabase и loadCopy закрывают Client. */
// DOC-PREVIEW:/docs/documents-code.md#database
export function databaseClient(): Client {
  if (
    process.env.DB_TYPE !== "postgres" &&
    process.env.DB_TYPE !== "postgresql"
  )
    throw Error("DB_TYPE must be postgres or postgresql");
  const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASS"];
  // Проверяем наличие всех параметров до сетевого подключения.
  for (const key of required)
    if (!process.env[key]) throw Error(`Missing ${key}`);
  const port = Number(process.env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid DB_PORT");
  return new Client({
    host: process.env.DB_HOST,
    port,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    connectionTimeoutMillis: 15000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    application_name: "marc-documents",
  });
}
