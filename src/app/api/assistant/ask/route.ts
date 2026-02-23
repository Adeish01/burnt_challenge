import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/assistant";
import { createJob } from "@/lib/jobs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { question?: string } | null;
  const question = body?.question?.trim();

  if (!question) {
    return NextResponse.json(
      { error: "Missing question" },
      { status: 400 }
    );
  }

  try {
    const quick = await answerQuestion(question, { mode: "fast" });

    if (quick.error) {
      const showDebug =
        process.env.SHOW_INBOX_ERRORS === "true" ||
        process.env.NODE_ENV !== "production";
      return NextResponse.json({
        status: "done",
        answer: quick.answer,
        ...(showDebug ? { debug: quick.error } : {})
      });
    }

    if (quick.heavy) {
      const jobId = createJob(async () => {
        const full = await answerQuestion(question, { mode: "full" });
        return full.answer;
      });

      return NextResponse.json({
        status: "processing",
        jobId,
        message: "This may take a minute."
      });
    }

    const full = await answerQuestion(question, { mode: "full" });
    return NextResponse.json({ status: "done", answer: full.answer });
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
