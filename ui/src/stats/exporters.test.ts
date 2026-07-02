import { describe, it, expect } from "vitest";
import { throwsToCsv, exportFilename } from "./exporters";
import type { HistoryDump } from "./exporters";

const DUMP: HistoryDump = {
  schema: "granbridge.history.v1",
  exported_at: "2026-07-02T00:00:00.000Z",
  games: [
    {
      id: 1,
      mode: "x01",
      players: ["Ann", "Bob"],
      options: { start_score: 501 },
      winner: "Ann",
      started_at: "2026-07-01T10:00:00.000Z",
      ended_at: "2026-07-01T10:20:00.000Z",
      throws: [
        { player: "Ann", bed: "T20", score: 60, ts: "2026-07-01T10:00:05.000Z" },
        { player: "Bob", bed: "S5", score: 5, ts: "2026-07-01T10:00:30.000Z" },
      ],
    },
    {
      id: 2,
      mode: "cricket",
      players: ["Cy, Jr."], // comma in a field must be quoted
      options: {},
      winner: null,
      started_at: "2026-07-02T09:00:00.000Z",
      ended_at: null,
      throws: [{ player: "Cy, Jr.", bed: "S19", score: 19, ts: "2026-07-02T09:00:10.000Z" }],
    },
  ],
};

describe("throwsToCsv", () => {
  it("emits a header plus one row per throw", () => {
    const lines = throwsToCsv(DUMP).trim().split("\n");
    expect(lines[0]).toBe("game_id,mode,players,winner,started_at,ended_at,player,bed,score,ts");
    expect(lines).toHaveLength(1 + 3);
    expect(lines[1]).toBe(
      "1,x01,Ann | Bob,Ann,2026-07-01T10:00:00.000Z,2026-07-01T10:20:00.000Z,Ann,T20,60,2026-07-01T10:00:05.000Z",
    );
  });

  it("quotes fields containing commas and leaves null winner/ended empty", () => {
    const lines = throwsToCsv(DUMP).trim().split("\n");
    const cricket = lines[3];
    expect(cricket).toContain('"Cy, Jr."');
    // winner and ended_at are empty fields
    expect(cricket).toBe(
      '2,cricket,"Cy, Jr.",,2026-07-02T09:00:00.000Z,,"Cy, Jr.",S19,19,2026-07-02T09:00:10.000Z',
    );
  });

  it("escapes embedded quotes per RFC 4180", () => {
    const dump: HistoryDump = {
      ...DUMP,
      games: [
        {
          ...DUMP.games[0],
          players: ['The "Ace"'],
          throws: [{ player: 'The "Ace"', bed: "D16", score: 32, ts: "t" }],
        },
      ],
    };
    const row = throwsToCsv(dump).trim().split("\n")[1];
    expect(row).toContain('"The ""Ace"""');
  });

  it("handles an empty dump", () => {
    const csv = throwsToCsv({ schema: "granbridge.history.v1", exported_at: "t", games: [] });
    expect(csv.trim().split("\n")).toHaveLength(1); // header only
  });
});

describe("exportFilename", () => {
  it("stamps the extension and date", () => {
    expect(exportFilename("json", new Date("2026-07-02T12:34:00Z"))).toBe(
      "granbridge-history-2026-07-02.json",
    );
    expect(exportFilename("csv", new Date("2026-07-02T12:34:00Z"))).toBe(
      "granbridge-history-2026-07-02.csv",
    );
  });
});
