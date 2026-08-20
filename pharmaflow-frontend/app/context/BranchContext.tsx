'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { readSession } from '@/app/lib/auth';

interface BranchContextValue {
  branchId: string;
  branchNameEn: string;
  branchNameAr: string;
  setBranch: (id: string, nameEn: string, nameAr: string) => void;
}

const STORAGE_KEY = 'pharmaflow.selected_branch';

const BranchContext = createContext<BranchContextValue>({
  branchId: '',
  branchNameEn: '',
  branchNameAr: '',
  setBranch: () => {},
});

export function BranchProvider({ children }: { children: ReactNode }) {
  const getInitial = () => {
    if (typeof window === 'undefined') return { id: '', nameEn: '', nameAr: '' };
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { return JSON.parse(stored); } catch { /* fall through */ }
    }
    const session = readSession();
    return {
      id: session?.branch_id ?? '',
      nameEn: session?.branch_name_en ?? '',
      nameAr: session?.branch_name_ar ?? '',
    };
  };

  const initial = getInitial();
  const [branchId, setBranchId] = useState(initial.id);
  const [branchNameEn, setBranchNameEn] = useState(initial.nameEn);
  const [branchNameAr, setBranchNameAr] = useState(initial.nameAr);

  function setBranch(id: string, nameEn: string, nameAr: string) {
    setBranchId(id);
    setBranchNameEn(nameEn);
    setBranchNameAr(nameAr);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, nameEn, nameAr }));
  }

  return (
    <BranchContext.Provider value={{ branchId, branchNameEn, branchNameAr, setBranch }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  return useContext(BranchContext);
}
