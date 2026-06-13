/**
 * Onboarding — step flow, profile writes, recovery-key copy, persistence flags.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  Onboarding,
  isOnboarded,
  markOnboarded,
  isKeyBackedUp,
} from "./Onboarding";
import { getOrCreatePlayer } from "../multiplayer/player";
import { exportRecoveryKey } from "../multiplayer/recoveryKey";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("flags", () => {
  it("isOnboarded flips after markOnboarded", () => {
    expect(isOnboarded()).toBe(false);
    markOnboarded();
    expect(isOnboarded()).toBe(true);
  });
});

describe("Onboarding flow", () => {
  it("walks profile → tour → recovery and calls onDone at finish", () => {
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);

    // Step 1: profile
    const nameInput = screen.getByRole("textbox", { name: /display name/i });
    fireEvent.change(nameInput, { target: { value: "Willa" } });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(getOrCreatePlayer().name).toBe("Willa");

    // Step 2: tour
    expect(screen.getByText(/three places to know/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    // Step 3: recovery
    expect(screen.getByRole("heading", { name: /back up your recovery key/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /finish without backing up/i }));
    expect(onDone).toHaveBeenCalled();
    expect(isOnboarded()).toBe(true);
  });

  it("copying the key marks it backed up and writes the real key", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<Onboarding onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy recovery key/i }));
    });
    expect(writeText).toHaveBeenCalledWith(exportRecoveryKey(getOrCreatePlayer()));
    expect(isKeyBackedUp()).toBe(true);
    expect(screen.getByText(/copied to clipboard/i)).toBeInTheDocument();
  });

  it("skip on step one finishes immediately and sets the flag", () => {
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: /skip setup/i }));
    expect(onDone).toHaveBeenCalled();
    expect(isOnboarded()).toBe(true);
  });

  it("avatar color choice persists to the profile", () => {
    render(<Onboarding onDone={() => {}} />);
    const swatches = screen.getAllByRole("button", { name: /avatar color #/i });
    fireEvent.click(swatches[2]);
    const expected = swatches[2].getAttribute("aria-label")!.replace("Avatar color ", "");
    expect(getOrCreatePlayer().avatar.color).toBe(expected);
  });
});
