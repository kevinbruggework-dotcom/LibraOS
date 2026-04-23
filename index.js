// LibraOS-4677 — Relay Server
// Deploy this as index.js on your Render service
// It only routes encrypted blobs — it never sees message content

const http = require('http');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('LibraOS-4677 relay — operational');
});

const wss = new WebSocketServer({ server });

// clientId → WebSocket
const clients = new Map();

// token → { fromId, fromAlias, expires, groupId?, groupName?, groupKey? }
const inviteTokens = new Map();

wss.on('connection', (ws) => {
  let myId = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {

      case 'REGISTER':
        myId = msg.clientId;
        clients.set(myId, ws);
        ws.send(JSON.stringify({ type: 'REGISTERED', clientId: myId }));
        break;

      case 'DM': {
        const target = clients.get(msg.to);
        if (target && target.readyState === 1) {
          target.send(JSON.stringify(msg));
        } else {
          ws.send(JSON.stringify({ type: 'OFFLINE', targetId: msg.to }));
        }
        break;
      }

      case 'GROUP_MSG': {
        const { members, from } = msg;
        if (!Array.isArray(members)) break;
        members.forEach(memberId => {
          if (memberId === from) return;
          const target = clients.get(memberId);
          if (target && target.readyState === 1) {
            target.send(JSON.stringify(msg));
          }
        });
        break;
      }

      case 'CREATE_INVITE': {
        inviteTokens.set(msg.token, {
          fromId: msg.fromId,
          fromAlias: msg.fromAlias,
          groupId: msg.groupId || null,
          groupName: msg.groupName || null,
          groupKey: msg.groupKey || null,
          expires: Date.now() + 10 * 60 * 1000,
        });
        ws.send(JSON.stringify({ type: 'INVITE_CREATED', token: msg.token }));
        break;
      }

      case 'REDEEM_INVITE': {
        const entry = inviteTokens.get(msg.token);
        if (!entry) { ws.send(JSON.stringify({ type: 'INVITE_INVALID', reason: 'not_found' })); break; }
        if (Date.now() > entry.expires) {
          inviteTokens.delete(msg.token);
          ws.send(JSON.stringify({ type: 'INVITE_INVALID', reason: 'expired' }));
          break;
        }
        inviteTokens.delete(msg.token);

        ws.send(JSON.stringify({
          type: 'INVITE_REDEEMED',
          fromId: entry.fromId,
          fromAlias: entry.fromAlias,
          groupId: entry.groupId,
          groupName: entry.groupName,
          groupKey: entry.groupKey,
          redeemerId: msg.myId,
          redeemerAlias: msg.myAlias,
        }));

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

  ws.on('close', () => { if (myId) clients.delete(myId); });
  ws.on('error', () => { if (myId) clients.delete(myId); });
});

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of inviteTokens.entries()) {
    if (now > entry.expires) inviteTokens.delete(token);
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`LibraOS relay running on port ${PORT}`));
