import { request as httpRequest } from "node:http";

export type Image = {
  Id: string;
  Created: number;
  RepoTags: string[] | null;
  RepoDigests: string[] | null;
};
export type Container = { Id: string; ImageID: string };

/**
 * Ограниченный клиент Docker Engine через локальный сокет; пароли не попадают в ошибки/логи.
 * DOC-PREVIEW:/docs/documents-deployment.md#docker-api
 */
export class Docker {
  constructor(private socketPath = "/var/run/docker.sock") {}
  async call(
    method: string,
    path: string,
    body?: unknown,
    auth?: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const content = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(
        {
          socketPath: this.socketPath,
          method,
          path: "/v1.45" + path,
          headers: {
            ...(content ? { "Content-Type": "application/json" } : {}),
            ...(auth ? { "X-Registry-Auth": auth } : {}),
          },
        },
        (response) => {
          let text = "";
          let pullError: string | undefined;
          response.on("error", reject);
          response.on("data", (chunk) => {
            text += chunk.toString();
            // pull содержит поток JSONL: не держим лог скачивания в памяти.
            if (path.startsWith("/images/create")) {
              let end: number;
              while ((end = text.indexOf("\n")) >= 0) {
                const line = text.slice(0, end);
                text = text.slice(end + 1);
                try {
                  const value = JSON.parse(line);
                  if (value.error) pullError = String(value.error);
                } catch {
                  pullError = "Invalid Docker pull response";
                }
              }
            }
            if (text.length > 8 * 1024 * 1024)
              response.destroy(Error("Docker response too large"));
          });
          response.on("end", () => {
            const status = response.statusCode ?? 500;
            if (status >= 400) {
              const error = Error(
                "Docker HTTP " + status + ": " + text.slice(0, 1000),
              );
              Object.assign(error, { status });
              reject(error);
            } else if (pullError) reject(Error(pullError));
            else {
              try {
                resolve(text.trim() ? JSON.parse(text) : undefined);
              } catch (error) {
                reject(error);
              }
            }
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(120000, () => req.destroy(Error("Docker API timeout")));
      req.end(content);
    });
  }
  async inspectContainer(name: string): Promise<any | undefined> {
    try {
      return await this.call(
        "GET",
        "/containers/" + encodeURIComponent(name) + "/json",
      );
    } catch (error) {
      if ((error as { status?: number }).status === 404) return undefined;
      throw error;
    }
  }
  async inspectImage(image: string): Promise<any | undefined> {
    try {
      return await this.call(
        "GET",
        "/images/" + encodeURIComponent(image) + "/json",
      );
    } catch (error) {
      if ((error as { status?: number }).status === 404) return undefined;
      throw error;
    }
  }
}

/**
 * Retention считает версии по image ID; активные/остановленные контейнеры защищают свои образы.
 * DOC-PREVIEW:/docs/documents-deployment.md#retention
 */
export function retentionPlan(
  images: Image[],
  used: Set<string>,
  limit: number,
) {
  const protectedImages = images.filter((image) => used.has(image.Id));
  if (protectedImages.length > limit)
    return { blocked: true, remove: [] as Image[] };
  const keep = new Set(protectedImages.map((image) => image.Id));
  for (const image of [...images].sort((a, b) => b.Created - a.Created))
    if (keep.size < limit) keep.add(image.Id);
  return {
    blocked: false,
    remove: images.filter((image) => !keep.has(image.Id)),
  };
}
