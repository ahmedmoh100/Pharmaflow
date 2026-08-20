'use client';

import { useTranslations, useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { SupplierForm } from '@/components/suppliers/SupplierForm';
import { Save } from 'lucide-react';

export default function NewSupplierPage() {
  const t = useTranslations('suppliers');
  const locale = useLocale() as 'ar' | 'en';
  return (
    <PageWrapper
      title={t('newSupplier')}
      actions={[
        { label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} /> },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الموردون' : 'Suppliers' },
        { label: locale === 'ar' ? 'جديد' : 'New' },
      ]}
    >
      <SupplierForm />
    </PageWrapper>
  );
}
