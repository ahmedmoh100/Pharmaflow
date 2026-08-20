import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { InvoiceView } from '@/components/sales/InvoiceView';
import { Printer } from 'lucide-react';

export default async function AdminSaleDetailPage({ params }: { params: { locale: string; id: string } }) {
  const { locale, id } = params;
  setRequestLocale(locale);
  const t = await getTranslations('sales');
  const l = locale as 'ar' | 'en';
  return (
    <PageWrapper
      title={t('detail')}
      actions={[
        { label: l === 'ar' ? 'طباعة إيصال' : 'Print receipt', icon: <Printer style={{ width: '13px', height: '13px' }} /> },
      ]}
      breadcrumb={[
        { label: l === 'ar' ? 'المبيعات' : 'Sales' },
        { label: l === 'ar' ? 'الفاتورة' : 'Invoice' },
      ]}
    >
      <InvoiceView saleId={id} />
    </PageWrapper>
  );
}
