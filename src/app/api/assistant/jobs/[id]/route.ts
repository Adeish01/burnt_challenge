import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  // Simple polling endpoint for background jobs.
  const job = getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const result = job.result;
  return NextResponse.json({
    status: job.status,
    answer: result?.answer ?? "",
    sources: result?.sources ?? [],
    error: job.error
  });
}
