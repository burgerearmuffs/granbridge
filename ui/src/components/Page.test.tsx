import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader, Section, EmptyState } from "./Page";

describe("PageHeader", () => {
  it("renders the title as a heading", () => {
    render(<PageHeader title="My Title" />);
    expect(screen.getByRole("heading", { name: "My Title" })).toBeInTheDocument();
  });

  it("defaults to h2 heading level", () => {
    render(<PageHeader title="Hello" />);
    const heading = screen.getByRole("heading", { name: "Hello" });
    expect(heading.tagName).toBe("H2");
  });

  it("accepts a custom heading level", () => {
    render(<PageHeader title="Top" level={1} />);
    const heading = screen.getByRole("heading", { name: "Top" });
    expect(heading.tagName).toBe("H1");
  });
});

describe("Section", () => {
  it("renders the section heading text", () => {
    render(<Section heading="Player Stats">content here</Section>);
    expect(screen.getByRole("heading", { name: "Player Stats" })).toBeInTheDocument();
  });

  it("renders children inside the section", () => {
    render(<Section heading="My Section"><span>child text</span></Section>);
    expect(screen.getByText("child text")).toBeInTheDocument();
  });

  it("heading element is h2 by default", () => {
    render(<Section heading="Stats">stuff</Section>);
    const heading = screen.getByRole("heading", { name: "Stats" });
    expect(heading.tagName).toBe("H2");
  });
});

describe("EmptyState", () => {
  it("renders the message text", () => {
    render(<EmptyState message="No stats recorded yet." />);
    expect(screen.getByText("No stats recorded yet.")).toBeInTheDocument();
  });

  it("renders an optional icon node when provided", () => {
    render(<EmptyState message="Empty" icon={<span data-testid="my-icon">★</span>} />);
    expect(screen.getByTestId("my-icon")).toBeInTheDocument();
  });

  it("renders without an icon by default", () => {
    const { container } = render(<EmptyState message="Nothing here." />);
    // No icon wrapper should inject extra non-text elements
    expect(container.querySelectorAll("[data-testid]").length).toBe(0);
  });
});
