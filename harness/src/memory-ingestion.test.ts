import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "./types.js";

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn((_cmd: string, cb: (err: Error | null) => void) => cb(null)),
}));

import { writeFileSync, mkdirSync } from "node:fs";
import { exec } from "node:child_process";
import { MemoryIngestion } from "./memory-ingestion.js";

const mockMsg = (text: string): IncomingMessage => ({
  channelType: "telegram",
  threadId: "t1",
  text,
  author: "user",
  metadata: {},
});

describe("MemoryIngestion", () => {
  let ingestion: MemoryIngestion;

  beforeEach(() => {
    vi.clearAllMocks();
    ingestion = new MemoryIngestion({
      bufferDir: "/tmp/buffers",
      ingestIntervalMs: 5000,
    });
  });

  it("buffers messages by project", () => {
    ingestion.buffer("alpha", mockMsg("hello"));
    ingestion.buffer("alpha", mockMsg("world"));
    ingestion.buffer("beta", mockMsg("hi"));

    expect(ingestion.getBufferSize("alpha")).toBe(2);
    expect(ingestion.getBufferSize("beta")).toBe(1);
    expect(ingestion.getBufferSize("unknown")).toBe(0);
  });

  it("flushes to disk and calls mempalace mine", async () => {
    ingestion.buffer("alpha", mockMsg("hello"));
    ingestion.buffer("beta", mockMsg("hi"));

    await ingestion.flush();

    expect(mkdirSync).toHaveBeenCalledWith("/tmp/buffers", { recursive: true });
    expect(mkdirSync).toHaveBeenCalledWith("/tmp/buffers/alpha", {
      recursive: true,
    });
    expect(mkdirSync).toHaveBeenCalledWith("/tmp/buffers/beta", {
      recursive: true,
    });
    expect(writeFileSync).toHaveBeenCalledTimes(2);
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/buffers/alpha/alpha.json",
      expect.any(String),
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/buffers/beta/beta.json",
      expect.any(String),
    );
    expect(exec).toHaveBeenCalledWith(
      "mempalace mine /tmp/buffers/alpha --mode convos",
      expect.any(Function),
    );
    expect(exec).toHaveBeenCalledWith(
      "mempalace mine /tmp/buffers/beta --mode convos",
      expect.any(Function),
    );
  });

  it("clears buffer after successful flush", async () => {
    ingestion.buffer("alpha", mockMsg("hello"));
    ingestion.buffer("alpha", mockMsg("world"));

    expect(ingestion.getBufferSize("alpha")).toBe(2);

    await ingestion.flush();

    expect(ingestion.getBufferSize("alpha")).toBe(0);
  });
});
