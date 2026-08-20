'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { StockBadge } from '@/components/shared/StockBadge';
import { api, type ApiMedicine } from '@/app/lib/api';
import { CATEGORIES, FORMS, UNITS, lookupName } from '@/app/lib/mock-data';
import { formatCurrency, formatDate } from '@/app/lib/utils';
import { Thermometer } from 'lucide-react';

interface ApiBatch {
  id: string; batch_number: string; qty_received: number; qty_remaining: number;
  unit_cost: string; expiry_date: string; status: string;
  supplier_name_en: string; supplier_name_ar: string; medicine_id: string;
}
interface ApiMovement {
  id: string; movement_type: string; qty_delta: number;
  reference_type: string; created_at: string; user_name: string;
}

const S = {
  surface: 'hsl(222 47% 10%)', border: 'hsl(217 33% 20%)',
  fg: 'hsl(210 40% 98%)', muted: 'hsl(215 20% 65%)',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '4px', marginBottom: '16px', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${S.border}` }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: S.fg }}>{title}</span>
      </div>
      <div style={{ padding: '16px' }}>{children}</div>
    </div>
  );
}

export default function PharmacistInventoryDetailPage() {
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
    api.get<{ items: ApiBatch[] }>('/purchases?page=1&page_size=50')
      .then((r) => setBatches(r.items.filter((b) => b.medicine_id === id)))
      .catch(() => null);
    api.get<{ items: ApiMovement[] }>(`/medicines/${id}/movements`)
      .then((r) => setMovements(r.items))
      .catch(() => null);
  }, [id]);

  if (!medicine) return <div className="p-8 text-muted-foreground">Loading...</div>;

  const sellingPrice = parseFloat(medicine.selling_price);
  const maxPrice = parseFloat(medicine.max_public_price);

  const infoRows: Array<[string, React.ReactNode]> = [
    [t('nameAr'), medicine.name_ar],
    [t('nameEn'), medicine.name_en],
    [t('genericName'), medicine.generic_name || '-'],
    [t('barcode'), medicine.barcode || '-'],
    [t('category'), lookupName(CATEGORIES, medicine.category, locale)],
    [t('form'), lookupName(FORMS, medicine.form, locale)],
    [t('strength'), medicine.strength || '-'],
    [t('unit'), lookupName(UNITS, medicine.unit, locale)],
    [t('sellingPrice'), formatCurrency(sellingPrice, locale)],
    [t('stockQuantity'), <StockBadge key="s" quantity={medicine.stock_quantity} threshold={medicine.low_stock_threshold} />],
    [t('lowStockThreshold'), String(medicine.low_stock_threshold)],
    [t('requiresPrescription'), medicine.requires_prescription
      ? <Badge key="rx" variant="destructive">{tCommon('yes')}</Badge>
      : <Badge key="rx" variant="secondary">{tCommon('no')}</Badge>],
    [locale === 'ar' ? 'رقم تسجيل هيئة الغذاء والدواء' : 'SFDA Reg. No.', medicine.sfda_registration_no || '-'],
    [locale === 'ar' ? 'الحد الأقصى للسعر' : 'Max Public Price',
      <span key="mp" style={{ color: sellingPrice > maxPrice && maxPrice > 0 ? 'hsl(0 84% 60%)' : 'inherit' }}>
        {formatCurrency(maxPrice, locale)}
        {sellingPrice > maxPrice && maxPrice > 0 && (locale === 'ar' ? ' — تجاوز السعر' : ' — Exceeded')}
      </span>],
    [locale === 'ar' ? 'سلسلة التبريد' : 'Cold Chain', medicine.requires_cold_chain
      ? <Badge key="cc" className="gap-1 bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300"><Thermometer className="h-3 w-3" />{locale === 'ar' ? '2–8°C مطلوب' : '2–8°C Required'}</Badge>
      : <span key="cc" style={{ color: S.muted, fontSize: '12px' }}>{locale === 'ar' ? 'لا يتطلب تبريد' : 'No cold chain'}</span>],
  ];

  return (
    <PosPageWrapper title={`${medicine.name_ar} — ${medicine.name_en}`}>

      <Section title={locale === 'ar' ? 'تفاصيل الدواء' : 'Medicine Details'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {infoRows.map(([label, value]) => (
            <div key={String(label)}>
              <div style={{ fontSize: '11px', color: S.muted, marginBottom: '4px' }}>{label}</div>
              <div style={{ fontSize: '13px', color: S.fg }}>{value}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={locale === 'ar' ? 'دفعات الشراء' : 'Purchase Batches'}>
        {batches.length === 0
          ? <p style={{ fontSize: '13px', color: S.muted }}>{tCommon('noData')}</p>
          : <div style={{ overflowX: 'auto' }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{t('batchNumber')}</TableHead>
                    <TableHead className="text-xs">{locale === 'ar' ? 'المستلم' : 'Received'}</TableHead>
                    <TableHead className="text-xs">{locale === 'ar' ? 'المتبقي' : 'Remaining'}</TableHead>
                    <TableHead className="text-xs">{t('expiryDate')}</TableHead>
                    <TableHead className="text-xs">{locale === 'ar' ? 'المورد' : 'Supplier'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs font-mono">{b.batch_number}</TableCell>
                      <TableCell className="text-xs">{b.qty_received}</TableCell>
                      <TableCell className="text-xs">{b.qty_remaining}</TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="text-xs">{formatDate(b.expiry_date, locale)}</span>
                          <ExpiryBadge expiryDate={b.expiry_date} />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {locale === 'ar' ? b.supplier_name_ar : b.supplier_name_en}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
        }
      </Section>

      <Section title={locale === 'ar' ? 'سجل حركة المخزون' : 'Stock Movement History'}>
        {movements.length === 0
          ? <p style={{ fontSize: '13px', color: S.muted }}>{tCommon('noData')}</p>
          : <div style={{ overflowX: 'auto' }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{locale === 'ar' ? 'النوع' : 'Type'}</TableHead>
                    <TableHead className="text-xs">{locale === 'ar' ? 'الكمية' : 'Qty'}</TableHead>
                    <TableHead className="text-xs">{locale === 'ar' ? 'المرجع' : 'Reference'}</TableHead>
                    <TableHead className="text-xs">{locale === 'ar' ? 'بواسطة' : 'By'}</TableHead>
                    <TableHead className="text-xs">{locale === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.slice(0, 20).map((mv) => (
                    <TableRow key={mv.id}>
                      <TableCell>
                        <span style={{
                          display: 'inline-flex', padding: '2px 8px', borderRadius: '3px',
                          fontSize: '11px', fontWeight: 600,
                          background: mv.movement_type === 'IN' ? 'rgba(22,163,74,.2)' : 'rgba(220,38,38,.2)',
                          color: mv.movement_type === 'IN' ? 'hsl(142 71% 55%)' : 'hsl(0 84% 65%)',
                        }}>
                          {mv.movement_type === 'IN'
                            ? (locale === 'ar' ? 'وارد +' : 'IN +')
                            : (locale === 'ar' ? 'صادر −' : 'OUT −')}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-medium">{Math.abs(mv.qty_delta)}</TableCell>
                      <TableCell className="text-xs">{mv.reference_type || '-'}</TableCell>
                      <TableCell className="text-xs">{mv.user_name || '-'}</TableCell>
                      <TableCell className="text-xs">{formatDate(mv.created_at, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
        }
      </Section>

    </PosPageWrapper>
  );
}
