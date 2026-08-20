'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/app/i18n/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatDate } from '@/app/lib/utils';
import { api, type PaginatedResponse } from '@/app/lib/api';
import { Plus, Eye, Download, Send, Package } from 'lucide-react';
import { useRouter } from '@/app/i18n/navigation';
import { downloadCSV } from '@/app/lib/csv';
import { useBranch } from '@/app/context/BranchContext';

// Shape returned by GET /purchases
interface ApiBatch {
  id: string;
  medicine_id: string;
  medicine_name_en: string;
  medicine_name_ar: string;
  branch_id: string;
  supplier_id: string;
  supplier_name_en: string;
  supplier_name_ar: string;
  batch_number: string;
  expiry_date: string;
  manufacturing_date: string | null;
  qty_received: number;
  qty_remaining: number;
  unit_cost: string;
  status: string;
  created_at: string;
}

// Shape returned by GET /purchase-orders
interface ApiPurchaseOrder {
  id: string;
  supplier_id: string;
  supplier_name_en: string;
  supplier_name_ar: string;
  branch_id: string;
  branch_name_en: string;
  branch_name_ar: string;
  status: string; // DRAFT, SENT, RECEIVED, CANCELLED
  expected_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  item_count: number;
}

function PurchaseOrdersTab({ locale, branchId, router, t, tCommon, formatCurrency, formatDate }: {
  locale: 'ar' | 'en';
  branchId: string;
  router: any;
  t: any;
  tCommon: any;
  formatCurrency: (v: number, l: string) => string;
  formatDate: (v: string, l: string) => string;
}) {
  const [pos, setPos] = useState<ApiPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [apiSuppliers, setApiSuppliers] = useState<{ id: string; name_en: string; name_ar: string }[]>([]);

  useEffect(() => {
    api.get<PaginatedResponse<{ id: string; name_en: string; name_ar: string }>>('/suppliers?page_size=100')
      .then((res) => setApiSuppliers(res.items)).catch(() => null);
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (branchId) params.set('branch_id', branchId);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (supplierFilter !== 'all') params.set('supplier_id', supplierFilter);
    
    api.get<{ items: ApiPurchaseOrder[]; total: number }>(`/purchase-orders?${params}`)
      .then((res) => setPos(res.items))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [branchId, statusFilter, supplierFilter]);

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
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || colors.DRAFT}`}>
        {labels[status] || status}
      </span>
    );
  };

  const columns: Column<ApiPurchaseOrder>[] = [
    {
      key: 'supplier',
      header: t('supplier'),
      render: (po) => <span className="font-medium">{locale === 'ar' ? po.supplier_name_ar : po.supplier_name_en}</span>,
    },
    {
      key: 'branch',
      header: locale === 'ar' ? 'الفرع' : 'Branch',
      render: (po) => locale === 'ar' ? po.branch_name_ar : po.branch_name_en,
    },
    {
      key: 'status',
      header: locale === 'ar' ? 'الحالة' : 'Status',
      render: (po) => getStatusBadge(po.status),
    },
    {
      key: 'items',
      header: locale === 'ar' ? 'البنود' : 'Items',
      render: (po) => po.item_count,
    },
    {
      key: 'expected_date',
      header: locale === 'ar' ? 'التاريخ المتوقع' : 'Expected Date',
      render: (po) => po.expected_date ? formatDate(po.expected_date, locale) : '-',
    },
    {
      key: 'created_at',
      header: locale === 'ar' ? 'تاريخ الإنشاء' : 'Created',
      render: (po) => formatDate(po.created_at, locale),
    },
    {
      key: 'actions',
      header: tCommon('actions'),
      render: (po) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => router.push(`/admin/purchases/orders/${po.id}`)}
          >
            <Eye className="h-4 w-4" />
          </Button>
          {po.status === 'SENT' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push(`/admin/purchases/orders/${po.id}`)}
            >
              <Package className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={pos}
      rowKey={(po) => po.id}
      emptyTitle={loading ? (locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...') : tCommon('noData')}
      filters={
        <>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder={locale === 'ar' ? 'الحالة' : 'Status'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tCommon('all')}</SelectItem>
              <SelectItem value="DRAFT">{locale === 'ar' ? 'مسودة' : 'Draft'}</SelectItem>
              <SelectItem value="SENT">{locale === 'ar' ? 'مرسل' : 'Sent'}</SelectItem>
              <SelectItem value="RECEIVED">{locale === 'ar' ? 'مستلم' : 'Received'}</SelectItem>
              <SelectItem value="CANCELLED">{locale === 'ar' ? 'ملغي' : 'Cancelled'}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder={t('supplier')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tCommon('all')}</SelectItem>
              {apiSuppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {locale === 'ar' ? s.name_ar : s.name_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
    />
  );
}

function GoodsReceiptsView({ batches, locale, formatCurrency, formatDate, noData }: {
  batches: ApiBatch[];
  locale: 'ar' | 'en';
  formatCurrency: (v: number, l: string) => string;
  formatDate: (v: string, l: string) => string;
  noData: string;
}) {
  const groups: Record<string, { supplier: string; date: string; items: ApiBatch[]; total: number }> = {};
  for (const b of batches) {
    const key = `${b.supplier_id}_${b.created_at.slice(0, 10)}`;
    if (!groups[key]) {
      groups[key] = {
        supplier: locale === 'ar' ? b.supplier_name_ar : b.supplier_name_en,
        date: b.created_at.slice(0, 10),
        items: [],
        total: 0,
      };
    }
    groups[key].items.push(b);
    groups[key].total += b.qty_received * parseFloat(b.unit_cost);
  }
  const grns = Object.values(groups).sort((a, z) => z.date.localeCompare(a.date));
  if (grns.length === 0) return <p className="p-4 text-sm text-muted-foreground">{noData}</p>;
  return (
    <div className="space-y-4">
      {grns.map((grn, gi) => (
        <D365Panel
          key={gi}
          title={`${locale === 'ar' ? 'سند استلام' : 'GRN'} — ${grn.supplier} — ${grn.date}`}
          noPadding
          extra={<span className="text-xs font-semibold text-primary">{formatCurrency(grn.total, locale)}</span>}
        >
          <D365Table
            headers={[
              locale === 'ar' ? 'الدواء' : 'Medicine',
              locale === 'ar' ? 'رقم الدفعة' : 'Batch No.',
              locale === 'ar' ? 'الكمية' : 'Qty',
              locale === 'ar' ? 'تكلفة الوحدة' : 'Unit Cost',
              locale === 'ar' ? 'الإجمالي' : 'Total',
              locale === 'ar' ? 'انتهاء الصلاحية' : 'Expiry',
            ]}
            rows={grn.items.map((b) => [
              <span key="m" className="font-medium">{locale === 'ar' ? b.medicine_name_ar : b.medicine_name_en}</span>,
              <span key="bn" className="font-mono text-xs">{b.batch_number}</span>,
              b.qty_received,
              formatCurrency(parseFloat(b.unit_cost), locale),
              formatCurrency(b.qty_received * parseFloat(b.unit_cost), locale),
              <div key="e" className="flex items-center gap-2">
                <span className="text-xs">{formatDate(b.expiry_date, locale)}</span>
                <ExpiryBadge expiryDate={b.expiry_date} />
              </div>,
            ])}
          />
        </D365Panel>
      ))}
    </div>
  );
}

export default function AdminPurchasesPage() {
  const t = useTranslations('purchases');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { branchId } = useBranch();
  const [activeTab, setActiveTab] = useState('po');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [batches, setBatches] = useState<ApiBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiSuppliers, setApiSuppliers] = useState<{ id: string; name_en: string; name_ar: string }[]>([]);

  useEffect(() => {
    api.get<PaginatedResponse<{ id: string; name_en: string; name_ar: string }>>('/suppliers?page_size=100')
      .then((res) => setApiSuppliers(res.items)).catch(() => null);
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    if (supplierFilter !== 'all') params.set('supplier_id', supplierFilter);
    if (branchId) params.set('branch_id', branchId);
    api.get<PaginatedResponse<ApiBatch>>(`/purchases?${params}`)
      .then((res) => setBatches(res.items))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [supplierFilter, branchId]);

  const filtered = batches.filter((p) => {
    if (fromDate && p.created_at.slice(0, 10) < fromDate) return false;
    if (toDate && p.created_at.slice(0, 10) > toDate) return false;
    return true;
  });

  const columns: Column<ApiBatch>[] = [
    {
      key: 'medicine',
      header: t('medicine'),
      render: (p) => <span className="font-medium">{locale === 'ar' ? p.medicine_name_ar : p.medicine_name_en}</span>,
    },
    {
      key: 'supplier',
      header: t('supplier'),
      render: (p) => locale === 'ar' ? p.supplier_name_ar : p.supplier_name_en,
    },
    {
      key: 'batch',
      header: t('batchNumber'),
      render: (p) => <span className="font-mono text-xs">{p.batch_number}</span>,
    },
    {
      key: 'quantity',
      header: t('quantity'),
      render: (p) => p.qty_received,
    },
    {
      key: 'remaining',
      header: locale === 'ar' ? 'المتبقي' : 'Remaining',
      render: (p) => p.qty_remaining,
    },
    {
      key: 'unitCost',
      header: t('unitCost'),
      render: (p) => formatCurrency(parseFloat(p.unit_cost), locale),
    },
    {
      key: 'expiry',
      header: t('expiryDate'),
      render: (p) => (
        <div className="flex items-center gap-2">
          <span className="text-xs">{formatDate(p.expiry_date, locale)}</span>
          <ExpiryBadge expiryDate={p.expiry_date} />
        </div>
      ),
    },
    {
      key: 'actions',
      header: tCommon('actions'),
      render: (p) => (
        <Link href={`/admin/purchases/${p.id}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Eye className="h-4 w-4" />
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <PageWrapper
      title={t('title')}
      tabs={[
        { key: 'po',      label: locale === 'ar' ? 'أوامر الشراء' : 'Purchase Orders' },
        { key: 'orders',  label: locale === 'ar' ? 'دفعات المخزون' : 'Stock Batches' },
        { key: 'invoice', label: locale === 'ar' ? 'سندات الاستلام' : 'Goods Receipts' },
      ]}
      defaultTab="po"
      onTabChange={setActiveTab}
      actions={[
        { label: locale === 'ar' ? 'أمر شراء جديد' : 'New PO', icon: <Plus style={{ width: '13px', height: '13px' }} />, onClick: () => router.push('/admin/purchases/orders/new') },
        { label: locale === 'ar' ? 'تصدير' : 'Export', icon: <Download style={{ width: '13px', height: '13px' }} />, separator: true,
          onClick: () => {
            const headers = ['batch_number', 'medicine_en', 'medicine_ar', 'supplier_en', 'qty_received', 'qty_remaining', 'unit_cost', 'expiry_date', 'status', 'received_date'];
            const rows = filtered.map((p) => [
              p.batch_number,
              p.medicine_name_en, p.medicine_name_ar,
              p.supplier_name_en,
              String(p.qty_received), String(p.qty_remaining),
              parseFloat(p.unit_cost).toFixed(3),
              p.expiry_date, p.status,
              p.created_at.slice(0, 10),
            ]);
            downloadCSV(`purchases_${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows]);
          },
        },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'المشتريات' : 'Purchases' },
      ]}
    >
      {/* ── Purchase Orders tab ── */}
      {activeTab === 'po' && (
        <PurchaseOrdersTab 
          locale={locale} 
          branchId={branchId} 
          router={router} 
          t={t} 
          tCommon={tCommon}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
        />
      )}

      {/* ── Stock Batches tab ── */}
      {activeTab === 'orders' && (
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(p) => p.id}
        emptyTitle={loading ? (locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...') : tCommon('noData')}
        filters={
          <>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('supplier')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                {apiSuppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {locale === 'ar' ? s.name_ar : s.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
          </>
        }
      />
      )}

      {/* ── Goods Receipts tab ── */}
      {activeTab === 'invoice' && (
        <GoodsReceiptsView batches={filtered} locale={locale} formatCurrency={formatCurrency} formatDate={formatDate} noData={tCommon('noData')} />
      )}
    </PageWrapper>
  );
}
