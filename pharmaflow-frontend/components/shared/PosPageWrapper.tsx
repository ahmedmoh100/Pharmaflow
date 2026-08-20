'use client';

interface PosPageWrapperProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

const S = {
  bg:      'hsl(222 47% 7%)',
  surface: 'hsl(222 47% 10%)',
  border:  'hsl(217 33% 20%)',
  fg:      'hsl(210 40% 98%)',
};

export function PosPageWrapper({ title, children, action }: PosPageWrapperProps) {

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: S.bg, color: S.fg, fontFamily: "'Segoe UI', system-ui, sans-serif", overflow: 'hidden' }}>

      {/* ── Page header bar ── */}
      <div style={{
        height: '48px', flexShrink: 0,
        background: S.surface, borderBottom: `1px solid ${S.border}`,
        display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px',
      }}>
        {/* Page title */}
        <span style={{ fontSize: '13px', fontWeight: 600, color: S.fg }}>{title}</span>

        {/* Optional action slot */}
        {action && <div style={{ marginInlineStart: 'auto' }}>{action}</div>}
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}
        className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}
