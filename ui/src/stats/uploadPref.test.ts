// ui/src/stats/uploadPref.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getUploadEnabled, setUploadEnabled } from "./uploadPref";

beforeEach(() => localStorage.clear());

describe("uploadPref", () => {
  it("defaults to enabled", () => { expect(getUploadEnabled()).toBe(true); });
  it("round-trips false/true", () => {
    setUploadEnabled(false); expect(getUploadEnabled()).toBe(false);
    setUploadEnabled(true); expect(getUploadEnabled()).toBe(true);
  });
});
