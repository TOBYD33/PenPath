/**
 * Notification stub — no email/SMS provider is wired up yet (that's Phase
 * 10). Every workflow transition that should notify someone calls this so
 * the call sites are already correct once a real provider lands.
 */
export async function notify(params: { to: string; subject: string; body: string }): Promise<void> {
  console.log(`[notify stub] to=${params.to} subject="${params.subject}" body="${params.body}"`);
}
