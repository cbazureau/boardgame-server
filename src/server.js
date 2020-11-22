const express = require('express');
const http = require('http');
const sio = require('socket.io');
const compression = require('compression');

const rooms = {};

const app = express();
const port = process.env.PORT || 5000;
const server = http.createServer(app).listen(port);
const io = sio(server, { origins: '*:*' });

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.use(compression());
// Reminder https://socket.io/docs/emit-cheatsheet/

app.disable('x-powered-by');
io.sockets.on('connection', socket => {
  let room = '';

  // message
  socket.on('message', message => socket.broadcast.to(room).emit('message', message));

  // find
  socket.on('find', ({ roomId, user, game }) => {
    console.log('[server] find', socket.id, roomId);
    room = roomId;
    const sr = io.sockets.adapter.rooms[room];
    if (sr === undefined) {
      // no room with such name is found so create it
      socket.join(room);
      rooms[roomId] = {
        originalGame: game,
        game: rooms && rooms[room] && rooms[room].game ? rooms[room].game : game,
        users: [
          {
            id: socket.id,
            user,
          },
        ],
      };
      socket.emit('create');
    } else if (sr.length === 1) {
      socket.emit('join');
      rooms[roomId].users.push({
        id: socket.id,
        user,
      });
    } else {
      // max two clients
      socket.emit('full', room);
    }
    io.to(room).emit('update', { game: rooms[room].game });
  });

  // auth
  socket.on('auth', data => {
    console.log('[server] auth', socket.id);
    socket.broadcast.to(room).emit('approve', { ...data, sid: socket.id });
  });

  // play
  socket.on('play', ({ game }) => {
    console.log('[server] play', socket.id, game.objects);
    rooms[room].game = { ...rooms[room].game, ...game };
    io.to(room).emit('update', { game });
  });

  // reset
  socket.on('reset', () => {
    console.log('[server] reset', socket.id);
    rooms[room].game = { ...rooms[room].game, ...rooms[room].originalGame };
    io.to(room).emit('update', { game: rooms[room].game });
  });

  // accept
  socket.on('accept', id => {
    console.log('[server] accept', socket.id);
    io.sockets.connected[id].join(room);
    io.in(room).emit('bridge');
    io.to(room).emit('update', { game: rooms[room].game });
  });

  // reject
  socket.on('reject', () => socket.emit('full'));

  // leave
  socket.on('leave', () => {
    console.log('[server] leave', socket.id);
    socket.broadcast.to(room).emit('hangup');
    socket.leave(room);
  });
});
