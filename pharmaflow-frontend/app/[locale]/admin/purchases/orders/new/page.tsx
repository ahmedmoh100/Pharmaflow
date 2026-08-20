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
import { Save, Plus, Trash2 } from 'lucide-react';
import type { PaginatedResponse } from '@/app/lib/api';

interface ApiSupplier {
  id: string;
  name_en: string;
  name_ar: string;
}

interface ApiMedicine {
  id: string;
  name_en: string;
  name_ar: string;
}

interface POItem {
  medicine_id: string;
  ordered_qty: number;
  agreed_unit_cost: number;
}

export default function NewPOPage() {
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
    branch_id: user?.branch_id || '',
    expected_date: '',
    notes: '',
  });

  const [items, setItems] = useState<POItem[]>([
    { medicine_id: '', ordered_qty: 1, agreed_unit_cost: 0 }
  ]);

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

  // Update form branch_id when user loads
  useEffect(() => {
    if (user?.branch_id) {
      setForm(prev => ({ ...prev, branch_id: user.branch_id }));
    }
  }, [user]);

  function addItem() {
    setItems([...items, { medicine_id: '', ordered_qty: 1, agreed_unit_cost: 0 }]);
  }

  function removeItem(index: number) {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  }

  function updateItem(index: number, field: keyof POItem, value: string | number) {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.supplier_id) e.supplier_id = tCommon('required');
    if (!form.branch_id) e.branch_id = tCommon('required');
    
    items.forEach((item, index) => {
      if (!item.medicine_id) e[`item_${index}_medicine`] = tCommon('required');
      if (item.ordered_qty <= 0) e[`item_${index}_qty`] = tCommon('required');
      if (item.agreed_unit_cost <= 0) e[`item_${index}_cost`] = tCommon('required');
    });

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
          branch_id: form.branch_id,
          expected_date: form.expected_date || null,
          notes: form.notes,
          items: items.filter(item => item.medicine_id && item.ordered_qty > 0 && item.agreed_unit_cost > 0),
        };

        if (payload.items.length === 0) {
          toast({
            title: locale === 'ar' ? 'خطأ' : 'Error',
            description: locale === 'ar' ? 'يجب إضافة عنصر واحد على الأقل' : 'At least one item required',
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }

        await api.post('/purchase-orders/', payload);
        toast({ title: locale === 'ar' ? 'تم إنشاء أمر الشراء' : 'Purchase Order created' });
        router.replace('/admin/purchases');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        toast({
          title: locale === 'ar' ? 'حدث خطأ' : 'Error creating PO',
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
      title={locale === 'ar' ? 'أمر شراء جديد' : 'New Purchase Order'}
      breadcrumb={[
        { label: locale === 'ar' ? 'المشتريات' : 'Purchases' },
        { label: locale === 'ar' ? 'أوامر الشراء' : 'Purchase Orders' },
        { label: locale === 'ar' ? 'جديد' : 'New' },
      ]}
    >
      <D365Panel title={locale === 'ar' ? 'أمر شراء جديد' : 'New Purchase Order'}>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Supplier + Branch */}
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
              <Label htmlFor="branch_id">{locale === 'ar' ? 'الفرع' : 'Branch'} *</Label>
              <Input
                id="branch_id"
                value={form.branch_id}
                disabled
                className="bg-muted"
              />
            </div>
          </div>

          {/* Expected Date + Notes */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="expected_date">{locale === 'ar' ? 'التاريخ المتوقع' : 'Expected Date'}</Label>
              <Input
                id="expected_date"
                type="date"
                value={form.expected_date}
                onChange={(e) => setForm({ ...form, expected_date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">{t('notes')}</Label>
              <Input
                id="notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          {/* Items Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{locale === 'ar' ? 'البنود' : 'Items'}</h3>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="h-4 w-4 mr-2" />
                {locale === 'ar' ? 'إضافة بند' : 'Add Item'}
              </Button>
            </div>

            {items.map((item, index) => (
              <div key={index} className="grid gap-4 md:grid-cols-4 p-4 border rounded-lg relative">
                {items.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-6 w-6"
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}

                <div className="space-y-2">
                  <Label>{t('medicine')} *</Label>
                  <Select
                    value={item.medicine_id}
                    onValueChange={(v) => updateItem(index, 'medicine_id', v)}
                  >
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
                  {errors[`item_${index}_medicine`] && (
                    <p className="text-sm text-destructive">{errors[`item_${index}_medicine`]}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{locale === 'ar' ? 'الكمية' : 'Quantity'} *</Label>
                  <Input
                    type="number"
                    min="1"
                    value={item.ordered_qty || ''}
                    onChange={(e) => updateItem(index, 'ordered_qty', parseInt(e.target.value) || 0)}
                  />
                  {errors[`item_${index}_qty`] && (
                    <p className="text-sm text-destructive">{errors[`item_${index}_qty`]}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t('unitCost')} *</Label>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    value={item.agreed_unit_cost || ''}
                    onChange={(e) => updateItem(index, 'agreed_unit_cost', parseFloat(e.target.value) || 0)}
                  />
                  {errors[`item_${index}_cost`] && (
                    <p className="text-sm text-destructive">{errors[`item_${index}_cost`]}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{locale === 'ar' ? 'الإجمالي' : 'Total'}</Label>
                  <Input
                    type="text"
                    value={(item.ordered_qty * item.agreed_unit_cost).toFixed(3)}
                    disabled
                    className="bg-muted"
                  />
                </div>
              </div>
            ))}
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
