import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';
import { runCloudCarry } from '@/lib/cerberus/cloudCarry.server';

export const Route = createFileRoute('/api/public/jobs/cloud-carry')({
  server: { handlers: { POST: async ({ request }) => {
    const fail = await authenticateCronRequest(request); if (fail) return fail;
    try { return Response.json(await runCloudCarry()); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 502 }); }
  } } },
});
