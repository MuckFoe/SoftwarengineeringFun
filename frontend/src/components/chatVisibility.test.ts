import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_VISIBILITY_KEY,
  loadChatVisibility,
  saveChatVisibility,
  useChatVisible,
} from "./chatVisibility";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error("storage blocked");
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

describe("loadChatVisibility / saveChatVisibility", () => {
  // FR-4
  it("uses the key chatVisible", () => {
    expect(CHAT_VISIBILITY_KEY).toBe("chatVisible");
  });

  it("is shown with nothing stored", () => {
    expect(loadChatVisibility()).toBe("shown");
  });

  it("round-trips hidden and shown", () => {
    saveChatVisibility("hidden");
    expect(localStorage.getItem("chatVisible")).toBe("hidden");
    expect(loadChatVisibility()).toBe("hidden");
    saveChatVisibility("shown");
    expect(localStorage.getItem("chatVisible")).toBe("shown");
    expect(loadChatVisibility()).toBe("shown");
  });

  it("is shown for a junk value", () => {
    localStorage.setItem("chatVisible", "maybe");
    expect(loadChatVisibility()).toBe("shown");
  });

  it("falls back to shown and never throws when storage throws", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(loadChatVisibility()).toBe("shown");
    expect(() => saveChatVisibility("hidden")).not.toThrow();
  });
});

describe("useChatVisible", () => {
  // FR-4
  it("starts visible with nothing stored", () => {
    const { result } = renderHook(() => useChatVisible());
    expect(result.current[0]).toBe(true);
  });

  it("stores hidden on setVisible(false) and shown on setVisible(true)", () => {
    const { result } = renderHook(() => useChatVisible());
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem("chatVisible")).toBe("hidden");
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem("chatVisible")).toBe("shown");
  });

  it("a fresh render starts from the stored value", () => {
    const first = renderHook(() => useChatVisible());
    act(() => first.result.current[1](false));
    first.unmount();
    const second = renderHook(() => useChatVisible());
    expect(second.result.current[0]).toBe(false);
  });
});
