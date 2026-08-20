'use client';

import { useEffect, useState, useTransition, useRef, useCallback } from 'react';
import { useRouter, usePathname } from '@/app/i18n/navigation';
import { useLocale } from 'next-intl';
import { useSession, signOut } from '@/app/lib/auth';
import { LoadingState } from '@/components/shared/LoadingState';
import { formatCurrency } from '@/app/lib/utils';
import { api, type ApiMedicine, type PaginatedResponse } from '@/app/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  ShoppingCart, Search, Undo2, Users, FileText,
  Bell, BarChart3, ClipboardList, Tag,
  Package, LayoutGrid, Lock, Settings2,
  Clock, RefreshCw, LogOut, KeyRound,
  Wifi, Printer, CreditCard, Monitor, X,
  Coffee,
} from 'lucide-react';

interface Tile {
  label: string;
  labelAr: string;
  icon: React.ElementType;
  color: string;
  wide?: boolean;
  href?: string;
  action?: string;
  phase3?: boolean; // shows a toast instead of navigating
}

interface TileGroup {
  label: string;
  labelAr: string;
  tiles: Tile[];
}

interface PosShellProps {
  children: React.ReactNode;
}

export function PosShell({ children }: PosShellProps) {
  const { user, ready } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale() as 'ar' | 'en';

  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [time, setTime] = useState('');
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // ── Real shift stats ──
  const [shiftSales, setShiftSales] = useState<{ count: number; revenue: number } | null>(null);
  const [shiftOpenedAt, setShiftOpenedAt] = useState<string | null>(null);

  // ── Session / shift state ──
  type SessionStatus = 'NONE' | 'OPEN' | 'ON_BREAK' | 'CLOSED';
  type ZReport = {
    session_id: string; opened_at: string; closed_at: string | null;
    total_sales: number; total_revenue: string; total_vat: string;
    opening_float: string; break_minutes: number;
    payment_breakdown: { method: string; count: number; total: string }[];
    pharmacist_name: string; branch_name_en: string; branch_name_ar: string;
  };
  type ActiveSession = { id: string; status: SessionStatus; opened_at: string; opening_float: string; break_minutes: number };

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('NONE');
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // Z-report dialog
  const [zReportOpen, setZReportOpen] = useState(false);
  const [zReport, setZReport] = useState<ZReport | null>(null);

  // Action loading states
  const [closingShift, setClosingShift] = useState(false);
  const [togglingBreak, setTogglingBreak] = useState(false);

  // Declare start amount dialog
  const [floatDialogOpen, setFloatDialogOpen] = useState(false);
  const [floatInput, setFloatInput] = useState('');
  const [openingShift, setOpeningShift] = useState(false);

  // Show journal dialog
  type JournalSale = { id: string; invoice_number: string; total_amount: string; vat_amount: string; payment_method: string; sold_at: string; pharmacist_name: string };
  const [journalOpen, setJournalOpen] = useState(false);
  const [journalSales, setJournalSales] = useState<JournalSale[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);

  // Reprint last receipt
  const [reprintingLast, setReprintingLast] = useState(false);

  // Tender declaration
  const [tenderOpen, setTenderOpen] = useState(false);
  const [tenderInput, setTenderInput] = useState('');
  const [tenderResult, setTenderResult] = useState<{ declared_cash: string; expected_cash: string; difference: string; status: string } | null>(null);
  const [tenderHistory, setTenderHistory] = useState<{ id: string; declared_cash: string; expected_cash: string; difference: string; status: string; declared_at: string }[]>([]);
  const [submittingTender, setSubmittingTender] = useState(false);

  // Find a customer
  type Customer = { id: string; name_ar: string; name_en: string; phone: string; national_id: string };
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name_ar: '', name_en: '', phone: '', national_id: '' });
  const [savingCustomer, setSavingCustomer] = useState(false);
  const customerSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reprint Z — session picker
  type HistorySession = { id: string; opened_at: string; closed_at: string | null; total_sales: number; total_revenue: string; total_vat: string };
  const [reprintZOpen, setReprintZOpen] = useState(false);
  const [reprintZSessions, setReprintZSessions] = useState<HistorySession[]>([]);
  const [reprintZLoading, setReprintZLoading] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

  // ── Load current session on mount + when profile opens ──
  function loadSession(currentUser = user) {
    if (!currentUser?.id) return;
    fetch(`${API_BASE}/sessions/current`, {
      headers: { Authorization: `Bearer ${currentUser.token}` },
    }).then(r => r.ok ? r.json() : null).then(session => {
      if (session) {
        setSessionStatus(session.status as SessionStatus);
        setActiveSession({ id: session.id, status: session.status, opened_at: session.opened_at, opening_float: session.opening_float, break_minutes: session.break_minutes });
        // format opened_at for profile panel
        const d = new Date(session.opened_at.endsWith('Z') ? session.opened_at : session.opened_at + 'Z');
        let h = d.getHours(), m = d.getMinutes();
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        setShiftOpenedAt(`${h}:${m < 10 ? '0' : ''}${m} ${ampm}`);
      } else {
        setSessionStatus('NONE');
        setActiveSession(null);
        setShiftOpenedAt(null);
      }
      setSessionLoaded(true);
    }).catch(() => { setSessionStatus('NONE'); setActiveSession(null); setSessionLoaded(true); });
  }

  function loadShiftStats() {
    const currentUser = user;
    if (!currentUser?.id) return;
    loadSession(currentUser);

    // Load sales from the current session via session_id
    fetch(`${API_BASE}/sessions/current`, {
      headers: { Authorization: `Bearer ${currentUser.token}` },
    }).then(r => r.ok ? r.json() : null).then(session => {
      if (!session?.id) { setShiftSales({ count: 0, revenue: 0 }); return; }
      fetch(`${API_BASE}/sessions/${session.id}/sales`, {
        headers: { Authorization: `Bearer ${currentUser.token}` },
      }).then(r => r.ok ? r.json() : null).then(data => {
        const items: { total_amount: string }[] = data?.items ?? [];
        const revenue = items.reduce((s, r) => s + parseFloat(r.total_amount), 0);
        setShiftSales({ count: items.length, revenue });
      }).catch(() => setShiftSales({ count: 0, revenue: 0 }));
    }).catch(() => setShiftSales({ count: 0, revenue: 0 }));
  }

  // ── Open shift (after float declared) ──
  async function handleOpenShift() {
    if (!user || openingShift) return;
    const float = parseFloat(floatInput.replace(/,/g, '')) || 0;
    setOpeningShift(true);
    try {
      const res = await fetch(`${API_BASE}/sessions/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ opening_float: float }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: locale === 'ar' ? 'خطأ' : 'Error', description: err.detail ?? 'Could not open shift', variant: 'destructive' });
        return;
      }
      const session = await res.json();
      setSessionStatus('OPEN');
      setActiveSession({ id: session.id, status: 'OPEN', opened_at: session.opened_at, opening_float: session.opening_float, break_minutes: 0 });
      const d = new Date(session.opened_at.endsWith('Z') ? session.opened_at : session.opened_at + 'Z');
      let h = d.getHours(), m = d.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
      setShiftOpenedAt(`${h}:${m < 10 ? '0' : ''}${m} ${ampm}`);
      setFloatDialogOpen(false);
      setFloatInput('');
      toast({ title: locale === 'ar' ? 'بدأت الوردية' : 'Shift started', description: locale === 'ar' ? 'يمكنك البدء في المبيعات الآن' : 'You can start selling now' });
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في الاتصال' : 'Connection error', variant: 'destructive' });
    } finally {
      setOpeningShift(false);
    }
  }

  // ── Toggle break ──
  async function handleToggleBreak() {
    if (!user || togglingBreak || !activeSession) return;
    setTogglingBreak(true);
    try {
      const isOnBreak = sessionStatus === 'ON_BREAK';
      const endpoint = isOnBreak ? '/sessions/break/end' : '/sessions/break/start';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ reason: '' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: locale === 'ar' ? 'خطأ' : 'Error', description: err.detail ?? 'Failed', variant: 'destructive' });
        return;
      }
      const data = await res.json();
      const newStatus: SessionStatus = isOnBreak ? 'OPEN' : 'ON_BREAK';
      setSessionStatus(newStatus);
      setActiveSession(prev => prev ? { ...prev, status: newStatus, break_minutes: isOnBreak ? (prev.break_minutes + (data.break_minutes_added ?? 0)) : prev.break_minutes } : prev);
      toast({ title: isOnBreak ? (locale === 'ar' ? 'عدت من الاستراحة' : 'Break ended') : (locale === 'ar' ? 'في الاستراحة' : 'Break started') });
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في الاتصال' : 'Connection error', variant: 'destructive' });
    } finally {
      setTogglingBreak(false);
    }
  }

  async function handleCloseShift() {
    if (!user || closingShift) return;
    setClosingShift(true);
    try {
      const res = await fetch(`${API_BASE}/sessions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: locale === 'ar' ? 'خطأ' : 'Error', description: err.detail ?? 'Could not close shift', variant: 'destructive' });
        return;
      }
      const closed = await res.json();
      // Fetch Z-report
      const zRes = await fetch(`${API_BASE}/sessions/${closed.id}/z-report`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const zData = await zRes.json();
      setZReport(zData);
      setZReportOpen(true);
      setSessionStatus('CLOSED');
      setActiveSession(null);
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في الاتصال' : 'Connection error', variant: 'destructive' });
    } finally {
      setClosingShift(false);
    }
  }

  async function handleShowJournal() {
    if (!user || !activeSession) {
      toast({ title: locale === 'ar' ? 'لا توجد وردية نشطة' : 'No active shift', variant: 'destructive' });
      return;
    }
    setJournalLoading(true);
    setJournalOpen(true);
    try {
      const res = await fetch(`${API_BASE}/sessions/${activeSession.id}/sales`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error('Failed to load journal');
      const data = await res.json();
      setJournalSales(data.items ?? []);
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في تحميل السجل' : 'Failed to load journal', variant: 'destructive' });
      setJournalOpen(false);
    } finally {
      setJournalLoading(false);
    }
  }

  async function handleOpenTender() {
    if (!user) return;
    // Load history
    try {
      const res = await fetch(`${API_BASE}/sessions/tender/history`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const data = res.ok ? await res.json() : null;
      setTenderHistory(data?.items ?? []);
    } catch { /* non-blocking */ }
    setTenderResult(null);
    setTenderInput('');
    setTenderOpen(true);
  }

  async function handleSubmitTender() {
    if (!user || submittingTender) return;
    const declared = parseFloat(tenderInput.replace(/,/g, '')) || 0;
    setSubmittingTender(true);
    try {
      const res = await fetch(`${API_BASE}/sessions/tender`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ declared_cash: declared, notes: '' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: locale === 'ar' ? 'خطأ' : 'Error', description: err.detail ?? 'Failed', variant: 'destructive' });
        return;
      }
      const data = await res.json();
      setTenderResult(data);
      setTenderHistory(prev => [data, ...prev.slice(0, 9)]);
      setTenderInput('');
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في الاتصال' : 'Connection error', variant: 'destructive' });
    } finally {
      setSubmittingTender(false);
    }
  }

  async function handleReprintLast() {
    if (!user || reprintingLast) return;
    if (!activeSession) {
      toast({ title: locale === 'ar' ? 'لا توجد وردية نشطة' : 'No active shift', variant: 'destructive' });
      return;
    }
    setReprintingLast(true);
    try {
      // Get last sale in this shift
      const res = await fetch(`${API_BASE}/sessions/${activeSession.id}/sales`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const sales: JournalSale[] = data.items ?? [];
      if (sales.length === 0) {
        toast({ title: locale === 'ar' ? 'لا توجد مبيعات في هذه الوردية' : 'No sales in this shift', variant: 'destructive' });
        return;
      }
      // sales are DESC, so first item is the last sale
      const lastSale = sales[0];

      // Fetch full detail
      const detailRes = await fetch(`${API_BASE}/sales/${lastSale.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!detailRes.ok) throw new Error('Failed to fetch detail');
      const sale = await detailRes.json();

      // Fetch logo as base64 so it renders in the blank print window
      let logoDataUrl = '';
      try {
        const logoRes = await fetch(`${window.location.origin}/logo.png`);
        const blob = await logoRes.blob();
        logoDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch { /* logo optional */ }

      // Build print HTML (same structure as POS new sale)
      const dir = locale === 'ar' ? 'rtl' : 'ltr';
      const esc = (s: string) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const soldAt = new Date(sale.sold_at.endsWith('Z') ? sale.sold_at : sale.sold_at + 'Z');
      const dateStr = soldAt.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-SA');
      const timeStr = soldAt.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-SA', { hour: '2-digit', minute: '2-digit' });
      const subtotal = parseFloat(sale.subtotal_amount ?? sale.total_amount);
      const vat = parseFloat(sale.vat_amount ?? '0');
      const total = parseFloat(sale.total_amount);
      const branchName = locale === 'ar' ? (user.branch_name_ar || user.branch_id) : (user.branch_name_en || user.branch_id);
      const L = locale === 'ar'
        ? { invoice:'رقم الفاتورة', ph:'الصيدلي', pay:'طريقة الدفع', med:'الدواء', qty:'الكمية', tot:'الإجمالي', sub:'المجموع الفرعي', vat:'ضريبة القيمة المضافة', grand:'الإجمالي النهائي', reprint:'إعادة طباعة' }
        : { invoice:'Invoice #', ph:'Pharmacist', pay:'Payment', med:'Medicine', qty:'Qty', tot:'Total', sub:'Subtotal', vat:'VAT', grand:'Grand Total', reprint:'REPRINT' };

      const itemRows = (sale.items ?? []).map((it: { medicine_name_ar: string; medicine_name_en: string; quantity: number; unit_price: string; vat_amount: string }) =>
        `<div class="row"><span>${esc(locale === 'ar' ? it.medicine_name_ar : it.medicine_name_en)} × ${it.quantity}</span><span>${parseFloat(it.unit_price) * it.quantity > 0 ? (parseFloat(it.unit_price) * it.quantity).toFixed(2) : '0.00'}</span></div>`
      ).join('');

      const html = `<!DOCTYPE html><html dir="${dir}"><head><meta charset="UTF-8"/><title>${esc(sale.invoice_number)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', sans-serif; font-size: 12px; width: 80mm; padding: 8mm; direction: ${dir}; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .row { display: flex; justify-content: space-between; margin: 3px 0; }
  .hr { border: none; border-top: 1px dashed #aaa; margin: 6px 0; }
  .muted { color: #555; }
  .reprint { color: #cc0000; font-weight: 700; font-size: 11px; text-align: center; margin-bottom: 4px; }
  @media print { body { width: 100%; } }
</style></head><body>
  <div class="reprint">*** ${L.reprint} ***</div>
  ${logoDataUrl ? `<div class="center" style="padding:6px 0 6px;border-bottom:2px solid #000;margin-bottom:8px"><img src="${logoDataUrl}" style="height:80px;width:auto;filter:brightness(0)" alt="PharmaFlow"/></div>` : '<div style="border-bottom:2px solid #000;margin-bottom:8px;padding-bottom:6px;text-align:center;font-weight:700;font-size:16px">PharmaFlow</div>'}
  <div class="row" style="margin-bottom:2px"><span class="muted">${branchName ? esc(branchName) : 'PharmaFlow'}</span><span class="muted">${esc(dateStr)}</span></div>
  <div class="row" style="margin-bottom:2px"><span class="muted">VAT: 311111111111113</span><span class="muted">${esc(timeStr)}</span></div>
  <div class="center muted" style="font-size:10px;margin-bottom:4px">${dir === 'rtl' ? 'فاتورة ضريبية مبسطة' : 'Simplified Tax Invoice'}</div>
  <hr class="hr"/>
  <div class="row"><span class="muted">${L.invoice}</span><span class="bold">${esc(sale.invoice_number)}</span></div>
  <div class="row"><span class="muted">${L.ph}</span><span>${esc(sale.pharmacist_name ?? user.full_name)}</span></div>
  <div class="row"><span class="muted">${L.pay}</span><span>${esc(sale.payment_method)}</span></div>
  <hr class="hr"/>
  ${itemRows}
  <hr class="hr"/>
  <div class="row"><span class="muted">${L.sub}</span><span>${subtotal.toFixed(3)}</span></div>
  <div class="row"><span class="muted">${L.vat}</span><span>${vat.toFixed(3)}</span></div>
  <div class="row bold"><span>${L.grand}</span><span>${total.toFixed(3)} SAR</span></div>
<script>window.onload=function(){window.print();window.close();}<\/script>
</body></html>`;

      const w = window.open('', '_blank', 'width=340,height=700');
      if (w) { w.document.write(html); w.document.close(); }
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في إعادة الطباعة' : 'Reprint failed', variant: 'destructive' });
    } finally {
      setReprintingLast(false);
    }
  }

  async function handleReprintZ() {
    if (!user) return;
    setReprintZLoading(true);
    setReprintZOpen(true);
    try {
      const res = await fetch(`${API_BASE}/sessions/history`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setReprintZSessions(data.items ?? []);
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في تحميل السجل' : 'Failed to load history', variant: 'destructive' });
      setReprintZOpen(false);
    } finally {
      setReprintZLoading(false);
    }
  }

  async function printZFromSession(sessionId: string) {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/z-report`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error('Failed');
      const z = await res.json();

      // Fetch logo as base64
      let logoDataUrl = '';
      try {
        const logoRes = await fetch(`${window.location.origin}/logo.png`);
        const blob = await logoRes.blob();
        logoDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch { /* logo optional */ }

      const dir = locale === 'ar' ? 'rtl' : 'ltr';
      const esc = (s: string) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const openedStr = new Date(z.opened_at.endsWith('Z') ? z.opened_at : z.opened_at + 'Z')
        .toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-SA', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: 'short', day: 'numeric' });
      const closedStr = z.closed_at ? new Date(z.closed_at.endsWith('Z') ? z.closed_at : z.closed_at + 'Z')
        .toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-SA', { hour: '2-digit', minute: '2-digit' }) : '—';
      const net = (parseFloat(z.total_revenue) - parseFloat(z.total_vat)).toFixed(3);

      const breakdownRows = z.payment_breakdown.map((p: { method: string; count: number; total: string }) =>
        `<div class="row"><span class="muted">${esc(p.method)} (${p.count})</span><span>${parseFloat(p.total).toFixed(3)}</span></div>`
      ).join('');

      const html = `<!DOCTYPE html><html dir="${dir}"><head><meta charset="UTF-8"/><title>Z-Report</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', sans-serif; font-size: 12px; width: 80mm; padding: 8mm; direction: ${dir}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .row { display: flex; justify-content: space-between; margin: 3px 0; }
  .hr { border: none; border-top: 1px dashed #aaa; margin: 6px 0; }
  .muted { color: #555; }
  .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #888; margin: 8px 0 4px; }
  .blue { color: #0284c7; font-weight: 700; }
  @media print { body { width: 100%; } }
</style></head><body>
  ${logoDataUrl ? `<div class="center" style="padding:6px 0 6px;border-bottom:2px solid #000;margin-bottom:8px"><img src="${logoDataUrl}" style="height:80px;width:auto;filter:brightness(0)" alt="PharmaFlow"/></div>` : '<div style="border-bottom:2px solid #000;margin-bottom:8px;padding-bottom:6px;text-align:center;font-weight:700;font-size:16px">PharmaFlow</div>'}
  <div class="row" style="margin-bottom:2px"><span class="muted">${esc(locale === 'ar' ? z.branch_name_ar : z.branch_name_en)}</span><span class="muted">VAT: 311111111111113</span></div>
  <hr class="hr"/>
  <div class="center bold" style="font-size:13px">${locale === 'ar' ? 'تقرير Z — إغلاق الوردية' : 'Z-Report — Shift Close'}</div>
  <hr class="hr"/>
  <div class="row"><span class="muted">${locale === 'ar' ? 'الصيدلي' : 'Pharmacist'}</span><span>${esc(z.pharmacist_name)}</span></div>
  <div class="row"><span class="muted">${locale === 'ar' ? 'بدأت' : 'Opened'}</span><span>${esc(openedStr)}</span></div>
  <div class="row"><span class="muted">${locale === 'ar' ? 'أُغلقت' : 'Closed'}</span><span>${esc(closedStr)}</span></div>
  <hr class="hr"/>
  <div class="row"><span class="muted">${locale === 'ar' ? 'عدد المبيعات' : 'Total Sales'}</span><span class="bold">${z.total_sales}</span></div>
  <div class="row"><span class="muted">${locale === 'ar' ? 'الإيراد' : 'Revenue'}</span><span>${parseFloat(z.total_revenue).toFixed(3)}</span></div>
  <div class="row"><span class="muted">${locale === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT'}</span><span>${parseFloat(z.total_vat).toFixed(3)}</span></div>
  <div class="row bold"><span>${locale === 'ar' ? 'صافي الإيراد' : 'Net Revenue'}</span><span class="blue">${net} SAR</span></div>
</body></html>`;

      const w = window.open('', '_blank', 'width=340,height=700');
      if (w) { w.document.write(html); w.document.close(); }
      setReprintZOpen(false);
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في الطباعة' : 'Print failed', variant: 'destructive' });
    }
  }

  async function handlePrintX() {
    if (!user || !activeSession) return;
    try {
      const res = await fetch(`${API_BASE}/sessions/${activeSession.id}/z-report`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error('Failed');
      const z = await res.json();

      let logoDataUrl = '';
      try {
        const logoRes = await fetch(`${window.location.origin}/logo.png`);
        const blob = await logoRes.blob();
        logoDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch { /* logo optional */ }

      const dir = locale === 'ar' ? 'rtl' : 'ltr';
      const esc = (s: string) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const now = new Date();
      const printedAt = now.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-SA', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: 'short', day: 'numeric' });
      const openedStr = new Date(z.opened_at.endsWith('Z') ? z.opened_at : z.opened_at + 'Z')
        .toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
      const net = (parseFloat(z.total_revenue) - parseFloat(z.total_vat)).toFixed(3);
      const branchName = locale === 'ar' ? (user.branch_name_ar || user.branch_id) : (user.branch_name_en || user.branch_id);

      const breakdownRows = z.payment_breakdown.map((p: { method: string; count: number; total: string }) =>
        `<div class="row"><span class="muted">${esc(p.method)} (${p.count})</span><span>${parseFloat(p.total).toFixed(3)}</span></div>`
      ).join('');

      const html = `<!DOCTYPE html><html dir="${dir}"><head><meta charset="UTF-8"/><title>X-Report</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', sans-serif; font-size: 12px; width: 80mm; padding: 8mm; direction: ${dir}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .row { display: flex; justify-content: space-between; margin: 3px 0; }
  .hr { border: none; border-top: 1px dashed #aaa; margin: 6px 0; }
  .muted { color: #555; }
  .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #888; margin: 8px 0 4px; }
  .xbadge { background: #1a1a2e; color: #fff; font-weight: 700; font-size: 11px; text-align: center; padding: 3px 0; margin-bottom: 6px; border-radius: 2px; }
  .green { color: #16a34a; font-weight: 700; }
  .blue { color: #0284c7; font-weight: 700; }
  @media print { body { width: 100%; } }
</style></head><body>
  ${logoDataUrl ? `<div class="center" style="padding:6px 0 6px;border-bottom:2px solid #000;margin-bottom:8px"><img src="${logoDataUrl}" style="height:80px;width:auto;filter:brightness(0)" alt="PharmaFlow"/></div>` : '<div style="border-bottom:2px solid #000;margin-bottom:8px;padding-bottom:6px;text-align:center;font-weight:700;font-size:16px">PharmaFlow</div>'}
  <div class="row" style="margin-bottom:2px"><span class="muted">${esc(branchName)}</span><span class="muted">VAT: 311111111111113</span></div>
  <hr class="hr"/>
  <div class="xbadge">${locale === 'ar' ? 'تقرير X — لقطة منتصف الوردية' : 'X-Report — Mid-Shift Snapshot'}</div>
  <div class="center muted" style="font-size:10px">${locale === 'ar' ? 'طُبع في' : 'Printed at'}: ${esc(printedAt)}</div>
  <hr class="hr"/>
  <div class="row"><span class="muted">${locale === 'ar' ? 'الصيدلي' : 'Pharmacist'}</span><span>${esc(z.pharmacist_name)}</span></div>
  <div class="row"><span class="muted">${locale === 'ar' ? 'بدأت الوردية' : 'Shift opened'}</span><span>${esc(openedStr)}</span></div>
  <div class="row"><span class="muted">${locale === 'ar' ? 'الحالة' : 'Status'}</span><span class="green">${locale === 'ar' ? 'مفتوحة' : 'OPEN'}</span></div>
  <hr class="hr"/>
  <div class="row"><span class="muted">${locale === 'ar' ? 'عدد المبيعات' : 'Sales so far'}</span><span class="bold">${z.total_sales}</span></div>
  <div class="row"><span class="muted">${locale === 'ar' ? 'الإيراد' : 'Revenue'}</span><span>${parseFloat(z.total_revenue).toFixed(3)}</span></div>
  <div class="row"><span class="muted">${locale === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT'}</span><span>${parseFloat(z.total_vat).toFixed(3)}</span></div>
  <div class="row bold"><span>${locale === 'ar' ? 'صافي الإيراد' : 'Net Revenue'}</span><span class="blue">${net} SAR</span></div>
  ${z.payment_breakdown.length > 0 ? `<hr class="hr"/><div class="label">${locale === 'ar' ? 'توزيع طرق الدفع' : 'Payment Breakdown'}</div>${breakdownRows}` : ''}
  <hr class="hr"/>
  <div class="center muted" style="font-size:10px">${locale === 'ar' ? '* الوردية لا تزال مفتوحة — هذا ليس تقرير Z *' : '* Shift still open — this is NOT a Z-Report *'}</div>
<script>window.onload=function(){window.print();window.close();}<\/script>
</body></html>`;

      const w = window.open('', '_blank', 'width=340,height=700');
      if (w) { w.document.write(html); w.document.close(); }
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في الطباعة' : 'Print failed', variant: 'destructive' });
    }
  }

  function handleOpenCustomer() {
    setCustomerSearch('');
    setCustomerResults([]);
    setNewCustomerMode(false);
    setNewCustomerForm({ name_ar: '', name_en: '', phone: '', national_id: '' });
    setCustomerOpen(true);
  }

  function searchCustomers(q: string) {
    if (customerSearchTimeout.current) clearTimeout(customerSearchTimeout.current);
    if (!q.trim()) { setCustomerResults([]); return; }
    setCustomerSearching(true);
    customerSearchTimeout.current = setTimeout(() => {
      fetch(`${API_BASE}/customers?search=${encodeURIComponent(q)}&page_size=10`, {
        headers: { Authorization: `Bearer ${user?.token ?? ''}` },
      }).then(r => r.ok ? r.json() : null).then(d => {
        setCustomerResults(d?.items ?? []);
        setCustomerSearching(false);
      }).catch(() => { setCustomerResults([]); setCustomerSearching(false); });
    }, 250);
  }

  async function handleSaveNewCustomer() {
    if (!user || savingCustomer || !newCustomerForm.name_ar.trim()) return;
    setSavingCustomer(true);
    try {
      const res = await fetch(`${API_BASE}/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify(newCustomerForm),
      });
      if (!res.ok) throw new Error('Failed');
      const customer = await res.json();
      // Navigate to POS with customer attached
      router.push(`/pharmacist/sales/new?customer_id=${customer.id}&customer_name=${encodeURIComponent(locale === 'ar' ? customer.name_ar : (customer.name_en || customer.name_ar))}` as `/${string}`);
      setCustomerOpen(false);
      toast({ title: locale === 'ar' ? 'تم إنشاء العميل وربطه' : 'Customer created and attached' });
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في الحفظ' : 'Save failed', variant: 'destructive' });
    } finally {
      setSavingCustomer(false);
    }
  }

  function handleSelectCustomer(c: Customer) {
    router.push(`/pharmacist/sales/new?customer_id=${c.id}&customer_name=${encodeURIComponent(locale === 'ar' ? c.name_ar : (c.name_en || c.name_ar))}` as `/${string}`);
    setCustomerOpen(false);
  }

  function handleLocaleToggle() {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace('/login');
    else if (user.role !== 'pharmacist') router.replace('/unauthorized');
  }, [user, ready, router]);

  // Load session state on mount
  useEffect(() => {
    if (ready && user?.role === 'pharmacist') loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  useEffect(() => {
    function tick() {
      const now = new Date();
      let h = now.getHours(), m = now.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      setTime(`${h}:${m < 10 ? '0' : ''}${m} ${ampm}`);
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  /* ── Global search results — real API with debounce ── */
  const [searchResults, setSearchResults] = useState<ApiMedicine[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback((q: string, branchId: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    const branchParam = branchId ? `&branch_id=${branchId}` : '';
    api.get<PaginatedResponse<ApiMedicine>>(`/medicines?search=${encodeURIComponent(q)}&page_size=6&is_active=true${branchParam}`)
      .then((res) => setSearchResults(res.items))
      .catch(() => setSearchResults([]));
  }, []);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!globalSearch.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(() => runSearch(globalSearch, user?.branch_id ?? ''), 250);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [globalSearch, runSearch, user?.branch_id]);

  if (!ready || !user || user.role !== 'pharmacist') {
    return <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'hsl(var(--pos-bg))' }}><LoadingState /></div>;
  }

  const branchName = locale === 'ar' ? (user.branch_name_ar || user.branch_id) : (user.branch_name_en || user.branch_id);
  const initials = user.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  // ── Shift-aware tile helper ──
  // Tiles that require an OPEN shift are disabled when status is NONE, ON_BREAK, or CLOSED
  const shiftRequired = sessionStatus !== 'OPEN';
  const noShift = sessionStatus === 'NONE' || sessionStatus === 'CLOSED';
  const onBreak = sessionStatus === 'ON_BREAK';

  const groups: TileGroup[] = [
    {
      label: 'Start', labelAr: 'البداية',
      tiles: [
        { label: 'Current transaction', labelAr: 'المعاملة الحالية', icon: ShoppingCart, color: shiftRequired ? 'hsl(var(--pos-card))' : 'hsl(var(--pos-primary))', wide: true, href: shiftRequired ? undefined : '/pharmacist/sales/new', action: shiftRequired ? 'shiftRequired' : undefined },
        { label: 'Find medicine',       labelAr: 'بحث عن دواء',       icon: Search,       color: 'hsl(var(--pos-accent))',   href: '/pharmacist/inventory' },
        { label: 'Return transaction',  labelAr: 'إرجاع',              icon: Undo2,        color: shiftRequired ? 'hsl(var(--pos-card))' : 'hsl(var(--pos-accent))',   href: shiftRequired ? undefined : '/pharmacist/returns', action: shiftRequired ? 'shiftRequired' : undefined },
        { label: 'Find a customer',     labelAr: 'بحث عن عميل',        icon: Users,        color: shiftRequired ? 'hsl(var(--pos-card))' : 'hsl(var(--tile-cobalt))', action: shiftRequired ? 'shiftRequired' : 'findCustomer' },
        { label: 'Prescriptions',       labelAr: 'الوصفات',            icon: FileText,     color: shiftRequired ? 'hsl(var(--pos-card))' : 'hsl(var(--tile-cobalt))',  href: shiftRequired ? undefined : '/pharmacist/prescriptions', action: shiftRequired ? 'shiftRequired' : undefined },
        { label: 'Alerts',              labelAr: 'التنبيهات',          icon: Bell,         color: 'hsl(var(--destructive))',  href: '/pharmacist/alerts' },
        { label: 'Reports',             labelAr: 'التقارير',           icon: BarChart3,    color: 'hsl(var(--tile-cobalt))',  href: '/pharmacist/reports' },
        { label: 'My sales',            labelAr: 'مبيعاتي',            icon: ClipboardList,color: 'hsl(var(--tile-cobalt))',  href: '/pharmacist/sales' },
        { label: 'Price check',         labelAr: 'فحص السعر',          icon: Tag,          color: 'hsl(var(--tile-cobalt))',  href: '/pharmacist/inventory' },
      ],
    },
    {
      label: 'Shift and drawer', labelAr: 'الوردية والدرج',
      tiles: [
        // Declare start amount — only active when no shift open
        { label: 'Declare start amount', labelAr: 'إعلان الرصيد الافتتاحي', icon: Clock,
          color: noShift ? 'hsl(var(--tile-orange))' : 'hsl(var(--pos-card))',
          action: noShift ? 'openShift' : 'alreadyOpen' },
        // Close shift — only active when OPEN or ON_BREAK
        { label: 'Close shift', labelAr: 'إغلاق الوردية', icon: Lock,
          color: sessionStatus === 'CLOSED' || noShift ? 'hsl(var(--pos-card))' : 'hsl(var(--tile-orange))',
          action: (sessionStatus === 'CLOSED' || noShift) ? 'noSession' : 'closeShift' },
        { label: 'Tender declaration',   labelAr: 'إعلان العطاء',            icon: Settings2,     color: noShift ? 'hsl(var(--pos-card))' : 'hsl(var(--tile-amber))', action: noShift ? 'noSession' : 'tenderDeclaration' },
        { label: 'Reprint Z',            labelAr: 'إعادة طباعة Z',           icon: RefreshCw,     color: 'hsl(var(--tile-amber))', action: 'reprintZ' },
        { label: 'Show journal',         labelAr: 'عرض السجل',               icon: ClipboardList, color: noShift ? 'hsl(var(--pos-card))' : 'hsl(var(--tile-amber))', action: noShift ? 'noSession' : 'showJournal' },
        { label: 'Print X',              labelAr: 'طباعة X',                 icon: FileText,      color: noShift ? 'hsl(var(--pos-card))' : 'hsl(var(--tile-amber))', action: noShift ? 'noSession' : 'printX' },
        { label: 'Recall transaction',   labelAr: 'استدعاء معاملة',          icon: Undo2,         color: noShift ? 'hsl(var(--pos-card))' : 'hsl(var(--tile-amber))', action: noShift ? 'noSession' : 'recallTransaction' },
        { label: onBreak ? 'End break' : 'Start break',
          labelAr: onBreak ? 'إنهاء الاستراحة' : 'بدء الاستراحة',
          icon: onBreak ? RefreshCw : Coffee,
          color: noShift ? 'hsl(var(--pos-card))' : onBreak ? 'hsl(var(--success))' : 'hsl(var(--tile-amber))',
          action: noShift ? 'noSession' : 'toggleBreak' },
        { label: 'Reprint last receipt', labelAr: 'إعادة طباعة آخر إيصال',  icon: Printer, color: noShift ? 'hsl(var(--pos-card))' : 'hsl(var(--tile-amber))', action: noShift ? 'noSession' : 'reprintLast' },
      ],
    },
    {
      label: 'Inventory', labelAr: 'المخزون',
      tiles: [
        { label: 'Inventory lookup',      labelAr: 'بحث المخزون',   icon: Search,     color: 'hsl(var(--pos-primary))', href: '/pharmacist/inventory' },
        { label: 'Stock count',           labelAr: 'جرد المخزون',   icon: Package,    color: 'hsl(var(--pos-primary))', href: '/pharmacist/stockcount' },
        { label: 'Picking and receiving', labelAr: 'استلام البضائع', icon: LayoutGrid, color: 'hsl(var(--pos-accent))',  href: '/pharmacist/receiving' },
      ],
    },
    {
      label: 'Operations', labelAr: 'العمليات',
      tiles: [
        { label: 'Change password', labelAr: 'تغيير كلمة المرور', icon: KeyRound,  color: 'hsl(var(--tile-ops))', href: '/profile' },
        { label: 'Sync status',     labelAr: 'حالة المزامنة',     icon: RefreshCw, color: 'hsl(var(--tile-ops))', action: 'syncStatus' },
      ],
    },
  ];

  /* ── Tile component ── */
  function Tile({ tile }: { tile: Tile }) {
    const Icon = tile.icon;
    const h = tile.wide ? '120px' : '110px';
    const iconSize = tile.wide ? '3.5rem' : '2.8rem';

    function handleClick() {
      if (tile.phase3) {
        toast({ title: locale === 'ar' ? `${tile.labelAr} — Phase 3` : `${tile.label} — Phase 3`, description: locale === 'ar' ? 'متاح بعد تفعيل الواجهة الخلفية' : 'Available after backend is connected' });
        return;
      }
      if (tile.action === 'syncStatus') { setSettingsOpen(true); return; }
      if (tile.action === 'closeShift') { handleCloseShift(); return; }
      if (tile.action === 'openShift') { setFloatDialogOpen(true); return; }
      if (tile.action === 'toggleBreak') { handleToggleBreak(); return; }
      if (tile.action === 'showJournal') { handleShowJournal(); return; }
      if (tile.action === 'tenderDeclaration') { handleOpenTender(); return; }
      if (tile.action === 'findCustomer') { handleOpenCustomer(); return; }
      if (tile.action === 'reprintLast') { handleReprintLast(); return; }
      if (tile.action === 'reprintZ') { handleReprintZ(); return; }
      if (tile.action === 'printX') { handlePrintX(); return; }
      if (tile.action === 'recallTransaction') { router.push('/pharmacist/sales/new?recall=1' as `/${string}`); return; }
      if (tile.action === 'shiftRequired') {
        toast({ title: locale === 'ar' ? 'لا توجد وردية نشطة' : 'No active shift', description: locale === 'ar' ? 'أعلن عن الرصيد الافتتاحي أولاً' : 'Declare start amount first', variant: 'destructive' });
        return;
      }
      if (tile.action === 'alreadyOpen') {
        toast({ title: locale === 'ar' ? 'الوردية مفتوحة بالفعل' : 'Shift already open' });
        return;
      }
      if (tile.action === 'noSession') {
        toast({ title: locale === 'ar' ? 'لا توجد وردية' : 'No active shift', variant: 'destructive' });
        return;
      }
      if (tile.href) router.push(tile.href as `/${string}`);
    }

    return (
      <li
        onClick={handleClick}
        className={tile.wide ? 'pos-tile pos-tile--wide' : 'pos-tile'}
        style={{
          position: 'relative',
          gridColumn: tile.wide ? 'span 2' : 'span 1',
          height: h,
          background: tile.color,
          cursor: tile.href || tile.action || tile.phase3 ? 'pointer' : 'default',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <Icon style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -60%)',
          fontSize: iconSize, width: iconSize, height: iconSize,
          color: 'hsl(var(--tile-foreground))', opacity: 0.9,
        }} />
            <span style={{
              position: 'absolute', bottom: '6px',
              left: '8px', right: '8px',
              fontSize: '11px', fontWeight: 400, lineHeight: 1.3,
              color: 'hsl(var(--tile-foreground))', whiteSpace: 'normal',
            }}>
              {locale === 'ar' ? tile.labelAr : tile.label}
            </span>
      </li>
    );
  }

  /* ── Is this a non-home POS page? Render content directly ── */
  const cleanPath = pathname.replace(`/${locale}`, '');
  const isHome = cleanPath === '/pharmacist/dashboard' || cleanPath === '/pharmacist';
  const isTileHome = isHome;

  return (
    <div style={{ minHeight: '100vh', background: 'hsl(var(--pos-bg))', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── Top bar ── */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: '48px',
        background: 'hsl(var(--pos-surface))', borderBottom: `1px solid hsl(var(--pos-border))`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', zIndex: 9999,
      }}>
        {/* Left — logo + nav icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Logo — same as admin topbar, clicking goes home */}
          <img
            src="/logo.png"
            alt="PharmaFlow"
            className="logo-dark-surface"
            onClick={() => { setSettingsOpen(false); setProfileOpen(false); router.push('/pharmacist/dashboard'); }}
            style={{ height: '52px', width: 'auto', objectFit: 'contain', cursor: 'pointer', flexShrink: 0 }}
            title="Home"
          />
          <button
            onClick={() => { setProfileOpen(false); setSettingsOpen((v) => !v); }}
            style={{
              color: settingsOpen ? 'hsl(var(--pos-fg))' : 'hsl(var(--pos-subtle))',
              background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
              display: 'flex', alignItems: 'center',
            }}
            title={locale === 'ar' ? 'إعدادات الجهاز' : 'Device Settings'}
          >
            <Settings2 style={{ width: '15px', height: '15px' }} />
          </button>
          <button
            onClick={handleLocaleToggle}
            style={{ color: 'hsl(var(--pos-subtle))', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', fontSize: '12px', fontWeight: 600, fontFamily: 'inherit' }}
          >
            {locale === 'ar' ? 'EN' : 'ع'}
          </button>
        </div>

        {/* Center — global search + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, justifyContent: 'center', position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <Search style={{
              position: 'absolute', top: '50%', left: '10px',
              transform: 'translateY(-50%)',
              width: '12px', height: '12px',
              color: 'hsl(var(--pos-subtle))', pointerEvents: 'none',
            }} />
            <input
              ref={searchRef}
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchResults.length > 0) {
                  const med = searchResults[0];
                  setGlobalSearch('');
                  router.push(`/pharmacist/sales/new?add=${med.id}` as `/${string}`);
                }
                if (e.key === 'Escape') { setGlobalSearch(''); searchRef.current?.blur(); }
              }}
              placeholder={locale === 'ar' ? 'ابحث عن دواء أو باركود...' : 'Search medicine or barcode...'}
              style={{
                background: 'hsl(var(--pos-input-bg))', border: `1px solid hsl(var(--pos-input-border))`,
                borderRadius: '4px', color: 'hsl(var(--pos-fg))', fontSize: '12px',
                padding: '6px 12px 6px 30px', width: '320px', outline: 'none', fontFamily: 'inherit',
              }}
            />
            {/* Search dropdown */}
            {searchFocused && searchResults.length > 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                background: 'hsl(var(--pos-surface))',
                border: `1px solid hsl(var(--pos-border))`,
                zIndex: 10000, borderRadius: '4px', overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,.4)',
              }}>
                {searchResults.map((med, i) => (
                  <div
                    key={med.id}
                    onMouseDown={() => {
                      setGlobalSearch('');
                      router.push(`/pharmacist/sales/new?add=${med.id}` as `/${string}`);
                    }}
                    style={{
                      padding: '9px 12px',
                      borderBottom: i < searchResults.length - 1 ? `1px solid hsl(var(--pos-border))` : 'none',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      cursor: 'pointer',
                      background: i === 0 ? 'hsl(var(--pos-card))' : 'transparent',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'hsl(var(--pos-card))'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = i === 0 ? 'hsl(var(--pos-card))' : 'transparent'; }}
                  >
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: i === 0 ? 600 : 400, color: 'hsl(var(--pos-fg))' }}>
                        {locale === 'ar' ? med.name_ar : med.name_en}
                      </div>
                      <div style={{ fontSize: '10px', color: 'hsl(var(--pos-muted))' }}>
                        {locale === 'ar' ? med.name_en : med.name_ar} · {med.barcode}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'hsl(var(--pos-primary))' }}>
                        {formatCurrency(parseFloat(med.selling_price), locale)}
                      </div>
                      <div style={{ fontSize: '10px', color: med.stock_quantity <= med.low_stock_threshold ? 'hsl(var(--warning))' : 'hsl(var(--pos-muted))' }}>
                        {med.stock_quantity} {med.unit || (locale === 'ar' ? 'وحدة' : 'units')}
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ padding: '7px 12px', fontSize: '10px', color: 'hsl(var(--pos-subtle))', borderTop: `1px solid hsl(var(--pos-border))` }}>
                  {locale === 'ar' ? 'Enter لإضافة الأول · Esc للإلغاء' : 'Enter to add first result · Esc to cancel'}
                </div>
              </div>
            )}
          </div>
          <span style={{ color: 'hsl(var(--pos-muted))', fontSize: '13px', whiteSpace: 'nowrap' }}>{time}</span>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ textAlign: 'end' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'hsl(var(--pos-fg))' }}>{user.full_name}</div>
            <div style={{ fontSize: '10px', color: 'hsl(var(--pos-muted))' }}>{branchName}</div>
          </div>
          <div
            onClick={() => { setSettingsOpen(false); setProfileOpen((v) => !v); loadShiftStats(); }}
            style={{
              width: '30px', height: '30px', borderRadius: '50%',
              background: 'hsl(var(--pos-primary))', color: 'hsl(var(--tile-foreground))',
              fontSize: '13px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {initials}
          </div>
        </div>
      </div>

      {/* ── Settings panel — slides in from inline-start (left in LTR, right in RTL) ── */}
      {settingsOpen && (
        <>
          <div onClick={() => setSettingsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9997 }} />
          <div style={{
            position: 'fixed', top: '48px', bottom: 0,
            ...(locale === 'ar' ? { right: 0, borderLeft: `1px solid hsl(var(--pos-border))` } : { left: 0, borderRight: `1px solid hsl(var(--pos-border))` }),
            width: '300px', background: 'hsl(var(--pos-surface))',
            zIndex: 9998, display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* Header */}
            <div style={{ padding: '16px', borderBottom: `1px solid hsl(var(--pos-border))`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(var(--pos-fg))' }}>
                {locale === 'ar' ? 'إعدادات الجهاز' : 'Device Settings'}
              </span>
              <button onClick={() => setSettingsOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--pos-muted))', display: 'flex' }}>
                <X style={{ width: '14px', height: '14px' }} />
              </button>
            </div>

            {/* Register info */}
            <div style={{ padding: '12px 16px', borderBottom: `1px solid hsl(var(--pos-border))` }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '8px' }}>
                {locale === 'ar' ? 'معلومات الجهاز' : 'Register Info'}
              </div>
              {[
                [locale === 'ar' ? 'الصيدلية' : 'Store',    locale === 'ar' ? 'فارما فلو' : 'PharmaFlow'],
                [locale === 'ar' ? 'الفرع' : 'Branch',      branchName],
                [locale === 'ar' ? 'الجهاز' : 'Register',   'POS-001'],
                [locale === 'ar' ? 'الإصدار' : 'Version',   'v1.0.0-demo'],
              ].map(([k, v]) => (
                <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px' }}>
                  <span style={{ color: 'hsl(var(--pos-muted))' }}>{k}</span>
                  <span style={{ color: 'hsl(var(--pos-fg))' }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Hardware Status */}
            <div style={{ padding: '12px 16px', borderBottom: `1px solid hsl(var(--pos-border))` }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '8px' }}>
                {locale === 'ar' ? 'حالة الأجهزة' : 'Hardware Status'}
              </div>
              {[
                { icon: Wifi,       label: locale === 'ar' ? 'الاتصال' : 'Connection',      status: locale === 'ar' ? 'متصل' : 'Online',  ok: true },
                { icon: Printer,    label: locale === 'ar' ? 'الطابعة' : 'Receipt Printer',  status: locale === 'ar' ? 'جاهزة' : 'Ready',   ok: true },
                { icon: CreditCard, label: locale === 'ar' ? 'قارئ البطاقة' : 'Card Reader', status: locale === 'ar' ? 'جاهز' : 'Ready',    ok: true },
                { icon: Monitor,    label: locale === 'ar' ? 'الدرج' : 'Cash Drawer',        status: locale === 'ar' ? 'مغلق' : 'Closed',   ok: true },
              ].map(({ icon: Icon, label, status, ok }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Icon style={{ width: '13px', height: '13px', color: 'hsl(var(--pos-muted))' }} />
                    <span style={{ color: 'hsl(var(--pos-muted))' }}>{label}</span>
                  </div>
                  <span style={{ color: ok ? 'hsl(var(--success))' : 'hsl(var(--destructive))', fontSize: '11px', fontWeight: 600 }}>{status}</span>
                </div>
              ))}
              <div style={{ fontSize: '10px', color: 'hsl(var(--pos-subtle))', marginTop: '6px' }} />
            </div>

            {/* Sync Status */}
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '8px' }}>
                {locale === 'ar' ? 'المزامنة' : 'Sync Status'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px' }}>
                <span style={{ color: 'hsl(var(--pos-muted))' }}>{locale === 'ar' ? 'الوضع' : 'Mode'}</span>
                <span style={{ color: 'hsl(var(--success))', fontWeight: 600 }}>{locale === 'ar' ? 'متصل' : 'Online'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px' }}>
                <span style={{ color: 'hsl(var(--pos-muted))' }}>{locale === 'ar' ? 'آخر مزامنة' : 'Last sync'}</span>
                <span style={{ color: 'hsl(var(--pos-fg))' }}>{time}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                <span style={{ color: 'hsl(var(--pos-muted))' }}>{locale === 'ar' ? 'معاملات معلقة' : 'Pending transactions'}</span>
                <span style={{ color: 'hsl(var(--pos-fg))' }}>0</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Profile panel — slides in from inline-end (right in LTR, left in RTL) ── */}
      {profileOpen && (
        <>
          <div
            onClick={() => setProfileOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9997 }}
          />
          <div style={{
            position: 'fixed', top: '48px', bottom: 0,
            ...(locale === 'ar' ? { left: 0, borderRight: `1px solid hsl(var(--pos-border))` } : { right: 0, borderLeft: `1px solid hsl(var(--pos-border))` }),
            width: '300px', background: 'hsl(var(--pos-surface))',
            zIndex: 9998, display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ padding: '20px 16px', borderBottom: `1px solid hsl(var(--pos-border))`, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'hsl(var(--pos-primary))', color: 'hsl(var(--tile-foreground))', fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'hsl(var(--pos-fg))' }}>{user.full_name}</div>
                <div style={{ fontSize: '11px', color: 'hsl(var(--pos-muted))' }}>{user.email}</div>
                <div style={{ fontSize: '10px', color: 'hsl(var(--pos-subtle))', marginTop: '2px' }}>{locale === 'ar' ? 'صيدلي' : 'Pharmacist'} · {branchName}</div>
              </div>
            </div>

            {/* Shift info */}
            <div style={{ padding: '10px 16px', borderBottom: `1px solid hsl(var(--pos-border))` }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '8px' }}>{locale === 'ar' ? 'الوردية الحالية' : 'Current Shift'}</div>
              {[
                [locale === 'ar' ? 'بدأت' : 'Started', shiftOpenedAt ?? '…'],
                [locale === 'ar' ? 'مبيعات اليوم' : 'Sales today', shiftSales ? formatCurrency(shiftSales.revenue, locale) : '…'],
                [locale === 'ar' ? 'المعاملات' : 'Transactions', shiftSales ? String(shiftSales.count) : '…'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                  <span style={{ color: 'hsl(var(--pos-muted))' }}>{k}</span>
                  <span style={{ color: 'hsl(var(--pos-fg))' }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Sign out */}
            <div style={{ padding: '12px 16px', marginTop: 'auto', borderTop: `1px solid hsl(var(--pos-border))` }}>
              <button
                onClick={() => { signOut(); router.replace('/login'); }}
                style={{
                  width: '100%', padding: '10px',
                  background: 'rgba(220,38,38,.12)', color: 'hsl(var(--destructive))',
                  border: '1px solid rgba(220,38,38,.25)',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
              >
                <LogOut style={{ width: '14px', height: '14px' }} />
                {locale === 'ar' ? 'تسجيل الخروج' : 'Sign out'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Main content ── */}
      <div style={{ position: 'fixed', top: '48px', left: 0, right: 0, bottom: 0 }}>
        {isTileHome ? (
          /* Metro tile start screen */
          <div style={{ position: 'relative', height: '100%' }}>

            {/* Tile groups — anchored to bottom, scroll horizontally */}
            <div className="no-scrollbar" style={{
              position: 'absolute', bottom: '64px', left: 0, right: 0,
              overflowX: 'auto', overflowY: 'hidden',
              whiteSpace: 'nowrap', padding: '0 48px',
            }}>
            {groups.map((group) => (
              <div key={group.label} style={{ display: 'inline-block', verticalAlign: 'top', whiteSpace: 'normal', width: '420px', marginRight: '120px' }}>
                <span style={{ color: 'hsl(var(--pos-muted))', fontSize: '24px', fontWeight: 300, letterSpacing: '.02em', opacity: 0.7, padding: '16px 2px 8px', display: 'block', fontFamily: "'Segoe UI Light', 'Segoe UI', system-ui, sans-serif" }}>
                  {locale === 'ar' ? group.labelAr : group.label}
                </span>
                <ul style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', margin: 0, padding: 0, listStyle: 'none' }}>
                  {group.tiles.map((tile) => <Tile key={tile.label} tile={tile} />)}
                </ul>
              </div>
            ))}
            </div>
          </div>
        ) : (
          /* Non-home pages — fill remaining height exactly */
          <div style={{ background: 'hsl(var(--pos-bg))', height: '100%', color: 'hsl(var(--pos-fg))', overflow: 'auto' }}
            className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {children}
          </div>
        )}
      </div>

      {/* ── Find a customer dialog ── */}
      {customerOpen && (
        <>
          <div onClick={() => setCustomerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '460px', maxHeight: '80vh',
            background: 'hsl(var(--pos-surface))',
            border: '1px solid hsl(var(--pos-border))',
            borderRadius: '6px', zIndex: 10001,
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid hsl(var(--pos-border))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'hsl(var(--pos-fg))' }}>
                {newCustomerMode ? (locale === 'ar' ? 'عميل جديد' : 'New Customer') : (locale === 'ar' ? 'بحث عن عميل' : 'Find a Customer')}
              </div>
              <button onClick={() => setCustomerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--pos-muted))', display: 'flex' }}>
                <X style={{ width: '16px', height: '16px' }} />
              </button>
            </div>

            {!newCustomerMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* Search input */}
                <div style={{ padding: '12px 24px', borderBottom: '1px solid hsl(var(--pos-border))', flexShrink: 0 }}>
                  <input
                    autoFocus
                    type="text"
                    value={customerSearch}
                    onChange={(e) => { setCustomerSearch(e.target.value); searchCustomers(e.target.value); }}
                    placeholder={locale === 'ar' ? 'اسم أو هاتف أو هوية...' : 'Name, phone, or ID...'}
                    style={{ width: '100%', padding: '8px 12px', background: 'hsl(var(--pos-input-bg))', border: '1px solid hsl(var(--pos-input-border))', borderRadius: '4px', color: 'hsl(var(--pos-fg))', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                {/* Results */}
                <div style={{ overflowY: 'auto', flex: 1 }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {customerSearching && (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'hsl(var(--pos-muted))', fontSize: '13px' }}>
                      {locale === 'ar' ? 'جاري البحث…' : 'Searching…'}
                    </div>
                  )}
                  {!customerSearching && customerSearch && customerResults.length === 0 && (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'hsl(var(--pos-muted))', fontSize: '13px' }}>
                      {locale === 'ar' ? 'لا توجد نتائج' : 'No results'}
                    </div>
                  )}
                  {!customerSearching && !customerSearch && (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'hsl(var(--pos-muted))', fontSize: '12px' }}>
                      {locale === 'ar' ? 'ابحث عن عميل أو أضف عميلاً جديداً' : 'Search for a customer or add a new one'}
                    </div>
                  )}
                  {customerResults.map((c, i) => (
                    <div
                      key={c.id}
                      onClick={() => handleSelectCustomer(c)}
                      style={{ padding: '12px 24px', borderBottom: i < customerResults.length - 1 ? '1px solid hsl(var(--pos-border))' : 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'hsl(var(--pos-card))'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(var(--pos-fg))' }}>{locale === 'ar' ? c.name_ar : (c.name_en || c.name_ar)}</div>
                        {locale === 'en' && c.name_ar && <div style={{ fontSize: '11px', color: 'hsl(var(--pos-muted))' }}>{c.name_ar}</div>}
                        {c.phone && <div style={{ fontSize: '11px', color: 'hsl(var(--pos-muted))' }}>{c.phone}</div>}
                      </div>
                      {c.national_id && <div style={{ fontSize: '11px', color: 'hsl(var(--pos-subtle))', fontFamily: 'monospace' }}>{c.national_id}</div>}
                    </div>
                  ))}
                </div>
                {/* Footer */}
                <div style={{ padding: '12px 24px', borderTop: '1px solid hsl(var(--pos-border))', flexShrink: 0 }}>
                  <button
                    onClick={() => setNewCustomerMode(true)}
                    style={{ width: '100%', padding: '9px', background: 'hsl(var(--pos-primary))', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600 }}
                  >
                    {locale === 'ar' ? '+ إضافة عميل جديد' : '+ Add New Customer'}
                  </button>
                </div>
              </div>
            ) : (
              /* New customer form */
              <div style={{ padding: '20px 24px', overflowY: 'auto' }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[
                  { key: 'name_ar', label: locale === 'ar' ? 'الاسم بالعربي *' : 'Name (Arabic) *', placeholder: 'محمد العمري', required: true },
                  { key: 'name_en', label: locale === 'ar' ? 'الاسم بالإنجليزي' : 'Name (English)', placeholder: 'Mohammed Al-Omari', required: false },
                  { key: 'phone', label: locale === 'ar' ? 'رقم الهاتف' : 'Phone', placeholder: '05xxxxxxxx', required: false },
                  { key: 'national_id', label: locale === 'ar' ? 'رقم الهوية / الإقامة' : 'National ID / Iqama', placeholder: '1xxxxxxxxx', required: false },
                ].map(({ key, label, placeholder, required }) => (
                  <div key={key} style={{ marginBottom: '14px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: '5px' }}>{label}</label>
                    <input
                      type="text"
                      value={newCustomerForm[key as keyof typeof newCustomerForm]}
                      onChange={(e) => setNewCustomerForm(prev => ({ ...prev, [key]: e.target.value }))}
                      placeholder={placeholder}
                      autoFocus={key === 'name_ar'}
                      style={{ width: '100%', padding: '8px 12px', background: 'hsl(var(--pos-input-bg))', border: `1px solid ${required && !newCustomerForm[key as keyof typeof newCustomerForm] ? 'hsl(var(--destructive))' : 'hsl(var(--pos-input-border))'}`, borderRadius: '4px', color: 'hsl(var(--pos-fg))', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button onClick={() => setNewCustomerMode(false)} style={{ flex: 1, padding: '9px', background: 'hsl(var(--pos-card))', color: 'hsl(var(--pos-fg))', border: '1px solid hsl(var(--pos-border))', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600 }}>
                    {locale === 'ar' ? 'رجوع' : 'Back'}
                  </button>
                  <button
                    onClick={handleSaveNewCustomer}
                    disabled={savingCustomer || !newCustomerForm.name_ar.trim()}
                    style={{ flex: 2, padding: '9px', background: 'hsl(var(--pos-primary))', color: '#fff', border: 'none', borderRadius: '4px', cursor: savingCustomer || !newCustomerForm.name_ar.trim() ? 'not-allowed' : 'pointer', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600, opacity: savingCustomer || !newCustomerForm.name_ar.trim() ? 0.6 : 1 }}
                  >
                    {savingCustomer ? (locale === 'ar' ? 'جاري الحفظ…' : 'Saving…') : (locale === 'ar' ? 'حفظ وربط بالمعاملة' : 'Save & Attach to Sale')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Tender Declaration dialog ── */}
      {tenderOpen && (
        <>
          <div onClick={() => setTenderOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '400px',
            background: 'hsl(var(--pos-surface))',
            border: '1px solid hsl(var(--pos-border))',
            borderRadius: '6px', zIndex: 10001,
            display: 'flex', flexDirection: 'column', maxHeight: '80vh',
          }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid hsl(var(--pos-border))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'hsl(var(--pos-fg))' }}>
                  {locale === 'ar' ? 'إعلان العطاء' : 'Tender Declaration'}
                </div>
                <div style={{ fontSize: '11px', color: 'hsl(var(--pos-muted))', marginTop: '2px' }}>
                  {locale === 'ar' ? 'أدخل المبلغ الفعلي في الدرج' : 'Enter actual cash in drawer'}
                </div>
              </div>
              <button onClick={() => setTenderOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--pos-muted))', display: 'flex' }}>
                <X style={{ width: '16px', height: '16px' }} />
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* Result after submission */}
              {tenderResult && (
                <div style={{
                  marginBottom: '16px', padding: '12px 16px', borderRadius: '4px',
                  background: tenderResult.status === 'BALANCED' ? 'hsl(142 71% 40% / 0.15)' : tenderResult.status === 'OVERAGE' ? 'hsl(38 92% 50% / 0.15)' : 'hsl(0 84% 60% / 0.15)',
                  border: `1px solid ${tenderResult.status === 'BALANCED' ? 'hsl(142 71% 40% / 0.4)' : tenderResult.status === 'OVERAGE' ? 'hsl(38 92% 50% / 0.4)' : 'hsl(0 84% 60% / 0.4)'}`,
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'hsl(var(--pos-fg))', marginBottom: '8px' }}>
                    {tenderResult.status === 'BALANCED' ? (locale === 'ar' ? '✓ متوازن' : '✓ Balanced') :
                     tenderResult.status === 'OVERAGE' ? (locale === 'ar' ? '▲ فائض' : '▲ Overage') :
                     (locale === 'ar' ? '▼ عجز' : '▼ Shortage')}
                  </div>
                  {[
                    [locale === 'ar' ? 'المبلغ المعلن' : 'Declared', formatCurrency(parseFloat(tenderResult.declared_cash), locale)],
                    [locale === 'ar' ? 'المبلغ المتوقع' : 'Expected', formatCurrency(parseFloat(tenderResult.expected_cash), locale)],
                    [locale === 'ar' ? 'الفرق' : 'Difference', formatCurrency(Math.abs(parseFloat(tenderResult.difference)), locale)],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span style={{ color: 'hsl(var(--pos-muted))' }}>{k}</span>
                      <span style={{ fontWeight: 600, color: 'hsl(var(--pos-fg))' }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Input */}
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: '6px' }}>
                {locale === 'ar' ? 'النقد الفعلي في الدرج (ر.س)' : 'Actual cash in drawer (SAR)'}
              </label>
              <input
                type="number" min="0" step="0.01"
                value={tenderInput}
                onChange={(e) => setTenderInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitTender(); }}
                autoFocus={!tenderResult}
                placeholder="0.00"
                style={{
                  width: '100%', padding: '10px 12px',
                  background: 'hsl(var(--pos-input-bg))', border: '1px solid hsl(var(--pos-input-border))',
                  borderRadius: '4px', color: 'hsl(var(--pos-fg))', fontSize: '18px', fontWeight: 600,
                  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: '12px',
                }}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={handleSubmitTender}
                disabled={submittingTender || !tenderInput}
                style={{ width: '100%', padding: '10px', background: 'hsl(var(--tile-orange))', color: '#fff', border: 'none', borderRadius: '4px', cursor: submittingTender || !tenderInput ? 'not-allowed' : 'pointer', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600, opacity: submittingTender || !tenderInput ? 0.6 : 1 }}
              >
                {submittingTender ? (locale === 'ar' ? 'جاري الحساب…' : 'Calculating…') : (locale === 'ar' ? 'إعلان' : 'Declare')}
              </button>

              {/* History */}
              {tenderHistory.length > 0 && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em', margin: '16px 0 8px' }}>
                    {locale === 'ar' ? 'السجل' : 'History'}
                  </div>
                  {tenderHistory.map((h) => {
                    const diff = parseFloat(h.difference);
                    const raw = h.declared_at.endsWith('Z') ? h.declared_at : h.declared_at + 'Z';
                    const d = new Date(raw);
                    const at = isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px', padding: '6px 0', borderBottom: '1px solid hsl(var(--pos-border))' }}>
                        <span style={{ color: 'hsl(var(--pos-muted))' }}>{at}</span>
                        <span style={{ color: 'hsl(var(--pos-muted))' }}>{locale === 'ar' ? 'معلن' : 'Declared'}: {formatCurrency(parseFloat(h.declared_cash), locale)}</span>
                        <span style={{ fontWeight: 600, color: diff === 0 ? 'hsl(var(--success))' : diff > 0 ? 'hsl(38 92% 60%)' : 'hsl(var(--destructive))' }}>
                          {diff === 0 ? '=' : diff > 0 ? `+${formatCurrency(diff, locale)}` : `-${formatCurrency(Math.abs(diff), locale)}`}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Declare start amount dialog ── */}
      {floatDialogOpen && (
        <>
          <div onClick={() => { if (!openingShift) { setFloatDialogOpen(false); setFloatInput(''); } }} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '340px',
            background: 'hsl(var(--pos-surface))',
            border: '1px solid hsl(var(--pos-border))',
            borderRadius: '6px', zIndex: 10001,
            padding: '24px',
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'hsl(var(--pos-fg))', marginBottom: '6px' }}>
              {locale === 'ar' ? 'إعلان الرصيد الافتتاحي' : 'Declare Start Amount'}
            </div>
            <div style={{ fontSize: '12px', color: 'hsl(var(--pos-muted))', marginBottom: '20px' }}>
              {locale === 'ar' ? 'أدخل مبلغ النقد الموجود في الدرج قبل بدء الوردية' : 'Enter the cash amount in the drawer before starting your shift'}
            </div>

            <label style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: '6px' }}>
              {locale === 'ar' ? 'المبلغ الافتتاحي (ر.س)' : 'Opening float (SAR)'}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={floatInput}
              onChange={(e) => setFloatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleOpenShift(); if (e.key === 'Escape') { setFloatDialogOpen(false); setFloatInput(''); } }}
              autoFocus
              placeholder="0.00"
              style={{
                width: '100%', padding: '10px 12px',
                background: 'hsl(var(--pos-input-bg))', border: '1px solid hsl(var(--pos-input-border))',
                borderRadius: '4px', color: 'hsl(var(--pos-fg))', fontSize: '18px', fontWeight: 600,
                fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: '20px',
                MozAppearance: 'textfield',
              }}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => { setFloatDialogOpen(false); setFloatInput(''); }}
                disabled={openingShift}
                style={{ flex: 1, padding: '10px', background: 'hsl(var(--pos-card))', color: 'hsl(var(--pos-fg))', border: '1px solid hsl(var(--pos-border))', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600 }}
              >
                {locale === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={handleOpenShift}
                disabled={openingShift}
                style={{ flex: 1, padding: '10px', background: 'hsl(var(--tile-orange))', color: '#fff', border: 'none', borderRadius: '4px', cursor: openingShift ? 'not-allowed' : 'pointer', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600, opacity: openingShift ? 0.7 : 1 }}
              >
                {openingShift ? (locale === 'ar' ? 'جاري الفتح…' : 'Opening…') : (locale === 'ar' ? 'بدء الوردية' : 'Start shift')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Reprint Z — session picker dialog ── */}
      {reprintZOpen && (
        <>
          <div onClick={() => setReprintZOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '460px', maxHeight: '75vh',
            background: 'hsl(var(--pos-surface))',
            border: '1px solid hsl(var(--pos-border))',
            borderRadius: '6px', zIndex: 10001,
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid hsl(var(--pos-border))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'hsl(var(--pos-fg))' }}>
                  {locale === 'ar' ? 'إعادة طباعة تقرير Z' : 'Reprint Z-Report'}
                </div>
                <div style={{ fontSize: '11px', color: 'hsl(var(--pos-muted))', marginTop: '2px' }}>
                  {locale === 'ar' ? 'اختر وردية مغلقة' : 'Select a closed shift'}
                </div>
              </div>
              <button onClick={() => setReprintZOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--pos-muted))', padding: '4px', display: 'flex' }}>
                <X style={{ width: '16px', height: '16px' }} />
              </button>
            </div>

            {/* List */}
            <div style={{ overflowY: 'auto', flex: 1 }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {reprintZLoading && (
                <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--pos-muted))', fontSize: '13px' }}>
                  {locale === 'ar' ? 'جاري التحميل…' : 'Loading…'}
                </div>
              )}
              {!reprintZLoading && reprintZSessions.length === 0 && (
                <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--pos-muted))', fontSize: '13px' }}>
                  {locale === 'ar' ? 'لا توجد وردية مغلقة' : 'No closed shifts found'}
                </div>
              )}
              {!reprintZLoading && reprintZSessions.map((s, i) => {
                const openedAt = new Date(s.opened_at.endsWith('Z') ? s.opened_at : s.opened_at + 'Z');
                const closedAt = s.closed_at ? new Date(s.closed_at.endsWith('Z') ? s.closed_at : s.closed_at + 'Z') : null;
                const dateStr = openedAt.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-SA', { year: 'numeric', month: 'short', day: 'numeric' });
                const openTime = openedAt.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
                const closeTime = closedAt ? closedAt.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
                return (
                  <div
                    key={s.id}
                    onClick={() => printZFromSession(s.id)}
                    style={{
                      padding: '12px 24px',
                      borderBottom: i < reprintZSessions.length - 1 ? '1px solid hsl(var(--pos-border))' : 'none',
                      cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'hsl(var(--pos-card))'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(var(--pos-fg))' }}>{dateStr}</div>
                      <div style={{ fontSize: '11px', color: 'hsl(var(--pos-muted))', marginTop: '2px' }}>
                        {openTime} → {closeTime}
                      </div>
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(var(--pos-fg))' }}>
                        {parseFloat(s.total_revenue).toFixed(3)} SAR
                      </div>
                      <div style={{ fontSize: '11px', color: 'hsl(var(--pos-muted))', marginTop: '2px' }}>
                        {s.total_sales} {locale === 'ar' ? 'مبيعة' : 'sales'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Show Journal dialog ── */}
      {journalOpen && (
        <>
          <div onClick={() => setJournalOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '520px', maxHeight: '80vh',
            background: 'hsl(var(--pos-surface))',
            border: '1px solid hsl(var(--pos-border))',
            borderRadius: '6px', zIndex: 10001,
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid hsl(var(--pos-border))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'hsl(var(--pos-fg))' }}>
                  {locale === 'ar' ? 'سجل الوردية' : 'Shift Journal'}
                </div>
                <div style={{ fontSize: '11px', color: 'hsl(var(--pos-muted))', marginTop: '2px' }}>
                  {activeSession ? (() => {
                    try {
                      const raw = activeSession.opened_at;
                      const d = new Date(raw.endsWith('Z') ? raw : raw + 'Z');
                      return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
                    } catch { return ''; }
                  })() : ''}
                  {' · '}
                  {journalLoading ? (locale === 'ar' ? 'جاري التحميل…' : 'Loading…') : `${journalSales.length} ${locale === 'ar' ? 'معاملة' : 'transactions'}`}
                </div>
              </div>
              <button onClick={() => setJournalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--pos-muted))', padding: '4px', display: 'flex' }}>
                <X style={{ width: '16px', height: '16px' }} />
              </button>
            </div>

            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: '0', padding: '8px 24px', background: 'hsl(var(--pos-card))', flexShrink: 0 }}>
              {[
                locale === 'ar' ? 'الوقت' : 'Time',
                locale === 'ar' ? 'رقم الفاتورة' : 'Invoice',
                locale === 'ar' ? 'طريقة الدفع' : 'Payment',
                locale === 'ar' ? 'المبلغ' : 'Amount',
              ].map((h) => (
                <span key={h} style={{ fontSize: '10px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em' }}>{h}</span>
              ))}
            </div>

            {/* Rows */}
            <div style={{ overflowY: 'auto', flex: 1 }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {journalLoading && (
                <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--pos-muted))', fontSize: '13px' }}>
                  {locale === 'ar' ? 'جاري التحميل…' : 'Loading…'}
                </div>
              )}
              {!journalLoading && journalSales.length === 0 && (
                <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--pos-muted))', fontSize: '13px' }}>
                  {locale === 'ar' ? 'لا توجد مبيعات في هذه الوردية' : 'No sales in this shift'}
                </div>
              )}
              {!journalLoading && journalSales.map((sale, i) => {
                const soldAt = new Date(sale.sold_at.endsWith('Z') ? sale.sold_at : sale.sold_at + 'Z');
                const timeStr = soldAt.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
                return (
                  <div
                    key={sale.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr',
                      gap: '0', padding: '10px 24px',
                      borderBottom: i < journalSales.length - 1 ? '1px solid hsl(var(--pos-border))' : 'none',
                      background: i % 2 === 0 ? 'transparent' : 'hsl(var(--pos-card) / 0.4)',
                    }}
                  >
                    <span style={{ fontSize: '12px', color: 'hsl(var(--pos-muted))' }}>{timeStr}</span>
                    <span style={{ fontSize: '12px', color: 'hsl(var(--pos-fg))', fontFamily: 'monospace' }}>{sale.invoice_number}</span>
                    <span style={{ fontSize: '12px', color: 'hsl(var(--pos-muted))', textTransform: 'capitalize' }}>{sale.payment_method}</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'hsl(var(--pos-fg))' }}>{formatCurrency(parseFloat(sale.total_amount), locale)}</span>
                  </div>
                );
              })}
            </div>

            {/* Footer totals */}
            {!journalLoading && journalSales.length > 0 && (
              <div style={{ padding: '12px 24px', borderTop: '1px solid hsl(var(--pos-border))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: 'hsl(var(--pos-card))' }}>
                <span style={{ fontSize: '12px', color: 'hsl(var(--pos-muted))' }}>
                  {journalSales.length} {locale === 'ar' ? 'معاملة' : 'transactions'}
                </span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'hsl(var(--pos-fg))' }}>
                  {formatCurrency(journalSales.reduce((s, r) => s + parseFloat(r.total_amount), 0), locale)}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Z-Report dialog ── */}
      {zReportOpen && zReport && (
        <>
          <div onClick={() => setZReportOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '420px', maxHeight: '80vh', overflow: 'auto',
            background: 'hsl(var(--pos-surface))',
            border: '1px solid hsl(var(--pos-border))',
            borderRadius: '6px', zIndex: 10001,
            padding: '24px',
          }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* Header */}
            <div style={{ marginBottom: '16px', borderBottom: '1px solid hsl(var(--pos-border))', paddingBottom: '12px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'hsl(var(--pos-fg))' }}>
                {locale === 'ar' ? 'تقرير Z — إغلاق الوردية' : 'Z-Report — Shift Close'}
              </div>
              <div style={{ fontSize: '12px', color: 'hsl(var(--pos-muted))', marginTop: '4px' }}>
                {locale === 'ar' ? zReport.branch_name_ar : zReport.branch_name_en} · {zReport.pharmacist_name}
              </div>
            </div>

            {/* Times */}
            {([
              [locale === 'ar' ? 'بدأت' : 'Opened', new Date((zReport.opened_at.endsWith('Z') ? zReport.opened_at : zReport.opened_at + 'Z')).toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' })],
              [locale === 'ar' ? 'أُغلقت' : 'Closed', zReport.closed_at ? new Date((zReport.closed_at.endsWith('Z') ? zReport.closed_at : zReport.closed_at + 'Z')).toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '—'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: 'hsl(var(--pos-muted))' }}>{k}</span>
                <span style={{ color: 'hsl(var(--pos-fg))' }}>{v}</span>
              </div>
            ))}

            <div style={{ margin: '12px 0', borderBottom: '1px dashed hsl(var(--pos-border))' }} />

            {/* Totals */}
            {([
              [locale === 'ar' ? 'عدد المبيعات' : 'Total Sales', String(zReport.total_sales)],
              [locale === 'ar' ? 'الإيراد' : 'Revenue', formatCurrency(parseFloat(zReport.total_revenue), locale)],
              [locale === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT', formatCurrency(parseFloat(zReport.total_vat), locale)],
              [locale === 'ar' ? 'صافي الإيراد' : 'Net Revenue', formatCurrency(parseFloat(zReport.total_revenue) - parseFloat(zReport.total_vat), locale)],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: 'hsl(var(--pos-muted))' }}>{k}</span>
                <span style={{ fontWeight: 600, color: 'hsl(var(--pos-fg))' }}>{v}</span>
              </div>
            ))}

            {/* Payment breakdown */}
            {zReport.payment_breakdown.length > 0 && (
              <>
                <div style={{ margin: '12px 0', borderBottom: '1px dashed hsl(var(--pos-border))' }} />
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'hsl(var(--pos-subtle))', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '8px' }}>
                  {locale === 'ar' ? 'توزيع طرق الدفع' : 'Payment Breakdown'}
                </div>
                {zReport.payment_breakdown.map((p) => (
                  <div key={p.method} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px' }}>
                    <span style={{ color: 'hsl(var(--pos-muted))' }}>{p.method} ({p.count})</span>
                    <span style={{ color: 'hsl(var(--pos-fg))' }}>{formatCurrency(parseFloat(p.total), locale)}</span>
                  </div>
                ))}
              </>
            )}

            {/* Actions */}
            <div style={{ marginTop: '20px', display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setZReportOpen(false)}
                style={{ flex: 1, padding: '10px', background: 'hsl(var(--pos-card))', color: 'hsl(var(--pos-fg))', border: '1px solid hsl(var(--pos-border))', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600 }}
              >
                {locale === 'ar' ? 'إغلاق' : 'Close'}
              </button>
              <button
                onClick={() => {
                  const w = window.open('', '_blank', 'width=400,height=600');
                  if (!w) return;
                  w.document.write(`<html><head><title>Z-Report</title><style>body{font-family:sans-serif;padding:20px;font-size:13px}h2{margin-bottom:4px}p{margin:2px 0;color:#666}.row{display:flex;justify-content:space-between;margin:4px 0}.bold{font-weight:700}hr{border:none;border-top:1px dashed #ccc;margin:10px 0}</style></head><body><h2>Z-Report</h2><p>${zReport.pharmacist_name} · ${locale === 'ar' ? zReport.branch_name_ar : zReport.branch_name_en}</p><hr><div class="row"><span>Total Sales</span><span class="bold">${zReport.total_sales}</span></div><div class="row"><span>Revenue</span><span class="bold">${zReport.total_revenue}</span></div><div class="row"><span>VAT</span><span>${zReport.total_vat}</span></div><hr>${zReport.payment_breakdown.map(p => `<div class="row"><span>${p.method} (${p.count})</span><span>${p.total}</span></div>`).join('')}<script>window.print();window.close()<\/script></body></html>`);
                  w.document.close();
                }}
                style={{ flex: 1, padding: '10px', background: 'hsl(var(--pos-primary))', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600 }}
              >
                {locale === 'ar' ? 'طباعة' : 'Print'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
