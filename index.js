// LibraOS-4677 — Relay Server v3
// Routes encrypted blobs only. Never sees message content or passwords.
// Deploy as index.js on Render.com

const http = require('http');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('LibraOS-4677 relay v3 — operational');
});

const wss = new WebSocketServer({ server });

// clientId → ws
const clients = new Map();

// groupId → Set of clientIds
const groupRooms = new Map();

// token → { fromId, fromAlias, groupId?, groupName?, expires }
const inviteTokens = new Map();

function joinGroup(groupId, clientId) {
  if (!groupRooms.has(groupId)) groupRooms.set(groupId, new Set());
  groupRooms.get(groupId).add(clientId);
}

function leaveGroup(groupId, clientId) {
  const room = groupRooms.get(groupId);
  if (room) { room.delete(clientId); if (room.size === 0) groupRooms.delete(groupId); }
}

function leaveAllGroups(clientId) {
  for (const [gid, members] of groupRooms.entries()) {
    members.delete(clientId);
    if (members.size === 0) groupRooms.delete(gid);
  }
}

wss.on('connection', (ws) => {
  let myId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'REGISTER':
        myId = msg.clientId;
        clients.set(myId, ws);
        ws.send(JSON.stringify({ type: 'REGISTERED', clientId: myId }));
        break;

      // ── Direct message ──────────────────────────────────
      case 'DM': {
        const target = clients.get(msg.to);
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ type: 'DM', from: msg.from, to: msg.to, enc: msg.enc }));
        } else {
          // Queue or drop — for now just notify sender
          ws.send(JSON.stringify({ type: 'OFFLINE', targetId: msg.to }));
        }
        break;
      }

      // ── Group: join room ────────────────────────────────
      case 'GROUP_JOIN':
        if (myId && msg.groupId) joinGroup(msg.groupId, myId);
        break;

      // ── Group: leave room ───────────────────────────────
      case 'GROUP_LEAVE':
        if (myId && msg.groupId) leaveGroup(msg.groupId, myId);
        break;

      // ── Group: broadcast encrypted message ─────────────
      case 'GROUP_MSG': {
        const room = groupRooms.get(msg.groupId);
        if (!room) break;
        const outbound = JSON.stringify({ type: 'GROUP_MSG', groupId: msg.groupId, from: msg.from, enc: msg.enc });
        for (const memberId of room) {
          if (memberId === msg.from) continue;
          const target = clients.get(memberId);
          if (target && target.readyState === 1) target.send(outbound);
        }
        break;
      }

      // ── Invite token: create ────────────────────────────
      case 'CREATE_INVITE':
        inviteTokens.set(msg.token, {
          fromId: msg.fromId,
          fromAlias: msg.fromAlias,
          groupId: msg.groupId || null,
          groupName: msg.groupName || null,
          expires: Date.now() + 10 * 60 * 1000,
        });
        ws.send(JSON.stringify({ type: 'INVITE_CREATED', token: msg.token }));
        break;

      // ── Invite token: redeem ────────────────────────────
      case 'REDEEM_INVITE': {
        const entry = inviteTokens.get(msg.token);
        if (!entry) { ws.send(JSON.stringify({ type: 'INVITE_INVALID', reason: 'not_found' })); break; }
        if (Date.now() > entry.expires) {
          inviteTokens.delete(msg.token);
          ws.send(JSON.stringify({ type: 'INVITE_INVALID', reason: 'expired' }));
          break;
        }
        inviteTokens.delete(msg.token); // one-time use

        // Tell the redeemer who invited them
        ws.send(JSON.stringify({
          type: 'INVITE_REDEEMED',
          fromId: entry.fromId,
          fromAlias: entry.fromAlias,
          groupId: entry.groupId,
          groupName: entry.groupName,
          redeemerId: msg.myId,
          redeemerAlias: msg.myAlias,
        }));

        // Tell the inviter that someone redeemed
        const inviter = clients.get(entry.fromId);
        if (inviter && inviter.readyState === 1) {
          inviter.send(JSON.stringify({
            type: 'INVITE_ACCEPTED',
            redeemerId: msg.myId,
            redeemerAlias: msg.myAlias,
            groupId: entry.groupId,
          }));
        }
        break;
      }

      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG' }));
        break;
    }
  });

  ws.on('close', () => {
    if (myId) { clients.delete(myId); leaveAllGroups(myId); }
  });
  ws.on('error', () => {
    if (myId) { clients.delete(myId); leaveAllGroups(myId); }
  });
});

// Clean expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of inviteTokens.entries()) {
    if (now > entry.expires) inviteTokens.delete(token);
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`LibraOS-4677 relay v3 on port ${PORT}`));
