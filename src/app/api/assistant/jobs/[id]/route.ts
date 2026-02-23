import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const job = getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    answer: job.result,
    error: job.error
  });
}
