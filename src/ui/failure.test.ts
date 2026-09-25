import { describe, expect, it } from "vitest";

import {
  failureKind,
  failureText,
  REFUSED_TEXT,
  RESYNCED_TEXT,
  timerFailureText,
  UNCERTAIN_TEXT,
} from "./failure";

/**
 * The shapes a browser actually receives: only Next's `digest` error is certainly
 * the server's answer; `fetch`'s `TypeError`, Safari's `AbortError` and a proxy's
 * 502 may come after the write was committed.
 */

const NETWORK = new TypeError("Failed to fetch");
const ABORTED = new DOMException("The operation was aborted.", "AbortError");
const PROXY = new Error("An unexpected response was received from the server.");
const REFUSED = Object.assign(
  new Error(
    "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.",
  ),
  { digest: "1234567890" },
);

describe("which failure it was (#29)", () => {
  it("reads an error the server answered with, digest and all, as a refusal", () => {
    expect(failureKind(REFUSED, true)).toBe("refused");
  });

  it.each([
    { label: "a fetch that got no answer", error: NETWORK },
    { label: "a request the browser aborted", error: ABORTED },
    { label: "a proxy page instead of an answer", error: PROXY },
    { label: "something that is not an error at all", error: "boom" },
    {
      label: "an empty digest",
      error: Object.assign(new Error(), { digest: "" }),
    },
  ])("reads $label as uncertain", ({ error }) => {
    expect(failureKind(error, true)).toBe("uncertain");
  });

  it("reads even a refusal as uncertain while the phone says it is offline", () => {
    expect(failureKind(REFUSED, false)).toBe("uncertain");
  });
});

describe("what the screen says (#29)", () => {
  it("never tells an adult nothing was saved when the write may have happened", () => {
    for (const error of [NETWORK, ABORTED, PROXY]) {
      expect(failureText(error, true)).toBe(UNCERTAIN_TEXT);
    }

    expect(UNCERTAIN_TEXT).toMatch(/não dá para saber se o pedido foi salvo/);
    expect(UNCERTAIN_TEXT).toMatch(/só então tente de novo/);
  });

  it("says the server refused only when it did", () => {
    expect(failureText(REFUSED, true)).toBe(REFUSED_TEXT);
    expect(REFUSED_TEXT).toMatch(/^O servidor recusou/);
  });

  it("claims nothing it cannot know, in any sentence", () => {
    for (const text of [
      UNCERTAIN_TEXT,
      REFUSED_TEXT,
      RESYNCED_TEXT,
      timerFailureText(NETWORK, true),
      timerFailureText(REFUSED, true),
    ]) {
      expect(text).not.toMatch(/nada foi salvo/);
      expect(text).not.toMatch(/problema está no servidor/);
      expect(text).not.toMatch(/nada se perde/);
      expect(text).not.toBe("Não deu para fazer isso agora. Tente de novo.");
    }
  });

  it("does not repeat the server's message, whatever it carries", () => {
    const leaky = Object.assign(new Error("log 7 cannot be approved yet"), {
      digest: "1",
    });

    expect(failureText(leaky, true)).not.toContain("log 7");
    expect(timerFailureText(leaky, true)).not.toContain("log 7");
  });

  it("tells the boy a failed connection does not erase his session (D16)", () => {
    for (const error of [NETWORK, ABORTED, REFUSED]) {
      expect(timerFailureText(error, true)).toContain(
        "O cronômetro fica guardado lá",
      );
    }

    expect(timerFailureText(ABORTED, true)).toContain(
      "uma falha de conexão não apaga a sessão",
    );
  });
});
