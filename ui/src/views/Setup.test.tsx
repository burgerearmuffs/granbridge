import { render, screen, fireEvent } from "@testing-library/react";
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
