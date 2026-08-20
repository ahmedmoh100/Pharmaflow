'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/app/i18n/navigation';
import { useSession } from '@/app/lib/auth';
import { LoadingState } from '@/components/shared/LoadingState';
import { Topbar } from '@/components/layout/Topbar';
import { NavTree } from '@/components/layout/NavTree';
import { PropsPanel } from '@/components/layout/PropsPanel';
import { BranchProvider } from '@/app/context/BranchContext';
import type { UserRole } from '@/app/lib/types';
import { useLocale } from 'next-intl';

// Roles that have access to the admin-side shell
const ADMIN_SIDE_ROLES: UserRole[] = ['admin'];

interface AppShellProps {
  role: UserRole;
  children: React.ReactNode;
}

export function AppShell({ role, children }: AppShellProps) {
  const { user, ready } = useSession();
  const router = useRouter();
  const locale = useLocale() as 'ar' | 'en';

  const [navCollapsed, setNavCollapsed] = useState(false);
  const [propsHidden, setPropsHidden] = useState(true);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace('/login');
    } else if (user.role !== 'admin') {
      router.replace('/unauthorized');
    }
  }, [user, ready, role, router]);

  if (!ready || !user || user.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <LoadingState />
      </div>
    );
  }

  const branchName = locale === 'ar'
    ? (user.branch_name_ar || undefined)
    : (user.branch_name_en || undefined);

  return (
    <BranchProvider>
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top bar — always dark navy, full width */}
      <Topbar
        user={user}
        onNavToggle={() => setNavCollapsed((v) => !v)}
        onPropsToggle={() => setPropsHidden((v) => !v)}
        branchName={branchName}
      />

      {/* Three-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* P1 — Nav tree */}
        <NavTree role={role} collapsed={navCollapsed} />

        {/* P2 — Workspace */}
        <main className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0">
          {children}
        </main>

        {/* P3 — Properties panel */}
        <PropsPanel hidden={propsHidden} />
      </div>
    </div>
    </BranchProvider>
  );
}
