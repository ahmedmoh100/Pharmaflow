'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface D365PanelProps {
  title?: string;
  onViewAll?: string;
  onViewAllClick?: () => void;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

/**
 * D365-style panel — white card with header bar and optional "View all" link.
 * Uses CSS tokens — works correctly in both light and dark mode.
 */
export function D365Panel({ title, onViewAll, onViewAllClick, extra, children, className, noPadding }: D365PanelProps) {
  return (
    <div className={cn('bg-card border border-border rounded-md overflow-hidden', className)}>
      {title && (
        <div className="flex items-center justify-between px-panel-x py-[9px] border-b border-border">
          <span className="text-panel-title font-semibold">{title}</span>
          <div className="flex items-center gap-2">
            {extra}
            {onViewAll && (
              <button
                onClick={onViewAllClick}
                className="text-[11px] text-primary bg-transparent border-0 cursor-pointer font-[inherit] min-h-[32px] flex items-center"
              >
                {onViewAll}
              </button>
            )}
          </div>
        </div>
      )}
      <div className={noPadding ? undefined : 'p-panel-x'}>
        {children}
      </div>
    </div>
  );
}
