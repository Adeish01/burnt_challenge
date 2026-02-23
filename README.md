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

Copy `.env.example` to `.env` and fill in your credentials:

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

### 2) Install dependencies

```
npm install
```

### 3) Run LiveKit locally

```
livekit-server --dev
```

### 4) Start the Next.js app

```
npm run dev
```

### 5) Run the voice agent

The voice agent uses LiveKit + OpenAI for STT/TTS and calls the Next.js API.

```
cd services/agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python agent.py
```

## Notes

- Attachment extraction is capped by `ATTACHMENT_MAX_MB`.
- Image OCR is performed using `tesseract.js` in the Next.js backend.
- For production, replace the in-memory job queue with Redis or a durable queue.

## Example voice prompts

- "What’s new in my inbox today?"
- "Summarize the latest email from Google security."
- "What’s in the PDF attachment from finance?"
- "Do any emails mention an interview this week?"
