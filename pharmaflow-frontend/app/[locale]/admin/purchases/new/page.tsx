'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { D365Panel } from '@/components/shared/D365Panel';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/app/lib/api';
import { useSession } from '@/app/lib/auth';
import { Save } from 'lucide-react';
import type { PaginatedResponse, ApiMedicine } from '@/app/lib/api';

interface ApiSupplier {
  id: string;
  name_en: string;
  name_ar: string;
}

export default function NewPurchasePage() {
  const t = useTranslations('purchases');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useSession();

  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [medicines, setMedicines] = useState<ApiMedicine[]>([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    supplier_id: '',
    medicine_id: '',
    batch_number: '',
    quantity: 0,
    unit_cost: 0,
    manufacturing_date: '',
    expiry_date: '',
    notes: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load dropdowns from real API on mount
  useEffect(() => {
    void (async () => {
      try {
        const [suppRes, medRes] = await Promise.all([
          api.get<PaginatedResponse<ApiSupplier>>('/suppliers?page=1&page_size=100'),
          api.get<PaginatedResponse<ApiMedicine>>('/medicines?page=1&page_size=100'),
        ]);
        setSuppliers(suppRes.items);
        setMedicines(medRes.items);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        toast({
          title: locale === 'ar' ? 'تعذّر تحميل البيانات' : 'Failed to load data',
          description: msg || undefined,
          variant: 'destructive',
        });
      }
    })();
  }, []);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.supplier_id) e.supplier_id = tCommon('required');
    if (!form.medicine_id) e.medicine_id = tCommon('required');
    if (!form.batch_number.trim()) e.batch_number = tCommon('required');
    if (form.quantity <= 0) e.quantity = tCommon('required');
    if (form.unit_cost <= 0) e.unit_cost = tCommon('required');
    if (!form.expiry_date) e.expiry_date = tCommon('required');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    void (async () => {
      setLoading(true);
      try {
        const payload = {
          supplier_id: form.supplier_id,
          medicine_id: form.medicine_id,
          branch_id: user?.branch_id ?? '',
          batch_number: form.batch_number,
          quantity: form.quantity,
          unit_cost: String(form.unit_cost),
          manufacturing_date: form.manufacturing_date || null,
          expiry_date: form.expiry_date,
          notes: form.notes,
        };
        await api.post('/purchases', payload);
        toast({ title: t('savedSuccessfully') });
        router.replace('/admin/purchases');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        toast({
          title: locale === 'ar' ? 'حدث خطأ' : 'Error saving purchase',
          description: msg || undefined,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    })();
  }

  return (
    <PageWrapper
      title={t('newPurchase')}
      actions={[
        { label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} /> },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'المشتريات' : 'Purchases' },
        { label: locale === 'ar' ? 'جديد' : 'New' },
      ]}
    >
      <D365Panel title={t('newPurchase')}>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Supplier + Medicine */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="supplier_id">{t('supplier')} *</Label>
              <Select value={form.supplier_id} onValueChange={(v) => setForm({ ...form, supplier_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t('supplier')} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {locale === 'ar' ? s.name_ar : s.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.supplier_id && <p className="text-sm text-destructive">{errors.supplier_id}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="medicine_id">{t('medicine')} *</Label>
              <Select value={form.medicine_id} onValueChange={(v) => setForm({ ...form, medicine_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t('medicine')} />
                </SelectTrigger>
                <SelectContent>
                  {medicines.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {locale === 'ar' ? m.name_ar : m.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.medicine_id && <p className="text-sm text-destructive">{errors.medicine_id}</p>}
            </div>
          </div>

          {/* Batch + Quantity */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="batch_number">{t('batchNumber')} *</Label>
              <Input
                id="batch_number"
                value={form.batch_number}
                onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
              />
              {errors.batch_number && <p className="text-sm text-destructive">{errors.batch_number}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">{t('quantity')} *</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={form.quantity || ''}
                onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 0 })}
              />
              {errors.quantity && <p className="text-sm text-destructive">{errors.quantity}</p>}
            </div>
          </div>

          {/* Unit cost + Manufacturing date + Expiry date */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="unit_cost">{t('unitCost')} *</Label>
              <Input
                id="unit_cost"
                type="number"
                step="0.001"
                min="0"
                value={form.unit_cost || ''}
                onChange={(e) => setForm({ ...form, unit_cost: parseFloat(e.target.value) || 0 })}
              />
              {errors.unit_cost && <p className="text-sm text-destructive">{errors.unit_cost}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="manufacturing_date">{t('manufacturingDate')}</Label>
              <Input
                id="manufacturing_date"
                type="date"
                value={form.manufacturing_date}
                onChange={(e) => setForm({ ...form, manufacturing_date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiry_date">{t('expiryDate')} *</Label>
              <Input
                id="expiry_date"
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              />
              {errors.expiry_date && <p className="text-sm text-destructive">{errors.expiry_date}</p>}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">{t('notes')}</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.replace('/admin/purchases')}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={loading} className="gap-2">
              {loading
                ? tCommon('loading')
                : (<><Save className="h-4 w-4" />{tCommon('save')}</>)
              }
            </Button>
          </div>
        </form>
      </D365Panel>
    </PageWrapper>
  );
}
