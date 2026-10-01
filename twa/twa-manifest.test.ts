import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "../src/app/manifest";
import { ACCENT_HEX, SURFACE_HEX } from "../src/ui/style";

const template = JSON.parse(
  readFileSync(join(__dirname, "twa-manifest.template.json"), "utf8"),
);

describe("the APK template (D54)", () => {
  it("carries the web manifest's name and colours", () => {
    const web = manifest();

    expect(template.name).toBe(web.name);
    expect(template.launcherName).toBe(web.short_name);
    expect(template.themeColor).toBe(ACCENT_HEX);
    expect(template.navigationColor).toBe(ACCENT_HEX);
    expect(template.backgroundColor).toBe(SURFACE_HEX);
  });

  it("reuses the icons in public/ (D46)", () => {
    for (const icon of [template.iconUrl, template.maskableIconUrl]) {
      expect(existsSync(join(__dirname, "..", "public", icon))).toBe(true);
    }
  });

  it("keeps domain, package and key out of the repository", () => {
    expect(template.host).toBe("");
    expect(template.packageId).toBe("");
    expect(template.signingKey).toEqual({ path: "", alias: "" });
  });
});
