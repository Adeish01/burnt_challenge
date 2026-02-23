# Voice Inbox Assistant

A voice-first email assistant that connects to Nylas, answers questions about email bodies and attachments, and uses LiveKit for the voice interface. The web app is a minimal voice console (no inbox list), and the agent announces when longer processing is required.

## Architecture

- `src/app` Next.js app router
- `src/app/api` backend routes for LiveKit token + email answering
- `src/lib` modular domain logic (Nylas client, attachment extraction, LLM orchestration, background jobs)
- `services/agent` LiveKit voice agent (STT/TTS + call into the Next.js API)

## Features

- Full inbox access via Nylas (no manual selection UI)
- Answers questions about email bodies and attachments
- PDF, DOCX, and image OCR extraction
- Long-running attachment processing returns a "This may take a minute" response and follows up once ready

## Setup

### 1) Configure environment variables

Copy `.env.example` to `.env` and fill in your credentials (Next.js API + LiveKit token service):

```
cp .env.example .env
```

Key variables:

- `NYLAS_API_KEY`
- `NYLAS_GRANT_ID`
- `NYLAS_API_BASE` (set to your region, e.g. `https://api.us.nylas.com` or `https://api.eu.nylas.com`)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional)
- `SHOW_INBOX_ERRORS` (optional, set `true` in local dev to include Nylas error details)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `LIVEKIT_ROOM`
- `ATTACHMENT_MAX_MB`, `OCR_LANG`

**LiveKit environment options (local dev vs cloud)**

Use the same LiveKit values in both `.env` (Next.js token route) and `services/agent/.env` (voice agent).

Local dev (when running `livekit-server --dev`):

```env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_ROOM=voice-inbox
```

LiveKit Cloud (use this instead of local dev):

```env
LIVEKIT_URL=wss://YOUR-LK-HOST.cloud.livekit.io
LIVEKIT_API_KEY=YOUR_LK_API_KEY
LIVEKIT_API_SECRET=YOUR_LK_API_SECRET
LIVEKIT_ROOM=voice-inbox
```

If the API key/secret do not match the LiveKit server you are connecting to, the agent will fail with a `401 Unauthorized` or `invalid API key` error.

### 2) Install dependencies

```
npm install
```

### 3) Run LiveKit locally (Terminal 1 and leave running)

```
livekit-server --dev
```

If you are using LiveKit Cloud, skip this step.

### 4) Start the Next.js app (Terminal 2 )

```
npm run dev
```

### 5) Run the voice agent (Terminal 3)

The voice agent uses LiveKit + OpenAI for STT/TTS and calls the Next.js API.

```
cd services/agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python agent.py
```
Ensure to fill the Agent environment variables live in `services/agent/.env`:

- `APP_BASE_URL` (Next.js API base URL, e.g. `http://localhost:3000`)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional)
- `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `OPENAI_TTS_INSTRUCTIONS` (optional voice tuning)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_ROOM` (can leave as default)

## Testing LiveKit (Local Dev vs Cloud)

The app uses two processes that both need the same LiveKit credentials:

- Next.js API (reads `.env`)
- Voice agent (reads `services/agent/.env`)

If these do not match the LiveKit server you are connecting to, you will see `401 Unauthorized` or `invalid API key`.

### Test with LiveKit local dev

1. Set LiveKit variables in `.env` and `services/agent/.env`:
   ```env
   LIVEKIT_URL=ws://localhost:7880
   LIVEKIT_API_KEY=devkey
   LIVEKIT_API_SECRET=secret
   LIVEKIT_ROOM=voice-inbox
   ```
1. Start LiveKit in Terminal 1:
   ```bash
   livekit-server --dev
   ```
1. Start Next.js in Terminal 2:
   ```bash
   npm run dev
   ```
1. Start the agent in Terminal 3:
   ```bash
   cd services/agent
   source .venv/bin/activate
   python agent.py
   ```
1. Open the web UI at `http://localhost:3000` and connect.

Expected result:

- Agent logs show it connected to `voice-inbox`.
- The web UI connects without LiveKit 401 errors.

### Test with LiveKit Cloud

1. Stop the local LiveKit server if it is running.
1. Set LiveKit variables in `.env` and `services/agent/.env`:
   ```env
   LIVEKIT_URL=wss://YOUR-LK-HOST.cloud.livekit.io
   LIVEKIT_API_KEY=YOUR_LK_API_KEY
   LIVEKIT_API_SECRET=YOUR_LK_API_SECRET
   LIVEKIT_ROOM=voice-inbox
   ```
1. Start Next.js:
   ```bash
   npm run dev
   ```
1. Start the agent:
   ```bash
   cd services/agent
   source .venv/bin/activate
   python agent.py
   ```
1. Open the web UI at `http://localhost:3000` and connect.

Expected result:

- Agent logs show it connected to `voice-inbox`.
- The web UI connects without LiveKit 401 errors.

## Demo

- [Demo video](https://drive.google.com/file/d/1vY88s5lY9PA-fUnCNwRvv7jdPg1iFc2v/view?usp=sharing)

## Notes

- Attachment extraction is capped by `ATTACHMENT_MAX_MB`.
- Image OCR is performed using `tesseract.js` in the Next.js backend.
- For production, replace the in-memory job queue with Redis or a durable queue.

## Example voice prompts

- "What’s new in my inbox today?"
- "Summarize the latest email from Google security."
- "What’s in the PDF attachment from finance?"
- "Do any emails mention an interview this week?"
