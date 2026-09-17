import type { ConversionJob } from "./job.js";
import type { JobDatabase } from "./job-database.js";
import type { ObjectStore } from "./object-store.js";

export interface GarbageCollectionResult {
  readonly scanned: number;
  readonly deleted: number;
  readonly failed: number;
}

export type DeleteJobResult = "deleted" | "not-found" | "not-finished";

export class JobGarbageCollector {
  private activeCollection: Promise<GarbageCollectionResult> | null = null;

  constructor(
    private readonly database: Pick<
      JobDatabase,
      "getJob" | "getExpiredJobs" | "deleteFinishedJob"
    >,
    private readonly objectStore: Pick<ObjectStore, "remove">,
  ) {}

  collect(now = new Date()): Promise<GarbageCollectionResult> {
    if (!this.activeCollection) {
      this.activeCollection = this.runCollection(now).finally(() => {
        this.activeCollection = null;
      });
    }

    return this.activeCollection;
  }

  async deleteJob(jobId: string): Promise<DeleteJobResult> {
    const job = await this.database.getJob(jobId);

    if (!job) {
      return "not-found";
    }
    if (job.status !== "completed" && job.status !== "failed") {
      return "not-finished";
    }

    await this.removeJobObjects(job);
    await this.database.deleteFinishedJob(job.id);
    return "deleted";
  }

  private async runCollection(now: Date): Promise<GarbageCollectionResult> {
    const jobs = await this.database.getExpiredJobs(now);
    let deleted = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        await this.removeJobObjects(job);
        if (await this.database.deleteFinishedJob(job.id)) {
          deleted += 1;
        }
      } catch {
        failed += 1;
      }
    }

    return { scanned: jobs.length, deleted, failed };
  }

  private async removeJobObjects(job: ConversionJob): Promise<void> {
    await this.objectStore.remove(job.inputObjectKey);
    if (job.summary?.validationErrorsObjectKey) {
      await this.objectStore.remove(job.summary.validationErrorsObjectKey);
    }
    if (job.outputObjectKey) {
      await this.objectStore.remove(job.outputObjectKey);
    }
  }
}
