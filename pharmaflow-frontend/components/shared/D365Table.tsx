'use client';

import type { ReactNode } from 'react';

interface D365TableProps {
  headers: string[];
  rows: ReactNode[][];
  rowKeys?: string[];
  selectedKey?: string | null;
  onRowClick?: (key: string, index: number) => void;
}

/**
 * D365-style dense table — uses shared .d365-th / .d365-td CSS classes from globals.css.
 * Optionally supports row selection via rowKeys + selectedKey + onRowClick.
 */
export function D365Table({ headers, rows, rowKeys, selectedKey, onRowClick }: D365TableProps) {
  return (
    <table className="d365-table">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} className="d365-th">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => {
          const key = rowKeys?.[ri] ?? String(ri);
          const isSelected = selectedKey != null && selectedKey === key;
          return (
            <tr
              key={ri}
              onClick={onRowClick ? () => onRowClick(key, ri) : undefined}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
                background: isSelected ? 'hsl(var(--nav-active))' : undefined,
                borderInlineStart: isSelected ? '3px solid hsl(var(--primary))' : '3px solid transparent',
              }}
              onMouseEnter={(e) => { if (!isSelected && onRowClick) (e.currentTarget as HTMLTableRowElement).style.background = 'hsl(var(--nav-hover))'; }}
              onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
            >
              {row.map((cell, ci) => (
                <td key={ci} className="d365-td">{cell}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
