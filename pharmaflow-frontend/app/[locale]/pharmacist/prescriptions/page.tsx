'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, type PaginatedResponse } from '@/app/lib/api';
import { useToast } from '@/hooks/use-toast';
import { PlusCircle, RefreshCw } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RxItem {
  id: string;
  medicine_id: string;
  medicine_name_en: string;
  medicine_name_ar: string;
  quantity: number;
  dosage_instructions: string;
  selling_price: string;
  vat_category: string;
}

interface Prescription {
  id: string;
  rx_number: string;
  patient_name: string;
  patient_id_number: string;
  prescriber_name: string;
  prescriber_license: string;
  status: 'PENDING' | 'DISPENSED' | 'CANCELLED';
  notes: string;
  sale_id: string | null;
  dispensed_by: string | null;
  dispensed_by_name: string | null;
  dispensed_at: string | null;
  created_at: string;
  items: RxItem[];
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { ar: string; en: string; bg: string; color: string }> = {
  PENDING:   { ar: 'قيد الانتظار', en: 'Pending',   bg: 'rgba(217,119,6,.2)',  color: 'hsl(38 92% 60%)' },
  DISPENSED: { ar: 'تم الصرف',     en: 'Dispensed', bg: 'rgba(22,163,74,.2)',   color: 'hsl(142 71% 55%)' },
  CANCELLED: { ar: 'ملغية',        en: 'Cancelled', bg: 'rgba(239,68,68,.2)',   color: 'hsl(0 84% 65%)' },
};

// ── New Rx Modal ──────────────────────────────────────────────────────────────

interface NewRxModalProps {
  locale: 'ar' | 'en';
  onClose: () => void;
  onCreated: () => void;
}

interface MedicineOption {
  id: string;
  name_en: string;
  name_ar: string;
  requires_prescription: boolean;
}

function NewRxModal({ locale, onClose, onCreated }: NewRxModalProps) {
  const { toast } = useToast();
  const [patientName, setPatientName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [prescriberName, setPrescriberName] = useState('');
  const [prescriberLicense, setPrescriberLicense] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ medicine_id: string; medicine_name: string; quantity: number; dosage: string }[]>([]);
  const [medSearch, setMedSearch] = useState('');
  const [medResults, setMedResults] = useState<MedicineOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Medicine search
  useEffect(() => {
    if (!medSearch.trim()) { setMedResults([]); return; }
    const t = setTimeout(() => {
      api.get<PaginatedResponse<MedicineOption>>(`/medicines?search=${encodeURIComponent(medSearch)}&page_size=6&is_active=true`)
        .then((r) => setMedResults(r.items))
        .catch(() => null);
    }, 250);
    return () => clearTimeout(t);
  }, [medSearch]);

  function addMedicine(med: MedicineOption) {
    if (items.find((i) => i.medicine_id === med.id)) { setMedSearch(''); return; }
    setItems((prev) => [...prev, {
      medicine_id: med.id,
      medicine_name: locale === 'ar' ? med.name_ar : med.name_en,
      quantity: 1,
      dosage: '',
    }]);
    setMedSearch('');
    setMedResults([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!patientName.trim() || !prescriberName.trim() || items.length === 0) {
      toast({ title: locale === 'ar' ? 'يرجى ملء جميع الحقول المطلوبة' : 'Fill all required fields', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/prescriptions', {
        patient_name: patientName,
        patient_id_number: patientId,
        prescriber_name: prescriberName,
        prescriber_license: prescriberLicense,
        notes,
        items: items.map((i) => ({
          medicine_id: i.medicine_id,
          quantity: i.quantity,
          dosage_instructions: i.dosage,
        })),
      });
      toast({ title: locale === 'ar' ? 'تم إنشاء الوصفة' : 'Prescription created' });
      onCreated();
    } catch (err) {
      toast({ title: locale === 'ar' ? 'فشل إنشاء الوصفة' : 'Failed to create prescription', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  const inp = { background: 'hsl(217 33% 17%)', border: '1px solid hsl(217 33% 22%)', color: 'hsl(210 40% 98%)', padding: '7px 10px', fontSize: '13px', width: '100%', outline: 'none', fontFamily: 'inherit', borderRadius: '3px' } as React.CSSProperties;
  const lbl = { fontSize: '11px', color: 'hsl(215 20% 65%)', marginBottom: '4px', display: 'block' } as React.CSSProperties;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)' }} />
      <div style={{ position: 'relative', background: 'hsl(222 47% 10%)', border: '1px solid hsl(217 33% 20%)', width: '580px', maxHeight: '90vh', overflowY: 'auto', borderRadius: '4px', zIndex: 1, scrollbarWidth: 'thin', scrollbarColor: 'hsl(217 33% 25%) transparent' } as React.CSSProperties}>
        <div style={{ padding: '16px', borderBottom: '1px solid hsl(217 33% 20%)', fontSize: '14px', fontWeight: 600, color: 'hsl(210 40% 98%)' }}>
          {locale === 'ar' ? 'وصفة طبية جديدة' : 'New Prescription'}
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Patient */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={lbl}>{locale === 'ar' ? 'اسم المريض *' : 'Patient Name *'}</label>
              <input style={inp} value={patientName} onChange={(e) => setPatientName(e.target.value)} required />
            </div>
            <div>
              <label style={lbl}>{locale === 'ar' ? 'رقم الهوية / الإقامة' : 'National ID / Iqama'}</label>
              <input style={inp} value={patientId} onChange={(e) => setPatientId(e.target.value)} />
            </div>
          </div>
          {/* Prescriber */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={lbl}>{locale === 'ar' ? 'اسم الطبيب *' : 'Prescriber Name *'}</label>
              <input style={inp} value={prescriberName} onChange={(e) => setPrescriberName(e.target.value)} required />
            </div>
            <div>
              <label style={lbl}>{locale === 'ar' ? 'رقم الترخيص' : 'License No.'}</label>
              <input style={inp} value={prescriberLicense} onChange={(e) => setPrescriberLicense(e.target.value)} />
            </div>
          </div>
          {/* Medicines */}
          <div>
            <label style={lbl}>{locale === 'ar' ? 'الأدوية *' : 'Medicines *'}</label>
            <div style={{ position: 'relative' }}>
              <input
                style={inp} value={medSearch}
                onChange={(e) => setMedSearch(e.target.value)}
                placeholder={locale === 'ar' ? 'ابحث عن دواء لإضافته...' : 'Search medicine to add...'}
              />
              {medResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'hsl(222 40% 14%)', border: '1px solid hsl(217 33% 20%)', zIndex: 10, borderRadius: '3px', maxHeight: '180px', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'hsl(217 33% 25%) transparent' } as React.CSSProperties}>
                  {medResults.map((m) => (
                    <div key={m.id} onClick={() => addMedicine(m)}
                      style={{ padding: '8px 10px', cursor: 'pointer', fontSize: '12px', color: 'hsl(210 40% 98%)', borderBottom: '1px solid hsl(217 33% 20%)' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'hsl(217 33% 17%)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ''; }}
                    >
                      <span style={{ fontWeight: 600 }}>{locale === 'ar' ? m.name_ar : m.name_en}</span>
                      <span style={{ color: 'hsl(215 20% 65%)', marginInlineStart: '8px' }}>{locale === 'ar' ? m.name_en : m.name_ar}</span>
                      {m.requires_prescription && <span style={{ marginInlineStart: '8px', fontSize: '10px', color: 'hsl(0 84% 65%)' }}>Rx</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {items.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {items.map((item, i) => (
                  <div key={item.medicine_id} style={{ background: 'hsl(222 40% 14%)', border: '1px solid hsl(217 33% 20%)', borderRadius: '3px', padding: '8px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(210 40% 98%)' }}>{item.medicine_name}</span>
                      <button type="button" onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(0 84% 65%)', fontSize: '12px' }}>✕</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px' }}>
                      <div>
                        <label style={{ ...lbl, fontSize: '10px' }}>{locale === 'ar' ? 'الكمية' : 'Qty'}</label>
                        <input type="number" min={1} value={item.quantity} style={inp}
                          onChange={(e) => setItems((prev) => prev.map((x, j) => j === i ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) } : x))} />
                      </div>
                      <div>
                        <label style={{ ...lbl, fontSize: '10px' }}>{locale === 'ar' ? 'تعليمات الجرعة' : 'Dosage instructions'}</label>
                        <input value={item.dosage} style={inp} placeholder={locale === 'ar' ? 'مثال: حبة مرتين يومياً لمدة 7 أيام' : 'e.g. 1 tab twice daily for 7 days'}
                          onChange={(e) => setItems((prev) => prev.map((x, j) => j === i ? { ...x, dosage: e.target.value } : x))} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Notes */}
          <div>
            <label style={lbl}>{locale === 'ar' ? 'ملاحظات' : 'Notes'}</label>
            <textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button type="button" onClick={onClose}
              style={{ padding: '8px 16px', background: 'none', border: '1px solid hsl(217 33% 22%)', color: 'hsl(215 20% 65%)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', borderRadius: '3px' }}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" disabled={submitting}
              style={{ padding: '8px 20px', background: 'hsl(201 96% 40%)', color: '#fff', border: 'none', cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, opacity: submitting ? 0.7 : 1, borderRadius: '3px' }}>
              {submitting ? (locale === 'ar' ? 'جارٍ الحفظ...' : 'Saving...') : (locale === 'ar' ? 'حفظ الوصفة' : 'Save Prescription')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PrescriptionsPage() {
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { toast } = useToast();

  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [dispensing, setDispensing] = useState<string | null>(null);

  const pending = prescriptions.filter((r) => r.status === 'PENDING').length;

  const fetchRx = useCallback(() => {
    const params = new URLSearchParams({ page: '1', page_size: '50' });
    if (statusFilter) params.set('status', statusFilter);
    api.get<PaginatedResponse<Prescription>>(`/prescriptions?${params}`)
      .then((r) => { setPrescriptions(r.items); setTotal(r.total); })
      .catch(() => null);
  }, [statusFilter]);

  useEffect(() => { fetchRx(); }, [fetchRx]);

  async function handleDispense(rx: Prescription) {
    setDispensing(rx.id);
    try {
      const result = await api.post<{ invoice_number: string; total_amount: string }>(`/prescriptions/${rx.id}/dispense`, { payment_method: 'cash' });
      toast({
        title: locale === 'ar' ? 'تم صرف الوصفة' : 'Prescription dispensed',
        description: `${result.invoice_number} — ${result.total_amount} SAR`,
      });
      fetchRx();
    } catch (err) {
      toast({
        title: locale === 'ar' ? 'فشل الصرف' : 'Dispense failed',
        description: err instanceof Error ? err.message : '',
        variant: 'destructive',
      });
    } finally {
      setDispensing(null);
    }
  }

  async function handleCancel(rx: Prescription) {
    if (!confirm(locale === 'ar' ? `إلغاء الوصفة ${rx.rx_number}؟` : `Cancel prescription ${rx.rx_number}?`)) return;
    try {
      await api.post(`/prescriptions/${rx.id}/cancel`, {});
      toast({ title: locale === 'ar' ? 'تم إلغاء الوصفة' : 'Prescription cancelled' });
      fetchRx();
    } catch (err) {
      toast({ title: locale === 'ar' ? 'فشل الإلغاء' : 'Cancel failed', variant: 'destructive' });
    }
  }

  const newRxAction = (
    <div style={{ display: 'flex', gap: '8px' }}>
      <button onClick={fetchRx}
        style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', background: 'none', border: '1px solid hsl(217 33% 22%)', color: 'hsl(215 20% 65%)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', borderRadius: '3px' }}>
        <RefreshCw style={{ width: '12px', height: '12px' }} />
        {locale === 'ar' ? 'تحديث' : 'Refresh'}
      </button>
      <button onClick={() => setShowNewModal(true)}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: 'hsl(201 96% 40%)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: '3px' }}>
        <PlusCircle style={{ width: '13px', height: '13px' }} />
        {locale === 'ar' ? 'وصفة جديدة' : 'New Prescription'}
      </button>
    </div>
  );

  return (
    <PosPageWrapper
      title={locale === 'ar' ? `الوصفات الطبية (${pending} قيد الانتظار)` : `Prescription Queue (${pending} pending)`}
      action={newRxAction}
    >
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        {[
          { value: '',          label_ar: 'الكل',           label_en: 'All' },
          { value: 'PENDING',   label_ar: 'قيد الانتظار',   label_en: 'Pending' },
          { value: 'DISPENSED', label_ar: 'تم الصرف',        label_en: 'Dispensed' },
          { value: 'CANCELLED', label_ar: 'ملغية',           label_en: 'Cancelled' },
        ].map((f) => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)}
            style={{
              padding: '5px 14px', fontSize: '12px', fontWeight: statusFilter === f.value ? 600 : 400,
              background: statusFilter === f.value ? 'hsl(201 96% 40%)' : 'hsl(222 40% 14%)',
              color: statusFilter === f.value ? '#fff' : 'hsl(215 20% 65%)',
              border: '1px solid hsl(217 33% 20%)', cursor: 'pointer', fontFamily: 'inherit', borderRadius: '3px',
            }}>
            {locale === 'ar' ? f.label_ar : f.label_en}
          </button>
        ))}
      </div>

      {prescriptions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'hsl(215 20% 65%)', fontSize: '13px' }}>
          {locale === 'ar' ? 'لا توجد وصفات' : 'No prescriptions'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{locale === 'ar' ? 'رقم الوصفة' : 'Rx #'}</TableHead>
                <TableHead className="text-xs">{locale === 'ar' ? 'الأدوية' : 'Medicines'}</TableHead>
                <TableHead className="text-xs">{locale === 'ar' ? 'المريض' : 'Patient'}</TableHead>
                <TableHead className="text-xs">{locale === 'ar' ? 'الطبيب' : 'Prescriber'}</TableHead>
                <TableHead className="text-xs">{locale === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                <TableHead className="text-xs">{locale === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                <TableHead className="text-xs">{locale === 'ar' ? 'إجراء' : 'Action'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prescriptions.map((rx) => {
                const st = STATUS_STYLE[rx.status] ?? STATUS_STYLE['PENDING'];
                const isDispensing = dispensing === rx.id;
                return (
                  <TableRow key={rx.id}>
                    <TableCell className="text-xs font-mono align-top pt-3">{rx.rx_number}</TableCell>
                    <TableCell className="align-top pt-2">
                      {rx.items.map((item) => (
                        <div key={item.id} style={{ marginBottom: '4px' }}>
                          <div className="text-sm font-medium">{locale === 'ar' ? item.medicine_name_ar : item.medicine_name_en}</div>
                          <div className="text-xs text-muted-foreground">
                            {locale === 'ar' ? item.medicine_name_en : item.medicine_name_ar}
                            {' · '}{item.quantity} {locale === 'ar' ? 'وحدة' : 'units'}
                            {item.dosage_instructions && ` · ${item.dosage_instructions}`}
                          </div>
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="align-top pt-3">
                      <div className="text-sm">{rx.patient_name}</div>
                      {rx.patient_id_number && <div className="text-xs text-muted-foreground">{rx.patient_id_number}</div>}
                    </TableCell>
                    <TableCell className="align-top pt-3">
                      <div className="text-sm">{rx.prescriber_name}</div>
                      {rx.prescriber_license && <div className="text-xs text-muted-foreground">{rx.prescriber_license}</div>}
                    </TableCell>
                    <TableCell className="text-xs align-top pt-3">
                      {rx.created_at.slice(0, 10)}
                      {rx.status === 'DISPENSED' && rx.dispensed_at && (
                        <div className="text-muted-foreground">{locale === 'ar' ? 'صُرفت:' : 'Dispensed:'} {rx.dispensed_at.slice(0, 10)}</div>
                      )}
                    </TableCell>
                    <TableCell className="align-top pt-3">
                      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: 600, background: st.bg, color: st.color }}>
                        {locale === 'ar' ? st.ar : st.en}
                      </span>
                      {rx.status === 'DISPENSED' && rx.dispensed_by_name && (
                        <div className="text-xs text-muted-foreground mt-1">{rx.dispensed_by_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="align-top pt-2">
                      {rx.status === 'PENDING' ? (
                        <div style={{ display: 'flex', gap: '6px', flexDirection: 'column' }}>
                          <button onClick={() => handleDispense(rx)} disabled={isDispensing}
                            style={{ padding: '4px 12px', fontSize: '11px', fontWeight: 600, background: 'rgba(22,163,74,.15)', color: 'hsl(142 71% 55%)', border: '1px solid rgba(22,163,74,.3)', borderRadius: '3px', cursor: isDispensing ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: isDispensing ? 0.7 : 1 }}>
                            {isDispensing ? (locale === 'ar' ? 'جارٍ...' : 'Processing...') : (locale === 'ar' ? 'صرف' : 'Dispense')}
                          </button>
                          <button onClick={() => handleCancel(rx)}
                            style={{ padding: '4px 12px', fontSize: '11px', background: 'none', color: 'hsl(215 16% 47%)', border: '1px solid hsl(217 33% 20%)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit' }}>
                            {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                          </button>
                        </div>
                      ) : rx.status === 'DISPENSED' ? (
                        <button onClick={() => router.push(`/pharmacist/sales/${rx.sale_id}` as `/${string}`)}
                          style={{ padding: '4px 10px', fontSize: '11px', background: 'none', color: 'hsl(201 96% 40%)', border: '1px solid hsl(201 96% 40%)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit' }}>
                          {locale === 'ar' ? 'الفاتورة' : 'Invoice'}
                        </button>
                      ) : (
                        <span style={{ fontSize: '11px', color: 'hsl(215 16% 47%)' }}>—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {showNewModal && (
        <NewRxModal
          locale={locale}
          onClose={() => setShowNewModal(false)}
          onCreated={() => { setShowNewModal(false); fetchRx(); }}
        />
      )}
    </PosPageWrapper>
  );
}
