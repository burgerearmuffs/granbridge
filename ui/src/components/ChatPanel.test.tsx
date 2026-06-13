/**
 * ChatPanel — transcript rendering, send flow, unread badge, collapse/expand.
 * mpSession is mocked; chat state is driven through useMpStore directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMpStore } from "../multiplayer/store";

const mockSession = vi.hoisted(() => ({ sendChat: vi.fn() }));
vi.mock("../multiplayer/session", () => ({ mpSession: mockSession }));

import { ChatPanel } from "./ChatPanel";

beforeEach(() => {
  useMpStore.setState({ chatMessages: [], chatUnread: 0 });
  vi.clearAllMocks();
});

describe("ChatPanel open", () => {
  it("renders messages with You/opponent labels", () => {
    useMpStore.setState({
      chatMessages: [
        { self: true, name: "Me", text: "good luck", ts: 1 },
        { self: false, name: "Bo", text: "you too", ts: 2 },
      ],
    });
    render(<ChatPanel startOpen />);
    expect(screen.getByRole("log")).toHaveTextContent("You: good luck");
    expect(screen.getByRole("log")).toHaveTextContent("Bo: you too");
  });

  it("sends on button click and on Enter, clearing the draft", () => {
    render(<ChatPanel startOpen />);
    const input = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.change(input, { target: { value: "nice ton!" } });
    fireEvent.click(screen.getByRole("button", { name: /send chat message/i }));
    expect(mockSession.sendChat).toHaveBeenCalledWith("nice ton!");
    expect((input as HTMLInputElement).value).toBe("");

    fireEvent.change(input, { target: { value: "again" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSession.sendChat).toHaveBeenCalledWith("again");
  });

  it("does not send empty drafts", () => {
    render(<ChatPanel startOpen />);
    const input = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSession.sendChat).not.toHaveBeenCalled();
  });

  it("clears the unread count while open", () => {
    useMpStore.setState({ chatUnread: 3 });
    render(<ChatPanel startOpen />);
    expect(useMpStore.getState().chatUnread).toBe(0);
  });
});

describe("ChatPanel collapsed", () => {
  it("shows the unread badge and opens on click", () => {
    useMpStore.setState({ chatUnread: 2 });
    render(<ChatPanel />);
    expect(screen.getByTestId("chat-unread")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }));
    expect(screen.getByRole("log")).toBeInTheDocument();
    expect(useMpStore.getState().chatUnread).toBe(0);
  });

  it("collapse button returns to the badge view", () => {
    render(<ChatPanel startOpen />);
    fireEvent.click(screen.getByRole("button", { name: /collapse chat/i }));
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open chat/i })).toBeInTheDocument();
  });
});

describe("chat store", () => {
  it("caps the transcript at 200 lines", () => {
    const add = useMpStore.getState().addChatMessage;
    for (let i = 0; i < 210; i++) add({ self: false, name: "Bo", text: `m${i}`, ts: i });
    const msgs = useMpStore.getState().chatMessages;
    expect(msgs).toHaveLength(200);
    expect(msgs[0].text).toBe("m10");
  });

  it("increments unread only when asked", () => {
    const add = useMpStore.getState().addChatMessage;
    add({ self: true, name: "Me", text: "mine", ts: 1 });
    expect(useMpStore.getState().chatUnread).toBe(0);
    add({ self: false, name: "Bo", text: "theirs", ts: 2 }, { unread: true });
    expect(useMpStore.getState().chatUnread).toBe(1);
  });
});

describe("ChatPanel readOnly (spectator)", () => {
  it("shows the transcript but no input or send button", () => {
    useMpStore.setState({
      chatMessages: [{ self: false, name: "Ann", text: "watch this", ts: 1 }],
    });
    render(<ChatPanel startOpen readOnly />);
    expect(screen.getByRole("log")).toHaveTextContent("Ann: watch this");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send chat message/i })).not.toBeInTheDocument();
  });
});
