/**
 * TurnClock — countdown, reset on player change, urgency styling, off state.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TurnClock } from "./TurnClock";

afterEach(() => {
  vi.useRealTimers();
});

describe("TurnClock", () => {
  it("renders nothing when seconds is 0", () => {
    render(<TurnClock seconds={0} resetKey="a" running />);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("counts down once per second and floors at 0:00", () => {
    vi.useFakeTimers();
    render(<TurnClock seconds={3} resetKey="a" running />);
    expect(screen.getByRole("timer")).toHaveTextContent("0:03");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("timer")).toHaveTextContent("0:02");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
  });

  it("resets when resetKey changes (new active player)", () => {
    vi.useFakeTimers();
    const { rerender } = render(<TurnClock seconds={30} resetKey="p0" running />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole("timer")).toHaveTextContent("0:20");
    rerender(<TurnClock seconds={30} resetKey="p1" running />);
    expect(screen.getByRole("timer")).toHaveTextContent("0:30");
  });

  it("pauses when not running", () => {
    vi.useFakeTimers();
    render(<TurnClock seconds={30} resetKey="a" running={false} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole("timer")).toHaveTextContent("0:30");
  });

  it("formats minutes", () => {
    vi.useFakeTimers();
    render(<TurnClock seconds={90} resetKey="a" running />);
    expect(screen.getByRole("timer")).toHaveTextContent("1:30");
  });
});
