'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StockBadge } from '@/components/shared/StockBadge';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { EmptyState } from '@/components/shared/EmptyState';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { formatDate, daysUntil, formatCurrency } from '@/app/lib/utils';
import { api } from '@/app/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Trash2 } from 'lucide-react';
import { useBranch } from '@/app/context/BranchContext';

interface ApiLowStock {
  id: string; name_en: string; name_ar: string;
  stock_quantity: number; low_stock_threshold: number;
}
interface ApiExpiringBatch {
  id: string; batch_number: string; expiry_date: string;
  qty_remaining: number; medicine_name_en: string; medicine_name_ar: string;
  medicine_id: string; supplier_name_en: string; supplier_name_ar: string;
  unit_cost: string;
}

export default function AdminAlertsPage() {
  const t = useTranslations('alerts');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const { toast } = useToast();
  const { branchId } = useBranch();

  const [lowStock, setLowStock] = useState<ApiLowStock[]>([]);
  const [expiring, setExpiring] = useState<ApiExpiringBatch[]>([]);
  const [writeOffTarget, setWriteOffTarget] = useState<ApiExpiringBatch | null>(null);

  useEffect(() => {
    // Low stock: medicines where stock_quantity <= low_stock_threshold
    api.get<{ items: ApiLowStock[]; total: number }>(`/medicines?page=1&page_size=100&low_stock=true&branch_id=${branchId}`)
      .then((res) => setLowStock(res.items))
      .catch(() => null);

    api.get<{ items: ApiExpiringBatch[]; total: number }>(`/purchases?page=1&page_size=100&branch_id=${branchId}`)
      .then((res) => {
        const today = new Date();
        const in91 = new Date(); in91.setDate(today.getDate() + 91);
        setExpiring(res.items.filter((b) => {
          const exp = new Date(b.expiry_date);
          const status = (b as ApiExpiringBatch & { status?: string; sfda_status?: string }).sfda_status;
          const bstatus = (b as ApiExpiringBatch & { status?: string }).status;
          if (status === 'recalled' || status === 'quarantined') return false;
          if (bstatus === 'inactive' || bstatus === 'written_off') return false;
          return exp < in91 && b.qty_remaining > 0;
        }));
      })
      .catch(() => null);
  }, [branchId]);

  function confirmWriteOff() {
    if (!writeOffTarget) return;
    // Call backend to persist write-off
    api.put(`/purchases/${writeOffTarget.id}/write-off`, {})
      .catch(() => null); // fire-and-forget — UI updates regardless
    setExpiring((prev) => prev.filter((p) => p.id !== writeOffTarget.id));
    const name = locale === 'ar' ? writeOffTarget.medicine_name_ar : writeOffTarget.medicine_name_en;
    toast({
      title: locale === 'ar' ? 'تم شطب الدفعة' : 'Batch Written Off',
      description: locale === 'ar'
        ? `تم شطب دفعة ${name} (${writeOffTarget.batch_number})`
        : `Batch ${writeOffTarget.batch_number} of ${name} has been written off`,
    });
    setWriteOffTarget(null);
  }

  return (
    <PageWrapper
      title={t('title')}
      tabs={[
        { key: 'alerts', label: locale === 'ar' ? 'التنبيهات' : 'Alerts' },
      ]}
      defaultTab="alerts"
      actions={[]}
      breadcrumb={[
        { label: locale === 'ar' ? 'التنبيهات' : 'Alerts' },
      ]}
    >
      {/* Low Stock Panel */}
      <D365Panel title={`${t('lowStock')} (${lowStock.length})`} noPadding>
          {lowStock.length === 0 ? (
            <div className="p-4"><EmptyState title={t('noLowStock')} /></div>
          ) : (
            <D365Table
              headers={[t('medicine'), t('currentStock'), t('threshold'), t('deficit'), locale === 'ar' ? 'كمية مقترحة للطلب' : 'Suggested Order']}
              rows={lowStock.map((m) => [
                <span key={m.id} className="font-medium">{locale === 'ar' ? m.name_ar : m.name_en}</span>,
                <StockBadge key={m.id} quantity={m.stock_quantity} threshold={m.low_stock_threshold} />,
                m.low_stock_threshold,
                <span key={m.id} className="text-destructive font-medium">{m.low_stock_threshold - m.stock_quantity}</span>,
                <span key={m.id} className="font-mono font-medium text-primary">{Math.max(0, (m.low_stock_threshold * 3) - m.stock_quantity)}</span>,
              ])}
            />
          )}
      </D365Panel>

      {/* Expiring Panel */}
      <D365Panel title={`${t('expiringSoon')} (${expiring.length})`} noPadding>
          {expiring.length === 0 ? (
            <div className="p-4"><EmptyState title={t('noExpiring')} /></div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b px-4 py-3 bg-destructive/10 mb-2">
                <span className="text-sm font-medium text-destructive">
                  {locale === 'ar' ? 'قيمة المخزون المعرض للخطر (90 يوماً)' : 'Inventory at Risk (next 90 days)'}
                </span>
                <span className="text-sm font-bold text-destructive">
                  {formatCurrency(expiring.reduce((sum, p) => sum + p.qty_remaining * parseFloat(p.unit_cost), 0), locale)}
                </span>
              </div>
              <D365Table
                headers={[t('medicine'), t('batchNumber'), t('expiryDate'), t('daysLeft'), tCommon('actions')]}
                rows={expiring.map((p) => {
                  const days = daysUntil(p.expiry_date);
                  return [
                    <span key={p.id} className="font-medium">{locale === 'ar' ? p.medicine_name_ar : p.medicine_name_en}</span>,
                    <span key={p.id} className="font-mono text-xs">{p.batch_number}</span>,
                    formatDate(p.expiry_date, locale),
                    <div key={p.id} className="flex items-center gap-2">
                      <ExpiryBadge expiryDate={p.expiry_date} />
                    </div>,
                    <Button key={p.id} size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={() => setWriteOffTarget(p)}>
                      <Trash2 className="h-3 w-3" />
                      {locale === 'ar' ? 'شطب' : 'Write Off'}
                    </Button>,
                  ];
                })}
              />
            </>
          )}
      </D365Panel>

      {/* Write-off dialog */}
      <Dialog open={!!writeOffTarget} onOpenChange={(open) => { if (!open) setWriteOffTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'تأكيد الشطب' : 'Confirm Write-Off'}</DialogTitle>
            <DialogDescription>
              {writeOffTarget && (() => {
                const name = locale === 'ar' ? writeOffTarget.medicine_name_ar : writeOffTarget.medicine_name_en;
                return locale === 'ar'
                  ? `هل تريد شطب دفعة ${writeOffTarget.batch_number} من ${name}؟ لا يمكن التراجع عن هذا الإجراء.`
                  : `Write off batch ${writeOffTarget.batch_number} of ${name}? This action cannot be undone.`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWriteOffTarget(null)}>{tCommon('cancel')}</Button>
            <Button variant="destructive" onClick={confirmWriteOff}>{locale === 'ar' ? 'شطب' : 'Write Off'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
