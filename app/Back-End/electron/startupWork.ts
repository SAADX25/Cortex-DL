/** Optional jobs cannot start before the window and first UI paint are ready.
 * A failed job is contained independently, including synchronous exceptions. */
export async function afterUiReady(ui: Promise<unknown>, job: () => Promise<void>, failed: (error: unknown) => void): Promise<void> {
  try { await ui; await job() } catch (error) { failed(error) }
}
