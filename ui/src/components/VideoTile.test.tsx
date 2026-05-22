import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VideoTile } from "./VideoTile";

describe("VideoTile", () => {
  it("renders the label", () => {
    render(<VideoTile stream={null} label="Ada (you)" />);
    expect(screen.getByText("Ada (you)")).toBeInTheDocument();
  });

  it("shows an avatar when there is no stream and an avatarName is given", () => {
    render(<VideoTile stream={null} label="Bob" avatarName="Bob" avatarColor="#3b82f6" />);
    expect(screen.getByRole("img", { name: /bob avatar/i })).toBeInTheDocument();
  });
});
