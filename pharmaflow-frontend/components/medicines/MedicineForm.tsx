'use client';

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { CATEGORIES, FORMS, UNITS } from '@/app/lib/mock-data';
import type { Medicine } from '@/app/lib/types';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/app/lib/api';
import { Save } from 'lucide-react';

interface MedicineFormProps {
  initial?: Medicine;
}

export function MedicineForm({ initial }: MedicineFormProps) {
  const t = useTranslations('medicines');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState({
    name_en: initial?.name_en ?? '',
    name_ar: initial?.name_ar ?? '',
    generic_name: initial?.generic_name ?? '',
    barcode: initial?.barcode ?? '',
    category: initial?.category ?? '',
    form: initial?.form ?? '',
    strength: initial?.strength ?? '',
    unit: initial?.unit ?? '',
    selling_price: initial?.selling_price ?? 0,
    low_stock_threshold: initial?.low_stock_threshold ?? 10,
    requires_prescription: initial?.requires_prescription ?? false,
    is_active: initial?.is_active ?? true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name_en.trim()) e.name_en = tCommon('required');
    if (!form.name_ar.trim()) e.name_ar = tCommon('required');
    if (!form.category) e.category = tCommon('required');
    if (!form.form) e.form = tCommon('required');
    if (!form.unit) e.unit = tCommon('required');
    if (form.selling_price <= 0) e.selling_price = tCommon('required');
    if (form.low_stock_threshold < 0) e.low_stock_threshold = tCommon('required');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    void (async () => {
      try {
        const payload = {
          ...form,
          selling_price: String(form.selling_price),
          max_public_price: String((initial as Medicine & { max_public_price?: number })?.max_public_price ?? '0'),
          vat_category: (initial as Medicine & { vat_category?: string })?.vat_category ?? 'zero_rated',
          requires_cold_chain: (initial as Medicine & { requires_cold_chain?: boolean })?.requires_cold_chain ?? false,
          sfda_registration_no: (initial as Medicine & { sfda_registration_no?: string })?.sfda_registration_no ?? '',
          generic_name: form.generic_name ?? '',
        };
        if (initial?.id) {
          await api.put(`/medicines/${initial.id}`, payload);
        } else {
          await api.post('/medicines', payload);
        }
        toast({ title: t('savedSuccessfully') });
        router.replace('/admin/medicines');
      } catch {
        toast({ title: locale === 'ar' ? 'حدث خطأ' : 'Error saving', variant: 'destructive' });
      }
    })();
  }

  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name_ar">{t('nameAr')} *</Label>
              <Input
                id="name_ar"
                value={form.name_ar}
                onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
              />
              {errors.name_ar && <p className="text-sm text-destructive">{errors.name_ar}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="name_en">{t('nameEn')} *</Label>
              <Input
                id="name_en"
                value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
              />
              {errors.name_en && <p className="text-sm text-destructive">{errors.name_en}</p>}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="generic_name">{t('genericName')}</Label>
              <Input
                id="generic_name"
                value={form.generic_name}
                onChange={(e) => setForm({ ...form, generic_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="barcode">{t('barcode')}</Label>
              <Input
                id="barcode"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="category">{t('category')} *</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t('category')} />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {locale === 'ar' ? c.name_ar : c.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && <p className="text-sm text-destructive">{errors.category}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="form">{t('form')} *</Label>
              <Select value={form.form} onValueChange={(v) => setForm({ ...form, form: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t('form')} />
                </SelectTrigger>
                <SelectContent>
                  {FORMS.map((f) => (
                    <SelectItem key={f.code} value={f.code}>
                      {locale === 'ar' ? f.name_ar : f.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">{t('unit')} *</Label>
              <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t('unit')} />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u.code} value={u.code}>
                      {locale === 'ar' ? u.name_ar : u.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.unit && <p className="text-sm text-destructive">{errors.unit}</p>}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="strength">{t('strength')}</Label>
              <Input
                id="strength"
                value={form.strength}
                onChange={(e) => setForm({ ...form, strength: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="selling_price">{t('sellingPrice')} *</Label>
              <Input
                id="selling_price"
                type="number"
                step="0.01"
                min="0"
                value={form.selling_price}
                onChange={(e) => setForm({ ...form, selling_price: parseFloat(e.target.value) || 0 })}
              />
              {errors.selling_price && <p className="text-sm text-destructive">{errors.selling_price}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="low_stock_threshold">{t('lowStockThreshold')} *</Label>
              <Input
                id="low_stock_threshold"
                type="number"
                min="0"
                value={form.low_stock_threshold}
                onChange={(e) => setForm({ ...form, low_stock_threshold: parseInt(e.target.value) || 0 })}
              />
              {errors.low_stock_threshold && <p className="text-sm text-destructive">{errors.low_stock_threshold}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Switch
                id="requires_prescription"
                checked={form.requires_prescription}
                onCheckedChange={(v) => setForm({ ...form, requires_prescription: v })}
              />
              <Label htmlFor="requires_prescription">{t('requiresPrescription')}</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="is_active"
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              <Label htmlFor="is_active">{t('isActive')}</Label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.replace('/admin/medicines')}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending ? (
                tCommon('loading')
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {tCommon('save')}
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
