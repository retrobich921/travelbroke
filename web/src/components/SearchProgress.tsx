import { formatEta, type ProgressOut } from "../api";

interface Props {
  progress: ProgressOut;
  /** Сглаженная оценка остатка, секунды. Считается в App: там живёт история. */
  eta: number | null;
}

/**
 * Полоса расчёта.
 *
 * Единица работы — город, а не запрос к MCP: только так знаменатель совпадает
 * с тем, чего пользователь ждёт. Сами счётчики наружу не показываем — «73 из
 * 365» ничего ему не решает, а проценты и остаток времени решают. Внутри они
 * по-прежнему нужны: без них не посчитать ни долю, ни оценку.
 *
 * Раньше здесь была насыщающаяся кривая: знаменателя не существовало, и полоса
 * просто подползала к краю, никогда его не достигая. Теперь знаменатель есть,
 * и полоса действительно доходит до конца.
 */
export function SearchProgress({ progress, eta }: Props) {
  const percent = Math.round(progress.fraction * 100);

  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-tb-ink">{progress.phase}</div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-tb-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Ход расчёта"
      >
        <div
          className="h-full rounded-full bg-tb-hero transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(1.5, percent)}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs text-tb-muted">
        <span className="tb-num">{percent}%</span>
        <span className="shrink-0">
          {eta === null ? "оцениваем, сколько осталось…" : `осталось ≈ ${formatEta(eta)}`}
        </span>
      </div>
    </div>
  );
}
