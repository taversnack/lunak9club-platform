'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/infra/auth/client';
import { Alert, Button, Field, Stack } from '@/ui/components';

type Errors = Partial<Record<'name' | 'email' | 'password' | 'confirm' | 'form', string>>;

export function RegisterForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name') ?? '').trim();
    const email = String(f.get('email') ?? '').trim();
    const password = String(f.get('password') ?? '');
    const confirm = String(f.get('confirm') ?? '');
    const next: Errors = {};
    if (!name) next.name = 'Enter your full name';
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = 'Enter a valid email address';
    if (password.length < 10) next.password = 'Use at least 10 characters';
    if (confirm !== password) next.confirm = 'Passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true);
    const { error } = await authClient.signUp.email({ name, email, password, callbackURL: '/dashboard' });
    setPending(false);
    if (error) {
      // Same message whether or not the email exists, to avoid account enumeration.
      setErrors({
        form:
          error.status === 429
            ? 'Too many attempts. Please wait and try again.'
            : 'We could not create your account. Check your details and try again.',
      });
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <h1>Create an account</h1>
        <p>You&apos;ll add your dogs and their records after confirming your email.</p>
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <Field label="Full name" name="name" autoComplete="name" required error={errors.name} />
        <Field label="Email address" name="email" type="email" autoComplete="email" required error={errors.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters"
          error={errors.password}
        />
        <Field
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirm}
        />
        <Button type="submit" full disabled={pending} aria-disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
        <p>
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      </Stack>
    </form>
  );
}
