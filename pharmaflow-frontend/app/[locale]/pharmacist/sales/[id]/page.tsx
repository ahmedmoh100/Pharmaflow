import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { InvoiceView } from '@/components/sales/InvoiceView';

export default async function PharmacistSaleDetailPage({ params }: { params: { locale: string; id: string } }) {
  const { locale, id } = params;
  setRequestLocale(locale);
  const t = await getTranslations('sales');
  const l = locale as 'ar' | 'en';

  return (
    <PosPageWrapper title={l === 'ar' ? 'تفاصيل الفاتورة' : 'Invoice Detail'}>
      <InvoiceView saleId={id} />
    </PosPageWrapper>
  );
}
