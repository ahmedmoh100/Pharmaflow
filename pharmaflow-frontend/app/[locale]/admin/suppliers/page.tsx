'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/app/i18n/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { Supplier } from '@/app/lib/types';
import { api, type PaginatedResponse } from '@/app/lib/api';
import { Plus, Eye, Pencil, Power, Download } from 'lucide-react';
import { useRouter } from '@/app/i18n/navigation';
import { downloadCSV } from '@/app/lib/csv';

export default function AdminSuppliersPage() {
  const t = useTranslations('suppliers');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();

  const [activeTab, setActiveTab] = useState('suppliers');
  const [statusFilter, setStatusFilter] = useState('all');

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    if (statusFilter === 'inactive') params.set('is_active', 'false');
    else if (statusFilter === 'active') params.set('is_active', 'true');
    else params.set('is_active', 'all');
    api.get<PaginatedResponse<Supplier>>(`/suppliers?${params}`)
      .then((res) => setSuppliers(res.items))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [statusFilter, refreshKey]);

  const filtered = suppliers;

  const supplierTypeLabel = (type: string) => {
    const labels: Record<string, { en: string; ar: string }> = {
      distributor: { en: 'Distributor', ar: 'موزع' },
      manufacturer: { en: 'Manufacturer', ar: 'مصنّع' },
      wholesaler: { en: 'Wholesaler', ar: 'تاجر جملة' },
    };
    return locale === 'ar' ? (labels[type]?.ar ?? type) : (labels[type]?.en ?? type);
  };

  const columns: Column<Supplier>[] = [
    {
      key: 'name',
      header: tCommon('name'),
      render: (s) => (
        <div>
          <p className="font-medium">{locale === 'ar' ? s.name_ar : s.name_en}</p>
          <p className="text-xs text-muted-foreground">{locale === 'ar' ? s.name_en : s.name_ar}</p>
        </div>
      ),
    },
    {
      key: 'supplierType',
      header: t('supplierType'),
      render: (s) => (
        <Badge variant="outline" className="text-xs">{supplierTypeLabel(s.supplier_type)}</Badge>
      ),
    },
    {
      key: 'taxNumber',
      header: t('taxNumber'),
      render: (s) => <span className="font-mono text-xs">{s.tax_number}</span>,
    },
    {
      key: 'status',
      header: tCommon('status'),
      render: (s) =>
        s.is_active ? (
          <Badge variant="default">{tCommon('active')}</Badge>
        ) : (
          <Badge variant="outline">{tCommon('inactive')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: tCommon('actions'),
      render: (s) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Link href={`/admin/suppliers/${s.id}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8"><Eye className="h-4 w-4" /></Button>
          </Link>
          <Link href={`/admin/suppliers/${s.id}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="h-4 w-4" /></Button>
          </Link>
          <ConfirmDialog
            trigger={<Button variant="ghost" size="icon" className="h-8 w-8"><Power className="h-4 w-4" /></Button>}
            title={s.is_active ? t('deactivate') : t('activate')}
            description={s.is_active ? t('deactivateConfirm') : t('activateConfirm')}
            onConfirm={async () => {
              await api.put(`/suppliers/${s.id}`, { is_active: !s.is_active }).catch(() => null);
              setRefreshKey((k) => k + 1);
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <PageWrapper
      title={t('title')}
      tabs={[
        { key: 'suppliers', label: locale === 'ar' ? 'الموردون' : 'Suppliers' },
        { key: 'contacts', label: locale === 'ar' ? 'جهات الاتصال' : 'Contacts' },
      ]}
      defaultTab="suppliers"
      onTabChange={setActiveTab}
      actions={[
        { label: locale === 'ar' ? 'جديد' : 'New', icon: <Plus style={{ width: '13px', height: '13px' }} />, onClick: () => router.push('/admin/suppliers/new') },
        { label: locale === 'ar' ? 'تصدير' : 'Export', icon: <Download style={{ width: '13px', height: '13px' }} />, separator: true,
          onClick: () => {
            const today = new Date().toISOString().slice(0, 10);
            if (activeTab === 'suppliers') {
              const headers = ['name_en', 'name_ar', 'supplier_type', 'tax_number', 'contact_person', 'phone', 'email', 'address', 'is_active'];
              const rows = filtered.map((s) => [
                s.name_en, s.name_ar, s.supplier_type ?? '',
                s.tax_number ?? '', s.contact_person ?? '',
                s.phone ?? '', s.email ?? '', s.address ?? '',
                s.is_active ? '1' : '0',
              ]);
              downloadCSV(`suppliers_${today}.csv`, [headers, ...rows]);
            } else {
              // contacts tab
              const headers = ['supplier_en', 'supplier_ar', 'contact_person', 'phone', 'email', 'address'];
              const rows = suppliers.map((s) => [
                s.name_en, s.name_ar,
                s.contact_person ?? '', s.phone ?? '',
                s.email ?? '', s.address ?? '',
              ]);
              downloadCSV(`supplier_contacts_${today}.csv`, [headers, ...rows]);
            }
          },
        },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الموردون' : 'Suppliers' },
      ]}
    >
      {/* ── Suppliers tab ── */}
      {activeTab === 'suppliers' && (
        <DataTable
          columns={columns}
          data={filtered}
          searchPlaceholder={t('searchPlaceholder')}
          rowKey={(s) => s.id}
          emptyTitle={loading ? (locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...') : tCommon('noData')}
          filters={
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder={tCommon('status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                <SelectItem value="active">{tCommon('active')}</SelectItem>
                <SelectItem value="inactive">{tCommon('inactive')}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      )}

      {/* ── Contacts tab ── */}
      {activeTab === 'contacts' && (
        <D365Panel
          title={locale === 'ar' ? 'جهات اتصال الموردين' : 'Supplier Contacts'}
          noPadding
        >
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">{locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</p>
          ) : suppliers.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{tCommon('noData')}</p>
          ) : (
            <D365Table
              headers={[
                locale === 'ar' ? 'المورد' : 'Supplier',
                locale === 'ar' ? 'جهة الاتصال' : 'Contact Person',
                locale === 'ar' ? 'الهاتف' : 'Phone',
                locale === 'ar' ? 'البريد الإلكتروني' : 'Email',
                locale === 'ar' ? 'العنوان' : 'Address',
              ]}
              rows={suppliers.map((s) => [
                <div key="n">
                  <p className="font-medium text-sm">{locale === 'ar' ? s.name_ar : s.name_en}</p>
                  <p className="text-xs text-muted-foreground">{locale === 'ar' ? s.name_en : s.name_ar}</p>
                </div>,
                s.contact_person || <span key="cp" className="text-muted-foreground">—</span>,
                s.phone || <span key="ph" className="text-muted-foreground">—</span>,
                s.email || <span key="em" className="text-muted-foreground">—</span>,
                <span key="ad" className="text-xs text-muted-foreground">{s.address || '—'}</span>,
              ])}
            />
          )}
        </D365Panel>
      )}
    </PageWrapper>
  );
}
