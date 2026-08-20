'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { api } from '@/app/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Search, RotateCcw, CheckCircle, Package } from 'lucide-react';

interface SaleItem {
  id: string;
  medicine_id: string;
  medicine_name_en: string;
  medicine_name_ar: string;
  quantity: number;
  unit_price: string;
  vat_rate: string;
  already_returned: number;
  returnable_qty: number;
  batch_id: string;
}

interface SaleLookup {
  id: string;
  invoice_number: string;
  sold_at: string;
  pharmacist_name: string;
  total_amount: string;
  payment_method: string;
  items: SaleItem[];
}

interface ReturnLine {
  sale_item_id: string;
  medicine_name_en: string;
  medicine_name_ar: string;
  unit_price: number;
  vat_rate: number;
  max_qty: number;
  return_qty: number;
  restockable: boolean;
  reason: string;
}

const S = {
  surface: 'hsl(222 47% 10%)', border: 'hsl(217 33% 20%)',
  fg: 'hsl(210 40% 98%)', muted: 'hsl(215 20% 65%)',
  subtle: 'hsl(215 16% 47%)', input: 'hsl(217 33% 17%)',
  inBdr: 'hsl(217 33% 22%)', primary: 'hsl(201 96% 40%)',
  success: 'hsl(142 71% 40%)', danger: 'hsl(0 84% 60%)',
  warn: 'hsl(38 92% 50%)',
};

const inp = { background: S.input, border: `1px solid ${S.inBdr}`, color: S.fg, padding: '8px 10px', fontSize: '13px', outline: 'none', fontFamily: 'inherit', borderRadius: '3px' } as React.CSSProperties;

export default function ReturnTransactionPage() {
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { toast } = useToast();

  const [invoiceInput, setInvoiceInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [sale, setSale] = useState<SaleLookup | null>(null);
  const [returnLines, setReturnLines] = useState<ReturnLine[]>([]);
  const [globalReason, setGlobalReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ credit_note_number: string; total_refund: string } | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceInput.trim()) return;
    setSearching(true);
    setSale(null);
    setReturnLines([]);
    setDone(null);
    try {
      const result = await api.get<SaleLookup>(`/returns/lookup/${invoiceInput.trim().toUpperCase()}`);
      setSale(result);
      // Pre-populate return lines for items that can still be returned
      setReturnLines(
        result.items
          .filter((i) => i.returnable_qty > 0)
          .map((i) => ({
            sale_item_id:    i.id,
            medicine_name_en: i.medicine_name_en,
            medicine_name_ar: i.medicine_name_ar,
            unit_price:      parseFloat(i.unit_price),
            vat_rate:        parseFloat(i.vat_rate),
            max_qty:         i.returnable_qty,
            return_qty:      i.returnable_qty, // default to full return
            restockable:     true,
            reason:          '',
          }))
      );
    } catch (err) {
      toast({
        title: locale === 'ar' ? 'الفاتورة غير موجودة' : 'Invoice not found',
        description: err instanceof Error ? err.message : '',
        variant: 'destructive',
      });
    } finally {
      setSearching(false);
    }
  }

  function updateLine(sale_item_id: string, field: keyof ReturnLine, value: unknown) {
    setReturnLines((prev) => prev.map((l) => l.sale_item_id === sale_item_id ? { ...l, [field]: value } : l));
  }

  const selectedLines = returnLines.filter((l) => l.return_qty > 0);

  const totalRefund = selectedLines.reduce((sum, l) => {
    const lineSubtotal = l.unit_price * l.return_qty;
    const lineVat = lineSubtotal * (l.vat_rate / 100);
    return sum + lineSubtotal + lineVat;
  }, 0);

  async function handleSubmit() {
    if (selectedLines.length === 0) {
      toast({ title: locale === 'ar' ? 'لم يتم تحديد أي صنف' : 'No items selected', variant: 'destructive' });
      return;
    }
    if (!globalReason.trim()) {
      toast({ title: locale === 'ar' ? 'يرجى إدخال سبب الإرجاع' : 'Return reason is required', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.post<{ credit_note_number: string; total_refund: string }>(
        '/returns',
        {
          sale_id: sale!.id,
          reason: globalReason,
          items: selectedLines.map((l) => ({
            sale_item_id: l.sale_item_id,
            quantity: l.return_qty,
            restockable: l.restockable,
            reason: l.reason || globalReason,
          })),
        }
      );
      setDone(result);
      toast({
        title: locale === 'ar' ? 'تم الإرجاع بنجاح' : 'Return processed',
        description: `${result.credit_note_number} — ${parseFloat(result.total_refund).toFixed(3)} SAR`,
      });
    } catch (err) {
      toast({
        title: locale === 'ar' ? 'فشل الإرجاع' : 'Return failed',
        description: err instanceof Error ? err.message : '',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Done state ──────────────────────────────────────────────────────────────
  if (done) {
    return (
      <PosPageWrapper title={locale === 'ar' ? 'إرجاع بضاعة' : 'Return Transaction'}>
        <div style={{ maxWidth: '520px' }}>
          <div style={{ background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)', borderRadius: '6px', padding: '24px', textAlign: 'center' }}>
            <CheckCircle style={{ width: '40px', height: '40px', color: 'hsl(142 71% 55%)', margin: '0 auto 12px' }} />
            <div style={{ fontSize: '16px', fontWeight: 700, color: S.fg, marginBottom: '8px' }}>
              {locale === 'ar' ? 'تم الإرجاع بنجاح' : 'Return Processed'}
            </div>
            <div style={{ fontSize: '13px', color: S.muted, marginBottom: '4px' }}>
              {locale === 'ar' ? 'رقم إشعار الدائن' : 'Credit Note #'}:
              <span style={{ fontWeight: 700, color: S.fg, marginInlineStart: '8px' }}>{done.credit_note_number}</span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'hsl(142 71% 55%)', marginTop: '12px' }}>
              {locale === 'ar' ? 'المبلغ المسترد' : 'Refund Amount'}: {parseFloat(done.total_refund).toFixed(3)} {locale === 'ar' ? 'ر.س' : 'SAR'}
            </div>
            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button onClick={() => { setSale(null); setInvoiceInput(''); setDone(null); setGlobalReason(''); }}
                style={{ padding: '8px 20px', background: S.primary, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, borderRadius: '3px' }}>
                {locale === 'ar' ? 'إرجاع جديد' : 'New Return'}
              </button>
              <button onClick={() => router.push('/pharmacist/dashboard')}
                style={{ padding: '8px 20px', background: 'none', border: `1px solid ${S.inBdr}`, color: S.muted, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', borderRadius: '3px' }}>
                {locale === 'ar' ? 'الرئيسية' : 'Home'}
              </button>
            </div>
          </div>
        </div>
      </PosPageWrapper>
    );
  }

  return (
    <PosPageWrapper title={locale === 'ar' ? 'إرجاع بضاعة' : 'Return Transaction'}>
      <div style={{ maxWidth: '720px' }}>

        {/* Step 1 — Find invoice */}
        <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '4px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: S.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '10px' }}>
            {locale === 'ar' ? 'الخطوة 1 — ابحث عن الفاتورة' : 'Step 1 — Find Invoice'}
          </div>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search style={{ position: 'absolute', top: '50%', insetInlineStart: '10px', transform: 'translateY(-50%)', width: '13px', height: '13px', color: S.subtle, pointerEvents: 'none' }} />
              <input
                style={{ ...inp, width: '100%', paddingInlineStart: '30px' }}
                value={invoiceInput}
                onChange={(e) => setInvoiceInput(e.target.value)}
                placeholder={locale === 'ar' ? 'رقم الفاتورة (مثال: MKK02-2026-000001)' : 'Invoice number (e.g. MKK02-2026-000001)'}
                autoFocus
              />
            </div>
            <button type="submit" disabled={searching || !invoiceInput.trim()}
              style={{ padding: '8px 18px', background: S.primary, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, borderRadius: '3px', opacity: !invoiceInput.trim() ? 0.5 : 1 }}>
              {searching ? (locale === 'ar' ? '...' : '...') : (locale === 'ar' ? 'بحث' : 'Search')}
            </button>
          </form>
        </div>

        {/* Sale found */}
        {sale && (
          <>
            {/* Sale summary */}
            <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '4px', padding: '12px 16px', marginBottom: '12px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '10px', color: S.subtle, marginBottom: '2px' }}>{locale === 'ar' ? 'رقم الفاتورة' : 'Invoice'}</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: S.fg }}>{sale.invoice_number}</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: S.subtle, marginBottom: '2px' }}>{locale === 'ar' ? 'التاريخ' : 'Date'}</div>
                <div style={{ fontSize: '13px', color: S.fg }}>{sale.sold_at.slice(0, 10)}</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: S.subtle, marginBottom: '2px' }}>{locale === 'ar' ? 'الصيدلي' : 'Pharmacist'}</div>
                <div style={{ fontSize: '13px', color: S.fg }}>{sale.pharmacist_name}</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: S.subtle, marginBottom: '2px' }}>{locale === 'ar' ? 'الإجمالي' : 'Total'}</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: S.primary }}>{parseFloat(sale.total_amount).toFixed(3)} SAR</div>
              </div>
            </div>

            {/* Step 2 — Select items */}
            <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '4px', padding: '16px', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: S.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '12px' }}>
                {locale === 'ar' ? 'الخطوة 2 — حدد الأصناف المرتجعة' : 'Step 2 — Select Items to Return'}
              </div>
              {returnLines.length === 0 ? (
                <p style={{ fontSize: '13px', color: S.muted }}>
                  {locale === 'ar' ? 'جميع أصناف هذه الفاتورة تم إرجاعها مسبقاً.' : 'All items on this invoice have already been returned.'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {returnLines.map((line) => (
                    <div key={line.sale_item_id} style={{ background: 'hsl(222 40% 14%)', border: `1px solid ${S.border}`, borderRadius: '3px', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: S.fg }}>{locale === 'ar' ? line.medicine_name_ar : line.medicine_name_en}</div>
                          <div style={{ fontSize: '11px', color: S.muted }}>{locale === 'ar' ? line.medicine_name_en : line.medicine_name_ar} · {line.unit_price.toFixed(3)} SAR</div>
                        </div>
                        <div style={{ fontSize: '11px', color: S.subtle }}>{locale === 'ar' ? `الحد الأقصى: ${line.max_qty}` : `Max: ${line.max_qty}`}</div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto', gap: '10px', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '10px', color: S.subtle, marginBottom: '3px' }}>{locale === 'ar' ? 'الكمية' : 'Qty'}</div>
                          <input type="number" min={0} max={line.max_qty} value={line.return_qty}
                            onChange={(e) => updateLine(line.sale_item_id, 'return_qty', Math.min(line.max_qty, Math.max(0, parseInt(e.target.value) || 0)))}
                            style={{ ...inp, width: '70px', textAlign: 'center', padding: '5px 6px' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: '10px', color: S.subtle, marginBottom: '3px' }}>{locale === 'ar' ? 'سبب الصنف (اختياري)' : 'Item reason (optional)'}</div>
                          <input value={line.reason}
                            onChange={(e) => updateLine(line.sale_item_id, 'reason', e.target.value)}
                            style={{ ...inp, width: '100%' }}
                            placeholder={locale === 'ar' ? 'مثال: منتهي الصلاحية، تالف...' : 'e.g. expired, damaged...'} />
                        </div>
                        <div style={{ paddingTop: '14px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: S.muted, cursor: 'pointer' }}>
                            <input type="checkbox" checked={line.restockable}
                              onChange={(e) => updateLine(line.sale_item_id, 'restockable', e.target.checked)}
                              style={{ accentColor: S.primary }} />
                            {locale === 'ar' ? 'إعادة للمخزون' : 'Restock'}
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Step 3 — Reason + confirm */}
            {returnLines.length > 0 && (
              <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '4px', padding: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: S.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '12px' }}>
                  {locale === 'ar' ? 'الخطوة 3 — سبب الإرجاع والتأكيد' : 'Step 3 — Reason & Confirm'}
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '11px', color: S.subtle, marginBottom: '4px' }}>{locale === 'ar' ? 'سبب الإرجاع *' : 'Return reason *'}</div>
                  <input value={globalReason} onChange={(e) => setGlobalReason(e.target.value)}
                    style={{ ...inp, width: '100%' }}
                    placeholder={locale === 'ar' ? 'مثال: طلب العميل، منتج تالف، خطأ في الصرف...' : 'e.g. Customer request, damaged product, dispensing error...'} />
                </div>

                {/* Refund summary */}
                <div style={{ background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.2)', borderRadius: '3px', padding: '10px 14px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '12px', color: S.muted }}>
                    {locale === 'ar' ? `${selectedLines.length} صنف مرتجع` : `${selectedLines.length} item(s) to return`}
                    {selectedLines.filter((l) => l.restockable).length > 0 && (
                      <span style={{ marginInlineStart: '8px', color: 'hsl(142 71% 55%)' }}>
                        · {selectedLines.filter((l) => l.restockable).length} {locale === 'ar' ? 'تُعاد للمخزون' : 'restockable'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'hsl(142 71% 55%)' }}>
                    {locale === 'ar' ? 'المبلغ المسترد' : 'Refund'}: {totalRefund.toFixed(3)} SAR
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => { setSale(null); setInvoiceInput(''); }}
                    style={{ padding: '10px 20px', background: 'none', border: `1px solid ${S.inBdr}`, color: S.muted, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', borderRadius: '3px' }}>
                    {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={handleSubmit} disabled={submitting || selectedLines.length === 0 || !globalReason.trim()}
                    style={{ flex: 1, padding: '10px 20px', background: selectedLines.length > 0 && globalReason.trim() ? S.danger : S.subtle, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: submitting ? 0.7 : 1 }}>
                    <RotateCcw style={{ width: '15px', height: '15px' }} />
                    {submitting
                      ? (locale === 'ar' ? 'جارٍ المعالجة...' : 'Processing...')
                      : (locale === 'ar' ? 'تأكيد الإرجاع' : 'Confirm Return')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PosPageWrapper>
  );
}
