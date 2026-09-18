// Role-based access control for the admin portal.
//
// One shared ADMIN_PASSWORD used to be the whole model: whoever held it could
// edit content, publish it, read the event stream and decrypt a member's
// activity. That is indefensible for a system holding health information — an
// audit trail that says "admin" tells you nothing, and somebody who only needs
// to draft an article should not be able to decrypt anyone's browsing.
//
// So: named admin accounts, each with exactly one role, and every protected
// route declares the permission it needs rather than a role. Adding a role is
// then a line in ROLE_PERMISSIONS, not a hunt through the routers.

/**
 * Every permission in the system. Grouped by what it puts at risk:
 *
 *   content:*    the app's published content
 *   media:*      the uploaded image library
 *   analytics:*  the event stream (read is aggregate, read_pii decrypts)
 *   admin:*      other admin accounts
 *   audit:read   the security audit trail
 */
export const PERMISSIONS = Object.freeze({
  CONTENT_READ: 'content:read',
  CONTENT_WRITE: 'content:write',
  // Deliberately separate from content:write: drafting and deciding what the
  // whole member base sees are different levels of trust.
  CONTENT_PUBLISH: 'content:publish',
  MEDIA_READ: 'media:read',
  MEDIA_WRITE: 'media:write',
  MEDIA_DELETE: 'media:delete',
  ANALYTICS_READ: 'analytics:read',
  ANALYTICS_EXPORT: 'analytics:export',
  // Opening one device's history decrypts personal information, so it is its
  // own permission rather than part of analytics:read.
  ANALYTICS_READ_PII: 'analytics:read_pii',
  ADMIN_MANAGE: 'admin:manage',
  AUDIT_READ: 'audit:read',
})

const P = PERMISSIONS

/**
 * Roles, least privileged first. A role is a job, not a tier — an analyst is
 * not "half an editor", they simply do a different job — but owner does
 * strictly contain every other role so there is always someone who can fix a
 * mistake.
 */
export const ROLES = Object.freeze({
  // Reads the numbers, exports them, cannot change what members see.
  analyst: [P.CONTENT_READ, P.ANALYTICS_READ, P.ANALYTICS_EXPORT],
  // Writes and revises content, but cannot decide when it goes live.
  editor: [P.CONTENT_READ, P.CONTENT_WRITE, P.MEDIA_READ, P.MEDIA_WRITE, P.ANALYTICS_READ],
  // Editor, plus the publish decision and tidying the media library.
  publisher: [
    P.CONTENT_READ,
    P.CONTENT_WRITE,
    P.CONTENT_PUBLISH,
    P.MEDIA_READ,
    P.MEDIA_WRITE,
    P.MEDIA_DELETE,
    P.ANALYTICS_READ,
  ],
  // Runs the portal day to day, including the member-level analytics views.
  admin: [
    P.CONTENT_READ,
    P.CONTENT_WRITE,
    P.CONTENT_PUBLISH,
    P.MEDIA_READ,
    P.MEDIA_WRITE,
    P.MEDIA_DELETE,
    P.ANALYTICS_READ,
    P.ANALYTICS_EXPORT,
    P.ANALYTICS_READ_PII,
    P.AUDIT_READ,
  ],
  // Everything, including creating and removing other admins.
  owner: Object.values(P),
})

export const ROLE_NAMES = Object.freeze(Object.keys(ROLES))

/** Human labels for the admin UI, kept beside the definitions they describe. */
export const ROLE_LABELS = Object.freeze({
  analyst: 'Analyst — read and export reporting',
  editor: 'Editor — draft content, cannot publish',
  publisher: 'Publisher — draft and publish content',
  admin: 'Administrator — full portal, member-level analytics',
  owner: 'Owner — full portal and admin accounts',
})

export function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role)
}

/** The permissions a role holds. An unknown role gets none, never everything. */
export function permissionsFor(role) {
  return isRole(role) ? [...ROLES[role]] : []
}

export function roleHas(role, permission) {
  return permissionsFor(role).includes(permission)
}

/** True when `actor` (a session's admin) holds `permission`. */
export function can(actor, permission) {
  if (!actor || actor.status !== 'active') return false
  // A session that has passed password but not the second factor is not yet
  // an authenticated admin; it may only finish signing in.
  if (actor.mfaVerified === false) return false
  return roleHas(actor.role, permission)
}

/**
 * Express guard. Requires `req.admin` to have been set by the admin session
 * middleware; answers 401 when nobody is signed in and 403 when they are but
 * lack the permission, so the UI can tell "log in again" from "not your job".
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    const actor = req.admin
    if (!actor) return res.status(401).json({ error: 'Not signed in' })
    if (actor.mfaVerified === false) {
      return res.status(401).json({ error: 'Two-factor authentication required', mfaRequired: true })
    }
    if (!can(actor, permission)) {
      return res.status(403).json({
        error: `Your role (${actor.role}) is not allowed to do that.`,
        required: permission,
      })
    }
    next()
  }
}

/**
 * Nobody may edit their own role or status, and only an owner may touch an
 * owner. Both rules exist so that privilege can never be escalated from inside
 * the portal: the first stops self-promotion, the second stops an
 * administrator from demoting the owner who could undo it.
 */
export function canManage(actor, target, changes = {}) {
  if (!can(actor, PERMISSIONS.ADMIN_MANAGE)) {
    return { ok: false, reason: 'You are not allowed to manage admin accounts.' }
  }
  if (target && actor.id === target.id && ('role' in changes || 'status' in changes)) {
    return { ok: false, reason: 'You cannot change your own role or status.' }
  }
  if (target && target.role === 'owner' && actor.role !== 'owner') {
    return { ok: false, reason: 'Only an owner can change an owner account.' }
  }
  if (changes.role === 'owner' && actor.role !== 'owner') {
    return { ok: false, reason: 'Only an owner can grant the owner role.' }
  }
  if (changes.role != null && !isRole(changes.role)) {
    return { ok: false, reason: `Unknown role "${changes.role}".` }
  }
  return { ok: true }
}
