import s from '@/ui/ui.module.css';
import p from '@/ui/public.module.css';
import { PlaceholderMedia } from '@/ui/components';

/**
 * Sign-in, register and password pages: one roomy rounded card; from 900 px a brand-colour photo placeholder
 * sits beside it (decorative; replace with Stephen's photo when supplied).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${s.container} ${p.authWrap}`}>
      <div className={p.authCard}>{children}</div>
      <div className={p.authPhoto}>
        <PlaceholderMedia ratio="4 / 3" />
      </div>
    </div>
  );
}
