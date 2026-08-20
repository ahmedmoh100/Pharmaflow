'use client';

import { useTranslations, useLocale } from 'next-intl';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { PosPageWrapper } from '@/components/shared/PosPageWrapper';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RoleBadge } from '@/components/shared/RoleBadge';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import { useSession } from '@/app/lib/auth';
import { formatDateTime } from '@/app/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ShieldCheck, KeyRound, Globe } from 'lucide-react';

export default function ProfilePage() {
  const t = useTranslations('profile');
  const locale = useLocale() as 'ar' | 'en';
  const { user } = useSession();
  const { toast } = useToast();

  if (!user) return null;

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    toast({ title: t('passwordUpdated') });
  }

  const content = (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {t('accountInfo')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-muted-foreground">{t('fullName')}</Label>
            <p className="font-medium">{user.full_name}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">{t('email')}</Label>
            <p className="font-medium">{user.email}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">{t('phone')}</Label>
            <p className="font-medium">{user.phone}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">{t('role')}</Label>
            <div><RoleBadge role={user.role} /></div>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">{t('lastLogin')}</Label>
            <p className="font-medium">{user.last_login_at ? formatDateTime(user.last_login_at, locale) : '-'}</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-5 w-5 text-primary" />
              {t('changePassword')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current">{t('currentPassword')}</Label>
                <Input id="current" type="password" placeholder="••••••••" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">{t('newPassword')}</Label>
                <Input id="new" type="password" placeholder="••••••••" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{t('confirmPassword')}</Label>
                <Input id="confirm" type="password" placeholder="••••••••" />
              </div>
              <Button type="submit">{t('updatePassword')}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="h-5 w-5 text-primary" />
              {t('languagePreference')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground">{t('currentLanguage')}</Label>
              <p className="font-medium">{locale === 'ar' ? 'العربية' : 'English'}</p>
            </div>
            <LanguageSwitcher />
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // Pharmacist stays in POS shell, admin uses the admin shell
  if (user.role === 'pharmacist') {
    return (
      <PosPageWrapper title={t('title')}>
        {content}
      </PosPageWrapper>
    );
  }

  return (
    <PageWrapper title={t('title')} subtitle={t('subtitle')}>
      {content}
    </PageWrapper>
  );
}

