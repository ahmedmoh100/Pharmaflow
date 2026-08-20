'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter } from '@/app/i18n/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { D365Panel } from '@/components/shared/D365Panel';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PAYMENT_METHODS, lookupName } from '@/app/lib/mock-data';
import type { Sale } from '@/app/lib/types';
import { formatCurrency, formatDateTime, isoDateOffset, buildZatcaTlv } from '@/app/lib/utils';
import { api, type PaginatedResponse } from '@/app/lib/api';
import { Eye, Printer, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { downloadCSV } from '@/app/lib/csv';
import { useBranch } from '@/app/context/BranchContext';

export default function AdminSalesPage() {
  const t = useTranslations('sales');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { branchId } = useBranch();
  const [userFilter, setUserFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [fromDate, setFromDate] = useState(isoDateOffset(-30));
  const [toDate, setToDate] = useState(isoDateOffset(0));
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiBranches, setApiBranches] = useState<{ id: string; name_en: string; name_ar: string; is_active: number }[]>([]);
  const [apiUsers, setApiUsers] = useState<{ id: string; full_name: string }[]>([]);

  // Sync topbar branch picker → local branch filter
  useEffect(() => {
    setBranchFilter(branchId || 'all');
  }, [branchId]);

  useEffect(() => {
    api.get<{ items: typeof apiBranches }>('/branches?page_size=50')
      .then((res) => setApiBranches(res.items)).catch(() => null);
    api.get<{ items: typeof apiUsers }>('/users?page_size=100')
      .then((res) => setApiUsers(res.items)).catch(() => null);
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    if (branchFilter !== 'all') params.set('branch_id', branchFilter);
    if (userFilter !== 'all') params.set('user_id', userFilter);
    api.get<PaginatedResponse<Sale>>(`/sales?${params}`)
      .then((res) => setSales(res.items))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [branchFilter, userFilter]);

  const filtered = sales.filter((s) => {
    if (methodFilter !== 'all' && s.payment_method !== methodFilter) return false;
    if (fromDate && s.sold_at.slice(0, 10) < fromDate) return false;
    if (toDate && s.sold_at.slice(0, 10) > toDate) return false;
    return true;
  });

  const totalSubtotal = filtered.reduce((sum, s) => sum + parseFloat(String(s.subtotal_amount)), 0);
  const totalVat = filtered.reduce((sum, s) => sum + parseFloat(String(s.vat_amount)), 0);
  const totalTotal = filtered.reduce((sum, s) => sum + parseFloat(String(s.total_amount)), 0);

  async function handlePrintReceipt() {
    const sale = selectedSale;
    if (!sale) return;
    // Fetch real items from API
    let items: { medicine_name_en: string; medicine_name_ar: string; quantity: number; unit_price: string; vat_rate: string; vat_amount: string }[] = [];
    try {
      const detail = await api.get<{ items: typeof items }>(`/sales/${sale.id}`);
      items = detail.items ?? [];
    } catch { return; }
    const pharmacist = (sale as unknown as { pharmacist_name?: string }).pharmacist_name ?? '-';
    const dir = locale === 'ar' ? 'rtl' : 'ltr';
    const L = locale === 'ar'
      ? { invoice: 'رقم الفاتورة', ph: 'الصيدلي', pay: 'طريقة الدفع', med: 'الدواء', qty: 'الكمية', unit: 'سعر الوحدة', tot: 'الإجمالي', sub: 'المجموع الفرعي', vat: 'ضريبة القيمة المضافة', grand: 'الإجمالي النهائي', date: 'التاريخ', type: 'فاتورة ضريبية مبسطة' }
      : { invoice: 'Invoice #', ph: 'Pharmacist', pay: 'Payment', med: 'Medicine', qty: 'Qty', unit: 'Unit Price', tot: 'Total', sub: 'Subtotal', vat: 'VAT', grand: 'Grand Total', date: 'Date', type: 'Simplified Tax Invoice' };
    const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const tlv = buildZatcaTlv({ sellerName: 'PharmaFlow Demo', vatNumber: '311111111111113', timestamp: sale.sold_at, totalWithVat: sale.total_amount, vatTotal: sale.vat_amount });
    const qr = await QRCode.toDataURL(tlv, { width: 96, margin: 1, errorCorrectionLevel: 'M' });
    const rows = items.map((item) => {
      const name = locale === 'ar' ? item.medicine_name_ar : item.medicine_name_en;
      const lineTotal = parseFloat(item.unit_price) * item.quantity;
      return `<tr><td>${esc(name)}</td><td>${esc(String(item.quantity))}</td><td>${esc(formatCurrency(parseFloat(item.unit_price), locale))}</td><td>${esc(formatCurrency(lineTotal, locale))}</td></tr>`;
    }).join('');
    const vatRows = (sale.vat_breakdown ?? []).map((b: { rate: number; vat_amount: number }) => `<tr><td>${esc(L.vat)} (${b.rate}%)</td><td colspan="2"></td><td>${esc(formatCurrency(b.vat_amount, locale))}</td></tr>`).join('');
    const w = window.open('', '_blank', 'width=400,height=650');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(sale.invoice_number)}</title><style>@page{size:80mm auto;margin:0}body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:12px;padding:12px;direction:${dir}}table{width:100%;border-collapse:collapse}td,th{padding:4px 6px;text-align:start}th{border-bottom:1px solid #ccc;font-weight:600}.center{text-align:center}.bold{font-weight:700}.muted{color:#666}.sep{border-top:1px dashed #ccc;margin:8px 0}</style></head><body><div class="center" style="padding:6px 0;border-bottom:2px solid #000;margin-bottom:8px"><img src="${window.location.origin}/logo.png" style="height:80px;width:auto;filter:brightness(0)" alt="PharmaFlow"/></div><div style="display:flex;justify-content:space-between;font-size:11px;color:#666;margin-bottom:6px"><span>VAT: 311111111111113</span><span>${esc(L.type)}</span></div><div class="sep"></div><div><b>${esc(L.invoice)}:</b> ${esc(sale.invoice_number)}</div><div><b>${esc(L.date)}:</b> ${esc(formatDateTime(sale.sold_at, locale))}</div><div><b>${esc(L.ph)}:</b> ${esc(pharmacist)}</div><div><b>${esc(L.pay)}:</b> ${esc(lookupName(PAYMENT_METHODS, sale.payment_method, locale))}</div><div class="sep"></div><table><thead><tr><th>${esc(L.med)}</th><th>${esc(L.qty)}</th><th>${esc(L.unit)}</th><th>${esc(L.tot)}</th></tr></thead><tbody>${rows}</tbody></table><div class="sep"></div><table><tbody><tr><td>${esc(L.sub)}</td><td colspan="2"></td><td>${esc(formatCurrency(sale.subtotal_amount, locale))}</td></tr>${vatRows}<tr class="bold"><td>${esc(L.grand)}</td><td colspan="2"></td><td>${esc(formatCurrency(sale.total_amount, locale))}</td></tr></tbody></table><div class="sep"></div><div class="center"><img src="${qr}" width="96" height="96"/></div></body></html>`);
    w.document.close();
    w.focus();
    w.print();
    w.close();
  }

  const columns: Column<Sale>[] = [
    { key: 'invoice', header: t('invoiceNumber'), render: (s) => <span className="font-medium">{s.invoice_number}</span> },
    { key: 'pharmacist', header: t('pharmacist'), render: (s) => (s as unknown as { pharmacist_name?: string }).pharmacist_name ?? '-' },
    { key: 'subtotal', header: t('subtotal'), render: (s) => formatCurrency(s.subtotal_amount, locale) },
    { key: 'vat', header: t('vat'), render: (s) => formatCurrency(s.vat_amount, locale) },
    { key: 'total', header: t('total'), render: (s) => <span className="font-semibold">{formatCurrency(s.total_amount, locale)}</span> },
    { key: 'method', header: t('paymentMethod'), render: (s) => lookupName(PAYMENT_METHODS, s.payment_method, locale) },
    { key: 'datetime', header: t('dateTime'), render: (s) => formatDateTime(s.sold_at, locale) },
    {
      key: 'actions', header: tCommon('actions'),
      render: (s) => (
        <Link href={`/admin/sales/${s.id}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Eye className="h-4 w-4" />
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <PageWrapper
      title={t('title')}
      tabs={[
        { key: 'sales', label: locale === 'ar' ? 'المبيعات' : 'Sales' },
      ]}
      defaultTab="sales"
      actions={[
        {
          label: locale === 'ar' ? 'عرض' : 'View',
          icon: <Eye style={{ width: '13px', height: '13px' }} />,
          onClick: () => { if (selectedSale) router.push(`/admin/sales/${selectedSale.id}`); },
        },
        {
          label: locale === 'ar' ? 'طباعة إيصال' : 'Print receipt',
          icon: <Printer style={{ width: '13px', height: '13px' }} />,
          onClick: handlePrintReceipt,
          separator: true,
        },
        {
          label: locale === 'ar' ? 'تصدير' : 'Export',
          icon: <Download style={{ width: '13px', height: '13px' }} />,
          onClick: () => {
            const headers = ['invoice_number', 'pharmacist', 'date', 'payment_method', 'subtotal', 'vat', 'total'];
            const rows = filtered.map((s) => [
              s.invoice_number,
              (s as unknown as { pharmacist_name?: string }).pharmacist_name ?? '-',
              s.sold_at.slice(0, 16).replace('T', ' '),
              s.payment_method,
              String(s.subtotal_amount),
              String(s.vat_amount),
              String(s.total_amount),
            ]);
            downloadCSV(`sales_${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows]);
          },
        },
      ]}
      breadcrumb={[{ label: locale === 'ar' ? 'المبيعات' : 'Sales' }]}
    >
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(s) => s.id}
        emptyTitle={tCommon('noData')}
        onRowClick={(s) => setSelectedSale(s)}
        filters={
          <>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder={locale === 'ar' ? 'الفرع' : 'Branch'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                {apiBranches.filter((b) => b.is_active).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{locale === 'ar' ? b.name_ar : b.name_en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder={t('pharmacist')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                {apiUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger className="w-32"><SelectValue placeholder={t('paymentMethod')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                {PAYMENT_METHODS.map((m) => <SelectItem key={m.code} value={m.code}>{locale === 'ar' ? m.name_ar : m.name_en}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
          </>
        }
      />

      <D365Panel title={locale === 'ar' ? 'الإجماليات' : 'Totals'}>
        <div className="flex flex-wrap gap-6 items-end">
          <div>
            <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'عدد المعاملات' : 'Transactions'}</p>
            <p className="text-lg font-bold">{filtered.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('subtotal')}</p>
            <p className="text-lg font-bold">{formatCurrency(totalSubtotal, locale)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('vat')}</p>
            <p className="text-lg font-bold">{formatCurrency(totalVat, locale)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('total')}</p>
            <p className="text-lg font-bold text-primary">{formatCurrency(totalTotal, locale)}</p>
          </div>
        </div>
      </D365Panel>
    </PageWrapper>
  );
}
