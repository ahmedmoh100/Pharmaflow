'use client';

import { cn } from '@/lib/utils';
import { Shield, Pill } from 'lucide-react';
import type { UserRole } from '@/app/lib/types';

interface RoleBadgeProps {
  role: UserRole;
  className?: string;
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  const isAdmin = role === 'admin';
  const Icon = isAdmin ? Shield : Pill;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        isAdmin
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-secondary text-secondary-foreground border-border',
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {isAdmin ? 'Admin' : 'Pharmacist'}
    </span>
  );
}
