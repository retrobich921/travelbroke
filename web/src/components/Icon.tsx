/**
 * Знаковая система прибора.
 *
 * Эмодзи здесь были бы чужими: их рисует операционная система, они цветные и
 * на Windows выглядят игрушечно. Поэтому два ряда своих знаков:
 * пиктограммы транспорта — заливкой, как на вокзальном табло; органы
 * управления — контуром в 1.6 px. Оба ряда наследуют currentColor.
 */

import { TRANSPORT_PATHS } from "../transport";

/** Органы управления: контур, сетка 24×24. */
const STROKE_PATHS: Record<string, string> = {
  close: "M6 6l12 12M18 6L6 18",
  search: "M10.8 3.6a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4ZM16 16l4.6 4.6",
  chevronDown: "M5.5 9 12 15.2 18.5 9",
  chevronLeft: "M15 4.5 8.2 12l6.8 7.5",
  chevronRight: "M9 4.5 15.8 12 9 19.5",
  arrowRight: "M3.5 12h16.5m-6-6.4 6.4 6.4-6.4 6.4",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  sun: "M12 7.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2ZM12 1.6v2.6M12 19.8v2.6M4.65 4.65 6.5 6.5m11 11 1.85 1.85M1.6 12h2.6m15.6 0h2.6M4.65 19.35 6.5 17.5m11-11 1.85-1.85",
  moon: "M20 14.6A8.6 8.6 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6Z",
  link: "M10.2 13.8a3.9 3.9 0 0 0 5.6 0l3.1-3.1a3.9 3.9 0 1 0-5.5-5.5l-1.5 1.5m-1.9 3.5a3.9 3.9 0 0 0-5.6 0l-3.1 3.1a3.9 3.9 0 1 0 5.5 5.5l1.5-1.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 10.8V16m0-8.7v.1",
  check: "M4.5 12.5 9.5 17.5 19.5 6.5",
  swap: "M4 8h13.5m-3.5-3.5L17.5 8 14 11.5M20 16H6.5m3.5-3.5L6.5 16 10 19.5",
};

export type IconName = keyof typeof STROKE_PATHS | keyof typeof TRANSPORT_PATHS;

interface Props {
  name: IconName;
  /** Кегль знака в пикселях; по умолчанию 16 — под текст 13 px. */
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: Props) {
  const filled = TRANSPORT_PATHS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={filled ? undefined : 1.7}
      strokeLinecap={filled ? undefined : "round"}
      strokeLinejoin={filled ? undefined : "round"}
    >
      <path d={filled ?? STROKE_PATHS[name as keyof typeof STROKE_PATHS]} fillRule="evenodd" />
    </svg>
  );
}
