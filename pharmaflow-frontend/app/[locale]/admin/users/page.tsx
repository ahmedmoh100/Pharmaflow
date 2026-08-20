'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/app/i18n/navigation';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { RoleBadge } from '@/components/shared/RoleBadge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { api, type PaginatedResponse } from '@/app/lib/api';
import type { User } from '@/app/lib/types';
import { formatDateTime } from '@/app/lib/utils';
import { Plus, Eye, Pencil, Power, Key, Download } from 'lucide-react';
import { useRouter } from '@/app/i18n/navigation';
import { useToast } from '@/hooks/use-toast';
import { downloadCSV } from '@/app/lib/csv';

export default function AdminUsersPage() {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { toast } = useToast();

  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Reset password dialog state
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    if (roleFilter !== 'all') params.set('role', roleFilter);
    if (statusFilter === 'inactive') params.set('is_active', 'false');
    else if (statusFilter === 'active') params.set('is_active', 'true');
    else params.set('is_active', 'all');
    api.get<PaginatedResponse<User>>(`/users?${params}`)
      .then((res) => setUsers(res.items))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [roleFilter, statusFilter, refreshKey]);

  async function handleResetPassword() {
    if (!resetTarget || !newPassword.trim()) return;
    setResetLoading(true);
    try {
      await api.put(`/users/${resetTarget.id}`, { password: newPassword });
      toast({ title: locale === 'ar' ? 'تم تغيير كلمة المرور' : 'Password reset successfully' });
      setResetTarget(null);
      setNewPassword('');
    } catch {
      toast({ title: locale === 'ar' ? 'حدث خطأ' : 'Error resetting password', variant: 'destructive' });
    } finally {
      setResetLoading(false);
    }
  }

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: t('fullName'),
      render: (u) => <span className="font-medium">{u.full_name}</span>,
    },
    {
      key: 'email',
      header: t('email'),
      render: (u) => u.email,
    },
    {
      key: 'role',
      header: t('role'),
      render: (u) => <RoleBadge role={u.role} />,
    },
    {
      key: 'branch',
      header: locale === 'ar' ? 'الفرع' : 'Branch',
      render: (u) => (u as unknown as { branch_name_ar: string; branch_name_en: string })[locale === 'ar' ? 'branch_name_ar' : 'branch_name_en'] ?? '-',
    },
    {
      key: 'lastLogin',
      header: t('lastLogin'),
      render: (u) => (u.last_login_at ? formatDateTime(u.last_login_at, locale) : '-'),
    },
    {
      key: 'status',
      header: tCommon('status'),
      render: (u) =>
        u.is_active ? (
          <Badge variant="default">{tCommon('active')}</Badge>
        ) : (
          <Badge variant="outline">{tCommon('inactive')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: tCommon('actions'),
      render: (u) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Link href={`/admin/users/${u.id}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8"><Eye className="h-4 w-4" /></Button>
          </Link>
          <Link href={`/admin/users/${u.id}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="h-4 w-4" /></Button>
          </Link>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setResetTarget(u); setNewPassword(''); }}>
            <Key className="h-4 w-4" />
          </Button>
          <ConfirmDialog
            trigger={<Button variant="ghost" size="icon" className="h-8 w-8"><Power className="h-4 w-4" /></Button>}
            title={u.is_active ? t('deactivate') : t('activate')}
            description={u.is_active ? t('deactivateConfirm') : t('activateConfirm')}
            onConfirm={async () => {
              await api.put(`/users/${u.id}`, { is_active: !u.is_active }).catch(() => null);
              setRefreshKey((k) => k + 1);
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <PageWrapper
      title={t('title')}
      tabs={[
        { key: 'users', label: locale === 'ar' ? 'المستخدمون' : 'Users' },
      ]}
      defaultTab="users"
      actions={[
        { label: locale === 'ar' ? 'جديد' : 'New', icon: <Plus style={{ width: '13px', height: '13px' }} />, onClick: () => router.push('/admin/users/new') },
        { label: locale === 'ar' ? 'تصدير' : 'Export', icon: <Download style={{ width: '13px', height: '13px' }} />, separator: true,
          onClick: () => {
            const headers = ['full_name', 'email', 'role', 'branch', 'is_active', 'last_login'];
            const rows = users.map((u) => [
              u.full_name, u.email, u.role,
              (u as unknown as { branch_name_en: string }).branch_name_en ?? '',
              u.is_active ? '1' : '0',
              u.last_login_at ? u.last_login_at.slice(0, 16).replace('T', ' ') : '',
            ]);
            downloadCSV(`users_${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows]);
          },
        },
      ]}
      breadcrumb={[
        { label: locale === 'ar' ? 'الإدارة' : 'Administration' },
        { label: locale === 'ar' ? 'المستخدمون' : 'Users' },
      ]}
    >
      <DataTable
        columns={columns}
        data={users}
        searchPlaceholder={t('searchPlaceholder')}
        rowKey={(u) => u.id}
        emptyTitle={loading ? (locale === 'ar' ? 'جارٍ التحميل...' : 'Loading...') : tCommon('noData')}
        filters={
          <>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder={t('role')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="pharmacist">Pharmacist</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32"><SelectValue placeholder={tCommon('status')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon('all')}</SelectItem>
                <SelectItem value="active">{tCommon('active')}</SelectItem>
                <SelectItem value="inactive">{tCommon('inactive')}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      {/* Reset Password Dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) { setResetTarget(null); setNewPassword(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === 'ar' ? `إعادة تعيين كلمة مرور: ${resetTarget?.full_name}` : `Reset password: ${resetTarget?.full_name}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-password">{locale === 'ar' ? 'كلمة المرور الجديدة' : 'New Password'}</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={locale === 'ar' ? 'أدخل كلمة مرور جديدة' : 'Enter new password'}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetTarget(null); setNewPassword(''); }}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleResetPassword} disabled={!newPassword.trim() || resetLoading}>
              {resetLoading ? tCommon('loading') : (locale === 'ar' ? 'تعيين' : 'Reset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
