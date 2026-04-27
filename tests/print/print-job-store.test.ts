// T019 — Unit tests for src/print/print-job-store.ts.
//
// Uses `createIsolatedStore` for the bulk of assertions so the
// singleton's persisted localStorage doesn't bleed across tests. The
// "subscribe fires synchronously" and "resetPrintJob clears storage"
// cases use the singleton directly to verify the public API.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __flushPersistForTests,
  __resetPersistForTests,
  __resetSingletonForTests,
  createIsolatedStore,
  getPrintJob,
  resetPrintJob,
  setPrintJob,
  subscribe,
} from "../../src/print/print-job-store";

beforeEach(() => {
  __resetSingletonForTests();
  __resetPersistForTests();
});

afterEach(() => {
  __resetSingletonForTests();
  __resetPersistForTests();
});

describe("isolated store — validation", () => {
  it("clamps ceilingHeightMm to [1500, 6000]", () => {
    const s = createIsolatedStore();
    const tooHigh = s.setPrintJob({ room: { ceilingHeightMm: 7000 } });
    expect(tooHigh.room.ceilingHeightMm).toBe(6000);
    const tooLow = s.setPrintJob({ room: { ceilingHeightMm: 500 } });
    expect(tooLow.room.ceilingHeightMm).toBe(1500);
  });

  it("falls back to Letter when custom paper is out of bounds", () => {
    const s = createIsolatedStore();
    const out = s.setPrintJob({
      outputOptions: { paper: { kind: "custom", widthMm: 50, heightMm: 100 } },
    });
    expect(out.outputOptions.paper.kind).toBe("preset");
    if (out.outputOptions.paper.kind === "preset") {
      expect(out.outputOptions.paper.preset).toBe("letter");
    }
  });

  it("accepts in-bounds custom paper", () => {
    const s = createIsolatedStore();
    const out = s.setPrintJob({
      outputOptions: { paper: { kind: "custom", widthMm: 200, heightMm: 300 } },
    });
    expect(out.outputOptions.paper).toEqual({
      kind: "custom",
      widthMm: 200,
      heightMm: 300,
    });
  });

  it("clamps observer eyeHeightMm to [1000, 2200]", () => {
    const s = createIsolatedStore();
    const tooTall = s.setPrintJob({
      room: { observerPositionMm: { xMm: 0, yMm: 0, eyeHeightMm: 9999 } },
    });
    expect(tooTall.room.observerPositionMm.eyeHeightMm).toBe(2200);
  });

  it("round-trips observerPositionMm verbatim within bounds (FR-006)", () => {
    const s = createIsolatedStore();
    const out = s.setPrintJob({
      room: { observerPositionMm: { xMm: 100, yMm: 200, eyeHeightMm: 1700 } },
    });
    expect(out.room.observerPositionMm.xMm).toBe(100);
    expect(out.room.observerPositionMm.yMm).toBe(200);
    expect(out.room.observerPositionMm.eyeHeightMm).toBe(1700);
    // Subsequent get returns the same values.
    expect(s.getPrintJob().room.observerPositionMm).toEqual({
      xMm: 100,
      yMm: 200,
      eyeHeightMm: 1700,
    });
  });

  it("truncates vertices below 3 by falling back to previous", () => {
    const s = createIsolatedStore();
    const before = s.getPrintJob().room.vertices.length;
    s.setPrintJob({ room: { vertices: [{ xMm: 0, yMm: 0 }] } });
    expect(s.getPrintJob().room.vertices.length).toBe(before);
  });

  it("drops features whose outline is degenerate", () => {
    const s = createIsolatedStore();
    s.setPrintJob({
      room: {
        features: [
          {
            id: "bad",
            type: "window",
            label: "Bad",
            surfaceId: "wall-0",
            paint: false,
            outline: [{ uMm: 0, vMm: 0 }, { uMm: 1, vMm: 1 }], // < 3 pts
          },
        ],
      },
    });
    expect(s.getPrintJob().room.features.length).toBe(0);
  });
});

describe("singleton — subscribe + reset", () => {
  it("subscribe fires synchronously on every change", () => {
    const events: number[] = [];
    const unsub = subscribe((job) => events.push(job.room.ceilingHeightMm));
    setPrintJob({ room: { ceilingHeightMm: 2000 } });
    setPrintJob({ room: { ceilingHeightMm: 2500 } });
    expect(events).toEqual([2000, 2500]);
    unsub();
  });

  it("resetPrintJob discards persisted state and returns defaults", () => {
    setPrintJob({ room: { ceilingHeightMm: 2000 } });
    __flushPersistForTests();
    resetPrintJob();
    // After reset, getPrintJob is the default (2438 mm).
    expect(getPrintJob().room.ceilingHeightMm).toBe(2438);
    // localStorage entry must be gone too.
    expect(window.localStorage.getItem("skyViewer.printJob")).toBeNull();
  });

  it("persists across __resetSingletonForTests via debounce flush", () => {
    setPrintJob({ room: { ceilingHeightMm: 2100 } });
    __flushPersistForTests();
    __resetSingletonForTests();
    expect(getPrintJob().room.ceilingHeightMm).toBe(2100);
  });
});
