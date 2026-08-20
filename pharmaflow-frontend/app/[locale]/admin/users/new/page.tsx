'use client';

import { useTranslations, useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { UserForm } from '@/components/users/UserForm';
import { Save } from 'lucide-react';

export default function NewUserPage() {
  const t = useTranslations('users');
  const locale = useLocale() as 'ar' | 'en';
  return (
    <PageWrapper
      title={t('newUser')}
      actions={[
        { label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} /> },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الإدارة' : 'Administration' },
        { label: locale === 'ar' ? 'المستخدمون' : 'Users' },
        { label: locale === 'ar' ? 'جديد' : 'New' },
      ]}
    >
      <UserForm />
    </PageWrapper>
  );
}
