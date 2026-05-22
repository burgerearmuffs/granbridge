import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Controls } from "./Controls";

describe("Controls", () => {
  it("clicking Next calls send with next_player", () => {
    const send = vi.fn();
    render(<Controls send={send} />);
    fireEvent.click(screen.getByText("Next"));
    expect(send).toHaveBeenCalledWith({ command: "next_player" });
  });

  it("clicking Miss calls send with record_miss", () => {
    const send = vi.fn();
    render(<Controls send={send} />);
    fireEvent.click(screen.getByText("Miss"));
    expect(send).toHaveBeenCalledWith({ command: "record_miss" });
  });

  it("clicking Undo calls send with undo", () => {
    const send = vi.fn();
    render(<Controls send={send} />);
    fireEvent.click(screen.getByText("Undo"));
    expect(send).toHaveBeenCalledWith({ command: "undo" });
  });

  it("clicking End calls send with end_game", () => {
    const send = vi.fn();
    render(<Controls send={send} />);
    fireEvent.click(screen.getByText("End"));
    expect(send).toHaveBeenCalledWith({ command: "end_game" });
  });

  it("entering T20 and clicking Correct calls send with correct_last bed T20", () => {
    const send = vi.fn();
    render(<Controls send={send} />);
    fireEvent.change(screen.getByLabelText("bed"), { target: { value: "T20" } });
    fireEvent.click(screen.getByText("Correct"));
    expect(send).toHaveBeenCalledWith({ command: "correct_last", bed: "T20" });
  });

  it("Correct with lowercase bed uppercases it", () => {
    const send = vi.fn();
    render(<Controls send={send} />);
    fireEvent.change(screen.getByLabelText("bed"), { target: { value: "t20" } });
    fireEvent.click(screen.getByText("Correct"));
    expect(send).toHaveBeenCalledWith({ command: "correct_last", bed: "T20" });
  });

  it("Correct with empty bed does not call send", () => {
    const send = vi.fn();
    render(<Controls send={send} />);
    fireEvent.click(screen.getByText("Correct"));
    expect(send).not.toHaveBeenCalled();
  });
});
