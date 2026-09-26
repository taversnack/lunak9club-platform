'use client';
import { useRouter } from 'next/navigation';
import { authClient } from '@/infra/auth/client';
import { Button } from './components';

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await authClient.signOut();
        router.push('/sign-in');
      }}
    >
      Sign out
    </Button>
  );
}
