'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { api } from '@/app/lib/api';
import { useToast } from '@/hooks/use-toast';
import { ClipboardCheck, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';

interface CountItem {
  id: string;
  name_en: string;
  name_ar: string;
  barcode: string;
  category: string;
  db_quantity: number;
  branch_quantity: number;
  low_stock_threshold: number;
  counted_quantity: number | null;
  variance: number | null;
}

const S = {
  surface: 'hsl(222 47% 10%)', border: 'hsl(217 33% 20%)',
  fg: 'hsl(210 40% 98%)', muted: 'hsl(215 20% 65%)',
  subtle: 'hsl(215 16% 47%)', input: 'hsl(217 33% 17%)',
  inBdr: 'hsl(217 33% 22%)', primary: 'hsl(201 96% 40%)',
  success: 'hsl(142 71% 40%)', danger: 'hsl(0 84% 60%)',
  warn: 'hsl(38 92% 50%)',
};

export default function StockCountPage() {
  const locale = useLocale() as 'ar' | 'en';
  const { toast } = useToast();

  const [items, setItems] = useState<CountItem[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ adjustments_made: number; items: { medicine_id: string; db_quantity: number; counted_quantity: number; delta: number }[] } | null>(null);
  const [search, setSearch] = useState('');

  function loadSheet() {
    setLoading(true);
    setSubmitted(false);
    setResult(null);
    setCounts({});
    api.get<{ items: CountItem[] }>('/stockcount')
      .then((r) => setItems(r.items))
      .catch(() => toast({ title: locale === 'ar' ? 'فشل تحميل الجرد' : 'Failed to load count sheet', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadSheet(); }, []);

  const filtered = search.trim()
    ? items.filter((m) => m.name_en.toLowerCase().includes(search.toLowerCase()) || m.name_ar.includes(search) || m.barcode.includes(search))
    : items;

  const itemsWithVariance = filtered.map((m) => {
    const counted = counts[m.id] !== undefined ? parseInt(counts[m.id]) : null;
    const variance = counted !== null && !isNaN(counted) ? counted - m.branch_quantity : null;
    return { ...m, counted_quantity: counted, variance };
  });

  const changedCount = itemsWithVariance.filter((m) => m.variance !== null && m.variance !== 0).length;
  const totalCounted = Object.keys(counts).filter((k) => counts[k] !== '' && !isNaN(parseInt(counts[k]))).length;

  async function handleSubmit() {
    const toSubmit = itemsWithVariance.filter((m) => m.counted_quantity !== null && !isNaN(m.counted_quantity));
    if (toSubmit.length === 0) {
      toast({ title: locale === 'ar' ? 'لم يتم إدخال أي كميات' : 'No quantities entered', variant: 'destructive' });
      return;
    }
    const confirmed = confirm(
      locale === 'ar'
        ? `هل أنت متأكد؟ سيتم تعديل ${changedCount} صنف في المخزون.`
        : `Confirm? This will adjust stock for ${changedCount} item(s).`
    );
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const res = await api.post<typeof result>('/stockcount/submit', {
        items: toSubmit.map((m) => ({
          medicine_id: m.id,
          counted_quantity: m.counted_quantity,
          notes: `Stock count — ${new Date().toISOString().slice(0, 10)}`,
        })),
      });
      setResult(res);
      setSubmitted(true);
      toast({
        title: locale === 'ar' ? 'تم تقديم الجرد بنجاح' : 'Stock count submitted',
        description: locale === 'ar' ? `${res?.adjustments_made} تعديل` : `${res?.adjustments_made} adjustment(s)`,
      });
    } catch (err) {
      toast({ title: locale === 'ar' ? 'فشل تقديم الجرد' : 'Submit failed', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PosPageWrapper
      title={locale === 'ar' ? 'جرد المخزون' : 'Stock Count'}
      action={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {totalCounted > 0 && !submitted && (
            <span style={{ fontSize: '11px', color: S.muted }}>{totalCounted} {locale === 'ar' ? 'مُحصى' : 'counted'} · {changedCount} {locale === 'ar' ? 'فرق' : 'variance'}</span>
          )}
          {submitted ? (
            <button onClick={loadSheet}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: S.primary, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: '3px' }}>
              <RefreshCw style={{ width: '12px', height: '12px' }} />
              {locale === 'ar' ? 'جرد جديد' : 'New Count'}
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={submitting || totalCounted === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: totalCounted > 0 ? S.success : S.subtle, color: '#fff', border: 'none', cursor: totalCounted > 0 && !submitting ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: '3px', opacity: totalCounted === 0 ? 0.5 : 1 }}>
              <CheckCircle style={{ width: '12px', height: '12px' }} />
              {submitting ? (locale === 'ar' ? 'جارٍ...' : 'Submitting...') : (locale === 'ar' ? 'تأكيد الجرد' : 'Submit Count')}
            </button>
          )}
        </div>
      }
    >
      {/* Result summary */}
      {submitted && result && (
        <div style={{ background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)', borderRadius: '4px', padding: '12px 16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(142 71% 55%)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle style={{ width: '14px', height: '14px' }} />
            {locale === 'ar' ? `تم تقديم الجرد — ${result.adjustments_made} تعديل` : `Count submitted — ${result.adjustments_made} adjustment(s)`}
          </div>
          {result.items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {result.items.map((adj) => {
                const med = items.find((m) => m.id === adj.medicine_id);
                return (
                  <div key={adj.medicine_id} style={{ fontSize: '12px', color: S.muted, display: 'flex', gap: '12px' }}>
                    <span>{med ? (locale === 'ar' ? med.name_ar : med.name_en) : adj.medicine_id}</span>
                    <span style={{ color: adj.delta > 0 ? 'hsl(142 71% 55%)' : S.danger }}>
                      {adj.delta > 0 ? '+' : ''}{adj.delta}
                      {' '}{locale === 'ar' ? `(كان: ${adj.db_quantity} → أصبح: ${adj.counted_quantity})` : `(was: ${adj.db_quantity} → now: ${adj.counted_quantity})`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      {!submitted && (
        <div style={{ background: 'rgba(201,96,40,.06)', border: '1px solid rgba(201,96,40,.15)', borderRadius: '4px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: S.muted, display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <ClipboardCheck style={{ width: '14px', height: '14px', color: S.primary, flexShrink: 0, marginTop: '1px' }} />
          <span>
            {locale === 'ar'
              ? 'عُدّ كميات الأصناف في الرف وأدخلها في عمود "العدد الفعلي". اترك الخانة فارغة إذا لم تعدّ الصنف. اضغط "تأكيد الجرد" عند الانتهاء.'
              : 'Count the physical quantity of each item on the shelf and enter it in the "Counted" column. Leave blank if not counted. Press "Submit Count" when done.'}
          </span>
        </div>
      )}

      {/* Search */}
      <input
        style={{ ...{ background: S.input, border: `1px solid ${S.inBdr}`, color: S.fg, padding: '8px 12px', fontSize: '13px', width: '100%', outline: 'none', fontFamily: 'inherit', borderRadius: '3px' } as React.CSSProperties, marginBottom: '12px' }}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={locale === 'ar' ? 'ابحث باسم الدواء أو الباركود...' : 'Filter by medicine name or barcode...'}
      />

      {/* Count table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: S.muted, fontSize: '13px' }}>
          {locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: `1px solid ${S.border}`, borderRadius: '4px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: S.surface, borderBottom: `1px solid ${S.border}` }}>
                {[
                  locale === 'ar' ? 'الدواء' : 'Medicine',
                  locale === 'ar' ? 'الباركود' : 'Barcode',
                  locale === 'ar' ? 'المخزون في الدفعات' : 'Batch Stock',
                  locale === 'ar' ? 'العدد الفعلي' : 'Counted',
                  locale === 'ar' ? 'الفرق' : 'Variance',
                ].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'start', fontWeight: 600, color: S.muted, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itemsWithVariance.map((m, i) => {
                const hasVariance = m.variance !== null && m.variance !== 0;
                return (
                  <tr key={m.id} style={{ borderBottom: `1px solid ${S.border}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ fontWeight: 600, color: S.fg }}>{locale === 'ar' ? m.name_ar : m.name_en}</div>
                      <div style={{ fontSize: '10px', color: S.subtle }}>{locale === 'ar' ? m.name_en : m.name_ar}</div>
                    </td>
                    <td style={{ padding: '8px 12px', color: S.muted, fontFamily: 'monospace', fontSize: '11px' }}>{m.barcode || '—'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '2px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: 600,
                        background: m.branch_quantity <= m.low_stock_threshold ? 'rgba(239,68,68,.15)' : 'rgba(22,163,74,.15)',
                        color: m.branch_quantity <= m.low_stock_threshold ? S.danger : 'hsl(142 71% 55%)',
                      }}>
                        {m.branch_quantity <= m.low_stock_threshold && <AlertTriangle style={{ width: '10px', height: '10px' }} />}
                        {m.branch_quantity}
                      </span>
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <input
                        type="number"
                        min={0}
                        value={counts[m.id] ?? ''}
                        disabled={submitted}
                        onChange={(e) => setCounts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        placeholder={String(m.branch_quantity)}
                        style={{
                          width: '80px', padding: '5px 8px', fontSize: '13px', fontWeight: 600,
                          background: submitted ? 'transparent' : S.input,
                          border: `1px solid ${hasVariance ? (m.variance! > 0 ? 'rgba(22,163,74,.5)' : 'rgba(239,68,68,.5)') : S.inBdr}`,
                          color: S.fg, outline: 'none', fontFamily: 'inherit', borderRadius: '3px',
                          textAlign: 'center',
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {m.variance === null ? (
                        <span style={{ color: S.subtle, fontSize: '11px' }}>—</span>
                      ) : m.variance === 0 ? (
                        <span style={{ color: 'hsl(142 71% 55%)', fontSize: '11px', fontWeight: 600 }}>✓</span>
                      ) : (
                        <span style={{
                          fontSize: '12px', fontWeight: 700,
                          color: m.variance > 0 ? 'hsl(142 71% 55%)' : S.danger,
                        }}>
                          {m.variance > 0 ? '+' : ''}{m.variance}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PosPageWrapper>
  );
}
