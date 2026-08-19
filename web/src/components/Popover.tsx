import { useEffect, type RefObject } from "react";

/**
 * Закрывает всплывающий блок по клику мимо и по Escape.
 *
 * Нативные `<select>` и `<input type="date">` на Windows рисуются системой и не
 * поддаются оформлению, поэтому и список городов, и календарь у нас свои —
 * а им нужна общая логика закрытия.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

/** Общий вид всплывающей панели: над полем, с прокруткой и тенью. */
export const POPOVER =
  "tb-scroll absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-2xl bg-tb-panel shadow-2xl ring-1 ring-tb-line";
