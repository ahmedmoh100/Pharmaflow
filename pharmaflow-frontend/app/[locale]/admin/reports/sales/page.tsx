'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/EmptyState';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { api } from '@/app/lib/api';
import { formatCurrency, isoDateOffset, formatHijriDate } from '@/app/lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Calendar, Download } from 'lucide-react';
import { downloadCSV } from '@/app/lib/csv';
import { useBranch } from '@/app/context/BranchContext';

interface SalesReport {
  from_date: string;
  to_date: string;
  total_revenue: string;
  total_vat: string;
  total_count: number;
  by_day: { day: string; total: string; count: number }[];
  by_payment: { method: string; count: number; total: string }[];
  top_selling: { medicine_id: string; medicine_name_en: string; medicine_name_ar: string; units_sold: number; revenue: string; gross_profit: string; margin_pct: number }[];
  recent: { id: string; invoice_number: string; total_amount: string; vat_amount: string; payment_method: string; sold_at: string; pharmacist_name: string }[];
}

interface PharmacistRow {
  user_id: string;
  full_name: string;
  branch_name_en: string;
  branch_name_ar: string;
  tx_count: number;
  revenue: string;
  vat: string;
  avg_tx: string;
}

const PAYMENT_LABELS: Record<string, { en: string; ar: string }> = {
  cash:      { en: 'Cash',      ar: 'نقداً' },
  card:      { en: 'Card',      ar: 'بطاقة ائتمان' },
  mada:      { en: 'mada',      ar: 'مدى' },
  transfer:  { en: 'Transfer',  ar: 'تحويل' },
  insurance: { en: 'Insurance', ar: 'تأمين' },
  wasfaty:   { en: 'WASFATY',   ar: 'وصفتي' },
};

export default function SalesReportPage() {
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [activeTab, setActiveTab] = useState<'overview' | 'byPharmacist'>('overview');
  const [period, setPeriod] = useState<'last30' | 'thisMonth'>('last30');
  const [fromDate, setFromDate] = useState(isoDateOffset(-30));
  const [toDate, setToDate] = useState(isoDateOffset(0));
  const [data, setData] = useState<SalesReport | null>(null);
  const [pharmData, setPharmData] = useState<PharmacistRow[]>([]);
  const { branchId } = useBranch();

  useEffect(() => {
    const now = new Date();
    if (period === 'thisMonth') {
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      setFromDate(monthStart);
      setToDate(isoDateOffset(0));
    } else {
      setFromDate(isoDateOffset(-30));
      setToDate(isoDateOffset(0));
    }
  }, [period]);

  useEffect(() => {
    api.get<SalesReport>(`/reports/sales?from_date=${fromDate}&to_date=${toDate}&branch_id=${branchId}`)
      .then(setData).catch(() => null);
  }, [fromDate, toDate, branchId]);

  useEffect(() => {
    if (activeTab !== 'byPharmacist') return;
    api.get<{ rows: PharmacistRow[] }>(`/reports/sales/by-pharmacist?from_date=${fromDate}&to_date=${toDate}&branch_id=${branchId}`)
      .then((res) => setPharmData(res.rows))
      .catch(() => null);
  }, [activeTab, fromDate, toDate, branchId]);

  const chartData = (data?.by_day ?? []).map((d) => ({ date: d.day.slice(5), total: parseFloat(d.total) }));
  const breakdown = data?.by_payment ?? [];
  const topMeds   = data?.top_selling ?? [];
  const totalRevenue = data ? parseFloat(data.total_revenue) : 0;
  const totalVat     = data ? parseFloat(data.total_vat) : 0;
  const totalCount   = data?.total_count ?? 0;

  const tooltipStyle = { fontSize: '11px', backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 0, color: 'hsl(var(--card-foreground))' };

  return (
    <PageWrapper
      title={t('salesReport')}
      tabs={[
        { key: 'overview',     label: locale === 'ar' ? 'نظرة عامة' : 'Overview' },
        { key: 'byPharmacist', label: locale === 'ar' ? 'حسب الصيدلاني' : 'By Pharmacist' },
      ]}
      defaultTab="overview"
      onTabChange={(key) => setActiveTab(key as 'overview' | 'byPharmacist')}
      actions={[
        {
          label: period === 'thisMonth'
            ? (locale === 'ar' ? 'آخر 30 يوماً' : 'Last 30 days')
            : (locale === 'ar' ? 'هذا الشهر' : 'This month'),
          icon: <Calendar style={{ width: '13px', height: '13px' }} />,
          onClick: () => setPeriod((p) => p === 'last30' ? 'thisMonth' : 'last30'),
        },
        {
          label: locale === 'ar' ? 'تصدير' : 'Export',
          icon: <Download style={{ width: '13px', height: '13px' }} />,
          separator: true,
          onClick: () => {
            if (activeTab === 'byPharmacist') {
              const headers = ['pharmacist', 'branch', 'transactions', 'revenue', 'vat', 'avg_transaction'];
              const rows = pharmData.map((r) => [
                r.full_name,
                locale === 'ar' ? r.branch_name_ar : r.branch_name_en,
                String(r.tx_count), r.revenue, r.vat, r.avg_tx,
              ]);
              downloadCSV(`sales_by_pharmacist_${fromDate}_${toDate}.csv`, [headers, ...rows]);
              return;
            }
            if (!data) return;
            const dailyHeaders = ['date', 'revenue', 'invoices'];
            const dailyRows = data.by_day.map((d) => [d.day, d.total, String(d.count)]);
            const payHeaders = ['payment_method', 'count', 'total'];
            const payRows = data.by_payment.map((b) => [b.method, String(b.count), b.total]);
            const topHeaders = ['medicine_en', 'medicine_ar', 'units_sold', 'revenue', 'gross_profit', 'margin_pct'];
            const topRows = data.top_selling.map((m) => [m.medicine_name_en, m.medicine_name_ar, String(m.units_sold), m.revenue, m.gross_profit ?? '0', String(m.margin_pct ?? 0) + '%']);
            downloadCSV(`sales_report_${fromDate}_${toDate}.csv`, [
              dailyHeaders, ...dailyRows,
              [], ['--- Payment Breakdown ---'],
              payHeaders, ...payRows,
              [], ['--- Top Selling ---'],
              topHeaders, ...topRows,
            ]);
          },
        },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'التقارير' : 'Reports' },
        { label: locale === 'ar' ? 'المبيعات' : 'Sales' },
      ]}
    >
      {/* Date filter — shared across both tabs */}
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
              <span className="text-primary font-bold">{formatCurrency(totalRevenue, locale)}</span>
              <span className="text-muted-foreground ms-2">({totalCount} {locale === 'ar' ? 'فاتورة' : 'invoices'})</span>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {formatHijriDate(fromDate + 'T00:00:00Z')} — {formatHijriDate(toDate + 'T00:00:00Z')}
        </p>
      </D365Panel>

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && (
        <>
          <D365Panel title={t('dailyRevenue')}>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [formatCurrency(v, locale), t('revenue')]} contentStyle={tooltipStyle} cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </D365Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <D365Panel title={t('paymentBreakdown')} noPadding>
              {breakdown.length === 0 ? (
                <div className="p-4"><EmptyState title={tCommon('noData')} /></div>
              ) : (
                <D365Table
                  headers={[t('paymentBreakdown'), t('invoiceCount'), t('total')]}
                  rows={breakdown.map((b) => [
                    (PAYMENT_LABELS[b.method]?.[locale]) ?? b.method,
                    b.count,
                    <span key={b.method} className="font-medium">{formatCurrency(parseFloat(b.total), locale)}</span>,
                  ])}
                />
              )}
            </D365Panel>

            <D365Panel title={t('topSelling')} noPadding>
              {topMeds.length === 0 ? (
                <div className="p-4"><EmptyState title={tCommon('noData')} /></div>
              ) : (
                <D365Table
                  headers={[t('medicine'), t('unitsSold'), t('revenue'), locale === 'ar' ? 'الربح الإجمالي' : 'Gross Profit', locale === 'ar' ? 'الهامش' : 'Margin']}
                  rows={topMeds.map((m) => [
                    locale === 'ar' ? m.medicine_name_ar : m.medicine_name_en,
                    m.units_sold,
                    <span key={m.medicine_id + 'r'} className="font-medium">{formatCurrency(parseFloat(m.revenue), locale)}</span>,
                    <span key={m.medicine_id + 'g'} style={{ color: 'hsl(var(--success))' }}>{formatCurrency(parseFloat(m.gross_profit ?? '0'), locale)}</span>,
                    <span key={m.medicine_id + 'm'} style={{ color: 'hsl(var(--success))' }}>{m.margin_pct ?? 0}%</span>,
                  ])}
                />
              )}
            </D365Panel>
          </div>

          {totalCount > 0 && (
            <D365Panel title={locale === 'ar' ? 'ملخص الفترة' : 'Period Summary'}>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1 rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'إجمالي الإيراد' : 'Total Revenue'}</p>
                  <p className="text-xl font-bold">{formatCurrency(totalRevenue, locale)}</p>
                </div>
                <div className="space-y-1 rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT Collected'}</p>
                  <p className="text-xl font-bold text-primary">{formatCurrency(totalVat, locale)}</p>
                </div>
                <div className="space-y-1 rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'عدد الفواتير' : 'Total Invoices'}</p>
                  <p className="text-xl font-bold">{totalCount}</p>
                </div>
              </div>
            </D365Panel>
          )}
        </>
      )}

      {/* ── By Pharmacist tab ── */}
      {activeTab === 'byPharmacist' && (
        <D365Panel title={locale === 'ar' ? 'أداء الصيادلة' : 'Pharmacist Performance'} noPadding>
          {pharmData.length === 0 ? (
            <div className="p-4"><EmptyState title={tCommon('noData')} /></div>
          ) : (
            <D365Table
              headers={[
                locale === 'ar' ? 'الصيدلاني' : 'Pharmacist',
                locale === 'ar' ? 'الفرع' : 'Branch',
                locale === 'ar' ? 'عدد المبيعات' : 'Transactions',
                locale === 'ar' ? 'الإيراد' : 'Revenue',
                locale === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT',
                locale === 'ar' ? 'متوسط الفاتورة' : 'Avg Invoice',
              ]}
              rows={pharmData.map((r) => [
                <span key={r.user_id} className="font-medium">{r.full_name}</span>,
                locale === 'ar' ? r.branch_name_ar : r.branch_name_en,
                <span key={r.user_id + 'tx'} className="font-mono">{r.tx_count}</span>,
                <span key={r.user_id + 'rev'} className="font-medium text-primary">{formatCurrency(parseFloat(r.revenue), locale)}</span>,
                formatCurrency(parseFloat(r.vat), locale),
                formatCurrency(parseFloat(r.avg_tx), locale),
              ])}
            />
          )}
        </D365Panel>
      )}
    </PageWrapper>
  );
}
