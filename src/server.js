const express = require('express');
const _remove = require('lodash/remove');
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

const emitUpdate = _roomId => {
  console.log('[server] emitUpdate', _roomId);
  if (!_roomId || !rooms[_roomId]) return;
  console.log('[server] users', rooms[_roomId].users);
  io.to(_roomId).emit('update', { game: rooms[_roomId].game, users: rooms[_roomId].users });
};

io.sockets.on('connection', socket => {
  let _roomId = '';

  // message
  socket.on('message', message => socket.broadcast.to(_roomId).emit('message', message));

  // welcome-lobby
  socket.on('welcome-lobby', ({ roomId, proposedGame = null }) => {
    console.log('[server] welcome-lobby', socket.id, roomId);
    _roomId = roomId;
    const user = {
      id: socket.id,
      serverStatus: 'IN_LOBBY',
    };
    if (!rooms[_roomId]) {
      if (!proposedGame) return;
      rooms[_roomId] = {
        users: [],
        game: proposedGame,
        originalGame: proposedGame,
      };
    }
    // const sr = io.sockets.adapter.rooms[_roomId];
    if (rooms[_roomId].users.find(u => u.id === socket.id)) {
      _remove(rooms[_roomId].users, u => u.id == socket.id);
    } else {
      socket.join(_roomId);
    }
    rooms[_roomId].users.push(user);
    socket.emit('enter-lobby', { currentUser: user });

    // update room info
    emitUpdate(_roomId);
  });

  // welcome-game
  socket.on('welcome-game', ({ username }) => {
    console.log('[server] welcome-game', socket.id, _roomId);
    const currentUserIndex = rooms[_roomId].users.findIndex(u => u.id === socket.id);
    const currentUser = rooms[_roomId].users[currentUserIndex];

    if (!currentUser || currentUser.serverStatus !== 'IN_LOBBY') return;

    const isSomeHost = rooms[_roomId].users.find(u => u.isHost);

    // Update user
    rooms[_roomId].users[currentUserIndex] = {
      ...currentUser,
      isHost: !isSomeHost,
      username,
      serverStatus: 'IN_GAME',
    };

    socket.emit('enter-game');

    // update room info
    emitUpdate(_roomId);
  });

  // welcome-rtc
  socket.on('welcome-rtc', () => {
    const currentUser = rooms[_roomId].users.find(u => u.id === socket.id) || {};
    if (currentUser.isHost) socket.emit('create');
    else socket.emit('join');
    // update room info
    emitUpdate(_roomId);
  });

  // auth
  socket.on('auth', data => {
    console.log('[server] auth', socket.id);
    socket.broadcast.to(_roomId).emit('approve', { ...data, sid: socket.id });
  });

  // play
  socket.on('play', ({ game }) => {
    console.log('[server] play', socket.id, _roomId);
    rooms[_roomId].game = { ...rooms[_roomId].game, ...game };

    // update room info
    emitUpdate(_roomId);
  });

  // reset
  socket.on('reset', () => {
    console.log('[server] reset', socket.id);
    rooms[_roomId].game = { ...rooms[_roomId].game, ...rooms[_roomId].originalGame };
    io.to(_roomId).emit('update', { game: rooms[_roomId].game });
  });

  // accept
  socket.on('accept', id => {
    console.log('[server] accept', socket.id);
    io.sockets.connected[id].join(_roomId);
    io.in(_roomId).emit('bridge');

    // update room info
    emitUpdate(_roomId);
  });

  // reject
  socket.on('reject', () => socket.emit('full'));

  // leave
  socket.on('leave', () => {
    console.log('[server] leave', socket.id, _roomId);
    if (rooms[_roomId]) _remove(rooms[_roomId].users, u => u.id == socket.id);
    socket.broadcast.to(_roomId).emit('hangup');
    socket.leave(_roomId);

    // update room info
    emitUpdate(_roomId);
  });
});
