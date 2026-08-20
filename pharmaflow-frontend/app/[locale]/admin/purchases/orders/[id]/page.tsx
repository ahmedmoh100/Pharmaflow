'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/app/lib/api';
import { ArrowLeft, Package, CheckCircle, Send } from 'lucide-react';
import { formatCurrency, formatDate } from '@/app/lib/utils';

interface ApiPO {
  id: string;
  supplier_id: string;
  supplier_name_en: string;
  supplier_name_ar: string;
  branch_id: string;
  branch_name_en: string;
  branch_name_ar: string;
  status: string;
  expected_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  items: POItem[];
}

interface POItem {
  id: string;
  medicine_id: string;
  medicine_name_en: string;
  medicine_name_ar: string;
  ordered_qty: number;
  agreed_unit_cost: string;
}

interface ReceiveItem {
  medicine_id: string;
  batch_number: string;
  qty_received: number;
  unit_cost: number;
  expiry_date: string;
  manufacturing_date: string;
}

export default function PODetailPage() {
  const t = useTranslations('purchases');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const params = useParams();
  const poId = params.id as string;
  const { toast } = useToast();

  const [po, setPo] = useState<ApiPO | null>(null);
  const [loading, setLoading] = useState(true);
  const [receiveMode, setReceiveMode] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const [receiveItems, setReceiveItems] = useState<ReceiveItem[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<ApiPO>(`/purchase-orders/${poId}`);
        setPo(res);
        
        // Initialize receive items based on PO items
        setReceiveItems(res.items.map(item => ({
          medicine_id: item.medicine_id,
          batch_number: '',
          qty_received: item.ordered_qty,
          unit_cost: parseFloat(item.agreed_unit_cost),
          expiry_date: '',
          manufacturing_date: '',
        })));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        toast({
          title: locale === 'ar' ? 'تعذّر تحميل أمر الشراء' : 'Failed to load PO',
          description: msg || undefined,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [poId]);

  function updateReceiveItem(index: number, field: keyof ReceiveItem, value: string | number) {
    const newItems = [...receiveItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setReceiveItems(newItems);
  }

  function handleReceive() {
    void (async () => {
      setReceiving(true);
      try {
        const payload = {
          items: receiveItems.filter(item => 
            item.batch_number && item.qty_received > 0 && item.expiry_date
          ),
        };

        if (payload.items.length === 0) {
          toast({
            title: locale === 'ar' ? 'خطأ' : 'Error',
            description: locale === 'ar' ? 'يجب ملء جميع الحقول المطلوبة' : 'Please fill all required fields',
            variant: 'destructive',
          });
          setReceiving(false);
          return;
        }

        await api.post(`/purchase-orders/${poId}/receive`, payload);
        toast({ 
          title: locale === 'ar' ? 'تم استلام البضاعة' : 'Goods received successfully',
          description: locale === 'ar' ? 'تم تحديث المخزون' : 'Stock updated'
        });
        router.replace('/admin/purchases');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        toast({
          title: locale === 'ar' ? 'حدث خطأ' : 'Error receiving goods',
          description: msg || undefined,
          variant: 'destructive',
        });
      } finally {
        setReceiving(false);
      }
    })();
  }

  function handleStatusUpdate(newStatus: string) {
    void (async () => {
      try {
        await api.put(`/purchase-orders/${poId}/status`, { status: newStatus });
        toast({ 
          title: locale === 'ar' ? 'تم تحديث الحالة' : 'Status updated'
        });
        // Reload PO
        const res = await api.get<ApiPO>(`/purchase-orders/${poId}`);
        setPo(res);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        toast({
          title: locale === 'ar' ? 'حدث خطأ' : 'Error updating status',
          description: msg || undefined,
          variant: 'destructive',
        });
      }
    })();
  }

  if (loading) {
    return (
      <PageWrapper
        title={locale === 'ar' ? 'أمر الشراء' : 'Purchase Order'}
        breadcrumb={[
          { label: locale === 'ar' ? 'المشتريات' : 'Purchases' },
          { label: locale === 'ar' ? 'أوامر الشراء' : 'Purchase Orders' },
        ]}
      >
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">{tCommon('loading')}</p>
        </div>
      </PageWrapper>
    );
  }

  if (!po) {
    return (
      <PageWrapper
        title={locale === 'ar' ? 'أمر الشراء' : 'Purchase Order'}
        breadcrumb={[
          { label: locale === 'ar' ? 'المشتريات' : 'Purchases' },
          { label: locale === 'ar' ? 'أوامر الشراء' : 'Purchase Orders' },
        ]}
      >
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">{locale === 'ar' ? 'أمر الشراء غير موجود' : 'Purchase Order not found'}</p>
        </div>
      </PageWrapper>
    );
  }

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      SENT: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
      RECEIVED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
      CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    };
    const labels: Record<string, string> = {
      DRAFT: locale === 'ar' ? 'مسودة' : 'Draft',
      SENT: locale === 'ar' ? 'مرسل' : 'Sent',
      RECEIVED: locale === 'ar' ? 'مستلم' : 'Received',
      CANCELLED: locale === 'ar' ? 'ملغي' : 'Cancelled',
    };
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors[status] || colors.DRAFT}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <PageWrapper
      title={`${locale === 'ar' ? 'أمر الشراء' : 'Purchase Order'} #${poId.slice(0, 8)}`}
      actions={[
        { label: locale === 'ar' ? 'رجوع' : 'Back', icon: <ArrowLeft className="h-4 w-4" />, onClick: () => router.back() },
        po.status === 'DRAFT' && !receiveMode && {
          label: locale === 'ar' ? 'إرسال' : 'Send',
          icon: <Send className="h-4 w-4" />,
          onClick: () => handleStatusUpdate('SENT'),
        },
        po.status === 'SENT' && !receiveMode && {
          label: locale === 'ar' ? 'استلام' : 'Receive',
          icon: <Package className="h-4 w-4" />,
          onClick: () => setReceiveMode(true),
        },
        receiveMode && {
          label: locale === 'ar' ? 'إلغاء' : 'Cancel',
          variant: 'outline',
          onClick: () => setReceiveMode(false),
        },
        receiveMode && {
          label: locale === 'ar' ? 'تأكيد الاستلام' : 'Confirm Receive',
          icon: <CheckCircle className="h-4 w-4" />,
          onClick: handleReceive,
          disabled: receiving,
        },
      ].filter(Boolean) as any}
      breadcrumb={[
        { label: locale === 'ar' ? 'المشتريات' : 'Purchases' },
        { label: locale === 'ar' ? 'أوامر الشراء' : 'Purchase Orders' },
        { label: poId.slice(0, 8) },
      ]}
    >
      <div className="space-y-6">
        {/* PO Details */}
        <D365Panel title={locale === 'ar' ? 'تفاصيل أمر الشراء' : 'Purchase Order Details'}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">{locale === 'ar' ? 'المورد' : 'Supplier'}</p>
              <p className="font-medium">{locale === 'ar' ? po.supplier_name_ar : po.supplier_name_en}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{locale === 'ar' ? 'الفرع' : 'Branch'}</p>
              <p className="font-medium">{locale === 'ar' ? po.branch_name_ar : po.branch_name_en}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{locale === 'ar' ? 'الحالة' : 'Status'}</p>
              {getStatusBadge(po.status)}
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{locale === 'ar' ? 'التاريخ المتوقع' : 'Expected Date'}</p>
              <p className="font-medium">{po.expected_date ? formatDate(po.expected_date, locale) : '-'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{locale === 'ar' ? 'تاريخ الإنشاء' : 'Created'}</p>
              <p className="font-medium">{formatDate(po.created_at, locale)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{locale === 'ar' ? 'أنشأ بواسطة' : 'Created by'}</p>
              <p className="font-medium">{po.created_by_name}</p>
            </div>
          </div>
          {po.notes && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">{t('notes')}</p>
              <p className="font-medium">{po.notes}</p>
            </div>
          )}
        </D365Panel>

        {/* PO Items */}
        <D365Panel title={locale === 'ar' ? 'بنود أمر الشراء' : 'Purchase Order Items'}>
          <D365Table
            headers={[
              t('medicine'),
              locale === 'ar' ? 'الكمية المطلوبة' : 'Ordered Qty',
              t('unitCost'),
              locale === 'ar' ? 'الإجمالي' : 'Total',
            ]}
            rows={po.items.map((item) => [
              <span key="m" className="font-medium">{locale === 'ar' ? item.medicine_name_ar : item.medicine_name_en}</span>,
              item.ordered_qty,
              formatCurrency(parseFloat(item.agreed_unit_cost), locale),
              formatCurrency(item.ordered_qty * parseFloat(item.agreed_unit_cost), locale),
            ])}
          />
        </D365Panel>

        {/* Receive Form */}
        {receiveMode && (
          <D365Panel title={locale === 'ar' ? 'استلام البضاعة' : 'Receive Goods'}>
            <div className="space-y-4">
              {receiveItems.map((item, index) => (
                <div key={index} className="grid gap-4 md:grid-cols-6 p-4 border rounded-lg">
                  <div className="md:col-span-2">
                    <p className="text-sm font-medium mb-1">
                      {locale === 'ar' ? po.items[index]?.medicine_name_ar : po.items[index]?.medicine_name_en}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'ar' ? 'مطلوب' : 'Ordered'}: {po.items[index]?.ordered_qty}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">{locale === 'ar' ? 'رقم الدفعة' : 'Batch No'} *</Label>
                    <Input
                      value={item.batch_number}
                      onChange={(e) => updateReceiveItem(index, 'batch_number', e.target.value)}
                      placeholder="BATCH-001"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">{locale === 'ar' ? 'الكمية المستلمة' : 'Received Qty'} *</Label>
                    <Input
                      type="number"
                      min="1"
                      max={po.items[index]?.ordered_qty}
                      value={item.qty_received}
                      onChange={(e) => updateReceiveItem(index, 'qty_received', parseInt(e.target.value) || 0)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">{t('unitCost')} *</Label>
                    <Input
                      type="number"
                      step="0.001"
                      value={item.unit_cost}
                      onChange={(e) => updateReceiveItem(index, 'unit_cost', parseFloat(e.target.value) || 0)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">{t('expiryDate')} *</Label>
                    <Input
                      type="date"
                      value={item.expiry_date}
                      onChange={(e) => updateReceiveItem(index, 'expiry_date', e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </D365Panel>
        )}
      </div>
    </PageWrapper>
  );
}
