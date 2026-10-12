import { createConnection, createServer } from "node:net";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** Атомарная публикация состояния; файлы находятся в постоянном bind mount. */
// DOC-PREVIEW:/docs/documents-code.md#control
export async function saveJson(path: string, value: unknown): Promise<void> {
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, path);
}

/** Одна JSON-команда и один ответ по Unix-сокету; размер и ожидание ограничены. */
// DOC-PREVIEW:/docs/documents-code.md#control
export function request(socketPath: string, message: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = "";
    socket.setTimeout(10000, () =>
      socket.destroy(Error("Control request timeout")),
    );
    socket.on("connect", () => socket.write(JSON.stringify(message) + "\n"));
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      response += chunk.toString();
      if (response.length > 65536)
        socket.destroy(Error("Control response too large"));
      const end = response.indexOf("\n");
      if (end < 0) return;
      socket.end();
      try {
        const reply = JSON.parse(response.slice(0, end));
        if (!reply.ok) reject(Error(reply.error));
        else resolve(reply.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.on("end", () => {
      if (!response.includes("\n"))
        reject(Error("Incomplete control response"));
    });
  });
}

/** Последовательная обработка команд исключает гонку start/drain/stop. */
// DOC-PREVIEW:/docs/documents-code.md#control
export async function serve(
  socketPath: string,
  handle: (message: any) => Promise<unknown>,
) {
  await mkdir(dirname(socketPath), { recursive: true });
  try {
    await request(socketPath, { command: "status" });
    throw Error("Control socket already active: " + socketPath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      !["ENOENT", "ECONNREFUSED"].includes(String(error.code))
    )
      throw error;
  }
  await unlink(socketPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  let queue = Promise.resolve();
  const server = createServer((socket) => {
    let input = "";
    let received = false;
    socket.setTimeout(10000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      if (received) return;
      input += chunk.toString();
      if (input.length > 65536) {
        received = true;
        socket.destroy();
        return;
      }
      const end = input.indexOf("\n");
      if (end < 0) return;
      received = true;
      queue = queue.then(async () => {
        try {
          const result = await handle(JSON.parse(input.slice(0, end)));
          socket.end(JSON.stringify({ ok: true, result }) + "\n");
        } catch (error) {
          socket.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }) + "\n",
          );
        }
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  return {
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await unlink(socketPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
}
