/**
 * D58 (emenda à D41/D53): one short line, not the old paragraph. Shown to the
 * adult who just took or approved hours — the app still knows nothing about the
 * device (D41); this is only a nudge to go turn it on.
 */
export const DEVICE_REMINDER_TEXT = "Pronto. Agora ligue o aparelho.";

export function DeviceReminder() {
  return (
    <p className="text-base font-bold text-black">{DEVICE_REMINDER_TEXT}</p>
  );
}
