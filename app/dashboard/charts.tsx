type Datum = { label: string; value: number };

const CATEGORICAL = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
];

function Card({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 ${className}`}
    >
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-neutral-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Donut for a composition of a whole (categorical, with a legend + direct labels). */
function Donut({ data }: { data: Datum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 54;
  const C = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img">
        <g transform="rotate(-90 70 70)">
          {data.map((d, i) => {
            const f = d.value / total;
            // 2px surface gap between segments.
            const dash = Math.max(f * C - 2, 0);
            const seg = (
              <circle
                key={i}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={CATEGORICAL[i % 4]}
                strokeWidth="16"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={`-${acc * C}`}
              >
                <title>{`${d.label}: ${d.value} (${Math.round(f * 100)}%)`}</title>
              </circle>
            );
            acc += f;
            return seg;
          })}
        </g>
        <text
          x="70"
          y="68"
          textAnchor="middle"
          style={{ fontSize: 22, fontWeight: 700, fill: "var(--viz-ink)" }}
        >
          {total.toLocaleString()}
        </text>
        <text
          x="70"
          y="84"
          textAnchor="middle"
          style={{ fontSize: 9, fill: "var(--viz-muted)" }}
        >
          voters
        </text>
      </svg>
      <ul className="w-full space-y-2">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ background: CATEGORICAL[i % 4] }}
            />
            <span className="flex-1 truncate">{d.label}</span>
            <span className="font-medium tabular-nums">
              {d.value.toLocaleString()}
            </span>
            <span className="w-9 text-right text-neutral-500 tabular-nums">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical bars for magnitude across an ordered dimension (single hue). */
function VBars({ data }: { data: Datum[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-44 items-end gap-2">
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="text-xs font-medium tabular-nums">{d.value}</div>
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t-[4px] transition-opacity hover:opacity-80"
              style={{
                height: `${Math.max((d.value / max) * 100, 1)}%`,
                background: "var(--viz-1)",
              }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
          <div className="text-[11px] text-neutral-500">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Horizontal bars for magnitude across identity (single hue, direct labels). */
function HBars({
  data,
  color = "var(--viz-1)",
}: {
  data: Datum[];
  color?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li key={i} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate">{d.label}</span>
            <span className="font-medium tabular-nums">
              {d.value.toLocaleString()}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--viz-grid)]">
            <div
              className="h-full rounded-full transition-opacity hover:opacity-80"
              style={{
                width: `${Math.max((d.value / max) * 100, 2)}%`,
                background: color,
              }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Analytics({
  gender,
  age,
  constituency,
  roles,
}: {
  gender: Datum[];
  age: Datum[];
  constituency: Datum[];
  roles: Datum[];
}) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card title="Gender split" subtitle="Share of registered voters">
        <Donut data={gender} />
      </Card>
      <Card title="Age distribution" subtitle="Voters by age band">
        <VBars data={age} />
      </Card>
      <Card
        title="Voters by constituency"
        subtitle="Across ingested rolls"
        className={roles.length ? "" : "md:col-span-2"}
      >
        <HBars data={constituency} />
      </Card>
      <Card title="Team" subtitle="Dashboard accounts by role">
        <HBars data={roles} color="var(--viz-2)" />
      </Card>
    </section>
  );
}
