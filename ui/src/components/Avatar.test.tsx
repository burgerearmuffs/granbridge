import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders the initials for the name", () => {
    render(<Avatar name="Ada Lovelace" color="#f59e0b" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("exposes an accessible label and applies the background color", () => {
    render(<Avatar name="Bob" color="#3b82f6" />);
    const el = screen.getByRole("img", { name: /bob avatar/i });
    expect(el).toBeInTheDocument();
    expect(el).toHaveStyle({ backgroundColor: "#3b82f6" });
  });
});
