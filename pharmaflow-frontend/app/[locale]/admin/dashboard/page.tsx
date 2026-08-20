'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { KpiCard } from '@/components/shared/KpiCard';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { StockBadge } from '@/components/shared/StockBadge';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import {
  CATEGORIES, PAYMENT_METHODS, lookupName,
} from '@/app/lib/mock-data';
import { formatCurrency, formatDateTime, isoDateOffset } from '@/app/lib/utils';
import { api, type ApiDashboardSummary, type ApiBranchComparison } from '@/app/lib/api';
import { RefreshCw, Calendar, DollarSign, AlertTriangle, Clock, ShoppingCart } from 'lucide-react';
import { useBranch } from '@/app/context/BranchContext';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';

export default function AdminDashboardPage() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();

  /* ── Tab + period state ── */
  const [activeTab, setActiveTab] = useState<'work' | 'analytics'>('work');
  const [period, setPeriod] = useState<'last30' | 'thisMonth'>('last30');

  /* ── Real API state ── */
  const [summary, setSummary] = useState<ApiDashboardSummary | null>(null);
  const [branchData, setBranchData] = useState<ApiBranchComparison | null>(null);
  const [inventoryReport, setInventoryReport] = useState<{ by_category: { category: string; medicine_count: number; total_units: number; total_value: string }[]; low_stock_list: { id: string; name_en: string; name_ar: string; stock_quantity: number; low_stock_threshold: number }[] } | null>(null);
  const [expiringBatches, setExpiringBatches] = useState<{ id: string; batch_number: string; expiry_date: string; qty_remaining: number; medicine_name_en: string; medicine_name_ar: string }[]>([]);
  const [salesReport, setSalesReport] = useState<{
    total_revenue: string; total_vat: string; total_count: number;
    by_day: { day: string; total: string; count: number }[];
    by_payment: { method: string; count: number; total: string }[];
    top_selling: { medicine_id: string; medicine_name_en: string; medicine_name_ar: string; units_sold: number; revenue: string }[];
    recent: { id: string; invoice_number: string; total_amount: string; vat_amount: string; payment_method: string; sold_at: string; pharmacist_name: string }[];
  } | null>(null);

  const { branchId } = useBranch();

  const fetchReports = (from: string, to: string) => {
    const bParam = branchId ? `&branch_id=${branchId}` : '';
    api.get<typeof salesReport>(`/reports/sales?from_date=${from}&to_date=${to}${bParam}`)
      .then(setSalesReport).catch(() => null);
  };

  useEffect(() => {
    const bParam = branchId ? `?branch_id=${branchId}` : '';
    api.get<ApiDashboardSummary>(`/dashboard/summary${bParam}`).then(setSummary).catch(() => null);
    api.get<ApiBranchComparison>('/dashboard/branch-comparison').then(setBranchData).catch(() => null);
    api.get<typeof inventoryReport>('/reports/inventory').then(setInventoryReport).catch(() => null);
    const purchaseParam = branchId ? `&branch_id=${branchId}` : '';
    api.get<{ items: typeof expiringBatches[0][] }>(`/purchases?page=1&page_size=100${purchaseParam}`)
      .then((res) => {
        const today = new Date();
        const in91 = new Date(); in91.setDate(today.getDate() + 91);
        setExpiringBatches(res.items.filter((b: any) => {
          const exp = new Date(b.expiry_date);
          if (b.sfda_status === 'recalled' || b.sfda_status === 'quarantined') return false;
          return exp < in91 && b.qty_remaining > 0;
        }).slice(0, 6));
      }).catch(() => null);
  }, [branchId]);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const today = now.toLocaleDateString('en-CA');

  // Fetch sales report when period or branch changes
  useEffect(() => {
    const from = period === 'thisMonth' ? monthStart : isoDateOffset(-30);
    fetchReports(from, today);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchId]);

  /* ── KPI values: real if loaded ── */
  const todayTotal    = summary ? parseFloat(summary.today_revenue) : 0;
  const todayCount    = summary ? summary.today_sales_count : 0;
  const lowStockCount = summary ? summary.low_stock_count : 0;
  const expiringCount = summary ? summary.expiring_90_count : 0;
  const salesTrend    = summary ? summary.revenue_trend : 0;
  const salesSparkline = summary?.sparkline_30d ?? [];
  const txSparkline    = [1,1,1,1,1,1,1,1,1,1,1,1,1, todayCount];
  const warnSparkline  = [8,9,7,10,11,9,8,10,12,9,8,9,10, lowStockCount];
  const dangerSparkline = [5,6,7,6,8,7,9,8,8,9,8,7,8, expiringCount];

  /* ── Real data ── */
  const lowStock     = inventoryReport?.low_stock_list ?? [];
  const expiringSoon = expiringBatches;
  const recentSales  = salesReport?.recent ?? [];
  const chartData    = (salesReport?.by_day ?? []).map((d) => ({ date: d.day.slice(5), total: parseFloat(d.total) }));

  /* ── Donut — SAR value by category (real API) ── */
  const DONUT_COLORS = ['#0063b1', '#107c10', '#835b00', '#a4262c', '#5c2d91', '#777'];
  const catRaw = (inventoryReport
    ? inventoryReport.by_category.map((c) => ({ category: c.category, value: parseFloat(c.total_value) }))
    : []
  ).sort((a, b) => b.value - a.value);
  const top5 = catRaw.slice(0, 5);
  const otherValue = catRaw.slice(5).reduce((s, c) => s + c.value, 0);
  const donutData = [
    ...top5.map((c) => {
      const cat = CATEGORIES.find((x) => x.code === c.category);
      return { name: locale === 'ar' ? (cat?.name_ar ?? c.category) : (cat?.name_en ?? c.category), value: Math.round(c.value) };
    }),
    ...(otherValue > 0 ? [{ name: locale === 'ar' ? 'أخرى' : 'Other', value: Math.round(otherValue) }] : []),
  ];
  const totalInventoryValue = catRaw.reduce((s, c) => s + c.value, 0);

  /* ── Analytics data — real ── */
  const breakdown       = salesReport?.by_payment ?? [];
  const topMedsWithMargin = (salesReport?.top_selling ?? []).map((m) => ({
    medicine_name_en: m.medicine_name_en,
    medicine_name_ar: m.medicine_name_ar,
    units: m.units_sold,
    revenue: parseFloat(m.revenue),
    gp: 0,    // cost data not available without purchase records per item
    margin: 0,
  }));
  const totalRevenue = salesReport ? parseFloat(salesReport.total_revenue) : 0;

  const periodLabel = period === 'thisMonth'
    ? (locale === 'ar' ? 'هذا الشهر' : 'This Month')
    : (locale === 'ar' ? 'آخر 30 يوماً' : 'Last 30 Days');

  const tooltipStyle = { fontSize: '11px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 0, color: 'hsl(var(--card-foreground))' };

  return (
    <PageWrapper
      title={t('title')}
      tabs={[
        { key: 'work', label: locale === 'ar' ? 'عملي' : 'My work' },
        { key: 'analytics', label: locale === 'ar' ? 'التحليلات' : 'Analytics' },
      ]}
      onTabChange={(key) => setActiveTab(key as 'work' | 'analytics')}
      defaultTab="work"
      actions={[
        { label: locale === 'ar' ? 'تحديث' : 'Refresh', icon: <RefreshCw style={{ width: '13px', height: '13px' }} />, onClick: () => window.location.reload() },
        {
          label: period === 'thisMonth'
            ? (locale === 'ar' ? 'آخر 30 يوماً' : 'Last 30 days')
            : (locale === 'ar' ? 'هذا الشهر' : 'This month'),
          icon: <Calendar style={{ width: '13px', height: '13px' }} />,
          onClick: () => setPeriod((p) => p === 'last30' ? 'thisMonth' : 'last30'),
        },
      ]}
      breadcrumb={[]}
    >

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard icon={DollarSign} value={formatCurrency(todayTotal, locale)} label={locale === 'ar' ? 'مبيعات اليوم' : "Today's Sales"} variant="default" trend={salesTrend} sparkline={salesSparkline} />
        <KpiCard icon={ShoppingCart} value={String(todayCount)} label={locale === 'ar' ? 'معاملات اليوم' : "Today's Transactions"} variant="default" sparkline={txSparkline} />
        <KpiCard icon={AlertTriangle} value={String(lowStockCount)} label={locale === 'ar' ? 'نقص مخزون (فروع)' : 'Low Stock (Branches)'} variant="warn" sparkline={warnSparkline} />
        <KpiCard icon={Clock} value={String(expiringCount)} label={locale === 'ar' ? 'تنتهي خلال 90 يوم' : 'Expiring 90 Days'} variant="danger" sparkline={dangerSparkline} />
      </div>

      {/* ── MY WORK tab content ── */}
      {activeTab === 'work' && (
      <div>

        {/* Charts row */}
        <div className="grid gap-4 mb-4 grid-cols-1 lg:grid-cols-[2fr_1fr]">
          <D365Panel title={`${locale === 'ar' ? 'المبيعات' : 'Sales'} — ${periodLabel}`} onViewAll={locale === 'ar' ? 'عرض الكل' : 'View all'} onViewAllClick={() => router.push('/admin/sales')} noPadding>
            <div style={{ height: '220px', padding: '12px 14px 8px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={period === 'thisMonth' ? 1 : 4} />
                  <YAxis tick={{ fontSize: 10 }} width={40} />
                  <Tooltip formatter={(v: number) => [formatCurrency(v, locale), '']} contentStyle={tooltipStyle} cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </D365Panel>

          <D365Panel title={locale === 'ar' ? 'قيمة المخزون بالفئة' : 'Inventory Value by Category'} onViewAll={locale === 'ar' ? 'عرض الكل' : 'View all'} onViewAllClick={() => router.push('/admin/reports/inventory')}>
            <div style={{ position: 'relative' }}>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value" strokeWidth={0}>
                    {donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number, name: string) => [formatCurrency(v, locale), name]} contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: 'hsl(var(--foreground))', whiteSpace: 'nowrap' }}>{formatCurrency(totalInventoryValue, locale)}</p>
                <p style={{ fontSize: '9px', color: 'hsl(var(--muted-foreground))' }}>{locale === 'ar' ? 'إجمالي' : 'Total'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {donutData.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1 text-[10px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  <span className="text-muted-foreground">{d.name}</span>
                </div>
              ))}
            </div>
          </D365Panel>
        </div>

        {/* Branch Comparison */}
        <D365Panel title={locale === 'ar' ? 'مقارنة الفروع' : 'Branch Comparison'} noPadding className="mb-4">
          <D365Table
            headers={[locale === 'ar' ? 'الفرع' : 'Branch', locale === 'ar' ? 'المدينة' : 'City', locale === 'ar' ? 'المبيعات' : 'Sales', locale === 'ar' ? 'الإيراد' : 'Revenue', locale === 'ar' ? 'الحصة' : 'Share']}
            rows={(branchData?.branches ?? []).map((branch) => {
              const maxShare = Math.max(...(branchData?.branches ?? []).map((b) => b.share_pct), 1);
              return [
                <span key="n" className="font-medium">{locale === 'ar' ? branch.name_ar : branch.name_en}</span>,
                <span key="c" className="text-muted-foreground">{locale === 'ar' ? branch.city_ar : branch.city_en}</span>,
                branch.sales_count,
                <span key="r" className="font-medium">{formatCurrency(parseFloat(branch.revenue), locale)}</span>,
                <div key="b" className="flex items-center gap-2" style={{ minWidth: '100px' }}>
                  <div style={{ flex: 1, height: '6px', background: 'hsl(var(--border))', borderRadius: '3px' }}>
                    <div style={{ width: `${(branch.share_pct / maxShare) * 100}%`, height: '100%', background: 'hsl(var(--primary))', borderRadius: '3px' }} />
                  </div>
                  <span style={{ fontSize: '10px', color: 'hsl(var(--muted-foreground))', minWidth: '28px' }}>{branch.share_pct}%</span>
                </div>,
              ];
            })}
          />
        </D365Panel>

        {/* Top Selling */}
        <D365Panel title={`${locale === 'ar' ? 'الأكثر مبيعاً' : 'Top Selling'} — ${periodLabel}`} noPadding className="mb-4">
          <D365Table
            headers={[locale === 'ar' ? 'الدواء' : 'Medicine', locale === 'ar' ? 'الوحدات' : 'Units', locale === 'ar' ? 'الإيراد' : 'Revenue']}
            rows={topMedsWithMargin.map((m) => [
              <span key="n" className="font-medium">{locale === 'ar' ? m.medicine_name_ar : m.medicine_name_en}</span>,
              m.units,
              formatCurrency(m.revenue, locale),
            ])}
          />
        </D365Panel>

        {/* Recent Sales */}
        <D365Panel title={locale === 'ar' ? 'أحدث المبيعات' : 'Recent Sales'} onViewAll={locale === 'ar' ? 'عرض الكل' : 'View all'} onViewAllClick={() => router.push('/admin/sales')} noPadding className="mb-4">
          <D365Table
            headers={['', 'Receipt #', locale === 'ar' ? 'التاريخ/الوقت' : 'Date/Time', locale === 'ar' ? 'الصيدلي' : 'Pharmacist', locale === 'ar' ? 'الإجمالي' : 'Total', 'VAT', locale === 'ar' ? 'الحالة' : 'Status']}
            rows={recentSales.map((s) => [
              <input key="r" type="radio" name="hs" style={{ accentColor: 'hsl(var(--primary))' }} />,
              <a key="i" style={{ color: 'hsl(var(--primary))', cursor: 'pointer' }} onClick={() => router.push(`/admin/sales/${s.id}`)}>{s.invoice_number}</a>,
              formatDateTime(s.sold_at, locale),
              s.pharmacist_name,
              formatCurrency(parseFloat(s.total_amount), locale),
              parseFloat(s.vat_amount) > 0 ? formatCurrency(parseFloat(s.vat_amount), locale) : <span key="v" style={{ color: 'hsl(var(--muted-foreground))' }}>—</span>,
              <span key="st" style={{ display: 'inline-block', padding: '2px 8px', fontSize: '10px', fontWeight: 600, background: 'hsl(var(--tag-green-bg))', color: 'hsl(var(--tag-green-fg))', borderRadius: '4px' }}>
                {locale === 'ar' ? 'مكتملة' : 'Completed'}
              </span>,
            ])}
          />
          <div style={{ padding: '7px 14px', fontSize: '11px', color: 'hsl(var(--muted-foreground))', borderTop: '1px solid hsl(var(--border))' }}>
            1–{recentSales.length} {locale === 'ar' ? `من ${salesReport?.total_count ?? 0}` : `of ${salesReport?.total_count ?? 0}`}
          </div>
        </D365Panel>

        {/* Bottom row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <D365Panel title={locale === 'ar' ? 'أدوية قاربت الانتهاء' : 'Medicines Nearing Expiry'} onViewAll={locale === 'ar' ? 'عرض الكل' : 'View all'} onViewAllClick={() => router.push('/admin/alerts')}>
            {expiringSoon.length === 0
              ? <p style={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>{tCommon('noData')}</p>
              : <D365Table
                  headers={[tCommon('name'), locale === 'ar' ? 'الدفعة' : 'Batch', locale === 'ar' ? 'الانتهاء' : 'Expiry']}
                  rows={expiringSoon.map((p) => {
                    const name = locale === 'ar' 
                      ? (p.medicine_name_ar || '-')
                      : (p.medicine_name_en || '-');
                    return [name, p.batch_number, <ExpiryBadge key={p.id} expiryDate={p.expiry_date} />];
                  })}
                />
            }
          </D365Panel>
          <D365Panel title={locale === 'ar' ? 'مخزون منخفض' : 'Low Stock'} onViewAll={locale === 'ar' ? 'عرض الكل' : 'View all'} onViewAllClick={() => router.push('/admin/alerts')}>
            {lowStock.length === 0
              ? <p style={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>{tCommon('noData')}</p>
              : <D365Table
                  headers={[tCommon('name'), locale === 'ar' ? 'المخزون' : 'Stock', locale === 'ar' ? 'الحد' : 'Threshold']}
                  rows={lowStock.slice(0, 6).map((m) => [
                    locale === 'ar' ? m.name_ar : m.name_en,
                    <StockBadge key={m.id} quantity={m.stock_quantity} threshold={m.low_stock_threshold} />,
                    String(m.low_stock_threshold),
                  ])}
                />
            }
          </D365Panel>
        </div>
      </div>
      )}

      {/* ── ANALYTICS tab content ── */}
      {activeTab === 'analytics' && (
      <div>

        {/* Profitability summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {[
            { label: locale === 'ar' ? 'إجمالي الإيراد' : 'Total Revenue', value: formatCurrency(totalRevenue, locale), color: 'hsl(var(--foreground))' },
            { label: locale === 'ar' ? 'عدد المعاملات' : 'Transactions', value: String(salesReport?.total_count ?? 0), color: 'hsl(var(--foreground))' },
            { label: locale === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT Collected', value: formatCurrency(salesReport ? parseFloat(salesReport.total_vat) : 0, locale), color: 'hsl(var(--muted-foreground))' },
          ].map((k) => (
            <div key={k.label} className="bg-card border border-border rounded-md p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-xl font-bold mt-1" style={{ color: k.color }}>{k.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{periodLabel}</p>
            </div>
          ))}
        </div>

        {/* Sales bar chart + Payment breakdown */}
        <div className="grid gap-4 mb-4 grid-cols-1 lg:grid-cols-[2fr_1fr]">
          <D365Panel title={`${locale === 'ar' ? 'المبيعات اليومية' : 'Daily Sales'} — ${periodLabel}`} noPadding>
            <div style={{ height: '200px', padding: '12px 14px 8px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={4} />
                  <YAxis tick={{ fontSize: 10 }} width={40} />
                  <Tooltip formatter={(v: number) => [formatCurrency(v, locale), '']} contentStyle={tooltipStyle} cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </D365Panel>

          <D365Panel title={locale === 'ar' ? 'طرق الدفع' : 'Payment Methods'} noPadding>
            <D365Table
              headers={[locale === 'ar' ? 'الطريقة' : 'Method', locale === 'ar' ? 'الفواتير' : 'Invoices', locale === 'ar' ? 'الإجمالي' : 'Total']}
              rows={breakdown.filter((b) => b.count > 0).map((b) => [
                lookupName(PAYMENT_METHODS, b.method, locale),
                b.count,
                <span key="t" className="font-medium">{formatCurrency(parseFloat(b.total), locale)}</span>,
              ])}
            />
          </D365Panel>
        </div>

        {/* Top selling with margin */}
        <D365Panel title={`${locale === 'ar' ? 'الأكثر مبيعاً' : 'Top Selling'} — ${periodLabel}`} noPadding>
          <D365Table
            headers={[locale === 'ar' ? 'الدواء' : 'Medicine', locale === 'ar' ? 'الوحدات' : 'Units', locale === 'ar' ? 'الإيراد' : 'Revenue']}
            rows={topMedsWithMargin.map((m) => [
              <span key="n" className="font-medium">{locale === 'ar' ? m.medicine_name_ar : m.medicine_name_en}</span>,
              m.units,
              formatCurrency(m.revenue, locale),
            ])}
          />
        </D365Panel>
      </div>
      )}

    </PageWrapper>
  );
}
