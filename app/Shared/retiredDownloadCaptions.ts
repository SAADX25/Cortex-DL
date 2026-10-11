/** Drop retired online-caption options when restoring persisted download history. */
export function retireDownloadCaptions(task: Record<string, unknown>): void {
  delete task.subtitleLanguage
  delete task.subtitleIsAutomatic
  if (typeof task.errorMessage === 'string' && /YOUTUBE_SUBTITLE_(?:UNAVAILABLE|RATE_LIMITED)/i.test(task.errorMessage)) task.errorMessage = 'DOWNLOAD_RETRY_REQUIRED'
}
