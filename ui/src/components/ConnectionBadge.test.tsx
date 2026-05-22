import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConnectionBadge } from "./ConnectionBadge";

describe("ConnectionBadge", () => {
  it("shows the connection label text", () => {
    render(<ConnectionBadge connection="connected" />);
    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("shows disconnected label text", () => {
    render(<ConnectionBadge connection="disconnected" />);
    expect(screen.getByText("disconnected")).toBeInTheDocument();
  });

  it("renders a dot element alongside the label", () => {
    const { container } = render(<ConnectionBadge connection="connected" />);
    // The dot is a span with aria-hidden
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeTruthy();
  });
});
