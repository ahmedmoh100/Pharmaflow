'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PAYMENT_METHODS, lookupName } from '@/app/lib/mock-data';
import { formatCurrency, formatDateTime, formatHijriDate, buildZatcaTlv } from '@/app/lib/utils';
import { Printer } from 'lucide-react';
import { ZatcaQR } from '@/components/shared/ZatcaQR';
import { api } from '@/app/lib/api';
import QRCode from 'qrcode';

interface InvoiceViewProps {
  saleId: string;
}

interface SaleData {
  id: string; invoice_number: string; uuid: string; icv: number;
  user_id: string; branch_id: string; pharmacist_name?: string;
  sold_at: string; payment_method: string; payment_lines?: Array<{ method: string; amount: number | string }> | null; notes: string;
  subtotal_amount: number | string; vat_amount: number | string; total_amount: number | string;
  vat_breakdown: { rate: number; taxable_amount: number; vat_amount: number }[];
  items?: { id: string; medicine_id: string; medicine_name_en?: string; medicine_name_ar?: string; quantity: number; unit_price: number | string; vat_rate: number | string; vat_amount: number | string }[];
}

export function InvoiceView({ saleId }: InvoiceViewProps) {
  const t = useTranslations('sales');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';

  const [sale, setSale] = useState<SaleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saleReturn, setSaleReturn] = useState<{ credit_note_number: string; total_refund: string; created_at: string } | null>(null);

  useEffect(() => {
    // Try real API first
    api.get<SaleData>(`/sales/${saleId}`)
      .then((data) => setSale(data))
      .catch(() => null)
      .finally(() => setLoading(false));

    // Check for returns on this sale
    api.get<{ items: { total_refund: string; credit_note_number: string; created_at: string }[] }>(`/returns?sale_id=${saleId}&page_size=5`)
      .then((r) => {
        if (r.items.length > 0) setSaleReturn(r.items[0]);
      })
      .catch(() => null);
  }, [saleId]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!sale) return <div className="p-8 text-muted-foreground">{tCommon('noData')}</div>;

  const subtotal = parseFloat(String(sale.subtotal_amount));
  const vatAmount = parseFloat(String(sale.vat_amount));
  const totalAmount = parseFloat(String(sale.total_amount));
  const items = sale.items ?? [];
  const pharmacistName = sale.pharmacist_name ?? '-';

  async function handlePrint() {
    if (!sale) return;
    const dir = locale === 'ar' ? 'rtl' : 'ltr';
    const L = locale === 'ar' ? {
      invoice: 'رقم الفاتورة', date: 'التاريخ', pharmacist: 'الصيدلي', payment: 'طريقة الدفع',
      medicine: 'الدواء', qty: 'الكمية', unitPrice: 'سعر الوحدة', total: 'الإجمالي',
      subtotal: 'المجموع الفرعي', vat: 'ضريبة القيمة المضافة', grandTotal: 'الإجمالي النهائي',
    } : {
      invoice: 'Invoice #', date: 'Date', pharmacist: 'Pharmacist', payment: 'Payment',
      medicine: 'Medicine', qty: 'Qty', unitPrice: 'Unit Price', total: 'Total',
      subtotal: 'Subtotal', vat: 'VAT', grandTotal: 'Grand Total',
    };
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const tlv = buildZatcaTlv({ sellerName: 'PharmaFlow Demo', vatNumber: '311111111111113', timestamp: sale.sold_at, totalWithVat: totalAmount, vatTotal: vatAmount });
    const qrDataUrl = await QRCode.toDataURL(tlv, { width: 100, margin: 1, errorCorrectionLevel: 'M' });
    const rows = items.map((item) => {
      const name = locale === 'ar' ? (item.medicine_name_ar || item.medicine_id) : (item.medicine_name_en || item.medicine_id);
      const up = parseFloat(String(item.unit_price));
      return `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(name)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:center">${item.quantity}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:end">${esc(formatCurrency(up, locale))}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:end">${esc(formatCurrency(item.quantity * up, locale))}</td></tr>`;
    }).join('');
    const vatRows = (sale.vat_breakdown ?? []).map(({ rate, vat_amount }) =>
      `<div class="info"><span class="label">${L.vat} (${rate.toFixed(0)}%)</span><span>${esc(formatCurrency(Number(vat_amount), locale))}</span></div>`
    ).join('');
    const validPayLines = (sale.payment_lines ?? [])?.filter(l => parseFloat(String(l.amount)) > 0);
    const paymentInfo = validPayLines && validPayLines.length > 0
      ? validPayLines.map(line => `<div class="info"><span class="label">${esc(lookupName(PAYMENT_METHODS, line.method, locale))}</span><span>${esc(formatCurrency(parseFloat(String(line.amount)), locale))}</span></div>`).join('')
      : `<div class="info"><span class="label">${L.payment}</span><span>${esc(lookupName(PAYMENT_METHODS, sale.payment_method, locale))}</span></div>`;
    const html = `<!DOCTYPE html><html dir="${dir}" lang="${locale}"><head><meta charset="UTF-8"/><title>${esc(sale.invoice_number)}</title><style>@page{size:80mm auto;margin:0}body{font-family:sans-serif;margin:12px 8px;color:#111;width:76mm}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:start;padding:6px 0;border-bottom:2px solid #ccc;font-size:12px;color:#555}.info{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}.label{color:#666}.grand{color:#0284c7;font-weight:bold;font-size:15px}img.logo{width:72px;height:72px;object-fit:contain}</style></head><body>
      <div style="text-align:center;margin-bottom:12px;border-bottom:1px solid #ccc;padding-bottom:12px"><img class="logo" src="/logo.png" alt="PharmaFlow"/></div>
      <div class="info"><span class="label">${L.invoice}</span><strong>${esc(sale.invoice_number)}</strong></div>
      <div class="info"><span class="label">VAT</span><span style="font-family:monospace;font-size:11px">311111111111113</span></div>
      <div class="info"><span class="label">${dir === 'rtl' ? 'نوع الفاتورة' : 'Invoice Type'}</span><span style="color:#0284c7;font-size:11px">${dir === 'rtl' ? 'فاتورة ضريبية مبسطة' : 'Simplified Tax Invoice'}</span></div>
      <div class="info"><span class="label">${L.date}</span><span>${esc(formatDateTime(sale.sold_at, locale))}</span></div>
      <div class="info" style="font-size:10px;color:#aaa"><span></span><span dir="rtl">${esc(formatHijriDate(sale.sold_at))}</span></div>
      <div class="info" style="font-size:10px;color:#aaa"><span>ICV</span><span>${sale.icv}</span></div>
      <div class="info"><span class="label">${L.pharmacist}</span><span>${esc(pharmacistName)}</span></div>
      ${paymentInfo}<br/>
      <table><thead><tr><th>${L.medicine}</th><th style="text-align:center">${L.qty}</th><th style="text-align:end">${L.unitPrice}</th><th style="text-align:end">${L.total}</th></tr></thead><tbody>${rows}</tbody></table><br/>
      <div class="info"><span class="label">${L.subtotal}</span><span>${esc(formatCurrency(subtotal, locale))}</span></div>${vatRows}
      <div class="info" style="border-top:2px solid #ccc;padding-top:8px;margin-top:4px"><span style="font-weight:bold">${L.grandTotal}</span><span class="grand">${esc(formatCurrency(totalAmount, locale))}</span></div>
      <div style="margin-top:16px;text-align:center"><img src="${qrDataUrl}" alt="ZATCA QR" width="100" height="100"/><p style="font-size:10px;color:#888;margin-top:4px">ZATCA</p></div>
      <script>window.onload=function(){window.print();window.close()}</script></body></html>`;
    const w = window.open('', '_blank', 'width=560,height=760');
    if (w) { w.document.write(html); w.document.close(); }
  }

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', paddingBottom: '24px' }}>
      <Card>
        <CardHeader>
          <div className="flex flex-col items-center gap-4 pb-2 border-b">
            <img src="/logo.png" alt="PharmaFlow Logo" className="h-28 w-auto object-contain logo-adaptive" />
          </div>
          <div className="flex items-start justify-between pt-4">
            <div className="flex items-center gap-2">
              <Button onClick={handlePrint} size="sm" className="gap-2">
                <Printer className="h-4 w-4" />
                {tCommon('print')}
              </Button>
            </div>
            <div className="text-end space-y-1">
              <CardTitle className="text-lg">{sale.invoice_number}</CardTitle>
              <p className="text-sm text-muted-foreground">{formatDateTime(sale.sold_at, locale)}</p>
              <p className="text-xs text-muted-foreground font-mono">{formatHijriDate(sale.sold_at)}</p>
              <p className="text-xs text-muted-foreground font-mono mt-1">ICV: {sale.icv}</p>
              <p className="text-xs text-muted-foreground font-mono truncate max-w-[200px]" title={sale.uuid}>UUID: {sale.uuid.slice(0, 18)}…</p>
              <p className="text-xs text-muted-foreground font-mono">VAT: 311111111111113</p>
              <p className="text-xs font-medium text-primary">
                {locale === 'ar' ? 'فاتورة ضريبية مبسطة' : 'Simplified Tax Invoice'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('pharmacist')}</p>
              <p className="text-sm font-medium">{pharmacistName}</p>
            </div>
            {(() => {
              const validLines = (sale.payment_lines ?? [])?.filter(l => parseFloat(String(l.amount)) > 0);
              return validLines && validLines.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t('paymentMethod')}</p>
                  <div className="text-sm font-medium space-y-1">
                    {validLines.map((line, idx) => (
                      <div key={idx}>
                        {lookupName(PAYMENT_METHODS, line.method, locale)} - {formatCurrency(parseFloat(String(line.amount)), locale)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t('paymentMethod')}</p>
                  <p className="text-sm font-medium">{lookupName(PAYMENT_METHODS, sale.payment_method, locale)}</p>
                </div>
              );
            })()}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{t('medicine')}</TableHead>
                <TableHead className="text-xs">{t('quantity')}</TableHead>
                <TableHead className="text-xs">{t('unitPrice')}</TableHead>
                <TableHead className="text-xs">{t('lineTotal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const nameAr = item.medicine_name_ar || item.medicine_id;
                const nameEn = item.medicine_name_en || item.medicine_id;
                const up = parseFloat(String(item.unit_price));
                return (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">
                      {locale === 'ar' ? nameAr : nameEn}
                      <span className="block text-xs text-muted-foreground">{locale === 'ar' ? nameEn : nameAr}</span>
                    </TableCell>
                    <TableCell className="text-sm">{item.quantity}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(up, locale)}</TableCell>
                    <TableCell className="text-sm font-medium">{formatCurrency(item.quantity * up, locale)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="border-t pt-4 mt-2">
            <div className="flex justify-between text-sm py-1">
              <span className="text-muted-foreground">{t('subtotal')}</span>
              <span className="font-medium">{formatCurrency(subtotal, locale)}</span>
            </div>
            {(sale.vat_breakdown ?? []).map(({ rate, vat_amount }) => (
              <div key={rate} className="flex justify-between text-sm py-1">
                <span className="text-muted-foreground">{t('vat')} ({rate.toFixed(0)}%)</span>
                <span className="font-medium">{formatCurrency(Number(vat_amount), locale)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-3 mt-1 text-base font-bold">
              <span>{t('grandTotal')}</span>
              <span className="text-primary">{formatCurrency(totalAmount, locale)}</span>
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <ZatcaQR
              sellerName="PharmaFlow Demo"
              vatNumber="311111111111113"
              timestamp={sale.sold_at}
              totalWithVat={totalAmount}
              vatTotal={vatAmount}
              size={96}
            />
          </div>

          {/* Returns section — shown if this sale has a return */}
          {saleReturn && (
            <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: '16px', marginTop: '8px' }}>
              <p style={{ fontSize: '12px', fontWeight: 600, color: 'hsl(0 84% 65%)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'hsl(0 84% 65%)' }} />
                {locale === 'ar' ? 'هذه الفاتورة تحتوي على مرتجع' : 'This invoice has a return'}
              </p>
              <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: '4px', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginBottom: '2px' }}>{locale === 'ar' ? 'رقم إشعار الدائن' : 'Credit Note #'}</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'hsl(var(--foreground))' }}>{saleReturn.credit_note_number}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginBottom: '2px' }}>{locale === 'ar' ? 'تاريخ الإرجاع' : 'Return Date'}</div>
                  <div style={{ fontSize: '13px', color: 'hsl(var(--foreground))' }}>{saleReturn.created_at.slice(0, 10)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginBottom: '2px' }}>{locale === 'ar' ? 'المبلغ المسترد' : 'Refund Amount'}</div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'hsl(0 84% 65%)' }}>{parseFloat(saleReturn.total_refund).toFixed(3)} SAR</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
