import { env } from "@/lib/config";

export type NylasAttachment = {
  id: string;
  filename?: string;
  content_type?: string;
  size?: number;
};

export type NylasMessage = {
  id: string;
  subject?: string;
  snippet?: string;
  body?: string;
  from?: Array<{ name?: string; email?: string }>;
  to?: Array<{ name?: string; email?: string }>;
  date?: number;
  attachments?: NylasAttachment[];
};

async function nylasRequest(path: string, init?: RequestInit) {
  const rawBase = env.NYLAS_API_BASE.replace(/\/$/, "");
  const base = rawBase.endsWith("/v3") ? rawBase : `${rawBase}/v3`;
  const url = new URL(base + path);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NYLAS_API_KEY}`,
      ...(init?.headers ?? {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nylas API error ${res.status}: ${text}`);
  }

  return res;
}

export async function listMessages(options: {
  limit?: number;
  searchQuery?: string;
  unread?: boolean;
  receivedAfter?: number;
} = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.searchQuery) {
    params.set("search_query", options.searchQuery);
    params.set("query", options.searchQuery);
  }
  if (typeof options.unread === "boolean") {
    params.set("unread", String(options.unread));
  }
  if (options.receivedAfter) {
    params.set("received_after", String(options.receivedAfter));
  }

  const res = await nylasRequest(
    `/grants/${env.NYLAS_GRANT_ID}/messages?${params.toString()}`
  );
  const data = (await res.json()) as { data: NylasMessage[] };
  return data.data ?? [];
}

export async function getMessage(messageId: string) {
  const res = await nylasRequest(
    `/grants/${env.NYLAS_GRANT_ID}/messages/${messageId}`
  );
  const data = (await res.json()) as { data: NylasMessage };
  return data.data;
}

export async function downloadAttachment(attachmentId: string, messageId: string) {
  const res = await nylasRequest(
    `/grants/${env.NYLAS_GRANT_ID}/attachments/${attachmentId}/download?message_id=${encodeURIComponent(
      messageId
    )}`
  );
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = res.headers.get("content-type") ?? undefined;
  return { buffer, contentType };
}
