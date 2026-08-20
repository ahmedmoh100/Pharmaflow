import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localePrefix: 'always',
});

export type AppLocale = (typeof routing.locales)[number];

export function isRtl(locale: string): boolean {
  return locale === 'ar';
}
