'use strict';

// Server-authoritative, tenant-scoped notification inbox.
// No notification reads or writes are authorized from client-supplied user/school IDs.
function registerNotificationRoutes(app, pool, auth) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function own(req, res, next) {
    const a = req.auth;
    if (a?.type === 'PLATFORM_USER' && req.path.startsWith('/api/platform/notifications')) {
      req.notificationOwner = { kind: 'PLATFORM', id: a.userId, schoolId: null };
    } else if (a?.type === 'STUDENT') {
      req.notificationOwner = { kind: 'STUDENT', id: a.studentAccountId, schoolId: a.schoolId };
    } else if (a?.type === 'SCHOOL_USER') {
      req.notificationOwner = { kind: 'SCHOOL_USER', id: a.userId, schoolId: a.schoolId };
    } else {
      return res.status(403).json({ error: 'Your account cannot access notifications.' });
    }
    return next();
  }
  const scope = owner => [
    owner.kind, owner.id, owner.schoolId
  ];
  const where = "recipient_kind=$1 AND recipient_id=$2 AND school_id IS NOT DISTINCT FROM $3";

  function mount(base, authentication) {
    app.get(base, authentication, own, async (req, res) => {
      const owner = req.notificationOwner;
      const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
      const offset = Math.min(10000, Math.max(0, Number.parseInt(req.query.offset, 10) || 0));
      const filter = String(req.query.filter || 'ALL').toUpperCase();
      const q = String(req.query.q || '').trim().slice(0, 100);
      if (!['ALL', 'UNREAD', 'REQUEST', 'APPROVAL', 'SYSTEM'].includes(filter))
        return res.status(400).json({ error: 'Invalid notification filter.' });
      const args = scope(owner);
      let conditions = where;
      if (filter === 'UNREAD') conditions += ' AND read_at IS NULL';
      else if (filter !== 'ALL') { args.push(filter); conditions += ' AND category=$' + args.length; }
      if (q) {
        args.push('%' + q.replace(/[\\%_]/g, '\\$&') + '%');
        conditions += " AND (title ILIKE $" + args.length + " OR body ILIKE $" + args.length + ")";
      }
      try {
        const [unread, list] = await Promise.all([
          pool.query('SELECT count(*)::int AS count FROM user_notifications WHERE ' + where + ' AND read_at IS NULL', scope(owner)),
          pool.query('SELECT notification_id AS "notificationId",category,title,body,request_type AS "requestType",request_id AS "requestId",status,action_url AS "actionUrl",created_at AS "createdAt",updated_at AS "updatedAt",read_at AS "readAt" FROM user_notifications WHERE ' +
            conditions + ' ORDER BY created_at DESC,notification_id DESC LIMIT $' + (args.length + 1) +
            ' OFFSET $' + (args.length + 2), [...args, limit + 1, offset])
        ]);
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({
          notifications: list.rows.slice(0, limit),
          unreadCount: unread.rows[0]?.count || 0,
          nextOffset: list.rows.length > limit ? offset + limit : null
        });
      } catch (error) {
        console.error('Notification inbox:', error.message);
        res.status(503).json({ error: 'Notifications are temporarily unavailable.' });
      }
    });

    app.patch(base + '/:id/read', authentication, own, async (req, res) => {
      if (!UUID.test(req.params.id))
        return res.status(400).json({ error: 'Invalid notification ID.' });
      try {
        const result = await pool.query(
          'UPDATE user_notifications SET read_at=COALESCE(read_at,NOW()),updated_at=NOW() WHERE ' +
          where + ' AND notification_id=$4 RETURNING notification_id',
          [...scope(req.notificationOwner), req.params.id]
        );
        res.setHeader('Cache-Control', 'private, no-store');
        return result.rowCount ? res.json({ success: true }) : res.status(404).json({ error: 'Notification not found.' });
      } catch (error) {
        console.error('Notification read:', error.message);
        return res.status(503).json({ error: 'Unable to update notification.' });
      }
    });

    app.post(base + '/read-all', authentication, own, async (req, res) => {
      try {
        const result = await pool.query(
          'UPDATE user_notifications SET read_at=NOW(),updated_at=NOW() WHERE ' + where + ' AND read_at IS NULL',
          scope(req.notificationOwner)
        );
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({ success: true, updated: result.rowCount });
      } catch (error) {
        console.error('Notification read-all:', error.message);
        res.status(503).json({ error: 'Unable to update notifications.' });
      }
    });
    // Hard-delete only the signed-in recipient's notification row.
    // Underlying requests, school records, and audit trails are never changed.
    app.delete(base + '/:id', authentication, own, async (req, res) => {
      if (!UUID.test(String(req.params.id || '')))
        return res.status(400).json({ error: 'Invalid notification ID.' });
      try {
        const result = await pool.query(
          'DELETE FROM user_notifications WHERE ' + where + ' AND notification_id=$4 RETURNING notification_id',
          [...scope(req.notificationOwner), req.params.id]
        );
        res.setHeader('Cache-Control', 'private, no-store');
        return result.rowCount
          ? res.json({ success: true, deleted: 1 })
          : res.status(404).json({ error: 'Notification not found.' });
      } catch (error) {
        console.error('Notification delete:', error.message);
        return res.status(503).json({ error: 'Unable to delete notification.' });
      }
    });

    // Bulk cleanup is deliberately read-only messages: unread reminders and
    // pending-approval alerts cannot disappear through a one-click cleanup.
    app.post(base + '/delete-read', authentication, own, async (req, res) => {
      try {
        const result = await pool.query(
          'DELETE FROM user_notifications WHERE ' + where + ' AND read_at IS NOT NULL',
          scope(req.notificationOwner)
        );
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ success: true, deleted: result.rowCount });
      } catch (error) {
        console.error('Notification delete-read:', error.message);
        return res.status(503).json({ error: 'Unable to delete read notifications.' });
      }
    });

  }
  mount('/api/notifications', auth.authenticateSchoolClient);
  mount('/api/platform/notifications', auth.authenticatePlatform);
}
module.exports = { registerNotificationRoutes };
