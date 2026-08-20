'use client';

import { useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { BranchForm } from '@/components/branches/BranchForm';
import { Save } from 'lucide-react';

export default function NewBranchPage() {
  const locale = useLocale() as 'ar' | 'en';
  return (
    <PageWrapper
      title={locale === 'ar' ? 'فرع جديد' : 'New Branch'}
      actions={[
        { label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} /> },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الفروع' : 'Branches' },
        { label: locale === 'ar' ? 'جديد' : 'New' },
      ]}
    >
      <BranchForm />
    </PageWrapper>
  );
}
