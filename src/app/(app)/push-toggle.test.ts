import { describe, expect, it } from "vitest";
import webpush from "web-push";

import { sameKey } from "./conta/push-toggle";

describe("a subscription made under another key (D51)", () => {
  const current = webpush.generateVAPIDKeys().publicKey;
  const previous = webpush.generateVAPIDKeys().publicKey;

  function held(publicKey: string): ArrayBuffer {
    return new Uint8Array(Buffer.from(publicKey, "base64url")).buffer;
  }

  it("is recognised as the server's when the key matches", () => {
    expect(sameKey(held(current), current)).toBe(true);
  });

  it("is not, after the key is rotated", () => {
    expect(sameKey(held(previous), current)).toBe(false);
  });

  it("is not when the browser does not say", () => {
    expect(sameKey(null, current)).toBe(false);
  });
});
