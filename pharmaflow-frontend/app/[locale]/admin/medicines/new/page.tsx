'use client';

import { useTranslations, useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { MedicineForm } from '@/components/medicines/MedicineForm';
import { Save } from 'lucide-react';

export default function NewMedicinePage() {
  const t = useTranslations('medicines');
  const locale = useLocale() as 'ar' | 'en';
  return (
    <PageWrapper
      title={t('newMedicine')}
      actions={[
        { label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} /> },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'المخزون' : 'Inventory' },
        { label: locale === 'ar' ? 'الأدوية' : 'Medicines' },
        { label: locale === 'ar' ? 'جديد' : 'New' },
      ]}
    >
      <MedicineForm />
    </PageWrapper>
  );
}
