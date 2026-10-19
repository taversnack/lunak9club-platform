import { PageSkeleton } from '@/ui/components';

// Scoped to this list page (route group) so pages that call notFound() still return a real 404 status.
export default function Loading() {
  return <PageSkeleton cards={3} />;
}
