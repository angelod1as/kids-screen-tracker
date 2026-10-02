import Link from "next/link";

import {
  ACCENT_BG_CLASS,
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

export type ChoiceLink = {
  href: string;
  label: string;
  chosen: boolean;
};

/** `ChoiceGroup` as links: a filter that lives in the URL needs no client code. */
export function ChoiceLinks({
  label,
  options,
}: {
  label: string;
  options: readonly ChoiceLink[];
}) {
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-black">
        {label}
      </span>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <Link
            aria-current={option.chosen ? "page" : undefined}
            className={`${TOUCH_TARGET_CLASS} ${BORDER_CLASS} ${CONTROL_RADIUS_CLASS} flex items-center justify-center break-words px-2 py-2 text-center text-base font-bold ${
              option.chosen
                ? `${ACCENT_BG_CLASS} text-white`
                : "bg-white text-black"
            }`}
            href={option.href}
            key={option.href}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
