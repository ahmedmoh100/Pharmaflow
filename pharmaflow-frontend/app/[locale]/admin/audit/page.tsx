'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { formatDateTime } from '@/app/lib/utils';
import { D365Panel } from '@/components/shared/D365Panel';
import { D365Table } from '@/components/shared/D365Table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api, type PaginatedResponse } from '@/app/lib/api';
import { Download } from 'lucide-react';
import { downloadCSV } from '@/app/lib/csv';
import { useBranch } from '@/app/context/BranchContext';

const ACTION_STYLES: Record<string, string> = {
  CREATE:         'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  UPDATE:         'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  DELETE:         'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  LOGIN:          'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  ADJUST:         'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  RESET_PASSWORD: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
};

interface AuditEntry {
  id: string;
  user_name?: string;
  user_id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
}

export default function AuditPage() {
  const locale = useLocale() as 'ar' | 'en';

  const [entityFilter, setEntityFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { branchId } = useBranch();

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: '1', page_size: '200' });
    if (entityFilter !== 'all') params.set('entity', entityFilter);
    if (actionFilter !== 'all') params.set('action', actionFilter);
    // Audit log is global for admins — no branch filter
    api.get<PaginatedResponse<AuditEntry>>(`/audit?${params}`)
      .then((res) => setEntries(res.items))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [entityFilter, actionFilter]);

  const filtered = entries;

  const ENTITIES = ['user', 'medicine', 'supplier', 'purchase', 'transfer', 'sale_return', 'stock_count', 'coupon'];
  const ACTIONS  = ['LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'ADJUST', 'RESET_PASSWORD'];

  return (
    <PageWrapper
      title={locale === 'ar' ? 'سجل المراجعة' : 'Audit Log'}
      actions={[
        { label: locale === 'ar' ? 'تصدير' : 'Export', icon: <Download style={{ width: '13px', height: '13px' }} />,
          onClick: () => {
            const headers = ['datetime', 'user', 'action', 'entity', 'entity_id'];
            const rows = filtered.map((e) => [
              e.created_at.slice(0, 16).replace('T', ' '),
              e.user_name ?? e.user_id,
              e.action, e.entity,
              e.entity_id ?? '',
            ]);
            downloadCSV(`audit_log_${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows]);
          },
        },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الإدارة' : 'Administration' },
        { label: locale === 'ar' ? 'سجل المراجعة' : 'Audit Log' },
      ]}
    >
      <D365Panel
        title={`${locale === 'ar' ? 'سجل المراجعة' : 'Audit Log'}${filtered.length > 0 ? ` (${filtered.length})` : ''}`}
        noPadding
        extra={
          <div className="flex items-center gap-2">
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-32 h-7 text-xs">
                <SelectValue placeholder={locale === 'ar' ? 'الكيان' : 'Entity'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'ar' ? 'الكل' : 'All'}</SelectItem>
                {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-36 h-7 text-xs">
                <SelectValue placeholder={locale === 'ar' ? 'الإجراء' : 'Action'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'ar' ? 'الكل' : 'All'}</SelectItem>
                {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {loading ? (
          <div className="p-4 text-sm text-muted-foreground">
            {locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {locale === 'ar' ? 'لا توجد إدخالات.' : 'No entries found.'}
          </div>
        ) : (
          <D365Table
            headers={[
              locale === 'ar' ? 'التاريخ والوقت' : 'Date / Time',
              locale === 'ar' ? 'المستخدم' : 'User',
              locale === 'ar' ? 'الإجراء' : 'Action',
              locale === 'ar' ? 'الكيان' : 'Entity',
              locale === 'ar' ? 'المعرّف' : 'Entity ID',
            ]}
            rows={filtered.map((e) => [
              <span key={e.id} className="font-mono text-xs whitespace-nowrap">
                {formatDateTime(e.created_at, locale)}
              </span>,
              <span key="u" className="text-xs">{e.user_name ?? e.user_id}</span>,
              <span key="a" className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${ACTION_STYLES[e.action] ?? 'bg-muted text-muted-foreground'}`}>
                {e.action}
              </span>,
              <span key="en" className="text-xs">{e.entity}</span>,
              <span key="eid" className="font-mono text-xs text-muted-foreground">{e.entity_id ?? '—'}</span>,
            ])}
          />
        )}
      </D365Panel>
    </PageWrapper>
  );
}
