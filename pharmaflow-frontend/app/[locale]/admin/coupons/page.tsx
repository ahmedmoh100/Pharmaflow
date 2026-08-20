'use client';

import { useState, useEffect } from 'react';
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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { api } from '@/app/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Plus, Power } from 'lucide-react';

interface ApiCoupon {
  id: string;
  code: string;
  type: string;
  discount_type: string;
  discount_value: number;
  description_en: string;
  description_ar: string;
  valid_from: string | null;
  valid_until: string | null;
  max_uses: number | null;
  usage_count: number;
  is_active: boolean;
}

const emptyForm = {
  code: '',
  type: 'promotional',
  discount_type: 'percentage',
  discount_value: '',
  description_en: '',
  description_ar: '',
  valid_from: '',
  valid_until: '',
  max_uses: '',
};

export default function AdminCouponsPage() {
  const locale = useLocale() as 'ar' | 'en';
  const { toast } = useToast();

  const [coupons, setCoupons] = useState<ApiCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // New coupon dialog
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    api.get<ApiCoupon[]>('/coupons/')
      .then((data) => setCoupons(data))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.code.trim()) e.code = locale === 'ar' ? 'مطلوب' : 'Required';
    if (!form.discount_value || parseFloat(form.discount_value) <= 0)
      e.discount_value = locale === 'ar' ? 'يجب أن يكون أكبر من صفر' : 'Must be > 0';
    if (form.discount_type === 'percentage' && parseFloat(form.discount_value) > 100)
      e.discount_value = locale === 'ar' ? 'لا يمكن أن يتجاوز 100%' : 'Cannot exceed 100%';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleCreate() {
    if (!validate() || saving) return;
    setSaving(true);
    try {
      await api.post('/coupons/', {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        discount_type: form.discount_type,
        discount_value: parseFloat(form.discount_value),
        description_en: form.description_en.trim(),
        description_ar: form.description_ar.trim(),
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        max_uses: form.max_uses ? parseInt(form.max_uses) : null,
      });
      toast({ title: locale === 'ar' ? 'تم إنشاء الكوبون' : 'Coupon created' });
      setNewOpen(false);
      setForm({ ...emptyForm });
      setErrors({});
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      toast({
        title: locale === 'ar' ? 'خطأ' : 'Error',
        description: msg.includes('409') ? (locale === 'ar' ? 'الكود مستخدم بالفعل' : 'Code already exists') : msg,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(c: ApiCoupon) {
    try {
      await api.put(`/coupons/${c.id}`, { is_active: !c.is_active });
      toast({ title: c.is_active ? (locale === 'ar' ? 'تم تعطيل الكوبون' : 'Coupon deactivated') : (locale === 'ar' ? 'تم تفعيل الكوبون' : 'Coupon activated') });
      setRefreshKey((k) => k + 1);
    } catch {
      toast({ title: locale === 'ar' ? 'حدث خطأ' : 'Error', variant: 'destructive' });
    }
  }

  function discountLabel(c: ApiCoupon) {
    return c.discount_type === 'percentage'
      ? `${c.discount_value}%`
      : `${c.discount_value} ${locale === 'ar' ? 'ر.س' : 'SAR'}`;
  }

  function validityLabel(c: ApiCoupon) {
    if (!c.valid_from && !c.valid_until) return locale === 'ar' ? 'غير محدد' : 'No limit';
    if (c.valid_until) return `${locale === 'ar' ? 'حتى' : 'Until'} ${c.valid_until}`;
    return `${locale === 'ar' ? 'من' : 'From'} ${c.valid_from}`;
  }

  return (
    <PageWrapper
      title={locale === 'ar' ? 'الكوبونات' : 'Coupons'}
      actions={[
        {
          label: locale === 'ar' ? 'كوبون جديد' : 'New Coupon',
          icon: <Plus style={{ width: '13px', height: '13px' }} />,
          onClick: () => { setForm({ ...emptyForm }); setErrors({}); setNewOpen(true); },
        },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'العمليات' : 'Operations' },
        { label: locale === 'ar' ? 'الكوبونات' : 'Coupons' },
      ]}
    >
      <D365Panel title={`${locale === 'ar' ? 'الكوبونات' : 'Coupons'} (${coupons.length})`} noPadding>
        {loading ? (
          <div className="p-4"><EmptyState title={locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...'} /></div>
        ) : coupons.length === 0 ? (
          <div className="p-4"><EmptyState title={locale === 'ar' ? 'لا توجد كوبونات' : 'No coupons yet'} /></div>
        ) : (
          <D365Table
            headers={[
              locale === 'ar' ? 'الكود' : 'Code',
              locale === 'ar' ? 'النوع' : 'Type',
              locale === 'ar' ? 'الخصم' : 'Discount',
              locale === 'ar' ? 'الصلاحية' : 'Validity',
              locale === 'ar' ? 'الاستخدام' : 'Usage',
              locale === 'ar' ? 'الحالة' : 'Status',
              locale === 'ar' ? 'إجراء' : 'Action',
            ]}
            rows={coupons.map((c) => [
              <span key={c.id} className="font-mono font-bold text-sm">{c.code}</span>,
              <Badge key={c.id} variant={c.type === 'employee' ? 'default' : 'secondary'}>
                {c.type === 'employee' ? (locale === 'ar' ? 'موظف' : 'Employee') : (locale === 'ar' ? 'ترويجي' : 'Promo')}
              </Badge>,
              <span key={c.id} className="font-medium">{discountLabel(c)}</span>,
              <span key={c.id} className="text-xs text-muted-foreground">{validityLabel(c)}</span>,
              <span key={c.id} className="text-sm">
                {c.usage_count}{c.max_uses ? ` / ${c.max_uses}` : ''}
              </span>,
              c.is_active ? (
                <Badge key={c.id} variant="default">{locale === 'ar' ? 'نشط' : 'Active'}</Badge>
              ) : (
                <Badge key={c.id} variant="outline">{locale === 'ar' ? 'معطل' : 'Inactive'}</Badge>
              ),
              <ConfirmDialog
                key={c.id}
                trigger={
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Power className="h-4 w-4" />
                  </Button>
                }
                title={c.is_active ? (locale === 'ar' ? 'تعطيل الكوبون' : 'Deactivate Coupon') : (locale === 'ar' ? 'تفعيل الكوبون' : 'Activate Coupon')}
                description={c.is_active
                  ? (locale === 'ar' ? `سيتوقف الكوبون "${c.code}" عن العمل فوراً.` : `Coupon "${c.code}" will stop working immediately.`)
                  : (locale === 'ar' ? `سيصبح الكوبون "${c.code}" قابلاً للاستخدام.` : `Coupon "${c.code}" will become usable again.`)
                }
                onConfirm={() => handleToggle(c)}
              />,
            ])}
          />
        )}
      </D365Panel>

      {/* New Coupon Dialog */}
      <Dialog open={newOpen} onOpenChange={(open) => { if (!open) { setNewOpen(false); setErrors({}); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'كوبون جديد' : 'New Coupon'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Code */}
            <div className="space-y-1">
              <Label>{locale === 'ar' ? 'الكود *' : 'Code *'}</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="e.g. RAMADAN20"
                className="font-mono"
              />
              {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
            </div>

            {/* Type + Discount type */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{locale === 'ar' ? 'نوع الكوبون' : 'Coupon Type'}</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="promotional">{locale === 'ar' ? 'ترويجي' : 'Promotional'}</SelectItem>
                    <SelectItem value="employee">{locale === 'ar' ? 'موظف' : 'Employee'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{locale === 'ar' ? 'نوع الخصم' : 'Discount Type'}</Label>
                <Select value={form.discount_type} onValueChange={(v) => setForm({ ...form, discount_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">{locale === 'ar' ? 'نسبة مئوية %' : 'Percentage %'}</SelectItem>
                    <SelectItem value="fixed">{locale === 'ar' ? 'مبلغ ثابت SAR' : 'Fixed SAR'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Discount value */}
            <div className="space-y-1">
              <Label>{locale === 'ar' ? 'قيمة الخصم *' : 'Discount Value *'}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.discount_value}
                  onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  placeholder="e.g. 10"
                />
                <span className="text-muted-foreground text-sm shrink-0">
                  {form.discount_type === 'percentage' ? '%' : 'SAR'}
                </span>
              </div>
              {errors.discount_value && <p className="text-xs text-destructive">{errors.discount_value}</p>}
            </div>

            {/* Descriptions */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{locale === 'ar' ? 'وصف (English)' : 'Description (EN)'}</Label>
                <Input
                  value={form.description_en}
                  onChange={(e) => setForm({ ...form, description_en: e.target.value })}
                  placeholder="e.g. Ramadan 20% off"
                />
              </div>
              <div className="space-y-1">
                <Label>{locale === 'ar' ? 'وصف (العربية)' : 'Description (AR)'}</Label>
                <Input
                  value={form.description_ar}
                  onChange={(e) => setForm({ ...form, description_ar: e.target.value })}
                  placeholder="مثال: خصم رمضان 20%"
                  dir="rtl"
                />
              </div>
            </div>

            {/* Validity dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{locale === 'ar' ? 'صالح من' : 'Valid From'}</Label>
                <Input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{locale === 'ar' ? 'صالح حتى' : 'Valid Until'}</Label>
                <Input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
              </div>
            </div>

            {/* Max uses */}
            <div className="space-y-1">
              <Label>{locale === 'ar' ? 'الحد الأقصى للاستخدام (اتركه فارغاً = غير محدود)' : 'Max Uses (leave blank = unlimited)'}</Label>
              <Input
                type="number"
                min="1"
                value={form.max_uses}
                onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
                placeholder={locale === 'ar' ? 'غير محدود' : 'Unlimited'}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewOpen(false); setErrors({}); }}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? (locale === 'ar' ? 'جارٍ الحفظ...' : 'Saving...') : (locale === 'ar' ? 'إنشاء' : 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
