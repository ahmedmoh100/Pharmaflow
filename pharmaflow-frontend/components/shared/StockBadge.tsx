'use client';

import { cn } from '@/lib/utils';
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface StockBadgeProps {
  quantity: number;
  threshold: number;
  className?: string;
}

export function StockBadge({ quantity, threshold, className }: StockBadgeProps) {
  let Icon = CheckCircle;
  let colorClass = '';

  if (quantity <= 0) {
    Icon = XCircle;
    colorClass = 'bg-destructive/10 text-destructive border-destructive/30';
  } else if (quantity <= threshold) {
    Icon = AlertTriangle;
    colorClass = 'bg-warning/10 text-warning border-warning/30';
  } else {
    Icon = CheckCircle;
    colorClass = 'bg-success/10 text-success border-success/30';
  }

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium', colorClass, className)}>
      <Icon className="h-3 w-3" />
      {quantity}
    </span>
  );
}
