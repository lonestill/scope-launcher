import { useLayoutEffect, useRef } from "react";

const dialogs: HTMLElement[] = [];
const inertLocks = new Map<HTMLElement, { count: number; previous: boolean }>();
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keeps keyboard and assistive-technology navigation inside the active dialog. */
export function useDialogFocus(open: boolean, onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const locked: HTMLElement[] = [];
    for (let node: HTMLElement = dialog; node.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        const lock = inertLocks.get(sibling) || { count: 0, previous: sibling.inert };
        lock.count += 1;
        inertLocks.set(sibling, lock);
        sibling.inert = true;
        locked.push(sibling);
      }
      if (node.parentElement === document.body) break;
    }
    dialogs.push(dialog);
    const isTop = () => dialogs.at(-1) === dialog;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.tabIndex >= 0 && !element.closest('[inert]') && element.getClientRects().length > 0);
    const focusFirst = () => {
      const preferred = dialog.querySelector<HTMLElement>('input[autofocus], input, select, textarea');
      (preferred && focusable().includes(preferred) ? preferred : focusable()[0] || dialog).focus({ preventScroll: true });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current?.();
      } else if (event.key === "Tab") {
        const items = focusable();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length || index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) || dialog : items[0] || dialog).focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocus);
    if (!dialog.contains(document.activeElement)) focusFirst();
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocus);
      dialogs.splice(dialogs.indexOf(dialog), 1);
      for (const element of locked) {
        const lock = inertLocks.get(element)!;
        if (--lock.count === 0) {
          element.inert = lock.previous;
          inertLocks.delete(element);
        }
      }
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
