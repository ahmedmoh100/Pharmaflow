'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { Badge } from '@/components/ui/badge';
import { CATEGORIES } from '@/app/lib/mock-data';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { api } from '@/app/lib/api';

const MED_CATS = new Set(['analgesics','antibiotics','cardiology','gastrology','diabetes','respiratory','allergy','vitamin','dermatology','ophthalmic']);

export default function CategoriesPage() {
  const l = useLocale() as 'ar' | 'en';
  const [countMap, setCountMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    api.get<{ by_category: { category: string; medicine_count: number }[] }>('/reports/inventory')
      .then((data) => {
        const m = new Map<string, number>();
        for (const c of data.by_category) m.set(c.category, c.medicine_count);
        setCountMap(m);
      }).catch(() => null);
  }, []);

  return (
    <PageWrapper
      title={l === 'ar' ? 'الفئات' : 'Categories'}
      breadcrumb={[{ label: l === 'ar' ? 'الفئات' : 'Categories' }]}
    >
      <D365Panel title={l === 'ar' ? 'فئات المنتجات' : 'Product Categories'} noPadding>
        <D365Table
          headers={[
            l === 'ar' ? 'الكود' : 'Code',
            l === 'ar' ? 'الاسم بالعربية' : 'Arabic Name',
            l === 'ar' ? 'الاسم بالإنجليزية' : 'English Name',
            l === 'ar' ? 'النوع' : 'Type',
            l === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT',
            l === 'ar' ? 'عدد المنتجات' : 'Products',
          ]}
          rows={CATEGORIES.map((cat) => {
            const isMedicine = MED_CATS.has(cat.code);
            return [
              <span key={cat.code} className="font-mono text-xs">{cat.code}</span>,
              cat.name_ar,
              cat.name_en,
              <Badge key="type" variant={isMedicine ? 'default' : 'secondary'}>
                {isMedicine ? (l === 'ar' ? 'دواء' : 'Medicine') : (l === 'ar' ? 'منتج' : 'Product')}
              </Badge>,
              <Badge key="vat" variant={isMedicine ? 'outline' : 'secondary'}>
                {isMedicine ? (l === 'ar' ? 'معفى (0%)' : 'Zero-rated (0%)') : (l === 'ar' ? 'خاضع (15%)' : 'Standard (15%)')}
              </Badge>,
              countMap.get(cat.code) ?? 0,
            ];
          })}
        />
      </D365Panel>
    </PageWrapper>
  );
}
