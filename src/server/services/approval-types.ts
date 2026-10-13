import 'server-only';

/**
 * The single place where approval types are registered (D77). Each import below loads a module that
 * calls registerApprovalType() at load time. approvals.ts loads this file before it uses the registry,
 * so pages, actions and jobs never depend on import order.
 *
 * Registered:
 *   booking.request       – src/server/services/booking-requests.ts (D76–D85)
 * Planned:
 *   membership.days       – Developer 1
 *   membership.move_once  – Developer 1
 *
 * Add a line like:  import './booking-requests';
 */
import './booking-requests';
import './membership-approvals';
