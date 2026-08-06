import { describe, it, expect, afterEach } from "vitest";
import { describeTransport, getIceServers } from "@/lib/services/liveVideo";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("describeTransport", () => {
  it("labels a real peer-to-peer stream as HD", () => {
    expect(describeTransport("webrtc")).toEqual({ label: "LIVE HD", tone: "live" });
  });

  it("labels the Firestore relay as live (it is, just slower)", () => {
    expect(describeTransport("relay").tone).toBe("relay");
    expect(describeTransport("relay").label).toBe("LIVE");
  });

  it("reports no transport as offline", () => {
    expect(describeTransport("none")).toEqual({ label: "OFFLINE", tone: "off" });
  });
});

describe("getIceServers", () => {
  it("always provides STUN servers so P2P can be attempted", () => {
    delete process.env.NEXT_PUBLIC_TURN_URLS;
    const servers = getIceServers();
    expect(servers.length).toBeGreaterThan(0);
    expect(
      servers.some((s) => String(s.urls).includes("stun:"))
    ).toBe(true);
  });

  it("appends TURN with credentials when configured", () => {
    process.env.NEXT_PUBLIC_TURN_URLS = "turn:turn.example.com:3478,turns:turn.example.com:5349";
    process.env.NEXT_PUBLIC_TURN_USERNAME = "user";
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL = "secret";

    const turn = getIceServers().find((s) => String(s.urls).includes("turn:"));
    expect(turn).toBeDefined();
    expect(turn?.username).toBe("user");
    expect(turn?.credential).toBe("secret");
    expect(Array.isArray(turn?.urls) ? turn?.urls.length : 0).toBe(2);
  });

  it("ignores blank TURN configuration instead of emitting an empty entry", () => {
    process.env.NEXT_PUBLIC_TURN_URLS = "  ,  ";
    delete process.env.NEXT_PUBLIC_TURN_USERNAME;
    delete process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

    expect(getIceServers().every((s) => String(s.urls).length > 0)).toBe(true);
  });
});
