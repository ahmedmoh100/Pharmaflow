'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { D365Panel } from '@/components/shared/D365Panel';
import { UserForm } from '@/components/users/UserForm';
import { formatCurrency, formatDateTime } from '@/app/lib/utils';
import { api } from '@/app/lib/api';
import { Save } from 'lucide-react';
import type { User } from '@/app/lib/types';

export default function UserDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const locale = useLocale() as 'ar' | 'en';
  const tCommon = useTranslations('common');
  const t = useTranslations('users');

  const [user, setUser] = useState<User | null>(null);
  const [sales, setSales] = useState<{ total_count: number; total_revenue: number }>({ total_count: 0, total_revenue: 0 });

  useEffect(() => {
    api.get<User>(`/users/${id}`).then(setUser).catch(() => null);
    api.get<{ items: Record<string, number>[]; total: number }>(`/sales?user_id=${id}&page=1&page_size=100`)
      .then((res) => {
        const revenue = res.items.reduce((s, sale) => s + parseFloat(String(sale.total_amount || 0)), 0);
        setSales({ total_count: res.total, total_revenue: revenue });
      }).catch(() => null);
  }, [id]);

  if (!user) return <div className="p-8 text-muted-foreground">Loading...</div>;

  return (
    <PageWrapper
      title={user.full_name}
      actions={[{ label: locale === 'ar' ? 'حفظ' : 'Save', icon: <Save style={{ width: '13px', height: '13px' }} /> }]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الإدارة' : 'Administration' },
        { label: locale === 'ar' ? 'المستخدمون' : 'Users' },
        { label: user.full_name },
      ]}
    >
      <div className="space-y-6">
        <UserForm initial={user} />

        <D365Panel title={locale === 'ar' ? 'ملخص المبيعات' : 'Sales Summary'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'عدد المبيعات' : 'Total Sales'}</p>
              <p className="text-2xl font-bold">{sales.total_count}</p>
            </div>
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'إجمالي الإيراد' : 'Total Revenue'}</p>
              <p className="text-2xl font-bold">{formatCurrency(sales.total_revenue, locale)}</p>
            </div>
          </div>
        </D365Panel>
      </div>
    </PageWrapper>
  );
}
