'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { D365Panel } from '@/components/shared/D365Panel';
import { formatCurrency, formatDate } from '@/app/lib/utils';
import { api } from '@/app/lib/api';

export default function PurchaseDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const locale = useLocale() as 'ar' | 'en';
  const t = useTranslations('purchases');

  const [batch, setBatch] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api.get<Record<string, unknown>>(`/purchases/${id}`).then(setBatch).catch(() => null);
  }, [id]);

  if (!batch) return <div className="p-8 text-muted-foreground">Loading...</div>;

  const unitCost = parseFloat(String(batch.unit_cost));
  const qtyReceived = Number(batch.qty_received);
  const totalCost = unitCost * qtyReceived;

  return (
    <PageWrapper
      title={locale === 'ar' ? 'تفاصيل الدفعة' : 'Batch Detail'}
      breadcrumb={[
        { label: locale === 'ar' ? 'المشتريات' : 'Purchases' },
        { label: String(batch.batch_number) },
      ]}
    >
      <div className="space-y-6">
        <D365Panel title={locale === 'ar' ? 'معلومات الدفعة' : 'Batch Information'}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: locale === 'ar' ? 'الدواء' : 'Medicine', value: locale === 'ar' ? String(batch.medicine_name_ar) : String(batch.medicine_name_en) },
              { label: locale === 'ar' ? 'المورد' : 'Supplier', value: locale === 'ar' ? String(batch.supplier_name_ar) : String(batch.supplier_name_en) },
              { label: t('batchNumber'), value: <span className="font-mono text-xs">{String(batch.batch_number)}</span> },
              { label: t('quantity'), value: qtyReceived },
              { label: locale === 'ar' ? 'المتبقي' : 'Remaining', value: Number(batch.qty_remaining) },
              { label: t('unitCost'), value: formatCurrency(unitCost, locale) },
              { label: locale === 'ar' ? 'إجمالي التكلفة' : 'Total Cost', value: formatCurrency(totalCost, locale) },
              { label: t('expiryDate'), value: <div className="flex items-center gap-2"><span>{formatDate(String(batch.expiry_date), locale)}</span><ExpiryBadge expiryDate={String(batch.expiry_date)} /></div> },
              { label: locale === 'ar' ? 'تاريخ الاستلام' : 'Received', value: String(batch.created_at).slice(0, 10) },
            ].map((f, i) => (
              <div key={i} className="space-y-1">
                <p className="text-xs text-muted-foreground">{f.label}</p>
                <div className="text-sm font-medium">{f.value}</div>
              </div>
            ))}
          </div>
        </D365Panel>
      </div>
    </PageWrapper>
  );
}
