/**
 * The owner of the data that existed before users did (migration 0021; its workspace is
 * 00000000-0000-4000-8000-000000000002). A Cloudflare Access login to the app and its local dev
 * bypass stand for it; the admin plane never deletes it.
 */
export const BOOTSTRAP_USER_ID = "00000000-0000-4000-8000-000000000001";
