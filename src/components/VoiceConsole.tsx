"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ConnectionState,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack
} from "livekit-client";

const statusCopy: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  connected: "Connected",
  error: "Connection error"
};

const agentStateCopy: Record<string, string> = {
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  idle: "Idle",
  unknown: "Active"
};

type TranscriptLine = {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: string;
};

const AGENT_EVENTS_TOPIC = "lk.agent.events";

export default function VoiceConsole() {
  const [status, setStatus] = useState<keyof typeof statusCopy>(
    "disconnected"
  );
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [level, setLevel] = useState(0);
  const [agentState, setAgentState] = useState<keyof typeof agentStateCopy>(
    "listening"
  );
  const roomRef = useRef<Room | null>(null);
  const micRef = useRef<LocalAudioTrack | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const sawAgentEventsRef = useRef(false);

  const statusLabel = useMemo(() => {
    if (status !== "connected") {
      return statusCopy[status];
    }
    return `${statusCopy.connected} · ${agentStateCopy[agentState]}`;
  }, [agentState, status]);

  const pushLine = useCallback((role: "user" | "agent", text: string) => {
    setLines((prev) => [
      {
        id: crypto.randomUUID(),
        role,
        text,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      },
      ...prev
    ]);
  }, []);

  const handleAgentEvent = useCallback(
    (payload: string) => {
      try {
        const parsed = JSON.parse(payload) as {
          type?: string;
          transcript?: string;
          is_final?: boolean;
          item?: { role?: string; content?: Array<string | { text?: string }> };
          new_state?: string;
          message?: string;
        };

        sawAgentEventsRef.current = true;

        if (parsed.type === "user_input_transcribed") {
          if (parsed.is_final && parsed.transcript) {
            pushLine("user", parsed.transcript);
            setAgentState("thinking");
          }
          return;
        }

        if (parsed.type === "conversation_item_added") {
          if (parsed.item?.role !== "assistant") {
            return;
          }
          const raw = parsed.item?.content?.[0];
          const content =
            typeof raw === "string" ? raw : raw?.text;
          if (content) {
            pushLine("agent", content);
          }
          return;
        }

        if (parsed.type === "agent_state_changed" && parsed.new_state) {
          if (parsed.new_state === "listening") {
            setStatus("connected");
          }
          if (parsed.new_state in agentStateCopy) {
            setAgentState(parsed.new_state as keyof typeof agentStateCopy);
          }
          return;
        }

        if (parsed.type === "error" && parsed.message) {
          pushLine("agent", `Error: ${parsed.message}`);
        }
      } catch (err) {
        console.error("Failed to parse agent event", err);
      }
    },
    [pushLine]
  );

  const stopMeter = useCallback(() => {
    if (meterRafRef.current) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const startMeter = useCallback((track: MediaStreamTrack) => {
    stopMeter();
    const audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
    source.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 1.8));
      meterRafRef.current = requestAnimationFrame(tick);
    };
    meterRafRef.current = requestAnimationFrame(tick);
  }, [stopMeter]);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    try {
      const res = await fetch("/api/livekit/token", { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to fetch LiveKit token");
      }
      const { token, url } = (await res.json()) as { token: string; url: string };
      const room = new Room({
        adaptiveStream: true,
        dynacast: true
      });

      room.on(RoomEvent.Connected, () => {
        setStatus("connected");
        setAgentState("listening");
      });
      room.on(RoomEvent.Disconnected, () => {
        setStatus("disconnected");
        room.unregisterTextStreamHandler(AGENT_EVENTS_TOPIC);
      });
      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Disconnected) {
          setStatus("disconnected");
        }
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio && audioRef.current) {
          track.attach(audioRef.current);
        }
      });
      // Transcription fallback disabled to avoid duplicate lines.

      room.registerTextStreamHandler(AGENT_EVENTS_TOPIC, async (reader) => {
        const payload = await reader.readAll();
        handleAgentEvent(payload);
      });

      await room.connect(url, token);
      const mic = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      });
      await room.localParticipant.publishTrack(mic);
      startMeter(mic.mediaStreamTrack);

      roomRef.current = room;
      micRef.current = mic;
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, [handleAgentEvent, startMeter]);

  const disconnect = useCallback(async () => {
    try {
      await micRef.current?.stop();
      roomRef.current?.disconnect();
      stopMeter();
    } finally {
      setStatus("disconnected");
    }
  }, [stopMeter]);

  const canConnect = status === "disconnected" || status === "error";
  const canDisconnect = status === "connected" || status === "connecting";

  return (
    <main>
      <div className="app-shell">
        <section className="card">
          <div className="kicker">Voice Inbox Assistant</div>
          <h1 className="title">Ask your inbox, hands-free.</h1>
          <p className="subtitle">
            Speak naturally. The assistant reads, summarizes, and answers questions
            about email bodies and attachments, then follows up when a response
            needs extra processing.
          </p>

          <div className={`status-pill ${status === "error" ? "error" : status === "connected" ? "success" : ""}`}>
            {statusLabel}
          </div>
          {error ? <p className="notes">{error}</p> : null}

          <div className="level-meter" aria-hidden="true">
            <div
              className="level-bar"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>

          <div className="voice-controls">
            <button className="mic-button" onClick={connect} disabled={!canConnect}>
              Connect & Start Listening
            </button>
            <button
              className="mic-button secondary"
              onClick={disconnect}
              disabled={!canDisconnect}
            >
              Disconnect
            </button>
          </div>

          <div className="feature-list">
            <div>
              <span className="tag">Full Inbox</span> Voice-first access with no manual email selection.
            </div>
            <div>
              <span className="tag">Attachments</span> PDF, DOCX, and image OCR with delay-aware responses.
            </div>
            <div>
              <span className="tag">Status</span> The assistant tells you when answers take time.
            </div>
          </div>

          <p className="notes">
            Tip: Try “Summarize today’s important emails” or “What’s in the PDF
            attachment from finance?”
          </p>
        </section>

        <section className="card">
          <div className="kicker">Conversation</div>
          <h2 className="title">Transcript</h2>
          {status === "connected" && agentState !== "listening" ? (
            <div className="status-note">
              Assistant is {agentStateCopy[agentState].toLowerCase()}...
            </div>
          ) : null}
          <div className="transcript">
            {lines.length === 0 ? (
              <div className="line">Your transcript will appear here.</div>
            ) : (
              lines.map((line) => (
                <div key={line.id} className={`line ${line.role}`}>
                  <strong>{line.role === "user" ? "You" : "Assistant"}</strong>
                  {" · "}
                  <span style={{ color: "var(--text-muted)" }}>{line.timestamp}</span>
                  <div>{line.text}</div>
                </div>
              ))
            )}
          </div>
          <audio ref={audioRef} autoPlay playsInline />
        </section>
      </div>
    </main>
  );
}
