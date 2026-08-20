'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { buildZatcaTlv } from '@/app/lib/utils';

interface ZatcaQRProps {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: number;
  vatTotal: number;
  size?: number;
}

export function ZatcaQR({
  sellerName,
  vatNumber,
  timestamp,
  totalWithVat,
  vatTotal,
  size = 96,
}: ZatcaQRProps) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    const tlv = buildZatcaTlv({ sellerName, vatNumber, timestamp, totalWithVat, vatTotal });
    QRCode.toDataURL(tlv, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setDataUrl).catch(() => setDataUrl(''));
  }, [sellerName, vatNumber, timestamp, totalWithVat, vatTotal, size]);

  if (!dataUrl) return <div style={{ width: size, height: size }} className="bg-muted animate-pulse rounded" />;

  return (
    <img
      src={dataUrl}
      alt="ZATCA QR"
      width={size}
      height={size}
      className="block"
    />
  );
}
