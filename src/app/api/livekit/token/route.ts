import { NextResponse } from "next/server";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { nanoid } from "nanoid";
import { env } from "@/lib/config";

export async function POST() {
  // Each web client gets a unique identity for LiveKit presence.
  const identity = `web-${nanoid(8)}`;
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity
  });

  // Configure room defaults so the agent auto-joins the correct room.
  const roomConfig = new RoomConfiguration({
    name: env.LIVEKIT_ROOM,
    agents: [new RoomAgentDispatch({ agentName: "voice_inbox" })]
  });
  token.roomConfig = roomConfig;

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
