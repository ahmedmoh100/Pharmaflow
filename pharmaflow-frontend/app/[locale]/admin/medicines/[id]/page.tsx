'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { MedicineForm } from '@/components/medicines/MedicineForm';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { formatCurrency, formatDate } from '@/app/lib/utils';
import { api, type ApiMedicine } from '@/app/lib/api';
import { Thermometer, AlertTriangle, Save } from 'lucide-react';

interface ApiBatch {
  id: string; batch_number: string; qty_received: number; qty_remaining: number;
  unit_cost: string; expiry_date: string; supplier_name_en: string; supplier_name_ar: string;
}
interface ApiMovement {
  id: string; movement_type: string; qty_delta: number; reference_type: string; created_at: string;
}

export default function EditMedicinePage() {
  const params = useParams();
  const id = params.id as string;
  const locale = useLocale() as 'ar' | 'en';
  const t = useTranslations('medicines');
  const tCommon = useTranslations('common');

  const [medicine, setMedicine] = useState<ApiMedicine | null>(null);
  const [batches, setBatches] = useState<ApiBatch[]>([]);
  const [movements, setMovements] = useState<ApiMovement[]>([]);

  useEffect(() => {
    api.get<ApiMedicine>(`/medicines/${id}`).then(setMedicine).catch(() => null);
    api.get<{ items: ApiBatch[] }>(`/purchases?page=1&page_size=50`).then((r) => {
      setBatches(r.items.filter((b: ApiBatch & { medicine_id?: string }) => (b as unknown as { medicine_id: string }).medicine_id === id));
    }).catch(() => null);
    api.get<{ items: ApiMovement[] }>(`/medicines/${id}/movements`).then((r) => setMovements(r.items)).catch(() => null);
  }, [id]);

  if (!medicine) return <div className="p-8 text-muted-foreground">{tCommon('loading') || 'Loading...'}</div>;

  const sellingPrice = parseFloat(medicine.selling_price);
  const maxPrice = parseFloat(medicine.max_public_price);
  const lastBatch = batches.length > 0 ? batches[0] : null;
  const lastCost = lastBatch ? parseFloat(lastBatch.unit_cost) : 0;
  const marginPct = sellingPrice > 0 && lastCost > 0
    ? Math.round(((sellingPrice - lastCost) / sellingPrice) * 1000) / 10
    : null;

  const medicineForForm = {
    ...medicine,
    selling_price: sellingPrice,
    max_public_price: maxPrice,
    stock_quantity: medicine.stock_quantity,
    low_stock_threshold: medicine.low_stock_threshold,
  };

  return (
    <PageWrapper
      title={t('editMedicine')}
      actions={[{ label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} /> }]}
      breadcrumb={[
        { label: locale === 'ar' ? 'المخزون' : 'Inventory' },
        { label: locale === 'ar' ? 'الأدوية' : 'Medicines' },
        { label: locale === 'ar' ? 'تعديل' : 'Edit' },
      ]}
    >
      <div className="space-y-6">
        {medicine.requires_cold_chain && (
          <div className="flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 dark:bg-sky-950 dark:border-sky-700 px-4 py-3 text-sm text-sky-700 dark:text-sky-300">
            <Thermometer className="h-4 w-4 shrink-0" />
            <span className="font-medium">{locale === 'ar' ? 'هذا الدواء يتطلب تبريد بين 2–8°C' : 'This medicine requires cold chain storage: 2–8°C'}</span>
          </div>
        )}
        {maxPrice > 0 && sellingPrice > maxPrice && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="font-medium">
              {locale === 'ar'
                ? `تنبيه: سعر البيع (${medicine.selling_price} ر.س) يتجاوز السعر الأقصى (${medicine.max_public_price} ر.س)`
                : `SFDA Price Violation: Selling price (${medicine.selling_price} SAR) exceeds max (${medicine.max_public_price} SAR)`}
            </span>
          </div>
        )}

        <MedicineForm initial={medicineForForm as never} />

        {lastCost > 0 && (
          <D365Panel title={locale === 'ar' ? 'ملخص التسعير' : 'Pricing Summary'}>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: locale === 'ar' ? 'سعر البيع' : 'Selling Price', value: formatCurrency(sellingPrice, locale) },
                { label: locale === 'ar' ? 'آخر تكلفة شراء' : 'Last Purchase Cost', value: formatCurrency(lastCost, locale) },
                { label: locale === 'ar' ? 'هامش الربح' : 'Gross Margin', value: marginPct !== null ? `${marginPct}%` : '-', green: marginPct !== null && marginPct >= 0 },
              ].map((k) => (
                <div key={k.label} className="space-y-1 rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className={`text-xl font-bold ${k.green !== undefined ? (k.green ? 'text-green-500' : 'text-destructive') : ''}`}>{k.value}</p>
                </div>
              ))}
            </div>
          </D365Panel>
        )}

        <D365Panel title={t('purchaseBatches')} noPadding>
          {batches.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{tCommon('noData')}</p>
          ) : (
            <D365Table
              headers={[t('batchNumber'), t('quantity'), locale === 'ar' ? 'المتبقي' : 'Remaining', t('unitCost'), t('expiryDate'), locale === 'ar' ? 'المورد' : 'Supplier']}
              rows={batches.map((b) => [
                <span key={b.id} className="font-mono text-xs">{b.batch_number}</span>,
                b.qty_received,
                b.qty_remaining,
                formatCurrency(parseFloat(b.unit_cost), locale),
                <div key={b.id} className="flex items-center gap-2">
                  <span>{formatDate(b.expiry_date, locale)}</span>
                  <ExpiryBadge expiryDate={b.expiry_date} />
                </div>,
                locale === 'ar' ? b.supplier_name_ar : b.supplier_name_en,
              ])}
            />
          )}
        </D365Panel>

        <D365Panel title={locale === 'ar' ? 'سجل حركة المخزون' : 'Stock Movement History'} noPadding>
          {movements.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{tCommon('noData')}</p>
          ) : (
            <D365Table
              headers={[locale === 'ar' ? 'النوع' : 'Type', locale === 'ar' ? 'الكمية' : 'Qty', locale === 'ar' ? 'المرجع' : 'Ref', locale === 'ar' ? 'التاريخ' : 'Date']}
              rows={movements.slice(0, 20).map((mv) => {
                const isIn = mv.qty_delta > 0;
                return [
                  <span key={mv.id} className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${isIn ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>
                    {mv.movement_type}
                  </span>,
                  <span key="q" className={isIn ? 'text-green-500' : 'text-destructive'}>{isIn ? '+' : ''}{mv.qty_delta}</span>,
                  <span key="r" className="text-xs text-muted-foreground">{mv.reference_type}</span>,
                  <span key="d" className="text-xs">{mv.created_at.slice(0, 10)}</span>,
                ];
              })}
            />
          )}
        </D365Panel>
      </div>
    </PageWrapper>
  );
}
