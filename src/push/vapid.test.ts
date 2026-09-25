import { describe, expect, it } from "vitest";
import webpush from "web-push";

import { publicKeyOf } from "./vapid";

describe("the public key (D51)", () => {
  it("is the one web-push pairs with the private key", () => {
    for (let pair = 0; pair < 5; pair++) {
      const keys = webpush.generateVAPIDKeys();

      expect(publicKeyOf(keys.privateKey)).toBe(keys.publicKey);
    }
  });
});
