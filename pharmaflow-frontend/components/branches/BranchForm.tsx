'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/app/lib/api';
import { Save } from 'lucide-react';

interface ApiBranch {
  id?: string;
  code?: string;
  name_en: string;
  name_ar: string;
  city_en: string;
  city_ar: string;
  vat_number?: string;
  address?: string;
  is_active?: boolean;
}

interface BranchFormProps {
  initial?: ApiBranch;
}

export function BranchForm({ initial }: BranchFormProps) {
  const locale = useLocale() as 'ar' | 'en';
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name_en: initial?.name_en ?? '',
    name_ar: initial?.name_ar ?? '',
    code: initial?.code ?? '',
    city_en: initial?.city_en ?? '',
    city_ar: initial?.city_ar ?? '',
    vat_number: initial?.vat_number ?? '',
    address: initial?.address ?? '',
    is_active: initial?.is_active ?? true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name_en.trim()) e.name_en = tCommon('required');
    if (!form.name_ar.trim()) e.name_ar = tCommon('required');
    if (!form.code.trim()) e.code = tCommon('required');
    if (!form.city_en.trim()) e.city_en = tCommon('required');
    if (!form.city_ar.trim()) e.city_ar = tCommon('required');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    void (async () => {
      setLoading(true);
      try {
        if (initial?.id) {
          await api.put(`/branches/${initial.id}`, form);
        } else {
          await api.post('/branches', form);
        }
        toast({ title: locale === 'ar' ? 'تم الحفظ بنجاح' : 'Saved successfully' });
        router.replace('/admin/branches');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        toast({
          title: locale === 'ar' ? 'حدث خطأ' : 'Error saving branch',
          description: msg || undefined,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    })();
  }

  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Names */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name_ar">{locale === 'ar' ? 'الاسم بالعربية' : 'Arabic Name'} *</Label>
              <Input id="name_ar" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
              {errors.name_ar && <p className="text-sm text-destructive">{errors.name_ar}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="name_en">{locale === 'ar' ? 'الاسم بالإنجليزية' : 'English Name'} *</Label>
              <Input id="name_en" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
              {errors.name_en && <p className="text-sm text-destructive">{errors.name_en}</p>}
            </div>
          </div>

          {/* Code + VAT */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="code">{locale === 'ar' ? 'كود الفرع' : 'Branch Code'} *</Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="MKK03"
                disabled={!!initial?.id}
              />
              {errors.code && <p className="text-sm text-destructive">{errors.code}</p>}
              {initial?.id && <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'الكود لا يمكن تغييره' : 'Code cannot be changed'}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="vat_number">{locale === 'ar' ? 'الرقم الضريبي' : 'VAT Number'}</Label>
              <Input id="vat_number" value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} />
            </div>
          </div>

          {/* Cities */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="city_ar">{locale === 'ar' ? 'المدينة بالعربية' : 'City (Arabic)'} *</Label>
              <Input id="city_ar" value={form.city_ar} onChange={(e) => setForm({ ...form, city_ar: e.target.value })} />
              {errors.city_ar && <p className="text-sm text-destructive">{errors.city_ar}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="city_en">{locale === 'ar' ? 'المدينة بالإنجليزية' : 'City (English)'} *</Label>
              <Input id="city_en" value={form.city_en} onChange={(e) => setForm({ ...form, city_en: e.target.value })} />
              {errors.city_en && <p className="text-sm text-destructive">{errors.city_en}</p>}
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="address">{locale === 'ar' ? 'العنوان' : 'Address'}</Label>
            <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-3">
            <Switch id="is_active" checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            <Label htmlFor="is_active">{locale === 'ar' ? 'فعّال' : 'Active'}</Label>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.replace('/admin/branches')}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={loading} className="gap-2">
              {loading ? tCommon('loading') : (<><Save className="h-4 w-4" />{tCommon('save')}</>)}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
