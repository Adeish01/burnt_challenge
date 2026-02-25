import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/assistant";
import { createJob } from "@/lib/jobs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { question?: string } | null;
  const question = body?.question?.trim();

  if (!question) {
    return NextResponse.json({ error: "Missing question" }, { status: 400 });
  }

  try {
    // Fast pass: determine whether attachments make this a heavy request.
    const quick = await answerQuestion(question, { mode: "fast" });

    if (quick.error) {
      // Only expose raw errors in dev or when explicitly enabled.
      const showDebug =
        process.env.SHOW_INBOX_ERRORS === "true" ||
        process.env.NODE_ENV !== "production";
      return NextResponse.json({
        status: "done",
        answer: quick.answer,
        sources: quick.sources ?? [],
        ...(showDebug ? { debug: quick.error } : {})
      });
    }

    if (quick.heavy) {
      // Defer heavy attachment extraction to a background task.
      const jobId = createJob(async () => {
        const full = await answerQuestion(question, { mode: "full" });
        return { answer: full.answer, sources: full.sources ?? [] };
      });

      return NextResponse.json({
        status: "processing",
        jobId,
        message: "We determined your request requires processing attachments. This may take a minute."
      });
    }

    const full = await answerQuestion(question, { mode: "full" });
    return NextResponse.json({
      status: "done",
      answer: full.answer,
      sources: full.sources ?? []
    });
  } catch (err) {
    console.error("assistant/ask failed", err);
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
