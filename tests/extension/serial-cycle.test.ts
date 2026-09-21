import { describe, expect, it } from "vitest";
import { PendingTabClosures, SerialCycle } from "../../extension/background/serial-cycle.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("service worker serial cycle", () => {
  it("does not overlap idle cleanup with command processing", async () => {
    const commandStarted = deferred();
    const releaseCommand = deferred();
    const events: string[] = [];
    const cycle = new SerialCycle(() => { events.push("settled"); });
    let commandsRunning = false;

    const active = cycle.run(async () => {
      commandsRunning = true;
      events.push("commands:start");
      commandStarted.resolve();
      await releaseCommand.promise;
      commandsRunning = false;
      events.push("commands:end");
    });
    await commandStarted.promise;

    const overlappingAlarm = await cycle.run(
      async () => { events.push("commands:unexpected"); },
      async () => { events.push("cleanup:unexpected"); },
    );
    expect(overlappingAlarm).toBe(false);
    expect(events).toEqual(["commands:start"]);

    releaseCommand.resolve();
    await expect(active).resolves.toBe(true);
    const maintenance = await cycle.run(
      async () => {
        commandsRunning = true;
        events.push("commands:next");
        commandsRunning = false;
      },
      async () => {
        expect(commandsRunning).toBe(false);
        events.push("cleanup");
      },
    );

    expect(maintenance).toBe(true);
    expect(events).toEqual(["commands:start", "commands:end", "settled", "commands:next", "cleanup", "settled"]);
  });

  it("releases the boundary and schedules again after work rejects", async () => {
    const events: string[] = [];
    const cycle = new SerialCycle(() => { events.push("settled"); });

    await expect(cycle.run(async () => {
      events.push("failed");
      throw new Error("controlled failure");
    })).rejects.toThrow("controlled failure");
    await expect(cycle.run(async () => { events.push("recovered"); })).resolves.toBe(true);

    expect(events).toEqual(["failed", "settled", "recovered", "settled"]);
  });

  it("drains a delayed tab-close event before a subsequently created record can be lost", async () => {
    const cleanupRemovedTab = deferred();
    const finishCleanup = deferred();
    const events: string[] = [];
    const records = new Map<number, string>([[41, "expired"]]);
    const closures = new PendingTabClosures(async tabId => {
      events.push(`forget:${tabId}`);
      records.delete(tabId);
    });
    const cycle = new SerialCycle(() => { events.push("settled"); });

    const cleanup = cycle.run(
      async () => { events.push("poll"); },
      async () => {
        events.push("cleanup:remove");
        closures.record(41);
        cleanupRemovedTab.resolve();
        await finishCleanup.promise;
        records.delete(41);
        events.push("cleanup:write");
        await closures.drain();
      },
    );
    await cleanupRemovedTab.promise;

    const createNext = cycle.enqueue(async () => {
      records.set(42, "new-page");
      events.push("create:42");
    }, async () => { await closures.drain(); });
    expect(records.get(42)).toBeUndefined();
    finishCleanup.resolve();
    await cleanup;
    await createNext;

    expect([...records]).toEqual([[42, "new-page"]]);
    expect(closures.size).toBe(0);
    expect(events).toEqual([
      "poll", "cleanup:remove", "cleanup:write", "forget:41", "create:42", "settled",
    ]);
  });

  it("retains a failed close event and drains it in a later cycle", async () => {
    let attempts = 0;
    const closures = new PendingTabClosures(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("controlled store failure");
    });
    const cycle = new SerialCycle(() => undefined);
    closures.record(41);

    await cycle.run(async () => undefined, async () => { await closures.drain(); });
    expect(closures.size).toBe(1);
    await cycle.run(async () => undefined, async () => { await closures.drain(); });

    expect(attempts).toBe(2);
    expect(closures.size).toBe(0);
  });
});
