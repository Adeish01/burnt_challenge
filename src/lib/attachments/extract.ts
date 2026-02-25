import pdf from "pdf-parse";
import mammoth from "mammoth";
import { fileTypeFromBuffer } from "file-type";
import Tesseract from "tesseract.js";
import { env } from "@/lib/config";

// Max attachment size we are willing to process (converted from MB to bytes).
const MAX_BYTES = env.ATTACHMENT_MAX_MB * 1024 * 1024;
const OCTET_STREAM = new Set(["application/octet-stream", "binary/octet-stream"]);

function normalizeMime(value?: string) {
  if (!value) return undefined;
  return value.split(";")[0]?.trim().toLowerCase();
}

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

// Extract text from supported attachment types. This runs server-side only.
export async function extractAttachmentText(input: {
  buffer: Buffer;
  filename?: string;
  contentType?: string;
}) {
  if (input.buffer.length === 0) {
    return { text: "", warning: "Attachment is empty." };
  }

  if (input.buffer.length > MAX_BYTES) {
    return {
      text: "",
      warning: `Attachment exceeds ${env.ATTACHMENT_MAX_MB}MB limit.`
    };
  }

  const detected = await fileTypeFromBuffer(input.buffer);
  const headerType = normalizeMime(input.contentType);
  const detectedType = normalizeMime(detected?.mime);
  const guessedType = normalizeMime(guessFromFilename(input.filename));
  const type =
    headerType && !OCTET_STREAM.has(headerType)
      ? headerType
      : detectedType ?? guessedType;

  if (!type) {
    return { text: "", warning: "Unknown attachment type." };
  }

  if (type === "application/pdf") {
    try {
      const parsed = await pdf(input.buffer);
      const text = parsed.text || "";
      const warning = text.trim()
        ? undefined
        : "No extractable text in PDF (may be scanned or encrypted).";
      return { text, warning };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown PDF error";
      return { text: "", warning: `PDF parse failed: ${message}` };
    }
  }

  if (
    type ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer: input.buffer });
      const text = result.value || "";
      const warning =
        result.messages?.[0]?.message ||
        (text.trim() ? undefined : "No extractable text in DOCX.");
      return { text, warning };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown DOCX error";
      return { text: "", warning: `DOCX parse failed: ${message}` };
    }
  }

  if (type.startsWith("image/")) {
    try {
      const result = await Tesseract.recognize(input.buffer, env.OCR_LANG);
      const text = result.data.text || "";
      const warning = text.trim() ? undefined : "OCR returned no text.";
      return { text, warning };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown OCR error";
      return { text: "", warning: `OCR failed: ${message}` };
    }
  }

  return { text: "", warning: `Unsupported attachment type: ${type}` };
}
