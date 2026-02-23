import pdf from "pdf-parse";
import mammoth from "mammoth";
import { fileTypeFromBuffer } from "file-type";
import Tesseract from "tesseract.js";
import { env } from "@/lib/config";

const MAX_BYTES = env.ATTACHMENT_MAX_MB * 1024 * 1024;

function guessFromFilename(filename?: string) {
  if (!filename) return undefined;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return undefined;
}

export async function extractAttachmentText(input: {
  buffer: Buffer;
  filename?: string;
  contentType?: string;
}) {
  if (input.buffer.length > MAX_BYTES) {
    return {
      text: "",
      warning: `Attachment exceeds ${env.ATTACHMENT_MAX_MB}MB limit.`
    };
  }

  const detected = await fileTypeFromBuffer(input.buffer);
  const type = input.contentType ?? detected?.mime ?? guessFromFilename(input.filename);

  if (!type) {
    return { text: "", warning: "Unknown attachment type." };
  }

  if (type === "application/pdf") {
    const parsed = await pdf(input.buffer);
    return { text: parsed.text || "", warning: undefined };
  }

  if (
    type ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer: input.buffer });
    return { text: result.value || "", warning: result.messages?.[0]?.message };
  }

  if (type.startsWith("image/")) {
    const result = await Tesseract.recognize(input.buffer, env.OCR_LANG);
    return { text: result.data.text || "", warning: undefined };
  }

  return { text: "", warning: `Unsupported attachment type: ${type}` };
}
