import {EventEmitter} from 'events';
import {createServer, Socket} from 'net';
import * as log from 'npmlog';

/**
 * A class for handling Abridged TCP connection.
 */
class TCPAbridgedTransport extends EventEmitter {
  length = 1;
  buffer = Buffer.alloc(0);
  recalculateLength = true;

  /**
   * TCPAbridgedTransport constructor, takes no parameters.
   */
  constructor() {
    super();

    this.on('rawData', (rawData) => {
      this.buffer = Buffer.concat([this.buffer, rawData]);

      if (this.recalculateLength) {
        if (this.buffer.slice(0, 1).toString('hex') == 'ef') {
          if (this.buffer.length == 1) {
            this.buffer = Buffer.alloc(0);
            return;
          } else {
            this.buffer = this.buffer.slice(1);
          }
        }

        if (
          this.buffer.length < 4 &&
          this.buffer.slice(0, 1).toString('hex') == '7f'
        ) return;

        if (this.buffer.slice(0, 1).toString('hex') == '7f') {
          this.length += (this.buffer.readUIntLE(1, 3) * 4) - 4;
          this.buffer = this.buffer.slice(3);
        } else {
          this.length += (this.buffer.readUIntLE(0, 1) * 4) - 1;
          this.buffer = this.buffer.slice(1);
        }

        log.info(this.constructor.name, `Length: ${this.length}`);

        this.recalculateLength = false;
      }

      if (this.buffer.length == this.length) {
        log.info(this.constructor.name, 'Received data');
        this.emit('data', this.buffer);
        this.recalculateLength = true;
        this.length = 0;
      }
    });
  }
}

/**
 * A class for handling TCP connection.
 */
export class TCPConnection extends EventEmitter {
  /**
   * Start new TCP listener.
   *
   * @param {string} address
   * TCP address to listen on.
   *
   * @param {number} port
   * TCP port to listen on.
   */
  start(address: string, port: number) {
    const server = createServer((socket: Socket) => {
      let transport: EventEmitter | undefined;
      let transportNegotiationFinished = false;
      let buffer = Buffer.alloc(0);

      const reader = new EventEmitter();

      log.info(this.constructor.name,
          `Established connection ${socket.remoteAddress}:${socket.remotePort}`,
      );

      this.emit('connected', socket, reader);

      socket.on('data', (data) => {
        if (!transportNegotiationFinished) {
          buffer = Buffer.concat([buffer, data]);

          const transportId = buffer.slice(0, 1).toString('hex');

          if (transportId == 'ef') {
            log.info(this.constructor.name, 'Using TCPAbridgedTransport');
            transport = new TCPAbridgedTransport();
          }

          if (transport != undefined) {
            transport.on('data', (data) => reader.emit('data', data));
            transport.emit('rawData', buffer);
          }

          transportNegotiationFinished = true;
        } else {
          if (transport != undefined) {
            transport.emit('rawData', data);
          } else {
            log.error(this.constructor.name, 'Unknown transport, aborting');
            socket.end(() => socket.destroy());
          }
        }
      });

      socket.on('close', () => socket.end(() => socket.destroy()));
      socket.on('error', (err) => {
        log.error(this.constructor.name, err.toString());
        socket.end(() => socket.destroy());
      });
    });

    server.on('error', (err) => {
      log.error(this.constructor.name, err.toString());
    });

    server.listen(port, address);

    log.info(this.constructor.name, `Listening on ${address}:${port}`);
  }
}
