'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { EmptyState } from '@/components/shared/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { api, type PaginatedResponse } from '@/app/lib/api';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/app/lib/utils';
import { Plus, ArrowLeftRight } from 'lucide-react';

interface ApiBranch { id: string; name_en: string; name_ar: string; }
interface ApiMedicine { id: string; name_en: string; name_ar: string; stock_quantity: number; }
interface ApiTransfer {
  id: string;
  qty: number;
  status: string;
  notes: string;
  created_at: string;
  medicine_name_en: string;
  medicine_name_ar: string;
  from_branch_en: string;
  from_branch_ar: string;
  to_branch_en: string;
  to_branch_ar: string;
  created_by_name: string;
}

const emptyForm = {
  from_branch_id: '',
  to_branch_id: '',
  medicine_id: '',
  qty: '',
  notes: '',
};

export default function AdminTransfersPage() {
  const locale = useLocale() as 'ar' | 'en';
  const { toast } = useToast();

  const [transfers, setTransfers] = useState<ApiTransfer[]>([]);
  const [branches, setBranches] = useState<ApiBranch[]>([]);
  const [medicines, setMedicines] = useState<ApiMedicine[]>([]);
  const [medLoading, setMedLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // New transfer dialog
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Selected medicine stock info
  const [selectedMedStock, setSelectedMedStock] = useState<number | null>(null);

  useEffect(() => {
    api.get<PaginatedResponse<ApiBranch>>('/branches?page_size=50&is_active=all')
      .then((r) => setBranches(r.items)).catch(() => null);
  }, []);

  const loadTransfers = useCallback(() => {
    setLoading(true);
    api.get<{ items: ApiTransfer[]; total: number }>('/transfers/')
      .then((r) => setTransfers(r.items))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadTransfers(); }, [loadTransfers, refreshKey]);

  // Update stock hint when medicine or source branch changes
  useEffect(() => {
    if (!form.medicine_id || !form.from_branch_id) { setSelectedMedStock(null); return; }
    const medId = form.medicine_id;
    const branchId = form.from_branch_id;
    // Use the list endpoint with branch_id so the subquery returns branch-specific stock
    api.get<PaginatedResponse<ApiMedicine>>(`/medicines?page=1&page_size=1&is_active=all&branch_id=${branchId}`)
      .then((r) => {
        const med = r.items.find((m) => m.id === medId);
        if (med) { setSelectedMedStock(med.stock_quantity); return; }
        // medicine not on first page — fetch full list filtered by branch
        return api.get<PaginatedResponse<ApiMedicine>>(`/medicines?page=1&page_size=100&is_active=all&branch_id=${branchId}`)
          .then((r2) => {
            const m2 = r2.items.find((m) => m.id === medId);
            setSelectedMedStock(m2 ? m2.stock_quantity : 0);
          });
      })
      .catch(() => {
        const med = medicines.find((m) => m.id === medId);
        setSelectedMedStock(med ? med.stock_quantity : null);
      });
  }, [form.medicine_id, form.from_branch_id]);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.from_branch_id) e.from_branch_id = locale === 'ar' ? 'مطلوب' : 'Required';
    if (!form.to_branch_id)   e.to_branch_id   = locale === 'ar' ? 'مطلوب' : 'Required';
    if (form.from_branch_id && form.from_branch_id === form.to_branch_id)
      e.to_branch_id = locale === 'ar' ? 'يجب أن يختلف الفرع' : 'Must differ from source';
    if (!form.medicine_id)    e.medicine_id    = locale === 'ar' ? 'مطلوب' : 'Required';
    const qty = parseInt(form.qty);
    if (!form.qty || isNaN(qty) || qty <= 0)
      e.qty = locale === 'ar' ? 'يجب أن يكون أكبر من صفر' : 'Must be > 0';
    if (selectedMedStock !== null && qty > selectedMedStock)
      e.qty = locale === 'ar' ? `المخزون المتاح: ${selectedMedStock}` : `Available stock: ${selectedMedStock}`;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleCreate() {
    if (!validate() || saving) return;
    setSaving(true);
    try {
      await api.post('/transfers/', {
        from_branch_id: form.from_branch_id,
        to_branch_id:   form.to_branch_id,
        medicine_id:    form.medicine_id,
        qty:            parseInt(form.qty),
        notes:          form.notes.trim(),
      });
      toast({ title: locale === 'ar' ? 'تم نقل المخزون' : 'Stock transferred successfully' });
      setNewOpen(false);
      setForm({ ...emptyForm });
      setErrors({});
      setSelectedMedStock(null);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      toast({
        title: locale === 'ar' ? 'خطأ' : 'Error',
        description: msg || (locale === 'ar' ? 'فشل النقل' : 'Transfer failed'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  function branchName(b: ApiBranch) { return locale === 'ar' ? b.name_ar : b.name_en; }

  return (
    <PageWrapper
      title={locale === 'ar' ? 'تحويلات المخزون' : 'Stock Transfers'}
      actions={[{
        label: locale === 'ar' ? 'تحويل جديد' : 'New Transfer',
        icon: <Plus style={{ width: '13px', height: '13px' }} />,
        onClick: () => {
          setForm({ ...emptyForm });
          setErrors({});
          setSelectedMedStock(null);
          setNewOpen(true);
          // Load medicines when dialog opens — ensures session token is ready
          if (medicines.length === 0) {
            setMedLoading(true);
            api.get<PaginatedResponse<ApiMedicine>>('/medicines?page=1&page_size=100')
              .then((r) => setMedicines(r.items))
              .catch(() => null)
              .finally(() => setMedLoading(false));
          }
        },
      }]}
      breadcrumb={[
        { label: locale === 'ar' ? 'العمليات' : 'Operations' },
        { label: locale === 'ar' ? 'تحويلات المخزون' : 'Stock Transfers' },
      ]}
    >
      <D365Panel
        title={`${locale === 'ar' ? 'سجل التحويلات' : 'Transfer History'} (${transfers.length})`}
        noPadding
      >
        {loading ? (
          <div className="p-4"><EmptyState title={locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...'} /></div>
        ) : transfers.length === 0 ? (
          <div className="p-4"><EmptyState title={locale === 'ar' ? 'لا توجد تحويلات بعد' : 'No transfers yet'} /></div>
        ) : (
          <D365Table
            headers={[
              locale === 'ar' ? 'الدواء' : 'Medicine',
              locale === 'ar' ? 'من' : 'From',
              locale === 'ar' ? 'إلى' : 'To',
              locale === 'ar' ? 'الكمية' : 'Qty',
              locale === 'ar' ? 'بواسطة' : 'By',
              locale === 'ar' ? 'التاريخ' : 'Date',
              locale === 'ar' ? 'الحالة' : 'Status',
            ]}
            rows={transfers.map((t) => [
              <span key={t.id} className="font-medium">
                {locale === 'ar' ? t.medicine_name_ar : t.medicine_name_en}
              </span>,
              <span key={t.id + 'f'} className="text-sm">
                {locale === 'ar' ? t.from_branch_ar : t.from_branch_en}
              </span>,
              <span key={t.id + 't'} className="text-sm flex items-center gap-1">
                <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                {locale === 'ar' ? t.to_branch_ar : t.to_branch_en}
              </span>,
              <span key={t.id + 'q'} className="font-mono font-bold">{t.qty}</span>,
              t.created_by_name,
              <span key={t.id + 'd'} className="text-xs text-muted-foreground">
                {formatDateTime(t.created_at, locale)}
              </span>,
              <Badge key={t.id + 's'} variant="default">
                {t.status === 'COMPLETED'
                  ? (locale === 'ar' ? 'مكتمل' : 'Completed')
                  : (locale === 'ar' ? 'ملغي' : 'Cancelled')}
              </Badge>,
            ])}
          />
        )}
      </D365Panel>

      {/* New Transfer Dialog */}
      <Dialog open={newOpen} onOpenChange={(open) => { if (!open) { setNewOpen(false); setErrors({}); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'تحويل مخزون جديد' : 'New Stock Transfer'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* From branch */}
            <div className="space-y-1">
              <Label>{locale === 'ar' ? 'من الفرع *' : 'From Branch *'}</Label>
              <Select value={form.from_branch_id} onValueChange={(v) => setForm({ ...form, from_branch_id: v })}>
                <SelectTrigger><SelectValue placeholder={locale === 'ar' ? 'اختر الفرع المصدر' : 'Select source branch'} /></SelectTrigger>
                <SelectContent position="popper">
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{branchName(b)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.from_branch_id && <p className="text-xs text-destructive">{errors.from_branch_id}</p>}
            </div>

            {/* To branch */}
            <div className="space-y-1">
              <Label>{locale === 'ar' ? 'إلى الفرع *' : 'To Branch *'}</Label>
              <Select value={form.to_branch_id} onValueChange={(v) => setForm({ ...form, to_branch_id: v })}>
                <SelectTrigger><SelectValue placeholder={locale === 'ar' ? 'اختر الفرع الوجهة' : 'Select destination branch'} /></SelectTrigger>
                <SelectContent position="popper">
                  {branches.filter((b) => b.id !== form.from_branch_id).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{branchName(b)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.to_branch_id && <p className="text-xs text-destructive">{errors.to_branch_id}</p>}
            </div>

            {/* Medicine — native select for reliability inside Dialog */}
            <div className="space-y-1">
              <Label>{locale === 'ar' ? 'الدواء *' : 'Medicine *'}</Label>
              <select
                value={form.medicine_id}
                onChange={(e) => setForm({ ...form, medicine_id: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{ colorScheme: 'dark' }}
              >
                <option value="">
                  {medLoading
                    ? (locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...')
                    : (locale === 'ar' ? 'اختر الدواء' : 'Select medicine')}
                </option>
                {medicines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {locale === 'ar' ? m.name_ar : m.name_en}
                  </option>
                ))}
              </select>
              {errors.medicine_id && <p className="text-xs text-destructive">{errors.medicine_id}</p>}
              {selectedMedStock !== null && (
                <p className="text-xs text-muted-foreground">
                  {locale === 'ar' ? `المخزون في الفرع المصدر: ${selectedMedStock}` : `Stock at source: ${selectedMedStock}`}
                </p>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-1">
              <Label>{locale === 'ar' ? 'الكمية *' : 'Quantity *'}</Label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={form.qty}
                onChange={(e) => { if (/^\d*$/.test(e.target.value)) setForm({ ...form, qty: e.target.value }); }}
                placeholder="e.g. 50"
              />
              {errors.qty && <p className="text-xs text-destructive">{errors.qty}</p>}
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <Label>{locale === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder={locale === 'ar' ? 'سبب التحويل (اختياري)' : 'Reason for transfer (optional)'}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewOpen(false); setErrors({}); }}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving
                ? (locale === 'ar' ? 'جارٍ التحويل...' : 'Transferring...')
                : (locale === 'ar' ? 'تأكيد التحويل' : 'Confirm Transfer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
