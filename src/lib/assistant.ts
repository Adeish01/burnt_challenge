import OpenAI from "openai";
import { env } from "@/lib/config";
import { listMessages, getMessage, downloadAttachment } from "@/lib/nylas";
import { htmlToText, clampText } from "@/lib/text";
import { extractAttachmentText } from "@/lib/attachments/extract";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const PLANNER_SYSTEM =
  "You are a planner for an email assistant. Return JSON only.";

type Plan = {
  searchQuery: string | null;
  includeAttachments: boolean;
  limit: number;
};

function isSmallTalk(question: string) {
  const normalized = question.trim().toLowerCase();
  if (!normalized) return false;
  const greetings = [
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "how are you",
    "what's up",
    "whats up",
    "yo"
  ];
  return greetings.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `));
}

async function planQuery(question: string): Promise<Plan> {
  const prompt = `Question: ${question}\n\nReturn JSON with keys: searchQuery (string or null), includeAttachments (boolean), limit (number). Keep limit <= 10.`;
  const response = await openai.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: [
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" }
  });
  const content = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Plan;
  return {
    searchQuery: parsed.searchQuery ?? null,
    includeAttachments: Boolean(parsed.includeAttachments),
    limit: Math.min(parsed.limit ?? 5, 10)
  };
}

function formatSender(from?: Array<{ name?: string; email?: string }>) {
  if (!from?.length) return "Unknown";
  const item = from[0];
  return item.name ? `${item.name} <${item.email ?? ""}>` : item.email ?? "Unknown";
}

function estimateHeavyWork(attachments: { size?: number }[]) {
  const totalBytes = attachments.reduce((sum, att) => sum + (att.size ?? 0), 0);
  const bigCount = attachments.filter((att) => (att.size ?? 0) > 2_000_000).length;
  return totalBytes > 5_000_000 || bigCount > 0 || attachments.length > 3;
}

export async function answerQuestion(
  question: string,
  options: { mode?: "fast" | "full" } = {}
) {
  const mode = options.mode ?? "full";
  if (isSmallTalk(question)) {
    return {
      answer: "Hi! Ask me anything about your inbox, emails, or attachments.",
      heavy: false
    };
  }

  try {
    const plan = await planQuery(question);
    const messages = await listMessages({
      limit: plan.limit,
      searchQuery: plan.searchQuery ?? undefined
    });

    const detailed = await Promise.all(
      messages.map(async (msg) => {
        const full = await getMessage(msg.id);
        const bodyText = htmlToText(full.body ?? full.snippet ?? "");
        return { ...full, bodyText };
      })
    );

    const attachments = detailed.flatMap((msg) => msg.attachments ?? []);
    const heavy = plan.includeAttachments && estimateHeavyWork(attachments);

    const contextLines: string[] = [];
    for (const message of detailed) {
      contextLines.push(
        `Message ${message.id}: Subject: ${message.subject ?? "(no subject)"}. From: ${formatSender(
          message.from
        )}. Date: ${message.date ?? "unknown"}.`
      );
      contextLines.push(`Body: ${clampText(message.bodyText ?? "", 1200)}`);
      if (message.attachments?.length) {
        contextLines.push(
          `Attachments: ${message.attachments
            .map((att) => att.filename ?? att.id)
            .join(", ")}`
        );
      }
    }

    let attachmentContext = "";
    if (plan.includeAttachments && mode === "full") {
      for (const attachment of attachments) {
        try {
          const download = await downloadAttachment(attachment.id);
          const extracted = await extractAttachmentText({
            buffer: download.buffer,
            filename: attachment.filename,
            contentType: attachment.content_type ?? download.contentType
          });
          const header = `Attachment ${attachment.filename ?? attachment.id}:`;
          attachmentContext += `${header}\n${clampText(extracted.text || "", 1200)}\n`;
          if (extracted.warning) {
            attachmentContext += `Warning: ${extracted.warning}\n`;
          }
        } catch (err) {
          attachmentContext += `Attachment ${attachment.filename ?? attachment.id}: Failed to read.\n`;
        }
      }
    }

    const answerPrompt = `You are a voice-first email assistant. Answer the user question using ONLY the context provided. If the context is missing the answer, say so. Keep responses concise but complete for voice.\n\nQuestion: ${question}\n\nContext:\n${contextLines.join("\n")}\n\nAttachment Context:\n${attachmentContext || "(none)"}`;

    let answer = "Processing deferred.";
    if (mode === "full") {
      const response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [{ role: "user", content: answerPrompt }]
      });

      answer = response.choices[0]?.message?.content ?? "No answer generated.";
    }

    return { answer, heavy };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown inbox error";
    return {
      answer:
        "I’m having trouble accessing your inbox right now. Please confirm your Nylas connection and try again.",
      heavy: false,
      error: message
    };
  }
}
