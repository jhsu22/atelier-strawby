import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Drawer({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const start = useRef<number | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`drawer ${wide ? "drawer-wide" : ""}`}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
          ),
        ].filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === last &&
          first
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target !== dialog.current) return;
        const rect = dialog.current.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close.current();
      }}
    >
      <div
        className="drawer-top"
        onPointerDown={(event) => {
          if (event.pointerType === "touch") start.current = event.clientY;
        }}
        onPointerUp={(event) => {
          if (start.current !== null && event.clientY - start.current > 90)
            close.current();
          start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button drawer-close"
          aria-label="Close panel"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <div className="drawer-body">{children}</div>
    </dialog>
  );
}
