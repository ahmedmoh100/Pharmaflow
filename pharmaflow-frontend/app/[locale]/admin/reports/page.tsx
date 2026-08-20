'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/app/i18n/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { Button } from '@/components/ui/button';
import { D365Panel } from '@/components/shared/D365Panel';
import { ShoppingCart, Package, BarChart3, ArrowRight } from 'lucide-react';

export default function AdminReportsPage() {
  const t = useTranslations('reports');
  const locale = useLocale() as 'ar' | 'en';

  const reports = [
    { href: '/admin/reports/sales', title: t('salesReport'), desc: t('salesReportDesc'), icon: ShoppingCart },
    { href: '/admin/reports/inventory', title: t('inventoryReport'), desc: t('inventoryReportDesc'), icon: Package },
    { href: '/admin/reports/purchases', title: t('purchasesReport'), desc: t('purchasesReportDesc'), icon: BarChart3 },
  ];

  return (
    <PageWrapper
      title={t('title')}
      breadcrumb={[
        { label: locale === 'ar' ? 'التقارير' : 'Reports' },
      ]}
    >
      <div className="grid gap-6 md:grid-cols-3">
        {reports.map((r) => {
          const Icon = r.icon;
          return (
            <D365Panel key={r.href} title={r.title}>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground mb-4">{r.desc}</p>
              <Link href={r.href}>
                <Button variant="outline" className="w-full gap-2">
                  {t('open')}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </Button>
              </Link>
            </D365Panel>
          );
        })}
      </div>
    </PageWrapper>
  );
}
