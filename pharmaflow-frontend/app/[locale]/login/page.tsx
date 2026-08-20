'use client';

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/app/i18n/navigation';
import { signIn } from '@/app/lib/auth';

const DEMO_PASSWORD = 'Demo@1234';
const DEMO_USERS = [
  { id: 'usr-admin-001', full_name: 'Admin User',       email: 'admin@demo.pharmaflow',  role: 'admin'      as const },
  { id: 'usr-pharm-001', full_name: 'Pharmacist One',   email: 'pharm1@demo.pharmaflow', role: 'pharmacist' as const },
];
import { RoleBadge } from '@/components/shared/RoleBadge';

export default function LoginPage() {
  const t = useTranslations('auth');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const pathname = usePathname();

  const [email, setEmail] = useState('admin@demo.pharmaflow');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [showDemo, setShowDemo] = useState(false);
  const [pwFocus, setPwFocus] = useState(false);
  const [emailFocus, setEmailFocus] = useState(false);

  function handleLocaleToggle() {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = await signIn(email, password);
    if (!result.ok) {
      if (result.reason === 'inactive') setError(t('inactiveAccount'));
      else if (result.reason === 'network') setError(locale === 'ar' ? 'تعذر الاتصال بالخادم' : 'Could not connect to server');
      else setError(t('invalidCredentials'));
      return;
    }
    startTransition(() => {
      const dest = result.user.role === 'admin' ? '/admin/dashboard' : '/pharmacist/dashboard';
      router.replace(dest);
    });
  }

  function handleSelectAccount(accEmail: string) {
    setEmail(accEmail);
    setPassword(DEMO_PASSWORD);
    setError('');
  }

  const inputStyle = (focused: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${focused ? '#0063b1' : '#d0d0d0'}`,
    borderRadius: '4px',
    fontSize: '13px',
    outline: 'none',
    fontFamily: 'inherit',
    color: '#1a1a1a',
    background: '#fff',
    boxSizing: 'border-box',
    transition: 'border-color .15s',
    boxShadow: focused ? '0 0 0 3px rgba(0,99,177,0.12)' : 'none',
  });

  return (
    <div style={{ display: 'flex', position: 'fixed', inset: 0, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── Left panel ── */}
      <div style={{
        width: '42%',
        background: 'linear-gradient(155deg, #0d1424 0%, #1a2038 55%, #243050 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0',
        padding: '48px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />
        {/* Glow accent */}
        <div style={{
          position: 'absolute', top: '-60px', left: '50%', transform: 'translateX(-50%)',
          width: '300px', height: '300px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,99,177,0.18) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Logo */}
        <img
          src="/logo.png"
          alt="PharmaFlow"
          style={{ height: '260px', width: 'auto', objectFit: 'contain', filter: 'brightness(0) invert(1)', pointerEvents: 'none' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />

        {/* Stats strip removed */}
      </div>

      {/* ── Right panel ── */}
      <div style={{
        width: '58%',
        background: 'hsl(var(--card))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}>
        {/* Language toggle — top right */}
        <button
          onClick={handleLocaleToggle}
          style={{
            position: 'absolute', top: '16px', insetInlineEnd: '20px',
            background: 'none', border: '1px solid hsl(var(--border))',
            borderRadius: '4px', padding: '4px 10px',
            fontSize: '12px', fontWeight: 600,
            color: 'hsl(var(--muted-foreground))',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {locale === 'ar' ? 'EN' : 'ع'}
        </button>
        <div style={{ width: '100%', maxWidth: '400px', padding: '40px' }}>

          {/* Header */}
          <div style={{ marginBottom: '32px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'hsl(var(--foreground))', marginBottom: '6px' }}>
              {t('signIn')}
            </h1>
            <p style={{ fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>
              {locale === 'ar' ? 'أدخل بيانات حسابك للمتابعة' : 'Enter your credentials to continue'}
            </p>
          </div>

          <form onSubmit={handleSubmit}>

            {/* Email */}
            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'hsl(var(--foreground))', marginBottom: '6px' }}>
                {t('email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setEmailFocus(true)}
                onBlur={() => setEmailFocus(false)}
                style={inputStyle(emailFocus)}
                placeholder="name@demo.pharmaflow"
                required
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'hsl(var(--foreground))', marginBottom: '6px' }}>
                {t('password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setPwFocus(true)}
                onBlur={() => setPwFocus(false)}
                style={inputStyle(pwFocus)}
                placeholder={locale === 'ar' ? 'أدخل كلمة المرور' : 'Enter your password'}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: '8px 12px', marginBottom: '16px',
                background: 'hsl(var(--tag-red-bg))', color: 'hsl(var(--tag-red-fg))',
                borderRadius: '4px', fontSize: '12px',
                border: '1px solid hsl(var(--tag-red-fg) / 0.2)',
              }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isPending}
              style={{
                width: '100%', padding: '11px',
                background: isPending ? '#4a90c4' : '#0063b1',
                color: '#fff', border: 'none', borderRadius: '4px',
                fontSize: '14px', fontWeight: 600,
                cursor: isPending ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                transition: 'background .15s',
              }}
            >
              {isPending ? (locale === 'ar' ? 'جارٍ الدخول...' : 'Signing in...') : t('signInButton')}
            </button>
          </form>

          {/* Demo credentials */}
          <div style={{ marginTop: '28px', borderTop: '1px solid hsl(var(--border))', paddingTop: '18px' }}>
            <button
              type="button"
              onClick={() => setShowDemo((v) => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '12px', color: '#0063b1', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              <span style={{ fontSize: '10px' }}>{showDemo ? '▲' : '▼'}</span>
              {showDemo
                ? (locale === 'ar' ? 'إخفاء بيانات الدخول التجريبية' : 'Hide demo credentials')
                : (locale === 'ar' ? 'عرض بيانات الدخول التجريبية' : 'Show demo credentials')}
            </button>

            {showDemo && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {DEMO_USERS.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 10px',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '4px',
                      background: 'hsl(var(--background))',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'hsl(var(--foreground))' }}>{u.full_name}</div>
                      <div style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginBottom: '3px' }}>{u.email}</div>
                      <RoleBadge role={u.role} />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectAccount(u.email)}
                      style={{
                        padding: '5px 12px', fontSize: '11px', fontWeight: 600,
                        background: '#0063b1', color: '#fff', border: 'none',
                        borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {locale === 'ar' ? 'استخدام' : 'Use'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
