"use client";

import { useEffect, useState } from "react";

import { Button } from "../../../ui/button";
import { PanelText } from "../../../ui/panel";
import { savePushSubscriptionAction } from "../../actions/push";

export type PushState =
  | "checking"
  | "unconfigured"
  | "unsupported"
  | "blocked"
  | "off"
  | "on"
  | "failed";

/** What each state says; `off` and `failed` also show the button. */
export const PUSH_TEXT: Record<PushState, string> = {
  checking: "Verificando os avisos deste aparelho.",
  unconfigured: "Os avisos ainda não foram configurados no servidor.",
  unsupported:
    "Este navegador não recebe avisos. No iPhone, abra o app instalado na tela inicial.",
  blocked:
    "Avisos bloqueados neste aparelho. Libere nos ajustes do telefone para ativar.",
  off: "Avisos não ativados neste aparelho.",
  on: "Avisos ativados neste aparelho.",
  failed: "Não deu para ativar os avisos. Tente de novo.",
};

function supported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Chrome and Safari both take the key as bytes. */
function keyBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function sameKey(held: ArrayBuffer | null, publicKey: string): boolean {
  if (held === null) return false;

  const expected = keyBytes(publicKey);
  const actual = new Uint8Array(held);

  return (
    actual.length === expected.length &&
    actual.every((byte, index) => byte === expected[index])
  );
}

/**
 * D51. iOS asks for permission only from a tap, so nothing here asks on load.
 * An existing subscription is saved again on load: the same phone under
 * another login moves to it.
 */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (publicKey === null) {
      setState("unconfigured");
      return;
    }

    if (!supported()) {
      setState("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (subscription) => {
        if (subscription === null || Notification.permission !== "granted") {
          setState("off");
          return;
        }

        // Made under a key the server no longer holds: every push to it fails.
        if (!sameKey(subscription.options.applicationServerKey, publicKey)) {
          await subscription.unsubscribe();
          setState("off");
          return;
        }

        await savePushSubscriptionAction(subscription.toJSON());
        setState("on");
      })
      .catch(() => setState("off"));
  }, [publicKey]);

  async function enable() {
    if (publicKey === null) return;

    setBusy(true);

    try {
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });

      await savePushSubscriptionAction(subscription.toJSON());
      setState("on");
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PanelText>{PUSH_TEXT[state]}</PanelText>
      {state === "off" || state === "failed" ? (
        <div className="px-3 pb-3">
          <Button disabled={busy} onClick={enable} type="button">
            Ativar avisos
          </Button>
        </div>
      ) : null}
    </>
  );
}
