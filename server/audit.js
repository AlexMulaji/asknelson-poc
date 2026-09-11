import { isEnabled, query } from './db.js'
import { aad, blindIndex, sealJson } from './crypto.js'

// Security audit trail (POPIA s19 safeguards, s22 breach investigation).
//
// Deliberately separate from analytics: this records who touched personal
// information and how accounts changed, not how the app is used. Rows carry no
// plaintext personal data — the IP is a keyed hash and any detail is sealed —
// and actor_id has no foreign key, so the trail outlives a deleted account.

/**
 * Record an audit event. Fire-and-forget: a failed audit write is logged but
 * never fails the request that triggered it.
 *
 * @param {import('express').Request|null} req
 * @param {{actor:'user'|'admin'|'system'|'anonymous', actorId?:string|null,
 *          action:string, targetType?:string, targetId?:string|null, details?:object}} entry
 */
export function audit(req, { actor, actorId = null, action, targetType = null, targetId = null, details = null }) {
  if (!isEnabled) return
  const ipHash = req?.ip ? blindIndex(req.ip, 'audit-ip') : null
  const detailsEnc = details ? sealJson(details, aad('audit_log', 'details', action)) : null
  query(
    `INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id, ip_hash, details_enc)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actor, actorId, action, targetType, targetId == null ? null : String(targetId), ipHash, detailsEnc]
  ).catch((err) => console.error('[asknelson][audit] write failed:', err.message))
}
