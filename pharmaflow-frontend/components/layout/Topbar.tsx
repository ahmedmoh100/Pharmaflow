'use client';

import { useTransition, useState, useRef, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { useRouter, usePathname, Link } from '@/app/i18n/navigation';
import { signOut, type SessionUser } from '@/app/lib/auth';
import { Menu, Search, MapPin, Bell, Settings, LogOut, User, AlertTriangle, Clock, ChevronDown } from 'lucide-react';
import { api, type ApiDashboardSummary } from '@/app/lib/api';
import { useBranch } from '@/app/context/BranchContext';

interface TopbarProps {
  user: SessionUser;
  onNavToggle: () => void;
  onPropsToggle: () => void;
  branchName?: string;
}

interface ApiBranch {
  id: string;
  name_en: string;
  name_ar: string;
  city_en: string;
  city_ar: string;
  is_active: boolean;
}

export function Topbar({ user, onNavToggle, onPropsToggle, branchName }: TopbarProps) {
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<ApiBranch[]>([]);
  const avatarRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);

  const { branchId, branchNameEn, branchNameAr, setBranch } = useBranch();

  const basePath = user.role === 'admin' ? '/admin' : '/pharmacist';

  const [totalAlerts, setTotalAlerts] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [expiringCount, setExpiringCount] = useState(0);

  useEffect(() => {
    const branchParam = branchId ? `?branch_id=${branchId}` : '';
    api.get<ApiDashboardSummary>(`/dashboard/summary${branchParam}`)
      .then((s) => {
        setLowStockCount(s.low_stock_count);
        setExpiringCount(s.expiring_90_count);
        setTotalAlerts(s.low_stock_count + s.expiring_90_count);
      })
      .catch(() => null);
  }, [branchId]);

  // Load branch list for admin picker
  useEffect(() => {
    if (user.role !== 'admin') return;
    api.get<{ items: ApiBranch[] }>('/branches?page_size=50')
      .then((res) => setBranches(res.items.filter((b) => b.is_active)))
      .catch(() => null);
  }, [user.role]);

  const initials = user.full_name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  function handleSignOut() {
    signOut();
    router.replace('/login');
  }

  function handleLocaleToggle() {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) setBranchOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const muted = 'hsl(var(--topbar-muted))';

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    insetInlineEnd: 0,
    marginTop: '4px',
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
    zIndex: 100,
    borderRadius: '6px',
    overflow: 'hidden',
  };

  // Display name for currently selected branch
  const selectedBranchName = branchId
    ? (locale === 'ar' ? branchNameAr : branchNameEn) || branchId
    : (locale === 'ar' ? 'اختر الفرع' : 'Select Branch');

  return (
    <header className="topbar-fixed flex shrink-0 items-center z-50 gap-1" style={{ height: '48px' }}>

      {/* Hamburger */}
      <button onClick={onNavToggle} className="flex h-full w-12 items-center justify-center shrink-0 hover:bg-white/10 transition-colors" style={{ color: muted, background: 'none', border: 'none', cursor: 'pointer' }}>
        <Menu style={{ width: '18px', height: '18px' }} />
      </button>

      {/* Logo */}
      <img
        src="/logo.png"
        alt="PharmaFlow"
        className="logo-dark-surface shrink-0"
        style={{ height: '52px', width: 'auto', objectFit: 'contain' }}
      />

      {/* Search */}
      <div className="relative ms-3" style={{ flex: 1, minWidth: '160px', maxWidth: '320px' }}>
        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ width: '12px', height: '12px', color: muted }} />
        <input
          type="text"
          placeholder={locale === 'ar' ? 'ابحث...' : 'Search...'}
          className="w-full ps-7 pe-3 py-1.5 text-xs outline-none font-[inherit] rounded"
          style={{ background: 'var(--topbar-input-bg)', border: '1px solid var(--topbar-input-border)', color: 'hsl(var(--topbar-foreground))' }}
        />
      </div>

      <div className="flex-1" />

      {/* Right cluster */}
      <div className="flex items-center gap-0.5 pe-4 shrink-0">

        {/* Branch picker — admin only */}
        {user.role === 'admin' ? (
          <div ref={branchRef} className="relative hidden md:block">
            <button
              onClick={() => { setBranchOpen((v) => !v); setAvatarOpen(false); setBellOpen(false); }}
              className="flex items-center gap-1 px-2 h-8 text-xs rounded hover:bg-white/10 transition-colors"
              style={{ color: muted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <MapPin style={{ width: '12px', height: '12px' }} />
              <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedBranchName}
              </span>
              <ChevronDown style={{ width: '11px', height: '11px', opacity: 0.6 }} />
            </button>

            {branchOpen && (
              <div style={{ ...dropdownStyle, minWidth: '220px', insetInlineEnd: 'auto', insetInlineStart: 0 }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid hsl(var(--border))', fontSize: '11px', color: 'hsl(var(--muted-foreground))', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {locale === 'ar' ? 'الفروع' : 'Branches'}
                </div>
                {branches.map((b) => {
                  const name = locale === 'ar' ? b.name_ar : b.name_en;
                  const city = locale === 'ar' ? b.city_ar : b.city_en;
                  const isSelected = b.id === branchId;
                  return (
                    <button
                      key={b.id}
                      onClick={() => { setBranch(b.id, b.name_en, b.name_ar); setBranchOpen(false); }}
                      className="flex items-center justify-between w-full px-3 py-2 text-xs hover:bg-nav-hover transition-colors"
                      style={{
                        background: isSelected ? 'hsl(var(--nav-active))' : 'none',
                        color: isSelected ? 'hsl(var(--nav-active-foreground))' : 'hsl(var(--foreground))',
                        border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: isSelected ? 600 : 400 }}>{name}</div>
                        <div style={{ fontSize: '10px', color: 'hsl(var(--muted-foreground))', marginTop: '1px' }}>{city}</div>
                      </div>
                      {isSelected && <span style={{ fontSize: '10px', color: 'hsl(var(--primary))' }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-1 px-2 h-8 text-xs rounded" style={{ color: muted }}>
            <MapPin style={{ width: '12px', height: '12px' }} />
            <span>{branchName ?? (locale === 'ar' ? 'الفرع الرئيسي' : 'Main Branch')}</span>
          </div>
        )}

        {/* Bell */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => { setBellOpen((v) => !v); setAvatarOpen(false); }}
            className="relative flex h-8 w-8 items-center justify-center rounded hover:bg-white/10 transition-colors"
            style={{ color: muted, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <Bell style={{ width: '15px', height: '15px' }} />
            {totalAlerts > 0 && (
              <span className="absolute flex items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ top: '4px', right: '4px', minWidth: '14px', height: '14px', padding: '0 3px', background: 'hsl(var(--destructive))' }}>
                {totalAlerts}
              </span>
            )}
          </button>

          {bellOpen && (
            <div style={{ ...dropdownStyle, width: '300px' }}>
              {/* Header */}
              <div style={{ padding: '10px 14px', borderBottom: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'hsl(var(--foreground))' }}>
                  {locale === 'ar' ? 'التنبيهات' : 'Alerts'}
                </span>
                <span style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>
                  {totalAlerts} {locale === 'ar' ? 'تنبيه' : 'alerts'}
                </span>
              </div>

              {/* Low stock items */}
              {lowStockCount > 0 && (
                <Link
                  href={`${basePath}/alerts`}
                  onClick={() => setBellOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderBottom: '1px solid hsl(var(--border))', textDecoration: 'none' }}
                  className="hover:bg-nav-hover transition-colors"
                >
                  <AlertTriangle style={{ width: '13px', height: '13px', color: 'hsl(var(--warning))', flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: '12px', color: 'hsl(var(--foreground))', fontWeight: 500 }}>
                      {locale === 'ar' ? 'مخزون منخفض' : 'Low Stock'}
                    </p>
                    <p style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>
                      {lowStockCount} {locale === 'ar' ? 'دواء تحت الحد الأدنى' : 'medicines below threshold'}
                    </p>
                  </div>
                </Link>
              )}

              {/* Expiring items */}
              {expiringCount > 0 && (
                <Link
                  href={`${basePath}/alerts`}
                  onClick={() => setBellOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderBottom: '1px solid hsl(var(--border))', textDecoration: 'none' }}
                  className="hover:bg-nav-hover transition-colors"
                >
                  <Clock style={{ width: '13px', height: '13px', color: 'hsl(var(--destructive))', flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: '12px', color: 'hsl(var(--foreground))', fontWeight: 500 }}>
                      {locale === 'ar' ? 'قاربت الانتهاء' : 'Expiring Soon'}
                    </p>
                    <p style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>
                      {expiringCount} {locale === 'ar' ? 'دفعة خلال 90 يوماً' : 'batches within 90 days'}
                    </p>
                  </div>
                </Link>
              )}
              {/* Footer */}
              <Link
                href={`${basePath}/alerts`}
                onClick={() => setBellOpen(false)}
                style={{ display: 'block', padding: '9px 14px', fontSize: '12px', fontWeight: 600, color: 'hsl(var(--primary))', textDecoration: 'none', textAlign: 'center' }}
                className="hover:bg-nav-hover transition-colors"
              >
                {locale === 'ar' ? 'عرض كل التنبيهات' : 'View all alerts'}
              </Link>
            </div>
          )}
        </div>

        {/* Settings */}
        <Link href={`${basePath}/settings`}>
          <button className="flex h-8 w-8 items-center justify-center rounded hover:bg-white/10 transition-colors" style={{ color: muted, background: 'none', border: 'none', cursor: 'pointer' }}>
            <Settings style={{ width: '15px', height: '15px' }} />
          </button>
        </Link>

        {/* Language toggle */}
        <button
          onClick={handleLocaleToggle}
          className="flex h-8 w-8 items-center justify-center rounded hover:bg-white/10 transition-colors text-xs font-semibold"
          style={{ color: muted, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {locale === 'ar' ? 'EN' : 'ع'}
        </button>

        {/* Divider */}
        <div className="w-px h-5 mx-2 opacity-20" style={{ background: 'hsl(var(--topbar-foreground))' }} />

        {/* Avatar dropdown */}
        <div ref={avatarRef} className="relative">
          <button
            onClick={() => { setAvatarOpen((v) => !v); setBellOpen(false); }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shrink-0 bg-primary text-primary-foreground"
            title={user.full_name}
          >
            {initials}
          </button>

          {avatarOpen && (
            <div style={{ ...dropdownStyle, minWidth: '180px' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid hsl(var(--border))' }}>
                <p style={{ fontSize: '12px', fontWeight: 600, color: 'hsl(var(--foreground))' }}>{user.full_name}</p>
                <p style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '2px' }}>{user.email}</p>
              </div>
              <Link
                href="/profile"
                onClick={() => setAvatarOpen(false)}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-nav-hover transition-colors"
                style={{ color: 'hsl(var(--foreground))', textDecoration: 'none' }}
              >
                <User style={{ width: '13px', height: '13px', color: 'hsl(var(--muted-foreground))' }} />
                {locale === 'ar' ? 'الملف الشخصي' : 'My Profile'}
              </Link>
              <div style={{ height: '1px', background: 'hsl(var(--border))' }} />
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-nav-hover transition-colors"
                style={{ color: 'hsl(var(--destructive))', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <LogOut style={{ width: '13px', height: '13px' }} />
                {locale === 'ar' ? 'تسجيل الخروج' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
