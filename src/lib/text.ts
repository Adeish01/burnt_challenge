import { convert } from "html-to-text";

// Convert HTML email bodies to plain text for prompt context.
export function htmlToText(html?: string) {
  if (!html) return "";
  return convert(html, {
    wordwrap: false,
    selectors: [{ selector: "img", format: "skip" }]
  }).trim();
}

// Clamp long blobs so prompts stay within a manageable size.
export function clampText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}
