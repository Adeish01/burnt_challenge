import { NextResponse } from "next/server";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { nanoid } from "nanoid";
import { env } from "@/lib/config";

export async function POST() {
  const identity = `web-${nanoid(8)}`;
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity
  });

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
