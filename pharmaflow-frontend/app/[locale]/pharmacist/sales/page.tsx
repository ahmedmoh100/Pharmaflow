'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PAYMENT_METHODS, lookupName } from '@/app/lib/mock-data';
import { useSession } from '@/app/lib/auth';
import { api, type PaginatedResponse } from '@/app/lib/api';
import { formatCurrency, formatDateTime, isoDateOffset } from '@/app/lib/utils';
import { Eye, PlusCircle } from 'lucide-react';

const S = {
  primary: 'hsl(201 96% 40%)',
  fg:      'hsl(210 40% 98%)',
  muted:   'hsl(215 20% 65%)',
  surface: 'hsl(222 47% 10%)',
  border:  'hsl(217 33% 20%)',
};

interface ApiSale {
  id: string;
  invoice_number: string;
  subtotal_amount: string;
  vat_amount: string;
  total_amount: string;
  payment_method: string;
  sold_at: string;
  pharmacist_name?: string;
  has_return?: boolean;
}

export default function PharmacistSalesPage() {
  const t = useTranslations('sales');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const { user } = useSession();
  const router = useRouter();

  const [methodFilter, setMethodFilter] = useState('all');
  const [fromDate, setFromDate] = useState(isoDateOffset(-30));
  const [toDate, setToDate] = useState(isoDateOffset(0));
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [sales, setSales] = useState<ApiSale[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchSales = useCallback(() => {
    if (!user) return;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    api.get<PaginatedResponse<ApiSale>>(`/sales?${params}`)
      .then((res) => {
        // Filter client-side by date and method since backend doesn't have date range params yet
        let items = res.items;
        if (methodFilter !== 'all') items = items.filter((s) => s.payment_method === methodFilter);
        if (fromDate) items = items.filter((s) => s.sold_at.slice(0, 10) >= fromDate);
        if (toDate) items = items.filter((s) => s.sold_at.slice(0, 10) <= toDate);
        setSales(items);
        setTotal(res.total);
        setTotalAmount(items.reduce((sum, s) => sum + parseFloat(s.total_amount), 0));
      })
      .catch(() => { setSales([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [user, page, methodFilter, fromDate, toDate]);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  if (!user) return null;

  const columns: Column<ApiSale>[] = [
    { key: 'invoice',  header: t('invoiceNumber'),  render: (s) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontWeight: 600 }}>{s.invoice_number}</span>
        {s.has_return && (
          <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '3px', background: 'rgba(239,68,68,.15)', color: 'hsl(0 84% 65%)' }}>
            {locale === 'ar' ? 'مرتجع' : 'Returned'}
          </span>
        )}
      </div>
    ) },
    { key: 'subtotal', header: t('subtotal'),        render: (s) => formatCurrency(parseFloat(s.subtotal_amount), locale) },
    { key: 'vat',      header: t('vat'),             render: (s) => formatCurrency(parseFloat(s.vat_amount), locale) },
    { key: 'total',    header: t('total'),           render: (s) => <span style={{ fontWeight: 700 }}>{formatCurrency(parseFloat(s.total_amount), locale)}</span> },
    { key: 'method',   header: t('paymentMethod'),   render: (s) => lookupName(PAYMENT_METHODS, s.payment_method, locale) },
    { key: 'datetime', header: t('dateTime'),        render: (s) => formatDateTime(s.sold_at, locale) },
    {
      key: 'actions', header: tCommon('actions'),
      render: (s) => (
        <button
          onClick={() => router.push(`/pharmacist/sales/${s.id}` as `/${string}`)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.primary, display: 'flex', padding: '4px' }}
        >
          <Eye style={{ width: '15px', height: '15px' }} />
        </button>
      ),
    },
  ];

  const newSaleAction = (
    <button
      onClick={() => router.push('/pharmacist/sales/new')}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        background: S.primary, color: '#fff', border: 'none',
        padding: '7px 14px', fontSize: '12px', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', borderRadius: '3px',
      }}
    >
      <PlusCircle style={{ width: '13px', height: '13px' }} />
      {locale === 'ar' ? 'بيع جديد' : 'New Sale'}
    </button>
  );

  return (
    <PosPageWrapper title={locale === 'ar' ? 'مبيعاتي' : 'My Sales'} action={newSaleAction}>
      <DataTable
        columns={columns}
        data={sales}
        rowKey={(s) => s.id}
        emptyTitle={loading ? (locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...') : tCommon('noData')}
        filters={
          <>
            <Select value={methodFilter} onValueChange={(v) => { setMethodFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder={t('paymentMethod')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.code} value={m.code}>
                    {locale === 'ar' ? m.name_ar : m.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} className="w-40" />
            <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} className="w-40" />
          </>
        }
      />

      {/* Totals bar */}
      <div style={{ marginTop: '12px', padding: '12px 16px', background: S.surface, border: `1px solid ${S.border}`, borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: S.muted }}>{t('totalsBar')}</span>
        <span style={{ fontSize: '16px', fontWeight: 700, color: S.primary }}>{formatCurrency(totalAmount, locale)}</span>
      </div>
    </PosPageWrapper>
  );
}
