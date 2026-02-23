import { convert } from "html-to-text";

export function htmlToText(html?: string) {
  if (!html) return "";
  return convert(html, {
    wordwrap: false,
    selectors: [{ selector: "img", format: "skip" }]
  }).trim();
}

export function clampText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}
