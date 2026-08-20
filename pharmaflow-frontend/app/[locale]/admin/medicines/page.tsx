'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter } from '@/app/i18n/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { StockBadge } from '@/components/shared/StockBadge';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CATEGORIES, FORMS, lookupName } from '@/app/lib/mock-data';
import type { Medicine } from '@/app/lib/types';
import { formatCurrency, formatDate } from '@/app/lib/utils';
import { api, type ApiMedicine, type PaginatedResponse } from '@/app/lib/api';
import { Plus, Download, Upload, Power, Eye, Pencil } from 'lucide-react';
import { downloadCSV, parseCSV } from '@/app/lib/csv';
import { useRef } from 'react';
import { useBranch } from '@/app/context/BranchContext';

interface ApiBatch {
  id: string;
  medicine_id: string;
  medicine_name_en: string;
  medicine_name_ar: string;
  supplier_name_en: string;
  supplier_name_ar: string;
  batch_number: string;
  qty_received: number;
  qty_remaining: number;
  unit_cost: string;
  expiry_date: string;
  status: string;
  created_at: string;
}

interface ApiMovement {
  id: string;
  medicine_name_en: string;
  medicine_name_ar: string;
  branch_name_en: string;
  branch_name_ar: string;
  qty_delta: number;
  movement_type: string;
  reference_type: string;
  user_name: string;
  created_at: string;
}

export default function AdminMedicinesPage() {
  const t = useTranslations('medicines');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { branchId } = useBranch();

  const [activeTab, setActiveTab] = useState('inventory');
  const importInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const today = new Date().toISOString().slice(0, 10);

    if (activeTab === 'inventory') {
      const headers = ['name_en', 'name_ar', 'generic_name', 'barcode', 'category', 'form', 'strength', 'unit', 'selling_price', 'stock_quantity', 'low_stock_threshold', 'requires_prescription', 'vat_category', 'is_active'];
      const rows = medicines.map((m) => [
        m.name_en, m.name_ar, m.generic_name ?? '', m.barcode ?? '',
        m.category, m.form, m.strength ?? '', m.unit,
        parseFloat(String(m.selling_price)).toFixed(3),
        String(m.stock_quantity), String(m.low_stock_threshold),
        m.requires_prescription ? '1' : '0', m.vat_category ?? 'zero_rated',
        m.is_active ? '1' : '0',
      ]);
      downloadCSV(`medicines_${today}.csv`, [headers, ...rows]);

    } else if (activeTab === 'batches') {
      const headers = ['batch_number', 'medicine_en', 'medicine_ar', 'supplier_en', 'qty_received', 'qty_remaining', 'unit_cost', 'expiry_date', 'status'];
      const rows = filteredBatches.map((b) => [
        b.batch_number,
        b.medicine_name_en, b.medicine_name_ar,
        b.supplier_name_en,
        String(b.qty_received), String(b.qty_remaining),
        parseFloat(b.unit_cost).toFixed(3),
        b.expiry_date, b.status,
      ]);
      downloadCSV(`batches_${today}.csv`, [headers, ...rows]);

    } else if (activeTab === 'movement') {
      const headers = ['date', 'medicine_en', 'medicine_ar', 'branch_en', 'type', 'qty_delta', 'reference_type', 'by'];
      const rows = movements.map((mv) => [
        mv.created_at.slice(0, 16).replace('T', ' '),
        mv.medicine_name_en, mv.medicine_name_ar,
        mv.branch_name_en,
        mv.movement_type, String(mv.qty_delta),
        mv.reference_type ?? '', mv.user_name ?? '',
      ]);
      downloadCSV(`stock_movements_${today}.csv`, [headers, ...rows]);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const rows = await parseCSV(file);
    // Build set of existing barcodes to skip duplicates
    const existingBarcodes = new Set(medicines.map((m) => m.barcode).filter(Boolean));
    let created = 0, skipped = 0, failed = 0;
    for (const row of rows) {
      if (!row.name_en || !row.name_ar) { failed++; continue; }
      // Skip if barcode already exists (avoid duplicates on re-import)
      if (row.barcode && existingBarcodes.has(row.barcode)) { skipped++; continue; }
      try {
        await api.post('/medicines', {
          name_en: row.name_en, name_ar: row.name_ar,
          generic_name: row.generic_name ?? '',
          barcode: row.barcode ?? '',
          category: row.category ?? 'analgesics',
          form: row.form ?? 'Tablet',
          strength: row.strength ?? '',
          unit: row.unit ?? 'Box',
          selling_price: String(parseFloat(row.selling_price) || 0),
          low_stock_threshold: parseInt(row.low_stock_threshold) || 10,
          requires_prescription: row.requires_prescription === '1',
          vat_category: row.vat_category ?? 'zero_rated',
          max_public_price: '0',
          sfda_registration_no: row.sfda_registration_no ?? '',
          requires_cold_chain: false,
          is_active: row.is_active !== '0',
        });
        created++;
      } catch { failed++; }
    }
    // Refresh list
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    api.get<PaginatedResponse<ApiMedicine>>(`/medicines?${params}`)
      .then((res) => setMedicines(res.items)).catch(() => null);
    const msg = [`${locale === 'ar' ? 'تم استيراد' : 'Imported'} ${created}`];
    if (skipped > 0) msg.push(`${locale === 'ar' ? 'تخطي' : 'skipped'} ${skipped} ${locale === 'ar' ? '(موجود مسبقاً)' : '(already exists)'}`);
    if (failed > 0) msg.push(`${locale === 'ar' ? 'فشل' : 'failed'} ${failed}`);
    alert(msg.join(', '));
    e.target.value = '';
  }

  // ── Inventory state ──
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [medicines, setMedicines] = useState<ApiMedicine[]>([]);
  const [loadingMeds, setLoadingMeds] = useState(true);
  const [errorMeds, setErrorMeds] = useState('');

  useEffect(() => {
    if (activeTab !== 'inventory') return;
    setLoadingMeds(true);
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (statusFilter === 'inactive') params.set('is_active', 'false');
    else if (statusFilter === 'active') params.set('is_active', 'true');
    else params.set('is_active', 'all');
    if (branchId) params.set('branch_id', branchId);
    api.get<PaginatedResponse<ApiMedicine>>(`/medicines?${params}`)
      .then((res) => { setMedicines(res.items); setErrorMeds(''); })
      .catch((err: Error) => setErrorMeds(err.message))
      .finally(() => setLoadingMeds(false));
  }, [activeTab, categoryFilter, statusFilter, branchId]);

  // ── Batches state ──
  const [batches, setBatches] = useState<ApiBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [batchStatusFilter, setBatchStatusFilter] = useState('active');

  useEffect(() => {
    if (activeTab !== 'batches') return;
    setLoadingBatches(true);
    api.get<PaginatedResponse<ApiBatch>>(`/purchases?page=1&page_size=100${branchId ? '&branch_id=' + branchId : ''}`)
      .then((res) => setBatches(res.items))
      .catch(() => null)
      .finally(() => setLoadingBatches(false));
  }, [activeTab, branchId]);

  const filteredBatches = batches.filter((b) => {
    if (batchStatusFilter === 'all') return true;
    return b.status === batchStatusFilter;
  });

  // ── Movements state ──
  const [movements, setMovements] = useState<ApiMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [movementTypeFilter, setMovementTypeFilter] = useState('all');

  useEffect(() => {
    if (activeTab !== 'movement') return;
    setLoadingMovements(true);
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    if (movementTypeFilter !== 'all') params.set('movement_type', movementTypeFilter);
    api.get<PaginatedResponse<ApiMovement>>(`/purchases/movements/all?${params}`)
      .then((res) => setMovements(res.items))
      .catch(() => null)
      .finally(() => setLoadingMovements(false));
  }, [activeTab, movementTypeFilter]);

  const filtered = medicines as unknown as Medicine[];

  const columns: Column<Medicine>[] = [
    { key: 'nameAr', header: t('nameAr'), render: (m) => <span className="font-medium">{m.name_ar}</span> },
    { key: 'nameEn', header: t('nameEn'), render: (m) => m.name_en },
    { key: 'category', header: t('category'), render: (m) => lookupName(CATEGORIES, m.category, locale) },
    { key: 'form', header: t('form'), render: (m) => lookupName(FORMS, m.form, locale) },
    { key: 'stock', header: branchId ? (locale === 'ar' ? 'المخزون (الفرع)' : 'Stock (Branch)') : (locale === 'ar' ? 'المخزون (كل الفروع)' : 'Stock (All Branches)'), render: (m) => <StockBadge quantity={m.stock_quantity} threshold={m.low_stock_threshold} /> },
    { key: 'price', header: t('sellingPrice'), render: (m) => formatCurrency(m.selling_price, locale) },
    {
      key: 'prescription', header: t('prescription'),
      render: (m) => m.requires_prescription
        ? <Badge variant="destructive">{tCommon('yes')}</Badge>
        : <Badge variant="secondary">{tCommon('no')}</Badge>,
    },
    {
      key: 'status', header: tCommon('status'),
      render: (m) => m.is_active
        ? <Badge variant="default">{tCommon('active')}</Badge>
        : <Badge variant="outline">{tCommon('inactive')}</Badge>,
    },
    {
      key: 'actions', header: tCommon('actions'),
      render: (m) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Link href={`/admin/medicines/${m.id}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8"><Eye className="h-4 w-4" /></Button>
          </Link>
          <Link href={`/admin/medicines/${m.id}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="h-4 w-4" /></Button>
          </Link>
          <ConfirmDialog
            trigger={<Button variant="ghost" size="icon" className="h-8 w-8"><Power className="h-4 w-4" /></Button>}
            title={m.is_active ? t('deactivate') : t('activate')}
            description={m.is_active ? t('deactivateConfirm') : t('activateConfirm')}
            onConfirm={async () => {
              await api.put(`/medicines/${m.id}`, { is_active: !m.is_active }).catch(() => null);
              setMedicines((prev) => prev.map((x) => x.id === m.id ? { ...x, is_active: !m.is_active } : x));
            }}
          />
        </div>
      ),
    },
  ];

  const MOVEMENT_COLORS: Record<string, string> = {
    IN: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    OUT: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    RETURN: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
    ADJUST: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    WRITE_OFF: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <PageWrapper
      title={t('title')}
      tabs={[
        { key: 'inventory', label: locale === 'ar' ? 'المخزون' : 'Inventory' },
        { key: 'batches', label: locale === 'ar' ? 'الدفعات' : 'Batches' },
        { key: 'movement', label: locale === 'ar' ? 'حركة المخزون' : 'Stock Movement' },
      ]}
      defaultTab="inventory"
      onTabChange={setActiveTab}
      actions={[
        {
          label: locale === 'ar' ? 'جديد' : 'New',
          icon: <Plus style={{ width: '13px', height: '13px' }} />,
          onClick: () => router.push('/admin/medicines/new'),
        },
        { label: locale === 'ar' ? 'تصدير' : 'Export', icon: <Download style={{ width: '13px', height: '13px' }} />, separator: true, onClick: handleExport },
        { label: locale === 'ar' ? 'استيراد' : 'Import', icon: <Upload style={{ width: '13px', height: '13px' }} />, onClick: () => importInputRef.current?.click() },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'المخزون' : 'Inventory' },
        { label: locale === 'ar' ? 'الأدوية' : 'Medicines' },
      ]}
    >
      {/* ── Inventory tab ── */}
      {activeTab === 'inventory' && (
        <DataTable
          columns={columns}
          data={filtered}
          searchPlaceholder={t('searchPlaceholder')}
          rowKey={(m) => m.id}
          emptyTitle={loadingMeds ? (locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...') : errorMeds || tCommon('noData')}
          filters={
            <>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder={t('category')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tCommon('all')}</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{locale === 'ar' ? c.name_ar : c.name_en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32"><SelectValue placeholder={tCommon('status')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tCommon('all')}</SelectItem>
                  <SelectItem value="active">{tCommon('active')}</SelectItem>
                  <SelectItem value="inactive">{tCommon('inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </>
          }
        />
      )}

      {/* ── Batches tab ── */}
      {activeTab === 'batches' && (
        <D365Panel
          title={locale === 'ar' ? 'الدفعات النشطة' : 'All Batches'}
          noPadding
          extra={
            <Select value={batchStatusFilter} onValueChange={setBatchStatusFilter}>
              <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                <SelectItem value="active">{tCommon('active')}</SelectItem>
                <SelectItem value="expired">{locale === 'ar' ? 'منتهية' : 'Expired'}</SelectItem>
                <SelectItem value="written_off">{locale === 'ar' ? 'مشطوبة' : 'Written Off'}</SelectItem>
              </SelectContent>
            </Select>
          }
        >
          {loadingBatches ? (
            <p className="p-4 text-sm text-muted-foreground">{locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</p>
          ) : filteredBatches.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{tCommon('noData')}</p>
          ) : (
            <D365Table
              headers={[
                locale === 'ar' ? 'الدواء' : 'Medicine',
                locale === 'ar' ? 'رقم الدفعة' : 'Batch No.',
                locale === 'ar' ? 'المورد' : 'Supplier',
                locale === 'ar' ? 'المستلم' : 'Received',
                locale === 'ar' ? 'المتبقي' : 'Remaining',
                locale === 'ar' ? 'التكلفة' : 'Unit Cost',
                locale === 'ar' ? 'انتهاء الصلاحية' : 'Expiry',
                locale === 'ar' ? 'الحالة' : 'Status',
              ]}
              rows={filteredBatches.map((b) => [
                <span key="m" className="font-medium">{locale === 'ar' ? b.medicine_name_ar : b.medicine_name_en}</span>,
                <span key="bn" className="font-mono text-xs">{b.batch_number}</span>,
                locale === 'ar' ? b.supplier_name_ar : b.supplier_name_en,
                b.qty_received,
                <span key="r" className={b.qty_remaining === 0 ? 'text-destructive font-medium' : ''}>{b.qty_remaining}</span>,
                formatCurrency(parseFloat(b.unit_cost), locale),
                <div key="e" className="flex items-center gap-2">
                  <span className="text-xs">{formatDate(b.expiry_date, locale)}</span>
                  <ExpiryBadge expiryDate={b.expiry_date} />
                </div>,
                <span key="s" className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${
                  b.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' :
                  b.status === 'expired' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}>{b.status}</span>,
              ])}
            />
          )}
        </D365Panel>
      )}

      {/* ── Stock Movement tab ── */}
      {activeTab === 'movement' && (
        <D365Panel
          title={locale === 'ar' ? 'سجل حركة المخزون' : 'Stock Movement Log'}
          noPadding
          extra={
            <Select value={movementTypeFilter} onValueChange={(v) => { setMovementTypeFilter(v); }}>
              <SelectTrigger className="w-36 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                {['IN','OUT','ADJUST','RETURN','WRITE_OFF'].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        >
          {loadingMovements ? (
            <p className="p-4 text-sm text-muted-foreground">{locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</p>
          ) : movements.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{tCommon('noData')}</p>
          ) : (
            <D365Table
              headers={[
                locale === 'ar' ? 'الدواء' : 'Medicine',
                locale === 'ar' ? 'الفرع' : 'Branch',
                locale === 'ar' ? 'النوع' : 'Type',
                locale === 'ar' ? 'الكمية' : 'Qty',
                locale === 'ar' ? 'المرجع' : 'Ref',
                locale === 'ar' ? 'بواسطة' : 'By',
                locale === 'ar' ? 'التاريخ' : 'Date',
              ]}
              rows={movements.map((mv) => {
                const isIn = mv.qty_delta > 0;
                return [
                  <span key="m" className="font-medium">{locale === 'ar' ? mv.medicine_name_ar : mv.medicine_name_en}</span>,
                  <span key="b" className="text-xs text-muted-foreground">{locale === 'ar' ? mv.branch_name_ar : mv.branch_name_en}</span>,
                  <span key="t" className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${MOVEMENT_COLORS[mv.movement_type] ?? ''}`}>
                    {mv.movement_type}
                  </span>,
                  <span key="q" className={isIn ? 'text-emerald-500 font-medium' : 'text-destructive font-medium'}>
                    {isIn ? '+' : ''}{mv.qty_delta}
                  </span>,
                  <span key="r" className="text-xs text-muted-foreground">{mv.reference_type ?? '—'}</span>,
                  <span key="u" className="text-xs">{mv.user_name ?? '—'}</span>,
                  <span key="d" className="text-xs">{mv.created_at.slice(0, 16).replace('T', ' ')}</span>,
                ];
              })}
            />
          )}
        </D365Panel>
      )}
      {/* Hidden file input for CSV import */}
      <input ref={importInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />
    </PageWrapper>
  );
}
