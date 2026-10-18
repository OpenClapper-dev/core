/**
 * Tenancy (epic #107): who owns what. Every project and rig belongs to a workspace, every device and
 * viewfinder layout to a user; access is decided by workspace_members.
 */

/**
 * The owner of the data that existed before users did (migration 0021). Until requests carry a real
 * user (#109), new rows are attributed to it so nothing is created without an owner.
 */
export const BOOTSTRAP_USER_ID = "00000000-0000-4000-8000-000000000001";
export const BOOTSTRAP_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
