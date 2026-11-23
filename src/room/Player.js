'use strict';

/** Someone connected to the room. */
class Player {
  /**
   * @param {object} options
   * @param {string} options.id - private connection id (never sent to other clients)
   * @param {string} options.publicId - id other clients use to refer to this player
   * @param {string} options.name
   * @param {string} [options.address] - private; the client's IP address
   */
  constructor({ id, publicId, name, address = id }) {
    this.id = id;
    this.address = address;
    this.publicId = publicId;
    this.name = name;
    Object.freeze(this);
  }
}

module.exports = { Player };
