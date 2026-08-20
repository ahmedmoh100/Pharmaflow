import { redirect } from 'next/navigation';
import { routing } from '@/app/routing';

export default function RootPage() {
  redirect(`/${routing.defaultLocale}/login`);
}
