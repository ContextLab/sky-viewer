// T051 — Persistence round-trip for the singleton print-job-store.
//
// FR-019: room footprint, ceiling height, room features (with paint
// flags), observer position, per-surface enable map, "Block horizon
// on walls" flag, "Include constellation lines" flag, paper size, and
// units MUST persist across reloads on the same device.
//
// Strategy:
//   1. Reset the singleton + storage to a known baseline.
//   2. Push a non-default value into every persisted field via
//      `setPrintJob`.
//   3. Force the debounced persistence to flush immediately.
//   4. Drop the in-memory singleton; on next access the store re-loads
//      from localStorage.
//   5. Assert deep equality of the loaded job vs. the saved one
//      (modulo `lastComputedAt`, which is null in both).
//
// We avoid `createIsolatedStore` here on purpose — that factory bypasses
// localStorage entirely and would not exercise the persistence path.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __flushPersistForTests,
  __resetPersistForTests,
  __resetSingletonForTests,
  getPrintJob,
  setPrintJob,
} from "../../src/print/print-job-store";
import type { RoomFeature } from "../../src/print/types";

beforeEach(() => {
  __resetSingletonForTests();
  __resetPersistForTests();
});

afterEach(() => {
  __resetSingletonForTests();
  __resetPersistForTests();
});

describe("print-job-store persistence round-trip (T051 / FR-019)", () => {
  it("reloads every persisted field byte-for-byte after singleton reset", () => {
    // 1. Modify ceiling height + observer position.
    setPrintJob({
      room: {
        ceilingHeightMm: 2700,
        observerPositionMm: { xMm: 100, yMm: 200, eyeHeightMm: 1700 },
      },
    });

    // 2. Add a no-paint light fixture feature.
    const lightFixture: RoomFeature = {
      id: "feat-test-1",
      type: "lightFixture",
      label: "Ceiling fan",
      surfaceId: "ceiling",
      paint: false,
      outline: [
        { uMm: 1500, vMm: 1500 },
        { uMm: 2000, vMm: 1500 },
        { uMm: 2000, vMm: 2000 },
        { uMm: 1500, vMm: 2000 },
      ],
    };
    setPrintJob({ room: { features: [lightFixture] } });

    // 3. Set output options.
    setPrintJob({
      outputOptions: {
        paper: { kind: "preset", preset: "a4" },
        blockHorizonOnWalls: false,
        includeConstellationLines: true,
        displayUnits: "metric",
      },
    });

    // 4. Toggle some surface enables.
    setPrintJob({
      room: {
        surfaceEnable: {
          ceiling: true,
          floor: true,
          walls: { "wall-0": true, "wall-2": true },
        },
      },
    });

    // 5. Snapshot the saved job before reset.
    const saved = getPrintJob();
    expect(saved.room.ceilingHeightMm).toBe(2700);
    expect(saved.room.observerPositionMm).toEqual({ xMm: 100, yMm: 200, eyeHeightMm: 1700 });
    expect(saved.room.features).toHaveLength(1);
    expect(saved.outputOptions.paper).toEqual({ kind: "preset", preset: "a4" });
    expect(saved.outputOptions.blockHorizonOnWalls).toBe(false);
    expect(saved.outputOptions.includeConstellationLines).toBe(true);
    expect(saved.outputOptions.displayUnits).toBe("metric");

    // 6. Flush + reset the singleton.
    __flushPersistForTests();
    __resetSingletonForTests();

    // 7. The next getPrintJob() reads the persisted value back.
    const loaded = getPrintJob();

    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.room.ceilingHeightMm).toBe(saved.room.ceilingHeightMm);
    expect(loaded.room.observerPositionMm).toEqual(saved.room.observerPositionMm);
    expect(loaded.room.vertices).toEqual(saved.room.vertices);
    expect(loaded.room.features).toEqual(saved.room.features);
    expect(loaded.room.surfaceEnable).toEqual(saved.room.surfaceEnable);
    expect(loaded.outputOptions).toEqual(saved.outputOptions);
    expect(loaded.observation).toEqual(saved.observation);
  });

  it("preserves a feature's paint flag across reload (FR-019)", () => {
    const paintedClosetDoor: RoomFeature = {
      id: "feat-painted-1",
      type: "closet",
      label: "Painted closet",
      surfaceId: "wall-0",
      paint: true, // paint=true is non-default per FR-005
      outline: [
        { uMm: 0, vMm: 0 },
        { uMm: 800, vMm: 0 },
        { uMm: 800, vMm: 2000 },
        { uMm: 0, vMm: 2000 },
      ],
    };
    setPrintJob({ room: { features: [paintedClosetDoor] } });

    __flushPersistForTests();
    __resetSingletonForTests();

    const loaded = getPrintJob();
    expect(loaded.room.features).toHaveLength(1);
    expect(loaded.room.features[0]?.paint).toBe(true);
    expect(loaded.room.features[0]?.label).toBe("Painted closet");
  });
});
