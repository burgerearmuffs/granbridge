import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Dartboard } from "./Dartboard";

describe("Dartboard", () => {
  it("renders an SVG element", () => {
    const { container } = render(<Dartboard />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("has a data-bed='T20' element", () => {
    const { container } = render(<Dartboard />);
    const el = container.querySelector("[data-bed='T20']");
    expect(el).not.toBeNull();
  });

  it("has a data-bed='D20' element", () => {
    const { container } = render(<Dartboard />);
    const el = container.querySelector("[data-bed='D20']");
    expect(el).not.toBeNull();
  });

  it("has a data-bed='S20' element", () => {
    const { container } = render(<Dartboard />);
    const el = container.querySelector("[data-bed='S20']");
    expect(el).not.toBeNull();
  });

  it("has a data-bed='BULL' element", () => {
    const { container } = render(<Dartboard />);
    const el = container.querySelector("[data-bed='BULL']");
    expect(el).not.toBeNull();
  });

  it("has a data-bed='DBULL' element", () => {
    const { container } = render(<Dartboard />);
    const el = container.querySelector("[data-bed='DBULL']");
    expect(el).not.toBeNull();
  });

  it("with highlight='T20', the T20 region carries the highlight class", () => {
    const { container } = render(<Dartboard highlight="T20" />);
    const el = container.querySelector("[data-bed='T20']");
    expect(el).not.toBeNull();
    expect(el!.classList.contains("dartboard-hit")).toBe(true);
  });

  it("with highlight='T20', the T20 region has the highlight fill", () => {
    const { container } = render(<Dartboard highlight="T20" />);
    const el = container.querySelector("[data-bed='T20']");
    expect(el!.getAttribute("fill")).toBe("#ffd54a");
  });

  it("with highlight='D16', the D16 region carries the highlight class", () => {
    const { container } = render(<Dartboard highlight="D16" />);
    const el = container.querySelector("[data-bed='D16']");
    expect(el).not.toBeNull();
    expect(el!.classList.contains("dartboard-hit")).toBe(true);
  });

  it("with highlight='DBULL', the DBULL region carries the highlight class", () => {
    const { container } = render(<Dartboard highlight="DBULL" />);
    const el = container.querySelector("[data-bed='DBULL']");
    expect(el!.classList.contains("dartboard-hit")).toBe(true);
  });

  it("non-highlighted elements do not carry the highlight class", () => {
    const { container } = render(<Dartboard highlight="T20" />);
    const d1 = container.querySelector("[data-bed='D1']");
    expect(d1).not.toBeNull();
    expect(d1!.classList.contains("dartboard-hit")).toBe(false);
  });

  it("without highlight prop, no element has the highlight class", () => {
    const { container } = render(<Dartboard />);
    const highlighted = container.querySelectorAll(".dartboard-hit");
    expect(highlighted.length).toBe(0);
  });
});
