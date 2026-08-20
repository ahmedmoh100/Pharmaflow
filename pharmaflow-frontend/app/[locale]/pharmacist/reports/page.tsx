'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { api, type PaginatedResponse } from '@/app/lib/api';
import { useSession } from '@/app/lib/auth';
import { formatCurrency, isoDateOffset } from '@/app/lib/utils';
import { BarChart2, ClipboardList, Package, TrendingUp } from 'lucide-react';

interface ApiSale {
  id: string; invoice_number: string; subtotal_amount: string;
  vat_amount: string; total_amount: string; payment_method: string; sold_at: string;
}
interface ApiRx {
  id: string; rx_number: string; patient_name: string; status: string;
  dispensed_at: string | null; created_at: string;
  items: { medicine_name_en: string; medicine_name_ar: string; quantity: number }[];
}
interface ApiBatch {
  id: string; batch_number: string; medicine_name_en: string; medicine_name_ar: string;
  qty_received: number; unit_cost: string; expiry_date: string; created_at: string;
  supplier_name_en: string; supplier_name_ar: string;
}

const S = {
  surface: 'hsl(222 47% 10%)', border: 'hsl(217 33% 20%)',
  fg: 'hsl(210 40% 98%)', muted: 'hsl(215 20% 65%)',
  subtle: 'hsl(215 16% 47%)', primary: 'hsl(201 96% 40%)',
  success: 'hsl(142 71% 40%)',
};

type TabKey = 'sales' | 'prescriptions' | 'receiving';

const inp = { background: 'hsl(217 33% 17%)', border: '1px solid hsl(217 33% 22%)', color: 'hsl(210 40% 98%)', padding: '6px 10px', fontSize: '12px', outline: 'none', fontFamily: 'inherit', borderRadius: '3px' } as React.CSSProperties;

export default function PharmacistReportsPage() {
  const locale = useLocale() as 'ar' | 'en';
  const { user } = useSession();

  const [tab, setTab] = useState<TabKey>('sales');
  const [fromDate, setFromDate] = useState(isoDateOffset(-30));
  const [toDate, setToDate] = useState(isoDateOffset(0));

  // Sales
  const [sales, setSales] = useState<ApiSale[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesVat, setSalesVat] = useState(0);

  // Prescriptions
  const [prescriptions, setPrescriptions] = useState<ApiRx[]>([]);

  // Receiving
  const [batches, setBatches] = useState<ApiBatch[]>([]);
  const [batchesTotal, setBatchesTotal] = useState(0);

  const loadSales = useCallback(() => {
    api.get<PaginatedResponse<ApiSale>>('/sales?page=1&page_size=100')
      .then((r) => {
        const filtered = r.items.filter((s) =>
          s.sold_at.slice(0, 10) >= fromDate && s.sold_at.slice(0, 10) <= toDate
        );
        setSales(filtered);
        setSalesTotal(filtered.reduce((sum, s) => sum + parseFloat(s.total_amount), 0));
        setSalesVat(filtered.reduce((sum, s) => sum + parseFloat(s.vat_amount), 0));
      })
      .catch(() => null);
  }, [fromDate, toDate]);

  const loadPrescriptions = useCallback(() => {
    api.get<PaginatedResponse<ApiRx>>('/prescriptions?page=1&page_size=100')
      .then((r) => {
        setPrescriptions(r.items.filter((rx) =>
          rx.created_at.slice(0, 10) >= fromDate && rx.created_at.slice(0, 10) <= toDate
        ));
      })
      .catch(() => null);
  }, [fromDate, toDate]);

  const loadBatches = useCallback(() => {
    api.get<PaginatedResponse<ApiBatch>>('/purchases?page=1&page_size=100')
      .then((r) => {
        const filtered = r.items.filter((b) =>
          b.created_at.slice(0, 10) >= fromDate && b.created_at.slice(0, 10) <= toDate
        );
        setBatches(filtered);
        setBatchesTotal(filtered.reduce((sum, b) => sum + parseFloat(b.unit_cost) * b.qty_received, 0));
      })
      .catch(() => null);
  }, [fromDate, toDate]);

  useEffect(() => {
    if (tab === 'sales') loadSales();
    else if (tab === 'prescriptions') loadPrescriptions();
    else if (tab === 'receiving') loadBatches();
  }, [tab, fromDate, toDate, loadSales, loadPrescriptions, loadBatches]);

  const tabs: { key: TabKey; label_ar: string; label_en: string; icon: React.ElementType }[] = [
    { key: 'sales',         label_ar: 'مبيعاتي',        label_en: 'My Sales',      icon: TrendingUp },
    { key: 'prescriptions', label_ar: 'الوصفات',         label_en: 'Prescriptions', icon: ClipboardList },
    { key: 'receiving',     label_ar: 'الاستلام',        label_en: 'Receiving',     icon: Package },
  ];

  const tdStyle = { padding: '8px 12px', fontSize: '12px', borderBottom: `1px solid ${S.border}`, color: S.fg } as React.CSSProperties;
  const thStyle = { padding: '7px 12px', fontSize: '10px', fontWeight: 600, color: S.muted, textTransform: 'uppercase' as const, letterSpacing: '.05em', background: S.surface, borderBottom: `1px solid ${S.border}` };

  return (
    <PosPageWrapper title={locale === 'ar' ? 'التقارير' : 'Reports'}>

      {/* Date range */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: S.muted }}>{locale === 'ar' ? 'من' : 'From'}</span>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inp} />
        <span style={{ fontSize: '12px', color: S.muted }}>{locale === 'ar' ? 'إلى' : 'To'}</span>
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inp} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: `1px solid ${S.border}`, paddingBottom: '0' }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? S.primary : S.muted, borderBottom: tab === t.key ? `2px solid ${S.primary}` : '2px solid transparent', marginBottom: '-1px' }}>
              <Icon style={{ width: '13px', height: '13px' }} />
              {locale === 'ar' ? t.label_ar : t.label_en}
            </button>
          );
        })}
      </div>

      {/* ── Sales tab ── */}
      {tab === 'sales' && (
        <div>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
            {[
              { label_ar: 'عدد المبيعات', label_en: 'Transactions', value: String(sales.length), color: S.fg },
              { label_ar: 'إجمالي المبيعات', label_en: 'Total Revenue', value: formatCurrency(salesTotal, locale), color: S.primary },
              { label_ar: 'ضريبة القيمة المضافة', label_en: 'VAT Collected', value: formatCurrency(salesVat, locale), color: S.muted },
            ].map((k) => (
              <div key={k.label_en} style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '4px', padding: '14px 16px' }}>
                <div style={{ fontSize: '11px', color: S.muted, marginBottom: '6px' }}>{locale === 'ar' ? k.label_ar : k.label_en}</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {sales.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: S.muted, fontSize: '13px' }}>{locale === 'ar' ? 'لا توجد مبيعات في هذه الفترة' : 'No sales in this period'}</div>
          ) : (
            <div style={{ overflowX: 'auto', border: `1px solid ${S.border}`, borderRadius: '4px' }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{[locale === 'ar' ? 'رقم الفاتورة' : 'Invoice', locale === 'ar' ? 'التاريخ' : 'Date', locale === 'ar' ? 'طريقة الدفع' : 'Payment', locale === 'ar' ? 'المجموع' : 'Subtotal', 'VAT', locale === 'ar' ? 'الإجمالي' : 'Total'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sales.map((s, i) => (
                    <tr key={s.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)' }}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: S.primary }}>{s.invoice_number}</td>
                      <td style={tdStyle}>{s.sold_at.slice(0, 10)}</td>
                      <td style={{ ...tdStyle, color: S.muted }}>{s.payment_method}</td>
                      <td style={tdStyle}>{formatCurrency(parseFloat(s.subtotal_amount), locale)}</td>
                      <td style={{ ...tdStyle, color: S.muted }}>{formatCurrency(parseFloat(s.vat_amount), locale)}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{formatCurrency(parseFloat(s.total_amount), locale)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: S.surface }}>
                    <td colSpan={5} style={{ ...tdStyle, fontWeight: 600, textAlign: 'end' }}>{locale === 'ar' ? 'الإجمالي الكلي' : 'Grand Total'}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: S.primary }}>{formatCurrency(salesTotal, locale)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Prescriptions tab ── */}
      {tab === 'prescriptions' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
            {[
              { label_ar: 'إجمالي الوصفات', label_en: 'Total Rx', value: String(prescriptions.length) },
              { label_ar: 'تم الصرف', label_en: 'Dispensed', value: String(prescriptions.filter((r) => r.status === 'DISPENSED').length) },
              { label_ar: 'قيد الانتظار', label_en: 'Pending', value: String(prescriptions.filter((r) => r.status === 'PENDING').length) },
            ].map((k) => (
              <div key={k.label_en} style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '4px', padding: '14px 16px' }}>
                <div style={{ fontSize: '11px', color: S.muted, marginBottom: '6px' }}>{locale === 'ar' ? k.label_ar : k.label_en}</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: S.fg }}>{k.value}</div>
              </div>
            ))}
          </div>

          {prescriptions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: S.muted, fontSize: '13px' }}>{locale === 'ar' ? 'لا توجد وصفات في هذه الفترة' : 'No prescriptions in this period'}</div>
          ) : (
            <div style={{ overflowX: 'auto', border: `1px solid ${S.border}`, borderRadius: '4px' }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{[locale === 'ar' ? 'رقم الوصفة' : 'Rx #', locale === 'ar' ? 'المريض' : 'Patient', locale === 'ar' ? 'الأدوية' : 'Medicines', locale === 'ar' ? 'التاريخ' : 'Date', locale === 'ar' ? 'الحالة' : 'Status'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {prescriptions.map((rx, i) => (
                    <tr key={rx.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{rx.rx_number}</td>
                      <td style={tdStyle}>{rx.patient_name}</td>
                      <td style={tdStyle}>
                        {rx.items?.map((item, j) => (
                          <div key={j} style={{ fontSize: '11px', color: S.muted }}>
                            {locale === 'ar' ? item.medicine_name_ar : item.medicine_name_en} × {item.quantity}
                          </div>
                        ))}
                      </td>
                      <td style={tdStyle}>{rx.created_at.slice(0, 10)}</td>
                      <td style={tdStyle}>
                        <span style={{ padding: '2px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: 600, background: rx.status === 'DISPENSED' ? 'rgba(22,163,74,.2)' : rx.status === 'PENDING' ? 'rgba(217,119,6,.2)' : 'rgba(239,68,68,.2)', color: rx.status === 'DISPENSED' ? 'hsl(142 71% 55%)' : rx.status === 'PENDING' ? 'hsl(38 92% 60%)' : 'hsl(0 84% 65%)' }}>
                          {rx.status === 'DISPENSED' ? (locale === 'ar' ? 'تم الصرف' : 'Dispensed') : rx.status === 'PENDING' ? (locale === 'ar' ? 'قيد الانتظار' : 'Pending') : (locale === 'ar' ? 'ملغية' : 'Cancelled')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Receiving tab ── */}
      {tab === 'receiving' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '16px' }}>
            {[
              { label_ar: 'دفعات مستلمة', label_en: 'Batches Received', value: String(batches.length) },
              { label_ar: 'إجمالي قيمة الاستلام', label_en: 'Total Value', value: formatCurrency(batchesTotal, locale) },
            ].map((k) => (
              <div key={k.label_en} style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '4px', padding: '14px 16px' }}>
                <div style={{ fontSize: '11px', color: S.muted, marginBottom: '6px' }}>{locale === 'ar' ? k.label_ar : k.label_en}</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: S.fg }}>{k.value}</div>
              </div>
            ))}
          </div>

          {batches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: S.muted, fontSize: '13px' }}>{locale === 'ar' ? 'لا توجد استلامات في هذه الفترة' : 'No receipts in this period'}</div>
          ) : (
            <div style={{ overflowX: 'auto', border: `1px solid ${S.border}`, borderRadius: '4px' }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{[locale === 'ar' ? 'الدواء' : 'Medicine', locale === 'ar' ? 'رقم الدفعة' : 'Batch', locale === 'ar' ? 'المورد' : 'Supplier', locale === 'ar' ? 'الكمية' : 'Qty', locale === 'ar' ? 'سعر الوحدة' : 'Unit Cost', locale === 'ar' ? 'انتهاء الصلاحية' : 'Expiry', locale === 'ar' ? 'التاريخ' : 'Date'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {batches.map((b, i) => (
                    <tr key={b.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{locale === 'ar' ? b.medicine_name_ar : b.medicine_name_en}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px' }}>{b.batch_number}</td>
                      <td style={{ ...tdStyle, color: S.muted }}>{locale === 'ar' ? b.supplier_name_ar : b.supplier_name_en}</td>
                      <td style={tdStyle}>{b.qty_received}</td>
                      <td style={tdStyle}>{formatCurrency(parseFloat(b.unit_cost), locale)}</td>
                      <td style={tdStyle}>{b.expiry_date}</td>
                      <td style={{ ...tdStyle, color: S.muted }}>{b.created_at.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </PosPageWrapper>
  );
}
