'use client';

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { Supplier } from '@/app/lib/types';
import { api } from '@/app/lib/api';
import { Save } from 'lucide-react';

interface SupplierFormProps {
  initial?: Supplier;
}

export function SupplierForm({ initial }: SupplierFormProps) {
  const t = useTranslations('suppliers');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const SUPPLIER_TYPES = [
    { value: 'distributor', en: 'Distributor', ar: 'موزع' },
    { value: 'manufacturer', en: 'Manufacturer', ar: 'مصنّع' },
    { value: 'wholesaler', en: 'Wholesaler', ar: 'تاجر جملة' },
  ];

  const [form, setForm] = useState({
    name_en: initial?.name_en ?? '',
    name_ar: initial?.name_ar ?? '',
    tax_number: initial?.tax_number ?? '',
    supplier_type: initial?.supplier_type ?? 'distributor',
    contact_person: initial?.contact_person ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
    is_active: initial?.is_active ?? true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name_en.trim()) e.name_en = tCommon('required');
    if (!form.name_ar.trim()) e.name_ar = tCommon('required');
    if (!/^3\d{13}3$/.test(form.tax_number)) e.tax_number = t('taxNumberError');
    if (!form.contact_person.trim()) e.contact_person = tCommon('required');
    if (!form.phone.trim()) e.phone = tCommon('required');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    void (async () => {
      try {
        if (initial?.id) {
          await api.put(`/suppliers/${initial.id}`, form);
        } else {
          await api.post('/suppliers', form);
        }
        toast({ title: t('savedSuccessfully') });
        router.replace('/admin/suppliers');
      } catch {
        toast({ title: 'Error saving supplier', variant: 'destructive' });
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
              <Input id="name_ar" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
              {errors.name_ar && <p className="text-sm text-destructive">{errors.name_ar}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="name_en">{t('nameEn')} *</Label>
              <Input id="name_en" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
              {errors.name_en && <p className="text-sm text-destructive">{errors.name_en}</p>}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tax_number">{t('taxNumber')} *</Label>
              <Input id="tax_number" value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} placeholder="300000000000003" />
              {errors.tax_number && <p className="text-sm text-destructive">{errors.tax_number}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier_type">{t('supplierType')} *</Label>
              <Select value={form.supplier_type} onValueChange={(v) => setForm({ ...form, supplier_type: v as any })}>
                <SelectTrigger id="supplier_type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUPPLIER_TYPES.map((st) => (
                    <SelectItem key={st.value} value={st.value}>
                      {locale === 'ar' ? st.ar : st.en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact_person">{t('contactPerson')} *</Label>
              <Input id="contact_person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              {errors.contact_person && <p className="text-sm text-destructive">{errors.contact_person}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t('phone')} *</Label>
              <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">{t('address')}</Label>
            <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>

          <div className="flex items-center gap-3">
            <Switch id="is_active" checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            <Label htmlFor="is_active">{t('isActive')}</Label>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.replace('/admin/suppliers')}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending ? tCommon('loading') : (<><Save className="h-4 w-4" />{tCommon('save')}</>)}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
