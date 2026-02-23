import { nanoid } from "nanoid";

export type JobStatus = "processing" | "done" | "error";

export type JobRecord = {
  id: string;
  status: JobStatus;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const jobs = new Map<string, JobRecord>();
const MAX_JOB_AGE_MS = 1000 * 60 * 30;

function prune() {
  const cutoff = Date.now() - MAX_JOB_AGE_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      jobs.delete(id);
    }
  }
}

export function createJob(task: () => Promise<string>) {
  prune();
  const id = nanoid();
  const record: JobRecord = {
    id,
    status: "processing",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  jobs.set(id, record);

  setTimeout(async () => {
    try {
      const result = await task();
      jobs.set(id, {
        ...record,
        status: "done",
        result,
        updatedAt: Date.now()
      });
    } catch (err) {
      jobs.set(id, {
        ...record,
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
        updatedAt: Date.now()
      });
    }
  }, 0);

  return id;
}

export function getJob(id: string) {
  return jobs.get(id);
}
