'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { daysUntil } from '@/app/lib/utils';
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface ExpiryBadgeProps {
  expiryDate: string;
  className?: string;
}

export function ExpiryBadge({ expiryDate, className }: ExpiryBadgeProps) {
  const t = useTranslations('alerts');
  const days = daysUntil(expiryDate);
  let Icon = CheckCircle;
  let colorClass = '';

  if (days < 0) {
    Icon = XCircle;
    colorClass = 'bg-destructive/10 text-destructive border-destructive/30';
  } else if (days <= 30) {
    Icon = AlertTriangle;
    colorClass = 'bg-destructive/10 text-destructive border-destructive/30';
  } else if (days <= 90) {
    Icon = AlertTriangle;
    colorClass = 'bg-warning/10 text-warning border-warning/30';
  } else {
    Icon = CheckCircle;
    colorClass = 'bg-success/10 text-success border-success/30';
  }

  const label = days < 0 ? t('expired') : `${days} ${t('daysLeft')}`;

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium', colorClass, className)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
