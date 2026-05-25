import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuestControls } from "./GuestControls";
import type { GameState } from "../types";

const base: GameState = {
  mode: "x01", status: "in_progress",
  players: [{ id: "p1", name: "H" }, { id: "p2", name: "G" }],
  active_index: 1, visit: [], legs: {}, sets: {}, winner: null, options: {}, mode_view: {}, stats: {},
};

describe("GuestControls", () => {
  const onAction = vi.fn();
  beforeEach(() => onAction.mockClear());

  it("Miss requests a miss on the guest's turn", () => {
    render(<GuestControls state={base} guestSlot="p2" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /miss/i }));
    expect(onAction).toHaveBeenCalledWith("miss", undefined);
  });

  it("disables Miss/Undo when it is not the guest's turn", () => {
    render(<GuestControls state={{ ...base, active_index: 0 }} guestSlot="p2" onAction={onAction} />);
    expect(screen.getByRole("button", { name: /miss/i })).toBeDisabled();
  });

  it("Correct sends the typed bed", () => {
    render(<GuestControls state={{ ...base, visit: [{ bed: "S1", ring: "SI", segment: 1, multiplier: 1, score: 1 }] }} guestSlot="p2" onAction={onAction} />);
    fireEvent.change(screen.getByLabelText(/bed/i), { target: { value: "t20" } });
    fireEvent.click(screen.getByRole("button", { name: /correct/i }));
    expect(onAction).toHaveBeenCalledWith("correct", "T20");
  });

  it("shows only Rematch when the game is finished", () => {
    render(<GuestControls state={{ ...base, status: "finished" }} guestSlot="p2" onAction={onAction} />);
    expect(screen.queryByRole("button", { name: /^miss$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /rematch/i }));
    expect(onAction).toHaveBeenCalledWith("rematch", undefined);
  });
});
