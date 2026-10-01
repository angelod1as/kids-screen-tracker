/** Digital Asset Links that let the APK open full screen, without the URL bar (D54). */
export function assetLinks(
  packageId: string | undefined,
  fingerprints: string | undefined,
) {
  const certs = (fingerprints ?? "")
    .split(",")
    .map((fingerprint) => fingerprint.trim().toUpperCase())
    .filter(Boolean);

  const name = packageId?.trim();
  if (!name || certs.length === 0) {
    return [];
  }

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: name,
        sha256_cert_fingerprints: certs,
      },
    },
  ];
}
