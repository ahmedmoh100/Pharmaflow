'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/EmptyState';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { formatCurrency, isoDateOffset, formatHijriDate } from '@/app/lib/utils';
import { api } from '@/app/lib/api';
import { Download } from 'lucide-react';
import { downloadCSV } from '@/app/lib/csv';
import { useBranch } from '@/app/context/BranchContext';

interface PurchasesReport {
  from_date: string; to_date: string; total_spend: string;
  by_supplier: { supplier_name_en: string; supplier_name_ar: string; batch_count: number; total_spend: string }[];
  by_medicine: { medicine_name_en: string; medicine_name_ar: string; batch_count: number; total_units: number; total_spend: string }[];
}

export default function PurchasesReportPage() {
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [fromDate, setFromDate] = useState(isoDateOffset(-90));
  const [toDate, setToDate] = useState(isoDateOffset(0));
  const [data, setData] = useState<PurchasesReport | null>(null);
  const { branchId } = useBranch();

  useEffect(() => {
    api.get<PurchasesReport>(`/reports/purchases?from_date=${fromDate}&to_date=${toDate}&branch_id=${branchId}`)
      .then(setData).catch(() => null);
  }, [fromDate, toDate, branchId]);

  const bySupplier = data?.by_supplier ?? [];
  const byMedicine = data?.by_medicine ?? [];

  return (
    <PageWrapper
      title={t('purchasesReport')}
      actions={[{ label: locale === 'ar' ? 'تصدير' : 'Export', icon: <Download style={{ width: '13px', height: '13px' }} />,
        onClick: () => {
          if (!data) return;
          const headers = ['supplier', 'batches', 'total_spend'];
          const rows = data.by_supplier.map((s) => [
            locale === 'ar' ? s.supplier_name_ar : s.supplier_name_en,
            String(s.batch_count),
            s.total_spend,
          ]);
          downloadCSV(`purchases_report_${fromDate}_${toDate}.csv`, [headers, ...rows]);
        },
      }]}
      breadcrumb={[{ label: locale === 'ar' ? 'التقارير' : 'Reports' }, { label: locale === 'ar' ? 'المشتريات' : 'Purchases' }]}
    >
      <D365Panel title={locale === 'ar' ? 'الفترة' : 'Period'}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium">{tCommon('from')}</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{tCommon('to')}</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
          </div>
          {data && (
            <div className="text-sm font-medium">
              {locale === 'ar' ? 'الإجمالي' : 'Total'}:{' '}
              <span className="text-primary font-bold">{formatCurrency(parseFloat(data.total_spend), locale)}</span>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {formatHijriDate(fromDate + 'T00:00:00Z')} — {formatHijriDate(toDate + 'T00:00:00Z')}
        </p>
      </D365Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <D365Panel title={t('spendBySupplier')} noPadding>
          {bySupplier.length === 0 ? (
            <div className="p-4"><EmptyState title={tCommon('noData')} /></div>
          ) : (
            <D365Table
              headers={[t('supplier'), t('batchesReceived'), t('spend')]}
              rows={bySupplier.map((s) => [
                locale === 'ar' ? s.supplier_name_ar : s.supplier_name_en,
                s.batch_count,
                <span key={s.supplier_name_en} className="font-medium">{formatCurrency(parseFloat(s.total_spend), locale)}</span>,
              ])}
            />
          )}
        </D365Panel>

        <D365Panel title={t('spendByMedicine')} noPadding>
          {byMedicine.length === 0 ? (
            <div className="p-4"><EmptyState title={tCommon('noData')} /></div>
          ) : (
            <D365Table
              headers={[t('medicine'), t('batches'), t('units'), t('spend')]}
              rows={byMedicine.map((m) => [
                locale === 'ar' ? m.medicine_name_ar : m.medicine_name_en,
                m.batch_count,
                m.total_units,
                <span key={m.medicine_name_en} className="font-medium">{formatCurrency(parseFloat(m.total_spend), locale)}</span>,
              ])}
            />
          )}
        </D365Panel>
      </div>
    </PageWrapper>
  );
}
