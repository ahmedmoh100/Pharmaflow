'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { KpiCard } from '@/components/shared/KpiCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { StockBadge } from '@/components/shared/StockBadge';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { CATEGORIES, lookupName } from '@/app/lib/mock-data';
import { formatCurrency } from '@/app/lib/utils';
import { api } from '@/app/lib/api';
import { Download } from 'lucide-react';
import { downloadCSV } from '@/app/lib/csv';
import { useBranch } from '@/app/context/BranchContext';

interface InventoryReport {
  total_medicines: number;
  low_stock_count: number;
  inventory_value: string;
  by_category: { category: string; medicine_count: number; total_units: number; total_value: string }[];
  low_stock_list: { id: string; name_en: string; name_ar: string; stock_quantity: number; low_stock_threshold: number }[];
}

export default function InventoryReportPage() {
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [data, setData] = useState<InventoryReport | null>(null);
  const { branchId } = useBranch();

  useEffect(() => {
    api.get<InventoryReport>(`/reports/inventory?branch_id=${branchId}`).then(setData).catch(() => null);
  }, [branchId]);

  const categories = data?.by_category ?? [];
  const lowStock = data?.low_stock_list ?? [];

  return (
    <PageWrapper
      title={t('inventoryReport')}
      actions={[{ label: locale === 'ar' ? 'تصدير' : 'Export', icon: <Download style={{ width: '13px', height: '13px' }} />,
        onClick: () => {
          if (!data) return;
          const headers = ['category', 'medicine_count', 'total_units', 'total_value'];
          const rows = data.by_category.map((c) => [
            lookupName(CATEGORIES, c.category, locale),
            String(c.medicine_count),
            String(c.total_units),
            c.total_value,
          ]);
          downloadCSV(`inventory_report_${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows]);
        },
      }]}
      breadcrumb={[{ label: locale === 'ar' ? 'التقارير' : 'Reports' }, { label: locale === 'ar' ? 'المخزون' : 'Inventory' }]}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 mb-4">
        <KpiCard label={t('totalActiveItems')} value={String(data?.total_medicines ?? '—')} variant="default" />
        <KpiCard label={t('totalInventoryValue')} value={data ? formatCurrency(parseFloat(data.inventory_value), locale) : '—'} variant="success" />
        <KpiCard label={t('itemsBelowThreshold')} value={String(data?.low_stock_count ?? '—')} variant="warn" />
      </div>

      <D365Panel title={t('category')} noPadding>
        {categories.length === 0 ? (
          <div className="p-4"><EmptyState title={tCommon('noData')} /></div>
        ) : (
          <D365Table
            headers={[t('category'), t('itemsCount'), t('totalUnits'), t('totalValue')]}
            rows={categories.map((c) => [
              lookupName(CATEGORIES, c.category, locale),
              c.medicine_count,
              c.total_units,
              <span key={c.category} className="font-medium">{formatCurrency(parseFloat(c.total_value), locale)}</span>,
            ])}
          />
        )}
      </D365Panel>

      <D365Panel title={t('itemsBelowThreshold')} noPadding>
        {lowStock.length === 0 ? (
          <div className="p-4"><EmptyState title={tCommon('noData')} /></div>
        ) : (
          <D365Table
            headers={[t('medicine'), locale === 'ar' ? 'المخزون الحالي' : 'Current Stock', locale === 'ar' ? 'الحد الأدنى' : 'Threshold', locale === 'ar' ? 'العجز' : 'Deficit']}
            rows={lowStock.map((m) => [
              locale === 'ar' ? m.name_ar : m.name_en,
              <StockBadge key={m.id} quantity={m.stock_quantity} threshold={m.low_stock_threshold} />,
              m.low_stock_threshold,
              <span key={m.id} className="text-destructive font-medium">{m.low_stock_threshold - m.stock_quantity}</span>,
            ])}
          />
        )}
      </D365Panel>
    </PageWrapper>
  );
}
