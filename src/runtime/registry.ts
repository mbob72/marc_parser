import { readFile } from "node:fs/promises";

/**
 * Читает уже сохранённый серверный Docker login; значение auth не выводится потребителю.
 * DOC-PREVIEW:/docs/documents-deployment.md#registry-auth
 */
export async function registryCredentials(
  configFile: string,
  registry: string,
) {
  const config = JSON.parse(await readFile(configFile, "utf8"));
  const auth = config.auths?.[registry]?.auth;
  if (typeof auth !== "string")
    throw Error("Docker login required for " + registry);
  const decoded = Buffer.from(auth, "base64").toString();
  const separator = decoded.indexOf(":");
  if (separator < 1) throw Error("Invalid Docker registry credentials");
  return {
    basic: auth,
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

/**
 * Registry tag служит сигналом CI; HEAD читает digest без скачивания слоёв образа.
 * DOC-PREVIEW:/docs/documents-deployment.md#registry-auth
 */
export async function registryDigest(
  registry: string,
  repository: string,
  tag: string,
  basic?: string,
) {
  const url = "https://" + registry + "/v2/" + repository + "/manifests/" + tag;
  const accept =
    "application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json";
  let response = await fetch(url, {
    method: "HEAD",
    headers: { Accept: accept },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (response.status === 401) {
    const challenge = response.headers.get("www-authenticate") ?? "";
    const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
    const service = /service="([^"]+)"/.exec(challenge)?.[1];
    if (!challenge.startsWith("Bearer ") || !realm || !service)
      throw Error("Unsupported Registry authentication");
    const tokenUrl = new URL(realm);
    // GHCR выдаёт и анонимные Bearer-токены. Секрет, если задан, остаётся на том же HTTPS-хосте.
    if (
      tokenUrl.protocol !== "https:" ||
      tokenUrl.hostname !== new URL(url).hostname ||
      tokenUrl.port
    )
      throw Error("Untrusted Registry auth realm");
    tokenUrl.searchParams.set("service", service);
    tokenUrl.searchParams.set("scope", "repository:" + repository + ":pull");
    const tokenResponse = await fetch(tokenUrl, {
      headers: basic ? { Authorization: "Basic " + basic } : {},
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!tokenResponse.ok)
      throw Error("Registry token HTTP " + tokenResponse.status);
    const token = (await tokenResponse.json()) as {
      token?: string;
      access_token?: string;
    };
    const bearer = token.token ?? token.access_token;
    if (!bearer) throw Error("Registry did not return a token");
    response = await fetch(url, {
      method: "HEAD",
      headers: { Accept: accept, Authorization: "Bearer " + bearer },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  }
  if (!response.ok) throw Error("Registry manifest HTTP " + response.status);
  const digest = response.headers.get("docker-content-digest");
  if (!digest || !/^sha256:[a-f0-9]{64}$/.test(digest))
    throw Error("Invalid Registry digest");
  return digest;
}
