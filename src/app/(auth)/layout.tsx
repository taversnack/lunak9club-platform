import s from '@/ui/ui.module.css';
import { Card } from '@/ui/components';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${s.container} ${s.narrow}`}>
      <Card>{children}</Card>
    </div>
  );
}
