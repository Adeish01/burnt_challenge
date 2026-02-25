# Sequence Diagram Guide (sequence.svg)

This document explains every numbered action in `diagram/sequence.svg` and the terms/variables used in those actions. It also links each step to the code that implements it.

**Actors (diagram labels)**
- `U` = User (human interacting with the browser UI)
- `UI` = Web UI (`src/components/VoiceConsole.tsx`)
- `LK` = LiveKit server (real-time audio + data channel)
- `AG` = Voice Agent (Python, `services/agent/agent.py`)
- `API` = Next.js API routes (`src/app/api/*`)
- `AS` = Assistant module (`src/lib/assistant.ts`)
- `NY` = Nylas API (email provider)
- `OA` = OpenAI API (planner + answer)
- `JOB` = in-memory job queue (`src/lib/jobs.ts`)

**Key variables and payloads**
- `token` / `url`: LiveKit access token + server URL returned by `POST /api/livekit/token`.
- `question`: User’s transcribed request, sent to `POST /api/assistant/ask`.
- `mode`: `"fast"` or `"full"` in `answerQuestion`.
- `heavy`: Boolean indicating whether attachment processing is likely expensive.
- `jobId`: ID returned when a background job is created.
- `sources`: Metadata about emails used to answer the question.
- `inbox.sources`: LiveKit data channel topic used to send sources to the UI.
- `lk.agent.events`: LiveKit data channel topic for transcript/state updates.

## Numbered Actions (1–27)
1. **Click Connect** — The user initiates the voice session in the web UI. This calls the `connect()` handler in `VoiceConsole`.
2. **POST /api/livekit/token** — The UI requests a server-minted LiveKit token.
3. **{token, url}** — The Next.js API responds with the token + LiveKit URL to connect to.
4. **Connect + publish mic** — The UI joins LiveKit with the token and publishes the local microphone track.
5. **Audio stream** — LiveKit forwards the audio stream to the agent participant.
6. **VAD + STT** — The agent performs Voice Activity Detection (VAD) and Speech-to-Text (STT), turning audio into a text question.
7. **POST /api/assistant/ask {question}** — The agent sends the transcribed text to the Next.js assistant endpoint.
8. **answerQuestion(mode="fast")** — The API calls the assistant module in fast mode to plan the query and estimate heavy work without doing full answers.
9. **Planning prompt** — The assistant calls OpenAI to produce a JSON plan for search + attachment inclusion.
10. **listMessages/getMessage** — The assistant queries Nylas for messages and fetches full email bodies.
11. **Build context + sources** — The assistant constructs a prompt context and a `sources` list from Nylas messages.
12. **heavy? yes/no** — The assistant returns whether attachment work is heavy based on size/count heuristics.
13. **createJob(answerQuestion(mode="full"))** — If heavy, the API creates a background job for the full answer.
14. **status=processing + jobId** — The API returns a processing response so the agent can speak immediately and poll.
15. **Speak "This may take a minute"** — The agent gives the user immediate feedback while waiting.
16. **GET /api/assistant/jobs/:id** — The agent polls for the background job’s result.
17. **getJob** — The API looks up the job record in the in-memory job store.
18. **status/result** — The API responds with job status and (when ready) the answer + sources.
19. **final answer + sources** — The agent receives the completed job result.
20. **answerQuestion(mode="full")** — If not heavy (or after job), the API runs the full assistant module.
21. **download attachments (if needed)** — The assistant downloads attachments from Nylas for extraction/OCR.
22. **final answer prompt** — The assistant calls OpenAI with the fully built prompt (messages + attachments).
23. **answer + sources** — The assistant returns the final answer plus source metadata to the API.
24. **answer + sources** — The API returns the answer to the agent.
25. **publish sources (data channel)** — The agent publishes sources on the `inbox.sources` topic so the UI can display them.
26. **inbox.sources** — LiveKit forwards the sources payload to the web UI.
27. **lk.agent.events (transcript/state)** — LiveKit forwards transcript/state events to the UI to render the live conversation.

## Code snippets

**LiveKit token minting** (`src/app/api/livekit/token/route.ts`)
```ts
export async function POST() {
  const identity = `web-${nanoid(8)}`;
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity
  });
  token.addGrant({
    room: env.LIVEKIT_ROOM,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });
  const jwt = await token.toJwt();
  return NextResponse.json({ token: jwt, url: env.LIVEKIT_URL });
}
```

**Agent asks inbox + publishes sources** (`services/agent/agent.py`)
```py
response = await client.post(
    f"{APP_BASE_URL}/api/assistant/ask", json={"question": question}
)
...
if sources:
    await room.local_participant.publish_data(
        json.dumps({"type": "sources", "sources": sources}),
        topic=SOURCES_TOPIC,
    )
```

**Assistant fast vs full flow** (`src/lib/assistant.ts`)
```ts
const plan = await planQuery(question);
const includeAttachments = plan.includeAttachments || shouldIncludeAttachments(question);
const wantsLatest = prefersLatest(question);
let messages = await listMessages({ limit, searchQuery: searchQuery ?? undefined });
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
const attachments = detailed.flatMap((msg) =>
  (msg.attachments ?? []).map((att) => ({ ...att, messageId: msg.id }))
);
const heavy = includeAttachments && estimateHeavyWork(attachments);

if (includeAttachments && mode === "full") {
  // Download + extract attachment text for the final prompt.
}
```

**Job creation + polling** (`src/app/api/assistant/ask/route.ts` and `src/app/api/assistant/jobs/[id]/route.ts`)
```ts
const jobId = createJob(async () => {
  const full = await answerQuestion(question, { mode: "full" });
  return { answer: full.answer, sources: full.sources ?? [] };
});
```

```ts
const job = getJob(params.id);
return NextResponse.json({
  status: job.status,
  answer: result?.answer ?? "",
  sources: result?.sources ?? [],
  error: job.error
});
```
