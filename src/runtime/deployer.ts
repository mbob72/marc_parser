import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Docker, retentionPlan } from "./docker.js";
import type { Image, Container } from "./docker.js";
import { saveJson } from "./control.js";
import { registryCredentials, registryDigest } from "./registry.js";

export type DeployOptions = {
  registry: string;
  repository: string;
  tag: string;
  control: string;
  configFile: string;
  anonymous?: boolean;
  workDir: string;
  sourceDir: string;
  envFile: string;
  uid: number;
  gid: number;
  workerName: string;
  cpu: number;
  memory: number;
};
type Credentials = Awaited<ReturnType<typeof registryCredentials>>;
type Dependencies = {
  docker?: Docker;
  credentials?: () => Promise<Credentials>;
  digest?: (basic?: string) => Promise<string>;
};

/**
 * Доставка образов отделена от явного запуска worker; работающие контейнеры не заменяются.
 * DOC-PREVIEW:/docs/documents-deployment.md#runtime
 */
export async function createDeployer(
  options: DeployOptions,
  dependencies: Dependencies = {},
) {
  const docker = dependencies.docker ?? new Docker();
  const imageRoot = options.registry + "/" + options.repository;
  await mkdir(options.control, { recursive: true });
  let state: Record<string, unknown> = { phase: "starting", checkedAt: null };
  let running: Promise<void> | undefined;
  const publish = async (
    phase: string,
    details: Record<string, unknown> = {},
  ) => {
    const changed = state.phase !== phase || state.pending !== details.pending;
    state = {
      ...state,
      ...details,
      phase,
      checkedAt: new Date().toISOString(),
    };
    await saveJson(join(options.control, "deploy.json"), state);
    if (changed) console.log(JSON.stringify({ event: "deploy", ...state }));
  };
  const owned = (images: Image[]) =>
    images.filter(
      (image) =>
        (image.RepoTags ?? []).some((tag) =>
          tag.startsWith(imageRoot + ":documents-"),
        ) ||
        (image.RepoDigests ?? []).some((digest) =>
          digest.startsWith(imageRoot + "@"),
        ),
    );
  // Защита используемых образов и чужих тегов: DOC-PREVIEW:/docs/documents-deployment.md#retention
  const cleanup = async (limit: number, desired?: string) => {
    const images = owned(await docker.call("GET", "/images/json"));
    const containers = (await docker.call(
      "GET",
      "/containers/json?all=1",
    )) as Container[];
    const used = new Set(containers.map((container) => container.ImageID));
    if (desired) used.add(desired);
    const plan = retentionPlan(images, used, limit);
    if (plan.blocked) return false;
    for (const image of plan.remove) {
      const tags = (image.RepoTags ?? []).filter((tag) =>
        tag.startsWith(imageRoot + ":documents-"),
      );
      // Чужие alias не удаляются; удаляем только ссылки нашего Registry, без force.
      if (tags.length)
        for (const tag of tags)
          await docker.call("DELETE", "/images/" + encodeURIComponent(tag));
      else if (!(image.RepoTags ?? []).length)
        await docker.call("DELETE", "/images/" + encodeURIComponent(image.Id));
    }
    return owned(await docker.call("GET", "/images/json")).length <= limit;
  };
  // Версии упорядочены по времени сборки, а не по времени скачивания на сервер.
  // Выбор локальных версий: DOC-PREVIEW:/docs/documents-deployment.md#worker-start
  const versions = async () => {
    const images = owned(await docker.call("GET", "/images/json"));
    return Promise.all(
      images
        .sort((a, b) => b.Created - a.Created || a.Id.localeCompare(b.Id))
        .slice(0, 3)
        .map(async (image, index) => {
          const info = await docker.inspectImage(image.Id);
          return {
            selection: ["latest", "previous", "previous-2"][index],
            id: image.Id,
            image:
              (image.RepoDigests ?? []).find((digest) =>
                digest.startsWith(imageRoot + "@"),
              ) ?? image.Id,
            revision:
              info?.Config.Labels?.["org.opencontainers.image.revision"] ??
              null,
            releasedAt:
              info?.Config.Labels?.["org.opencontainers.image.created"] ??
              info?.Created ??
              null,
          };
        }),
    );
  };
  const status = async () => {
    const container = await docker.inspectContainer(options.workerName);
    const image = container
      ? await docker.inspectImage(container.Image)
      : undefined;
    return {
      delivery: state,
      versions: await versions(),
      worker: container
        ? {
            name: options.workerName,
            running: Boolean(container.State.Running),
            status: container.State.Status,
            imageId: container.Image,
            revision:
              image?.Config.Labels?.["org.opencontainers.image.revision"] ??
              null,
            releasedAt:
              image?.Config.Labels?.["org.opencontainers.image.created"] ??
              image?.Created ??
              null,
            startedAt: container.State.StartedAt,
          }
        : null,
    };
  };
  // Запуск без pull и замены контейнера: DOC-PREVIEW:/docs/documents-deployment.md#worker-start
  const start = async (selection = "latest") => {
    if (!["latest", "previous", "previous-2"].includes(selection))
      throw Error("Invalid version selection");
    if (await docker.inspectContainer(options.workerName))
      throw Error(
        "Worker container already exists; inspect it before starting another version",
      );
    const version = (await versions()).find(
      (version) => version.selection === selection,
    );
    if (!version)
      throw Error("Selected image version is not available locally");
    // Образ уже доставлен. Команда только запускает сервер worker, не задачу импорта.
    const created = await docker.call(
      "POST",
      "/containers/create?name=" + options.workerName,
      {
        Image: version.id,
        Cmd: ["worker", "server", "--image", version.image],
        User: options.uid + ":" + options.gid,
        Labels: { "rsl.marc-documents.managed": "worker" },
        HostConfig: {
          Binds: [
            options.workDir + ":/work",
            options.sourceDir + ":/source:ro",
            options.envFile + ":/run/db.env:ro",
            "/var/run/postgresql:/var/run/postgresql",
          ],
          RestartPolicy: { Name: "unless-stopped" },
          NanoCpus: Math.round(options.cpu * 1e9),
          Memory: options.memory,
          LogConfig: {
            Type: "json-file",
            Config: { "max-size": "10m", "max-file": "3" },
          },
        },
      },
    );
    // Если start завершается ошибкой, оставляем созданный контейнер для диагностики.
    await docker.call("POST", "/containers/" + created.Id + "/start");
    return status();
  };
  // Опрос, доставка и фазы ошибок: DOC-PREVIEW:/docs/documents-deployment.md#server
  const tick = async () => {
    try {
      const credentials = options.anonymous
        ? undefined
        : dependencies.credentials
          ? await dependencies.credentials()
          : await registryCredentials(options.configFile, options.registry);
      const digest = dependencies.digest
        ? await dependencies.digest(credentials?.basic)
        : await registryDigest(
            options.registry,
            options.repository,
            options.tag,
            credentials?.basic,
          );
      const image = imageRoot + "@" + digest;
      await publish("preparing_image", { pending: image });
      const local = await docker.inspectImage(image);
      // Резервируем слот до pull: скачивание четвёртой версии не начинается.
      if (!(await cleanup(local ? 3 : 2, local?.Id))) {
        await publish("retention_blocked", { pending: image });
        return;
      }
      if (!local) {
        const auth = credentials
          ? Buffer.from(
              JSON.stringify({
                username: credentials.username,
                password: credentials.password,
                serveraddress: options.registry,
              }),
            ).toString("base64")
          : undefined;
        await docker.call(
          "POST",
          "/images/create?fromImage=" + encodeURIComponent(image),
          undefined,
          auth,
        );
      }
      if (!(await cleanup(3)))
        throw Error("Retention limit could not be enforced");
      await publish("ready", {
        available: image,
        pending: null,
        deliveredAt: new Date().toISOString(),
        error: null,
      });
    } catch (error) {
      await publish("error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return {
    state: () => state,
    status,
    versions,
    async start(selection?: string) {
      // Доставка и запуск не пересекаются: retention не удалит выбранный образ.
      await (running ?? Promise.resolve());
      if (running) throw Error("Deployment operation is busy");
      const operation = start(selection);
      running = operation
        .then(
          () => {},
          () => {},
        )
        .finally(() => {
          running = undefined;
        });
      return operation;
    },
    settled: () => running ?? Promise.resolve(),
    update() {
      if (!running)
        running = tick().finally(() => {
          running = undefined;
        });
      return running;
    },
  };
}
