import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Spike only (see docs/cloudflare-plan.md). No caching layer: every page here is dynamic and per-user.
export default defineCloudflareConfig();
