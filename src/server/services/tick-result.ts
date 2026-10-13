/** Whether a tick had any failure: a daily job that failed, or an every-tick step that failed. */
export function tickFailed(result: { jobs: { status: string }[]; failed: string[] }): boolean {
  return result.failed.length > 0 || result.jobs.some((j) => j.status === 'failed');
}
