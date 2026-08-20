'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { BranchForm } from '@/components/branches/BranchForm';
import { api } from '@/app/lib/api';
import { Save } from 'lucide-react';

interface ApiBranch {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  city_en: string;
  city_ar: string;
  vat_number: string;
  address: string;
  is_active: boolean;
}

export default function EditBranchPage() {
  const params = useParams();
  const id = params.id as string;
  const locale = useLocale() as 'ar' | 'en';
  const [branch, setBranch] = useState<ApiBranch | null>(null);

  useEffect(() => {
    api.get<ApiBranch>(`/branches/${id}`).then(setBranch).catch(() => null);
  }, [id]);

  if (!branch) return <div className="p-8 text-muted-foreground">Loading...</div>;

  return (
    <PageWrapper
      title={locale === 'ar' ? branch.name_ar : branch.name_en}
      actions={[
        { label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} /> },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الفروع' : 'Branches' },
        { label: locale === 'ar' ? branch.name_ar : branch.name_en },
      ]}
    >
      <BranchForm initial={branch} />
    </PageWrapper>
  );
}
