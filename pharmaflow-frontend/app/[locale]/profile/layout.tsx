'use client';

import { useSession } from '@/app/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { PosShell } from '@/components/layout/PosShell';
import { LoadingState } from '@/components/shared/LoadingState';

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useSession();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <LoadingState />
      </div>
    );
  }

  if (user?.role === 'pharmacist') {
    return <PosShell>{children}</PosShell>;
  }

  return <AppShell role={user?.role ?? 'admin'}>{children}</AppShell>;
}
