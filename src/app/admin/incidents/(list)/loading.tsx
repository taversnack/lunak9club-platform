import { PageSkeleton } from '@/ui/components';

// Scoped to this list page (route group) so detail pages that call notFound() keep a real 404 status.
export default function Loading() {
  return <PageSkeleton cards={2} />;
}
