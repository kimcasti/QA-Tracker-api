// Unit tests must not contact production, databases, SMTP, or external providers.
const net = require('node:net');
net.Socket.prototype.connect = function () {
  throw new Error('UNIT_TEST_NETWORK_BLOCKED: real socket connections are disabled');
};
