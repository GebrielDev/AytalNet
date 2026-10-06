import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { userRoom } from '../src/socket';
import {
  DashboardServer,
  collect,
  settle,
  startDashboardServer,
  waitForDisconnect,
} from './helpers/dashboardServer';
import { stubUsers } from './helpers/userStub';

const DISPATCHER = 1;
const OTHER_DISPATCHER = 2;
const ACTING_ADMIN = 99;

describe('dashboard socket', () => {
  let server: DashboardServer;
  let users: ReturnType<typeof stubUsers>;

  before(async () => {
    server = await startDashboardServer(ACTING_ADMIN);
  });

  after(async () => {
    await server.close();
  });

  beforeEach(() => {
    users = stubUsers([DISPATCHER, OTHER_DISPATCHER, ACTING_ADMIN]);
  });

  afterEach(() => {
    users.restore();
  });

  describe('handshake', () => {
    it('rejects a connection with no token', async () => {
      await assert.rejects(server.connectWith({}), /Authentication required/);
    });

    it('rejects a token that is not a user token', async () => {
      await assert.rejects(
        server.connectWith({ token: server.token(DISPATCHER, { type: 'driver' }) }),
        /limited to dispatchers and administrators/
      );
    });

    it('rejects a garbled token', async () => {
      await assert.rejects(server.connectWith({ token: 'not-a-jwt' }), /Invalid token/);
    });

    it('rejects a validly signed token for a user that no longer exists', async () => {
      const token = server.token(DISPATCHER);
      users.existing.delete(DISPATCHER);
      await assert.rejects(server.connectWith({ token }), /User not found/);
    });

    it('admits a dispatcher and joins them to the dashboard and per-user rooms', async () => {
      const socket = await server.connect(DISPATCHER);

      assert.equal(socket.connected, true);
      assert.equal(server.io.sockets.adapter.rooms.get('dashboard')?.size, 1);
      assert.equal(server.io.sockets.adapter.rooms.get(userRoom(DISPATCHER))?.size, 1);

      socket.close();
      await settle();
    });

    it('closes the socket when the token expires', async () => {
      const socket = await server.connect(DISPATCHER, { expiresIn: '1s' });
      const events = collect(socket, 'trip:started');

      await waitForDisconnect(socket, 3000);

      server.io.to('dashboard').emit('trip:started', { id: 1 });
      await settle();
      assert.deepEqual(events, []);
    });
  });

  describe('when a user is deleted', () => {
    it('disconnects their live sockets and leaves other users connected', async () => {
      const doomed = await server.connect(DISPATCHER);
      const bystander = await server.connect(OTHER_DISPATCHER);
      const doomedEvents = collect(doomed, 'trip:started');
      const bystanderEvents = collect(bystander, 'trip:started');

      // Baseline: the feed reaches both while both users exist.
      server.io.to('dashboard').emit('trip:started', { id: 1 });
      await settle();
      assert.equal(doomedEvents.length, 1);
      assert.equal(bystanderEvents.length, 1);

      assert.equal(await server.deleteUser(DISPATCHER), 200);
      await waitForDisconnect(doomed);

      assert.equal(doomed.connected, false);
      assert.equal(bystander.connected, true);

      // The deleted user must receive nothing further; the bystander must not
      // have been caught in the blast radius.
      server.io.to('dashboard').emit('trip:started', { id: 2 });
      await settle();
      assert.equal(doomedEvents.length, 1, 'deleted user received a post-deletion emit');
      assert.equal(bystanderEvents.length, 2);

      bystander.close();
      await settle();
    });

    it('leaves no dashboard or per-user room membership behind', async () => {
      const socket = await server.connect(DISPATCHER);
      assert.equal(server.io.sockets.adapter.rooms.get('dashboard')?.size, 1);

      assert.equal(await server.deleteUser(DISPATCHER), 200);
      await waitForDisconnect(socket);
      await settle();

      assert.equal(server.io.sockets.adapter.rooms.get('dashboard'), undefined);
      assert.equal(server.io.sockets.adapter.rooms.get(userRoom(DISPATCHER)), undefined);
    });

    it('disconnects every socket that user had open', async () => {
      const first = await server.connect(DISPATCHER);
      const second = await server.connect(DISPATCHER);
      assert.equal(server.io.sockets.adapter.rooms.get(userRoom(DISPATCHER))?.size, 2);

      assert.equal(await server.deleteUser(DISPATCHER), 200);
      await Promise.all([waitForDisconnect(first), waitForDisconnect(second)]);

      assert.equal(first.connected, false);
      assert.equal(second.connected, false);
    });

    it('rejects a reconnect that still carries the pre-deletion token', async () => {
      const token = server.token(DISPATCHER);
      const socket = await server.connectWith({ token });

      assert.equal(await server.deleteUser(DISPATCHER), 200);
      await waitForDisconnect(socket);

      // The token is still within its hour; the handshake's existence check is
      // what has to turn it away.
      await assert.rejects(server.connectWith({ token }), /User not found/);
    });

    it('refuses self-deletion without touching that user\'s socket', async () => {
      const socket = await server.connect(ACTING_ADMIN);

      assert.equal(await server.deleteUser(ACTING_ADMIN), 400);
      await settle();

      assert.equal(socket.connected, true);
      socket.close();
      await settle();
    });

    it('returns 404 for a user that does not exist', async () => {
      assert.equal(await server.deleteUser(12345), 404);
    });
  });
});
