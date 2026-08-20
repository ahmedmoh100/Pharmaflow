'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Save } from 'lucide-react';
import { D365Panel } from '@/components/shared/D365Panel';

export default function SettingsPage() {
  const locale = useLocale() as 'ar' | 'en';
  const { toast } = useToast();

  const [general, setGeneral] = useState({
    name_ar: 'فارما فلو',
    name_en: 'PharmaFlow',
    vat_number: '311111111111113',
    cr_number: '4030123456',
    invoice_prefix: 'INV',
  });

  const [inventory, setInventory] = useState({
    default_low_stock_threshold: '30',
    expiry_warning_days_1: '30',
    expiry_warning_days_2: '60',
    expiry_warning_days_3: '90',
  });

  function handleSave() {
    toast({
      title: locale === 'ar' ? 'تم حفظ الإعدادات' : 'Settings saved',
    });
  }

  return (
    <PageWrapper
      title={locale === 'ar' ? 'إعدادات النظام' : 'System Settings'}
      tabs={[
        { key: 'general', label: locale === 'ar' ? 'عام' : 'General' },
      ]}
      defaultTab="general"
      actions={[
        { label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} />, onClick: handleSave },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الإعدادات' : 'Settings' },
      ]}
    >
      <div className="space-y-6 max-w-2xl">
        {/* General Panel */}
        <D365Panel title={locale === 'ar' ? 'معلومات الصيدلية' : 'Pharmacy Information'}>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{locale === 'ar' ? 'الاسم بالعربية' : 'Arabic Name'}</Label>
                  <Input value={general.name_ar} onChange={(e) => setGeneral({ ...general, name_ar: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{locale === 'ar' ? 'الاسم بالإنجليزية' : 'English Name'}</Label>
                  <Input value={general.name_en} onChange={(e) => setGeneral({ ...general, name_en: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{locale === 'ar' ? 'الرقم الضريبي (15 رقم)' : 'VAT Registration Number'}</Label>
                  <Input value={general.vat_number} onChange={(e) => setGeneral({ ...general, vat_number: e.target.value })} className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>{locale === 'ar' ? 'رقم السجل التجاري' : 'Commercial Registration'}</Label>
                  <Input value={general.cr_number} onChange={(e) => setGeneral({ ...general, cr_number: e.target.value })} className="font-mono" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'بادئة رقم الفاتورة' : 'Invoice Number Prefix'}</Label>
                <Input value={general.invoice_prefix} onChange={(e) => setGeneral({ ...general, invoice_prefix: e.target.value })} className="w-32 font-mono" />
              </div>
            </div>
        </D365Panel>

        {/* Inventory Panel */}
        <D365Panel title={locale === 'ar' ? 'إعدادات المخزون' : 'Inventory Settings'}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'حد المخزون المنخفض الافتراضي (وحدات)' : 'Default Low Stock Threshold (units)'}</Label>
                <Input type="number" value={inventory.default_low_stock_threshold} onChange={(e) => setInventory({ ...inventory, default_low_stock_threshold: e.target.value })} className="w-32" />
              </div>
              <Separator />
              <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'حدود تحذيرات انتهاء الصلاحية (أيام)' : 'Expiry warning thresholds (days)'}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { key: 'expiry_warning_days_1', label: locale === 'ar' ? 'حرج' : 'Critical' },
                  { key: 'expiry_warning_days_2', label: locale === 'ar' ? 'تحذير' : 'Warning' },
                  { key: 'expiry_warning_days_3', label: locale === 'ar' ? 'تنبيه' : 'Notice' },
                ].map(({ key, label }) => (
                  <div key={key} className="space-y-2">
                    <Label>{label}</Label>
                    <Input
                      type="number"
                      value={inventory[key as keyof typeof inventory]}
                      onChange={(e) => setInventory({ ...inventory, [key]: e.target.value })}
                      className="w-24"
                    />
                  </div>
                ))}
              </div>
            </div>
        </D365Panel>

        <div className="flex justify-end">
          <Button onClick={handleSave} className="gap-2">
            <Save className="h-4 w-4" />
            {locale === 'ar' ? 'حفظ الإعدادات' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </PageWrapper>
  );
}
