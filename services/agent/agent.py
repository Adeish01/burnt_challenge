import asyncio
import json
import os
import logging
from dotenv import load_dotenv
import httpx
from livekit import agents, api, rtc
import livekit.plugins.openai as openai
import livekit.plugins.silero as silero

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("voice_inbox_agent")

# Next.js API base URL that serves /api/assistant/*
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3000")

# OpenAI models used by the LiveKit agent runtime.
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "coral")
OPENAI_TTS_INSTRUCTIONS = os.getenv(
    "OPENAI_TTS_INSTRUCTIONS",
    "Speak in a natural, conversational tone at a moderate pace. "
    "Use brief pauses between thoughts and slight variation in intonation. "
    "Avoid a robotic cadence.",
)

# LiveKit data topics shared with the web UI.
SOURCES_TOPIC = "inbox.sources"
TTS_CONFIG_TOPIC = "inbox.tts.config"

# Small-talk handled locally to avoid unnecessary API calls.
SMALL_TALK = {
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "how are you",
    "what's up",
    "whats up",
    "yo",
}


class InboxAgent(agents.Agent):
    """LiveKit Agent that delegates inbox questions to the Next.js API."""

    def __init__(self):
        vad = silero.VAD.load()
        streaming_stt = agents.stt.StreamAdapter(stt=openai.STT(), vad=vad)
        self.tts_model = OPENAI_TTS_MODEL
        self.tts_voice = OPENAI_TTS_VOICE
        self.tts_instructions = OPENAI_TTS_INSTRUCTIONS
        # Define Agent's personality and behavior in the instructions, and set up tools and plugins.
        super().__init__(
            instructions=(
                "You are a voice gateway for an email assistant. "
                "For every user question, call the tool ask_inbox with the question. "
                "Do not answer directly."
            ),
            stt=streaming_stt, #Ear
            tts=openai.TTS(
                model=self.tts_model,
                voice=self.tts_voice,
                instructions=self.tts_instructions,
            ), #Mouth
            llm=openai.LLM(model=OPENAI_MODEL), #Brain
            vad=vad, 
            turn_detection="vad",
        )

    #Dynamic settings to updater e.g change "Voice" or "AI Model"
    def update_tts_config(self, model: str | None = None, voice: str | None = None):
        next_model = model or self.tts_model
        next_voice = voice or self.tts_voice
        if next_model == self.tts_model and next_voice == self.tts_voice:
            return
        self.tts_model = next_model
        self.tts_voice = next_voice
        self._tts = openai.TTS(
            model=self.tts_model,
            voice=self.tts_voice,
            instructions=self.tts_instructions,
        )
        logger.info(
            "updated tts config",
            extra={"model": self.tts_model, "voice": self.tts_voice},
        )

    #  @agents.function_tool() Turns method into a tool that the agent can call for every question.
    @agents.function_tool()
    async def ask_inbox(self, ctx: agents.RunContext, question: str) -> str:
        normalized = question.strip().lower()
        if normalized in SMALL_TALK:
            return "Hi! Ask me anything about your inbox, emails, or attachments."

        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{APP_BASE_URL}/api/assistant/ask", json={"question": question}
            )
            if response.status_code >= 400:
                try:
                    data = response.json()
                    message = data.get("error") or data.get("message") or "Unknown error"
                except Exception:
                    message = response.text or "Unknown error"
                return f"I couldn't reach the inbox service: {message}"
            data = response.json()

            # Helper to publish sources (emails) to the web UI in real-time as they are extracted.
            async def publish_sources(payload):
                try:
                    room = ctx.session.room_io.room
                    await room.local_participant.publish_data(
                        json.dumps({"type": "sources", "sources": payload}),
                        topic=SOURCES_TOPIC,
                    )
                except Exception as exc:
                    logger.warning("failed to publish sources", extra={"error": str(exc)})

            if data.get("status") == "processing":
                # Long-running attachment extraction: speak first, then poll.
                await ctx.session.say(
                    data.get("message", "This may take a minute."),
                    allow_interruptions=True,
                )

                job_id = data.get("jobId")
                if not job_id:
                    return "I couldn't start the background job."

                for _ in range(45):
                    await asyncio.sleep(2)
                    job_res = await client.get(
                        f"{APP_BASE_URL}/api/assistant/jobs/{job_id}"
                    )
                    if job_res.status_code != 200:
                        continue
                    job_data = job_res.json()
                    if job_data.get("status") == "done":
                        sources = job_data.get("sources") or []
                        if sources:
                            await publish_sources(sources)
                        return job_data.get("answer", "")
                    if job_data.get("status") == "error":
                        return f"There was an error: {job_data.get('error', 'unknown')}"

                return "That is taking longer than expected. Please try again."

            sources = data.get("sources") or []
            if sources:
                await publish_sources(sources)
            return data.get("answer", "No answer returned.")

# Main entry point for the agent. Connects to LiveKit, sets up event handlers, and starts the agent session.
async def main() -> None:
    room_name = os.getenv("LIVEKIT_ROOM", "voice-inbox")
    identity = f"agent-{os.urandom(3).hex()}"

    # Mint a LiveKit token for the agent to join the room as a data/audio participant.
    token = (
        api.AccessToken()
        .with_identity(identity)
        .with_name("Voice Inbox Agent")
        .with_kind("agent")
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
                agent=True,
            )
        )
        .to_jwt()
    )

    logger.info("connecting agent to room %s", room_name)
    room = rtc.Room()
    await room.connect(os.getenv("LIVEKIT_URL", "ws://localhost:7880"), token)
    logger.info("connected as %s", identity)

    session = agents.AgentSession()
    agent = InboxAgent()

    @room.on("data_received")
    def _on_data(packet: rtc.DataPacket):
        if packet.topic != TTS_CONFIG_TOPIC:
            return
        try:
            payload = packet.data
            if isinstance(payload, memoryview):
                payload = payload.tobytes()
            if isinstance(payload, (bytes, bytearray)):
                payload = payload.decode("utf-8")
            config = json.loads(payload)
        except Exception as exc:
            logger.warning("failed to parse tts config", extra={"error": str(exc)})
            return
        if config.get("type") != "tts_config":
            return
        model = config.get("model")
        voice = config.get("voice")
        agent.update_tts_config(model=model, voice=voice)

    session.on("user_input_transcribed", lambda ev: logger.info("user said: %s", ev.transcript))
    session.on("conversation_item_added", lambda ev: logger.info("assistant: %s", ev.item))
    await session.start(
        agent=agent,
        room=room,
        room_options=agents.room_io.RoomOptions(close_on_disconnect=False),
    )
    logger.info("agent session started")

    done = asyncio.Event()

    @room.on("disconnected")
    def _on_disconnect(*_args):
        done.set()

    await done.wait()


if __name__ == "__main__":
    logger.info("starting LiveKit agent (direct connect)")
    asyncio.run(main())
