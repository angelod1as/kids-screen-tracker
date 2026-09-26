"use client";

import { useEffect, useRef } from "react";

import type { MovementPreview } from "../app/actions/ledger";
import { Button } from "./button";
import { formatHours } from "./hours";
import { Panel } from "./panel";
import {
  balanceToneClass,
  META_CLASS,
  NAV_SAFE_BOTTOM_CLASS,
  READOUT_CLASS,
  ROW_CLASS,
  SHELL_CLASS,
  SURFACE_BG_CLASS,
} from "./style";

/**
 * D53. Covers the screen with no motion; the name is the largest thing because
 * it is what gets mistaken. *Confirmar* sits high and *Cancelar* low, so the
 * thumb that tapped the form's button at the bottom lands on cancel.
 */
export function ConfirmMovement({
  action,
  busy,
  confirmLabel,
  onCancel,
  onConfirm,
  preview,
}: {
  action: string;
  busy: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  preview: MovementPreview;
}) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => dialog.current?.focus(), []);

  return (
    <div
      aria-label={confirmLabel}
      aria-modal="true"
      className={`${SURFACE_BG_CLASS} ${NAV_SAFE_BOTTOM_CLASS} fixed inset-0 z-10 overflow-y-auto`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
      ref={dialog}
      role="dialog"
      tabIndex={-1}
    >
      <div className={`${SHELL_CLASS} flex min-h-full flex-col gap-6 p-4`}>
        <Panel title="Confirme antes">
          <div className="px-3 pt-4 pb-3">
            <p className={`${META_CLASS} text-black`}>Menino</p>
            <p className="break-words text-5xl font-bold text-black">
              {preview.displayName}
            </p>
          </div>
          <dl className="text-black">
            <div className={ROW_CLASS}>
              <dt className={META_CLASS}>Ação</dt>
              <dd className="text-lg font-bold">{action}</dd>
            </div>
            <div className={ROW_CLASS}>
              <dt className={META_CLASS}>Horas</dt>
              <dd className={READOUT_CLASS}>{formatHours(preview.hours)}</dd>
            </div>
            <div className={ROW_CLASS}>
              <dt className={META_CLASS}>Saldo</dt>
              <dd className={READOUT_CLASS}>
                <span className={balanceToneClass(preview.before)}>
                  {formatHours(preview.before)}
                </span>
                {" → "}
                <span className={balanceToneClass(preview.after)}>
                  {formatHours(preview.after)}
                </span>
              </dd>
            </div>
          </dl>
        </Panel>

        <Button disabled={busy} onClick={onConfirm} type="button">
          {confirmLabel}
        </Button>

        {/* Gone while the write is out: it could no longer cancel it, and the secondary variant has no disabled look. */}
        {busy ? null : (
          <div className="mt-auto pt-6">
            <Button onClick={onCancel} type="button" variant="secondary">
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
