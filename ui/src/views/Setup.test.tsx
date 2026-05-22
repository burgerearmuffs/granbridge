import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { Setup } from "./Setup";
it("submits a start_game command", () => {
  const send = vi.fn();
  render(<Setup send={send} />);
  fireEvent.change(screen.getByLabelText("players"), { target: { value: "Ann, Bo" } });
  fireEvent.click(screen.getByText("Start Game"));
  const cmd = send.mock.calls[0][0];
  expect(cmd.command).toBe("start_game");
  expect(cmd.players).toEqual(["Ann", "Bo"]);
  expect(cmd.mode).toBe("x01");
});

describe("Setup Count-Up", () => {
  it("offers Count-Up and reveals the rounds input when selected", () => {
    render(<Setup send={vi.fn()} />);
    const modeSelect = screen.getByLabelText("Mode");
    fireEvent.change(modeSelect, { target: { value: "count_up" } });
    expect(screen.getByLabelText(/rounds/i)).toBeInTheDocument();
  });

  it("submits start_game with the count_up mode and rounds option", () => {
    const send = vi.fn();
    render(<Setup send={send} />);
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "count_up" } });
    fireEvent.change(screen.getByLabelText("players"), { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ command: "start_game", mode: "count_up", options: expect.objectContaining({ rounds: 8 }) }),
    );
  });
});
