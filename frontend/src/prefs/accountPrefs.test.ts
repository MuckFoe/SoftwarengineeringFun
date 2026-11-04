import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  putPreferences: vi.fn(() => Promise.resolve({ appearance: "system", chat_visible: true })),
}));

import { putPreferences } from "../api/client";
import type { Me, Preferences } from "../api/types";
import { useChatVisible } from "../components/chatVisibility";
import { useAppearance } from "../theme/useAppearance";
import { savePreference, syncOnLoad } from "./accountPrefs";

const put = vi.mocked(putPreferences);
const signedOut: Me = { signed_in: false, roles: [] };
const newuser = (preferences: Preferences | null): Me => ({
  signed_in: true,
  name: "newuser",
  roles: [],
  preferences,
});

const appearanceAttr = () => document.documentElement.getAttribute("data-appearance");

beforeEach(() => {
  syncOnLoad(signedOut);
  put.mockClear();
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-appearance");
});

describe("syncOnLoad", () => {
  // FR-16
  it("signed in with no preferences yet PUTs this browser's values", () => {
    localStorage.setItem("appearance", "dark");
    localStorage.setItem("chatVisible", "hidden");
    syncOnLoad(newuser(null));
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith({ appearance: "dark", chat_visible: false });
  });

  it("PUTs chat shown when this browser has nothing stored for it", () => {
    localStorage.setItem("appearance", "dark");
    syncOnLoad(newuser(null));
    expect(put).toHaveBeenCalledWith({ appearance: "dark", chat_visible: true });
  });

  // FR-15
  it("signed in with preferences writes them to localStorage, the store and the page", () => {
    const { result } = renderHook(() => ({ a: useAppearance(), c: useChatVisible() }));
    expect(result.current.c[0]).toBe(true);
    act(() => syncOnLoad(newuser({ appearance: "dark", chat_visible: false })));
    expect(localStorage.getItem("appearance")).toBe("dark");
    expect(localStorage.getItem("chatVisible")).toBe("hidden");
    expect(appearanceAttr()).toBe("dark");
    expect(result.current.a.choice).toBe("dark");
    expect(result.current.c[0]).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  // FR-17
  it("signing out after a signed-in sync to dark leaves the browser dark", () => {
    syncOnLoad(newuser({ appearance: "dark", chat_visible: true }));
    syncOnLoad(signedOut);
    expect(localStorage.getItem("appearance")).toBe("dark");
    expect(appearanceAttr()).toBe("dark");
    expect(put).not.toHaveBeenCalled();
  });
});

describe("savePreference", () => {
  // FR-17
  it("signed out writes localStorage and makes no request", () => {
    savePreference("appearance", "light");
    savePreference("chatVisible", false);
    expect(localStorage.getItem("appearance")).toBe("light");
    expect(localStorage.getItem("chatVisible")).toBe("hidden");
    expect(put).not.toHaveBeenCalled();
  });

  // FR-15
  it("signed in also PUTs the changed preference", () => {
    syncOnLoad(newuser({ appearance: "dark", chat_visible: true }));
    savePreference("appearance", "light");
    expect(put).toHaveBeenLastCalledWith({ appearance: "light" });
    savePreference("chatVisible", false);
    expect(put).toHaveBeenLastCalledWith({ chat_visible: false });
    expect(localStorage.getItem("appearance")).toBe("light");
    expect(localStorage.getItem("chatVisible")).toBe("hidden");
  });

  it("a failed PUT does not throw or undo the change", async () => {
    put.mockRejectedValueOnce(new Error("offline"));
    syncOnLoad(newuser({ appearance: "dark", chat_visible: true }));
    expect(() => savePreference("appearance", "light")).not.toThrow();
    await Promise.resolve();
    expect(localStorage.getItem("appearance")).toBe("light");
  });

  // FR-18
  it("applies appearance at once and re-renders every subscribed hook", () => {
    document.documentElement.setAttribute("data-appearance", "dark");
    const one = renderHook(() => useAppearance());
    const two = renderHook(() => useAppearance());
    const chatA = renderHook(() => useChatVisible());
    const chatB = renderHook(() => useChatVisible());

    act(() => savePreference("appearance", "light"));
    expect(appearanceAttr()).toBe("light");
    expect(one.result.current.choice).toBe("light");
    expect(two.result.current.choice).toBe("light");

    act(() => savePreference("chatVisible", false));
    expect(chatA.result.current[0]).toBe(false);
    expect(chatB.result.current[0]).toBe(false);

    act(() => chatA.result.current[1](true));
    expect(chatB.result.current[0]).toBe(true);
  });

  it("still applies for this page when storage throws", () => {
    const fail = () => {
      throw new Error("storage blocked");
    };
    vi.stubGlobal("localStorage", {
      length: 0,
      clear: fail,
      getItem: fail,
      key: fail,
      removeItem: fail,
      setItem: fail,
    });
    try {
      const { result } = renderHook(() => useChatVisible());
      act(() => savePreference("chatVisible", false));
      expect(result.current[0]).toBe(false);
      act(() => savePreference("appearance", "dark"));
      expect(appearanceAttr()).toBe("dark");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
