'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { Button } from '@/components/ui/button';
import { ShieldX } from 'lucide-react';
import { useSession } from '@/app/lib/auth';

export default function UnauthorizedPage() {
  const t = useTranslations('unauthorized');
  const router = useRouter();
  const { user } = useSession();

  function handleBack() {
    const dashboard = user?.role === 'pharmacist' ? '/pharmacist/dashboard' : '/admin/dashboard';
    router.replace(dashboard);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <ShieldX className="h-8 w-8 text-destructive" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('message')}</p>
      </div>
      <Button onClick={handleBack}>
        {t('backToDashboard')}
      </Button>
    </div>
  );
}
