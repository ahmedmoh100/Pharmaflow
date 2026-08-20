'use client';

import { useState, useMemo, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  pageSize?: number;
  filters?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Enable checkbox multi-select. onSelectionChange receives selected keys. */
  multiSelect?: boolean;
  onSelectionChange?: (keys: string[]) => void;
}

export function DataTable<T>({
  columns,
  data,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  pageSize = 10,
  filters,
  emptyTitle,
  emptyDescription,
  rowKey,
  onRowClick,
  multiSelect = false,
  onSelectionChange,
}: DataTableProps<T>) {
  const t = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [page, setPage] = useState(1);
  const [internalSearch, setInternalSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const search = searchValue ?? internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;

  const filtered = useMemo(() => {
    if (!search) return data;
    const lower = search.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const cell = col.render(row);
        if (typeof cell === 'string' || typeof cell === 'number') {
          return String(cell).toLowerCase().includes(lower);
        }
        return false;
      })
    );
  }, [data, search, columns]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageData = filtered.slice(start, start + pageSize);

  /* ── D365 table styles — shared via globals.css ── */
  const thAlignStyle: React.CSSProperties = {
    textAlign: locale === 'ar' ? 'right' : 'left',
  };

  return (
    <div>
      {/* Toolbar — search + filters */}
      {(searchPlaceholder !== undefined || filters) && (
        <div style={{
          padding: '7px 12px',
          background: 'hsl(var(--card))',
          borderBottom: '1px solid hsl(var(--border))',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}>
          {searchPlaceholder !== undefined && (
            <div style={{ position: 'relative' }}>
              <Search style={{ position: 'absolute', insetInlineStart: '7px', top: '50%', transform: 'translateY(-50%)', width: '12px', height: '12px', color: 'hsl(var(--muted-foreground))', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{
                  border: '1px solid hsl(var(--border))',
                  padding: '5px 8px 5px 24px',
                  fontSize: '12px',
                  outline: 'none',
                  width: '200px',
                  fontFamily: 'inherit',
                  color: 'hsl(var(--foreground))',
                  background: 'hsl(var(--card))',
                }}
              />
            </div>
          )}
          {filters && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginInlineStart: 'auto' }}>{filters}</div>}
        </div>
      )}

      {/* Table */}
      <div>
        <table className="d365-table">
          <thead>
            <tr>
              {/* Select column header */}
              <th className="d365-th" style={{ ...thAlignStyle, width: '32px', minWidth: '32px' }}>
                {multiSelect && (
                  <input
                    type="checkbox"
                    style={{ accentColor: 'hsl(var(--primary))' }}
                    checked={pageData.length > 0 && pageData.every((r) => selectedKeys.has(rowKey(r)))}
                    ref={(el) => {
                      if (el) el.indeterminate = pageData.some((r) => selectedKeys.has(rowKey(r))) && !pageData.every((r) => selectedKeys.has(rowKey(r)));
                    }}
                    onChange={(e) => {
                      const next = new Set(selectedKeys);
                      if (e.target.checked) {
                        pageData.forEach((r) => next.add(rowKey(r)));
                      } else {
                        pageData.forEach((r) => next.delete(rowKey(r)));
                      }
                      setSelectedKeys(next);
                      onSelectionChange?.(Array.from(next));
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </th>
              {columns.map((col) => (
                <th key={col.key} className={cn('d365-th', col.className)} style={thAlignStyle}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} style={{ padding: 0 }}>
                  <EmptyState title={emptyTitle ?? t('noData')} description={emptyDescription} />
                </td>
              </tr>
            ) : (
              pageData.map((row) => {
                const key = rowKey(row);
                const isSelected = multiSelect ? selectedKeys.has(key) : selectedKey === key;
                return (
                  <tr
                    key={key}
                    onClick={() => {
                      if (multiSelect) {
                        const next = new Set(selectedKeys);
                        if (next.has(key)) { next.delete(key); } else { next.add(key); }
                        setSelectedKeys(next);
                        onSelectionChange?.(Array.from(next));
                      } else {
                        setSelectedKey(key);
                      }
                      onRowClick?.(row);
                    }}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'hsl(var(--nav-active))' : undefined,
                      borderInlineStart: isSelected ? `var(--border-width-selection, 3px) solid hsl(var(--primary))` : '3px solid transparent',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = 'hsl(var(--nav-hover))'; }}
                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
                  >
                    {/* Select cell */}
                    <td className="d365-td" style={{ width: '32px', textAlign: 'center' }}>
                      {multiSelect ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          onClick={(e) => e.stopPropagation()}
                          style={{ accentColor: 'hsl(var(--primary))' }}
                        />
                      ) : (
                        <input
                          type="radio"
                          name="dt-select"
                          checked={isSelected}
                          onChange={() => { setSelectedKey(key); onRowClick?.(row); }}
                          onClick={(e) => e.stopPropagation()}
                          style={{ accentColor: 'hsl(var(--primary))' }}
                        />
                      )}
                    </td>
                    {columns.map((col) => (
                      <td key={col.key} className={cn('d365-td', col.className)}>
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer — count + pagination */}
      <div style={{
        padding: '7px 12px',
        borderTop: '1px solid hsl(var(--border))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: 'hsl(var(--muted-foreground))',
      }}>
        <span>{start + 1}–{Math.min(start + pageSize, filtered.length)} {locale === 'ar' ? `من ${filtered.length}` : `of ${filtered.length}`}</span>

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: '3px' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={{ padding: '3px 8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: '11px', fontFamily: 'inherit', cursor: currentPage === 1 ? 'default' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1 }}
            >
              {t('previous')}
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                style={{
                  padding: '3px 8px',
                  border: '1px solid hsl(var(--border))',
                  background: currentPage === p ? 'hsl(var(--primary))' : 'hsl(var(--card))',
                  color: currentPage === p ? 'hsl(var(--primary-foreground))' : 'inherit',
                  fontSize: '11px',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              style={{ padding: '3px 8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: '11px', fontFamily: 'inherit', cursor: currentPage === totalPages ? 'default' : 'pointer', opacity: currentPage === totalPages ? 0.5 : 1 }}
            >
              {t('next')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
