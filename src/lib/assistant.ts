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

type SourceInfo = {
  id: string;
  subject: string;
  from: string;
  date?: number;
  attachments: string[];
};

type AttachmentWithMessage = {
  id: string;
  filename?: string;
  content_type?: string;
  size?: number;
  messageId: string;
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

function shouldIncludeAttachments(question: string) {
  const normalized = question.toLowerCase();
  const keywords = [
    "attachment",
    "attachments",
    "attached",
    "file",
    "pdf",
    "docx",
    "document",
    "resume",
    "invoice",
    "statement",
    "contract",
    "presentation",
    "slide",
    "spreadsheet",
    "xlsx",
    "csv",
    "image",
    "photo",
    "screenshot",
    "scan"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function prefersLatest(question: string) {
  const normalized = question.toLowerCase();
  const keywords = [
    "latest",
    "most recent",
    "newest",
    "last email",
    "most recent email",
    "latest email",
    "last message",
    "most recent message"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
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
    limit: Math.min(Math.max(parsed.limit ?? 5, 1), 10)
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
      heavy: false,
      sources: []
    };
  }

  try {
    const plan = await planQuery(question);
    const includeAttachments = plan.includeAttachments || shouldIncludeAttachments(question);
    const wantsLatest = prefersLatest(question);
    const limit = wantsLatest ? 1 : plan.limit;
    const searchQuery = wantsLatest ? null : plan.searchQuery;
    let messages = await listMessages({
      limit,
      searchQuery: searchQuery ?? undefined
    });
    if (messages.length === 0 && searchQuery) {
      messages = await listMessages({ limit });
    }

    const detailed = await Promise.all(
      messages.map(async (msg) => {
        const full = await getMessage(msg.id);
        const bodyText = htmlToText(full.body ?? full.snippet ?? "");
        return { ...full, bodyText };
      })
    );

    const attachments: AttachmentWithMessage[] = detailed.flatMap((msg) =>
      (msg.attachments ?? []).map((att) => ({
        ...att,
        messageId: msg.id
      }))
    );
    const heavy = includeAttachments && estimateHeavyWork(attachments);

    const contextLines: string[] = [];
    const sources: SourceInfo[] = [];
    for (const message of detailed) {
      sources.push({
        id: message.id,
        subject: message.subject ?? "(no subject)",
        from: formatSender(message.from),
        date: message.date ?? undefined,
        attachments: (message.attachments ?? []).map(
          (att) => att.filename ?? att.id
        )
      });
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
    if (includeAttachments && mode === "full") {
      for (const attachment of attachments) {
        try {
          const download = await downloadAttachment(attachment.id, attachment.messageId);
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
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("Attachment read failed", {
            attachmentId: attachment.id,
            filename: attachment.filename,
            error: message
          });
          attachmentContext += `Attachment ${attachment.filename ?? attachment.id}: Failed to read. ${message}\n`;
        }
      }
    }

    const answerPrompt = `You are a voice-first email assistant. Answer the user question using ONLY the context provided. If the context is missing the answer, say so. Keep responses concise but complete for voice. Format the response in clear Markdown. Use numbered lists for multi-item summaries.\n\nQuestion: ${question}\n\nContext:\n${contextLines.join("\n")}\n\nAttachment Context:\n${attachmentContext || "(none)"}`;

    let answer = "Processing deferred.";
    if (mode === "full") {
      const response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [{ role: "user", content: answerPrompt }]
      });

      answer = response.choices[0]?.message?.content ?? "No answer generated.";
    }

    const sourceNote = sources.length ? "\n\nSources are listed on screen." : "";
    return { answer: `${answer}${sourceNote}`, heavy, sources };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown inbox error";
    return {
      answer:
        "I’m having trouble accessing your inbox right now. Please confirm your Nylas connection and try again.",
      heavy: false,
      error: message,
      sources: []
    };
  }
}
