const { handler } = require('../lib/http.js');
const rooms = require('../lib/rooms.js');
module.exports = handler('POST', ({ body }) => rooms.join(body.room, { name: body.name, token: body.token }));
