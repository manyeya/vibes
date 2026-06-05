import React, { useMemo } from 'react';

/**
 * A compact, dependency-free SVG chart renderer for artifact `chart` specs.
 * Supports bar / line / area / pie from a small JSON schema:
 *
 *   { type, title?, xLabel?, yLabel?, data: [{label, value}] }
 *   { type, series: [{ name, color?, points: [{label, value}] }] }
 *
 * Styling uses the app's ink/line CSS tokens so it sits on the canvas surface.
 */

interface Point { label: string; value: number }
interface Series { name?: string; color?: string; points: Point[] }
interface ChartSpec {
  type: 'bar' | 'line' | 'area' | 'pie';
  title?: string;
  xLabel?: string;
  yLabel?: string;
  data?: Point[];
  series?: Series[];
}

// On-brand palette; works on the dark canvas surface.
const PALETTE = ['#e0a458', '#7f9172', '#c4623f', '#6b8aa5', '#b08968', '#9a7fa6', '#5f9ea0'];

const W = 680;
const H = 380;
const PAD = { top: 28, right: 20, bottom: 46, left: 52 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function normalize(spec: ChartSpec): Series[] {
  if (Array.isArray(spec.series) && spec.series.length) {
    return spec.series.map((s) => ({
      name: s.name,
      color: s.color,
      points: (s.points ?? []).map((p) => ({ label: String(p.label ?? ''), value: num(p.value) })),
    }));
  }
  return [{ points: (spec.data ?? []).map((p) => ({ label: String(p.label ?? ''), value: num(p.value) })) }];
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

const fmt = (n: number) =>
  Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `${Math.round(n * 100) / 100}`;

const Axes: React.FC<{
  labels: string[];
  max: number;
  xLabel?: string;
  yLabel?: string;
}> = ({ labels, max, xLabel, yLabel }) => {
  const ticks = 4;
  return (
    <g>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i;
        const y = PAD.top + PLOT_H - (v / max) * PLOT_H;
        return (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y}
              y2={y}
              stroke="var(--color-line)"
              strokeWidth={1}
              strokeDasharray={i === 0 ? undefined : '2 4'}
            />
            <text x={PAD.left - 8} y={y + 3} textAnchor="end" className="chart-axis">
              {fmt(v)}
            </text>
          </g>
        );
      })}
      {labels.map((label, i) => {
        const x = PAD.left + (PLOT_W / labels.length) * (i + 0.5);
        return (
          <text key={i} x={x} y={PAD.top + PLOT_H + 16} textAnchor="middle" className="chart-axis">
            {label.length > 8 ? `${label.slice(0, 7)}…` : label}
          </text>
        );
      })}
      {yLabel && (
        <text x={14} y={PAD.top + PLOT_H / 2} textAnchor="middle" transform={`rotate(-90 14 ${PAD.top + PLOT_H / 2})`} className="chart-axis-label">
          {yLabel}
        </text>
      )}
      {xLabel && (
        <text x={PAD.left + PLOT_W / 2} y={H - 6} textAnchor="middle" className="chart-axis-label">
          {xLabel}
        </text>
      )}
    </g>
  );
};

const Bars: React.FC<{ series: Series[]; labels: string[]; max: number }> = ({ series, labels, max }) => {
  const groupW = PLOT_W / labels.length;
  const barW = (groupW * 0.7) / series.length;
  return (
    <g>
      {labels.map((_, li) =>
        series.map((s, si) => {
          const v = s.points[li]?.value ?? 0;
          const h = (v / max) * PLOT_H;
          const x = PAD.left + groupW * li + groupW * 0.15 + barW * si;
          const y = PAD.top + PLOT_H - h;
          return (
            <rect
              key={`${li}-${si}`}
              x={x}
              y={y}
              width={Math.max(barW - 2, 1)}
              height={Math.max(h, 0)}
              rx={2}
              fill={s.color ?? PALETTE[si % PALETTE.length]}
            />
          );
        }),
      )}
    </g>
  );
};

const Lines: React.FC<{ series: Series[]; labels: string[]; max: number; area: boolean }> = ({ series, labels, max, area }) => {
  const xOf = (i: number) => PAD.left + (PLOT_W / labels.length) * (i + 0.5);
  const yOf = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;
  return (
    <g>
      {series.map((s, si) => {
        const color = s.color ?? PALETTE[si % PALETTE.length];
        const pts = labels.map((_, i) => `${xOf(i)},${yOf(s.points[i]?.value ?? 0)}`);
        const line = `M ${pts.join(' L ')}`;
        const fill = `${line} L ${xOf(labels.length - 1)},${PAD.top + PLOT_H} L ${xOf(0)},${PAD.top + PLOT_H} Z`;
        return (
          <g key={si}>
            {area && <path d={fill} fill={color} opacity={0.16} />}
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {labels.map((_, i) => (
              <circle key={i} cx={xOf(i)} cy={yOf(s.points[i]?.value ?? 0)} r={2.5} fill={color} />
            ))}
          </g>
        );
      })}
    </g>
  );
};

const Pie: React.FC<{ points: Point[] }> = ({ points }) => {
  const total = points.reduce((a, p) => a + Math.max(p.value, 0), 0) || 1;
  const cx = W / 2;
  const cy = PAD.top + PLOT_H / 2;
  const r = Math.min(PLOT_H, PLOT_W) / 2 - 6;
  let angle = -Math.PI / 2;
  return (
    <g>
      {points.map((p, i) => {
        const frac = Math.max(p.value, 0) / total;
        const end = angle + frac * Math.PI * 2;
        const large = frac > 0.5 ? 1 : 0;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const mid = (angle + end) / 2;
        const lx = cx + (r + 16) * Math.cos(mid);
        const ly = cy + (r + 16) * Math.sin(mid);
        const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
        angle = end;
        return (
          <g key={i}>
            <path d={d} fill={PALETTE[i % PALETTE.length]} stroke="var(--color-surface)" strokeWidth={1.5} />
            {frac > 0.04 && (
              <text x={lx} y={ly} textAnchor={lx < cx ? 'end' : 'start'} className="chart-axis">
                {`${p.label} ${Math.round(frac * 100)}%`}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
};

const Legend: React.FC<{ series: Series[] }> = ({ series }) => {
  if (series.length < 2 || !series.some((s) => s.name)) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {series.map((s, i) => (
        <span key={i} className="flex items-center gap-1.5 text-[11px] text-[color:var(--color-ink-soft)]">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} />
          {s.name ?? `Series ${i + 1}`}
        </span>
      ))}
    </div>
  );
};

export const ChartView: React.FC<{ content: string }> = ({ content }) => {
  const parsed = useMemo<{ spec?: ChartSpec; error?: string }>(() => {
    try {
      const spec = JSON.parse(content) as ChartSpec;
      if (!spec || !['bar', 'line', 'area', 'pie'].includes(spec.type)) {
        return { error: 'Chart spec needs a "type" of bar, line, area, or pie.' };
      }
      return { spec };
    } catch (e) {
      return { error: `Invalid chart JSON: ${(e as Error).message}` };
    }
  }, [content]);

  if (parsed.error || !parsed.spec) {
    return (
      <div className="m-6 rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] p-4 font-mono text-[12px] text-[color:var(--color-ember)]">
        {parsed.error}
      </div>
    );
  }

  const spec = parsed.spec;
  const series = normalize(spec);
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const rawMax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const max = niceMax(rawMax);

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <style>{`
        .chart-axis { fill: var(--color-ink-faint); font-size: 11px; font-family: ui-monospace, monospace; }
        .chart-axis-label { fill: var(--color-ink-soft); font-size: 11px; }
      `}</style>
      {spec.title && (
        <h3 className="mb-3 text-center font-display text-[18px] text-[color:var(--color-ink)]">{spec.title}</h3>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label={spec.title ?? `${spec.type} chart`}>
        {spec.type === 'pie' ? (
          <Pie points={series[0]?.points ?? []} />
        ) : (
          <>
            <Axes labels={labels} max={max} xLabel={spec.xLabel} yLabel={spec.yLabel} />
            {spec.type === 'bar' ? (
              <Bars series={series} labels={labels} max={max} />
            ) : (
              <Lines series={series} labels={labels} max={max} area={spec.type === 'area'} />
            )}
          </>
        )}
      </svg>
      {spec.type !== 'pie' && <Legend series={series} />}
    </div>
  );
};
