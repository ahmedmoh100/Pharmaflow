'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/app/i18n/navigation';
import { PAYMENT_METHODS, lookupName } from '@/app/lib/mock-data';
import { useSession } from '@/app/lib/auth';
import type { PaymentMethod } from '@/app/lib/types';
import { formatCurrency, buildZatcaTlv, formatHijriDate } from '@/app/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ZatcaQR } from '@/components/shared/ZatcaQR';
import QRCode from 'qrcode';
import { api, type ApiMedicine, type PaginatedResponse, type ApiSaleResponse } from '@/app/lib/api';
import { Trash2, Minus, Plus, CheckCircle, Ban, Search, ShoppingCart, MoreHorizontal, MessageSquare, Tag, DollarSign, X } from 'lucide-react';

/** Cart line uses ApiMedicine — selling_price is a string from the API */
interface CartLine {
  medicine: ApiMedicine;
  quantity: number;
}

const VAT_RATE = 0.15;

const S = {
  bg: 'hsl(222 47% 7%)', surface: 'hsl(222 47% 10%)', card: 'hsl(222 40% 14%)',
  border: 'hsl(217 33% 20%)', fg: 'hsl(210 40% 98%)', muted: 'hsl(215 20% 65%)',
  subtle: 'hsl(215 16% 47%)', input: 'hsl(217 33% 17%)', inBdr: 'hsl(217 33% 22%)',
  primary: 'hsl(201 96% 40%)', danger: 'hsl(0 84% 60%)', warn: 'hsl(38 92% 50%)',
  success: 'hsl(142 71% 40%)', accent: 'hsl(184 82% 35%)',
};

export default function NewSalePage() {
  const t = useTranslations('sales');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const { user } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ApiMedicine[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [amountFlash, setAmountFlash] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [sessionOpen, setSessionOpen] = useState<boolean | null>(null); // null = loading

  // Check if shift is open on mount
  useEffect(() => {
    api.get<{ status: string }>('/sessions/current')
      .then((s) => setSessionOpen(s.status === 'OPEN'))
      .catch(() => setSessionOpen(false));
  }, []);

  /* ── Split payment lines ── */
  type PayLine = { method: PaymentMethod; amount: string };
  const [payLines, setPayLines] = useState<PayLine[]>([{ method: 'cash', amount: '' }]);

  // Derived: total tendered across all lines
  const tendered = payLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  // Primary method = line with highest amount (or first)
  const primaryMethod: PaymentMethod = payLines.reduce(
    (best, l) => (parseFloat(l.amount) || 0) >= (parseFloat(payLines.find(x => x.method === best)?.amount || '0') || 0) ? l.method : best,
    payLines[0]?.method ?? 'cash'
  );
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptInvoice, setReceiptInvoice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [blockedMed, setBlockedMed] = useState<{ name: string; reason: 'outOfStock' } | null>(null);
  const [rxConfirmOpen, setRxConfirmOpen] = useState(false);
  const [rxItems, setRxItems] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  /* One idempotency key per page load — resets when receipt closes */
  const idempotencyKey = useRef(crypto.randomUUID());

  /* ── Line actions state ── */
  const [lineMenuId, setLineMenuId] = useState<string | null>(null);
  const [discountModal, setDiscountModal] = useState<{ id: string; name: string; current: number } | null>(null);
  const [priceModal, setPriceModal] = useState<{ id: string; name: string; original: number; current: number } | null>(null);
  const [commentModal, setCommentModal] = useState<{ id: string; name: string } | null>(null);
  const [lineComments, setLineComments] = useState<Record<string, string>>({});
  const [lineDiscounts, setLineDiscounts] = useState<Record<string, number>>({}); // pct 0-100
  const [linePrices, setLinePrices] = useState<Record<string, number>>({}); // override price
  const [discountInput, setDiscountInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [commentInput, setCommentInput] = useState('');

  /* ── Global discount (applies to entire order) ── */
  const [globalDiscountPct, setGlobalDiscountPct] = useState(0); // percent 0-100

  /* ── Coupon discount ── */
  const [couponCode, setCouponCode] = useState('');
  const [couponValidation, setCouponValidation] = useState<{ id: string; code: string; discount_type: string; discount_value: number; is_valid: boolean; reason_invalid?: string } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');

  async function validateCoupon(code: string) {
    if (!code.trim()) {
      setCouponValidation(null);
      setCouponError('');
      return;
    }
    
    setCouponLoading(true);
    setCouponError('');
    try {
      const res = await fetch(`${API_BASE}/coupons/validate/${encodeURIComponent(code.toUpperCase())}`, {
        headers: { Authorization: `Bearer ${user?.token}` },
      });
      const data = await res.json();
      
      if (!res.ok) {
        setCouponError(locale === 'ar' ? 'الكوبون غير موجود' : 'Coupon not found');
        setCouponValidation(null);
      } else {
        setCouponValidation(data);
        if (!data.is_valid) {
          setCouponError(data.reason_invalid || (locale === 'ar' ? 'الكوبون غير صحيح' : 'Invalid coupon'));
        } else {
          setCouponError('');
        }
      }
    } catch (err) {
      setCouponError(locale === 'ar' ? 'خطأ في التحقق' : 'Validation error');
      setCouponValidation(null);
    } finally {
      setCouponLoading(false);
    }
  }

  /* ── Parked transactions (Hold / Suspend / Recall) ── */
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
  const [parking, setParking] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  const [parkedList, setParkedList] = useState<{ id: string; parked_at: string; item_count: number; total: number; cart: { medicine_id: string; name_en: string; name_ar: string; quantity: number; unit_price: number; batch_id: string }[] }[]>([]);
  const [parkedCount, setParkedCount] = useState(0);
  const sessionIdRef = useRef<string | null>(null);

  /* ── Customer attached to this transaction ── */
  const [attachedCustomer, setAttachedCustomer] = useState<{ id: string; name: string } | null>(null);

  // Fetch current session_id once on mount
  useEffect(() => {
    if (!user?.token) return;
    fetch(`${API_BASE}/sessions/current`, {
      headers: { Authorization: `Bearer ${user.token}` },
    }).then(r => r.ok ? r.json() : null).then(s => { if (s?.id) sessionIdRef.current = s.id; }).catch(() => null);
  }, [user?.token, API_BASE]);

  // Load parked count on mount
  useEffect(() => {
    if (!user?.token) return;
    fetch(`${API_BASE}/parked`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.items) setParkedCount(d.items.length); })
      .catch(() => null);
  }, [user?.token, API_BASE]);

  async function handlePark() {
    if (!user || parking || cart.length === 0) return;
    setParking(true);
    try {
      const cartPayload = cart.map(line => ({
        medicine_id: line.medicine.id,
        name_en: line.medicine.name_en,
        name_ar: line.medicine.name_ar,
        quantity: line.quantity,
        unit_price: effectivePrice(line),
        batch_id: '',  // restored from FIFO on checkout
        vat_rate: line.medicine.vat_category === 'standard' ? 0.15 : 0,
        discount_pct: lineDiscounts[line.medicine.id] ?? 0,
        line_comment: lineComments[line.medicine.id] ?? '',
      }));
      const res = await fetch(`${API_BASE}/parked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ cart: cartPayload, session_id: sessionIdRef.current }),
      });
      if (!res.ok) throw new Error('Failed to park');
      setCart([]); setSearch(''); setPaymentMethod('cash'); setPayLines([{ method: 'cash', amount: '' }]);
      setLineDiscounts({}); setLinePrices({}); setLineComments({});
      setParkedCount(c => c + 1);
      toast({ title: locale === 'ar' ? 'تم تعليق المعاملة' : 'Transaction parked' });
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في التعليق' : 'Failed to park', variant: 'destructive' });
    } finally {
      setParking(false);
    }
  }

  async function openRecall() {
    if (!user) return;
    const res = await fetch(`${API_BASE}/parked`, { headers: { Authorization: `Bearer ${user.token}` } });
    const data = res.ok ? await res.json() : null;
    setParkedList(data?.items ?? []);
    setRecallOpen(true);
  }

  async function handleRecall(parkedId: string) {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE}/parked/${parkedId}/recall`, {
        method: 'POST', headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      // Restore cart — fetch medicine details for each item
      const restored: CartLine[] = [];
      for (const item of data.cart) {
        const med = await api.get<ApiMedicine>(`/medicines/${item.medicine_id}`).catch(() => null);
        if (med) {
          restored.push({ medicine: { ...med, selling_price: String(item.unit_price) }, quantity: item.quantity });
          if (item.discount_pct) setLineDiscounts(prev => ({ ...prev, [item.medicine_id]: item.discount_pct }));
          if (item.line_comment) setLineComments(prev => ({ ...prev, [item.medicine_id]: item.line_comment }));
        }
      }
      setCart(restored);
      setParkedCount(c => Math.max(0, c - 1));
      setRecallOpen(false);
      toast({ title: locale === 'ar' ? 'تم استرجاع المعاملة' : 'Transaction recalled' });
    } catch {
      toast({ title: locale === 'ar' ? 'خطأ في الاسترجاع' : 'Recall failed', variant: 'destructive' });
    }
  }

  async function handleVoidParked(parkedId: string) {
    if (!user) return;
    await fetch(`${API_BASE}/parked/${parkedId}/void`, {
      method: 'POST', headers: { Authorization: `Bearer ${user.token}` },
    });
    setParkedList(prev => prev.filter(p => p.id !== parkedId));
    setParkedCount(c => Math.max(0, c - 1));
  }

  /* ── Debounced medicine search against real API ── */
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback((q: string) => {
    if (!q.trim()) { setSearchResults([]); setSearchLoading(false); return; }
    setSearchLoading(true);
    const branchParam = user?.branch_id ? `&branch_id=${user.branch_id}` : '';
    api.get<PaginatedResponse<ApiMedicine>>(`/medicines?search=${encodeURIComponent(q)}&page_size=8&is_active=true${branchParam}`)
      .then((res) => setSearchResults(res.items))
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false));
  }, [user?.branch_id]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!search.trim()) { setSearchResults([]); setSearchLoading(false); return; }
    // Wait for session to load before searching — need branch_id for accurate stock
    if (!user?.branch_id) { setSearchLoading(false); return; }
    setSearchLoading(true);
    searchTimeout.current = setTimeout(() => runSearch(search), 250);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [search, runSearch, user?.branch_id]);

  /* ── Pre-add medicine from global search (?add=medicineId) ── */
  // Track which add param we've already handled to prevent strict-mode double-fire
  // Auto-open recall dialog when navigated here with ?recall=1
  useEffect(() => {
    const val = searchParams?.get('recall');
    if (val && val !== '0' && user?.token) openRecall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.get('recall'), user?.token]);

  // Attach customer from URL params (?customer_id=...&customer_name=...)
  useEffect(() => {
    const cid = searchParams?.get('customer_id');
    const cname = searchParams?.get('customer_name');
    if (cid && cname) setAttachedCustomer({ id: cid, name: decodeURIComponent(cname) });
  }, [searchParams?.get('customer_id'), searchParams?.get('customer_name')]);

  const handledAddRef = useRef<string | null>(null);
  useEffect(() => {
    const addId = searchParams?.get('add');
    if (!addId) return;
    if (!user?.branch_id) return;
    // Same ID already handled in this render cycle (strict mode fires twice)
    if (handledAddRef.current === addId) return;
    handledAddRef.current = addId;
    api.get<ApiMedicine>(`/medicines/${addId}`)
      .then((med) => addToCart(med))
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.get('add'), user?.branch_id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inInput = ['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName);
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F4') { e.preventDefault(); if (cart.length > 0 && !receiptOpen && !rxConfirmOpen && !blockedMed && !submitting) handleCheckout(); }
      if (e.ctrlKey && e.key === 'p' && receiptOpen) { e.preventDefault(); handlePrint(); }
      if (e.key === 'Escape' && search.trim()) { e.preventDefault(); setSearch(''); setSearchResults([]); searchRef.current?.blur(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, receiptOpen, rxConfirmOpen, blockedMed, submitting, search]);

  function addToCart(med: ApiMedicine) {
    // Don't block on stock_quantity here — it's a cross-branch cache.
    // The backend FIFO will reject with a clear message if this branch has no stock.
    setCart((prev) => {
      const ex = prev.find((c) => c.medicine.id === med.id);
      if (ex) return prev.map((c) => c.medicine.id === med.id ? { ...c, quantity: c.quantity + 1 } : c);
      setLastAddedId(med.id);
      return [...prev, { medicine: med, quantity: 1 }];
    });
    setSearch('');
  }

  function updateQty(id: string, delta: number) {
    setCart((prev) => prev.map((c) => c.medicine.id === id ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter((c) => c.quantity > 0));
  }

  function removeFromCart(id: string) { setCart((prev) => prev.filter((c) => c.medicine.id !== id)); }

  /* ── Effective price per line (override → discount → original) ── */
  function effectivePrice(c: CartLine): number {
    const basePrice = parseFloat(c.medicine.selling_price);
    if (linePrices[c.medicine.id] !== undefined) return linePrices[c.medicine.id];
    const disc = lineDiscounts[c.medicine.id];
    if (disc) return Math.round(basePrice * (1 - disc / 100) * 100) / 100;
    return basePrice;
  }

  const subtotalBeforeGlobalDiscount = Math.round(cart.reduce((s, c) => s + effectivePrice(c) * c.quantity, 0) * 100) / 100;
  const globalDiscountAmount = Math.round(subtotalBeforeGlobalDiscount * (globalDiscountPct / 100) * 100) / 100;
  const couponDiscount = couponValidation && couponValidation.is_valid
    ? couponValidation.discount_type === 'percentage'
      ? Math.round((subtotalBeforeGlobalDiscount - globalDiscountAmount) * (couponValidation.discount_value / 100) * 100) / 100
      : Math.min(couponValidation.discount_value, subtotalBeforeGlobalDiscount - globalDiscountAmount)
    : 0;
  const subtotal = Math.round((subtotalBeforeGlobalDiscount - globalDiscountAmount - couponDiscount) * 100) / 100;
  const vatAmount = Math.round(cart.reduce((s, c) => {
    const r = c.medicine.vat_category === 'zero_rated' || c.medicine.vat_category === 'exempt' ? 0 : VAT_RATE;
    return s + effectivePrice(c) * c.quantity * r;
  }, 0) * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;

  // Flash AMOUNT DUE on total change
  useEffect(() => {
    if (total === 0) return;
    setAmountFlash(true);
  }, [total]);

  const vatBreakdown = Array.from(
    cart.reduce((map, c) => {
      const r = c.medicine.vat_category === 'zero_rated' || c.medicine.vat_category === 'exempt' ? 0 : VAT_RATE;
      const lineAmt = Math.round(effectivePrice(c) * c.quantity * 100) / 100;
      const lineVat = Math.round(lineAmt * r * 100) / 100;
      const ex = map.get(r) ?? { taxable_amount: 0, vat_amount: 0 };
      map.set(r, { taxable_amount: Math.round((ex.taxable_amount + lineAmt) * 100) / 100, vat_amount: Math.round((ex.vat_amount + lineVat) * 100) / 100 });
      return map;
    }, new Map<number, { taxable_amount: number; vat_amount: number }>())
  ).map(([rate, v]) => ({ rate, ...v }));

  function handleCheckout() {
    if (cart.length === 0 || submitting) return;
    const rxRequired = cart.filter((c) => c.medicine.requires_prescription).map((c) => locale === 'ar' ? c.medicine.name_ar : c.medicine.name_en);
    if (rxRequired.length > 0) { setRxItems(rxRequired); setRxConfirmOpen(true); return; }
    completeSale();
  }

  async function completeSale() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        branch_id: user?.branch_id ?? '',
        payment_method: primaryMethod,
        payment_lines: payLines.filter(l => parseFloat(l.amount) > 0),
        notes: '',
        customer_id: attachedCustomer?.id ?? null,
        customer_name: attachedCustomer?.name ?? '',
        coupon_code: couponValidation?.is_valid ? couponCode : null,  // NEW: include coupon code
        items: cart.map((c) => ({
          medicine_id: c.medicine.id,
          quantity: c.quantity,
          unit_price: effectivePrice(c).toFixed(3),
        })),
      };
      const result = await api.post<ApiSaleResponse>(
        '/sales',
        payload,
        { 'X-Idempotency-Key': idempotencyKey.current },
      );
      setReceiptInvoice(result.invoice_number);
      setReceiptOpen(true);
      toast({ title: t('checkoutSuccess') });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sale failed';
      toast({ title: locale === 'ar' ? 'فشل البيع' : 'Sale failed', description: msg, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePrint() {
    const dir = locale === 'ar' ? 'rtl' : 'ltr';
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const branchName = user?.branch_name_en && user?.branch_name_ar
      ? (locale === 'ar' ? user.branch_name_ar : user.branch_name_en)
      : (user?.branch_id ?? '');
    const now = new Date();
    const dateStr = now.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-SA', { year: 'numeric', month: 'short', day: 'numeric' });
    const hijriStr = formatHijriDate(now.toISOString());
    const timeStr = now.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-SA', { hour: '2-digit', minute: '2-digit' });
    const L = locale === 'ar'
      ? { invoice:'رقم الفاتورة', ph:'الصيدلي', pay:'طريقة الدفع', med:'الدواء', qty:'الكمية', tot:'الإجمالي', sub:'المجموع الفرعي', vat:'ضريبة القيمة المضافة', grand:'الإجمالي النهائي' }
      : { invoice:'Invoice #', ph:'Pharmacist', pay:'Payment', med:'Medicine', qty:'Qty', tot:'Total', sub:'Subtotal', vat:'VAT', grand:'Grand Total' };
    const tlv = buildZatcaTlv({ sellerName:'PharmaFlow Demo', vatNumber:'311111111111113', timestamp: new Date().toISOString(), totalWithVat: total, vatTotal: vatAmount });
    const qr = await QRCode.toDataURL(tlv, { width:96, margin:1, errorCorrectionLevel:'M' });
    const rows = cart.map((c) => {
      const name = esc(locale === 'ar' ? c.medicine.name_ar : c.medicine.name_en);
      const lineTotal = esc(formatCurrency(effectivePrice(c) * c.quantity, locale));
      const discPct = lineDiscounts[c.medicine.id];
      const discLine = discPct ? `<div class="row muted" style="font-size:10px"><span class="item-name">${locale === 'ar' ? 'خصم' : 'Discount'} ${discPct}%</span><span>−${esc(formatCurrency(parseFloat(c.medicine.selling_price) * c.quantity * discPct / 100, locale))}</span></div>` : '';
      return `<div class="row"><span class="item-name">${name} x${c.quantity}</span><span>${lineTotal}</span></div>${discLine}`;
    }).join('');
    const vatRows = vatBreakdown.map(({ rate, vat_amount }) =>
      `<div class="row"><span>${L.vat} (${(rate * 100).toFixed(0)}%)</span><span>${esc(formatCurrency(vat_amount, locale))}</span></div>`
    ).join('');
    const validPayLines = payLines.filter(l => parseFloat(l.amount) > 0);
    const paymentRows = validPayLines.length > 0
      ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin:6px 0 4px;color:#666">${locale === 'ar' ? 'طرق الدفع' : 'Payment Methods'}</div>` +
        validPayLines.map(line => {
          const method = payTiles.find(pt => pt.code === line.method);
          return `<div class="row"><span>${locale === 'ar' ? method?.labelAr : method?.label}</span><span>${esc(formatCurrency(parseFloat(line.amount), locale))}</span></div>`;
        }).join('')
      : `<div class="row"><span>${L.pay}</span><span>${esc(lookupName(PAYMENT_METHODS, primaryMethod, locale))}</span></div>`;
    const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${locale}">
<head>
<meta charset="UTF-8"/>
<title>${esc(receiptInvoice)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 76mm;
    margin: 0 auto;
    padding: 8px 6px;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 11px;
    line-height: 1.5;
    color: #000;
    background: #fff;
  }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; margin-bottom: 2px; }
  .item-name { flex: 1; padding-inline-end: 8px; }
  .grand { font-size: 14px; font-weight: 700; }
  .muted { color: #555; }
  .qr { display: block; margin: 10px auto 2px; }
  @media print {
    body { width: 100%; }
  }
</style>
</head>
<body>
  <div class="center" style="padding:8px 0 6px;border-bottom:2px solid #000;margin-bottom:8px">
    <img src="${window.location.origin}/logo.png" style="height:80px;width:auto;filter:brightness(0)" alt="PharmaFlow"/>
  </div>
  <div class="row" style="margin-bottom:2px">
    <span class="muted">${branchName ? esc(branchName) : 'PharmaFlow'}</span>
    <span class="muted">${esc(dateStr)}</span>
  </div>
  <div class="row" style="margin-bottom:2px">
    <span class="muted">VAT: 311111111111113</span>
    <span class="muted">${esc(timeStr)}</span>
  </div>
  <div class="center muted" style="font-size:10px;margin-bottom:4px">${dir === 'rtl' ? 'فاتورة ضريبية مبسطة' : 'Simplified Tax Invoice'}</div>
  <hr class="hr"/>
  <div class="row"><span class="muted">${L.invoice}</span><span class="bold">${esc(receiptInvoice)}</span></div>
  <div class="row"><span class="muted">${L.ph}</span><span>${esc(user?.full_name ?? '-')}</span></div>
  ${attachedCustomer ? `<div class="row"><span class="muted">${locale === 'ar' ? 'العميل' : 'Customer'}</span><span>${esc(attachedCustomer.name)}</span></div>` : ''}
  <hr class="hr"/>
  ${rows}
  <hr class="hr"/>
  ${paymentRows}
  <hr class="hr"/>
  <hr class="hr"/>
  <div class="row"><span class="muted">${L.sub}</span><span>${esc(formatCurrency(subtotalBeforeGlobalDiscount, locale))}</span></div>
  ${globalDiscountAmount > 0 ? `<div class="row"><span class="muted">${locale === 'ar' ? 'خصم' : 'Discount'} (${globalDiscountPct}%)</span><span>−${esc(formatCurrency(globalDiscountAmount, locale))}</span></div>` : ''}
  ${couponDiscount > 0 ? `<div class="row"><span class="muted">${locale === 'ar' ? 'كوبون' : 'Coupon'} (${esc(couponCode)})</span><span>−${esc(formatCurrency(couponDiscount, locale))}</span></div>` : ''}
  ${vatRows}
  <hr class="hr"/>
  <div class="row grand"><span>${L.grand}</span><span>${esc(formatCurrency(total, locale))}</span></div>
  <hr class="hr"/>
  <div class="center"><img class="qr" src="${qr}" width="96" height="96"/></div>
  <div class="center muted" style="font-size:10px;margin-top:2px">ZATCA QR</div>
<script>window.onload=function(){window.print();window.close();}</script>
</body>
</html>`;
    const w = window.open('', '_blank', 'width=420,height=800');
    if (w) { w.document.write(html); w.document.close(); }
  }

  async function handlePrintA4() {
    const dir = locale === 'ar' ? 'rtl' : 'ltr';
    const branchName = user?.branch_name_en && user?.branch_name_ar
      ? (locale === 'ar' ? user.branch_name_ar : user.branch_name_en)
      : (user?.branch_id ?? '');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const now = new Date();
    const dateStr = now.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-SA', { year: 'numeric', month: 'short', day: 'numeric' });
    const hijriStr = formatHijriDate(now.toISOString());
    const timeStr = now.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-SA', { hour: '2-digit', minute: '2-digit' });
    const L = locale === 'ar'
      ? { invoice:'رقم الفاتورة', ph:'الصيدلي', pay:'طريقة الدفع', med:'الدواء', qty:'الكمية', tot:'الإجمالي', sub:'المجموع الفرعي', vat:'ضريبة القيمة المضافة', grand:'الإجمالي النهائي' }
      : { invoice:'Invoice #', ph:'Pharmacist', pay:'Payment', med:'Medicine', qty:'Qty', tot:'Total', sub:'Subtotal', vat:'VAT', grand:'Grand Total' };
    const tlv = buildZatcaTlv({ sellerName:'PharmaFlow Demo', vatNumber:'311111111111113', timestamp: new Date().toISOString(), totalWithVat: total, vatTotal: vatAmount });
    const qr = await QRCode.toDataURL(tlv, { width:120, margin:1, errorCorrectionLevel:'M' });
    const rows = cart.map((c) => {
      const name = esc(locale === 'ar' ? c.medicine.name_ar : c.medicine.name_en);
      const lineTotal = esc(formatCurrency(effectivePrice(c) * c.quantity, locale));
      return `<tr><td>${name}</td><td style="text-align:center">${c.quantity}</td><td style="text-align:right">${esc(formatCurrency(effectivePrice(c), locale))}</td><td style="text-align:right">${lineTotal}</td></tr>`;
    }).join('');
    const validPayLines = payLines.filter(l => parseFloat(l.amount) > 0);
    const paymentRows = validPayLines.length > 0
      ? `<tr style="background:#f5f5f5"><td colspan="4" style="padding:8px;font-weight:700;text-transform:uppercase;font-size:11px">${locale === 'ar' ? 'طرق الدفع' : 'Payment Methods'}</td></tr>` +
        validPayLines.map(line => {
          const method = payTiles.find(pt => pt.code === line.method);
          return `<tr><td>${locale === 'ar' ? method?.labelAr : method?.label}</td><td colspan="3" style="text-align:right">${esc(formatCurrency(parseFloat(line.amount), locale))}</td></tr>`;
        }).join('')
      : `<tr><td>${L.pay}</td><td colspan="3" style="text-align:right">${esc(lookupName(PAYMENT_METHODS, primaryMethod, locale))}</td></tr>`;
    const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${locale}">
<head>
<meta charset="UTF-8"/>
<title>${esc(receiptInvoice)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 12px;
    line-height: 1.6;
    color: #000;
    background: #fff;
    padding: 40px;
    max-width: 800px;
    margin: 0 auto;
  }
  .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 15px; }
  .logo { height: 70px; width: auto; margin-bottom: 10px; filter: brightness(0); }
  .store-name { font-size: 24px; font-weight: 700; margin-bottom: 5px; }
  .store-info { font-size: 11px; color: #666; }
  .invoice-info { display: flex; justify-content: space-between; margin: 20px 0; }
  .info-row { margin-bottom: 8px; }
  .label { font-weight: 600; display: inline-block; width: 150px; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  th { background: #f0f0f0; border: 1px solid #ddd; padding: 10px; text-align: left; font-weight: 600; font-size: 11px; }
  td { border: 1px solid #ddd; padding: 10px; }
  .totals { width: 100%; margin-top: 20px; }
  .total-row { display: flex; justify-content: flex-end; margin-bottom: 8px; }
  .total-label { width: 200px; text-align: right; font-weight: 600; padding-right: 15px; }
  .total-value { width: 120px; text-align: right; }
  .grand-total { font-size: 16px; font-weight: 700; border-top: 2px solid #000; border-bottom: 2px solid #000; padding-top: 10px; padding-bottom: 10px; }
  .qr { text-align: center; margin-top: 30px; }
  .qr img { height: 150px; width: 150px; }
  .footer { text-align: center; margin-top: 20px; font-size: 10px; color: #666; }
  @media print {
    body { padding: 20px; }
  }
</style>
</head>
<body>
  <div class="header">
    <img src="${window.location.origin}/logo.png" alt="PharmaFlow" class="logo"/>
    <div class="store-info">VAT: 311111111111113</div>
    <div class="store-info">${branchName}</div>
  </div>
  <div class="invoice-info">
    <div>
      <div class="info-row"><span class="label">${L.invoice}</span> <strong>${esc(receiptInvoice)}</strong></div>
      <div class="info-row"><span class="label">${L.ph}</span> ${esc(user?.full_name ?? '-')}</div>
      ${attachedCustomer ? `<div class="info-row"><span class="label">${locale === 'ar' ? 'العميل' : 'Customer'}</span> ${esc(attachedCustomer.name)}</div>` : ''}
    </div>
    <div>
      <div class="info-row"><span class="label">${locale === 'ar' ? 'التاريخ' : 'Date'}</span> ${esc(dateStr)}</div>
      <div class="info-row"><span class="label">${locale === 'ar' ? 'التاريخ الهجري' : 'Hijri'}</span> ${esc(hijriStr)}</div>
      <div class="info-row"><span class="label">${locale === 'ar' ? 'الوقت' : 'Time'}</span> ${esc(timeStr)}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>${L.med}</th>
        <th style="text-align:center">${L.qty}</th>
        <th style="text-align:right">${locale === 'ar' ? 'السعر' : 'Price'}</th>
        <th style="text-align:right">${L.tot}</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <table>
    <tbody>
      ${paymentRows}
    </tbody>
  </table>
  <div class="totals">
    <div class="total-row"><span class="total-label">${L.sub}</span><span class="total-value">${esc(formatCurrency(subtotalBeforeGlobalDiscount, locale))}</span></div>
    ${globalDiscountAmount > 0 ? `<div class="total-row"><span class="total-label">${locale === 'ar' ? 'الخصم' : 'Discount'}</span><span class="total-value" style="color:#d32f2f">−${esc(formatCurrency(globalDiscountAmount, locale))}</span></div>` : ''}
    ${vatBreakdown.map(({ rate, vat_amount }) => `<div class="total-row"><span class="total-label">${L.vat} (${(rate * 100).toFixed(0)}%)</span><span class="total-value">${esc(formatCurrency(vat_amount, locale))}</span></div>`).join('')}
    <div class="total-row grand-total"><span class="total-label">${L.grand}</span><span class="total-value">${esc(formatCurrency(total, locale))}</span></div>
  </div>
  <div class="qr">
    <img src="${qr}" alt="ZATCA QR"/>
    <div style="font-size:10px;color:#666;margin-top:8px">ZATCA QR Code</div>
  </div>
  <div class="footer">
    <div>${locale === 'ar' ? 'فاتورة ضريبية مبسطة' : 'Simplified Tax Invoice'}</div>
    <div style="margin-top:10px">Thank you for your purchase!</div>
  </div>
<script>window.onload=function(){window.print();window.close();}</script>
</body>
</html>`;
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (w) { w.document.write(html); w.document.close(); }
  }

  function handleCloseReceipt() {
    setReceiptOpen(false);
    setCart([]);
    setReceiptInvoice('');
    setLineDiscounts({});
    setLinePrices({});
    setLineComments({});
    setGlobalDiscountPct(0);
    setCouponCode('');  // NEW: clear coupon
    setCouponValidation(null);  // NEW: clear coupon validation
    setCouponError('');  // NEW: clear coupon error
    handledAddRef.current = null;
    // Fresh idempotency key for next transaction
    idempotencyKey.current = crypto.randomUUID();
  }

  /* ── Payment method tiles ── */
  const payTiles: { code: PaymentMethod; label: string; labelAr: string; color: string }[] = [
    { code: 'cash',      label: 'Cash',     labelAr: 'نقداً',      color: S.success },
    { code: 'card',      label: 'Card',     labelAr: 'بطاقة',      color: S.primary },
    { code: 'mada',      label: 'mada',     labelAr: 'مدى',        color: '#1d6fa0' },
    { code: 'insurance', label: 'Insurance',labelAr: 'تأمين',      color: S.accent  },
    { code: 'wasfaty',   label: 'WASFATY',  labelAr: 'وصفتي',     color: '#5a3e8a' },
    { code: 'transfer',  label: 'Transfer', labelAr: 'تحويل',      color: S.subtle  },
  ];

  /* ── Overlay modal ── */
  function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
    if (!open) return null;
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)' }} />
        <div style={{ position: 'relative', background: S.surface, border: `1px solid ${S.border}`, width: '480px', maxHeight: '90vh', overflowY: 'auto', zIndex: 1 }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${S.border}` }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: S.fg }}>{title}</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.muted }}><Ban style={{ width: '14px', height: '14px' }} /></button>
          </div>
          <div style={{ padding: '16px' }}>{children}</div>
          {footer && <div style={{ padding: '12px 16px', borderTop: `1px solid ${S.border}`, display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>{footer}</div>}
        </div>
      </div>
    );
  }

  function PosBtn({ label, onClick, color, disabled }: { label: string; onClick: () => void; color?: string; disabled?: boolean }) {
    return (
      <button onClick={onClick} disabled={disabled}
        style={{ padding: '10px 18px', background: color ?? S.primary, color: '#fff', border: 'none', fontSize: '13px', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontFamily: 'inherit' }}>
        {label}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: S.bg, color: S.fg, fontFamily: 'Segoe UI, system-ui, sans-serif' }}>

      {/* ── Action bar ── */}
      <div style={{ height: '40px', background: S.surface, borderBottom: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: '4px', flexShrink: 0 }}>
        {/* Void — clears cart, resets transaction */}
        <button
          onClick={() => { if (cart.length > 0) { setCart([]); setSearch(''); setPaymentMethod('cash'); setPayLines([{ method: 'cash', amount: '' }]); setLineDiscounts({}); setLinePrices({}); setLineComments({}); setGlobalDiscountPct(0); toast({ title: locale === 'ar' ? 'تم إلغاء المعاملة' : 'Transaction voided' }); } }}
          title={locale === 'ar' ? 'إلغاء المعاملة الحالية وتفريغ السلة' : 'Cancel current transaction and clear cart'}
          style={{ padding: '4px 10px', background: 'none', border: `1px solid ${S.inBdr}`, color: cart.length > 0 ? S.danger : S.subtle, fontSize: '11px', cursor: cart.length > 0 ? 'pointer' : 'default', fontFamily: 'inherit' }}
        >
          {locale === 'ar' ? 'إلغاء' : 'Void'}
        </button>
        {/* Hold — parks transaction, clears screen */}
        <button
          onClick={handlePark}
          disabled={parking || cart.length === 0}
          title={locale === 'ar' ? 'تعليق المعاملة لخدمة عميل آخر' : 'Park transaction to serve another customer'}
          style={{ padding: '4px 10px', background: 'none', border: `1px solid ${S.inBdr}`, color: cart.length > 0 ? S.muted : S.subtle, fontSize: '11px', cursor: cart.length > 0 ? 'pointer' : 'default', fontFamily: 'inherit', opacity: cart.length > 0 ? 1 : 0.5 }}
        >
          {locale === 'ar' ? 'تعليق' : 'Hold'}
        </button>
        {/* Return — find previous invoice, select items to return */}
        <button
          onClick={() => router.push('/pharmacist/returns')}
          title={locale === 'ar' ? 'إرجاع بضاعة من فاتورة سابقة' : 'Return items from a previous invoice'}
          style={{ padding: '4px 10px', background: 'none', border: `1px solid ${S.inBdr}`, color: S.muted, fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {locale === 'ar' ? 'إرجاع' : 'Return'}
        </button>
        {/* Suspend — same as Hold for single-register setup */}
        <button
          onClick={handlePark}
          disabled={parking || cart.length === 0}
          title={locale === 'ar' ? 'حفظ المعاملة لاسترجاعها لاحقاً' : 'Save transaction to recall later'}
          style={{ padding: '4px 10px', background: 'none', border: `1px solid ${S.inBdr}`, color: cart.length > 0 ? S.muted : S.subtle, fontSize: '11px', cursor: cart.length > 0 ? 'pointer' : 'default', fontFamily: 'inherit', opacity: cart.length > 0 ? 1 : 0.5 }}
        >
          {locale === 'ar' ? 'إيقاف' : 'Suspend'}
        </button>
        <span style={{ marginInlineStart: 'auto', fontSize: '11px', color: S.subtle }}>F2 · F4</span>
        {attachedCustomer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 10px', background: 'hsl(201 96% 40% / 0.12)', border: '1px solid hsl(201 96% 40% / 0.38)', borderRadius: '4px', maxWidth: '260px' }}>
            <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: S.muted, fontWeight: 700 }}>{locale === 'ar' ? 'عميل' : 'Customer'}</span>
            <span style={{ fontSize: '11px', color: S.primary, fontWeight: 700, maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachedCustomer.name}</span>
            <button
              type="button"
              onClick={() => {
                setAttachedCustomer(null);
                const url = new URL(window.location.href);
                url.searchParams.delete('customer_id');
                url.searchParams.delete('customer_name');
                window.history.replaceState({}, '', `${url.pathname}${url.search}`);
              }}
              title={locale === 'ar' ? 'إزالة العميل من المعاملة' : 'Detach customer from this sale'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.muted, padding: '0', display: 'flex', lineHeight: 1 }}
            >
              <X style={{ width: '10px', height: '10px' }} />
            </button>
          </div>
        )}
      </div>

      {/* ── Main body: cart (flex:1) + payment panel (fixed width) ── */}
      {/* Use flex-direction row — in RTL the browser mirrors this correctly */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>

        {/* Cart side — transaction lines */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderInlineEnd: `1px solid ${S.border}` }}>

          {/* Search bar */}
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${S.border}`, flexShrink: 0, position: 'relative' }}>
            <Search style={{ position: 'absolute', insetInlineStart: '20px', top: '50%', transform: 'translateY(-50%)', width: '13px', height: '13px', color: S.subtle, pointerEvents: 'none' }} />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && searchResults.length > 0) { e.preventDefault(); addToCart(searchResults[0]); } }}
              placeholder={locale === 'ar' ? 'اسم الدواء أو الباركود (F2)' : 'Medicine name or barcode (F2)'}
              style={{ width: '100%', background: S.input, border: `1px solid ${S.inBdr}`, padding: locale === 'ar' ? '7px 28px 7px 10px' : '7px 10px 7px 28px', color: S.fg, fontSize: '12px', outline: 'none', fontFamily: 'inherit' }}
              autoFocus
            />
            {/* Search results dropdown */}
            {search.trim() && (searchResults.length > 0 || searchLoading) && (
              <div style={{ position: 'absolute', insetInlineStart: '12px', insetInlineEnd: '12px', top: '100%', background: S.card, border: `1px solid ${S.border}`, zIndex: 10, maxHeight: '240px', overflowY: 'auto' }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {searchLoading && searchResults.length === 0 && (
                  <div style={{ padding: '10px 12px', fontSize: '11px', color: S.muted }}>
                    {locale === 'ar' ? 'جارٍ البحث...' : 'Searching...'}
                  </div>
                )}
                {searchResults.map((med, i) => (
                  <div key={med.id} onClick={() => addToCart(med)}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${S.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = S.surface; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ''; }}
                  >
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: i === 0 ? 600 : 400, color: S.fg }}>{locale === 'ar' ? med.name_ar : med.name_en}</div>
                      <div style={{ fontSize: '10px', color: S.muted }}>{locale === 'ar' ? med.name_en : med.name_ar} · {med.barcode}</div>
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: S.primary }}>{formatCurrency(parseFloat(med.selling_price), locale)}</div>
                      <div style={{ fontSize: '10px', color: med.stock_quantity <= med.low_stock_threshold ? S.warn : S.muted }}>
                        {med.stock_quantity} {med.unit || (locale === 'ar' ? 'وحدة' : 'units')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cart header */}
          <div style={{ display: 'flex', background: S.surface, borderBottom: `1px solid ${S.border}`, flexShrink: 0 }}>
            {[locale === 'ar' ? 'الصنف' : 'Item', locale === 'ar' ? 'الكمية' : 'Qty', locale === 'ar' ? 'السعر' : 'Price', locale === 'ar' ? 'الإجمالي' : 'Total', ''].map((h, i) => (
              <div key={i} style={{ padding: '6px 10px', fontSize: '10px', fontWeight: 600, color: S.subtle, textTransform: 'uppercase', letterSpacing: '.04em', flex: i === 0 ? 3 : i === 4 ? 0.5 : 1 }}>{h}</div>
            ))}
          </div>

          {/* Cart lines — scrollable */}
          <div style={{ flex: 1, overflowY: 'auto' }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {cart.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: S.subtle, fontSize: '12px', gap: '8px' }}>
                <ShoppingCart style={{ width: '32px', height: '32px', opacity: 0.3 }} />
                <div>{locale === 'ar' ? 'السلة فارغة' : 'Cart is empty'}</div>
                <div style={{ fontSize: '11px' }}>{locale === 'ar' ? 'ابحث عن دواء لإضافته' : 'Search for a medicine to add'}</div>
              </div>
            ) : cart.map((c, i) => (
              <div key={c.medicine.id}
                className={c.medicine.id === lastAddedId ? 'cart-item-enter' : ''}
                onAnimationEnd={() => { if (c.medicine.id === lastAddedId) setLastAddedId(null); }}
                onMouseEnter={() => setLineMenuId(null)}
                style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${S.border}`, background: i % 2 === 0 ? S.bg : S.surface, position: 'relative' }}>
                {/* Item name + comment */}
                <div style={{ flex: 3, padding: '8px 10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: S.fg }}>{locale === 'ar' ? c.medicine.name_ar : c.medicine.name_en}</div>
                  <div style={{ fontSize: '10px', color: S.muted }}>{locale === 'ar' ? c.medicine.name_en : c.medicine.name_ar}</div>
                  {lineComments[c.medicine.id] && (
                    <div style={{ fontSize: '10px', color: S.warn, marginTop: '2px', fontStyle: 'italic' }}>
                      💬 {lineComments[c.medicine.id]}
                    </div>
                  )}
                  {(lineDiscounts[c.medicine.id] || linePrices[c.medicine.id] !== undefined) && (
                    <div style={{ fontSize: '10px', color: S.primary, marginTop: '2px' }}>
                      {lineDiscounts[c.medicine.id] ? `−${lineDiscounts[c.medicine.id]}%` : ''}
                      {linePrices[c.medicine.id] !== undefined ? `${locale === 'ar' ? 'سعر معدّل' : 'Price override'}` : ''}
                    </div>
                  )}
                </div>
                {/* Qty */}
                <div style={{ flex: 1, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button onClick={() => updateQty(c.medicine.id, -1)} style={{ width: '22px', height: '22px', background: S.card, border: `1px solid ${S.inBdr}`, color: S.fg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Minus style={{ width: '10px', height: '10px' }} /></button>
                  <input
                    type="number"
                    min={1}
                    value={c.quantity}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v > 0) setCart((prev) => prev.map((x) => x.medicine.id === c.medicine.id ? { ...x, quantity: v } : x));
                    }}
                    onBlur={(e) => { if (!e.target.value || parseInt(e.target.value) < 1) setCart((prev) => prev.map((x) => x.medicine.id === c.medicine.id ? { ...x, quantity: 1 } : x)); }}
                    style={{ width: '36px', textAlign: 'center', fontSize: '12px', fontWeight: 600, background: S.input, border: `1px solid ${S.inBdr}`, color: S.fg, outline: 'none', fontFamily: 'inherit', padding: '2px 0' }}
                    className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&]:m-0"
                  />
                  <button onClick={() => updateQty(c.medicine.id, 1)} style={{ width: '22px', height: '22px', background: S.card, border: `1px solid ${S.inBdr}`, color: S.fg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus style={{ width: '10px', height: '10px' }} /></button>
                </div>
                {/* Unit price */}
                <div style={{ flex: 1, padding: '8px 10px', fontSize: '12px', color: linePrices[c.medicine.id] !== undefined || lineDiscounts[c.medicine.id] ? S.primary : S.muted }}>
                  {formatCurrency(effectivePrice(c), locale)}
                  {parseFloat(c.medicine.selling_price) !== effectivePrice(c) && (
                    <div style={{ fontSize: '9px', color: S.subtle, textDecoration: 'line-through' }}>{formatCurrency(parseFloat(c.medicine.selling_price), locale)}</div>
                  )}
                </div>
                {/* Line total */}
                <div style={{ flex: 1, padding: '8px 10px', fontSize: '12px', fontWeight: 600, color: S.fg }}>{formatCurrency(effectivePrice(c) * c.quantity, locale)}</div>
                {/* Actions: ellipsis + delete */}
                <div style={{ flex: 0.5, padding: '8px 6px', display: 'flex', justifyContent: 'center', gap: '2px', position: 'relative' }}>
                  {/* Ellipsis */}
                  <button
                    onClick={() => setLineMenuId(lineMenuId === c.medicine.id ? null : c.medicine.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.muted, display: 'flex', padding: '2px' }}
                  >
                    <MoreHorizontal style={{ width: '13px', height: '13px' }} />
                  </button>
                  {/* Delete */}
                  <button onClick={() => { removeFromCart(c.medicine.id); setLineMenuId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.danger, display: 'flex', padding: '2px' }}>
                    <Trash2 style={{ width: '13px', height: '13px' }} />
                  </button>
                  {/* Inline actions dropdown */}
                  {lineMenuId === c.medicine.id && (
                    <>
                      <div onClick={() => setLineMenuId(null)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />
                      <div style={{
                        position: 'absolute', top: '100%', insetInlineEnd: 0,
                        background: S.card, border: `1px solid ${S.border}`,
                        zIndex: 20, minWidth: '170px', boxShadow: '0 4px 16px rgba(0,0,0,.4)',
                      }}>
                        {/* Line discount */}
                        <button
                          onClick={() => { setLineMenuId(null); setDiscountInput(String(lineDiscounts[c.medicine.id] ?? '')); setDiscountModal({ id: c.medicine.id, name: locale === 'ar' ? c.medicine.name_ar : c.medicine.name_en, current: lineDiscounts[c.medicine.id] ?? 0 }); }}
                          style={{ width: '100%', padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer', color: S.fg, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'inherit', textAlign: 'start' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = S.surface; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                        >
                          <Tag style={{ width: '12px', height: '12px', color: S.muted }} />
                          {locale === 'ar' ? 'خصم على السطر' : 'Line discount'}
                        </button>
                        {/* Price override */}
                        <button
                          onClick={() => { setLineMenuId(null); setPriceInput(String(linePrices[c.medicine.id] ?? parseFloat(c.medicine.selling_price))); setPriceModal({ id: c.medicine.id, name: locale === 'ar' ? c.medicine.name_ar : c.medicine.name_en, original: parseFloat(c.medicine.selling_price), current: linePrices[c.medicine.id] ?? parseFloat(c.medicine.selling_price) }); }}
                          style={{ width: '100%', padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer', color: S.fg, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'inherit', textAlign: 'start' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = S.surface; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                        >
                          <DollarSign style={{ width: '12px', height: '12px', color: S.muted }} />
                          {locale === 'ar' ? 'تجاوز السعر' : 'Price override'}
                        </button>
                        {/* Line comment */}
                        <button
                          onClick={() => { setLineMenuId(null); setCommentInput(lineComments[c.medicine.id] ?? ''); setCommentModal({ id: c.medicine.id, name: locale === 'ar' ? c.medicine.name_ar : c.medicine.name_en }); }}
                          style={{ width: '100%', padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer', color: S.fg, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'inherit', textAlign: 'start' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = S.surface; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                        >
                          <MessageSquare style={{ width: '12px', height: '12px', color: S.muted }} />
                          {locale === 'ar' ? 'تعليق على السطر' : 'Line comment'}
                        </button>
                        {/* Divider + void line */}
                        <div style={{ height: '1px', background: S.border, margin: '2px 0' }} />
                        <button
                          onClick={() => { removeFromCart(c.medicine.id); setLineMenuId(null); }}
                          style={{ width: '100%', padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer', color: S.danger, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'inherit', textAlign: 'start' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = S.surface; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                        >
                          <Trash2 style={{ width: '12px', height: '12px' }} />
                          {locale === 'ar' ? 'إلغاء هذا الصنف' : 'Void product'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Totals bar */}
          <div style={{ borderTop: `2px solid ${S.border}`, padding: '10px 12px', background: S.surface, flexShrink: 0 }}>
            {/* Cart summary: lines + items count */}
            {cart.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: S.subtle, marginBottom: '6px', paddingBottom: '6px', borderBottom: `1px solid ${S.border}` }}>
                <span>{locale === 'ar' ? `${cart.length} صنف` : `${cart.length} ${cart.length === 1 ? 'line' : 'lines'}`}</span>
                <span>{locale === 'ar' ? `${cart.reduce((s, c) => s + c.quantity, 0)} قطعة` : `${cart.reduce((s, c) => s + c.quantity, 0)} items`}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: S.muted, marginBottom: '3px' }}>
              <span>{locale === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span><span>{formatCurrency(subtotalBeforeGlobalDiscount, locale)}</span>
            </div>
            {globalDiscountAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: S.danger, marginBottom: '3px' }}>
                <span>{locale === 'ar' ? `خصم (${globalDiscountPct}%)` : `Discount (${globalDiscountPct}%)`}</span><span>−{formatCurrency(globalDiscountAmount, locale)}</span>
              </div>
            )}
            {couponDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: S.success, marginBottom: '3px' }}>
                <span>{locale === 'ar' ? `كوبون (${couponCode})` : `Coupon (${couponCode})`}</span><span>−{formatCurrency(couponDiscount, locale)}</span>
              </div>
            )}
            {vatBreakdown.map(({ rate, vat_amount }) => (
              <div key={rate} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: S.muted, marginBottom: '3px' }}>
                <span>{locale === 'ar' ? 'ضريبة' : 'VAT'} ({(rate * 100).toFixed(0)}%)</span><span>{formatCurrency(vat_amount, locale)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right — AMOUNT DUE + payment tiles */}
        <div style={{ width: '280px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

          {/* AMOUNT DUE */}
          <div style={{ padding: '20px 16px', background: S.card, borderBottom: `1px solid ${S.border}`, textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: S.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '4px' }}>
              {locale === 'ar' ? 'المبلغ المستحق' : 'AMOUNT DUE'}
            </div>
            <div
              className={amountFlash ? 'amount-flash' : ''}
              onAnimationEnd={() => setAmountFlash(false)}
              style={{ fontSize: '48px', fontWeight: 700, color: total > 0 ? S.fg : S.subtle, lineHeight: 1.1, fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace" }}
            >
              {formatCurrency(total, locale)}
            </div>
          </div>

          {/* Split payment entry */}
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '320px', scrollbarColor: `${S.card} ${S.bg}`, scrollbarWidth: 'thin' }} className="[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[hsl(var(--pos-bg))] [&::-webkit-scrollbar-thumb]:bg-[hsl(var(--pos-card))] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-[hsl(var(--pos-border))]">
            {payLines.map((line, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                <select
                  value={line.method}
                  onChange={(e) => {
                    const newPayLines = [...payLines];
                    newPayLines[idx].method = e.target.value as PaymentMethod;
                    setPayLines(newPayLines);
                  }}
                  style={{
                    flex: 1.2,
                    background: S.card,
                    border: `1px solid ${S.inBdr}`,
                    color: S.fg,
                    padding: '6px 8px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                >
                  {payTiles.map((pt) => (
                    <option key={pt.code} value={pt.code}>
                      {locale === 'ar' ? pt.labelAr : pt.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.amount}
                  onChange={(e) => {
                    const newPayLines = [...payLines];
                    newPayLines[idx].amount = e.target.value;
                    setPayLines(newPayLines);
                  }}
                  placeholder="0.00"
                  style={{
                    flex: 1,
                    background: S.input,
                    border: `1px solid ${S.inBdr}`,
                    color: S.fg,
                    padding: '6px 8px',
                    fontSize: '11px',
                    textAlign: 'center',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                  className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&]:m-0"
                />
                <button
                  onClick={() => setPayLines(payLines.filter((_, i) => i !== idx))}
                  disabled={payLines.length === 1}
                  style={{
                    width: '28px',
                    height: '28px',
                    background: 'none',
                    border: `1px solid ${S.inBdr}`,
                    color: S.danger,
                    cursor: payLines.length === 1 ? 'not-allowed' : 'pointer',
                    opacity: payLines.length === 1 ? 0.4 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'inherit',
                  }}
                >
                  <Minus style={{ width: '10px', height: '10px' }} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setPayLines([...payLines, { method: 'cash', amount: '' }])}
              style={{
                padding: '8px 10px',
                background: 'none',
                border: `1px dashed ${S.border}`,
                color: S.primary,
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 600,
              }}
            >
              {locale === 'ar' ? '+ طريقة دفع أخرى' : '+ Add Payment Method'}
            </button>
            {/* Global discount % */}
            <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: '8px', marginTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <label style={{ fontSize: '10px', fontWeight: 600, color: S.subtle, textTransform: 'uppercase', letterSpacing: '.04em', flex: 1 }}>{locale === 'ar' ? 'خصم عام %' : 'Global Discount %'}</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={globalDiscountPct === 0 ? '' : globalDiscountPct}
                  onChange={(e) => setGlobalDiscountPct(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                  placeholder="0"
                  style={{
                    width: '70px',
                    background: S.input,
                    border: `1px solid ${S.inBdr}`,
                    color: S.fg,
                    padding: '4px 6px',
                    fontSize: '11px',
                    textAlign: 'center',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                  className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&]:m-0"
                />
                <span style={{ fontSize: '10px', color: S.muted }}>%</span>
              </div>
              {globalDiscountAmount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: S.primary, marginBottom: '6px' }}>
                  <span>{locale === 'ar' ? 'الخصم المطبق' : 'Discount'}</span>
                  <span>−{formatCurrency(globalDiscountAmount, locale)}</span>
                </div>
              )}
            </div>

            {/* Coupon section */}
            <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: '8px', marginTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value.toUpperCase());
                    setCouponValidation(null);
                    setCouponError('');
                  }}
                  placeholder={locale === 'ar' ? 'أدخل كود الكوبون' : 'Coupon code'}
                  style={{
                    flex: 1,
                    background: S.input,
                    border: `1px solid ${couponError ? S.danger : couponValidation?.is_valid ? S.success : S.inBdr}`,
                    color: S.fg,
                    padding: '6px 8px',
                    fontSize: '11px',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => validateCoupon(couponCode)}
                  disabled={!couponCode.trim() || couponLoading}
                  style={{
                    padding: '6px 10px',
                    background: couponCode.trim() && !couponLoading ? S.primary : S.card,
                    color: '#fff',
                    border: 'none',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: couponCode.trim() && !couponLoading ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit',
                  }}
                >
                  {couponLoading ? '...' : (locale === 'ar' ? 'تحقق' : 'Verify')}
                </button>
                {couponValidation?.is_valid && (
                  <button
                    onClick={() => {
                      setCouponCode('');
                      setCouponValidation(null);
                      setCouponError('');
                    }}
                    style={{
                      padding: '6px 6px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: S.muted,
                    }}
                  >
                    <X style={{ width: '14px', height: '14px' }} />
                  </button>
                )}
              </div>

              {couponError && (
                <div style={{ fontSize: '10px', color: S.danger, marginBottom: '4px' }}>
                  {couponError}
                </div>
              )}

              {couponValidation && couponValidation.is_valid && couponDiscount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: S.success, marginBottom: '6px' }}>
                  <span>{locale === 'ar' ? 'خصم كوبون' : 'Coupon'}</span>
                  <span>−{formatCurrency(couponDiscount, locale)}</span>
                </div>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: '8px', marginTop: '4px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: S.muted }}>
                <span>{locale === 'ar' ? 'المستحق' : 'Due'}</span>
                <span>{formatCurrency(total, locale)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: S.muted }}>
                <span>{locale === 'ar' ? 'المدفوع' : 'Tendered'}</span>
                <span>{formatCurrency(tendered, locale)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: tendered >= total ? S.success : S.warn }}>
                <span>{locale === 'ar' ? 'الباقي' : 'Change'}</span>
                <span>{formatCurrency(Math.max(0, tendered - total), locale)}</span>
              </div>
            </div>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* No shift banner */}
          {sessionOpen === false && (
            <div style={{ margin: '0 12px 8px', padding: '8px 12px', background: 'hsl(0 84% 60% / 0.12)', border: '1px solid hsl(0 84% 60% / 0.3)', borderRadius: '3px', fontSize: '11px', color: 'hsl(0 84% 65%)', textAlign: 'center' }}>
              {locale === 'ar' ? 'لا توجد وردية مفتوحة — افتح الوردية أولاً' : 'No open shift — declare start amount first'}
            </div>
          )}

          {/* Pay button */}
          <div style={{ padding: '12px', borderTop: `1px solid ${S.border}` }}>
            <button
              onClick={handleCheckout}
              disabled={cart.length === 0 || submitting || sessionOpen === false}
              style={{
                width: '100%', padding: '16px', background: cart.length > 0 && !submitting && sessionOpen !== false ? S.success : S.card,
                color: '#fff', border: 'none', fontSize: '15px', fontWeight: 700,
                cursor: cart.length > 0 && !submitting && sessionOpen !== false ? 'pointer' : 'not-allowed',
                opacity: cart.length > 0 && !submitting && sessionOpen !== false ? 1 : 0.4, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              <CheckCircle style={{ width: '18px', height: '18px' }} />
              {submitting
                ? (locale === 'ar' ? 'جارٍ المعالجة...' : 'Processing...')
                : (locale === 'ar' ? 'إتمام البيع' : 'Charge')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Receipt modal ── */}
      <Modal open={receiptOpen} onClose={() => {}} title={locale === 'ar' ? 'الإيصال' : 'Receipt'}
        footer={<>
          <PosBtn label={locale === 'ar' ? 'طباعة A4' : 'Print A4'} onClick={handlePrintA4} color={S.card} />
          <PosBtn label={locale === 'ar' ? 'طباعة' : 'Print 80mm'} onClick={handlePrint} color={S.surface} />
          <PosBtn label={locale === 'ar' ? 'إغلاق' : 'Close'} onClick={handleCloseReceipt} />
        </>}
      >
        <div style={{ color: S.fg, fontSize: '13px' }}>
          {/* Logo + store header */}
          <div style={{ textAlign: 'center', marginBottom: '14px', paddingBottom: '14px', borderBottom: `1px solid ${S.border}` }}>
            <img src="/logo.png" alt="PharmaFlow" className="logo-dark-surface" style={{ height: '32px', width: 'auto', marginBottom: '6px' }} />
            <div style={{ fontSize: '12px', fontWeight: 600, color: S.fg }}>PharmaFlow</div>
            <div style={{ fontSize: '10px', color: S.muted }}>VAT: 311111111111113</div>
            <div style={{ fontSize: '10px', color: S.muted }}>{locale === 'ar' ? 'فاتورة ضريبية مبسطة' : 'Simplified Tax Invoice'}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}><span style={{ color: S.muted }}>{locale === 'ar' ? 'رقم الفاتورة' : 'Invoice #'}</span><strong>{receiptInvoice}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}><span style={{ color: S.muted }}>{locale === 'ar' ? 'الصيدلي' : 'Pharmacist'}</span><span>{user?.full_name ?? '-'}</span></div>
          {(user?.branch_name_ar || user?.branch_name_en) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}><span style={{ color: S.muted }}>{locale === 'ar' ? 'الفرع' : 'Branch'}</span><span>{locale === 'ar' ? user?.branch_name_ar : user?.branch_name_en}</span></div>
          )}
          {(() => {
            const validLines = payLines.filter(l => parseFloat(l.amount) > 0);
            return validLines.length > 0 ? (
              <div style={{ marginBottom: '14px', borderBottom: `1px solid ${S.border}`, paddingBottom: '8px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: S.subtle, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '6px' }}>{locale === 'ar' ? 'طرق الدفع' : 'Payment Methods'}</div>
                {validLines.map((line, idx) => {
                  const method = payTiles.find(pt => pt.code === line.method);
                  return (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span>{locale === 'ar' ? method?.labelAr : method?.label}</span>
                      <span>{formatCurrency(parseFloat(line.amount), locale)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px' }}><span style={{ color: S.muted }}>{locale === 'ar' ? 'طريقة الدفع' : 'Payment'}</span><span>{lookupName(PAYMENT_METHODS, primaryMethod, locale)}</span></div>
            );
          })()}
          {cart.map((c) => (
            <div key={c.medicine.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${S.border}`, fontSize: '12px' }}>
              <span>{locale === 'ar' ? c.medicine.name_ar : c.medicine.name_en} × {c.quantity}</span>
              <span>{formatCurrency(effectivePrice(c) * c.quantity, locale)}</span>
            </div>
          ))}
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: S.muted }}>{locale === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span><span>{formatCurrency(subtotalBeforeGlobalDiscount, locale)}</span></div>
            {globalDiscountAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: S.muted }}>{locale === 'ar' ? `خصم (${globalDiscountPct}%)` : `Discount (${globalDiscountPct}%)`}</span><span style={{ color: S.danger }}>−{formatCurrency(globalDiscountAmount, locale)}</span></div>
            )}
            {couponDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: S.muted }}>{locale === 'ar' ? `كوبون (${couponCode})` : `Coupon (${couponCode})`}</span><span style={{ color: S.success }}>−{formatCurrency(couponDiscount, locale)}</span></div>
            )}
            {vatBreakdown.map(({ rate, vat_amount }) => (
              <div key={rate} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: S.muted }}>{locale === 'ar' ? 'ضريبة' : 'VAT'} ({(rate * 100).toFixed(0)}%)</span><span>{formatCurrency(vat_amount, locale)}</span></div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 700, borderTop: `1px solid ${S.border}`, paddingTop: '6px', marginTop: '4px' }}>
              <span>{locale === 'ar' ? 'الإجمالي' : 'Total'}</span><span style={{ color: S.primary }}>{formatCurrency(total, locale)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
            <ZatcaQR sellerName="PharmaFlow Demo" vatNumber="311111111111113" timestamp={new Date().toISOString()} totalWithVat={total} vatTotal={vatAmount} size={96} />
          </div>
        </div>
      </Modal>

      {/* ── Rx confirm ── */}
      <Modal open={rxConfirmOpen} onClose={() => setRxConfirmOpen(false)} title={locale === 'ar' ? 'تأكيد الوصفة الطبية' : 'Prescription Required'}
        footer={<>
          <PosBtn label={tCommon('cancel')} onClick={() => setRxConfirmOpen(false)} color={S.card} />
          <PosBtn label={locale === 'ar' ? 'تأكيد وإتمام' : 'Confirm & Charge'} onClick={() => { setRxConfirmOpen(false); completeSale(); }} />
        </>}
      >
        <p style={{ color: S.muted, fontSize: '12px', marginBottom: '10px' }}>{locale === 'ar' ? 'الأصناف التالية تتطلب وصفة طبية:' : 'These items require a prescription:'}</p>
        {rxItems.map((n) => <div key={n} style={{ padding: '4px 0', fontSize: '13px', fontWeight: 600, color: S.warn }}>• {n}</div>)}
      </Modal>

      {/* ── Blocked ── */}
      <Modal open={!!blockedMed} onClose={() => setBlockedMed(null)} title={blockedMed?.reason === 'outOfStock' ? (locale === 'ar' ? 'نفاد المخزون' : 'Out of Stock') : (locale === 'ar' ? 'منتهي الصلاحية' : 'All Batches Expired')}
        footer={<PosBtn label={tCommon('close')} onClick={() => setBlockedMed(null)} />}
      >
        <p style={{ color: S.muted, fontSize: '13px' }}>
          {blockedMed?.reason === 'outOfStock'
            ? (locale === 'ar' ? `لا يمكن إضافة "${blockedMed?.name}" — المخزون صفر.` : `Cannot add "${blockedMed?.name}" — stock is zero.`)
            : (locale === 'ar' ? `لا يمكن إضافة "${blockedMed?.name}" — جميع الدفعات منتهية.` : `Cannot add "${blockedMed?.name}" — all batches expired.`)}
        </p>
      </Modal>

      {/* ── Line discount modal ── */}
      <Modal
        open={!!discountModal}
        onClose={() => setDiscountModal(null)}
        title={locale === 'ar' ? 'خصم على السطر' : 'Line Discount'}
        footer={<>
          <PosBtn label={locale === 'ar' ? 'إزالة الخصم' : 'Remove'} onClick={() => { if (discountModal) { setLineDiscounts((p) => { const n = { ...p }; delete n[discountModal.id]; return n; }); } setDiscountModal(null); }} color={S.surface} />
          <PosBtn label={locale === 'ar' ? 'تطبيق' : 'Apply'} onClick={() => {
            if (!discountModal) return;
            const v = parseFloat(discountInput);
            if (!isNaN(v) && v >= 0 && v <= 100) {
              setLineDiscounts((p) => ({ ...p, [discountModal.id]: v }));
              setLinePrices((p) => { const n = { ...p }; delete n[discountModal.id]; return n; });
            }
            setDiscountModal(null);
          }} />
        </>}
      >
        <p style={{ color: S.muted, fontSize: '12px', marginBottom: '10px' }}>{discountModal?.name}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number" min={0} max={100} value={discountInput}
            onChange={(e) => setDiscountInput(e.target.value)}
            autoFocus
            placeholder="0 – 100"
            style={{ flex: 1, background: S.input, border: `1px solid ${S.inBdr}`, color: S.fg, padding: '8px 10px', fontSize: '14px', outline: 'none', fontFamily: 'inherit' }}
          />
          <span style={{ color: S.fg, fontSize: '16px' }}>%</span>
        </div>
      </Modal>

      {/* ── Price override modal ── */}
      <Modal
        open={!!priceModal}
        onClose={() => setPriceModal(null)}
        title={locale === 'ar' ? 'تجاوز السعر' : 'Price Override'}
        footer={<>
          <PosBtn label={locale === 'ar' ? 'استعادة الأصلي' : 'Restore'} onClick={() => { if (priceModal) { setLinePrices((p) => { const n = { ...p }; delete n[priceModal.id]; return n; }); } setPriceModal(null); }} color={S.surface} />
          <PosBtn label={locale === 'ar' ? 'تطبيق' : 'Apply'} onClick={() => {
            if (!priceModal) return;
            const v = parseFloat(priceInput);
            if (!isNaN(v) && v >= 0) {
              setLinePrices((p) => ({ ...p, [priceModal.id]: v }));
              setLineDiscounts((p) => { const n = { ...p }; delete n[priceModal.id]; return n; });
            }
            setPriceModal(null);
          }} />
        </>}
      >
        <p style={{ color: S.muted, fontSize: '12px', marginBottom: '4px' }}>{priceModal?.name}</p>
        <p style={{ color: S.subtle, fontSize: '11px', marginBottom: '10px' }}>
          {locale === 'ar' ? `السعر الأصلي: ${formatCurrency(priceModal?.original ?? 0, locale)}` : `Original price: ${formatCurrency(priceModal?.original ?? 0, locale)}`}
        </p>
        <input
          type="number" min={0} value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          autoFocus
          style={{ width: '100%', background: S.input, border: `1px solid ${S.inBdr}`, color: S.fg, padding: '8px 10px', fontSize: '14px', outline: 'none', fontFamily: 'inherit' }}
        />
      </Modal>

      {/* ── Line comment modal ── */}
      <Modal
        open={!!commentModal}
        onClose={() => setCommentModal(null)}
        title={locale === 'ar' ? 'تعليق على السطر' : 'Line Comment'}
        footer={<>
          <PosBtn label={tCommon('cancel')} onClick={() => setCommentModal(null)} color={S.surface} />
          <PosBtn label={locale === 'ar' ? 'حفظ' : 'Save'} onClick={() => {
            if (!commentModal) return;
            setLineComments((p) => ({ ...p, [commentModal.id]: commentInput.trim() }));
            setCommentModal(null);
          }} />
        </>}
      >
        <p style={{ color: S.muted, fontSize: '12px', marginBottom: '10px' }}>{commentModal?.name}</p>
        <textarea
          value={commentInput}
          onChange={(e) => setCommentInput(e.target.value)}
          autoFocus
          rows={3}
          placeholder={locale === 'ar' ? 'أضف تعليقاً...' : 'Add a comment...'}
          style={{ width: '100%', background: S.input, border: `1px solid ${S.inBdr}`, color: S.fg, padding: '8px 10px', fontSize: '13px', outline: 'none', fontFamily: 'inherit', resize: 'vertical' }}
        />
      </Modal>

      {/* ── Recall transaction dialog ── */}
      {recallOpen && (
        <>
          <div onClick={() => setRecallOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '460px', maxHeight: '70vh', background: S.surface,
            border: `1px solid ${S.border}`, borderRadius: '6px', zIndex: 10000,
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${S.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: S.fg }}>{locale === 'ar' ? 'استدعاء معاملة معلقة' : 'Recall Parked Transaction'}</div>
              <button onClick={() => setRecallOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.muted, display: 'flex' }}><Ban style={{ width: '14px', height: '14px' }} /></button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {parkedList.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: S.muted, fontSize: '13px' }}>
                  {locale === 'ar' ? 'لا توجد معاملات معلقة' : 'No parked transactions'}
                </div>
              ) : parkedList.map((p, i) => {
                const parkedAt = new Date(p.parked_at.endsWith('Z') ? p.parked_at : p.parked_at + 'Z');
                const timeStr = parkedAt.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={p.id} style={{
                    padding: '12px 20px', borderBottom: i < parkedList.length - 1 ? `1px solid ${S.border}` : 'none',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: S.fg }}>
                        {p.item_count} {locale === 'ar' ? 'صنف' : 'items'} · {formatCurrency(p.total, locale)}
                      </div>
                      <div style={{ fontSize: '11px', color: S.muted, marginTop: '2px' }}>
                        {locale === 'ar' ? 'علق في' : 'Parked at'} {timeStr}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => handleVoidParked(p.id)}
                        style={{ padding: '4px 10px', background: 'none', border: `1px solid ${S.border}`, color: S.danger, fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: '3px' }}
                      >
                        {locale === 'ar' ? 'إلغاء' : 'Void'}
                      </button>
                      <button
                        onClick={() => handleRecall(p.id)}
                        style={{ padding: '4px 10px', background: S.primary, border: 'none', color: '#fff', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: '3px', fontWeight: 600 }}
                      >
                        {locale === 'ar' ? 'استدعاء' : 'Recall'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

    </div>
  );
}
