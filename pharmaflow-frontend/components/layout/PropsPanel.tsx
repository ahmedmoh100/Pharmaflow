'use client';

import { useLocale } from 'next-intl';
import { Pencil, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PropsPanelProps {
  hidden: boolean;
  title?: string;
  children?: React.ReactNode;
}

export function PropsPanel({ hidden, title, children }: PropsPanelProps) {
  const locale = useLocale() as 'ar' | 'en';

  return (
    <aside
      className={cn(
        'flex flex-col shrink-0 overflow-y-auto overflow-x-hidden transition-all border-s bg-props border-props',
        hidden ? 'w-0 border-none overflow-hidden' : 'w-props-panel',
      )}
    >
      {!hidden && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-panel-x py-3 shrink-0 border-b border-props">
            <span className="text-panel-title font-semibold text-props-foreground">
              {title ?? (locale === 'ar' ? 'الخصائص' : 'Properties')}
            </span>
            <button className="bg-transparent border-0 text-muted-foreground hover:text-primary transition-colors">
              <Pencil className="size-icon-sm" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {children ?? (
              <div className="flex flex-col items-center justify-center py-6 px-panel-x text-center text-muted-foreground">
                <ArrowLeft className="mb-2 opacity-40 size-6" />
                <p className="text-xs">
                  {locale === 'ar'
                    ? 'اختر سجلاً لعرض خصائصه'
                    : 'Select a record to view its properties'}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
