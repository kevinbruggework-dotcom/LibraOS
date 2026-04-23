const http = require('http');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('LibraOS relay running');
});

const wss = new WebSocketServer({ server });
const rooms = {};

wss.on('connection', (ws) => {
  let currentRoom = null;
  let clientId = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'JOIN') {
        currentRoom = msg.room;
        clientId = msg.clientId;
        if (!rooms[currentRoom]) rooms[currentRoom] = {};
        rooms[currentRoom][clientId] = ws;
        return;
      }

      if (msg.type === 'RELAY' && currentRoom && rooms[currentRoom]) {
        Object.entries(rooms[currentRoom]).forEach(([id, client]) => {
          if (id !== clientId && client.readyState === 1) {
            client.send(data.toString());
          }
        });
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (currentRoom && clientId && rooms[currentRoom]) {
      delete rooms[currentRoom][clientId];
      if (Object.keys(rooms[currentRoom]).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('LibraOS relay on port', PORT));
