'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/EmptyState';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { formatCurrency, isoDateOffset, formatHijriDate } from '@/app/lib/utils';
import { api } from '@/app/lib/api';
import { FileDown } from 'lucide-react';
import { downloadCSV } from '@/app/lib/csv';
import { useBranch } from '@/app/context/BranchContext';

interface VatRow {
  month: string;
  taxable_0: string;
  taxable_15: string;
  vat_collected: string;
  grand_total: string;
}

interface VatReport {
  from_date: string;
  to_date: string;
  rows: VatRow[];
}

export default function VatReportPage() {
  const locale = useLocale() as 'ar' | 'en';
  const [fromDate, setFromDate] = useState(isoDateOffset(-30));
  const [toDate, setToDate] = useState(isoDateOffset(0));
  const [data, setData] = useState<VatReport | null>(null);
  const { branchId } = useBranch();

  useEffect(() => {
    api.get<VatReport>(`/reports/vat?from_date=${fromDate}&to_date=${toDate}&branch_id=${branchId}`)
      .then(setData)
      .catch(() => null);
  }, [fromDate, toDate, branchId]);

  const rows = data?.rows ?? [];

  const totals = rows.reduce(
    (acc, r) => ({
      taxable_0:     acc.taxable_0     + parseFloat(r.taxable_0),
      taxable_15:    acc.taxable_15    + parseFloat(r.taxable_15),
      vat_collected: acc.vat_collected + parseFloat(r.vat_collected),
      grand_total:   acc.grand_total   + parseFloat(r.grand_total),
    }),
    { taxable_0: 0, taxable_15: 0, vat_collected: 0, grand_total: 0 },
  );

  return (
    <PageWrapper
      title={locale === 'ar' ? 'تقرير ضريبة القيمة المضافة' : 'VAT Report'}
      actions={[
        { label: locale === 'ar' ? 'تصدير ZATCA' : 'Export ZATCA', icon: <FileDown style={{ width: '13px', height: '13px' }} />,
          onClick: () => {
            if (!rows.length) return;
            const headers = ['month', 'taxable_0%', 'taxable_15%', 'vat_collected', 'grand_total'];
            const csvRows = [
              ...rows.map((r) => [r.month, r.taxable_0, r.taxable_15, r.vat_collected, r.grand_total]),
              ['Total', String(totals.taxable_0), String(totals.taxable_15), String(totals.vat_collected), String(totals.grand_total)],
            ];
            downloadCSV(`vat_report_${fromDate}_${toDate}.csv`, [headers, ...csvRows]);
          },
        },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT' },
      ]}
    >
      {/* Date filter */}
      <D365Panel title={locale === 'ar' ? 'الفترة الزمنية' : 'Date Range'}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium">{locale === 'ar' ? 'من' : 'From'}</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{locale === 'ar' ? 'إلى' : 'To'}</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {formatHijriDate(fromDate + 'T00:00:00Z')} — {formatHijriDate(toDate + 'T00:00:00Z')}
        </p>
      </D365Panel>

      {/* Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        {[
          { label: locale === 'ar' ? 'وعاء ضريبي (0%)' : 'Taxable (0%)', value: totals.taxable_0, note: locale === 'ar' ? 'أدوية معفاة' : 'Zero-rated medicines' },
          { label: locale === 'ar' ? 'وعاء ضريبي (15%)' : 'Taxable (15%)', value: totals.taxable_15, note: locale === 'ar' ? 'منتجات خاضعة' : 'Standard-rated products' },
          { label: locale === 'ar' ? 'ضريبة محصّلة' : 'VAT Collected', value: totals.vat_collected, note: locale === 'ar' ? 'المبلغ المستحق للزكاة' : 'Due to ZATCA' },
          { label: locale === 'ar' ? 'إجمالي الإيراد' : 'Total Revenue', value: totals.grand_total, note: locale === 'ar' ? 'شامل الضريبة' : 'VAT inclusive' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-md p-panel-x">
            <p className="text-xs text-muted-foreground">{kpi.label}</p>
            <p className="text-xl font-bold mt-1">{formatCurrency(kpi.value, locale)}</p>
            <p className="text-xs text-muted-foreground mt-1">{kpi.note}</p>
          </div>
        ))}
      </div>

      {/* Monthly breakdown */}
      <D365Panel title={locale === 'ar' ? 'تفصيل شهري' : 'Monthly Breakdown'} noPadding>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={locale === 'ar' ? 'لا توجد بيانات — ستظهر بعد تسجيل مبيعات حقيقية' : 'No data yet — will populate after real sales are recorded'} />
          </div>
        ) : (
          <D365Table
            headers={[
              locale === 'ar' ? 'الشهر' : 'Month',
              locale === 'ar' ? 'وعاء (0%)' : 'Taxable (0%)',
              locale === 'ar' ? 'وعاء (15%)' : 'Taxable (15%)',
              locale === 'ar' ? 'ضريبة محصّلة' : 'VAT Collected',
              locale === 'ar' ? 'الإجمالي' : 'Grand Total',
            ]}
            rows={[
              ...rows.map((r) => [
                <span key={r.month} className="font-medium">{r.month}</span>,
                formatCurrency(parseFloat(r.taxable_0), locale),
                formatCurrency(parseFloat(r.taxable_15), locale),
                <span key="vat" className="font-medium text-primary">{formatCurrency(parseFloat(r.vat_collected), locale)}</span>,
                <span key="total" className="font-bold">{formatCurrency(parseFloat(r.grand_total), locale)}</span>,
              ]),
              [
                <span key="lbl" className="font-bold">{locale === 'ar' ? 'الإجمالي' : 'Total'}</span>,
                formatCurrency(totals.taxable_0, locale),
                formatCurrency(totals.taxable_15, locale),
                <span key="vt" className="text-primary font-bold">{formatCurrency(totals.vat_collected, locale)}</span>,
                <span key="gt" className="font-bold">{formatCurrency(totals.grand_total, locale)}</span>,
              ],
            ]}
          />
        )}
      </D365Panel>
    </PageWrapper>
  );
}
