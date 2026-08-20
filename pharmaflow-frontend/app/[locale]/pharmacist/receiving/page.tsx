'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { api, type ApiMedicine, type PaginatedResponse } from '@/app/lib/api';
import { useSession } from '@/app/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Search, CheckCircle, Package } from 'lucide-react';

interface ApiSupplier { id: string; name_en: string; name_ar: string; }

const S = {
  surface: 'hsl(222 47% 10%)', border: 'hsl(217 33% 20%)',
  fg: 'hsl(210 40% 98%)', muted: 'hsl(215 20% 65%)',
  subtle: 'hsl(215 16% 47%)', input: 'hsl(217 33% 17%)',
  inBdr: 'hsl(217 33% 22%)', primary: 'hsl(201 96% 40%)',
  success: 'hsl(142 71% 40%)', danger: 'hsl(0 84% 60%)',
};

const inp = {
  background: S.input, border: `1px solid ${S.inBdr}`, color: S.fg,
  padding: '8px 10px', fontSize: '13px', width: '100%',
  outline: 'none', fontFamily: 'inherit', borderRadius: '3px',
} as React.CSSProperties;

const lbl = {
  fontSize: '11px', color: S.muted, marginBottom: '4px', display: 'block',
} as React.CSSProperties;

export default function ReceivingPage() {
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { user } = useSession();
  const { toast } = useToast();

  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [medSearch, setMedSearch] = useState('');
  const [medResults, setMedResults] = useState<ApiMedicine[]>([]);
  const [selectedMed, setSelectedMed] = useState<ApiMedicine | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    supplier_id: '',
    batch_number: '',
    quantity: '',
    unit_cost: '',
    manufacturing_date: '',
    expiry_date: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<PaginatedResponse<ApiSupplier>>('/suppliers?page=1&page_size=100')
      .then((r) => setSuppliers(r.items))
      .catch(() => null);
  }, []);

  // Medicine search debounce
  useEffect(() => {
    if (!medSearch.trim()) { setMedResults([]); return; }
    const t = setTimeout(() => {
      api.get<PaginatedResponse<ApiMedicine>>(`/medicines?search=${encodeURIComponent(medSearch)}&page_size=8&is_active=true`)
        .then((r) => setMedResults(r.items))
        .catch(() => null);
    }, 250);
    return () => clearTimeout(t);
  }, [medSearch]);

  function selectMed(m: ApiMedicine) {
    setSelectedMed(m);
    setMedSearch('');
    setMedResults([]);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.supplier_id) e.supplier_id = locale === 'ar' ? 'مطلوب' : 'Required';
    if (!selectedMed) e.medicine = locale === 'ar' ? 'اختر دواءً' : 'Select a medicine';
    if (!form.batch_number.trim()) e.batch_number = locale === 'ar' ? 'مطلوب' : 'Required';
    if (!form.quantity || parseInt(form.quantity) <= 0) e.quantity = locale === 'ar' ? 'مطلوب' : 'Required';
    if (!form.unit_cost || parseFloat(form.unit_cost) <= 0) e.unit_cost = locale === 'ar' ? 'مطلوب' : 'Required';
    if (!form.expiry_date) e.expiry_date = locale === 'ar' ? 'مطلوب' : 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.post('/purchases', {
        supplier_id: form.supplier_id,
        medicine_id: selectedMed!.id,
        branch_id: user?.branch_id ?? '',
        batch_number: form.batch_number,
        quantity: parseInt(form.quantity),
        unit_cost: parseFloat(form.unit_cost).toFixed(3),
        manufacturing_date: form.manufacturing_date || null,
        expiry_date: form.expiry_date,
        notes: form.notes,
      });
      toast({
        title: locale === 'ar' ? 'تم استلام الدفعة بنجاح' : 'Batch received successfully',
        description: `${locale === 'ar' ? selectedMed!.name_ar : selectedMed!.name_en} — ${form.quantity} ${locale === 'ar' ? 'وحدة' : 'units'}`,
      });
      // Reset for next receipt
      setSelectedMed(null);
      setForm({ supplier_id: form.supplier_id, batch_number: '', quantity: '', unit_cost: '', manufacturing_date: '', expiry_date: '', notes: '' });
      setErrors({});
    } catch (err) {
      toast({
        title: locale === 'ar' ? 'فشل الاستلام' : 'Receive failed',
        description: err instanceof Error ? err.message : '',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PosPageWrapper title={locale === 'ar' ? 'استلام البضائع' : 'Picking & Receiving'}>
      <div style={{ maxWidth: '680px' }}>

        {/* Info banner */}
        <div style={{ background: 'rgba(201,96,40,.08)', border: '1px solid rgba(201,96,40,.2)', borderRadius: '4px', padding: '10px 14px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Package style={{ width: '16px', height: '16px', color: S.primary, flexShrink: 0 }} />
          <span style={{ fontSize: '12px', color: S.muted }}>
            {locale === 'ar'
              ? 'أدخل تفاصيل الدفعة المستلمة. سيتم تحديث المخزون فوراً وتسجيل الحركة في السجل.'
              : 'Enter the received batch details. Stock will be updated immediately and the movement logged.'}
          </span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Supplier */}
          <div>
            <label style={lbl}>{locale === 'ar' ? 'المورد *' : 'Supplier *'}</label>
            <select
              value={form.supplier_id}
              onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
              style={{ ...inp, appearance: 'none', colorScheme: 'dark' }}
            >
              <option value="">{locale === 'ar' ? 'اختر المورد...' : 'Select supplier...'}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{locale === 'ar' ? s.name_ar : s.name_en}</option>
              ))}
            </select>
            {errors.supplier_id && <p style={{ color: S.danger, fontSize: '11px', marginTop: '4px' }}>{errors.supplier_id}</p>}
          </div>

          {/* Medicine search */}
          <div>
            <label style={lbl}>{locale === 'ar' ? 'الدواء *' : 'Medicine *'}</label>
            {selectedMed ? (
              <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '3px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: S.fg }}>{locale === 'ar' ? selectedMed.name_ar : selectedMed.name_en}</div>
                  <div style={{ fontSize: '11px', color: S.muted }}>{locale === 'ar' ? selectedMed.name_en : selectedMed.name_ar} · {selectedMed.barcode}</div>
                </div>
                <button type="button" onClick={() => setSelectedMed(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.muted, fontSize: '12px' }}>
                  {locale === 'ar' ? 'تغيير' : 'Change'}
                </button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <Search style={{ position: 'absolute', top: '50%', insetInlineStart: '10px', transform: 'translateY(-50%)', width: '13px', height: '13px', color: S.subtle, pointerEvents: 'none' }} />
                <input
                  style={{ ...inp, paddingInlineStart: '30px' }}
                  value={medSearch}
                  onChange={(e) => setMedSearch(e.target.value)}
                  placeholder={locale === 'ar' ? 'ابحث باسم الدواء أو الباركود...' : 'Search by medicine name or barcode...'}
                  autoFocus
                />
                {medResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'hsl(222 40% 14%)', border: `1px solid ${S.border}`, borderRadius: '3px', zIndex: 10, maxHeight: '220px', overflowY: 'auto' }}>
                    {medResults.map((m) => (
                      <div key={m.id} onClick={() => selectMed(m)}
                        style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: `1px solid ${S.border}`, display: 'flex', justifyContent: 'space-between' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = S.surface; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ''; }}
                      >
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: S.fg }}>{locale === 'ar' ? m.name_ar : m.name_en}</div>
                          <div style={{ fontSize: '11px', color: S.muted }}>{m.barcode} · {locale === 'ar' ? `مخزون: ${m.stock_quantity}` : `Stock: ${m.stock_quantity}`}</div>
                        </div>
                        <div style={{ fontSize: '12px', color: S.primary, fontWeight: 600 }}>{parseFloat(m.selling_price).toFixed(2)} ر</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {errors.medicine && <p style={{ color: S.danger, fontSize: '11px', marginTop: '4px' }}>{errors.medicine}</p>}
          </div>

          {/* Batch number + Quantity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={lbl}>{locale === 'ar' ? 'رقم الدفعة *' : 'Batch Number *'}</label>
              <input style={inp} value={form.batch_number}
                onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
                placeholder="e.g. BN-2026-1234" />
              {errors.batch_number && <p style={{ color: S.danger, fontSize: '11px', marginTop: '4px' }}>{errors.batch_number}</p>}
            </div>
            <div>
              <label style={lbl}>{locale === 'ar' ? 'الكمية المستلمة *' : 'Quantity Received *'}</label>
              <input style={inp} type="number" min={1} value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                placeholder="0" />
              {errors.quantity && <p style={{ color: S.danger, fontSize: '11px', marginTop: '4px' }}>{errors.quantity}</p>}
            </div>
          </div>

          {/* Unit cost + Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={lbl}>{locale === 'ar' ? 'سعر الوحدة (ر.س) *' : 'Unit Cost (SAR) *'}</label>
              <input style={inp} type="number" step="0.001" min={0} value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                placeholder="0.000" />
              {errors.unit_cost && <p style={{ color: S.danger, fontSize: '11px', marginTop: '4px' }}>{errors.unit_cost}</p>}
            </div>
            <div>
              <label style={lbl}>{locale === 'ar' ? 'تاريخ التصنيع' : 'Manufacturing Date'}</label>
              <input style={inp} type="date" value={form.manufacturing_date}
                onChange={(e) => setForm({ ...form, manufacturing_date: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>{locale === 'ar' ? 'تاريخ الانتهاء *' : 'Expiry Date *'}</label>
              <input style={inp} type="date" value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
              {errors.expiry_date && <p style={{ color: S.danger, fontSize: '11px', marginTop: '4px' }}>{errors.expiry_date}</p>}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={lbl}>{locale === 'ar' ? 'ملاحظات' : 'Notes'}</label>
            <textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={locale === 'ar' ? 'رقم الفاتورة، اسم السائق، ملاحظات الفحص...' : 'Invoice ref, driver name, inspection notes...'} />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '10px', paddingTop: '4px' }}>
            <button type="button" onClick={() => router.push('/pharmacist/dashboard')}
              style={{ padding: '10px 20px', background: 'none', border: `1px solid ${S.inBdr}`, color: S.muted, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', borderRadius: '3px' }}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" disabled={submitting}
              style={{ flex: 1, padding: '10px 20px', background: submitting ? S.subtle : S.success, color: '#fff', border: 'none', cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: submitting ? 0.7 : 1 }}>
              <CheckCircle style={{ width: '16px', height: '16px' }} />
              {submitting
                ? (locale === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                : (locale === 'ar' ? 'تأكيد الاستلام' : 'Confirm Receipt')}
            </button>
          </div>
        </form>
      </div>
    </PosPageWrapper>
  );
}
