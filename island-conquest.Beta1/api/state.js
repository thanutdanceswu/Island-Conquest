const { handler } = require('../lib/http.js');
const rooms = require('../lib/rooms.js');
module.exports = handler('GET', ({ query }) => rooms.readState(query.room, query.token, query.hb === '1', query.rev));
