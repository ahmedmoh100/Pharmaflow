'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, usePathname } from '@/app/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  Home, LayoutGrid, ShoppingCart, Undo2, FileText,
  Pill, Tag, Clock, ArrowLeftRight,
  Briefcase, Truck, Package, Building2,
  Users, ClipboardList, Settings,
  BarChart3, TrendingUp, BoxIcon, ShoppingBag,
  Bell, Calculator, Star, History,
  ChevronDown,
} from 'lucide-react';
import type { UserRole } from '@/app/lib/types';
import { api, type ApiDashboardSummary } from '@/app/lib/api';

interface NavTreeProps {
  role: UserRole;
  collapsed: boolean;
}

interface NavItem {
  label: string;
  stableKey?: string;  // stable toggle key regardless of locale
  href?: string;
  icon: React.ElementType;
  badge?: number;
  children?: NavItem[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

export function NavTree({ role, collapsed }: NavTreeProps) {
  const t = useTranslations('nav');
  const locale = useLocale() as 'ar' | 'en';
  const pathname = usePathname();



  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    workspaces: false,
    sales: false,
    inventory: false,
    operations: true,
    administration: true,
    reports: false,
  });

  function toggle(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function isActive(href: string) {
    const clean = pathname.replace(`/${locale}`, '');
    // If href has query params (e.g. /admin/sales?view=invoices) — never match by path alone
    if (href.includes('?')) return false;
    return clean === href || (href !== '/admin/dashboard' && href !== '/pharmacist/dashboard' && clean.startsWith(href + '/'));
  }

  const basePath = role === 'admin' ? '/admin' : '/pharmacist';
  const adminSections: NavSection[] = [
    {
      label: '',
      items: [
        { label: t('dashboard'), href: `${basePath}/dashboard`, icon: Home },
      ],
    },
    {
      label: locale === 'ar' ? 'مساحات العمل' : 'Workspaces',
      items: [
        {
          label: locale === 'ar' ? 'كل مساحات العمل' : 'All workspaces',
          icon: LayoutGrid,
          children: [
            { label: locale === 'ar' ? 'نظرة عامة' : 'Pharmacy overview', href: `${basePath}/dashboard`, icon: Home },
            { label: t('sales'), href: `${basePath}/sales`, icon: ShoppingCart },
            { label: t('inventory'), href: `${basePath}/medicines`, icon: Pill },
          ],
        },
      ],
    },
    {
      label: locale === 'ar' ? 'الوحدات' : 'Modules',
      items: [
        {
          label: t('sales'),
          icon: ShoppingCart,
          children: [
            { label: locale === 'ar' ? 'كل المبيعات' : 'All sales', href: `${basePath}/sales`, icon: ClipboardList },
          ],
        },
        {
          label: t('inventory'),
          icon: Pill,
          children: [
            { label: t('medicines'), href: `${basePath}/medicines`, icon: Pill },
            { label: t('categories'), href: `${basePath}/categories`, icon: Tag },
            { label: locale === 'ar' ? 'قاربت الانتهاء' : 'Expiring items', href: `${basePath}/alerts`, icon: Clock },
          ],
        },
        {
          label: locale === 'ar' ? 'العمليات' : 'Operations',
          stableKey: 'operations',
          icon: Briefcase,
          children: [
            { label: t('suppliers'), href: `${basePath}/suppliers`, icon: Truck },
            { label: t('purchases'), href: `${basePath}/purchases`, icon: Package },
            { label: t('branches'), href: `${basePath}/branches`, icon: Building2 },
            { label: locale === 'ar' ? 'الكوبونات' : 'Coupons', href: `${basePath}/coupons`, icon: Tag },
            { label: locale === 'ar' ? 'تحويلات المخزون' : 'Stock Transfers', href: `${basePath}/transfers`, icon: ArrowLeftRight },
          ],
        },
        {
          label: locale === 'ar' ? 'الإدارة' : 'Administration',
          stableKey: 'administration',
          icon: Users,
          children: [
            { label: t('users'), href: `${basePath}/users`, icon: Users },
            { label: t('audit'), href: `${basePath}/audit`, icon: ClipboardList },
            { label: t('settings'), href: `${basePath}/settings`, icon: Settings },
          ],
        },
        {
          label: t('reports'),
          href: `${basePath}/reports`,
          icon: BarChart3,
          children: [
            { label: locale === 'ar' ? 'تقرير المبيعات' : 'Sales report', href: `${basePath}/reports/sales`, icon: TrendingUp },
            { label: locale === 'ar' ? 'تقرير المخزون' : 'Inventory report', href: `${basePath}/reports/inventory`, icon: BoxIcon },
            { label: locale === 'ar' ? 'تقرير المشتريات' : 'Purchases report', href: `${basePath}/reports/purchases`, icon: ShoppingBag },
            { label: locale === 'ar' ? 'تقرير ضريبة القيمة المضافة' : 'VAT report', href: `${basePath}/vat`, icon: Calculator },
          ],
        },
        { label: t('alerts'), href: `${basePath}/alerts`, icon: Bell },
      ],
    },
  ];

  const pharmacistSections: NavSection[] = [
    {
      label: '',
      items: [
        { label: t('dashboard'), href: `${basePath}/dashboard`, icon: Home },
      ],
    },
    {
      label: locale === 'ar' ? 'الوحدات' : 'Modules',
      items: [
        {
          label: t('sales'),
          icon: ShoppingCart,
          children: [
            { label: t('newSale'), href: `${basePath}/sales/new`, icon: ShoppingCart },
            { label: locale === 'ar' ? 'مبيعاتي' : 'My sales', href: `${basePath}/sales`, icon: ClipboardList },
          ],
        },
        { label: t('inventory'), href: `${basePath}/inventory`, icon: Pill },
        { label: t('alerts'), href: `${basePath}/alerts`, icon: Bell },
        { label: locale === 'ar' ? 'الوصفات' : 'Prescriptions', href: `${basePath}/prescriptions`, icon: FileText },
      ],
    },
  ];

  const sections = role === 'admin' ? adminSections : pharmacistSections;

  function renderItem(item: NavItem, depth = 0, index = 0) {
    const hasChildren = item.children && item.children.length > 0;
    const key = `${item.label}-${depth}-${index}`;
    const toggleKey = item.stableKey ?? item.label;
    const isOpen = openSections[toggleKey] ?? false;
    const active = item.href ? isActive(item.href) : false;
    const Icon = item.icon;
    const indent = depth === 0 ? 'px-3' : depth === 1 ? 'ps-8 pe-3' : 'ps-12 pe-3';

    if (hasChildren) {
      return (
        <div key={key}>
          <button
            onClick={() => toggle(toggleKey)}
            className={cn(
              'flex w-full items-center gap-2 py-nav-item text-start transition-colors rounded-md select-none mx-1',
              indent,
              'hover:bg-nav-hover text-nav-foreground text-nav-child',
            )}
          >
            <Icon className="shrink-0 text-nav-muted" style={{ width: '14px', height: '14px' }} />
            <span className={cn(
              'min-w-0 text-ellipsis whitespace-nowrap transition-all duration-fast',
              collapsed ? 'w-0 overflow-hidden opacity-0 group-hover:w-auto group-hover:flex-1 group-hover:opacity-100' : 'flex-1 overflow-hidden opacity-100'
            )}>
              {item.label}
            </span>
            <ChevronDown
              className={cn('shrink-0 transition-transform text-nav-muted', isOpen && 'rotate-180', collapsed ? 'hidden group-hover:block' : '')}
              style={{ width: '10px', height: '10px' }}
            />
          </button>
          <div className={collapsed ? 'hidden group-hover:block' : ''}>
            {isOpen && item.children!.map((child, ci) => renderItem(child, depth + 1, ci))}
          </div>
        </div>
      );
    }

    if (item.href) {
      return (
        <Link
          key={key}
          href={item.href}
          className={cn(
            'flex items-center gap-2 py-nav-item transition-colors rounded-md whitespace-nowrap mx-1',
            indent,
            'text-nav-child',
            active
              ? 'bg-nav-active text-nav-active-foreground font-medium'
              : 'hover:bg-nav-hover text-nav-foreground',
          )}
        >
          <Icon className={cn('shrink-0', active ? 'text-nav-active-foreground' : 'text-nav-muted')} style={{ width: '14px', height: '14px' }} />
          <span className={cn(
            'min-w-0 text-ellipsis whitespace-nowrap transition-all duration-fast',
            collapsed ? 'w-0 overflow-hidden opacity-0 group-hover:w-auto group-hover:flex-1 group-hover:opacity-100' : 'flex-1 overflow-hidden opacity-100'
          )}>
            {item.label}
          </span>
          {item.badge !== undefined && (
            <span className={cn('ms-auto shrink-0 text-nav-section text-nav-muted', collapsed ? 'hidden group-hover:block' : '')}>
              {item.badge}
            </span>
          )}
        </Link>
      );
    }

    return (
      <div
        key={key}
        className={cn(
          'flex items-center gap-2 py-nav-item cursor-default rounded-md whitespace-nowrap mx-1',
          indent,
          'text-nav-child hover:bg-nav-hover text-nav-foreground',
        )}
      >
        <Icon className="shrink-0 text-nav-muted" style={{ width: '14px', height: '14px' }} />
        <span className={cn(
          'min-w-0 text-ellipsis whitespace-nowrap transition-all duration-fast',
          collapsed ? 'w-0 overflow-hidden opacity-0 group-hover:w-auto group-hover:flex-1 group-hover:opacity-100' : 'flex-1 overflow-hidden opacity-100'
        )}>
          {item.label}
        </span>
      </div>
    );
  }

  return (
    <nav
      className={cn(
        'flex flex-col shrink-0 overflow-y-auto overflow-x-hidden border-e [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        'bg-nav border-nav',
        'transition-[width] duration-fast ease-out',
        collapsed ? 'w-11 hover:w-nav' : 'w-nav',
        'group',
      )}
    >
      {sections.map((section, si) => (
        <div key={si} className={cn('pt-3 border-nav', si > 0 && 'border-t')}>
          {section.label && (
            <p
              className={cn('px-3 pb-1 text-nav-section font-semibold uppercase tracking-nav-section text-nav-muted transition-opacity', collapsed ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}
            >
              {section.label}
            </p>
          )}
          {section.items.map((item, ii) => renderItem(item, 0, ii))}
        </div>
      ))}
    </nav>
  );
}
