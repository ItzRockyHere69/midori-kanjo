"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visibleFocusableElements(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

function closeLabelForTitle(title: string) {
  if (/[\u0980-\u09ff]/u.test(title)) return `${title} বন্ধ করুন`;
  if (/[\u0900-\u097f]/u.test(title)) return `${title} बंद करें`;
  return `Close ${title}`;
}

export function useDialogFocus(
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document === "undefined"
      ? null
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
  );

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const restoreFocus = restoreFocusRef.current;

    const modalRoot = panel.closest<HTMLElement>("[data-dialog-backdrop]");
    const siblings = modalRoot?.parentElement
      ? [...modalRoot.parentElement.children].filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element !== modalRoot,
        )
      : [];
    const siblingState = siblings.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    siblings.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarGap > 0)
      document.body.style.paddingRight = `${scrollbarGap}px`;

    const focusInitial = window.requestAnimationFrame(() => {
      const explicit =
        initialFocusRef?.current ||
        panel.querySelector<HTMLElement>("[data-dialog-initial-focus]") ||
        panel.querySelector<HTMLElement>("[autofocus]");
      const target = explicit || visibleFocusableElements(panel)[0] || panel;
      target.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const openDialogs = [
        ...document.querySelectorAll<HTMLElement>("[data-dialog-backdrop]"),
      ].filter((element) => element.getClientRects().length > 0);
      if (modalRoot && openDialogs.at(-1) !== modalRoot) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = visibleFocusableElements(panel);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusInitial);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPaddingRight;
      siblingState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });

      window.requestAnimationFrame(() => {
        if (restoreFocus?.isConnected) {
          restoreFocus.focus({ preventScroll: true });
          return;
        }
        document
          .querySelector<HTMLElement>('[aria-current="page"]')
          ?.focus({ preventScroll: true });
      });
    };
  }, [initialFocusRef]);

  return panelRef;
}

export function AccessibleSheet({
  title,
  onClose,
  children,
  panelClassName = "max-w-xl",
  backdropClassName = "z-50 bg-[#102d27]/45",
  scrollClassName = "p-3.5 pb-8 md:p-5",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
  backdropClassName?: string;
  scrollClassName?: string;
}) {
  const titleId = useId();
  const panelRef = useDialogFocus(onClose);
  return (
    <div
      data-dialog-backdrop
      className={`sheet-backdrop fixed inset-0 ${backdropClassName} backdrop-blur-[2px]`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[94dvh] flex-col rounded-t-[28px] bg-[#fbfaf6] shadow-2xl ${panelClassName}`}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[#ddd7ca] px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="h-1.5 w-10 shrink-0 rounded-full bg-[#d6d0c4] md:hidden"
              aria-hidden="true"
            />
            <h2 id={titleId} className="truncate text-base font-black">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabelForTitle(title)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#eeeae1] text-xl font-black"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className={`sheet-scroll overflow-y-auto ${scrollClassName}`}>
          {children}
        </div>
      </section>
    </div>
  );
}
