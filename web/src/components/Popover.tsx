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

/** Общий вид всплывающей панели: раскрывается вниз, с прокруткой и тенью. */
export const POPOVER =
  "tb-scroll tb-rise tb-plate absolute top-full z-50 mt-1.5 min-w-full overflow-hidden";
