'use client';

import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

type TileVariant = 'default' | 'warn' | 'danger' | 'success';

interface KpiCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  variant?: TileVariant;
  trend?: number;
  sparkline?: number[]; // array of values for mini chart
  onClick?: () => void;
}

const variantStyles: Record<TileVariant, string> = {
  default:  'bg-tile text-tile-foreground',
  warn:     'bg-tile-warn text-tile-foreground',
  danger:   'bg-tile-danger text-tile-foreground',
  success:  'bg-tile-success text-tile-foreground',
};

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const w = 120;
  const h = 36;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="absolute bottom-0 left-0 right-0 w-full opacity-25"
      style={{ height: '36px' }}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function KpiCard({ label, value, icon: Icon, variant = 'default', trend, sparkline, onClick }: KpiCardProps) {
  return (
    <div
      className={cn(
        'kpi-card relative flex flex-col justify-between w-full px-4 pt-4 pb-0 overflow-hidden rounded-lg',
        'h-[100px] sm:h-[120px]',
        variantStyles[variant],
        onClick && 'cursor-pointer hover:brightness-110',
      )}
      onClick={onClick}
    >
      {/* Top row — icon + trend */}
      <div className="flex items-start justify-between">
        {Icon && <Icon className="shrink-0 opacity-70" style={{ width: '18px', height: '18px' }} />}
        {trend !== undefined && (
          <span className={cn(
            'text-[10px] font-semibold ms-auto',
            trend >= 0 ? 'text-green-300' : 'text-red-300',
          )}>
            {trend >= 0 ? '+' : ''}{trend.toFixed(0)}%
          </span>
        )}
      </div>

      {/* Value + label */}
      <div className="mt-auto pb-3 relative z-10">
        <div className="text-[28px] font-semibold leading-none tabular-nums truncate">
          {value}
        </div>
        <div className="text-[10px] uppercase tracking-kpi opacity-75 truncate mt-1 whitespace-nowrap">
          {label}
        </div>
      </div>

      {/* Sparkline — fills bottom of card */}
      {sparkline && <Sparkline data={sparkline} />}
    </div>
  );
}
