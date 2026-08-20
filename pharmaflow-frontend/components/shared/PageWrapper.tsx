'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';

interface ActionTab {
  label: string;
  key: string;
}

interface ActionButton {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  separator?: boolean; // adds a vertical divider before this button
  disabled?: boolean;  // renders grayed out, non-interactive
}

interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

interface PageWrapperProps {
  /** Page title — shown in the page header area */
  title: string;
  subtitle?: string;
  /** Breadcrumb path — auto-prepends Home if not provided */
  breadcrumb?: BreadcrumbItem[];
  /** Action pane tabs — defaults to single tab with title */
  tabs?: ActionTab[];
  defaultTab?: string;
  onTabChange?: (key: string) => void;
  /** Action pane buttons */
  actions?: ActionButton[];
  children: React.ReactNode;
  className?: string;
}

export function PageWrapper({
  title,
  subtitle,
  breadcrumb,
  tabs,
  defaultTab,
  onTabChange,
  actions,
  children,
  className,
}: PageWrapperProps) {
  const locale = useLocale() as 'ar' | 'en';
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs?.[0]?.key ?? 'default');

  function handleTabChange(key: string) {
    setActiveTab(key);
    onTabChange?.(key);
  }

  const homeLabel = locale === 'ar' ? 'الرئيسية' : 'Home';
  const crumbs: BreadcrumbItem[] = breadcrumb && breadcrumb.length > 0
    ? breadcrumb
    : [{ label: title }];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Action pane */}
      {(tabs || actions) && (
        <div className="page-strip shrink-0">
          {/* Tab strip */}
          {tabs && tabs.length > 0 && (
            <div className="flex items-center px-panel-x border-b border-border">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={cn(
                    'px-[13px] py-nav-item text-xs font-medium cursor-pointer border-b-2 transition-colors whitespace-nowrap bg-transparent',
                    activeTab === tab.key
                      ? 'border-b-accent text-accent font-semibold'
                      : 'border-b-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Buttons row */}
          {actions && actions.length > 0 && (
            <div className="flex items-center gap-[2px] px-panel-x py-[5px]">
              {actions.map((btn, i) => (
                <div key={i} className="flex items-center">
                  {btn.separator && <div className="w-px h-5 mx-1 bg-border" />}
                  <button
                    onClick={btn.disabled ? undefined : btn.onClick}
                    disabled={btn.disabled}
                    className={cn(
                      'inline-flex items-center gap-[5px] px-[10px] py-1 text-xs transition-colors whitespace-nowrap border border-transparent',
                      btn.disabled
                        ? 'text-muted-foreground/40 bg-transparent cursor-not-allowed'
                        : 'text-foreground bg-transparent hover:bg-nav-hover hover:border-border'
                    )}
                  >
                    {btn.icon && <span className="text-muted-foreground text-[13px]">{btn.icon}</span>}
                    {btn.label}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Breadcrumb */}
      <div className="page-strip flex items-center gap-[6px] px-4 shrink-0 min-h-breadcrumb-h overflow-hidden">
        <span className="text-breadcrumb text-primary shrink-0">{homeLabel}</span>
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-[6px] min-w-0">
            <span className="text-[10px] text-muted-foreground shrink-0">›</span>
            {crumb.onClick ? (
              <button onClick={crumb.onClick} className="text-breadcrumb text-primary bg-transparent border-0 cursor-pointer hover:underline truncate">
                {crumb.label}
              </button>
            ) : (
              <span className="text-breadcrumb text-muted-foreground truncate">{crumb.label}</span>
            )}
          </span>
        ))}
      </div>

      {/* Page header — always rendered */}
      <div className="page-strip px-4 py-2.5 shrink-0">
        <h1 className="text-sm font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="text-xs mt-[2px] text-muted-foreground">{subtitle}</p>}
      </div>

      {/* Workspace — scrollable content */}
      <div className={cn('flex-1 overflow-y-auto overflow-x-auto bg-background [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
