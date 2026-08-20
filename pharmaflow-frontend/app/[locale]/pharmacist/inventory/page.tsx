'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StockBadge } from '@/components/shared/StockBadge';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CATEGORIES, FORMS, lookupName } from '@/app/lib/mock-data';
import { api, type ApiMedicine, type PaginatedResponse } from '@/app/lib/api';
import { useSession } from '@/app/lib/auth';
import { formatCurrency } from '@/app/lib/utils';
import { Eye } from 'lucide-react';

export default function PharmacistInventoryPage() {
  const t = useTranslations('medicines');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { user } = useSession();

  const [medicines, setMedicines] = useState<ApiMedicine[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [formFilter, setFormFilter] = useState('all');
  const PAGE_SIZE = 20;

  const fetchMedicines = useCallback(() => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
      is_active: 'true',
    });
    if (search) params.set('search', search);
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (user?.branch_id) params.set('branch_id', user.branch_id);
    api.get<PaginatedResponse<ApiMedicine>>(`/medicines?${params}`)
      .then((res) => { setMedicines(res.items); setTotal(res.total); })
      .catch(() => null);
  }, [page, search, categoryFilter, user?.branch_id]);

  useEffect(() => { fetchMedicines(); }, [fetchMedicines]);

  // Client-side form filter (not supported server-side)
  const filtered = formFilter === 'all'
    ? medicines
    : medicines.filter((m) => m.form === formFilter);

  const columns: Column<ApiMedicine>[] = [
    { key: 'nameAr', header: t('nameAr'), render: (m) => <span className="font-medium">{m.name_ar}</span> },
    { key: 'nameEn', header: t('nameEn'), render: (m) => m.name_en },
    { key: 'category', header: t('category'), render: (m) => lookupName(CATEGORIES, m.category, locale) },
    { key: 'form', header: t('form'), render: (m) => lookupName(FORMS, m.form, locale) },
    { key: 'stock', header: t('stockQuantity'), render: (m) => <StockBadge quantity={m.stock_quantity} threshold={m.low_stock_threshold} /> },
    { key: 'price', header: t('sellingPrice'), render: (m) => formatCurrency(parseFloat(m.selling_price), locale) },
    {
      key: 'prescription', header: t('prescription'),
      render: (m) => m.requires_prescription
        ? <Badge variant="destructive">{tCommon('yes')}</Badge>
        : <Badge variant="secondary">{tCommon('no')}</Badge>,
    },
    {
      key: 'actions', header: tCommon('actions'),
      render: (m) => (
        <button
          onClick={() => router.push(`/pharmacist/inventory/${m.id}` as `/${string}`)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--primary))', display: 'flex', padding: '4px' }}
        >
          <Eye style={{ width: '15px', height: '15px' }} />
        </button>
      ),
    },
  ];

  return (
    <PosPageWrapper title={locale === 'ar' ? 'بحث الأدوية' : 'Find Medicine'}>
      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder={t('searchPlaceholder')}
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        rowKey={(m) => m.id}
        emptyTitle={tCommon('noData')}
        filters={
          <>
            <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('category')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {locale === 'ar' ? c.name_ar : c.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={formFilter} onValueChange={setFormFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder={t('form')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                {FORMS.map((f) => (
                  <SelectItem key={f.code} value={f.code}>
                    {locale === 'ar' ? f.name_ar : f.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
    </PosPageWrapper>
  );
}
