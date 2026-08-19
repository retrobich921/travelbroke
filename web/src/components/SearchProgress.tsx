interface Props {
  /** Сколько вызовов Туту уже сделано с начала этого расчёта. */
  calls: number;
  /** Дописывается к подписи: что именно сейчас ищется. */
  note?: string;
}

/**
 * Полоса расчёта.
 *
 * Заполняется не по таймеру, а по факту: сервер отдаёт сквозной счётчик вызовов
 * MCP, фронт снимает разницу с базовым значением. Общее число запросов заранее
 * неизвестно — оно зависит от того, сколько городов пройдёт веер и включены ли
 * пересадки, — поэтому вместо доли берём насыщающуюся кривую: полоса быстро
 * растёт на первых десятках ответов и подходит к концу, не упираясь в него.
 * Врать «97 %» при неизвестном знаменателе нельзя, а показать живое движение и
 * настоящее число ответов — можно.
 */
export function SearchProgress({ calls, note }: Props) {
  const filled = Math.round((1 - Math.exp(-calls / 55)) * 94);

  return (
    <div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-tb-line"
        role="progressbar"
        aria-label="Ход расчёта"
        aria-valuetext={`получено ответов от Туту: ${calls}`}
      >
        <div
          className="h-full rounded-full bg-tb-hero transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(4, filled)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs text-tb-muted">
        <span>Опрашиваем Туту по всем городам сразу{note ? ` · ${note}` : ""}</span>
        <span className="tb-num shrink-0 text-tb-ink">{calls}</span>
      </div>
    </div>
  );
}
