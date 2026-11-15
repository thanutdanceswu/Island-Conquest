const { handler } = require('../lib/http.js');
const rooms = require('../lib/rooms.js');
module.exports = handler('POST', () => rooms.createRoom());
