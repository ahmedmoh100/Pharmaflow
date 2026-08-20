'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/app/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { api, type PaginatedResponse } from '@/app/lib/api';
import type { User } from '@/app/lib/types';
import { Save } from 'lucide-react';

interface ApiBranch { id: string; name_en: string; name_ar: string; }

interface UserFormProps {
  initial?: User;
}

export function UserForm({ initial }: UserFormProps) {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<ApiBranch[]>([]);

  useEffect(() => {
    api.get<PaginatedResponse<ApiBranch>>('/branches?is_active=true&page_size=100')
      .then((res) => setBranches(res.items))
      .catch(() => null);
  }, []);

  const [form, setForm] = useState({
    full_name: initial?.full_name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    role: initial?.role ?? 'pharmacist',
    branch_id: (initial as User & { branch_id?: string })?.branch_id ?? '',
    password: '',
    is_active: initial?.is_active ?? true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.full_name.trim()) e.full_name = tCommon('required');
    if (!form.email.trim()) e.email = tCommon('required');
    if (!form.branch_id) e.branch_id = tCommon('required');
    if (!initial && !form.password.trim()) e.password = tCommon('required');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    void (async () => {
      setLoading(true);
      try {
        const payload: Record<string, unknown> = {
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          role: form.role,
          branch_id: form.branch_id,
          is_active: form.is_active,
        };
        if (form.password) payload.password = form.password;
        if (!initial?.id) payload.password = form.password;

        if (initial?.id) {
          await api.put(`/users/${initial.id}`, payload);
        } else {
          await api.post('/users', payload);
        }
        toast({ title: t('savedSuccessfully') });
        router.replace('/admin/users');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        toast({
          title: locale === 'ar' ? 'حدث خطأ' : 'Error saving user',
          description: msg || undefined,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    })();
  }

  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="full_name">{t('fullName')} *</Label>
              <Input id="full_name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              {errors.full_name && <p className="text-sm text-destructive">{errors.full_name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')} *</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                disabled={!!initial?.id} />
              {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
              {initial?.id && <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'البريد الإلكتروني لا يمكن تغييره' : 'Email cannot be changed'}</p>}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">{t('phone')}</Label>
              <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">{t('role')} *</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as 'admin' | 'pharmacist' })}>
                <SelectTrigger><SelectValue placeholder={t('role')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="pharmacist">Pharmacist</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="branch_id">{locale === 'ar' ? 'الفرع' : 'Branch'} *</Label>
            <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
              <SelectTrigger><SelectValue placeholder={locale === 'ar' ? 'اختر الفرع' : 'Select branch'} /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {locale === 'ar' ? b.name_ar : b.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.branch_id && <p className="text-sm text-destructive">{errors.branch_id}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">
              {initial?.id
                ? (locale === 'ar' ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)' : 'New password (leave blank to keep current)')
                : `${t('password')} *`}
            </Label>
            <Input id="password" type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
            {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
          </div>

          <div className="flex items-center gap-3">
            <Switch id="is_active" checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            <Label htmlFor="is_active">{t('isActive')}</Label>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.replace('/admin/users')}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={loading} className="gap-2">
              {loading ? tCommon('loading') : (<><Save className="h-4 w-4" />{tCommon('save')}</>)}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
