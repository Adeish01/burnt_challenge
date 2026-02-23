import asyncio
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

APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3000")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

class InboxAgent(agents.Agent):
    def __init__(self):
        vad = silero.VAD.load()
        streaming_stt = agents.stt.StreamAdapter(stt=openai.STT(), vad=vad)
        super().__init__(
            instructions=(
                "You are a voice gateway for an email assistant. "
                "For every user question, call the tool ask_inbox with the question. "
            "Do not answer directly."
        ),
        stt=streaming_stt,
        tts=openai.TTS(),
        llm=openai.LLM(model=OPENAI_MODEL),
        vad=vad,
        turn_detection="vad",
    )

    @agents.function_tool()
    async def ask_inbox(self, ctx: agents.RunContext, question: str) -> str:
        normalized = question.strip().lower()
        small_talk = {
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
        if normalized in small_talk:
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

            if data.get("status") == "processing":
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
                        return job_data.get("answer", "")
                    if job_data.get("status") == "error":
                        return f"There was an error: {job_data.get('error', 'unknown')}"

                return "That is taking longer than expected. Please try again."

            return data.get("answer", "No answer returned.")


async def main() -> None:
    room_name = os.getenv("LIVEKIT_ROOM", "voice-inbox")
    identity = f"agent-{os.urandom(3).hex()}"

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
