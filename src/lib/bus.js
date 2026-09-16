import { EventEmitter } from 'node:events';

/**
 * 방 안에서 일어난 일을 SSE 로 연결된 클라이언트에게 흘려보내기 위한 아주 작은 버스.
 * 한 대의 서버 안에서만 동작한다. 여러 대로 늘릴 때는 Redis pub/sub 같은 것으로 바꾸면 된다.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publish(roomId, event) {
  emitter.emit(`room:${roomId}`, event);
}

export function subscribe(roomId, handler) {
  const channel = `room:${roomId}`;
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}
