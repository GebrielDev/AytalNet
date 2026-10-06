import { ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  title: string;
  /** Shown under the title. Used here to state the exact range a list covers. */
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * A floating layer over the page.
 *
 * The other pages each hand-roll this overlay, and none of them handles
 * Escape, focus or the scrollbar, so a keyboard user can tab out of the dialog
 * into the page behind it and has no way to dismiss it without a mouse. This
 * exists to be shared rather than copied a fifth time.
 */
export default function Modal({ open, title, subtitle, onClose, children }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    if (!open) return;

    // Where focus came from, so it can be handed back on close. Without this
    // it falls to the top of the document and the card that was clicked is
    // lost.
    const opener = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;

      // Keep Tab inside the dialog: the page behind is inert to the eye but
      // not to the keyboard.
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // The page behind must not scroll under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the panel itself rather than its first control, so a screen reader
    // reads the title before anything else.
    panel.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  // Rendered into document.body rather than in place, for two reasons found by
  // driving this in a browser:
  //
  //  - The dashboard wraps its sections in `space-y-6`, whose
  //    `> * + *` rule gave this element margin-top: 24px. A fixed box with
  //    inset-0 and a top margin is pushed down and shrinks, so the backdrop
  //    covered 696px of a 720px viewport and left a live, clickable strip of
  //    page across the top.
  //  - Any ancestor with a transform, filter or its own stacking context would
  //    otherwise decide where this can paint.
  //
  // z-[60] rather than z-50: the sidebar in Layout.tsx is also z-50, and at
  // equal z-index it was winning in the top-left corner, leaving its
  // navigation clickable through the overlay.
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start sm:items-center justify-center z-[60] p-4 overflow-y-auto"
      // A click on the backdrop closes; one inside the panel must not, so this
      // checks the click landed on the backdrop itself.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-auto outline-none"
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-gray-900">
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className="text-xs text-gray-500 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}
