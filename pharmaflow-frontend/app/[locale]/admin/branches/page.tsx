'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { Badge } from '@/components/ui/badge';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { api, type PaginatedResponse } from '@/app/lib/api';
import { Plus, Edit2, Download } from 'lucide-react';
import { downloadCSV } from '@/app/lib/csv';

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

export default function BranchesPage() {
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const [branches, setBranches] = useState<ApiBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<PaginatedResponse<ApiBranch>>('/branches?is_active=all&page_size=100')
      .then((res) => setBranches(res.items))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageWrapper
      title={locale === 'ar' ? 'الفروع' : 'Branches'}
      actions={[
        {
          label: locale === 'ar' ? 'جديد' : 'New',
          icon: <Plus style={{ width: '13px', height: '13px' }} />,
          onClick: () => router.push('/admin/branches/new'),
        },
        {
          label: locale === 'ar' ? 'تعديل' : 'Edit',
          icon: <Edit2 style={{ width: '13px', height: '13px' }} />,
          disabled: !selectedId,
          onClick: () => { if (selectedId) router.push(`/admin/branches/${selectedId}`); },
        },
        {
          label: locale === 'ar' ? 'تصدير' : 'Export',
          icon: <Download style={{ width: '13px', height: '13px' }} />,
          separator: true,
          onClick: () => {
            const headers = ['code', 'name_en', 'name_ar', 'city_en', 'city_ar', 'vat_number', 'address', 'is_active'];
            const rows = branches.map((b) => [
              b.code, b.name_en, b.name_ar,
              b.city_en, b.city_ar,
              b.vat_number ?? '', b.address ?? '',
              b.is_active ? '1' : '0',
            ]);
            downloadCSV(`branches_${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows]);
          },
        },
      ]}
      breadcrumb={[{ label: locale === 'ar' ? 'الفروع' : 'Branches' }]}
    >
      <D365Panel
        title={`${locale === 'ar' ? 'الفروع' : 'Branches'} (${branches.length})`}
        noPadding
      >
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">{locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</p>
        ) : (
          <D365Table
            headers={[
              locale === 'ar' ? 'الفرع' : 'Branch',
              locale === 'ar' ? 'الكود' : 'Code',
              locale === 'ar' ? 'المدينة' : 'City',
              locale === 'ar' ? 'الرقم الضريبي' : 'VAT Number',
              locale === 'ar' ? 'العنوان' : 'Address',
              locale === 'ar' ? 'الحالة' : 'Status',
            ]}
            rowKeys={branches.map((b) => b.id)}
            selectedKey={selectedId}
            onRowClick={(key) => setSelectedId((prev) => prev === key ? null : key)}
            rows={branches.map((b) => [
              <div key="n">
                <p className="font-medium">{locale === 'ar' ? b.name_ar : b.name_en}</p>
                <p className="text-xs text-muted-foreground">{locale === 'ar' ? b.name_en : b.name_ar}</p>
              </div>,
              <span key="code" className="font-mono text-xs">{b.code}</span>,
              locale === 'ar' ? b.city_ar : b.city_en,
              <span key="vat" className="font-mono text-xs">{b.vat_number || '—'}</span>,
              <span key="addr" className="text-xs text-muted-foreground">{b.address || '—'}</span>,
              b.is_active
                ? <Badge key="st" variant="default">{locale === 'ar' ? 'نشط' : 'Active'}</Badge>
                : <Badge key="st" variant="outline">{locale === 'ar' ? 'غير نشط' : 'Inactive'}</Badge>,
            ])}
          />
        )}
      </D365Panel>
    </PageWrapper>
  );
}
