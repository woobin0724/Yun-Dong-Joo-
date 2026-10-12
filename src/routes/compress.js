import zlib from 'node:zlib';

/**
 * 텍스트 응답 압축.
 *
 * `compression` 패키지를 쓰지 않고 node:zlib 로 직접 처리합니다.
 * 런타임 의존성을 express 와 web-push 둘로 묶어 두기로 한 약속 때문입니다.
 *
 * 왜 필요한가: 측정해 보니 첫 방문 764,652 B 중 370,843 B 가 텍스트였고
 * 압축이 전혀 걸려 있지 않았습니다. gzip 으로 279,924 B(36.6%)가 줄어듭니다.
 * 400kbps 학교 와이파이 기준 약 5.6초입니다.
 *
 * Brotli 를 먼저 보고, 없으면 gzip 으로 떨어집니다.
 */

// 이미 압축된 것을 다시 압축하면 CPU 만 쓰고 커지기도 합니다.
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|manifest\+json|xml)|image\/svg\+xml)/i;
const MIN_BYTES = 1024; // 이보다 작으면 헤더 값도 못 합니다

/** 품질은 압축률과 CPU 의 타협점입니다. 정적 파일이라 조금 더 들여도 됩니다. */
const BROTLI_OPTIONS = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  },
};

function pickEncoding(acceptEncoding = '') {
  const accepted = String(acceptEncoding).toLowerCase();
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return null;
}

export function compression(req, res, next) {
  const encoding = pickEncoding(req.headers['accept-encoding']);
  if (!encoding || req.method === 'HEAD') return next();

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  /** @type {Buffer[]} */
  const chunks = [];
  let compressing = null; // null = 아직 판단 전, false = 압축 안 함

  /** 헤더가 다 정해진 첫 쓰기 시점에 압축 여부를 정합니다. */
  const decide = () => {
    if (compressing !== null) return compressing;

    const type = res.getHeader('Content-Type');
    const already = res.getHeader('Content-Encoding');
    const length = Number(res.getHeader('Content-Length'));
    const cacheControl = String(res.getHeader('Cache-Control') || '');

    compressing =
      !already &&
      COMPRESSIBLE.test(String(type || '')) &&
      !cacheControl.includes('no-transform') &&
      !(Number.isFinite(length) && length < MIN_BYTES);

    if (compressing) {
      res.setHeader('Content-Encoding', encoding);
      res.removeHeader('Content-Length'); // 길이가 바뀝니다
      // 중간 캐시가 인코딩별로 따로 보관하도록
      res.setHeader('Vary', [res.getHeader('Vary'), 'Accept-Encoding'].filter(Boolean).join(', '));
    }
    return compressing;
  };

  res.write = function write(chunk, encodingArg, callback) {
    if (!decide()) return originalWrite(chunk, encodingArg, callback);
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encodingArg));
    if (typeof callback === 'function') callback();
    return true;
  };

  res.end = function end(chunk, encodingArg, callback) {
    if (!decide()) return originalEnd(chunk, encodingArg, callback);
    if (typeof chunk === 'function') {
      callback = chunk;
      chunk = undefined;
    }
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encodingArg));

    const body = Buffer.concat(chunks);
    const compress = encoding === 'br' ? zlib.brotliCompress : zlib.gzip;
    const options = encoding === 'br' ? BROTLI_OPTIONS : { level: 6 };

    compress(body, options, (err, packed) => {
      if (err) {
        // 압축에 실패하면 원문을 그대로 보냅니다. 응답을 잃는 것보다 낫습니다.
        res.removeHeader('Content-Encoding');
        res.setHeader('Content-Length', String(body.length));
        return originalEnd(body, callback);
      }
      res.setHeader('Content-Length', String(packed.length));
      originalEnd(packed, callback);
    });
    return res;
  };

  next();
}
