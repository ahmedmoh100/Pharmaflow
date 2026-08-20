'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { StockBadge } from '@/components/shared/StockBadge';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/shared/EmptyState';
import { api } from '@/app/lib/api';
import { useSession } from '@/app/lib/auth';
import { formatDate, formatCurrency } from '@/app/lib/utils';
import { AlertTriangle, CalendarClock } from 'lucide-react';

interface LowStockItem {
  id: string; name_en: string; name_ar: string;
  stock_quantity: number; low_stock_threshold: number;
}
interface ExpiringItem {
  id: string; batch_number: string; expiry_date: string;
  qty_remaining: number; medicine_id: string; branch_id: string;
  medicine_name_en: string; medicine_name_ar: string;
  medicine_selling_price?: string;
}

export default function PharmacistAlertsPage() {
  const t = useTranslations('alerts');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { user } = useSession();

  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [expiring, setExpiring] = useState<ExpiringItem[]>([]);

  useEffect(() => {
    // Use medicines endpoint with low_stock filter — accessible to all roles
    const params = new URLSearchParams({ page_size: '50', is_active: 'true', low_stock: 'true' });
    if (user?.branch_id) params.set('branch_id', user.branch_id);
    api.get<{ items: LowStockItem[] }>(`/medicines?${params}`)
      .then((res) => setLowStock(res.items))
      .catch(() => null);

    api.get<{ items: ExpiringItem[] }>('/purchases?page=1&page_size=100')
      .then((res) => {
        const today = new Date();
        const in90 = new Date(); in90.setDate(today.getDate() + 90);
        setExpiring(
          res.items
            .filter((b) => {
              const exp = new Date(b.expiry_date);
              // Only show this branch's batches
              if (user?.branch_id && b.branch_id !== user.branch_id) return false;
              return exp <= in90 && exp >= today && b.qty_remaining > 0;
            })
            .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
        );
      })
      .catch(() => null);
  }, [user]);

  return (
    <PosPageWrapper title={locale === 'ar' ? 'التنبيهات' : 'Alerts'}>
      <Tabs defaultValue="low-stock">
        <TabsList className="mb-4">
          <TabsTrigger value="low-stock" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            {t('lowStock')} ({lowStock.length})
          </TabsTrigger>
          <TabsTrigger value="expiring" className="gap-2">
            <CalendarClock className="h-4 w-4" />
            {t('expiringSoon')} ({expiring.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="low-stock">
          {lowStock.length === 0 ? <EmptyState title={t('noLowStock')} /> : (
            <div className="overflow-x-auto rounded border border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{t('medicine')}</TableHead>
                    <TableHead className="text-xs">{t('currentStock')}</TableHead>
                    <TableHead className="text-xs">{t('threshold')}</TableHead>
                    <TableHead className="text-xs">{t('deficit')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStock.map((m) => (
                    <TableRow key={m.id} className="cursor-pointer"
                      onClick={() => router.push(`/pharmacist/inventory/${m.id}` as `/${string}`)}>
                      <TableCell className="text-sm font-medium">{locale === 'ar' ? m.name_ar : m.name_en}</TableCell>
                      <TableCell><StockBadge quantity={m.stock_quantity} threshold={m.low_stock_threshold} /></TableCell>
                      <TableCell className="text-sm">{m.low_stock_threshold}</TableCell>
                      <TableCell className="text-sm text-destructive font-medium">
                        {m.low_stock_threshold - m.stock_quantity}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="expiring">
          {expiring.length === 0 ? <EmptyState title={t('noExpiring')} /> : (
            <>
              {/* Value at risk banner */}
              {(() => {
                const atRisk = expiring.reduce((sum, b) => {
                  const price = parseFloat(b.medicine_selling_price ?? '0');
                  return sum + (price * b.qty_remaining);
                }, 0);
                return atRisk > 0 ? (
                  <div className="mb-4 flex items-center justify-between rounded border border-destructive/30 bg-destructive/10 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                      <CalendarClock className="h-4 w-4" />
                      {locale === 'ar' ? 'قيمة المخزون المعرض للخطر (90 يوم)' : 'Stock at risk within 90 days'}
                    </div>
                    <span className="text-sm font-bold text-destructive">{formatCurrency(atRisk, locale)}</span>
                  </div>
                ) : null;
              })()}
              <div className="overflow-x-auto rounded border border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{t('medicine')}</TableHead>
                    <TableHead className="text-xs">{t('batchNumber')}</TableHead>
                    <TableHead className="text-xs">{t('expiryDate')}</TableHead>
                    <TableHead className="text-xs">{t('daysLeft')}</TableHead>
                    <TableHead className="text-xs">{locale === 'ar' ? 'المتبقي' : 'Remaining'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiring.map((b) => (
                    <TableRow key={b.id} className="cursor-pointer"
                      onClick={() => router.push(`/pharmacist/inventory/${b.medicine_id}` as `/${string}`)}>
                      <TableCell className="text-sm font-medium">
                        {locale === 'ar' ? b.medicine_name_ar : b.medicine_name_en}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{b.batch_number}</TableCell>
                      <TableCell className="text-sm">{formatDate(b.expiry_date, locale)}</TableCell>
                      <TableCell><ExpiryBadge expiryDate={b.expiry_date} /></TableCell>
                      <TableCell className="text-sm">{b.qty_remaining}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </PosPageWrapper>
  );
}
