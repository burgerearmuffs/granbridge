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

  describe("tilt + dart props", () => {
    it("defaults to flat (no perspective wrapper) so History is unaffected", () => {
      const { container } = render(<Dartboard />);
      expect(container.querySelector(".dartboard-3d")).toBeNull();
    });
    it("applies the play-tilt wrapper class when tilt='play'", () => {
      const { container } = render(<Dartboard tilt="play" />);
      expect(container.querySelector(".dartboard-3d.tilt-play")).not.toBeNull();
    });
    it("renders a dart-landing marker when a dart bed is given", () => {
      const { container } = render(<Dartboard tilt="play" dart="T20" />);
      expect(container.querySelector("[data-dart-marker]")).not.toBeNull();
    });
  });

  describe("heatmap prop", () => {
    it("T20 (count=10) has a stronger heat fill than S1 (count=1)", () => {
      const { container } = render(
        <Dartboard heatmap={{ T20: 10, S1: 1 }} />
      );

      // There may be multiple elements with data-bed='T20' (outer+inner single share the key,
      // but T20 is the treble, so there is exactly one treble path).
      // We look at the first matching element for each bed.
      const t20Els = container.querySelectorAll("[data-bed='T20']");
      const s1Els = container.querySelectorAll("[data-bed='S1']");

      expect(t20Els.length).toBeGreaterThan(0);
      expect(s1Els.length).toBeGreaterThan(0);

      // T20 is the maximum (count=10, intensity=1.0) → fill-opacity should be 1.0
      // S1 has intensity=0.1 → fill-opacity should be lower.
      // We check the first element for each bed.
      const t20Opacity = parseFloat(t20Els[0].getAttribute("fill-opacity") ?? "1");
      const s1Opacity = parseFloat(s1Els[0].getAttribute("fill-opacity") ?? "1");

      // T20 should be brighter (higher opacity) than S1
      expect(t20Opacity).toBeGreaterThan(s1Opacity);
    });

    it("highlight wins over heatmap: highlighted bed has highlight fill, not heat", () => {
      const { container } = render(
        <Dartboard highlight="T20" heatmap={{ T20: 10 }} />
      );
      const el = container.querySelector("[data-bed='T20']");
      expect(el!.getAttribute("fill")).toBe("#ffd54a");
      expect(el!.classList.contains("dartboard-hit")).toBe(true);
    });

    it("beds with no heatmap hits keep a defined non-transparent fill", () => {
      const { container } = render(
        <Dartboard heatmap={{ T20: 5 }} />
      );
      // S1 is not in the heatmap, so it should have no fill-opacity attribute
      const s1 = container.querySelector("[data-bed='S1']");
      expect(s1).not.toBeNull();
      expect(s1!.getAttribute("fill-opacity")).toBeNull();
    });
  });
});
