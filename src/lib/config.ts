import { z } from "zod";

const envSchema = z.object({
  NYLAS_API_KEY: z.string().min(1),
  NYLAS_GRANT_ID: z.string().min(1),
  NYLAS_API_BASE: z.string().default("https://api.nylas.com/v3"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_ROOM: z.string().default("voice-inbox"),
  ATTACHMENT_MAX_MB: z.string().default("20"),
  OCR_LANG: z.string().default("eng"),
  LONG_TASK_THRESHOLD_MS: z.string().default("8000")
});

const parsed = envSchema.safeParse({
  NYLAS_API_KEY: process.env.NYLAS_API_KEY,
  NYLAS_GRANT_ID: process.env.NYLAS_GRANT_ID,
  NYLAS_API_BASE: process.env.NYLAS_API_BASE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  LIVEKIT_ROOM: process.env.LIVEKIT_ROOM,
  ATTACHMENT_MAX_MB: process.env.ATTACHMENT_MAX_MB,
  OCR_LANG: process.env.OCR_LANG,
  LONG_TASK_THRESHOLD_MS: process.env.LONG_TASK_THRESHOLD_MS
});

if (!parsed.success) {
  throw new Error(`Missing or invalid environment variables: ${parsed.error.message}`);
}

export const env = {
  ...parsed.data,
  ATTACHMENT_MAX_MB: Number(parsed.data.ATTACHMENT_MAX_MB),
  LONG_TASK_THRESHOLD_MS: Number(parsed.data.LONG_TASK_THRESHOLD_MS)
};
