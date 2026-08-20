'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { SupplierForm } from '@/components/suppliers/SupplierForm';
import { formatCurrency, formatDate } from '@/app/lib/utils';
import { api } from '@/app/lib/api';
import type { Supplier } from '@/app/lib/types';
import { Save } from 'lucide-react';

export default function SupplierDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const locale = useLocale() as 'ar' | 'en';
  const tCommon = useTranslations('common');

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [batches, setBatches] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    api.get<Supplier>(`/suppliers/${id}`).then(setSupplier).catch(() => null);
    api.get<{ items: Record<string, unknown>[] }>(`/purchases?supplier_id=${id}&page=1&page_size=50`)
      .then((r) => setBatches(r.items)).catch(() => null);
  }, [id]);

  if (!supplier) return <div className="p-8 text-muted-foreground">Loading...</div>;

  return (
    <PageWrapper
      title={locale === 'ar' ? supplier.name_ar : supplier.name_en}
      actions={[{ label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} /> }]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الموردون' : 'Suppliers' },
        { label: locale === 'ar' ? supplier.name_ar : supplier.name_en },
      ]}
    >
      <div className="space-y-6">
        <SupplierForm initial={supplier} />

        <D365Panel title={locale === 'ar' ? 'الدفعات المستلمة' : 'Received Batches'} noPadding>
          {batches.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{tCommon('noData')}</p>
          ) : (
            <D365Table
              headers={[
                locale === 'ar' ? 'الدواء' : 'Medicine',
                locale === 'ar' ? 'رقم الدفعة' : 'Batch #',
                locale === 'ar' ? 'الكمية' : 'Qty',
                locale === 'ar' ? 'التكلفة' : 'Cost',
                locale === 'ar' ? 'الانتهاء' : 'Expiry',
              ]}
              rows={batches.map((b) => [
                <span key={String(b.id)} className="font-medium">
                  {locale === 'ar' ? String(b.medicine_name_ar) : String(b.medicine_name_en)}
                </span>,
                <span key="bn" className="font-mono text-xs">{String(b.batch_number)}</span>,
                Number(b.qty_received),
                formatCurrency(parseFloat(String(b.unit_cost)), locale),
                <div key="exp" className="flex items-center gap-2">
                  <span>{formatDate(String(b.expiry_date), locale)}</span>
                  <ExpiryBadge expiryDate={String(b.expiry_date)} />
                </div>,
              ])}
            />
          )}
        </D365Panel>
      </div>
    </PageWrapper>
  );
}
