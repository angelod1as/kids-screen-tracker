import { describe, expect, it } from "vitest";

import { assetLinks } from "./asset-links";

const SHA =
  "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

describe("assetlinks.json (D54)", () => {
  it("delegates every URL to the package signed with the fingerprint", () => {
    expect(assetLinks("app.example.twa", SHA)).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "app.example.twa",
          sha256_cert_fingerprints: [SHA],
        },
      },
    ]);
  });

  it("accepts more than one fingerprint, so a new key can join the old one", () => {
    const other = SHA.replace("14", "AB");

    expect(
      assetLinks("app.example.twa", ` ${SHA.toLowerCase()} , ${other},`)[0]
        ?.target.sha256_cert_fingerprints,
    ).toEqual([SHA, other]);
  });

  it("is empty without a package or a fingerprint", () => {
    expect(assetLinks(undefined, SHA)).toEqual([]);
    expect(assetLinks("app.example.twa", undefined)).toEqual([]);
    expect(assetLinks(" ", SHA)).toEqual([]);
    expect(assetLinks("app.example.twa", " , ")).toEqual([]);
  });
});
